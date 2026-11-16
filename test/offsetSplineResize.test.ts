import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { resizeOffsetSpline } from '../src/math/offsetSpline';
import { resizeOffsetSpline as reference } from '../src/math/offsetSplineResizeReference';
import { Vec2 } from '../src/math/vector';
import { evaluateBezier, type BezierSegment } from '../src/math/splineReference';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmOffsetSplineResize } from '../src/kernel/offsetSplineWasm';
import { MAX_OFFSET_SPLINE_POINTS } from '../src/kernel/offsetTypes';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelOffsetResize.json', import.meta.url), 'utf8'));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function compare(actual: any, expected: any, path = '') {
	if (typeof expected === 'number') {
		assert.ok(Math.abs(actual - expected) <= 1e-10 + Math.abs(expected) * 1e-12, `${path}: ${actual} != ${expected}`);
		return;
	}
	if (expected == null || typeof expected !== 'object') {
		assert.equal(actual, expected, path);
		return;
	}
	assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
	for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
}

test('resize fixtures identify the untouched pre-native arithmetic', () => {
	assert.equal(
		createHash('sha256')
			.update(readFileSync(new URL('../src/math/offsetSplineResizeReference.ts', import.meta.url)))
			.digest('hex'),
		fixture.sourceSha256
	);
});
for (const f of fixture.cases)
	test(`offset resize matches frozen subdivision and normal metadata: ${f.name}`, () => {
		const primitive = structuredClone(f.primitive);
		resizeOffsetSpline(primitive, f.count, f.distance);
		compare(plain(primitive), f.expected);
		assert.equal(primitive.fitPoints.length, f.count);
		for (const point of primitive.fitPoints) assert.ok(point instanceof Vec2);
	});

test('every refined cubic is an exact restriction of the original curve', () => {
	const f = fixture.cases.find(f => f.name === 'curved/4'),
		primitive = structuredClone(f.primitive);
	const curve = [primitive.fitPoints[0], primitive.handles[0].h2, primitive.handles[1].h1, primitive.fitPoints[1]].map(
		Vec2.from
	) as BezierSegment;
	for (const count of [3, 7, 35, 101]) {
		const result = structuredClone(primitive);
		resizeOffsetSpline(result, count, 4);
		for (let i = 0; i + 1 < count; i++) {
			const sub = [
				result.fitPoints[i],
				result.handles[i].h2,
				result.handles[i + 1].h1,
				result.fitPoints[i + 1],
			] as BezierSegment;
			// Original x(t)=30t gives an independent exact parameter mapping for each restriction.
			const t0 = sub[0].x / 30,
				t1 = sub[3].x / 30;
			for (const u of [0, 0.1, 0.5, 0.9, 1])
				compare(plain(evaluateBezier(sub, u)), plain(evaluateBezier(curve, t0 + (t1 - t0) * u)));
		}
	}
});

test('resizing preserves no-op array identities and ignores absent metadata', () => {
	const f = fixture.cases[0];
	for (const count of [0, 1, 2]) {
		const prim = structuredClone(f.primitive),
			points = prim.fitPoints,
			normals = prim.fitNormals,
			handles = prim.handles;
		resizeOffsetSpline(prim, count, 3);
		assert.equal(prim.fitPoints, points);
		assert.equal(prim.fitNormals, normals);
		assert.equal(prim.handles, handles);
	}
	for (const key of ['fitPoints', 'fitNormals', 'handles']) {
		const prim = structuredClone(f.primitive);
		delete prim[key];
		const before = plain(prim);
		resizeOffsetSpline(prim, 9, 3);
		assert.deepEqual(prim, before);
	}
});

test('resizer remains equivalent during repeated growth and signed basis changes', () => {
	for (const f of fixture.cases) {
		const expected = structuredClone(f.primitive),
			actual = structuredClone(f.primitive);
		for (const [count, distance] of [
			[4, -2],
			[12, 0],
			[24, 5],
		]) {
			reference(expected, count, distance);
			resizeOffsetSpline(actual, count, distance);
			compare(plain(actual), plain(expected));
		}
	}
});

test('WASM resizes a whole primitive in one call with no spline callbacks', {
	skip: !getGeometryKernel().offset?.resizeSpline,
}, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0;
	const f = fixture.cases.find(f => f.name === 'closed/-3'),
		primitive = structuredClone(f.primitive),
		before = plain(primitive);
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				resize_offset_spline(data, settings) {
					calls++;
					return bindings.resize_offset_spline(data, settings);
				},
				spline_geometry() {
					throw new Error('per-cubic boundary callback');
				},
			})
		);
		resizeOffsetSpline(primitive, f.count, f.distance);
		compare(plain(primitive), f.expected);
		assert.equal(calls, 1);
		resizeOffsetSpline(primitive, f.count + 3, 0);
		assert.equal(calls, 2);
		resizeOffsetSpline(primitive, f.count, 0);
		assert.equal(calls, 2);
		assert.equal(primitive.sourceId, before.sourceId);
		assert.equal(primitive.contourIndex, before.contourIndex);
		assert.deepEqual(primitive.startTangent, before.startTangent);
		assert.deepEqual(primitive.endTangent, before.endTangent);
	} finally {
		setGeometryKernel(previous);
	}
});

test('resize adapter rejects malformed results and invalid inputs before calling native code', () => {
	const f = fixture.cases[0],
		spline = {
			points: f.primitive.fitPoints,
			normals: f.primitive.fitNormals,
			handles: f.primitive.handles,
			closed: false,
		};
	for (const data of [[], [0], Array(30).fill(NaN), Array(29).fill(0)])
		assert.throws(() => createWasmOffsetSplineResize(() => new Float64Array(data))(spline, 3, 2), /WASM offset spline/);
	let calls = 0;
	const resize = createWasmOffsetSplineResize(() => {
		calls++;
		return new Float64Array();
	});
	for (const count of [1, 2.5, Infinity, MAX_OFFSET_SPLINE_POINTS + 1])
		assert.throws(() => resize(spline, count, 2), /resize input/);
	assert.throws(() => resize({ ...spline, normals: [] }, 3, 2), /resize input/);
	assert.equal(calls, 0);
});

test('native resize decoder rejects truncation, invalid flags and oversized counts', {
	skip: !getGeometryKernel().offset?.resizeSpline,
}, async () => {
	const { resize_offset_spline: call } = await import('../public/kernel/sketcher_wasm.js');
	const line = new Float64Array([0, 2, 0, 0, 0, 1, -4, 0, 4, 0, 12, 0, 0, 1, 8, 0, 16, 0]);
	for (const data of [[], [0, 2], [2, 2], [0, 2 ** 32], [0, 2, ...Array(16).fill(NaN)], [...line, 0]])
		assert.throws(() => call(new Float64Array(data), new Float64Array([3, 2])), /resize/);
	for (const settings of [[], [1, 0], [3.5, 0], [3, NaN], [MAX_OFFSET_SPLINE_POINTS + 1, 0]])
		assert.throws(() => call(line, new Float64Array(settings)), /resize/);
});

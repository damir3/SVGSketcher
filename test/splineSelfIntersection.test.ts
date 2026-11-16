import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getSplineSelfIntersections } from '../src/math/intersection';
import { evaluateBezier, type BezierSegment } from '../src/math/splineReference';
import { Vec2 } from '../src/math/vector';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmSplineKernel } from '../src/kernel/splineWasm';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelSplineSelf.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().backend === 'wasm';
const hydrate = (segments: any[]): BezierSegment[] => segments.map(b => b.map(Vec2.from) as BezierSegment);
function compare(actual: any, expected: any, path = '') {
	if (typeof expected === 'number') {
		assert.ok(Math.abs(actual - expected) <= 1e-10 + Math.abs(expected) * 1e-10, `${path}: ${actual} != ${expected}`);
		return;
	}
	if (expected == null || typeof expected !== 'object') {
		assert.equal(actual, expected, path);
		return;
	}
	assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
	for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
}
test('self-intersections require Rust instead of silently using the removed TS implementation', () => {
	const previous = getGeometryKernel();
	try {
		setGeometryKernel({ ...previous, spline: undefined });
		assert.throws(() => getSplineSelfIntersections([]), /require the Rust\/WASM kernel/);
	} finally {
		setGeometryKernel(previous);
	}
});
for (const c of fixture.cases)
	test(`spline self-intersections preserve order and parameters: ${c.name}`, { skip: !native }, () => {
		const segments = hydrate(c.segments),
			before = structuredClone(segments);
		const result = getSplineSelfIntersections(segments, c.closed);
		compare(result, c.expectedWasm);
		assert.deepEqual(structuredClone(segments), before);
		for (const hit of result) {
			assert.ok(hit.point instanceof Vec2);
			assert.ok(hit.paramA >= 0 && hit.paramA < hit.paramB && hit.paramB <= 1);
			const pointAt = (t: number) => {
				const value = t * segments.length,
					i = Math.min(Math.floor(value), segments.length - 1);
				return evaluateBezier(segments[i], value - i);
			};
			assert.ok(pointAt(hit.paramA).distanceTo(pointAt(hit.paramB)) < 1e-5);
		}
	});
test('known crossing and closed-seam exclusion retain their geometric meaning', { skip: !native }, () => {
	const crossing = fixture.cases.find(c => c.name === 'crossing-pair');
	const hits = getSplineSelfIntersections(hydrate(crossing.segments));
	assert.equal(hits.length, 1);
	assert.ok(hits[0].point.length() < 1e-8);
	assert.ok(Math.abs(hits[0].paramA - 0.25) < 1e-8);
	assert.ok(Math.abs(hits[0].paramB - 0.75) < 1e-8);
	const seam = fixture.cases.find(c => c.name === 'seam/false');
	assert.equal(getSplineSelfIntersections(hydrate(seam.segments), false).length, 1);
	assert.equal(getSplineSelfIntersections(hydrate(seam.segments), true).length, 0);
});
test('WASM performs the complete search in one call without cubic or pair callbacks', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0;
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				spline_geometry(points, handles, knots, settings) {
					assert.equal(settings[0], 10, 'unexpected per-cubic query');
					calls++;
					return bindings.spline_geometry(points, handles, knots, settings);
				},
				intersect_pairs() {
					throw new Error('unexpected per-pair callback');
				},
			})
		);
		for (const c of fixture.cases) {
			const before = calls;
			compare(getSplineSelfIntersections(hydrate(c.segments), c.closed), c.expectedWasm);
			assert.equal(calls, before + 1);
		}
	} finally {
		setGeometryKernel(previous);
	}
});
test('self-intersection adapter rejects malformed counts, coordinates and parameter pairs', () => {
	const segments = hydrate(fixture.cases.find(c => c.name === 'crossing-pair').segments);
	for (const result of [
		[0],
		[NaN, 0, 0.2, 0.8],
		[0, 0, -1, 0.8],
		[0, 0, 0.2, 1.1],
		[0, 0, 0.8, 0.2],
		[0, 0, 0.2, 0.2],
		Array(76).fill(0),
	]) {
		const api = createWasmSplineKernel(() => new Float64Array(result));
		assert.throws(() => api.selfIntersections!(segments, false), /WASM spline/);
	}
	assert.throws(
		() => createWasmSplineKernel(() => new Float64Array([0, 0, 0.2, 0.8])).selfIntersections!([], false),
		/count/
	);
});
test('self-intersections reject non-finite input without querying WASM', () => {
	const api = createWasmSplineKernel(() => {
		throw new Error('unexpected native query');
	});
	const segments = hydrate(fixture.cases.find(c => c.name === 'crossing-pair').segments);
	for (const value of [NaN, Infinity, -Infinity]) {
		segments[0][0].x = value;
		assert.throws(() => api.selfIntersections!(segments, false), /Non-finite spline self-intersection input/);
	}
});
test('native self-intersection decoder validates segment buffers, flags and unused fields', {
	skip: !native,
}, async () => {
	const { spline_geometry: query } = await import('../public/kernel/sketcher_wasm.js');
	const empty = new Float64Array(),
		points = new Float64Array([0, 0, 1, 1, -1, 1, 1, 0]);
	for (const settings of [
		[10, 0, 0, 2],
		[10, 1, 0, 0],
		[10, 0, 1, 0],
		[10, 0, 0, NaN],
		[10, 0, 0],
		[11, 0, 0, 0],
	])
		assert.throws(() => query(points, empty, empty, new Float64Array(settings)), /spline/);
	for (const bad of [[0, 0], [0, 0, 0], Array(8).fill(Infinity)])
		assert.throws(() => query(new Float64Array(bad), empty, empty, new Float64Array([10, 0, 0, 0])), /spline/);
	assert.throws(
		() => query(points, new Float64Array([0]), empty, new Float64Array([10, 0, 0, 0])),
		/self-intersection/
	);
	assert.throws(
		() => query(points, empty, new Float64Array([0]), new Float64Array([10, 0, 0, 0])),
		/self-intersection/
	);
	assert.deepEqual(query(empty, empty, empty, new Float64Array([10, 0, 0, 1])), empty);
});

test('coincident crossing locations retain distinct parameter pairs in segment order', { skip: !native }, () => {
	const line = (a: Vec2, b: Vec2): BezierSegment => [a, a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b];
	const segments = [
		line(new Vec2(-10, 0), new Vec2(10, 0)),
		line(new Vec2(0, -10), new Vec2(0, 10)),
		line(new Vec2(-10, -10), new Vec2(10, 10)),
	];
	const hits = getSplineSelfIntersections(segments);
	assert.equal(hits.length, 3);
	const parameters = [
		[1 / 6, 1 / 2],
		[1 / 6, 5 / 6],
		[1 / 2, 5 / 6],
	];
	hits.forEach((hit, i) => {
		assert.ok(hit.point.length() < 1e-8);
		assert.ok(Math.abs(hit.paramA - parameters[i][0]) < 1e-8);
		assert.ok(Math.abs(hit.paramB - parameters[i][1]) < 1e-8);
	});
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmSplineKernel } from '../src/kernel/splineWasm';
import * as spline from '../src/math/spline';
import { Vec2 } from '../src/math/vector';

const source = (): spline.BezierSegment[] => [
	[new Vec2(0, 1), new Vec2(4, 9), new Vec2(12, -3), new Vec2(17, 5)],
	[new Vec2(17, 5), new Vec2(24, 8), new Vec2(30, -10), new Vec2(38, 0)],
	[new Vec2(38, 0), new Vec2(40, 8), new Vec2(-10, -5), new Vec2(0, 1)],
];

function closePoint(a: Vec2, b: Vec2, scale = 1) {
	const tol = 1e-8 * Math.max(1, scale);
	assert.ok(a.distanceTo(b) <= tol, `${a.x},${a.y} != ${b.x},${b.y}`);
}

test('whole-spline cuts preserve endpoints, object sharing and immutability across scales', () => {
	for (const scale of [0.001, 1, 1000]) {
		const segments = source().map(
			b => b.map(p => new Vec2(p.x * scale + 51, p.y * scale - 73)) as spline.BezierSegment
		);
		const shared = segments.map(b => [...b] as spline.BezierSegment);
		for (let i = 1; i < shared.length; i++) shared[i][0] = shared[i - 1][3];
		shared.at(-1)![3] = shared[0][0];
		const cases = [segments, shared, segments.map(b => b.map(() => new Vec2(3, 4)) as spline.BezierSegment)];
		for (const curves of cases) {
			const before = JSON.stringify(curves);
			for (const t of [-2, 0, 1e-7, 1 / 3 - 1e-7, 1 / 3, 1 / 3 + 1e-7, 0.5, 1, 2]) {
				const actual = spline.splitSplineAtParam(curves, t);
				assert.equal(actual.leftSegments.length + actual.rightSegments.length, curves.length + 1);
				assert.equal(actual.leftSegments[0][0], curves[0][0]);
				assert.equal(actual.rightSegments.at(-1)![3], curves.at(-1)![3]);
				assert.equal(actual.leftSegments.at(-1)![3], actual.splitPoint);
				assert.equal(actual.rightSegments[0][0], actual.splitPoint);
				closePoint(actual.splitPoint, spline.getSplinePointAtParam(curves, Math.max(0, Math.min(1, t))), scale);
			}
			assert.equal(spline.extractSplineInterval(curves, 0, 1), curves);
			assert.equal(spline.trimBezier(curves[0], 0, 1), curves[0]);
			for (const [a, b] of [
				[0.2, 0.8],
				[0, 1 / 3],
				[1 / 3, 2 / 3],
				[0.8, 0.2],
				[0.1, 0.9],
			]) {
				const interval = spline.extractSplineInterval(curves, a, b);
				assert.ok(interval.length > 0);
				closePoint(interval[0][0], spline.getSplinePointAtParam(curves, a), scale);
				closePoint(interval.at(-1)![3], spline.getSplinePointAtParam(curves, b), scale);
				if (a <= b) {
					const trimmed = spline.trimBezier(curves[0], a, b);
					closePoint(trimmed[0], spline.evaluateBezier(curves[0], a), scale);
					closePoint(trimmed[3], spline.evaluateBezier(curves[0], b), scale);
				}
			}
			const snappedEnd = spline.extractSplineInterval(curves, 0.1, 1 - 1e-7);
			assert.equal(snappedEnd.at(-1)![3], curves.at(-1)![3]);
			assert.equal(JSON.stringify(curves), before);
		}
	}
	const empty: spline.BezierSegment[] = [];
	assert.equal(spline.extractSplineInterval(empty, 0, 1), empty);
	assert.deepEqual(spline.extractSplineInterval(empty, 0.2, 0.8), []);
	assert.throws(() => spline.splitSplineAtParam(empty, 0.5), /empty spline/);
});

test('each public cut uses one complete WASM query without position or per-cubic callbacks', async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0,
		mode = 0;
	try {
		setGeometryKernel({
			...previous,
			spline: createWasmSplineKernel((points, handles, knots, settings) => {
				assert.equal(settings[0], mode);
				calls++;
				return bindings.spline_geometry(points, handles, knots, settings);
			}),
		});
		const segments = source();
		const operations = [
			[11, () => spline.splitSplineAtParam(segments, 0.4)],
			[12, () => spline.trimBezier(segments[0], 0.2, 0.8)],
			[12, () => spline.trimBezier(segments[0], 0, 1)],
			[13, () => spline.extractSplineInterval(segments, 0.2, 0.8)],
			[13, () => spline.extractSplineInterval(segments, 0.8, 0.2)],
			[13, () => spline.extractSplineInterval(segments, 0, 1)],
			[13, () => spline.extractSplineInterval([], 0.5, 0.5)],
		] as const;
		for (const [expectedMode, operation] of operations) {
			mode = expectedMode;
			const before = calls;
			operation();
			assert.equal(calls, before + 1);
		}
	} finally {
		setGeometryKernel(previous);
	}
});

test('cut adapters reject corrupt buffers and provenance before exposing source objects', () => {
	const segments = source();
	const record = (index = 0, mask = 15) => [index, mask, ...segments[0].flatMap(p => [p.x, p.y])];
	const api = (output: number[]) => createWasmSplineKernel(() => new Float64Array(output));
	for (const output of [
		[],
		[0],
		[...record(), 0],
		record(-1),
		record(0.5),
		record(3),
		record(0, 2),
		record(0, NaN),
		record(0).map((v, i) => (i === 2 ? 123 : v)),
		record(0).map((v, i) => (i === 2 ? Infinity : v)),
	]) {
		assert.throws(() => api(output).trimBezier!(segments[0], 0.2, 0.8), /WASM spline/);
	}
	for (const output of [[], [2], [1, ...record()], [0, ...record(-1)], [0, ...Array(7).fill(record()).flat()]])
		assert.throws(() => api(output).extractInterval!(segments, 0.2, 0.8), /WASM spline/);
	for (const output of [[], [0], [4], [1.5], [1, ...record()], [1, ...Array(4).fill(record()).flat()]])
		assert.throws(() => api(output).splitSpline!(segments, 0.5), /WASM spline/);
	const throwing = createWasmSplineKernel(() => {
		throw new Error('native cut failure');
	});
	assert.throws(() => throwing.extractInterval!(segments, 0.2, 0.8), /native cut failure/);
});

test('cut adapters reject non-finite inputs before dispatch', () => {
	const api = createWasmSplineKernel(() => {
		throw new Error('unexpected native query');
	});
	const segments = source();
	for (const value of [NaN, Infinity, -Infinity]) {
		assert.throws(() => api.splitSpline!(segments, value), /Non-finite spline cut input/);
		assert.throws(() => api.trimBezier!(segments[0], value, 1), /Non-finite spline cut input/);
		assert.throws(() => api.extractInterval!(segments, 0, value), /Non-finite spline cut input/);
	}
	segments[0][0].x = NaN;
	assert.throws(() => api.extractInterval!(segments, 0, 1), /Non-finite spline cut input/);
});

test('native cut modes reject malformed segments, unused fields and invalid wrapped intervals', async () => {
	const { spline_geometry: query } = await import('../public/kernel/sketcher_wasm.js');
	const points = new Float64Array(source().flatMap(b => b.flatMap(p => [p.x, p.y]))),
		empty = new Float64Array();
	for (const settings of [
		[14, 0, 0, 0],
		[11, 0.5, 1, 0],
		[12, 0, 1, 1],
		[13, 1.5, 0.2, 0],
		[13, 0.5, -0.2, 0],
		[13, NaN, 1, 0],
		[13, 0, 1],
	])
		assert.throws(() => query(points, empty, empty, new Float64Array(settings)), /spline/);
	for (const mode of [11, 12, 13]) {
		const input = mode === 12 ? points.slice(0, 8) : points;
		const settings = new Float64Array([mode, 0, 0, 0]);
		assert.throws(() => query(input, new Float64Array([0]), empty, settings), /spline/);
		assert.throws(() => query(input, empty, new Float64Array([0]), settings), /spline/);
		assert.throws(() => query(points.slice(0, 2), empty, empty, settings), /spline/);
	}
	assert.throws(() => query(empty, empty, empty, new Float64Array([11, 0.5, 0, 0])), /empty spline/);
	assert.throws(() => query(points, empty, empty, new Float64Array([12, 0, 1, 0])), /segment count/);
});

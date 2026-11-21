import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBenchmarkScene, dragTarget, sceneCounts, SCENE_SIZES } from '../benchmarks/scenes';
import { summarize } from '../benchmarks/stats';
import { getGeometryKernel } from '../src/kernel';
import { SketchDocument } from '../src/model/sketch';
import { findSketchRegions } from '../src/math/regions';

test('benchmark scenes are deterministic, preserve the active backend and scale their workload', () => {
	const previous = getGeometryKernel();
	for (const family of ['rectangles', 'splines'] as const) {
		for (const size of Object.keys(SCENE_SIZES) as (keyof typeof SCENE_SIZES)[]) {
			const scene = createBenchmarkScene(family, size);
			assert.deepEqual(scene, createBenchmarkScene(family, size));
			assert.equal(getGeometryKernel(), previous);
			assert.equal(scene.snapshot.circles.length, SCENE_SIZES[size]);
			assert.equal(scene.snapshot.splines.length, family === 'splines' ? SCENE_SIZES[size] : 0);
			assert.ok(scene.snapshot.points.some(point => point.id === scene.dragPointId && !point.fixed));
			for (let i = 0; i < 30; i++) {
				const target = dragTarget(scene, i, 30);
				assert.ok(target.x >= scene.bounds.min.x && target.x <= scene.bounds.max.x);
				assert.ok(target.y >= scene.bounds.min.y && target.y <= scene.bounds.max.y);
			}
		}
	}
});

test('benchmark drag paths preserve solution and region counts', {
	skip: !getGeometryKernel().spline?.selfIntersections,
}, () => {
	for (const family of ['rectangles', 'splines'] as const) {
		const scene = createBenchmarkScene(family, 'small');
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		let numericalSteps = 0;
		for (let i = -2; i < 5; i++) {
			const point = dragTarget(scene, i, 5);
			sketch.dragPoint(scene.dragPointId, point.x, point.y);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-3);
			numericalSteps += sketch.lastSolverResult!.iterations;
			if (family === 'splines') {
				const anchor = scene.snapshot.points[2];
				const expected = Math.hypot(scene.origin.x - anchor.x, scene.origin.y - anchor.y);
				const actual = sketch.points.get(scene.dragPointId)!;
				assert.ok(Math.abs(Math.hypot(actual.x - anchor.x, actual.y - anchor.y) - expected) < 1e-3);
			}
		}
		assert.ok(numericalSteps > 0, 'drag workload must require numerical solution');
		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, SCENE_SIZES.small * (family === 'rectangles' ? 2 : 1));
		assert.ok(sceneCounts(sketch).points > 0);
		assert.ok(regions.every(region => region.area > 0));
	}
});

test('benchmark percentiles use nearest rank and reject invalid measurements', () => {
	assert.deepEqual(summarize([4, 1, 3, 2]), { count: 4, min: 1, p50: 2, p95: 4, max: 4, mean: 2.5 });
	assert.equal(summarize(Array.from({ length: 100 }, (_, i) => i + 1)).p95, 95);
	for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(values));
});

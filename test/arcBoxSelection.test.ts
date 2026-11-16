import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curvesIntersectAABB } from '../src/math/aabb';
import { Vec2 } from '../src/math/vector';
import type { QueryCurve } from '../src/kernel/queryTypes';
import { SketchDocument } from '../src/model/sketch';
import { SelectTool } from '../src/canvas/tools/selection/select';
import { Viewport } from '../src/canvas/viewport';

const p = (x: number, y: number) => new Vec2(x, y);
function circular(start: number, end: number, clockwise = false): QueryCurve {
	return {
		id: 'arc',
		type: 'arc',
		center: p(0, 0),
		radius: 10,
		start: Vec2.fromPolar(10, start),
		end: Vec2.fromPolar(10, end),
		clockwise,
	};
}
function around(curve: QueryCurve, point: Vec2, halfSize = 0.01) {
	return curvesIntersectAABB([curve], point.clone().subScalar(halfSize), point.clone().addScalar(halfSize))[0];
}

test('crossing selection follows the world-space arc sweep in both directions and across angle seams', () => {
	for (const [start, end] of [
		[0, Math.PI / 2],
		[2.9, 4.4],
		[-0.8, 0.6],
	]) {
		const middle = (start + end) / 2,
			on = Vec2.fromPolar(10, middle),
			other = Vec2.fromPolar(10, middle + Math.PI);
		const short = circular(start, end),
			long = circular(start, end, true),
			reversed = circular(end, start, true);
		assert.equal(around(short, on), true);
		assert.equal(around(short, other), false);
		assert.equal(around(long, on), false);
		assert.equal(around(long, other), true);
		assert.equal(around(reversed, on), true);
		assert.equal(around(reversed, other), false);
	}
});

test('a box around only an arc center or a sampled chord does not select the arc', () => {
	const arc = circular(0, Math.PI / 2);
	assert.equal(around(arc, p(0, 0)), false);
	assert.equal(around(arc, p(5, 5)), false);
	const a = Vec2.fromPolar(10, 0.4),
		b = Vec2.fromPolar(10, 0.45);
	assert.equal(around(arc, a.clone().lerp(b, 0.5), 1e-5), false);
	assert.equal(around(arc, Vec2.fromPolar(10, 0.4321), 1e-5), true);
});

test('crossing arc boxes include tangencies and endpoints but exclude the complementary arc', () => {
	const arc = circular(-0.4, 0.9);
	assert.equal(curvesIntersectAABB([arc], p(10, -0.1), p(11, 0.1))[0], true);
	assert.equal(curvesIntersectAABB([arc], p(10 + 1e-7, -0.1), p(11, 0.1))[0], false);
	assert.equal(around(arc, Vec2.fromPolar(10, -0.4)), true);
	assert.equal(around(arc, Vec2.fromPolar(10, 0.9)), true);
	assert.equal(around(arc, Vec2.fromPolar(10, Math.PI)), false);
});

test('elliptical arc crossing uses the same sweep rule, including rotated and tiny arcs', () => {
	for (const scale of [1, 0.0001]) {
		const center = p(30, -20),
			u = Vec2.fromPolar(1, 0.43),
			v = u.clone().perpendicular(),
			rx = 20 * scale,
			ry = 8 * scale;
		const at = (t: number) =>
			center
				.clone()
				.addScaledVector(u, rx * Math.cos(t))
				.addScaledVector(v, ry * Math.sin(t));
		const short: QueryCurve = {
			id: 'ea',
			type: 'elliptical_arc',
			center,
			majorAxisPoint: center.clone().addScaledVector(u, rx),
			minorAxisPoint: center.clone().addScaledVector(v, ry),
			start: at(-0.5),
			end: at(1.6),
			clockwise: false,
		};
		const long = { ...short, clockwise: true };
		assert.equal(around(short, at(0.4321), 1e-5 * scale), true);
		assert.equal(around(short, at(Math.PI), 1e-5 * scale), false);
		assert.equal(around(long, at(0.4321), 1e-5 * scale), false);
		assert.equal(around(long, at(Math.PI), 1e-5 * scale), true);
		assert.equal(around(short, center, 1e-5 * scale), false);
	}
});

test('right-to-left editor selection selects only the visible arc portion at any zoom', () => {
	const sketch = new SketchDocument(),
		center = sketch.addPoint(p(0, 0)),
		start = sketch.addPoint(p(10, 0)),
		end = sketch.addPoint(p(0, 10));
	const short = sketch.addArc(center.id, start.id, end.id, 10, false),
		long = sketch.addArc(center.id, start.id, end.id, 10, true),
		viewport = new Viewport();
	for (const zoom of [0.2, 3, 30]) {
		viewport.zoom = zoom;
		viewport.panX = 137;
		viewport.panY = 241;
		for (const [point, expected] of [
			[Vec2.fromPolar(10, 0.4321), [short.id]],
			[p(-10, 0), [long.id]],
			[p(0, 0), []],
		] as const) {
			const min = point.clone().subScalar(0.01),
				max = point.clone().addScalar(0.01);
			SelectTool.performBoxSelection(
				sketch,
				viewport,
				viewport.worldToScreen(p(max.x, max.y)),
				viewport.worldToScreen(p(min.x, min.y)),
				false,
				'select'
			);
			assert.deepEqual([...sketch.selection.arcIds], expected);
			// Left-to-right still requires the entire arc to be contained.
			SelectTool.performBoxSelection(
				sketch,
				viewport,
				viewport.worldToScreen(p(min.x, max.y)),
				viewport.worldToScreen(p(max.x, min.y)),
				false,
				'select'
			);
			assert.equal(sketch.selection.arcIds.size, 0);
		}
	}
});

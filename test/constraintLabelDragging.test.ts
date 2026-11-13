import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasInteraction } from '../src/canvas/interaction';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import {
	DistanceConstraint,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
	PointToLineDistanceConstraint,
} from '../src/solver/constraints';
import type { IConstraint } from '../src/solver/types';

const viewport = Object.assign(new Viewport(800, 600), { zoom: 2, panX: 50, panY: 300 });

function drag(sketch: SketchDocument, constraint: IConstraint, world: Vec2) {
	let renders = 0;
	const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
		sketch,
		viewport,
		isDraggingConstraint: true,
		draggedConstraintId: constraint.id,
		dragConstraintStartScreen: viewport.worldToScreen(new Vec2(-200, -200)),
		hasDragged: false,
		getScreenPos: () => viewport.worldToScreen(world),
		isSnapModifier: () => false,
		render: () => {
			renders++;
		},
	});
	interaction['handleMouseMove']({} as MouseEvent);
	assert.equal(renders, 1);
}

for (const [orientation, offset, position] of [
	['horizontal', -10, 0.5],
	['vertical', 0, 0.6],
	['aligned', -5 * Math.SQRT2, 0.55],
] as const) {
	test(`dragging ${orientation} distance preserves offset and label position`, () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint(new Vec2(10, 20));
		const b = sketch.addPoint(new Vec2(110, 120));
		const constraint = new DistanceConstraint('distance', a.id, b.id, a.distanceTo(b), 1, undefined, orientation);
		sketch.constraints.set(constraint.id, constraint);
		drag(sketch, constraint, new Vec2(60, 80));
		assert.ok(Math.abs(constraint.offset! - offset) < 1e-8);
		assert.ok(Math.abs(constraint.labelPosition! - position) < 1e-8);
	});
}

for (const [orientation, cursor, offset, position] of [
	['vertical', new Vec2(60, 30), -40, 0.625],
	['horizontal', new Vec2(60, 30), -50, 0.4],
	['aligned', new Vec2(160, 30), 19600 / Math.sqrt(65600), 46 / 41],
] as const) {
	test(`dragging ${orientation} origin distance preserves axis direction and endpoint order`, () => {
		const sketch = new SketchDocument();
		const point = sketch.addPoint(new Vec2(100, 80));
		const constraint = new OriginDistanceConstraint('origin', point.id, point.length(), orientation);
		sketch.constraints.set(constraint.id, constraint);
		drag(sketch, constraint, cursor);
		assert.ok(Math.abs(constraint.offset! - offset) < 1e-8);
		assert.ok(Math.abs(constraint.labelPosition! - position) < 1e-8);
	});
}

for (const [axis, offset, position] of [
	['x', -40, 0.625],
	['y', -50, 0.4],
] as const) {
	test(`dragging distance to ${axis} axis uses the segment midpoint`, () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint(new Vec2(50, 80));
		const b = sketch.addPoint(new Vec2(150, 80));
		const constraint = new LineToAxisDistanceConstraint('axis-distance', 'line', a.id, b.id, axis, 80);
		sketch.constraints.set(constraint.id, constraint);
		drag(sketch, constraint, new Vec2(60, 30));
		assert.equal(constraint.offset, offset);
		assert.equal(constraint.labelPosition, position);
	});
}

test('point-to-line dragging preserves midpoint snapping and outside labels', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint(new Vec2(0, 0));
	const b = sketch.addPoint(new Vec2(100, 0));
	const point = sketch.addPoint(new Vec2(20, 80));
	const line = sketch.addLine(a.id, b.id);
	const constraint = sketch.addPointToLineDistanceConstraint(point.id, line.id)!;
	drag(sketch, constraint, new Vec2(60, 42));
	assert.equal(constraint.offset, 40);
	assert.equal(constraint.labelPosition, 0.5);
	drag(sketch, constraint, new Vec2(60, 120));
	assert.equal(constraint.labelPosition, 1.5);
});

test('angle dragging preserves quadrant changes, radius floor, and solver calls', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint(new Vec2(0, 0));
	const b = sketch.addPoint(new Vec2(100, 0));
	const c = sketch.addPoint(new Vec2(0, 100));
	const l1 = sketch.addLine(a.id, b.id);
	const l2 = sketch.addLine(a.id, c.id);
	const constraint = sketch.addAngleConstraint(l1.id, l2.id)!;
	let solves = 0;
	sketch.solve = () => {
		solves++;
		return sketch.lastSolverResult!;
	};
	drag(sketch, constraint, new Vec2(40, 30));
	assert.equal(constraint.arcRadius, 50);
	assert.equal(solves, 0);
	const previous = [constraint.s1, constraint.s2];
	drag(sketch, constraint, new Vec2(-40, -30));
	assert.notDeepEqual([constraint.s1, constraint.s2], previous);
	assert.equal(solves, 1);
	assert.equal(constraint.targetAngle, 90);
	assert.equal(constraint.value, 90);
	drag(sketch, constraint, new Vec2(-1, -1));
	assert.equal(constraint.arcRadius, 10);
	assert.equal(solves, 1);
});

test('label movement ignores degenerate geometry and non-dimensional origin/axis constraints', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint(new Vec2(10, 20));
	const b = sketch.addPoint(new Vec2(10, 20));
	const constraints = [
		new DistanceConstraint('distance', a.id, b.id, 0),
		new PointToLineDistanceConstraint('point-line', a.id, 'line', a.id, b.id, 0),
		new OriginDistanceConstraint('origin', a.id, 0, 'aligned', undefined, true),
		new LineToAxisDistanceConstraint('axis', 'line', a.id, b.id, 'x', 0, 1, undefined, true),
	];
	for (const constraint of constraints) {
		constraint.moveLabelTo(new Vec2(200, 100), sketch, viewport);
		assert.equal(constraint.offset, undefined);
		assert.equal(constraint.labelPosition, undefined);
	}
});

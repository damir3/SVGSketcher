import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';

function arcScene(fixedEnd = false) {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(20, 30));
	const start = sketch.addPoint(new Vec2(30, 30));
	const end = sketch.addPoint(new Vec2(20, 40), fixedEnd);
	const arc = sketch.addArc(center.id, start.id, end.id, 10);
	return { sketch, center, start, end, arc };
}

for (const type of ['circle', 'arc'] as const) {
	test(`${type} radius/diameter edits keep a free concentric center in place`, () => {
		const { sketch, center, arc } = arcScene();
		const secondCenter = sketch.addPoint(center.clone());
		const other =
			type === 'circle'
				? sketch.addCircle(secondCenter.id, 25)
				: sketch.addArc(
						secondCenter.id,
						sketch.addPoint(new Vec2(45, 30)).id,
						sketch.addPoint(new Vec2(20, 55)).id,
						25
					);
		sketch.addCircleDistanceConstraint(arc.id, other.id);
		const dimension = sketch.addRadiusConstraint(arc.id, 10, 'diameter')!;
		const original = center.clone();
		const dof = sketch.lastSolverResult!.degreesOfFreedom;
		for (const diameter of [30, 50, 20]) {
			assert.ok(sketch.updateDimensionalConstraint(dimension.id, diameter, 'diameter'));
			assert.ok(center.distanceTo(original) < 1e-7);
			assert.ok(secondCenter.distanceTo(original) < 1e-7);
			assert.ok(Math.abs(arc.radius - diameter / 2) < 1e-7);
			assert.ok(Math.abs(other.radius - arc.radius - 15) < 1e-5);
			assert.equal(sketch.lastSolverResult!.degreesOfFreedom, dof, 'temporary locks do not remove actual freedoms');
		}
	});
}

for (const endpoint of ['start', 'end'] as const) {
	for (const method of ['drag', 'inspector'] as const) {
		test(`${method} of the arc ${endpoint} keeps the center when the radius can adapt`, () => {
			const { sketch, center, start, end, arc } = arcScene();
			const original = center.clone();
			const point = endpoint === 'start' ? start : end;
			const target = new Vec2(35, 45);
			if (method === 'drag') sketch.dragPoint(point.id, target.x, target.y);
			else assert.ok(sketch.setPointCoords(point.id, target.x, target.y));
			assert.ok(center.distanceTo(original) < 1e-7);
			assert.ok(point.distanceTo(target) < 2e-4);
			assert.ok(Math.abs(arc.radius - target.distanceTo(center)) < 2e-4);
		});
	}
}

for (const dimension of [false, true]) {
	test(`radius change holds the center and moves a free tangent line (dimension=${dimension})`, () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(new Vec2(0, 10));
		const a = sketch.addPoint(new Vec2(-40, 0));
		const b = sketch.addPoint(new Vec2(40, 0));
		const circle = sketch.addCircle(center.id, 10);
		const line = sketch.addLine(a.id, b.id);
		sketch.addTangentConstraint(line.id, circle.id);
		const original = center.clone();
		if (dimension) {
			const c = sketch.addRadiusConstraint(circle.id, 10, 'radius')!;
			assert.ok(sketch.updateDimensionalConstraint(c.id, 20, 'radius'));
		} else assert.ok(sketch.setCircleOrArcRadius(circle.id, 20));
		assert.ok(center.distanceTo(original) < 1e-7);
		assert.ok(Math.abs(circle.radius - 20) < 1e-5);
		assert.ok(a.y < -9.9 && b.y < -9.9);
	});
}

test('radius change releases the center when a fixed tangent line requires it', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(0, 10));
	const a = sketch.addPoint(new Vec2(-40, 0), true);
	const b = sketch.addPoint(new Vec2(40, 0), true);
	const circle = sketch.addCircle(center.id, 10);
	const line = sketch.addLine(a.id, b.id);
	sketch.addTangentConstraint(line.id, circle.id);
	assert.ok(sketch.setCircleOrArcRadius(circle.id, 20));
	assert.ok(Math.abs(center.y - 20) < 1e-5);
	assert.ok(Math.abs(circle.radius - 20) < 1e-5);
	assert.notEqual(sketch.lastSolverResult!.status, 'OVER_CONSTRAINED');
});

test('endpoint edit releases the center when radius and opposite endpoint are fixed', () => {
	const { sketch, center, start, end, arc } = arcScene(true);
	sketch.addRadiusConstraint(arc.id, 10, 'radius');
	const original = center.clone();
	assert.ok(sketch.setPointCoords(start.id, 30, 40));
	assert.ok(start.distanceTo(new Vec2(30, 40)) < 1e-5);
	assert.ok(end.distanceTo(new Vec2(20, 40)) < 1e-5);
	assert.ok(center.distanceTo(original) > 1);
	assert.ok(Math.abs(center.distanceTo(start) - 10) < 1e-5);
	assert.ok(Math.abs(center.distanceTo(end) - 10) < 1e-5);
});

test('explicit center edits remain free after a radius edit', () => {
	const { sketch, center, arc } = arcScene();
	assert.ok(sketch.setCircleOrArcRadius(arc.id, 20));
	assert.ok(sketch.setPointCoords(center.id, 60, 70));
	assert.ok(center.distanceTo(new Vec2(60, 70)) < 1e-5);
	assert.equal(center.fixed, false);
	assert.equal(
		[...sketch.constraints.values()].some(c => c.type === 'fixed'),
		false
	);
});

test('dragging an arc radius preserves the requested radius and free center', () => {
	const { sketch, center, start, end, arc } = arcScene();
	const original = center.clone();
	sketch.dragCircleRadius(arc.id, 20);
	assert.ok(center.distanceTo(original) < 1e-7);
	assert.ok(Math.abs(arc.radius - 20) < 1e-5);
	assert.ok(Math.abs(start.distanceTo(center) - 20) < 1e-5);
	assert.ok(Math.abs(end.distanceTo(center) - 20) < 1e-5);
	assert.equal(sketch.hasRadiusConstraint(arc.id), false);
});

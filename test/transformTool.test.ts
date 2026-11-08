import assert from 'node:assert/strict';
import { it } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { applyTransform, getTransformSelection } from '../src/model/transform';
import {
	ArcEndpointsConstraint,
	DistanceConstraint,
	HorizontalConstraint,
	RadiusConstraint,
} from '../src/solver/constraints';

it('transforms a shared endpoint, removes only broken constraints, and restores them with Undo', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 10, y: 5 });
	const b = sketch.addPoint({ x: 20, y: 5 });
	const c = sketch.addPoint({ x: 20, y: 15 });
	const line = sketch.addLine(a.id, b.id);
	const neighbor = sketch.addLine(b.id, c.id);
	const horizontal = sketch.addHorizontalConstraint(a.id, b.id);
	const vertical = sketch.addVerticalConstraint(b.id, c.id);
	const distance = sketch.addDistanceConstraint(a.id, b.id)!;
	sketch.selectEntity(line.id, 'line');

	assert.equal(applyTransform(sketch, getTransformSelection(sketch)!, { x: 3, y: 0, angle: 0, scale: 1 }, false), 1);
	assert.equal(b.x, 23);
	assert.equal(c.x, 20);
	assert.equal(neighbor.p1Id, b.id);
	assert.ok(sketch.constraints.has(horizontal.id));
	assert.ok(sketch.constraints.has(distance.id));
	assert.ok(!sketch.constraints.has(vertical.id));

	assert.ok(sketch.undo());
	assert.equal(sketch.points.get(b.id)?.x, 20);
	assert.ok(sketch.constraints.has(vertical.id));
});

it('copies shared geometry and remaps compatible internal constraints, including dimensions', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 10, y: 5 });
	const b = sketch.addPoint({ x: 20, y: 5 });
	const c = sketch.addPoint({ x: 20, y: 15 });
	const line1 = sketch.addLine(a.id, b.id);
	const line2 = sketch.addLine(b.id, c.id);
	sketch.addHorizontalConstraint(a.id, b.id);
	sketch.addDistanceConstraint(a.id, b.id);
	sketch.addDistanceConstraint('origin', a.id, Math.hypot(a.x, a.y));
	const original = [a.x, a.y, b.x, b.y];
	sketch.selectEntity(line1.id, 'line');
	sketch.selectEntity(line2.id, 'line', true);

	assert.equal(applyTransform(sketch, getTransformSelection(sketch)!, { x: 40, y: 20, angle: 90, scale: 1 }, true), 1);
	const [copy1, copy2] = [...sketch.selection.lineIds].map(id => sketch.lines.get(id)!);
	assert.notEqual(copy1.p1Id, a.id);
	assert.equal(copy1.p2Id, copy2.p1Id);
	assert.equal(sketch.points.size, 6);
	assert.equal(sketch.constraints.size, 4);
	const copyDistance = [...sketch.constraints.values()].find(c => c.entityIds.includes(copy1.p1Id));
	assert.ok(copyDistance instanceof DistanceConstraint);
	assert.equal(copyDistance.p2Id, copy1.p2Id);
	assert.equal(copyDistance.targetDistance, 10);
	assert.equal([...sketch.constraints.values()].filter(c => c instanceof HorizontalConstraint).length, 1);
	assert.deepEqual([a.x, a.y, b.x, b.y], original);
});

it('scales arc geometry and copies its endpoint constraint while dropping an incompatible radius', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 30, y: 20 });
	const start = sketch.addPoint({ x: 40, y: 20 });
	const end = sketch.addPoint({ x: 30, y: 30 });
	const arc = sketch.addArc(center.id, start.id, end.id, 10);
	sketch.addConstraint(new RadiusConstraint(sketch.nextId('c_radius'), arc.id, 10));
	sketch.selectEntity(arc.id, 'arc');

	const selection = getTransformSelection(sketch)!;
	assert.deepEqual(selection.center, { x: 35, y: 25 });
	assert.equal(applyTransform(sketch, selection, { x: 0, y: 0, angle: 0, scale: 2 }, true), 1);
	const id = [...sketch.selection.arcIds][0];
	const copy = sketch.arcs.get(id)!;
	assert.equal(copy.radius, 20);
	assert.equal(arc.radius, 10);
	assert.ok([...sketch.constraints.values()].some(c => c instanceof ArcEndpointsConstraint && c.arcId === id));
	assert.ok(![...sketch.constraints.values()].some(c => c instanceof RadiusConstraint && c.circleId === id));
});

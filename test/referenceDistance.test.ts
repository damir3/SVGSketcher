import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { DistanceConstraint, PointToLineDistanceConstraint } from '../src/solver/constraints';
import { serializeConstraint, deserializeConstraint } from '../src/solver/constraints/serialization';
import { NumericalSolver } from '../src/solver/solver';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';

test('conflicting distance becomes a reference without moving points or changing DoF', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 0 });
	sketch.addDistanceConstraint(a.id, b.id, 10);
	sketch.addHorizontalConstraint(a.id, b.id);
	const before = sketch.paramManager.getCurrentValues();
	const result = sketch.lastSolverResult!;
	let converted = 0;
	sketch.solverCoordinator.onReferenceCreated(() => converted++);
	sketch.solverCoordinator.onConstraintRejected(() => assert.fail('reference fallback is not a rejected command'));
	const reference = new DistanceConstraint('reference', a.id, b.id, 20);
	assert.equal(sketch.addConstraint(reference), true);
	assert.equal(reference.isReference, true);
	assert.equal(reference.targetDistance, 10);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, result.degreesOfFreedom);
	assert.equal(sketch.lastSolverResult!.equationsCount, result.equationsCount);
	assert.equal(converted, 1);
});

test('reference distances follow geometry and cannot be used to edit it', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 3, y: 4 });
	const c = new DistanceConstraint('reference', a.id, b.id, 999);
	c.isReference = true;
	const before = sketch.paramManager.getCurrentValues();
	const result = sketch.lastSolverResult;
	sketch.addConstraint(c);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.lastSolverResult, result, 'adding a reference does not run the solver');
	assert.equal(c.targetDistance, 5);
	assert.equal(sketch.setPointCoords(b.id, 6, 8), true);
	assert.ok(Math.abs(c.targetDistance - 10) < 1e-5);
	const moved = sketch.paramManager.getCurrentValues();
	assert.equal(sketch.updateDimensionalConstraint(c.id, 100), false);
	assert.equal(sketch.applyConstraintValueDirectly(c, 100), false);
	assert.equal(sketch.solverCoordinator.updateConstraint(c, () => assert.fail('reference edit must not run')), false);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), moved);
	assert.equal(sketch.solve().degreesOfFreedom, 2);
	assert.equal(sketch.lastSolverResult!.equationsCount, 0);
});

for (const orientation of ['aligned', 'horizontal', 'vertical'] as const) {
	test(`reference ${orientation} distance measures real coordinates and permits zero`, () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint({ x: 5, y: 9 }, true);
		const b = sketch.addPoint({ x: 2, y: 5 }, true);
		const c = sketch.addDistanceConstraint(a.id, b.id, 100, undefined, orientation)!;
		assert.equal(c.isReference, true);
		assert.equal(c.targetDistance, orientation === 'horizontal' ? 3 : orientation === 'vertical' ? 4 : 5);
		b.copy(a);
		sketch.notify();
		assert.equal(c.targetDistance, 0);
		assert.equal(c.value, 0);
	});
}

test('point-to-line reference measures the perpendicular gap without moving fixed geometry', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 20, y: 0 }, true);
	const p = sketch.addPoint({ x: 5, y: 10 }, true);
	const line = sketch.addLine(a.id, b.id);
	const before = sketch.paramManager.getCurrentValues();
	const c = sketch.addPointToLineDistanceConstraint(p.id, line.id, 30)!;
	assert.equal(c.isReference, true);
	assert.equal(c.targetDistance, 10);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	p.y = -7;
	sketch.notify();
	assert.equal(c.targetDistance, 7);
	assert.equal(c.getEquationsCount(), 0);
	assert.deepEqual(c.evaluate(sketch.paramManager.getCurrentValues()), []);
	assert.deepEqual(c.jacobian(new Map(), 0, sketch.paramManager.getCurrentValues()), []);
});

test('radial reference measures radii without forcing centers to coincide', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 });
	const b = sketch.addPoint({ x: 100, y: 40 });
	const first = sketch.addCircle(a.id, 10);
	const second = sketch.addCircle(b.id, 25);
	const c = new DistanceConstraint('radial-reference', a.id, b.id, 999);
	c.circleIds = [first.id, second.id];
	c.isReference = true;
	const before = sketch.paramManager.getCurrentValues();
	sketch.addConstraint(c);
	assert.equal(c.targetDistance, 15);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.solve().degreesOfFreedom, 6);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	second.radius = 10;
	sketch.notify();
	assert.equal(c.targetDistance, 0);
});

test('reference is excluded from both native compilation and direct numerical solves', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 });
	const b = sketch.addPoint({ x: 3, y: 4 });
	const c = new DistanceConstraint('reference', a.id, b.id, 1000);
	c.isReference = true;
	const values = sketch.paramManager.getCurrentValues();
	sketch.paramManager.prepare();
	assert.equal(c.getEquationsCount(), 0);
	assert.deepEqual(c.evaluate(values), []);
	assert.deepEqual(c.jacobian(sketch.paramManager.getIndices(), 0, values), []);
	const compiled = compileNativeConstraints([c], values, sketch.paramManager.getIndices());
	assert.equal(compiled.data.length, 0);
	assert.equal(compiled.fallbackAll.length, 0);
	assert.equal(compiled.fallbackHard.length, 0);
	const result = new NumericalSolver().solve(sketch.paramManager, [c]);
	assert.equal(result.equationsCount, 0);
	assert.equal(result.degreesOfFreedom, 4);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), values);
});

test('reference flag survives snapshots and SVG export and keeps measuring after reload', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 3, y: 4 }, true);
	const c = sketch.addDistanceConstraint(a.id, b.id, 20)!;
	assert.equal(c.isReference, true);
	const restored = deserializeConstraint(serializeConstraint(c)) as DistanceConstraint;
	assert.equal(restored.isReference, true);
	assert.equal(restored.getEquationsCount(), 0);
	const snapshot = sketch.takeSnapshot();
	const loaded = new SketchDocument();
	loaded.restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
	const reference = loaded.constraints.get(c.id) as DistanceConstraint;
	assert.equal(reference.isReference, true);
	loaded.points.get(b.id)!.x = 0;
	loaded.notify();
	assert.equal(reference.targetDistance, 4);
	const svg = loaded.exportSVG();
	assert.ok(svg.includes('"isReference": true'));
});

test('reference labels use parentheses, remain draggable, and have no edit button', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 3, y: 4 }, true);
	const c = sketch.addDistanceConstraint(a.id, b.id, 20)!;
	const viewport = new Viewport(800, 600);
	let label = '';
	c.renderDimension(sketch, viewport, {} as SVGGElement, false, options => { label = options.label; });
	assert.equal(label, '(5)');
	const before = sketch.paramManager.getCurrentValues();
	c.moveLabelTo(new Vec2(300, 100), sketch, viewport);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	const html = c.sidebarPanel.render({ sketch, renderPrimitivesSublist: () => '' } as any);
	assert.ok(html.includes('Reference Distance'));
	assert.ok(html.includes('(5)'));
	assert.ok(!html.includes('btn-insp-edit-dim'));
	const pointLine = new PointToLineDistanceConstraint('axis-reference', b.id, 'axis_x', 'origin', 'axis_x', 999);
	pointLine.isReference = true;
	pointLine.render({ sketch, viewport, targetGroup: {}, renderLinearDimensionVisual: options => { label = options.label; } } as any);
	assert.equal(label, '(4)');
});

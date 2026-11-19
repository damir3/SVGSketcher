import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { AngleConstraint, RadiusConstraint, OffsetConstraint } from '../src/solver/constraints';
import { serializeConstraint, deserializeConstraint } from '../src/solver/constraints/serialization';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { applyOffsetConstraintValue } from '../src/model/offsetSync';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import type { IConstraint } from '../src/solver/types';

function angleScene(fixed = true) {
	const sketch = new SketchDocument();
	const origin = sketch.addPoint({ x: 0, y: 0 }, true);
	const a = sketch.addPoint({ x: 20, y: 0 }, fixed);
	const b = sketch.addPoint({ x: 10, y: 10 * Math.sqrt(3) }, fixed);
	const first = sketch.addLine(origin.id, a.id);
	const second = sketch.addLine(origin.id, b.id);
	const constraint = new AngleConstraint('angle', first.id, second.id, origin.id, a.id, origin.id, b.id, 90);
	return { sketch, origin, a, b, first, second, constraint };
}

function radiusScene() {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 0, y: 0 }, true);
	const edge = sketch.addPoint({ x: 10, y: 0 }, true);
	const circle = sketch.addCircle(center.id, 10);
	sketch.addPointOnCircleConstraint(edge.id, circle.id);
	return { sketch, circle, edge };
}

function offsetScene(withChain = true) {
	const sketch = new SketchDocument();
	const [a, b, c, d] = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 0, y: 10 },
		{ x: 20, y: 10 },
	].map(p => sketch.addPoint(p, true));
	const source = sketch.addLine(a.id, b.id);
	const child = sketch.addLine(c.id, d.id);
	const constraint = new OffsetConstraint(
		'offset',
		[
			{
				kind: 'line',
				origLineId: source.id,
				origP1Id: a.id,
				origP2Id: b.id,
				offLineId: child.id,
				offP1Id: c.id,
				offP2Id: d.id,
				side: 1,
			},
		],
		10,
		0,
		1,
		withChain
			? {
					items: [{ id: source.id, type: 'line', startPointId: a.id, endPointId: b.id, reversed: false }],
					isClosed: false,
				}
			: undefined
	);
	return { sketch, a, b, c, d, source, child, constraint };
}

test('conflicting angle becomes a live reference without moving geometry', () => {
	const { sketch, b, constraint } = angleScene();
	const before = sketch.paramManager.getCurrentValues();
	assert.equal(sketch.addConstraint(constraint), true);
	assert.equal(constraint.isReference, true);
	assert.ok(Math.abs(constraint.targetAngle - 60) < 1e-10);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, 0);
	b.set(0, 20);
	sketch.notify();
	assert.equal(constraint.targetAngle, 90);
	assert.equal(sketch.updateDimensionalConstraint(constraint.id, 30), false);
});

test('a conflicting edit converts an existing angle to reference and supports undo/redo', () => {
	const { sketch, a, b, constraint } = angleScene(false);
	constraint.targetAngle = constraint.value = 60;
	sketch.addConstraint(constraint);
	sketch.addFixedConstraint(a.id);
	sketch.addFixedConstraint(b.id);
	assert.ok(!constraint.isReference);
	sketch.clearHistory();
	const before = sketch.paramManager.getCurrentValues();
	assert.equal(sketch.updateDimensionalConstraint(constraint.id, 90), true);
	assert.equal(constraint.isReference, true);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.undo(), true);
	assert.ok(!sketch.constraints.get(constraint.id)!.isReference);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.constraints.get(constraint.id)!.isReference, true);
});

for (const clockwise of [false, true]) {
	test(`reference arc angle follows the actual sweep (clockwise=${clockwise})`, () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint({ x: 0, y: 0 }, true);
		const start = sketch.addPoint({ x: 10, y: 0 }, true);
		const end = sketch.addPoint({ x: 0, y: 10 }, true);
		const arc = sketch.addArc(center.id, start.id, end.id, 10, clockwise);
		const before = sketch.paramManager.getCurrentValues();
		const c = sketch.addArcAngleConstraint(arc.id, 120, 40, clockwise ? -1 : 1)!;
		assert.equal(c.isReference, true);
		assert.equal(c.targetAngle, clockwise ? 270 : 90);
		assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
		const layout = (c as any).computeScreenArcLayout(sketch, new Viewport(800, 600));
		assert.ok(Math.abs((Math.abs(layout.delta) * 180) / Math.PI - c.targetAngle) < 1e-10);
	});
}

for (const mode of ['radius', 'diameter'] as const) {
	test(`conflicting ${mode} becomes reference and never locks the radius`, () => {
		const { sketch, circle, edge } = radiusScene();
		const before = sketch.paramManager.getCurrentValues();
		const c = sketch.addRadiusConstraint(circle.id, 20, mode)!;
		assert.equal(c.isReference, true);
		assert.equal(c.targetRadius, 10);
		assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
		edge.x = 15;
		sketch.solve();
		assert.ok(Math.abs(circle.radius - 15) < 1e-5);
		assert.equal(c.targetRadius, circle.radius);
		assert.equal(sketch.updateDimensionalConstraint(c.id, 100, mode), false);
	});
}

test('reference radius permits normal primitive radius edits', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 0, y: 0 });
	const circle = sketch.addCircle(center.id, 10);
	const c = new RadiusConstraint('reference', circle.id, 999);
	c.isReference = true;
	sketch.addConstraint(c);
	assert.equal(sketch.solve().degreesOfFreedom, 3);
	assert.equal(sketch.setCircleOrArcRadius(circle.id, 25), true);
	assert.equal(circle.radius, 25);
	assert.equal(c.targetRadius, 25);
});

test('reference angle does not block primitive relative angle edits or label dragging', () => {
	const { sketch, first, second, constraint } = angleScene(false);
	constraint.isReference = true;
	sketch.addConstraint(constraint);
	assert.equal(sketch.setLinesRelativeAngle(first.id, second.id, 90), true);
	assert.ok(Math.abs(constraint.targetAngle - 90) < 1e-4);
	const before = sketch.paramManager.getCurrentValues();
	constraint.moveLabelTo(new Vec2(200, 100), sketch, new Viewport(800, 600));
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.lastSolverResult!.equationsCount, 0);
});

test('conflicting offset becomes reference and source changes never regenerate its children', () => {
	const { sketch, a, b, c, d, constraint } = offsetScene();
	constraint.targetDistance = constraint.value = 20;
	const before = sketch.paramManager.getCurrentValues();
	sketch.addConstraint(constraint);
	assert.equal(constraint.isReference, true);
	assert.equal(constraint.targetDistance, 10);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	a.y = b.y = 4;
	const moved = sketch.paramManager.getCurrentValues();
	sketch.solve();
	assert.equal(c.y, 10);
	assert.equal(d.y, 10);
	assert.equal(constraint.targetDistance, 6);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), moved);
	assert.equal(applyOffsetConstraintValue(sketch, constraint, 99), false);
	assert.equal(sketch.updateDimensionalConstraint(constraint.id, 99), false);
});

test('conflicting offset edit restores the scene and retains a measured reference', () => {
	const { sketch, constraint } = offsetScene();
	// A driving dimension restored from a saved sketch must still handle conflicting edits.
	sketch.constraints.set(constraint.id, constraint);
	sketch.solve();
	sketch.clearHistory();
	const before = sketch.takeSnapshot();
	const values = sketch.paramManager.getCurrentValues();
	assert.equal(sketch.updateDimensionalConstraint(constraint.id, 20), true);
	assert.equal(constraint.isReference, true);
	assert.equal(constraint.targetDistance, 10);
	assert.equal(sketch.constraints.get(constraint.id), constraint);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), values);
	assert.deepEqual(sketch.takeSnapshot().lines, before.lines);
	assert.equal(sketch.isInTransaction(), false);
	assert.equal(sketch.undo(), true);
	assert.ok(!sketch.constraints.get(constraint.id)!.isReference);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.constraints.get(constraint.id)!.isReference, true);
});

test('reference spline offset measures the live source curve instead of its saved base positions', () => {
	const sketch = new SketchDocument();
	const sourcePoints = [sketch.addPoint({ x: 0, y: 0 }), sketch.addPoint({ x: 20, y: 0 })];
	const childPoints = [sketch.addPoint({ x: 0, y: 10 }), sketch.addPoint({ x: 20, y: 10 })];
	const source = sketch.addFitSpline(sourcePoints.map(p => p.id));
	const child = sketch.addFitSpline(childPoints.map(p => p.id));
	const c = new OffsetConstraint(
		'spline-reference',
		[
			{
				kind: 'spline',
				origSplineId: source.id,
				offSplineId: child.id,
				points: childPoints.map((p, i) => ({
					pointId: p.id,
					basePos: { x: i * 20, y: 0 },
					normal: { x: 0, y: 1 },
					side: 1,
				})),
			},
		],
		999
	);
	c.isReference = true;
	sketch.addConstraint(c);
	assert.ok(Math.abs(c.targetDistance - 10) < 1e-6);
	const sourceIds = new Set([
		...source.pointIds,
		...source.tangentLineIds!.flatMap(id => {
			const line = sketch.lines.get(id)!;
			return [line.p1Id, line.p2Id];
		}),
	]);
	for (const id of sourceIds) sketch.points.get(id)!.y += 3;
	sketch.notify();
	assert.ok(Math.abs(c.targetDistance - 7) < 1e-6);
	assert.equal(childPoints[0].y, 10);
	assert.equal(childPoints[1].y, 10);
});

test('all measured dimension types are absent from native equations and survive SVG snapshots', () => {
	const { sketch, constraint: angle } = angleScene();
	const center = sketch.addPoint({ x: 50, y: 50 });
	const circle = sketch.addCircle(center.id, 12);
	const radius = new RadiusConstraint('radius', circle.id, 99);
	const offset = new OffsetConstraint('offset', [], 99);
	const references: IConstraint[] = [angle, radius, offset];
	for (const c of references) {
		c.isReference = true;
		sketch.addConstraint(c);
		assert.equal(c.getEquationsCount(), 0);
		assert.deepEqual(c.evaluate(sketch.paramManager.getCurrentValues()), []);
		assert.deepEqual(c.jacobian(new Map(), 0, sketch.paramManager.getCurrentValues()), []);
		assert.equal(sketch.applyConstraintValueDirectly(c, 100), false);
		assert.equal(deserializeConstraint(serializeConstraint(c))!.isReference, true);
	}
	sketch.paramManager.prepare();
	const compiled = compileNativeConstraints(
		references,
		sketch.paramManager.getCurrentValues(),
		sketch.paramManager.getIndices()
	);
	assert.equal(compiled.data.length, 0);
	assert.equal(compiled.fallbackAll.length, 0);
	const svg = sketch.exportSVG();
	const snapshot = JSON.parse(svg.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]).snapshot;
	const loaded = new SketchDocument();
	loaded.restoreSnapshot(snapshot);
	for (const c of references) assert.equal(loaded.constraints.get(c.id)!.isReference, true);
	assert.equal(loaded.lastSolverResult!.equationsCount, 0);
});

test('reference angle, diameter and offset labels show measured values in parentheses with no value editor', () => {
	const { sketch, constraint: angle } = angleScene();
	sketch.addConstraint(angle);
	const center = sketch.addPoint({ x: 60, y: 0 });
	const circle = sketch.addCircle(center.id, 10);
	const radius = new RadiusConstraint('radius', circle.id, 99, 1, undefined, 'diameter');
	radius.isReference = true;
	sketch.addConstraint(radius);
	const scene = offsetScene();
	scene.constraint.isReference = true;
	scene.sketch.addConstraint(scene.constraint);
	const originalDocument = globalThis.document;
	const texts: string[] = [];
	const element = (): any => ({
		style: {},
		setAttribute() {},
		appendChild() {},
		set textContent(text: string) {
			texts.push(text);
		},
	});
	try {
		(globalThis as any).document = { createElementNS: () => element() };
		for (const [doc, c] of [
			[sketch, angle],
			[sketch, radius],
			[scene.sketch, scene.constraint],
		] as const) {
			c.render({
				sketch: doc,
				viewport: new Viewport(800, 600),
				targetGroup: element(),
				renderLinearDimensionVisual: (options: any) => texts.push(options.label),
			} as any);
			const html = c.sidebarPanel.render({ sketch: doc, renderPrimitivesSublist: () => '' } as any);
			assert.ok(html.includes('Reference'));
			assert.ok(!html.includes('btn-insp-edit-dim'));
		}
	} finally {
		(globalThis as any).document = originalDocument;
	}
	assert.ok(texts.includes('(60°)'));
	assert.ok(texts.includes('(Ø20)'));
	assert.ok(texts.includes('(10)'));
});

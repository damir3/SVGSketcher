import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { AngleConstraint, PointToLineDistanceConstraint } from '../src/solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../src/canvas/tools/types';

function scene(angle = 0, reversed = false, gap = 30) {
	const sketch = new SketchDocument();
	const dir = new Vec2(Math.cos(angle), Math.sin(angle));
	const normal = dir.clone().perpendicular();
	const a = sketch.addPoint(new Vec2(10, 20), true);
	const b = sketch.addPoint(Vec2.from(a).addScaledVector(dir, 100), true);
	const p = sketch.addPoint(Vec2.from(a).addScaledVector(dir, 20).addScaledVector(normal, gap));
	const q = sketch.addPoint(Vec2.from(p).addScaledVector(dir, 60));
	const reference = sketch.addLine(a.id, b.id);
	const line = sketch.addLine(reversed ? q.id : p.id, reversed ? p.id : q.id);
	return { sketch, reference, line, a, b, p, q };
}

for (const angle of [0, Math.PI / 2, 0.7]) {
	for (const reversed of [false, true]) {
		test(`line distance preserves parallelism when edited and perturbed (angle=${angle}, reversed=${reversed})`, () => {
			const { sketch, reference, line, a, b, p, q } = scene(angle, reversed);
			const c = sketch.addLineToLineDistanceConstraint(reference.id, line.id)!;
			assert.ok(c instanceof PointToLineDistanceConstraint);
			assert.equal(c.targetDistance, 30);
			assert.equal(c.getEquationsCount(), 2);
			assert.equal(sketch.addLineToLineDistanceConstraint(line.id, reference.id), c);
			assert.ok(sketch.updateDimensionalConstraint(c.id, 50));
			// Moving just one endpoint must restore both the gap and parallelism.
			p.x += 7;
			p.y -= 9;
			sketch.solve();
			const direction = new Vec2().subVectors(b, a).normalizeOrUnitX();
			for (const point of [p, q]) {
				assert.ok(Math.abs(Math.abs(new Vec2().subVectors(point, a).cross(direction)) - 50) < 1e-5);
			}
			for (const id of [reference.id, line.id]) {
				assert.ok(sketch.getConstraintsForEntity('line', id).includes(c));
				assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.type === 'line' && e.id === id));
			}
			const restored = deserializeConstraint(serializeConstraint(c)) as PointToLineDistanceConstraint;
			assert.equal(restored.getEquationsCount(), 2);
			sketch.constraints.set(c.id, restored);
			sketch.clearHistory();
			assert.equal(sketch.addLineToLineDistanceConstraint(line.id, reference.id, 40), restored);
			assert.ok(sketch.undo());
			assert.equal(sketch.getLineToLineDistanceConstraint(reference.id, line.id)!.targetDistance, 50);
			assert.ok(sketch.redo());
			assert.equal(sketch.getLineToLineDistanceConstraint(reference.id, line.id)!.targetDistance, 40);
		});
	}
}

for (const gap of [-30, 0]) {
	test(`line distance supports signed side and zero gap (${gap})`, () => {
		const { sketch, reference, line } = scene(0.7, false, gap);
		const c = sketch.addLineToLineDistanceConstraint(reference.id, line.id)!;
		assert.equal(c.targetDistance, Math.abs(gap));
		assert.ok(sketch.updateDimensionalConstraint(c.id, 20));
		const values = new Map(
			[...sketch.points.values()].flatMap(
				p =>
					[
						[`${p.id}.x`, p.x],
						[`${p.id}.y`, p.y],
					] as [string, number][]
			)
		);
		assert.ok(c.evaluate(values).every(r => Math.abs(r) < 1e-5));
	});
}

for (const axis of ['x', 'y'] as const) {
	for (const axisFirst of [false, true]) {
		test(`distance selection supports axis ${axis}, axisFirst=${axisFirst}`, () => {
			const { sketch, line } = scene(axis === 'x' ? 0 : Math.PI / 2);
			const ids = axisFirst ? [`axis_${axis}`, line.id] : [line.id, `axis_${axis}`];
			sketch.selectEntity(ids[0], 'line', false);
			sketch.selectEntity(ids[1], 'line', true);
			assert.ok(ConstraintTool.applyConstraintToSelection('distance', { sketch, showToast: () => {} }));
			const c = sketch.getLineToLineDistanceConstraint(...(ids as [string, string]))!;
			assert.ok(c instanceof PointToLineDistanceConstraint);
			assert.equal(c.lineId, `axis_${axis}`);
			assert.equal(c.constrainedLineId, line.id);
			assert.equal(c.getEquationsCount(), 2);
			assert.ok(sketch.updateDimensionalConstraint(c.id, 45));
			for (const id of [line.p1Id, line.p2Id]) {
				const p = sketch.points.get(id)!;
				assert.ok(Math.abs(Math.abs(axis === 'x' ? p.y : p.x) - 45) < 1e-5);
			}
		});
	}
}

for (const preselected of [false, true]) {
	test(`dimension previews and places line distance (preselected=${preselected})`, () => {
		const { sketch, reference, line } = scene(0.7, true);
		const viewport = new Viewport(800, 600);
		let preview: { point: Vec2; distance: number } | undefined;
		let edited: PointToLineDistanceConstraint | undefined;
		const ctx = {
			sketch,
			viewport,
			setCursor() {},
			showToast() {},
			requestRender() {},
			renderer: {
				clearPreviews() {},
				renderPointToLineDistancePreview(point: Vec2, _a: Vec2, _b: Vec2, _s: Vec2, distance: number) {
					preview = { point, distance };
				},
			},
			findPointNear: () => null,
			findSnap: () => null,
			findLineNear: () => null,
			findCircleNear: () => null,
			findArcNear: () => null,
			onEditDimension(c: PointToLineDistanceConstraint) {
				edited = c;
			},
		} as unknown as ToolContext;
		const event = (id?: string) =>
			({
				world: new Vec2(130, 70),
				screen: viewport.worldToScreen(new Vec2(130, 70)),
				client: new Vec2(130, 70),
				raw: {
					target: {
						closest: () => (id ? { getAttribute: (attr: string) => (attr === 'data-id' ? id : 'line') } : null),
					},
				},
			}) as unknown as ToolMouseEvent;
		if (preselected) {
			sketch.selectEntity(reference.id, 'line', false);
			sketch.selectEntity(line.id, 'line', true);
		}
		const tool = new DimensionTool();
		tool.activate(ctx);
		if (!preselected) {
			tool.onMouseDown(event(reference.id));
			tool.onMouseDown(event(line.id));
		}
		tool.renderPreview({
			sketch,
			viewport,
			cursorWorld: event().world,
			cursorScreen: event().screen,
		} as ToolRenderContext);
		assert.ok(preview);
		assert.ok(Math.abs(preview.distance - 30) < 1e-7);
		assert.equal(edited, undefined);
		tool.onMouseDown(event());
		assert.ok(edited instanceof PointToLineDistanceConstraint);
		assert.equal(edited.getEquationsCount(), 2);
		assert.ok(edited.distanceTo(event().screen, sketch, viewport)! < 1e-7);
		assert.ok(![...sketch.constraints.values()].some(c => c instanceof AngleConstraint));
	});
}

test('distance command reuses the constraint with reversed selection and undoes creation as one step', () => {
	const { sketch, reference, line } = scene();
	for (const ids of [
		[reference.id, line.id],
		[line.id, reference.id],
	]) {
		sketch.selectEntity(ids[0], 'line', false);
		sketch.selectEntity(ids[1], 'line', true);
		assert.ok(ConstraintTool.applyConstraintToSelection('dimension', { sketch, showToast() {} }));
	}
	assert.equal([...sketch.constraints.values()].filter(c => c.isDimensional).length, 1);
	assert.ok(sketch.undo());
	assert.equal(sketch.getLineToLineDistanceConstraint(reference.id, line.id), undefined);
});

test('nonparallel lines still receive an angle dimension; degenerate lines are rejected', () => {
	const { sketch, reference, line, q } = scene();
	q.y += 20;
	assert.equal(sketch.canAddLineToLineDistanceConstraint(reference.id, line.id), false);
	assert.equal(sketch.addLineToLineDistanceConstraint(reference.id, line.id), null);
	sketch.selectEntity(reference.id, 'line', false);
	sketch.selectEntity(line.id, 'line', true);
	assert.ok(ConstraintTool.applyConstraintToSelection('dimension', { sketch, showToast() {} }));
	assert.ok([...sketch.constraints.values()].some(c => c instanceof AngleConstraint));
	assert.equal(sketch.canAddLineToLineDistanceConstraint(line.id, line.id), false);
	assert.equal(sketch.canAddLineToLineDistanceConstraint('axis_x', 'axis_y'), false);
	const degenerate = sketch.addLine(q.id, q.id);
	assert.equal(sketch.canAddLineToLineDistanceConstraint(reference.id, degenerate.id), false);
});

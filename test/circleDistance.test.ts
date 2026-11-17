import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import { Viewport } from '../src/canvas/viewport';
import { DistanceConstraint } from '../src/solver/constraints/distance';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import type { LinearDimensionVisualOptions } from '../src/canvas/dimensionGeometry';

function scene(sharedCenter = true) {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(20, 30), true);
	const other = sharedCenter ? center : sketch.addPoint(new Vec2(20, 30));
	const inner = sketch.addCircle(center.id, 10);
	const outer = sketch.addCircle(other.id, 25);
	if (!sharedCenter) sketch.addConcentricConstraint(inner.id, outer.id);
	return { sketch, center, inner, outer };
}

for (const shared of [true, false]) {
	for (const reversed of [true, false]) {
		test(`circle distance solves and edits the radial gap (shared=${shared}, reversed=${reversed})`, () => {
			const { sketch, center, inner, outer } = scene(shared);
			sketch.addRadiusConstraint(inner.id, 10);
			const ids = (reversed ? [outer.id, inner.id] : [inner.id, outer.id]) as [string, string];
			const c = sketch.addCircleDistanceConstraint(...ids)!;
			assert.ok(c instanceof DistanceConstraint);
			assert.equal(c.targetDistance, 15);
			assert.equal(sketch.addCircleDistanceConstraint(ids[1], ids[0], 7), c);
			assert.ok(Math.abs(outer.radius - 17) < 1e-5);
			assert.ok(Math.abs(inner.radius - 10) < 1e-5);
			assert.ok(sketch.applyConstraintValueDirectly(c, 12));
			sketch.solve();
			assert.ok(Math.abs(outer.radius - 22) < 1e-5);
			assert.equal(center.x, 20);
			assert.equal(center.y, 30);
			assert.equal(sketch.getDistanceConstraint(inner.centerId, outer.centerId), undefined);
			assert.ok(sketch.getConstraintsForEntity('circle', outer.id).includes(c));
			assert.deepEqual(
				sketch.getEntitiesForConstraint(c).filter(entity => entity.type === 'circle'),
				[
					{ id: ids[0], type: 'circle' },
					{ id: ids[1], type: 'circle' },
				]
			);
		});
	}
}

test('circle distance native residuals and derivatives match JS and survive serialization', async () => {
	const { sketch, inner, outer } = scene();
	const c = sketch.addCircleDistanceConstraint(inner.id, outer.id)!;
	c.weight = 2;
	c.leaderAngle = 1.2;
	c.labelPosition = 1.4;
	c.expression = 'gap';
	const restored = deserializeConstraint(serializeConstraint(c)) as DistanceConstraint;
	assert.ok(restored instanceof DistanceConstraint);
	assert.deepEqual(serializeConstraint(restored), serializeConstraint(c));
	const values = new Map([
		[`${inner.id}.r`, 10],
		[`${outer.id}.r`, 25],
	]);
	const indices = new Map([...values.keys()].map((key, i) => [key, i]));
	const native = await import('../public/kernel/sketcher_wasm.js');
	for (const radii of [
		[10, 25],
		[30, 12],
		[20, 20],
	]) {
		values.set(`${inner.id}.r`, radii[0]);
		values.set(`${outer.id}.r`, radii[1]);
		const compiled = compileNativeConstraints([restored], values, indices);
		assert.equal(compiled.nativeCount, 1);
		const actual = native.evaluate_constraints(
			Float64Array.from(values.values()),
			compiled.data,
			new Float64Array([1, 1, 1])
		);
		const expected = [...restored.evaluate(values), 0, 0];
		for (const entry of restored.jacobian(indices, 0, values)) expected[1 + entry.col] += entry.val;
		actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8));
	}
});

test('circle distance label rotates, renders at both perimeters and remains selectable after reload', () => {
	const { sketch, inner, outer } = scene();
	const c = sketch.addCircleDistanceConstraint(inner.id, outer.id)!;
	const viewport = new Viewport(800, 600);
	for (const zoom of [1, 3]) {
		viewport.zoom = zoom;
		const cursor = viewport.worldToScreen(new Vec2(20, 48));
		c.moveLabelTo(cursor, sketch, viewport);
		const restored = deserializeConstraint(serializeConstraint(c)) as DistanceConstraint;
		let visual: LinearDimensionVisualOptions | undefined;
		restored.renderDimension(sketch, viewport, {} as SVGGElement, false, opts => {
			visual = opts;
		});
		assert.ok(visual);
		assert.ok(visual.d1.distanceTo(viewport.worldToScreen(new Vec2(20, 40))) < 1e-7);
		assert.ok(visual.d2.distanceTo(viewport.worldToScreen(new Vec2(20, 55))) < 1e-7);
		assert.ok(restored.distanceTo(cursor, sketch, viewport)! < 1e-7);
	}
});

test('distance command accepts concentric circles and rejects other pairs', () => {
	const { sketch, inner, outer } = scene();
	sketch.selectEntity(inner.id, 'circle', false);
	sketch.selectEntity(outer.id, 'circle', true);
	assert.ok(ConstraintTool.canApplyConstraint(sketch, 'distance'));
	assert.ok(ConstraintTool.applyConstraintToSelection('distance', { sketch, showToast: () => {} }));
	assert.equal([...sketch.constraints.values()].filter(c => c.type === 'distance').length, 1);
	assert.equal(sketch.addCircleDistanceConstraint(inner.id, inner.id), null);
	const offCenter = sketch.addPoint(new Vec2(30, 30));
	const other = sketch.addCircle(offCenter.id, 30);
	sketch.selectEntity(other.id, 'circle', false);
	sketch.selectEntity(inner.id, 'circle', true);
	assert.equal(ConstraintTool.canApplyConstraint(sketch, 'distance'), false);
	assert.equal(sketch.addCircleDistanceConstraint(inner.id, other.id), null);
});

test('dimension tool supports selecting two circles, placement, and cancellation without creating radius constraints', () => {
	const { sketch, inner, outer } = scene();
	const viewport = new Viewport(800, 600);
	let edited: unknown;
	let hit: typeof inner | null = null;
	const ctx = {
		sketch,
		viewport,
		setCursor: () => {},
		showToast: () => {},
		requestRender: () => {},
		renderer: { clearPreviews: () => {} },
		findPointNear: () => null,
		findSnap: () => null,
		findCircleNear: () => hit,
		findLineNear: () => null,
		onEditDimension: (c: unknown) => {
			edited = c;
		},
	} as unknown as ToolContext;
	const event = (id?: string) =>
		({
			screen: viewport.worldToScreen(new Vec2(38, 30)),
			world: new Vec2(38, 30),
			client: new Vec2(38, 30),
			raw: {
				target: {
					closest: () => (id ? { getAttribute: (attr: string) => (attr === 'data-id' ? id : 'circle') } : null),
				},
			},
		}) as unknown as ToolMouseEvent;
	const tool = new DimensionTool();
	tool.activate(ctx);
	tool.onMouseDown(event(inner.id));
	assert.equal(tool.isHighlightEnabled(), true);
	assert.equal(tool.canHighlight({ type: 'circle', id: outer.id }), true);
	assert.equal(tool.canHighlight({ type: 'circle', id: inner.id }), false);
	assert.equal(tool.canHighlight({ type: 'point', id: inner.centerId }), false);
	const offsetCenter = sketch.addPoint(new Vec2(100, 100));
	const offsetCircle = sketch.addCircle(offsetCenter.id, 12);
	assert.equal(tool.canHighlight({ type: 'circle', id: offsetCircle.id }), false);
	hit = outer;
	tool.onMouseDown(event(outer.id));
	assert.equal(tool.isHighlightEnabled(), false);
	assert.equal(tool.canHighlight({ type: 'circle', id: outer.id }), false);
	assert.equal(sketch.constraints.size, 0);
	hit = null;
	tool.onMouseDown(event());
	assert.ok(edited instanceof DistanceConstraint);
	assert.equal(sketch.constraints.size, 1);
	assert.equal(sketch.hasRadiusConstraint(inner.id), false);
	assert.equal(sketch.hasRadiusConstraint(outer.id), false);
	const second = scene();
	second.sketch.selectEntity(second.inner.id, 'circle', false);
	second.sketch.selectEntity(second.outer.id, 'circle', true);
	tool.activate({ ...ctx, sketch: second.sketch });
	tool.cancel();
	assert.equal(second.sketch.constraints.size, 0);
});

test('circle distance preserves concentricity after removing the concentric constraint and restoring', () => {
	const { sketch, center, inner, outer } = scene(false);
	const concentric = [...sketch.constraints.values()].find(c => c.type === 'concentric')!;
	const gap = sketch.addCircleDistanceConstraint(inner.id, outer.id)!;
	sketch.removeConstraint(concentric.id);
	assert.equal(
		[...sketch.constraints.values()].some(c => c.type === 'concentric'),
		false
	);
	const restored = deserializeConstraint(serializeConstraint(gap)) as DistanceConstraint;
	sketch.constraints.set(gap.id, restored);
	sketch.dragCircle(outer.id, 80, 90);
	const secondCenter = sketch.points.get(outer.centerId)!;
	assert.ok(center.distanceTo(secondCenter) < 0.01);
	sketch.solve();
	assert.ok(center.distanceTo(secondCenter) < 1e-5);
	assert.ok(Math.abs(Math.abs(outer.radius - inner.radius) - gap.targetDistance) < 1e-5);
});

test('native circle distance enforces both center coordinates and matches the JS Jacobian', async () => {
	const { sketch, inner, outer } = scene(false);
	const gap = sketch.addCircleDistanceConstraint(inner.id, outer.id)!;
	gap.weight = 2;
	const values = new Map([
		[`${inner.id}.r`, 10],
		[`${outer.id}.r`, 25],
		[`${inner.centerId}.x`, 20],
		[`${inner.centerId}.y`, 30],
		[`${outer.centerId}.x`, 70],
		[`${outer.centerId}.y`, 90],
	]);
	const indices = new Map([...values.keys()].map((key, i) => [key, i]));
	const compiled = compileNativeConstraints([gap], values, indices);
	assert.equal(compiled.nativeCount, 1);
	assert.equal(gap.getEquationsCount(), 3);
	const native = await import('../public/kernel/sketcher_wasm.js');
	const actual = native.evaluate_constraints(
		Float64Array.from(values.values()),
		compiled.data,
		new Float64Array([3, 3, 1])
	);
	const expected = [...gap.evaluate(values), ...new Array(3 * indices.size).fill(0)];
	for (const entry of gap.jacobian(indices, 0, values)) expected[3 + entry.row * indices.size + entry.col] += entry.val;
	assert.deepEqual([...actual], expected);
});

for (const reversed of [false, true]) {
	for (const placed of [false, true]) {
		test(`circle distance label preserves its perimeter offset after diameter edits (reversed=${reversed}, placed=${placed})`, () => {
			const { sketch, center, inner, outer } = scene();
			const diameter = sketch.addRadiusConstraint(inner.id, 10, 'diameter')!;
			const gap = reversed
				? sketch.addCircleDistanceConstraint(outer.id, inner.id)!
				: sketch.addCircleDistanceConstraint(inner.id, outer.id)!;
			const viewport = new Viewport(800, 600);
			if (placed) gap.moveLabelTo(viewport.worldToScreen(new Vec2(70, 80)), sketch, viewport);
			const before = gap.getLabelScreenPos(sketch, viewport)!;
			const originalOuter = outer.radius;
			const direction = new Vec2().subVectors(viewport.screenToWorld(before), center).normalizeOrUnitX();
			for (const radius of [15, 40, 8]) {
				assert.ok(sketch.applyConstraintValueDirectly(diameter, radius, 'diameter'));
				sketch.solve();
				const expected = viewport.worldToScreen(
					viewport.screenToWorld(before).addScaledVector(direction, outer.radius - originalOuter)
				);
				assert.ok(gap.getLabelScreenPos(sketch, viewport)!.distanceTo(expected) < 1e-7);
				let visual: LinearDimensionVisualOptions | undefined;
				gap.renderDimension(sketch, viewport, {} as SVGGElement, false, opts => {
					visual = opts;
				});
				assert.ok(visual);
				const renderedAnchor = visual.d1
					.clone()
					.addScaledVector(new Vec2().subVectors(visual.d2, visual.d1), visual.labelPosition ?? 0.5);
				assert.ok(renderedAnchor.distanceTo(expected) < 1e-7);
				assert.ok(gap.distanceTo(expected, sketch, viewport)! < 1e-7);
				const restored = deserializeConstraint(serializeConstraint(gap)) as DistanceConstraint;
				sketch.constraints.set(gap.id, restored);
				assert.ok(restored.getLabelScreenPos(sketch, viewport)!.distanceTo(expected) < 1e-7);
			}
		});
	}
}

function radialScene(types: readonly ['circle' | 'arc', 'circle' | 'arc'], sharedCenter: boolean) {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(20, 30), true);
	const other = sharedCenter ? center : sketch.addPoint(new Vec2(20, 30));
	const entities = types.map((type, i) => {
		const radius = i === 0 ? 10 : 25;
		const c = i === 0 ? center : other;
		if (type === 'circle') return sketch.addCircle(c.id, radius);
		const start = sketch.addPoint(new Vec2(c.x + radius, c.y));
		const end = sketch.addPoint(new Vec2(c.x, c.y + radius));
		return sketch.addArc(c.id, start.id, end.id, radius, false);
	});
	return { sketch, center, entities };
}

for (const types of [
	['arc', 'arc'],
	['circle', 'arc'],
	['arc', 'circle'],
] as const) {
	for (const shared of [true, false]) {
		test(`radial distance supports ${types.join('/')} (shared center=${shared})`, () => {
			const {
				sketch,
				center,
				entities: [a, b],
			} = radialScene(types, shared);
			const concentric = sketch.addConcentricConstraint(a.id, b.id)!;
			sketch.selectEntity(a.id, types[0], false);
			sketch.selectEntity(b.id, types[1], true);
			ConstraintTool.pruneIncompatibleSelection(sketch, 'distance');
			assert.ok(ConstraintTool.canApplyConstraint(sketch, 'distance'));
			assert.ok(ConstraintTool.applyConstraintToSelection('distance', { sketch, showToast: () => {} }));
			const gap = [...sketch.constraints.values()].find(c => c instanceof DistanceConstraint) as DistanceConstraint;
			assert.equal(gap.targetDistance, 15);
			assert.equal(sketch.addCircleDistanceConstraint(b.id, a.id), gap);
			for (let i = 0; i < 2; i++) {
				const entity = [a, b][i];
				assert.ok(sketch.getConstraintsForEntity(types[i], entity.id).includes(gap));
				assert.ok(sketch.getEntitiesForConstraint(gap).some(e => e.id === entity.id && e.type === types[i]));
			}
			const radius = sketch.addRadiusConstraint(a.id, 10, 'radius')!;
			const viewport = new Viewport(800, 600);
			gap.moveLabelTo(viewport.worldToScreen(new Vec2(50, 60)), sketch, viewport);
			let anchor = gap.getLabelScreenPos(sketch, viewport)!;
			const initialOuter = Math.max(a.radius, b.radius);
			const direction = new Vec2().subVectors(viewport.screenToWorld(anchor), center).normalizeOrUnitX();
			sketch.removeConstraint(concentric.id);
			assert.ok(sketch.applyConstraintValueDirectly(radius, 15));
			sketch.solve();
			assert.ok(Math.abs(a.radius - 15) < 1e-5);
			assert.ok(Math.abs(b.radius - 30) < 1e-5);
			anchor = viewport.worldToScreen(
				viewport.screenToWorld(anchor).addScaledVector(direction, Math.max(a.radius, b.radius) - initialOuter)
			);
			assert.ok(gap.getLabelScreenPos(sketch, viewport)!.distanceTo(anchor) < 1e-7);
			if (!shared) {
				sketch.dragPoint(b.centerId, 70, 80);
				sketch.solve();
				assert.ok(sketch.points.get(b.centerId)!.distanceTo(center) < 1e-5);
			}
			const restored = deserializeConstraint(serializeConstraint(gap)) as DistanceConstraint;
			assert.deepEqual(serializeConstraint(restored), serializeConstraint(gap));
			let visual: LinearDimensionVisualOptions | undefined;
			restored.renderDimension(sketch, viewport, {} as SVGGElement, false, opts => {
				visual = opts;
			});
			assert.ok(visual);
			assert.ok(
				Math.abs(
					visual.d1.distanceTo(viewport.worldToScreen(center)) / viewport.zoom -
						(restored.circleIds![0] === a.id ? a.radius : b.radius)
				) < 1e-5
			);
			assert.ok(
				Math.abs(
					visual.d2.distanceTo(viewport.worldToScreen(center)) / viewport.zoom -
						(restored.circleIds![1] === b.id ? b.radius : a.radius)
				) < 1e-5
			);
			assert.ok(restored.distanceTo(anchor, sketch, viewport)! < 1e-5);
		});
	}

	test(`dimension tool highlights and selects ${types.join('/')} sequentially or from selection`, () => {
		const {
			sketch,
			entities: [a, b],
		} = radialScene(types, true);
		const viewport = new Viewport(800, 600);
		let secondHit = false;
		let edited: unknown;
		const ctx = {
			sketch,
			viewport,
			setCursor: () => {},
			showToast: () => {},
			requestRender: () => {},
			renderer: { clearPreviews: () => {} },
			findPointNear: () => null,
			findSnap: () => null,
			findCircleNear: () => (secondHit && types[1] === 'circle' ? b : null),
			findArcNear: () => (secondHit && types[1] === 'arc' ? b : null),
			findLineNear: () => null,
			onEditDimension: (c: unknown) => {
				edited = c;
			},
		} as unknown as ToolContext;
		const event = (index?: number) =>
			({
				screen: viewport.worldToScreen(new Vec2(38, 48)),
				world: new Vec2(38, 48),
				client: new Vec2(38, 48),
				raw: {
					target: {
						closest: () =>
							index === undefined
								? null
								: {
										getAttribute: (attr: string) => (attr === 'data-id' ? [a, b][index].id : types[index]),
									},
					},
				},
			}) as unknown as ToolMouseEvent;
		const tool = new DimensionTool();
		tool.activate(ctx);
		tool.onMouseDown(event(0));
		assert.ok(tool.isHighlightEnabled());
		assert.ok(tool.canHighlight({ id: b.id, type: types[1] }));
		assert.equal(tool.canHighlight({ id: a.id, type: types[0] }), false);
		secondHit = true;
		tool.onMouseDown(event(1));
		assert.equal(sketch.selection.circleIds.size + sketch.selection.arcIds.size, 2);
		assert.equal(tool.isHighlightEnabled(), false);
		assert.equal(
			[...sketch.constraints.values()].some(c => c instanceof DistanceConstraint),
			false
		);
		secondHit = false;
		tool.onMouseDown(event());
		assert.ok(edited instanceof DistanceConstraint);
		assert.deepEqual(edited.circleIds, [a.id, b.id]);
		sketch.selectEntity(a.id, types[0], false);
		sketch.selectEntity(b.id, types[1], true);
		tool.activate(ctx);
		assert.equal(tool.isHighlightEnabled(), false);
		tool.onMouseDown(event());
		assert.equal([...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint).length, 1);
	});
}

test('radial label keeps its signed offset from the outer perimeter when the gap changes after reload', () => {
	for (const offset of [-3, 12]) {
		const { sketch, center, inner, outer } = scene();
		sketch.addRadiusConstraint(inner.id, 10, 'radius');
		const gap = sketch.addCircleDistanceConstraint(outer.id, inner.id)!;
		const viewport = new Viewport(800, 600);
		gap.moveLabelTo(viewport.worldToScreen(new Vec2(center.x, center.y + outer.radius + offset)), sketch, viewport);
		const restored = deserializeConstraint(serializeConstraint(gap)) as DistanceConstraint;
		sketch.constraints.set(gap.id, restored);
		for (const distance of [20, 8]) {
			sketch.addCircleDistanceConstraint(inner.id, outer.id, distance);
			const anchor = restored.getLabelScreenPos(sketch, viewport)!;
			assert.ok(Math.abs(viewport.screenToWorld(anchor).distanceTo(center) - outer.radius - offset) < 1e-7);
			assert.equal(restored.leaderOffset, offset);
			assert.ok(restored.distanceTo(anchor, sketch, viewport)! < 1e-7);
		}
	}
});

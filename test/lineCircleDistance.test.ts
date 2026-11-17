import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { PointToLineDistanceConstraint, DistanceConstraint } from '../src/solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../src/canvas/tools/types';

function scene(type: 'circle' | 'arc') {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(30, 40));
	const a = sketch.addPoint(new Vec2(0, 10), true);
	const b = sketch.addPoint(new Vec2(100, 10), true);
	const line = sketch.addLine(a.id, b.id);
	const radial =
		type === 'circle'
			? sketch.addCircle(center.id, 10)
			: sketch.addArc(center.id, sketch.addPoint(new Vec2(40, 40)).id, sketch.addPoint(new Vec2(30, 50)).id, 10, false);
	return { sketch, center, radial, line };
}

for (const type of ['circle', 'arc'] as const) {
	for (const axis of [false, true]) {
		test(`line/${type} selection constrains center distance (axis=${axis})`, () => {
			const { sketch, center, radial, line } = scene(type);
			const lineId = axis ? 'axis_x' : line.id;
			sketch.selectEntity(radial.id, type, false);
			sketch.selectEntity(lineId, 'line', true);
			ConstraintTool.pruneIncompatibleSelection(sketch, 'distance');
			assert.ok(ConstraintTool.canApplyConstraint(sketch, 'distance'));
			assert.ok(ConstraintTool.applyConstraintToSelection('distance', { sketch, showToast: () => {} }));
			const c = [...sketch.constraints.values()].find(
				c => c instanceof PointToLineDistanceConstraint || c instanceof DistanceConstraint
			)!;
			assert.equal((c as PointToLineDistanceConstraint | DistanceConstraint).targetDistance, axis ? 40 : 30);
			assert.ok(sketch.getConstraintsForEntity(type, radial.id).includes(c));
			assert.ok(sketch.getConstraintsForEntity('line', lineId).includes(c));
			assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === radial.id && e.type === type));
			const restored = deserializeConstraint(serializeConstraint(c))!;
			sketch.constraints.set(c.id, restored);
			assert.equal(sketch.addCircleToLineDistanceConstraint(radial.id, lineId, 20), restored);
			assert.ok(Math.abs(center.y - (axis ? 20 : 30)) < 1e-5);
			assert.ok(Math.abs(radial.radius - 10) < 1e-5);
		});
	}

	for (const radialFirst of [false, true]) {
		for (const existingRadius of [false, true]) {
			test(`dimension hover uses ${type} center (radial first=${radialFirst}, radius constraint=${existingRadius})`, () => {
				const { sketch, center, radial, line } = scene(type);
				if (existingRadius) sketch.addRadiusConstraint(radial.id, 10);
				const viewport = new Viewport(800, 600);
				let hovering = false;
				let preview: { center: Vec2; distance: number } | undefined;
				let edited: PointToLineDistanceConstraint | undefined;
				const ctx = {
					sketch,
					viewport,
					setCursor: () => {},
					showToast: () => {},
					requestRender: () => {},
					renderer: {
						clearPreviews: () => {},
						renderPointToLineDistancePreview: (p: Vec2, _a: Vec2, _b: Vec2, _s: Vec2, distance: number) => {
							preview = { center: p, distance };
						},
					},
					findPointNear: () => null,
					findSnap: () => null,
					findLineNear: () => (hovering && radialFirst ? line : null),
					findCircleNear: () => (hovering && !radialFirst && type === 'circle' ? radial : null),
					findArcNear: () => (hovering && !radialFirst && type === 'arc' ? radial : null),
					onEditDimension: (c: PointToLineDistanceConstraint) => {
						edited = c;
					},
				} as unknown as ToolContext;
				const event = (radialTarget: boolean) =>
					({
						screen: viewport.worldToScreen(radialTarget ? new Vec2(40, 40) : new Vec2(60, 10)),
						client: new Vec2(0, 0),
						world: new Vec2(40, 40),
						raw: {
							target: {
								closest: () => ({
									getAttribute: (attr: string) =>
										attr === 'data-id' ? (radialTarget ? radial.id : line.id) : radialTarget ? type : 'line',
								}),
							},
						},
					}) as unknown as ToolMouseEvent;
				const tool = new DimensionTool();
				tool.activate(ctx);
				tool.onMouseDown(event(radialFirst));
				hovering = true;
				const target = radialFirst ? { type: 'line' as const, id: line.id } : { type, id: radial.id };
				assert.ok(tool.isHighlightEnabled());
				assert.ok(tool.canHighlight(target));
				tool.renderPreview({
					sketch,
					viewport,
					cursorScreen: event(!radialFirst).screen,
					cursorWorld: new Vec2(40, 40),
				} as ToolRenderContext);
				assert.ok(preview);
				assert.ok(preview.center.distanceTo(viewport.worldToScreen(center)) < 1e-7);
				assert.equal(preview.distance, 30);
				tool.onMouseDown(event(!radialFirst));
				assert.equal(edited, undefined);
				assert.equal(sketch.hasPointToLineDistanceConstraint(center.id, line.id), false);
				assert.equal(tool.isHighlightEnabled(), false);
				const placement = { ...event(!radialFirst), screen: viewport.worldToScreen(new Vec2(65, 25)) };
				tool.onMouseDown(placement);
				assert.ok(edited instanceof PointToLineDistanceConstraint);
				assert.equal(edited.pointId, center.id);
				assert.equal(edited.lineId, line.id);
				assert.equal(edited.targetDistance, 30);
				assert.equal(edited.distanceTo(placement.screen, sketch, viewport), 0);
				assert.equal(sketch.hasDistanceConstraint(line.p1Id, line.p2Id), false);
				assert.equal(sketch.hasRadiusConstraint(radial.id), existingRadius);
			});
		}
	}
}

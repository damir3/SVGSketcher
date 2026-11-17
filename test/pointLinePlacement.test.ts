import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import { Viewport } from '../src/canvas/viewport';
import { CanvasInteraction } from '../src/canvas/interaction';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { DistanceConstraint, PointToLineDistanceConstraint } from '../src/solver/constraints';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../src/canvas/tools/types';

function setup(axis: boolean) {
	const sketch = new SketchDocument();
	const a = sketch.addPoint(new Vec2(0, 10), true);
	const b = sketch.addPoint(new Vec2(100, 10), true);
	const point = sketch.addPoint(new Vec2(30, 40));
	const line = sketch.addLine(a.id, b.id);
	const lineId = axis ? 'axis_x' : line.id;
	const viewport = new Viewport(800, 600);
	let edited: PointToLineDistanceConstraint | DistanceConstraint | undefined;
	let preview: Vec2 | undefined;
	const ctx = {
		sketch,
		viewport,
		setCursor: () => {},
		showToast: () => {},
		requestRender: () => {},
		renderer: {
			clearPreviews: () => {},
			renderPointToLineDistancePreview: (_p: Vec2, _a: Vec2, _b: Vec2, cursor: Vec2) => {
				preview = cursor;
			},
		},
		findPointNear: () => null,
		findLineNear: () => null,
		findCircleNear: () => null,
		findArcNear: () => null,
		findSnap: () => null,
		onEditDimension: (c: PointToLineDistanceConstraint | DistanceConstraint) => {
			edited = c;
		},
	} as unknown as ToolContext;
	const event = (id?: string, type?: string, world = new Vec2(65, 20)) =>
		({
			screen: viewport.worldToScreen(world),
			world,
			client: new Vec2(165, 120),
			raw: {
				target: { closest: () => (id ? { getAttribute: (attr: string) => (attr === 'data-id' ? id : type) } : null) },
			},
		}) as unknown as ToolMouseEvent;
	return { sketch, point, lineId, viewport, ctx, event, edited: () => edited, preview: () => preview };
}

for (const axis of [false, true]) {
	for (const pointFirst of [false, true]) {
		test(`point-line dimension waits for a separate placement click (axis=${axis}, point first=${pointFirst})`, () => {
			const f = setup(axis);
			const tool = new DimensionTool();
			tool.activate(f.ctx);
			const pointEvent = f.event(f.point.id, 'point');
			const lineEvent = f.event(f.lineId, 'line');
			tool.onMouseDown(pointFirst ? pointEvent : lineEvent);
			tool.onMouseDown(pointFirst ? lineEvent : pointEvent);
			assert.equal(f.sketch.constraints.size, 0);
			assert.equal(f.edited(), undefined);
			assert.equal(tool.isHighlightEnabled(), false);
			const placement = f.event(f.point.id, 'point');
			tool.renderPreview({
				sketch: f.sketch,
				viewport: f.viewport,
				cursorScreen: placement.screen,
			} as ToolRenderContext);
			assert.deepEqual(f.preview(), placement.screen);
			tool.onMouseDown(placement);
			const c = f.edited()!;
			assert.ok(c instanceof (axis ? DistanceConstraint : PointToLineDistanceConstraint));
			assert.equal(f.sketch.constraints.size, 1);
			assert.equal(c.targetDistance, axis ? 40 : 30);
			assert.ok(Math.abs(c.offset! - 35) < 1e-7);
			assert.ok(c.distanceTo(placement.screen, f.sketch, f.viewport)! < 1e-7);
			assert.equal(tool.state.step, 0);
		});
	}

	test(`preselected point-line pair enters placement and can be cancelled (axis=${axis})`, () => {
		const f = setup(axis);
		f.sketch.selectEntity(f.point.id, 'point', false);
		f.sketch.selectEntity(f.lineId, 'line', true);
		let targetTool: string | undefined;
		assert.ok(
			ConstraintTool.applyConstraintToSelection('distance', {
				sketch: f.sketch,
				showToast: () => {},
				setTool: tool => {
					targetTool = tool;
				},
			})
		);
		assert.equal(targetTool, 'dimension');
		assert.equal(f.sketch.constraints.size, 0);
		const tool = new DimensionTool();
		tool.activate(f.ctx);
		assert.equal(tool.state.step, 2);
		tool.cancel();
		assert.equal(f.sketch.constraints.size, 0);
		assert.equal(f.edited(), undefined);
	});
}

test('cancelling placement preserves an existing point-line constraint and its label', () => {
	const f = setup(false);
	const existing = f.sketch.addPointToLineDistanceConstraint(f.point.id, f.lineId, 30, 123)!;
	existing.labelPosition = 1.5;
	const tool = new DimensionTool();
	tool.activate(f.ctx);
	tool.onMouseDown(f.event(f.point.id, 'point'));
	tool.onMouseDown(f.event(f.lineId, 'line'));
	assert.equal(f.edited(), undefined);
	assert.equal(existing.offset, 123);
	assert.equal(existing.labelPosition, 1.5);
	tool.cancel();
	assert.equal(f.sketch.constraints.size, 1);
	assert.equal(existing.offset, 123);
	assert.equal(existing.labelPosition, 1.5);
});

test('switching from the distance command preserves the pair for label placement', () => {
	const f = setup(false);
	const command = new ConstraintTool('distance');
	command.activate(f.ctx);
	f.sketch.selectEntity(f.point.id, 'point', false);
	f.sketch.selectEntity(f.lineId, 'line', true);
	const dimension = new DimensionTool();
	const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
		sketch: f.sketch,
		viewport: f.viewport,
		activeTool: 'distance',
		activeToolInstance: command,
		tools: new Map([['dimension', dimension]]),
		highlightManager: { clear() {} },
		renderer: { updateRegionHover() {} },
		svg: { classList: { toggle() {} } },
		cancelDrawing() {},
		updateCursor() {},
		render() {},
		createToolContext: () => f.ctx,
	});
	interaction.setTool('dimension');
	assert.equal(dimension.state.step, 2);
	assert.equal(dimension.state.point1Id, f.point.id);
	assert.equal(dimension.state.line1Id, f.lineId);
	assert.equal(f.sketch.constraints.size, 0);
});

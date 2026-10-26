import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { CircleTool } from '../src/canvas/tools/primitives/circle';
import { RectangleTool } from '../src/canvas/tools/primitives/rectangle';
import { ArcCenterTool } from '../src/canvas/tools/primitives/arcCenter';
import { EllipseTool } from '../src/canvas/tools/primitives/ellipse';
import { SplineTool } from '../src/canvas/tools/primitives/spline';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import { vec } from '../src/math/vector';

function createMockContext(sketch: SketchDocument): { ctx: ToolContext; isConstruction: { value: boolean } } {
	const isConstruction = { value: false };
	const ctx: ToolContext = {
		sketch,
		viewport: {
			zoom: 1,
			panX: 0,
			panY: 0,
			worldToScreen: (x: number, y: number) => ({ x, y }),
			screenToWorld: (x: number, y: number) => ({ x, y }),
		} as any,
		renderer: {
			renderLinePreview: () => {},
			renderCirclePreview: () => {},
			renderArcPreview: () => {},
			renderEllipsePreview: () => {},
			renderRectanglePreview: () => {},
			renderSplinePreview: () => ({ checkmarkPos: undefined }),
			clearPreviews: () => {},
		} as any,
		svg: {} as any,
		get isConstructionMode() {
			return isConstruction.value;
		},
		requestRender: () => {},
		setTool: () => {},
		setCursor: () => {},
		showToast: () => {},
		findSnap: () => null,
		findPointNear: () => null,
		findLineNear: () => null,
		findCircleNear: () => null,
		findArcNear: () => null,
		findEllipseNear: () => null,
		findEllipticalArcNear: () => null,
		findSplineNear: () => null,
		toGeoCurve: () => null,
		findTrimTarget: () => null,
		get isSnapModifierPressed() {
			return false;
		},
	};
	return { ctx, isConstruction };
}

function makeMouseEvent(worldX: number, worldY: number): ToolMouseEvent {
	return {
		raw: {} as MouseEvent,
		screen: vec(worldX, worldY),
		client: vec(worldX, worldY),
		world: vec(worldX, worldY),
		snap: null,
		effectiveWorld: vec(worldX, worldY),
		effectiveScreen: vec(worldX, worldY),
	};
}

describe('Primitive Tools Creation', () => {
	it('LineTool creates lines and does not throw stack overflow on isConstructionMode', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const lineTool = new LineTool();
		lineTool.activate(ctx);

		// First click - start point
		lineTool.onMouseDown(makeMouseEvent(10, 20));
		assert.equal(sketch.points.size, 1);
		assert.equal(sketch.lines.size, 0);

		// Move mouse
		lineTool.onMouseMove(makeMouseEvent(100, 20));

		// Second click - end point & line
		lineTool.onMouseDown(makeMouseEvent(100, 20));
		assert.equal(sketch.lines.size, 1);
		assert.equal(sketch.points.size, 2);
	});

	it('CircleTool creates circle and center point', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const circleTool = new CircleTool();
		circleTool.activate(ctx);

		// First click - center point
		circleTool.onMouseDown(makeMouseEvent(50, 50));
		assert.equal(sketch.points.size, 1);
		assert.equal(sketch.circles.size, 0);

		// Move mouse
		circleTool.onMouseMove(makeMouseEvent(80, 50));

		// Second click - radius
		circleTool.onMouseDown(makeMouseEvent(80, 50));
		assert.equal(sketch.circles.size, 1);
		const c = Array.from(sketch.circles.values())[0];
		assert.equal(c.radius, 30);
	});

	it('RectangleTool creates 4 points and 4 lines', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool();
		rectTool.activate(ctx);

		rectTool.onMouseDown(makeMouseEvent(0, 0));
		rectTool.onMouseMove(makeMouseEvent(100, 50));
		rectTool.onMouseDown(makeMouseEvent(100, 50));

		assert.equal(sketch.points.size, 4);
		assert.equal(sketch.lines.size, 4);
	});

	it('ArcCenterTool creates centerpoint arc', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcCenterTool();
		arcTool.activate(ctx);

		// Click 1: center
		arcTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(sketch.points.size, 1);

		// Click 2: start point
		arcTool.onMouseDown(makeMouseEvent(50, 0));
		assert.equal(sketch.points.size, 2);

		// Move and click 3: end point
		arcTool.onMouseMove(makeMouseEvent(0, 50));
		arcTool.onMouseDown(makeMouseEvent(0, 50));

		assert.equal(sketch.arcs.size, 1);
		assert.equal(sketch.points.size, 3);
	});

	it('EllipseTool creates ellipse', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const ellipseTool = new EllipseTool();
		ellipseTool.activate(ctx);

		ellipseTool.onMouseDown(makeMouseEvent(0, 0));
		ellipseTool.onMouseDown(makeMouseEvent(40, 0));
		ellipseTool.onMouseMove(makeMouseEvent(0, 20));
		ellipseTool.onMouseDown(makeMouseEvent(0, 20));

		assert.equal(sketch.ellipses.size, 1);
		assert.equal(sketch.points.size, 3);
	});

	it('SplineTool creates fit and control splines', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const splineTool = new SplineTool('fit');
		splineTool.activate(ctx);

		splineTool.onMouseDown(makeMouseEvent(0, 0));
		splineTool.onMouseDown(makeMouseEvent(50, 50));
		splineTool.onMouseDown(makeMouseEvent(100, 0));
		splineTool.finishSpline(false);

		assert.equal(sketch.splines.size, 1);
	});
});

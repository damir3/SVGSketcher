import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { CircleTool } from '../src/canvas/tools/primitives/circle';
import { RectangleTool } from '../src/canvas/tools/primitives/rectangle';
import { ArcTool } from '../src/canvas/tools/primitives/arc';
import { ArcCenterTool } from '../src/canvas/tools/primitives/arcCenter';
import { EllipseTool } from '../src/canvas/tools/primitives/ellipse';
import { SplineTool } from '../src/canvas/tools/primitives/spline';
import { TrimTool } from '../src/canvas/tools/modify/trim';
import { TangentLineCircleConstraint, TangentCircleCircleConstraint } from '../src/solver/constraints';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import { vec, type Vec2 } from '../src/math/vector';

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
		findPointNear: (screen: Vec2, threshold = 16) => {
			for (const p of sketch.points.values()) {
				if (Math.hypot(screen.x - p.x, screen.y - p.y) <= threshold) {
					return p;
				}
			}
			return null;
		},
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

function makeMouseEvent(worldX: number, worldY: number, snap: any = null): ToolMouseEvent {
	return {
		raw: {} as MouseEvent,
		screen: vec(worldX, worldY),
		client: vec(worldX, worldY),
		world: vec(worldX, worldY),
		snap,
		effectiveWorld: snap ? snap.worldPos : vec(worldX, worldY),
		effectiveScreen: snap ? snap.screenPos : vec(worldX, worldY),
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

	it('renderPreview calls preview visual rendering on targetGroup', () => {
		const createdElements: any[] = [];
		const origDoc = (globalThis as any).document;
		(globalThis as any).document = {
			createElementNS: (_ns: string, tag: string) => {
				const el = { tag, setAttribute: () => {}, style: {}, appendChild: () => {} };
				return el;
			},
		};

		try {
			const sketch = new SketchDocument();
			const { ctx } = createMockContext(sketch);
			const lineTool = new LineTool();
			lineTool.activate(ctx);
			lineTool.onMouseDown(makeMouseEvent(10, 20));

			const targetGroup = { appendChild: (el: any) => createdElements.push(el) } as any;
			lineTool.renderPreview({
				viewport: ctx.viewport,
				sketch,
				targetGroup,
				cursorScreen: vec(100, 20),
				cursorWorld: vec(100, 20),
				snap: null,
				isConstruction: false,
			});

			assert.ok(createdElements.length > 0);
		} finally {
			(globalThis as any).document = origDoc;
		}
	});

	it('TrimTool renderPreview renders preview before trim and clears preview after trim at same cursor', () => {
		const createdElements: any[] = [];
		const origDoc = (globalThis as any).document;
		(globalThis as any).document = {
			createElementNS: (_ns: string, tag: string) => {
				const el = { tag, setAttribute: () => {}, style: {}, appendChild: () => {} };
				return el;
			},
		};

		try {
			const sketch = new SketchDocument();
			// Create cross: line1 horizontal (0, 50)-(100, 50), line2 vertical (50, 0)-(50, 100)
			const p1 = sketch.addPoint(0, 50);
			const p2 = sketch.addPoint(100, 50);
			sketch.addLine(p1.id, p2.id);

			const p3 = sketch.addPoint(50, 0);
			const p4 = sketch.addPoint(50, 100);
			sketch.addLine(p3.id, p4.id);

			const { ctx } = createMockContext(sketch);
			ctx.findTrimTarget = (screen: Vec2) => {
				for (const line of sketch.lines.values()) {
					const pt1 = sketch.points.get(line.p1Id)!;
					const pt2 = sketch.points.get(line.p2Id)!;
					if (Math.abs(screen.y - 50) < 5 && screen.x >= Math.min(pt1.x, pt2.x) && screen.x <= Math.max(pt1.x, pt2.x)) {
						return line.toGeoCurve(sketch);
					}
				}
				return null;
			};

			const trimTool = new TrimTool();
			trimTool.activate(ctx);

			const targetGroup = {
				elements: [] as any[],
				appendChild(el: any) { this.elements.push(el); },
				clear() { this.elements = []; },
			};

			// Before trim at (20, 50): preview renders candidate
			trimTool.renderPreview({
				viewport: ctx.viewport,
				sketch,
				targetGroup: targetGroup as any,
				cursorScreen: vec(20, 50),
				cursorWorld: vec(20, 50),
				snap: null,
				isConstruction: false,
			});
			assert.ok(targetGroup.elements.length > 0, 'Preview should render before trim');

			// Apply trim at (20, 50)
			trimTool.onMouseDown(makeMouseEvent(20, 50));

			// After trim at same cursor (20, 50), targetGroup is cleared and renderPreview called again
			targetGroup.clear();
			trimTool.renderPreview({
				viewport: ctx.viewport,
				sketch,
				targetGroup: targetGroup as any,
				cursorScreen: vec(20, 50),
				cursorWorld: vec(20, 50),
				snap: null,
				isConstruction: false,
			});
			assert.equal(targetGroup.elements.length, 0, 'Preview should be empty after trimmed segment is removed');
		} finally {
			(globalThis as any).document = origDoc;
		}
	});

	it('ArcTool defaults to center mode', () => {
		const arcTool = new ArcTool();
		assert.equal(arcTool.mode, 'center');
	});

	it('ArcTool creates 3-point arc in three_point mode', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('three_point');
		arcTool.activate(ctx);

		assert.equal(arcTool.mode, 'three_point');

		// Click 1: start point (0, 0)
		arcTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(sketch.points.size, 1);
		assert.equal(arcTool.step, 1);

		// Click 2: end point (100, 0)
		arcTool.onMouseDown(makeMouseEvent(100, 0));
		assert.equal(sketch.points.size, 2);
		assert.equal(arcTool.step, 2);

		// Click 3: bulge point (50, 50)
		arcTool.onMouseDown(makeMouseEvent(50, 50));
		assert.equal(sketch.arcs.size, 1);
		assert.equal(sketch.points.size, 3);
		assert.equal(arcTool.step, 0);

		const arc = Array.from(sketch.arcs.values())[0];
		assert.equal(arc.startPointId, Array.from(sketch.points.keys())[0]);
		assert.equal(arc.endPointId, Array.from(sketch.points.keys())[1]);
	});

	it('ArcTool creates tangent arc connected to line and applies tangent constraint', () => {
		const sketch = new SketchDocument();
		// Add horizontal line from (0, 0) to (50, 0)
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 0);
		sketch.addLine(p1.id, p2.id);

		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('tangent');
		arcTool.activate(ctx);

		// Click 1 on line endpoint p2 (50, 0)
		const snapP2 = { type: 'point', id: p2.id, worldPos: vec(50, 0), screenPos: vec(50, 0) };
		arcTool.onMouseDown(makeMouseEvent(50, 0, snapP2));
		assert.equal(arcTool.step, 1);

		// Click 2 to create tangent arc ending at (80, 30)
		arcTool.onMouseDown(makeMouseEvent(80, 30));
		assert.equal(sketch.arcs.size, 1);
		assert.equal(arcTool.step, 0);

		const arc = Array.from(sketch.arcs.values())[0];
		assert.equal(arc.startPointId, p2.id);

		// Verify TangentLineCircleConstraint was applied
		const tangConstraint = Array.from(sketch.constraints.values()).find(
			c => c instanceof TangentLineCircleConstraint
		) as TangentLineCircleConstraint | undefined;
		assert.ok(tangConstraint, 'TangentLineCircleConstraint must be applied between line and arc');
		assert.equal(tangConstraint.circleId, arc.id);
		assert.equal(tangConstraint.circleCenterId, arc.centerId);

		// Verify sketch solves cleanly with tangency
		sketch.solve();
		assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
	});

	it('ArcTool creates tangent arc connected to another arc and applies tangent constraint', () => {
		const sketch = new SketchDocument();
		// Add first arc centered at (0, 0) with radius 50 from (50, 0) to (0, 50)
		const cPt = sketch.addPoint(0, 0);
		const sPt = sketch.addPoint(50, 0);
		const ePt = sketch.addPoint(0, 50);
		sketch.addArc(cPt.id, sPt.id, ePt.id, 50, false);

		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('tangent');
		arcTool.activate(ctx);

		// Click 1 on arc1 endpoint ePt (0, 50)
		const snapEPt = { type: 'point', id: ePt.id, worldPos: vec(0, 50), screenPos: vec(0, 50) };
		arcTool.onMouseDown(makeMouseEvent(0, 50, snapEPt));
		assert.equal(arcTool.step, 1);

		// Click 2 to create tangent arc ending at (-30, 80)
		arcTool.onMouseDown(makeMouseEvent(-30, 80));
		assert.equal(sketch.arcs.size, 2);
		assert.equal(arcTool.step, 0);

		// Verify TangentCircleCircleConstraint was applied
		const tangConstraint = Array.from(sketch.constraints.values()).find(
			c => c instanceof TangentCircleCircleConstraint
		) as TangentCircleCircleConstraint | undefined;
		assert.ok(tangConstraint, 'TangentCircleCircleConstraint must be applied between the two arcs');
	});

	it('ArcTool creates tangent arc with sweep angle > 180 degrees without flipping sides', () => {
		const sketch = new SketchDocument();
		// Horizontal line from (0, 0) to (50, 0)
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 0);
		sketch.addLine(p1.id, p2.id);

		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('tangent');
		arcTool.activate(ctx);

		// Click 1 on line endpoint p2 (50, 0), tangentDir is (1, 0)
		const snapP2 = { type: 'point', id: p2.id, worldPos: vec(50, 0), screenPos: vec(50, 0) };
		arcTool.onMouseDown(makeMouseEvent(50, 0, snapP2));
		assert.equal(arcTool.step, 1);

		// Click 2 at (20, -30) - this is behind p2.x (20 < 50), creating an arc with sweep angle ~270 deg
		arcTool.onMouseDown(makeMouseEvent(20, -30));
		assert.equal(sketch.arcs.size, 1);
		assert.equal(arcTool.step, 0);

		const arc = Array.from(sketch.arcs.values())[0];
		assert.equal(arc.startPointId, p2.id);

		const centerPt = sketch.points.get(arc.centerId)!;
		assert.ok(Math.abs(centerPt.x - 50) < 1e-3, 'Center X must match tangent start X');
		assert.ok(Math.abs(centerPt.y - (-30)) < 1e-3, 'Center Y must be -30');
		const endPt = sketch.points.get(arc.endPointId)!;
		assert.ok(Math.abs(endPt.x - 20) < 1e-3, 'End point X must be 20');
		assert.ok(Math.abs(endPt.y - (-30)) < 1e-3, 'End point Y must be -30');

		sketch.solve();
		assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
	});

	it('ArcTool setMode switches mode, cancels active steps and fires onStateChange', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('three_point');
		arcTool.activate(ctx);

		let stateChangeCount = 0;
		arcTool.onStateChange = () => {
			stateChangeCount++;
		};

		// Step 1
		arcTool.onMouseDown(makeMouseEvent(10, 10));
		assert.equal(arcTool.step, 1);

		// Switch mode to 'center'
		arcTool.setMode('center');
		assert.equal(arcTool.mode, 'center');
		assert.equal(arcTool.step, 0, 'Switching mode must cancel pending steps');
		assert.ok(stateChangeCount > 0, 'onStateChange must be called on mode switch');
	});

	it('ArcTool triggers onModeChange when switching arc modes', () => {
		const arcTool = new ArcTool('center');
		const modeEvents: string[] = [];
		arcTool.onModeChange = mode => {
			modeEvents.push(mode);
		};

		arcTool.setMode('three_point');
		arcTool.setMode('tangent');
		arcTool.setMode('center');

		assert.deepEqual(modeEvents, ['three_point', 'tangent', 'center']);
	});
});

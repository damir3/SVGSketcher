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
import { CanvasInteraction } from '../src/canvas/interaction';
import { TrimTool } from '../src/canvas/tools/modify/trim';
import {
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	MidpointConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	EqualLengthConstraint,
	EqualRadiusConstraint,
	RadiusConstraint,
	DistanceConstraint,
	CoincidentConstraint,
	PointOnLineConstraint,
} from '../src/solver/constraints';
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
			renderSnapIndicator: () => {},
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
		applySnapConstraintIfNeeded: (pointId: string, snap: any) => {
			if (!snap) return;
			if (snap.type === 'point' && snap.id && snap.id !== pointId) {
				sketch.addCoincidentConstraint(pointId, snap.id);
			} else if (snap.type === 'line' && snap.lineId) {
				sketch.addPointOnLineConstraint(pointId, snap.lineId);
			} else if (snap.type === 'circle' && snap.circleId) {
				sketch.addPointOnCircleConstraint(pointId, snap.circleId);
			}
		},
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

	it('RectangleTool defaults to corner mode and creates 4 points and 4 lines', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool();
		rectTool.activate(ctx);

		assert.equal(rectTool.mode, 'corner');

		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);
		rectTool.onMouseMove(makeMouseEvent(100, 50));
		rectTool.onMouseDown(makeMouseEvent(100, 50));

		assert.equal(sketch.points.size, 4);
		assert.equal(sketch.lines.size, 4);
		assert.equal(rectTool.step, 0);
	});

	it('RectangleTool creates Center Rectangle with center point, diagonals, and midpoint constraint', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('center');
		rectTool.activate(ctx);

		// Click 1: center
		rectTool.onMouseDown(makeMouseEvent(50, 50));
		assert.equal(rectTool.step, 1);

		// Click 2: corner
		rectTool.onMouseMove(makeMouseEvent(100, 80));
		rectTool.onMouseDown(makeMouseEvent(100, 80));

		// 1 center point + 4 corners = 5 points
		assert.equal(sketch.points.size, 5);
		// 4 perimeter lines + 2 diagonal construction lines = 6 lines
		assert.equal(sketch.lines.size, 6);

		const midpointConstraints = [...sketch.constraints.values()].filter(c => c instanceof MidpointConstraint);
		assert.equal(midpointConstraints.length, 1);
	});

	it('RectangleTool creates 3-Point Rectangle with parallel and perpendicular constraints', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('three_point');
		rectTool.activate(ctx);

		// Click 1: P1
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);

		// Click 2: P2 (base line)
		rectTool.onMouseMove(makeMouseEvent(40, 30));
		rectTool.onMouseDown(makeMouseEvent(40, 30));
		assert.equal(rectTool.step, 2);

		// Click 3: P3 (height)
		rectTool.onMouseMove(makeMouseEvent(10, 70));
		rectTool.onMouseDown(makeMouseEvent(10, 70));

		assert.equal(sketch.points.size, 4);
		assert.equal(sketch.lines.size, 4);

		const parallelConstraints = [...sketch.constraints.values()].filter(c => c instanceof ParallelConstraint);
		const perpConstraints = [...sketch.constraints.values()].filter(c => c instanceof PerpendicularConstraint);
		const equalConstraints = [...sketch.constraints.values()].filter(c => c instanceof EqualLengthConstraint);

		assert.equal(parallelConstraints.length, 2);
		assert.equal(perpConstraints.length, 1);
		assert.equal(equalConstraints.length, 1);
	});

	it('RectangleTool creates Rounded Rectangle with lines, corner arcs and tangent constraints', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('rounded');
		rectTool.activate(ctx);

		// Click 1: corner 1
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);

		// Click 2: corner 2
		rectTool.onMouseMove(makeMouseEvent(100, 60));
		rectTool.onMouseDown(makeMouseEvent(100, 60));
		assert.equal(rectTool.step, 2);

		// Click 3: radius
		rectTool.onMouseMove(makeMouseEvent(90, 50));
		rectTool.onMouseDown(makeMouseEvent(90, 50));

		// 4 straight lines + 4 corner arcs = 8 primitives
		assert.equal(sketch.lines.size, 4);
		assert.equal(sketch.arcs.size, 4);

		const tangentConstraints = [...sketch.constraints.values()].filter(c => c instanceof TangentLineCircleConstraint);
		const equalRadiusConstraints = [...sketch.constraints.values()].filter(c => c instanceof EqualRadiusConstraint);

		// 8 tangents (2 per arc)
		assert.equal(tangentConstraints.length, 8);
		// 3 equal radius constraints
		assert.equal(equalRadiusConstraints.length, 3);
	});

	it('RectangleTool creates DistanceConstraints when width and height are locked', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('corner');
		rectTool.activate(ctx);

		rectTool.onMouseDown(makeMouseEvent(0, 0));
		// Lock dimensions
		rectTool.isWidthLocked = true;
		rectTool.width = 120;
		rectTool.isHeightLocked = true;
		rectTool.height = 70;

		rectTool.onMouseMove(makeMouseEvent(50, 40));
		rectTool.onMouseDown(makeMouseEvent(50, 40));

		const distConstraints = [...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint);
		assert.equal(distConstraints.length, 2);

		const widthConstraint = distConstraints.find(c => c.targetDistance === 120);
		const heightConstraint = distConstraints.find(c => c.targetDistance === 70);
		assert.ok(widthConstraint, 'Width distance constraint was added');
		assert.ok(heightConstraint, 'Height distance constraint was added');
		assert.equal(widthConstraint?.orientation, 'aligned');
		assert.equal(heightConstraint?.orientation, 'aligned');
	});

	it('RectangleTool creates RadiusConstraint when radius is locked in rounded mode', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('rounded');
		rectTool.activate(ctx);

		rectTool.onMouseDown(makeMouseEvent(0, 0));
		rectTool.isRadiusLocked = true;
		rectTool.radius = 8.5;

		// When radius is locked, click 2 immediately commits!
		rectTool.onMouseMove(makeMouseEvent(100, 60));
		rectTool.onMouseDown(makeMouseEvent(100, 60));

		assert.equal(sketch.arcs.size, 4);
		const radiusConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(radiusConstraints.length, 1);
		assert.equal(radiusConstraints[0].targetRadius, 8.5);
	});

	it('RectangleTool rounded mode sets radius = 0 and commits regular 2-point rectangle when cursor is pulled outside bounds', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('rounded');
		rectTool.activate(ctx);

		// Click 1: corner 1
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);

		// Click 2: corner 2
		rectTool.onMouseMove(makeMouseEvent(100, 60));
		rectTool.onMouseDown(makeMouseEvent(100, 60));
		assert.equal(rectTool.step, 2);

		// Move outside bounds (x > 100 or y > 60 or outside box)
		rectTool.onMouseMove(makeMouseEvent(120, 80));
		assert.equal(rectTool.radius, 0);

		// Click 3 commits with radius = 0 -> should fall back to regular 2-point rectangle
		rectTool.onMouseDown(makeMouseEvent(120, 80));
		assert.equal(rectTool.step, 0);

		// Regular rectangle has 4 points, 4 lines, and 0 arcs
		assert.equal(sketch.points.size, 4);
		assert.equal(sketch.lines.size, 4);
		assert.equal(sketch.arcs.size, 0);
	});

	it('RectangleTool rounded mode pulls radius inward from second corner', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('rounded');
		rectTool.activate(ctx);

		// Click 1: corner 1 (0, 0)
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);

		// Click 2: corner 2 (100, 60)
		rectTool.onMouseMove(makeMouseEvent(100, 60));
		rectTool.onMouseDown(makeMouseEvent(100, 60));
		assert.equal(rectTool.step, 2);

		// Move inward from (100, 60) towards (0, 0): e.g. (90, 48)
		// inward pull delta X = 100 - 90 = 10, Y = 60 - 48 = 12 -> radius = min(10, 12) = 10
		rectTool.onMouseMove(makeMouseEvent(90, 48));
		assert.equal(rectTool.radius, 10);

		// Click 3 commits rounded rectangle
		rectTool.onMouseDown(makeMouseEvent(90, 48));
		assert.equal(rectTool.step, 0);

		// Rounded rectangle has 4 straight lines and 4 arcs
		assert.equal(sketch.lines.size, 4);
		assert.equal(sketch.arcs.size, 4);
	});

	it('RectangleTool applies coincident and point-on-line constraints when corners snap to point and line', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);

		// Pre-create an anchor point and an anchor line
		const existingPt = sketch.addPoint(0, 0);
		const pLineA = sketch.addPoint(50, 0);
		const pLineB = sketch.addPoint(50, 100);
		const existingLine = sketch.addLine(pLineA.id, pLineB.id);

		const rectTool = new RectangleTool('corner');
		rectTool.activate(ctx);

		// Click 1: snapped to existingPt
		const snap1 = {
			type: 'point' as const,
			id: existingPt.id,
			worldPos: vec(0, 0),
			screenPos: vec(0, 0),
		};
		rectTool.onMouseDown(makeMouseEvent(0, 0, snap1));
		assert.equal(rectTool.step, 1);

		// Click 2: snapped to existingLine at (50, 40)
		const snap2 = {
			type: 'line' as const,
			lineId: existingLine.id,
			worldPos: vec(50, 40),
			screenPos: vec(50, 40),
		};
		rectTool.onMouseMove(makeMouseEvent(50, 40, snap2));
		rectTool.onMouseDown(makeMouseEvent(50, 40, snap2));
		assert.equal(rectTool.step, 0);

		// Check constraints created
		const coincidents = [...sketch.constraints.values()].filter(c => c instanceof CoincidentConstraint);
		const pointOnLines = [...sketch.constraints.values()].filter(c => c instanceof PointOnLineConstraint);

		assert.equal(coincidents.length, 1, 'Coincident constraint was applied to corner 1');
		assert.equal(pointOnLines.length, 1, 'PointOnLine constraint was applied to corner 2');
	});

	it('RectangleTool renderPreview renders preview rect without tooltip elements', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('corner');
		rectTool.activate(ctx);
		rectTool.onMouseDown(makeMouseEvent(10, 20));

		const createdElements: any[] = [];
		const origDoc = (globalThis as any).document;
		(globalThis as any).document = {
			...origDoc,
			createElementNS: (_ns: string, tag: string) => {
				const el = { tag, setAttribute: () => {}, style: {}, appendChild: () => {}, textContent: '' };
				return el;
			},
		};

		try {
			const targetGroup = { appendChild: (el: any) => createdElements.push(el) } as any;
			rectTool.renderPreview({
				viewport: ctx.viewport,
				sketch,
				targetGroup,
				cursorScreen: vec(100, 80),
				cursorWorld: vec(100, 80),
				snap: null,
				isConstruction: false,
			});

			assert.ok(createdElements.length > 0);
			const textEls = createdElements.filter(el => el.tag === 'text');
			assert.equal(textEls.length, 0, 'No tooltip text elements created in renderPreview');
		} finally {
			(globalThis as any).document = origDoc;
		}
	});

	it('RectangleTool setMode switches modes and fires onModeChange', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool();
		rectTool.activate(ctx);

		let changedMode: string | null = null;
		rectTool.onModeChange = mode => {
			changedMode = mode;
		};

		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.isBusy(), true);

		rectTool.setMode('three_point');
		assert.equal(changedMode, 'three_point');
		assert.equal(rectTool.mode, 'three_point');
		// Switching mode should cancel active step
		assert.equal(rectTool.isBusy(), false);
	});

	it('RectangleTool onKeyDown handles Tab and Enter during drawing', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('corner');
		rectTool.activate(ctx);

		// Before click, Tab does not handle
		let prevented = false;
		const tabBefore = {
			key: 'Tab',
			shiftKey: false,
			preventDefault: () => { prevented = true; },
		} as unknown as KeyboardEvent;
		assert.equal(rectTool.onKeyDown(tabBefore), undefined);
		assert.equal(prevented, false);

		// Start drawing
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(rectTool.step, 1);

		// Tab during drawing step 1 handles and calls preventDefault
		let tabPrevented = false;
		const tabDuring = {
			key: 'Tab',
			shiftKey: false,
			preventDefault: () => { tabPrevented = true; },
		} as unknown as KeyboardEvent;
		const tabHandled = rectTool.onKeyDown(tabDuring);
		assert.equal(tabHandled, true);
		assert.equal(tabPrevented, true);

		// Enter during drawing commits rectangle
		rectTool.width = 150;
		rectTool.height = 90;
		let enterPrevented = false;
		const enterEvent = {
			key: 'Enter',
			preventDefault: () => { enterPrevented = true; },
		} as unknown as KeyboardEvent;
		const enterHandled = rectTool.onKeyDown(enterEvent);
		assert.equal(enterHandled, true);
		assert.equal(enterPrevented, true);
		assert.equal(rectTool.step, 0);
		assert.equal(sketch.lines.size, 4);
	});

	it('RectangleTool resets locked dimensions so next rectangle moves freely with mouse', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const rectTool = new RectangleTool('corner');
		rectTool.activate(ctx);

		// 1. First rectangle with locked dimensions
		rectTool.onMouseDown(makeMouseEvent(0, 0));
		rectTool.isWidthLocked = true;
		rectTool.width = 200;
		rectTool.isHeightLocked = true;
		rectTool.height = 100;
		rectTool.onMouseDown(makeMouseEvent(200, 100)); // commit

		assert.equal(rectTool.step, 0);
		assert.equal(rectTool.isWidthLocked, false, 'Width lock was reset after commit');
		assert.equal(rectTool.isHeightLocked, false, 'Height lock was reset after commit');

		// 2. Second rectangle should NOT be locked and follow mouse
		rectTool.onMouseDown(makeMouseEvent(10, 10));
		assert.equal(rectTool.step, 1);
		assert.equal(rectTool.isWidthLocked, false, 'Width lock is false at step 1');
		assert.equal(rectTool.isHeightLocked, false, 'Height lock is false at step 1');

		rectTool.onMouseMove(makeMouseEvent(60, 40));
		assert.equal(rectTool.width, 50, 'Width updated dynamically with mouse delta');
		assert.equal(rectTool.height, 30, 'Height updated dynamically with mouse delta');

		rectTool.onMouseDown(makeMouseEvent(60, 40)); // commit second rectangle
		assert.equal(rectTool.step, 0);
		assert.equal(sketch.lines.size, 8);
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

	it('CanvasInteraction handleKeyDown switches Rectangle modes with Alt+1..4', () => {
		const switchedModes: string[] = [];
		let prevented = 0;
		const fakeInteraction = {
			isMac: false,
			activeTool: 'rectangle',
			setRectangleMode: (mode: string) => {
				switchedModes.push(mode);
			},
			setArcMode: (_mode: string) => {},
		};

		const makeAltKey = (code: string, key: string) => ({
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			code,
			key,
			preventDefault: () => {
				prevented++;
			},
		} as any);

		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit1', '1'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit2', '2'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit3', '3'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit4', '4'));

		assert.deepEqual(switchedModes, ['corner', 'center', 'three_point', 'rounded']);
		assert.equal(prevented, 4);
	});

	it('CanvasInteraction handleKeyDown switches Arc modes with Alt+1..3', () => {
		const switchedModes: string[] = [];
		let prevented = 0;
		const fakeInteraction = {
			isMac: false,
			activeTool: 'arc',
			setRectangleMode: (_mode: string) => {},
			setArcMode: (mode: string) => {
				switchedModes.push(mode);
			},
		};

		const makeAltKey = (code: string, key: string) => ({
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			code,
			key,
			preventDefault: () => {
				prevented++;
			},
		} as any);

		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit1', '1'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit2', '2'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit3', '3'));

		assert.deepEqual(switchedModes, ['center', 'three_point', 'tangent']);
		assert.equal(prevented, 3);
	});

	it('CanvasInteraction handleKeyDown works on macOS Option key with special characters', () => {
		const switchedModes: string[] = [];
		const fakeInteraction = {
			isMac: true,
			activeTool: 'rectangle',
			setRectangleMode: (mode: string) => {
				switchedModes.push(mode);
			},
			setArcMode: (_mode: string) => {},
		};

		// On macOS, Option+1..4 produces characters like ¡, ™, £, ¢ while code is Digit1..4
		const makeMacOptionKey = (code: string, key: string) => ({
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			code,
			key,
			preventDefault: () => {},
		} as any);

		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeMacOptionKey('Digit1', '¡'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeMacOptionKey('Digit2', '™'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeMacOptionKey('Digit3', '£'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeMacOptionKey('Digit4', '¢'));

		assert.deepEqual(switchedModes, ['corner', 'center', 'three_point', 'rounded']);
	});
});


import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { CircleTool } from '../src/canvas/tools/primitives/circle';
import { RectangleTool } from '../src/canvas/tools/primitives/rectangle';
import { SlotTool } from '../src/canvas/tools/primitives/slot';
import { ArcTool } from '../src/canvas/tools/primitives/arc';
import { EllipseTool } from '../src/canvas/tools/primitives/ellipse';
import { SplineTool } from '../src/canvas/tools/primitives/spline';
import { CanvasInteraction } from '../src/canvas/interaction';
import { TrimTool } from '../src/canvas/tools/modify/trim';
import { CircularPatternTool } from '../src/canvas/tools/modify/circularPattern';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';
import { RectangularPatternTool } from '../src/canvas/tools/modify/rectangularPattern';
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
	AngleConstraint,
	CoincidentConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
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

	it('ArcTool creates centerpoint arc in center mode', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const arcTool = new ArcTool('center');
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

	it('SplineTool creates fit and control splines and supports setMode', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const splineTool = new SplineTool('fit');
		splineTool.activate(ctx);

		assert.equal(splineTool.id, 'spline');
		assert.equal(splineTool.mode, 'fit');

		splineTool.onMouseDown(makeMouseEvent(0, 0));
		splineTool.onMouseDown(makeMouseEvent(50, 50));
		splineTool.onMouseDown(makeMouseEvent(100, 0));
		assert.equal(splineTool.pointCount, 3);
		splineTool.finishSpline(false);
		assert.equal(splineTool.pointCount, 0);
		assert.equal(sketch.splines.size, 1);

		// Switch mode to control
		const modeEvents: string[] = [];
		splineTool.onModeChange = m => modeEvents.push(m);
		splineTool.setMode('control');
		assert.equal(splineTool.mode, 'control');
		assert.deepEqual(modeEvents, ['control']);

		splineTool.onMouseDown(makeMouseEvent(0, 100));
		splineTool.onMouseDown(makeMouseEvent(30, 130));
		splineTool.onMouseDown(makeMouseEvent(70, 130));
		splineTool.onMouseDown(makeMouseEvent(100, 100));
		assert.equal(splineTool.pointCount, 4);
		splineTool.finishSpline(false);
		assert.equal(sketch.splines.size, 2);
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

	it('CircularPatternTool cancel resets state without calling ctx.setTool', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		let setToolCalls = 0;
		ctx.setTool = () => {
			setToolCalls++;
		};

		const tool = new CircularPatternTool();
		tool.activate(ctx);
		assert.ok(tool.state);

		tool.cancel();
		assert.equal(tool.state, null);
		assert.equal(setToolCalls, 0, 'cancel() must not call ctx.setTool');
	});

	it('MirrorTool cancel resets state without calling ctx.setTool', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		let setToolCalls = 0;
		ctx.setTool = () => {
			setToolCalls++;
		};

		const tool = new MirrorTool();
		tool.activate(ctx);
		assert.ok(tool.state);

		tool.cancel();
		assert.equal(tool.state, null);
		assert.equal(setToolCalls, 0, 'cancel() must not call ctx.setTool');
	});

	it('RectangularPatternTool cancel resets state without calling ctx.setTool', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		let setToolCalls = 0;
		ctx.setTool = () => {
			setToolCalls++;
		};

		const tool = new RectangularPatternTool();
		tool.activate(ctx);
		assert.ok(tool.state);

		tool.cancel();
		assert.equal(tool.state, null);
		assert.equal(setToolCalls, 0, 'cancel() must not call ctx.setTool');
	});

	it('SlotTool creates Center-to-Center Slot with construction axis line, 2 side lines, 2 end-cap arcs, and tangent/equal constraints', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('center_to_center');
		slotTool.activate(ctx);

		assert.equal(slotTool.mode, 'center_to_center');

		// Click 1: first arc center (0, 0)
		slotTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(slotTool.step, 1);

		// Click 2: second arc center (80, 0)
		slotTool.onMouseMove(makeMouseEvent(80, 0));
		slotTool.onMouseDown(makeMouseEvent(80, 0));
		assert.equal(slotTool.step, 2);

		// Click 3: slot radius = 15 (cursor at (80, 15))
		slotTool.onMouseMove(makeMouseEvent(80, 15));
		assert.equal(slotTool.radius, 15);
		slotTool.onMouseDown(makeMouseEvent(80, 15));
		assert.equal(slotTool.step, 0);

		// 2 centers + 4 tangent points = 6 points
		assert.equal(sketch.points.size, 6);
		// 2 straight side lines + 1 construction axis line = 3 lines
		assert.equal(sketch.lines.size, 3);
		const constructionLines = [...sketch.lines.values()].filter(l => l.isConstruction);
		assert.equal(constructionLines.length, 1);
		// 2 end-cap arcs
		assert.equal(sketch.arcs.size, 2);

		const tangents = [...sketch.constraints.values()].filter(c => c instanceof TangentLineCircleConstraint);
		const equalRadii = [...sketch.constraints.values()].filter(c => c instanceof EqualRadiusConstraint);
		assert.equal(tangents.length, 4);
		assert.equal(equalRadii.length, 1);
	});

	it('SlotTool locking distance fixes length while waiting for direction click, and locking radius on step 2 finishes immediately without mouse click', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('center_to_center');
		slotTool.activate(ctx);

		// Click 1: first center at (0, 0)
		slotTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(slotTool.step, 1);

		// Lock distance to 100 in popup -> stays on step 1 waiting for direction click
		slotTool.lockDistance(100);
		assert.equal(slotTool.step, 1);
		assert.equal(slotTool.isDistanceLocked, true);

		// Move mouse along (3, 4) direction -> click 2 sets direction at distance 100 -> (60, 80)
		slotTool.onMouseMove(makeMouseEvent(30, 40));
		slotTool.onMouseDown(makeMouseEvent(30, 40));
		assert.equal(slotTool.step, 2);

		// Now on step 2 (radius gizmo): lock radius to 12 -> immediately finishes slot without waiting for mouse click!
		slotTool.lockRadius(12);
		assert.equal(slotTool.step, 0);
		assert.equal(sketch.arcs.size, 2);

		const distConstraints = [...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint);
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(distConstraints.length, 1);
		assert.equal(distConstraints[0].targetDistance, 100);
		assert.equal(radConstraints.length, 1);
		assert.equal(radConstraints[0].targetRadius, 12);
	});

	it('SlotTool creates Center Point Slot with MidpointConstraint and DistanceConstraint between center point and arc center', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('center_point');
		slotTool.activate(ctx);

		// Click 1: slot center point M at (50, 50)
		slotTool.onMouseDown(makeMouseEvent(50, 50));
		assert.equal(slotTool.step, 1);

		// Lock both distance (40) and radius (10) before clicking direction
		slotTool.lockDistance(40);
		slotTool.lockRadius(10);
		assert.equal(slotTool.step, 1);

		// Click 2: sets direction along +X -> since radius is already locked, immediately finishes!
		slotTool.onMouseMove(makeMouseEvent(100, 50));
		slotTool.onMouseDown(makeMouseEvent(100, 50));
		assert.equal(slotTool.step, 0);

		// 1 midpoint + 2 arc centers + 4 tangent points = 7 points
		assert.equal(sketch.points.size, 7);
		assert.equal(sketch.lines.size, 3);
		assert.equal(sketch.arcs.size, 2);

		const midConstraints = [...sketch.constraints.values()].filter(c => c instanceof MidpointConstraint);
		const distConstraints = [...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint);
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(midConstraints.length, 1);
		assert.equal(distConstraints.length, 1);
		assert.equal(distConstraints[0].targetDistance, 40);
		assert.equal(radConstraints.length, 1);
		assert.equal(radConstraints[0].targetRadius, 10);
	});

	it('SlotTool creates Overall Slot with outer edge points and DistanceConstraint on full length L', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('overall');
		slotTool.activate(ctx);

		// Click 1: first outer edge (0, 0)
		slotTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(slotTool.step, 1);

		// Lock overall length to 120
		slotTool.lockDistance(120);

		// Click 2: direction along +X -> second outer edge at (120, 0)
		slotTool.onMouseMove(makeMouseEvent(120, 0));
		slotTool.onMouseDown(makeMouseEvent(120, 0));
		assert.equal(slotTool.step, 2);

		// Lock radius to 20 -> immediately commits without waiting for mouse click!
		slotTool.lockRadius(20);
		assert.equal(slotTool.step, 0);

		// 2 outer edge points + 2 arc centers + 4 tangent points = 8 points
		assert.equal(sketch.points.size, 8);
		assert.equal(sketch.arcs.size, 2);

		// Arc centers should be at (20, 0) and (100, 0) (since L=120, R=20 -> center-to-center = 80)
		const pts = [...sketch.points.values()];
		assert.ok(pts.some(p => Math.abs(p.x - 20) < 1e-3 && Math.abs(p.y) < 1e-3));
		assert.ok(pts.some(p => Math.abs(p.x - 100) < 1e-3 && Math.abs(p.y) < 1e-3));

		const ptOnCircles = [...sketch.constraints.values()].filter(c => c instanceof PointOnCircleConstraint);
		const ptOnLines = [...sketch.constraints.values()].filter(c => c instanceof PointOnLineConstraint);
		const distConstraints = [...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint);
		assert.equal(ptOnCircles.length, 2);
		assert.equal(ptOnLines.length, 2);
		assert.equal(distConstraints.length, 1);
		assert.equal(distConstraints[0].targetDistance, 120);
	});

	it('SlotTool creates 3-Point Arc Slot without radial construction lines, supports locking distance, and keeps final radius undefined until cursor move or input', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('three_point_arc');
		slotTool.activate(ctx);

		// Click 1: start center (50, 0)
		slotTool.onMouseDown(makeMouseEvent(50, 0));
		assert.equal(slotTool.step, 1);
		assert.equal(slotTool.radius, null);
		assert.equal(slotTool.popup.isRadiusVisible(), false);
		assert.equal(slotTool.shouldSnap(), true);

		// Lock chord distance between C1 and C2 to 50 * sqrt(2)
		const chordLen = 50 * Math.SQRT2;
		slotTool.lockDistance(chordLen);
		assert.equal(slotTool.isDistanceLocked, true);

		// Click 2: direction toward (0, 50) -> C2 placed at (0, 50)
		slotTool.onMouseMove(makeMouseEvent(0, 50));
		slotTool.onMouseDown(makeMouseEvent(0, 50));
		assert.equal(slotTool.step, 2);
		assert.equal(slotTool.radius, null);
		assert.equal(slotTool.popup.isRadiusVisible(), false);
		assert.equal(slotTool.shouldSnap(), false);

		// Click 3: mid point on arc of radius 50 centered at (0, 0) -> (50 * cos(45), 50 * sin(45))
		const midVal = 50 * Math.SQRT1_2;
		slotTool.onMouseMove(makeMouseEvent(midVal, midVal));
		slotTool.onMouseDown(makeMouseEvent(midVal, midVal));
		assert.equal(slotTool.step, 3);
		// Upon entering final radius step, radius is still null (undefined) until mouse moves or value is entered, and radius input is now visible
		assert.equal(slotTool.radius, null);
		assert.equal(slotTool.popup.isRadiusVisible(), true);
		assert.equal(slotTool.shouldSnap(), false);

		// Lock radius to 8 on step 3 -> immediately commits without waiting for mouse click!
		slotTool.lockRadius(8);
		assert.equal(slotTool.step, 0);

		// 1 center + 2 cap centers + 4 tangent points = 7 points
		assert.equal(sketch.points.size, 7);
		// NO radial construction lines!
		assert.equal(sketch.lines.size, 0);
		// 1 construction centerline arc + 4 boundary arcs = 5 arcs
		assert.equal(sketch.arcs.size, 5);

		const circleTangents = [...sketch.constraints.values()].filter(c => c instanceof TangentCircleCircleConstraint);
		const equalRadii = [...sketch.constraints.values()].filter(c => c instanceof EqualRadiusConstraint);
		const distConstraints = [...sketch.constraints.values()].filter(c => c instanceof DistanceConstraint);
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(circleTangents.length, 4);
		assert.equal(equalRadii.length, 1);
		assert.equal(distConstraints.length, 1);
		assert.ok(Math.abs(distConstraints[0].targetDistance - chordLen) < 1e-3);
		assert.equal(radConstraints.length, 1);
		assert.equal(radConstraints[0].targetRadius, 8);
	});

	it('SlotTool Center Point Arc Slot supports locking arc radius, angle, and slot radius without radial construction lines', () => {
		const sketch = new SketchDocument();
		const { ctx } = createMockContext(sketch);
		const slotTool = new SlotTool('center_point_arc');
		slotTool.activate(ctx);

		// Click 1: arc center O at (0, 0)
		slotTool.onMouseDown(makeMouseEvent(0, 0));
		assert.equal(slotTool.step, 1);
		assert.equal(slotTool.popup.isRadiusVisible(), false);

		// Lock arc radius to 60 on step 1
		slotTool.lockDistance(60);
		assert.equal(slotTool.isDistanceLocked, true);

		// Click 2: direction along +X -> start point C1 placed at (60, 0) with arcRadius = 60
		slotTool.onMouseMove(makeMouseEvent(30, 0));
		slotTool.onMouseDown(makeMouseEvent(30, 0));
		assert.equal(slotTool.step, 2);
		assert.equal(slotTool.popup.isRadiusVisible(), false);

		// Move mouse into first quadrant to indicate CCW sweep, then lock angle to 90 deg:
		// Must immediately advance from step 2 (angle gizmo) to step 3 (radius gizmo) without mouse click!
		slotTool.onMouseMove(makeMouseEvent(40, 40));
		slotTool.lockAngle(90);
		assert.equal(slotTool.step, 3);
		assert.equal(slotTool.radius, null);
		assert.equal(slotTool.popup.isRadiusVisible(), true);
		assert.equal(slotTool.shouldSnap(), false);

		// Verify snapping is ignored on the radius step even if a snap point is present in the event
		const snappedEvt = makeMouseEvent(0, 72);
		snappedEvt.snap = { type: 'point', worldPos: { x: 0, y: 100 }, screenPos: { x: 0, y: 100 } };
		snappedEvt.effectiveWorld = { x: 0, y: 100 };
		slotTool.onMouseMove(snappedEvt);
		assert.equal(slotTool.radius, 12);

		// Now lock radius to 10 -> immediately finishes arc slot without mouse click!
		slotTool.lockRadius(10);
		assert.equal(slotTool.step, 0);

		assert.equal(sketch.points.size, 7);
		// NO radial construction lines!
		assert.equal(sketch.lines.size, 0);
		assert.equal(sketch.arcs.size, 5);

		const angleConstraints = [...sketch.constraints.values()].filter(c => c instanceof AngleConstraint);
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(angleConstraints.length, 1);
		assert.equal(angleConstraints[0].targetAngle, 90);
		// 2 RadiusConstraints: one for the centerline arc (60) and one for the slot cap radius (10)
		assert.equal(radConstraints.length, 2);
		assert.ok(radConstraints.some(c => Math.abs(c.targetRadius - 60) < 1e-3));
		assert.ok(radConstraints.some(c => Math.abs(c.targetRadius - 10) < 1e-3));
	});

	it('CanvasInteraction handleKeyDown switches Slot modes with Alt+1..5', () => {
		const switchedModes: string[] = [];
		let prevented = 0;
		const fakeInteraction = {
			isMac: false,
			activeTool: 'slot',
			setSlotMode: (mode: string) => {
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
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit4', '4'));
		CanvasInteraction.prototype.handleKeyDown.call(fakeInteraction as any, makeAltKey('Digit5', '5'));

		assert.deepEqual(switchedModes, [
			'center_to_center',
			'center_point',
			'overall',
			'three_point_arc',
			'center_point_arc',
		]);
		assert.equal(prevented, 5);
	});

	it('CanvasInteraction handleKeyDown switches Spline modes with Alt+1..2', () => {
		const switchedModes: string[] = [];
		let prevented = 0;
		const fakeInteraction = {
			isMac: false,
			activeTool: 'spline',
			setSplineMode: (mode: string) => {
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

		assert.deepEqual(switchedModes, ['fit', 'control']);
		assert.equal(prevented, 2);
	});
});

describe('Inspector Primitive & Constraint Editing Methods', () => {
	it('setPointCoords updates free point and fixed point coordinates', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 20);
		assert.ok(sketch.setPointCoords(p1.id, 35, -15));
		assert.ok(Math.abs(p1.x - 35) < 1e-4);
		assert.ok(Math.abs(p1.y - -15) < 1e-4);

		// Fixed point
		const fixC = sketch.addFixedConstraint(p1.id);
		assert.ok(fixC);
		assert.ok(sketch.setPointCoords(p1.id, 100, 200));
		assert.ok(Math.abs(p1.x - 100) < 1e-4);
		assert.ok(Math.abs(p1.y - 200) < 1e-4);
		assert.equal(fixC!.targetX, 100);
		assert.equal(fixC!.targetY, 200);
	});

	it('setLineLength and setLineAngle update line geometry and existing distance constraint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 0);
		const line = sketch.addLine(p1.id, p2.id);

		// Without distance constraint
		assert.ok(sketch.setLineLength(line.id, 80));
		assert.ok(Math.abs(Math.hypot(p2.x - p1.x, p2.y - p1.y) - 80) < 1e-3);

		// With distance constraint
		const distC = sketch.addDistanceConstraint(p1.id, p2.id, 80);
		assert.ok(distC);
		assert.ok(sketch.setLineLength(line.id, 120));
		assert.equal(distC!.targetDistance, 120);
		assert.ok(Math.abs(Math.hypot(p2.x - p1.x, p2.y - p1.y) - 120) < 1e-3);

		// Angle update to 90 degrees
		assert.ok(sketch.setLineAngle(line.id, 90));
		const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
		assert.ok(Math.abs(angleDeg - 90) < 1e-2);
		assert.ok(Math.abs(Math.hypot(p2.x - p1.x, p2.y - p1.y) - 120) < 1e-2);
	});

	it('setCircleOrArcRadius and setArcAngle update circle, arc, and attached constraints', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint(0, 0);
		const circle = sketch.addCircle(cPt.id, 25);

		assert.ok(sketch.setCircleOrArcRadius(circle.id, 40));
		assert.ok(Math.abs(circle.radius - 40) < 1e-4);

		const radC = sketch.addRadiusConstraint(circle.id, 40);
		assert.ok(radC);
		assert.ok(sketch.setCircleOrArcRadius(circle.id, 65));
		assert.equal(radC!.targetRadius, 65);
		assert.ok(Math.abs(circle.radius - 65) < 1e-4);

		// Arc radius and angle
		const ac = sketch.addPoint(0, 0);
		const as = sketch.addPoint(30, 0);
		const ae = sketch.addPoint(0, 30);
		const arc = sketch.addArc(ac.id, as.id, ae.id, 30, false);

		assert.ok(sketch.setCircleOrArcRadius(arc.id, 50));
		assert.ok(Math.abs(arc.radius - 50) < 1e-3);
		assert.ok(Math.abs(Math.hypot(as.x - ac.x, as.y - ac.y) - 50) < 1e-3);
		assert.ok(Math.abs(Math.hypot(ae.x - ac.x, ae.y - ac.y) - 50) < 1e-3);

		assert.ok(sketch.setArcAngle(arc.id, 180));
		const sweepRad = Math.atan2(ae.y - ac.y, ae.x - ac.x) - Math.atan2(as.y - ac.y, as.x - ac.x);
		const sweepDeg = (((sweepRad < 0 ? sweepRad + 2 * Math.PI : sweepRad) * 180) / Math.PI);
		assert.ok(Math.abs(sweepDeg - 180) < 1e-2);
	});

	it('setEllipseParams and updateDimensionalConstraint update ellipse and dimensional constraints', () => {
		const sketch = new SketchDocument();
		const ec = sketch.addPoint(0, 0);
		const emaj = sketch.addPoint(40, 0);
		const emin = sketch.addPoint(0, 20);
		const ellipse = sketch.addEllipse(ec.id, emaj.id, emin.id);

		assert.ok(sketch.setEllipseParams(ellipse.id, { rx: 60, ry: 30, rotationDeg: 45 }));
		assert.ok(Math.abs(Math.hypot(emaj.x - ec.x, emaj.y - ec.y) - 60) < 1e-2);
		assert.ok(Math.abs(Math.hypot(emin.x - ec.x, emin.y - ec.y) - 30) < 1e-2);
		const rotDeg = (Math.atan2(emaj.y - ec.y, emaj.x - ec.x) * 180) / Math.PI;
		assert.ok(Math.abs(rotDeg - 45) < 1e-2);

		// Dimensional constraints update
		const p1 = sketch.addPoint(0, 100);
		const p2 = sketch.addPoint(50, 100);
		const dc = sketch.addDistanceConstraint(p1.id, p2.id, 50);
		assert.ok(dc);
		assert.ok(sketch.updateDimensionalConstraint(dc!.id, 95));
		assert.equal(dc!.targetDistance, 95);
		assert.ok(Math.abs(Math.hypot(p2.x - p1.x, p2.y - p1.y) - 95) < 1e-2);
	});

	it('setLineLength and setCircleOrArcRadius achieve exact target values on EqualLength / EqualRadius constrained geometry', () => {
		const sketch = new SketchDocument();
		const pA = sketch.addPoint(-50, 0);
		const pB = sketch.addPoint(50, 0);
		const pC = sketch.addPoint(0, 80);
		sketch.addFixedConstraint(pA.id);
		sketch.addLine(pA.id, pB.id);
		const lLeft = sketch.addLine(pA.id, pC.id);
		const lRight = sketch.addLine(pB.id, pC.id);
		sketch.addHorizontalConstraint(pA.id, pB.id);
		sketch.addDistanceConstraint(pA.id, pB.id, 100);
		sketch.addEqualLengthConstraint(lLeft.id, lRight.id);
		sketch.solve();

		assert.ok(sketch.setLineLength(lLeft.id, 120));
		const lenLeft = Math.hypot(pC.x - pA.x, pC.y - pA.y);
		const lenRight = Math.hypot(pC.x - pB.x, pC.y - pB.y);
		assert.ok(Math.abs(lenLeft - 120) < 1e-3, `Expected 120, got ${lenLeft}`);
		assert.ok(Math.abs(lenRight - 120) < 1e-3, `Expected 120, got ${lenRight}`);

		// Changing line angle on 1-DoF EqualLength triangle adjusts side lengths to achieve exact angle
		assert.ok(sketch.setLineAngle(lLeft.id, 45));
		const angleLeft = (Math.atan2(pC.y - pA.y, pC.x - pA.x) * 180) / Math.PI;
		assert.ok(Math.abs(angleLeft - 45) < 1e-3, `Expected 45°, got ${angleLeft}`);
		assert.ok(Math.abs(Math.hypot(pC.x - pA.x, pC.y - pA.y) - Math.hypot(pC.x - pB.x, pC.y - pB.y)) < 1e-3);

		// Changing relative angle between two lines on 1-DoF EqualLength triangle (60° -> equilateral triangle of side 100)
		assert.ok(sketch.setLinesRelativeAngle(lLeft.id, lRight.id, 60));
		assert.ok(Math.abs(Math.hypot(pC.x - pA.x, pC.y - pA.y) - 100) < 1e-2);
		assert.ok(Math.abs(Math.hypot(pC.x - pB.x, pC.y - pB.y) - 100) < 1e-2);

		// EqualRadius circles
		const c1Pt = sketch.addPoint(-100, 0);
		const c2Pt = sketch.addPoint(100, 0);
		const c1 = sketch.addCircle(c1Pt.id, 25);
		const c2 = sketch.addCircle(c2Pt.id, 25);
		sketch.addEqualRadiusConstraint(c1.id, c2.id);
		sketch.solve();

		assert.ok(sketch.setCircleOrArcRadius(c1.id, 60));
		assert.ok(Math.abs(c1.radius - 60) < 1e-3);
		assert.ok(Math.abs(c2.radius - 60) < 1e-3);
	});
});



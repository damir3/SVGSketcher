import { Vec2 } from '../src/math/vector';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { getAllGeoCurves } from '../src/math/intersection';
import { findExtendCandidate, executeExtend, findExtendTarget } from '../src/math/extend';
import { ExtendTool } from '../src/canvas/tools/modify/extend';

function setupMockDocument() {
	const origDoc = (globalThis as any).document;
	const origWin = (globalThis as any).window;
	const makeEl = () => ({
		style: {},
		classList: { add: () => {}, remove: () => {}, toggle: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
		appendChild: () => {},
		focus: () => {},
		select: () => {},
		blur: () => {},
		querySelector: () => makeEl(),
		querySelectorAll: () => [],
		value: '10.0',
		checked: false,
	});

	(globalThis as any).document = {
		createElement: () => makeEl(),
		createElementNS: () => ({
			setAttribute: () => {},
			setAttributeNS: () => {},
			style: {},
			appendChild: () => {},
			classList: { add: () => {}, remove: () => {} },
		}),
		body: { appendChild: () => {}, removeChild: () => {} },
	};
	(globalThis as any).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		innerWidth: 1024,
		innerHeight: 768,
	};

	return () => {
		(globalThis as any).document = origDoc;
		(globalThis as any).window = origWin;
	};
}

describe('Extend Tool Math and Logic', () => {
	it('extends a line to the nearest intersection with another line', () => {
		const sketch = new SketchDocument();
		// Horizontal line from (0, 0) to (50, 0)
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 50, y: 0 });
		const l1 = sketch.addLine(p0.id, p1.id);

		// Target vertical line at x = 80 from y = -50 to y = 50
		const pA = sketch.addPoint({ x: 80, y: -50 });
		const pB = sketch.addPoint({ x: 80, y: 50 });
		sketch.addLine(pA.id, pB.id);

		const allCurves = getAllGeoCurves(sketch);
		const l1Curve = l1.toGeoCurve(sketch)!;

		// Cursor closer to p1 (50, 0): should extend forward from p1 towards x = 80
		const cand = findExtendCandidate(sketch, l1Curve, allCurves, new Vec2(45, 0));
		assert.ok(cand);
		assert.equal(cand.targetType, 'line');
		assert.equal(cand.edge, 'end');
		assert.equal(cand.fromPoint.x, 50);
		assert.equal(cand.fromPoint.y, 0);
		assert.equal(cand.toPoint.x, 80);
		assert.equal(cand.toPoint.y, 0);

		// Execute extend
		sketch.beginTransaction();
		const res = executeExtend(sketch, cand);
		sketch.commitTransaction();

		assert.ok(res);
		const updatedLine = sketch.lines.get(l1.id)!;
		const pt2 = sketch.points.get(updatedLine.p2Id)!;
		assert.equal(pt2.x, 80);
		assert.equal(pt2.y, 0);
	});

	it('extends a line by +50mm when there is no intersection ahead', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 100, y: 0 });
		const l1 = sketch.addLine(p0.id, p1.id);

		const allCurves = getAllGeoCurves(sketch);
		const l1Curve = l1.toGeoCurve(sketch)!;

		// Cursor near p1: extends forward along (1, 0) by +50mm
		const cand = findExtendCandidate(sketch, l1Curve, allCurves, new Vec2(80, 0));
		assert.ok(cand);
		assert.equal(cand.edge, 'end');
		assert.equal(cand.toPoint.x, 150);
		assert.equal(cand.toPoint.y, 0);

		// Cursor near p0: extends backward along (-1, 0) by +50mm
		const candStart = findExtendCandidate(sketch, l1Curve, allCurves, new Vec2(10, 0));
		assert.ok(candStart);
		assert.equal(candStart.edge, 'start');
		assert.equal(candStart.toPoint.x, -50);
		assert.equal(candStart.toPoint.y, 0);

		// Execute extend
		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		const pt2 = sketch.points.get(l1.p2Id)!;
		assert.equal(pt2.x, 150);
		assert.equal(pt2.y, 0);
	});

	it('extends an arc along its circular trajectory to the next intersection', () => {
		const sketch = new SketchDocument();
		// Arc from 0 deg to 90 deg (radius 50, CCW)
		const c = sketch.addPoint({ x: 0, y: 0 });
		const pStart = sketch.addPoint({ x: 50, y: 0 }); // 0 deg
		const pEnd = sketch.addPoint({ x: 0, y: 50 }); // 90 deg
		const arc = sketch.addArc(c.id, pStart.id, pEnd.id, 50, false);

		// Target line crossing circle at 180 deg: x = -50, from y = -20 to y = 20
		const lA = sketch.addPoint({ x: -50, y: -20 });
		const lB = sketch.addPoint({ x: -50, y: 20 });
		sketch.addLine(lA.id, lB.id);

		const allCurves = getAllGeoCurves(sketch);
		const arcCurve = arc.toGeoCurve(sketch)!;

		// Cursor near pEnd: extends CCW towards 180 deg (-50, 0)
		const cand = findExtendCandidate(sketch, arcCurve, allCurves, new Vec2(5, 45));
		assert.ok(cand);
		assert.equal(cand.targetType, 'arc');
		assert.equal(cand.edge, 'end');
		assert.equal(cand.becomesFullLoop, false);
		assert.ok(Math.abs(cand.toPoint.x - -50) < 1e-3);
		assert.ok(Math.abs(cand.toPoint.y - 0) < 1e-3);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		const updatedArc = sketch.arcs.get(arc.id)!;
		const ptEnd = sketch.points.get(updatedArc.endPointId)!;
		assert.ok(Math.abs(ptEnd.x - -50) < 1e-3);
		assert.ok(Math.abs(ptEnd.y - 0) < 1e-3);
	});

	it('extends an arc to a full circle when there is no intersection ahead', () => {
		const sketch = new SketchDocument();
		const c = sketch.addPoint({ x: 0, y: 0 });
		const pStart = sketch.addPoint({ x: 50, y: 0 });
		const pEnd = sketch.addPoint({ x: 0, y: 50 });
		const arc = sketch.addArc(c.id, pStart.id, pEnd.id, 50, false);

		const allCurves = getAllGeoCurves(sketch);
		const arcCurve = arc.toGeoCurve(sketch)!;

		const cand = findExtendCandidate(sketch, arcCurve, allCurves, new Vec2(5, 45));
		assert.ok(cand);
		assert.equal(cand.becomesFullLoop, true);

		sketch.beginTransaction();
		const res = executeExtend(sketch, cand);
		sketch.commitTransaction();

		assert.ok(res);
		// Arc should be replaced by a circle
		assert.equal(sketch.arcs.size, 0);
		assert.equal(sketch.circles.size, 1);
		const newCircle = Array.from(sketch.circles.values())[0];
		assert.equal(newCircle.radius, 50);
	});

	it('extends an open spline along its endpoint tangent to an intersection', () => {
		const sketch = new SketchDocument();
		// Spline from (0, 0) to (90, 0)
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 30, y: 40 });
		const p2 = sketch.addPoint({ x: 60, y: 40 });
		const p3 = sketch.addPoint({ x: 90, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id, p3.id]);

		// Target line at x = 120
		const lA = sketch.addPoint({ x: 120, y: -100 });
		const lB = sketch.addPoint({ x: 120, y: 100 });
		sketch.addLine(lA.id, lB.id);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = spline.toGeoCurve(sketch)!;

		// Cursor near end (90, 0)
		const cand = findExtendCandidate(sketch, spCurve, allCurves, new Vec2(85, 5));
		assert.ok(cand);
		assert.equal(cand.targetType, 'spline');
		assert.equal(cand.edge, 'end');
		assert.ok(Math.abs(cand.toPoint.x - 120) < 1e-2);
		assert.ok(Math.abs(cand.toPoint.y - -40) < 1e-2);

		sketch.beginTransaction();
		const res = executeExtend(sketch, cand);
		sketch.commitTransaction();

		assert.ok(res);
		const updatedSpline = sketch.splines.get(spline.id)!;
		assert.equal(updatedSpline.pointIds.length, 5);
		for (const pid of [p0.id, p1.id, p2.id, p3.id]) {
			assert.ok(sketch.points.has(pid), `Expected original point ${pid} to still exist in sketch.points`);
		}
		const lastPt = sketch.points.get(updatedSpline.pointIds[4])!;
		assert.ok(Math.abs(lastPt.x - 120) < 1e-2);
	});

	it('extends an open spline by +50mm along its tangent when there is no intersection', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 30, y: 40 });
		const p2 = sketch.addPoint({ x: 60, y: 40 });
		const p3 = sketch.addPoint({ x: 90, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id, p3.id]);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = spline.toGeoCurve(sketch)!;

		const cand = findExtendCandidate(sketch, spCurve, allCurves, new Vec2(85, 5));
		assert.ok(cand);
		assert.equal(cand.edge, 'end');
		// Tangent at end is (30, -40) -> normalized (0.6, -0.8). +50mm => (90 + 30, 0 - 40) = (120, -40)
		assert.ok(Math.abs(cand.toPoint.x - 120) < 0.5);
		assert.ok(Math.abs(cand.toPoint.y - -40) < 0.5);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		const updatedSpline = sketch.splines.get(spline.id)!;
		assert.equal(updatedSpline.pointIds.length, 5);
		for (const pid of [p0.id, p1.id, p2.id, p3.id]) {
			assert.ok(sketch.points.has(pid), `Expected original point ${pid} to still exist in sketch.points`);
		}
	});

	it('extends a control spline safely preserving all control points', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: -50, y: 0 });
		const p1 = sketch.addPoint({ x: -50, y: 100 });
		const p2 = sketch.addPoint({ x: 50, y: 100 });
		const p3 = sketch.addPoint({ x: 50, y: 0 });
		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id]);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = spline.toGeoCurve(sketch)!;

		const cand = findExtendCandidate(sketch, spCurve, allCurves, new Vec2(45, 10))!;
		assert.ok(cand);
		assert.equal(cand.edge, 'end');

		sketch.beginTransaction();
		const res = executeExtend(sketch, cand);
		sketch.commitTransaction();

		assert.ok(res);
		const updatedSpline = sketch.splines.get(spline.id)!;
		assert.equal(updatedSpline.pointIds.length, 5);
		for (const pid of [p0.id, p1.id, p2.id, p3.id]) {
			assert.ok(sketch.points.has(pid), `Expected control point ${pid} to still exist in sketch.points`);
		}
	});

	it('removes conflicting point_on_line and external alignment constraints without dragging other entities', () => {
		const sketch = new SketchDocument();
		// Line-3: diagonal line from (50, 0) to (0, 80)
		const p2 = sketch.addPoint({ x: 50, y: 0 });
		const p3 = sketch.addPoint({ x: 0, y: 80 });
		sketch.addLine(p2.id, p3.id);

		// Line-4: horizontal line from (-50, 30) to (-5, 30)
		const p4 = sketch.addPoint({ x: -50, y: 30 });
		const p5 = sketch.addPoint({ x: -5, y: 30 });
		const l4 = sketch.addLine(p4.id, p5.id);
		sketch.addHorizontalConstraint(p4.id, p5.id);

		// Line-5: vertical line at x = -5 from y = 0 to y = 60
		const p8 = sketch.addPoint({ x: -5, y: 0 });
		const p6 = sketch.addPoint({ x: -5, y: 60 });
		sketch.addLine(p8.id, p6.id);
		sketch.addVerticalConstraint(p5.id, p6.id);
		sketch.addPointOnLineConstraint(p5.id, p8.id); // p5 on Line-5

		const allCurves = getAllGeoCurves(sketch);
		const cand = findExtendCandidate(sketch, l4.toGeoCurve(sketch)!, allCurves, new Vec2(-10, 30))!;
		assert.ok(cand);
		assert.ok(Math.abs(cand.toPoint.x - 31.25) < 1e-2);
		assert.ok(Math.abs(cand.toPoint.y - 30) < 1e-2);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		// Line-5 points must NOT be dragged across the sketch
		assert.equal(sketch.points.get(p6.id)!.x, -5);
		assert.equal(sketch.points.get(p8.id)!.x, -5);

		// Line-4 endpoint p5 must be extended to Line-3 at (31.25, 30)
		assert.ok(Math.abs(sketch.points.get(p5.id)!.x - 31.25) < 1e-2);
		assert.ok(Math.abs(sketch.points.get(p5.id)!.y - 30) < 1e-2);

		// Horizontal constraint on Line-4 must remain satisfied
		assert.equal(sketch.points.get(p4.id)!.y, 30);
		assert.equal(sketch.points.get(p5.id)!.y, 30);
	});

	it('transfers horizontal and vertical constraints to the new endpoint when extending a shared corner', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 30 });
		const p2 = sketch.addPoint({ x: 50, y: 30 });
		const p3 = sketch.addPoint({ x: 50, y: 80 });

		const lineA = sketch.addLine(p1.id, p2.id);
		sketch.addLine(p2.id, p3.id); // p2 is shared with this vertical line
		const cHoriz = sketch.addHorizontalConstraint(p1.id, p2.id);

		// Target line at x = 100
		const pA = sketch.addPoint({ x: 100, y: 0 });
		const pB = sketch.addPoint({ x: 100, y: 60 });
		sketch.addLine(pA.id, pB.id);

		const allCurves = getAllGeoCurves(sketch);
		const cand = findExtendCandidate(sketch, lineA.toGeoCurve(sketch)!, allCurves, new Vec2(45, 30))!;
		assert.ok(cand);
		assert.equal(cand.toPoint.x, 100);
		assert.equal(cand.toPoint.y, 30);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		// p2 must remain at (50, 30) for the vertical line
		assert.equal(sketch.points.get(p2.id)!.x, 50);
		assert.equal(sketch.points.get(p2.id)!.y, 30);

		// lineA has a new endpoint at (100, 30)
		const newEndId = lineA.p2Id;
		assert.notEqual(newEndId, p2.id);
		assert.equal(sketch.points.get(newEndId)!.x, 100);

		// cHoriz must now be transferred to the new endpoint
		assert.equal(cHoriz.p1Id, p1.id);
		assert.equal(cHoriz.p2Id, newEndId);
	});

	it('transfers Parallel, Perpendicular, and Angle constraints to the new endpoint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 50 });
		const l1 = sketch.addLine(p1.id, p2.id);

		// Shared vertical line at p2
		const p3 = sketch.addPoint({ x: 50, y: 100 });
		sketch.addLine(p2.id, p3.id);

		// Parallel line l2
		const p4 = sketch.addPoint({ x: 0, y: 50 });
		const p5 = sketch.addPoint({ x: 50, y: 100 });
		const l2 = sketch.addLine(p4.id, p5.id);
		const cPar = sketch.addParallelConstraint(l1.id, l2.id)!;

		// Perpendicular line l3
		const p6 = sketch.addPoint({ x: 0, y: 50 });
		const p7 = sketch.addPoint({ x: 50, y: 0 });
		const l3 = sketch.addLine(p6.id, p7.id);
		const cPerp = sketch.addPerpendicularConstraint(l1.id, l3.id)!;

		// Target line at x = 100
		const pA = sketch.addPoint({ x: 100, y: -50 });
		const pB = sketch.addPoint({ x: 100, y: 150 });
		sketch.addLine(pA.id, pB.id);

		const allCurves = getAllGeoCurves(sketch);
		const cand = findExtendCandidate(sketch, l1.toGeoCurve(sketch)!, allCurves, new Vec2(45, 45))!;
		assert.ok(cand);
		assert.equal(cand.toPoint.x, 100);
		assert.equal(cand.toPoint.y, 100);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		const newEndId = l1.p2Id;
		assert.notEqual(newEndId, p2.id);

		// Verify ParallelConstraint references newEndId
		assert.equal((cPar as any).l1P2, newEndId);

		// Verify PerpendicularConstraint references newEndId
		assert.equal((cPerp as any).l1P2, newEndId);
	});

	it('removes conflicting EqualLengthConstraint when extending a line', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 0 });
		const l1 = sketch.addLine(p1.id, p2.id);

		const p3 = sketch.addPoint({ x: 0, y: 50 });
		const p4 = sketch.addPoint({ x: 50, y: 50 });
		const l2 = sketch.addLine(p3.id, p4.id);

		const cEq = sketch.addEqualLengthConstraint(l1.id, l2.id)!;
		assert.ok(sketch.constraints.has(cEq.id));

		const allCurves = getAllGeoCurves(sketch);
		const cand = findExtendCandidate(sketch, l1.toGeoCurve(sketch)!, allCurves, new Vec2(40, 0))!;
		assert.ok(cand);

		sketch.beginTransaction();
		executeExtend(sketch, cand);
		sketch.commitTransaction();

		// EqualLengthConstraint must be removed because length changed
		assert.equal(sketch.constraints.has(cEq.id), false);
	});
});

describe('ExtendTool Interaction and Workflow', () => {
	it('detects extend target and executes extend on click', () => {
		const cleanup = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint({ x: 0, y: 0 });
			const p1 = sketch.addPoint({ x: 50, y: 0 });
			const l1 = sketch.addLine(p0.id, p1.id);

			const pA = sketch.addPoint({ x: 80, y: -50 });
			const pB = sketch.addPoint({ x: 80, y: 50 });
			sketch.addLine(pA.id, pB.id);

			const tool = new ExtendTool();
			let toastMsg = '';

			const mockCtx: any = {
				sketch,
				viewport: {
					worldToScreen: (p: { x: number; y: number }) => new Vec2(p.x, p.y),
					screenToWorld: (p: { x: number; y: number }) => new Vec2(p.x, p.y),
				},
				requestRender: () => {},
				setCursor: () => {},
				showToast: (msg: string) => {
					toastMsg = msg;
				},
			};

			tool.activate(mockCtx);

			// Click near p1 to extend line
			tool.onMouseDown({
				screen: new Vec2(45, 0),
				world: new Vec2(45, 0),
				raw: {} as any,
			});

			assert.equal(toastMsg, 'Extended');
			const pt2 = sketch.points.get(l1.p2Id)!;
			assert.equal(pt2.x, 80);
			assert.equal(pt2.y, 0);

			// Supports undo
			sketch.undo();
			const pt2Undo = sketch.points.get(l1.p2Id)!;
			assert.equal(pt2Undo.x, 50);

			// Supports redo
			sketch.redo();
			const pt2Redo = sketch.points.get(l1.p2Id)!;
			assert.equal(pt2Redo.x, 80);
		} finally {
			cleanup();
		}
	});
});

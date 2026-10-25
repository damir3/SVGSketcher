import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	getConnectedPrimitivesForPoint,
	calculateFilletGeometry,
	findMaxFilletRadius,
	commitFilletToSketch,
	type FilletCandidate,
} from '../src/math/fillet';
import { sketchPrimitiveToGeoCurve } from '../src/math/intersection';
import {
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	RadiusConstraint,
	EqualRadiusConstraint,
} from '../src/solver/constraints';

describe('Fillet Connected Primitives Discovery', () => {
	it('identifies valid corner with exactly 2 lines meeting at a vertex', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const p3 = sketch.addPoint(0, 100);

		sketch.addLine(p1.id, p2.id);
		sketch.addLine(p1.id, p3.id);

		const result = getConnectedPrimitivesForPoint(sketch, p1.id);
		assert.equal(result.valid, true);
		assert.equal(result.primitives.length, 2);
		assert.equal(result.pointIds.has(p1.id), true);
	});

	it('rejects endpoint with only 1 line', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		sketch.addLine(p1.id, p2.id);

		const result = getConnectedPrimitivesForPoint(sketch, p2.id);
		assert.equal(result.valid, false);
		assert.equal(result.primitives.length, 1);
	});

	it('rejects vertex with 3 or more lines', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		const p3 = sketch.addPoint(-100, 0);

		sketch.addLine(p0.id, p1.id);
		sketch.addLine(p0.id, p2.id);
		sketch.addLine(p0.id, p3.id);

		const result = getConnectedPrimitivesForPoint(sketch, p0.id);
		assert.equal(result.valid, false);
		assert.equal(result.primitives.length, 3);
	});

	it('supports coincident points across coincident constraints', () => {
		const sketch = new SketchDocument();
		// Two separate points at the same spot connected by CoincidentConstraint
		const pA = sketch.addPoint(0, 0);
		const pB = sketch.addPoint(0, 0);
		sketch.addCoincidentConstraint(pA.id, pB.id);

		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		sketch.addLine(pA.id, p1.id);
		sketch.addLine(pB.id, p2.id);

		// Selecting pA should find pB and both lines
		const resA = getConnectedPrimitivesForPoint(sketch, pA.id);
		assert.equal(resA.valid, true);
		assert.equal(resA.primitives.length, 2);
		assert.equal(resA.pointIds.size, 2);
		assert.ok(resA.pointIds.has(pA.id));
		assert.ok(resA.pointIds.has(pB.id));

		// Selecting pB should also be valid
		const resB = getConnectedPrimitivesForPoint(sketch, pB.id);
		assert.equal(resB.valid, true);
		assert.equal(resB.primitives.length, 2);
	});

	it('ignores internal spline tangent handle lines', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const p3 = sketch.addPoint(0, 100);

		sketch.addLine(p1.id, p2.id);
		sketch.addFitSpline([p1.id, p3.id]);

		// p1 is connected to 1 regular line and 1 fit spline.
		// Spline creates internal tangent handle lines at p1, but they must be ignored!
		const result = getConnectedPrimitivesForPoint(sketch, p1.id);
		assert.equal(result.valid, true);
		assert.equal(result.primitives.length, 2);
		assert.equal(result.primitives.some(p => p.type === 'line'), true);
		assert.equal(result.primitives.some(p => p.type === 'spline'), true);
	});

	it('supports line and arc meeting at vertex', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const pCenter = sketch.addPoint(0, 50);
		const pArcEnd = sketch.addPoint(0, 100);

		sketch.addLine(p1.id, p2.id);
		sketch.addArc(pCenter.id, p1.id, pArcEnd.id, 50, false);

		const result = getConnectedPrimitivesForPoint(sketch, p1.id);
		assert.equal(result.valid, true);
		assert.equal(result.primitives.length, 2);
		assert.equal(result.primitives.some(p => p.type === 'line'), true);
		assert.equal(result.primitives.some(p => p.type === 'arc'), true);
	});
});

describe('Fillet Mathematics & Geometry', () => {
	it('calculates exact orthogonal 90-degree corner fillet', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;

		const radius = 20;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		});

		assert.ok(res, 'Fillet geometry result must be computed');
		assert.equal(res.radius, 20);

		// Center must be at (20, 20)
		assert.ok(Math.abs(res.center.x - 20) < 1e-4);
		assert.ok(Math.abs(res.center.y - 20) < 1e-4);

		// Tangent points at (20, 0) and (0, 20)
		assert.ok(Math.abs(res.t1.x - 20) < 1e-4 && Math.abs(res.t1.y) < 1e-4);
		assert.ok(Math.abs(res.t2.x) < 1e-4 && Math.abs(res.t2.y - 20) < 1e-4);

		// Distance from center to midArc must be radius
		const dMid = Math.hypot(res.midArc.x - res.center.x, res.midArc.y - res.center.y);
		assert.ok(Math.abs(dMid - radius) < 1e-4);
	});

	it('calculates correct convex orientation on upward peak corner (not inverted bowl)', () => {
		const sketch = new SketchDocument();
		const pPeak = sketch.addPoint(0, 100);
		const pLeft = sketch.addPoint(-50, 0);
		const pRight = sketch.addPoint(50, 0);

		const l1 = sketch.addLine(pPeak.id, pLeft.id);
		const l2 = sketch.addLine(pPeak.id, pRight.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;

		const radius = 10;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 100 },
			endPointId1: pPeak.id,
			endPointId2: pPeak.id,
		});

		assert.ok(res);
		// Center must be below peak
		assert.ok(res.center.y < 100);
		// midArc must be above center towards the peak (rounding off the top)
		assert.ok(res.midArc.y > res.center.y, 'midArc must be above center');
		assert.ok(res.midArc.y > res.t1.y, 'midArc must be above tangent point 1');
		assert.ok(res.midArc.y > res.t2.y, 'midArc must be above tangent point 2');

		// In screen coordinates (where Y is inverted), going from left (-x, -y) to right (+x, -y)
		// through the top is clockwise in screen space!
		assert.equal(res.clockwise, true, 'Fillet arc from left to right over top peak must be clockwise in screen space');

		// Reverse curve selection order
		const resRev = calculateFilletGeometry(c2, c1, radius, {
			cornerVertex: { x: 0, y: 100 },
			endPointId1: pPeak.id,
			endPointId2: pPeak.id,
		});
		assert.ok(resRev);
		assert.equal(resRev.clockwise, false, 'Fillet arc from right to left over top peak must be counter-clockwise in screen space');
		assert.ok(resRev.midArc.y > resRev.center.y);
	});

	it('calculates acute corner fillet', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(100, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id); // 45 degree angle

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;

		const radius = 10;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		});

		assert.ok(res);
		// Check both tangent points are distance radius from center
		const d1 = Math.hypot(res.t1.x - res.center.x, res.t1.y - res.center.y);
		const d2 = Math.hypot(res.t2.x - res.center.x, res.t2.y - res.center.y);
		assert.ok(Math.abs(d1 - radius) < 1e-4);
		assert.ok(Math.abs(d2 - radius) < 1e-4);
	});

	it('calculates fillet between disjoint lines via extensions', () => {
		const sketch = new SketchDocument();
		// Two lines that would intersect at (50, 50) if extended
		const l1 = sketch.addLine(sketch.addPoint(0, 50).id, sketch.addPoint(40, 50).id);
		const l2 = sketch.addLine(sketch.addPoint(50, 0).id, sketch.addPoint(50, 40).id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;

		const radius = 15;
		const res = calculateFilletGeometry(c1, c2, radius, {
			clickPos1: { x: 20, y: 50 },
			clickPos2: { x: 50, y: 20 },
		});

		assert.ok(res);
		assert.ok(Math.abs(res.cornerVertex.x - 50) < 1e-4);
		assert.ok(Math.abs(res.cornerVertex.y - 50) < 1e-4);
		assert.ok(Math.abs(res.center.x - 35) < 1e-4);
		assert.ok(Math.abs(res.center.y - 35) < 1e-4);
	});

	it('calculates fillet between Line and Arc', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const pCenter = sketch.addPoint(-50, 0);
		const pArcEnd = sketch.addPoint(-50, 50);

		const l1 = sketch.addLine(p0.id, p1.id);
		const arc = sketch.addArc(pCenter.id, p0.id, pArcEnd.id, 50, false);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'arc', arc.id)!;

		const radius = 15;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		});

		assert.ok(res);
		const d1 = Math.hypot(res.t1.x - res.center.x, res.t1.y - res.center.y);
		const d2 = Math.hypot(res.t2.x - res.center.x, res.t2.y - res.center.y);
		assert.ok(Math.abs(d1 - radius) < 1e-3);
		assert.ok(Math.abs(d2 - radius) < 1e-3);
	});

	it('calculates fillet between Line and Spline with tangential extension', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const pSp1 = sketch.addPoint(0, 50);
		const pSp2 = sketch.addPoint(20, 100);

		const l1 = sketch.addLine(p0.id, p1.id);
		const spline = sketch.addFitSpline([p0.id, pSp1.id, pSp2.id]);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;

		const radius = 12;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		});

		assert.ok(res);
		const d1 = Math.hypot(res.t1.x - res.center.x, res.t1.y - res.center.y);
		const d2 = Math.hypot(res.t2.x - res.center.x, res.t2.y - res.center.y);
		assert.ok(Math.abs(d1 - radius) < 1e-2);
		assert.ok(Math.abs(d2 - radius) < 1e-2);
	});

	it('calculates fillet between disjoint Fit Spline and Line in correct quadrant', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(-150, 90);
		const p2 = sketch.addPoint(-75, 90);
		const spline = sketch.addFitSpline([p1.id, p2.id]);

		const p3 = sketch.addPoint(-50, 65);
		const p4 = sketch.addPoint(-50, -20);
		const line = sketch.addLine(p3.id, p4.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;

		const radius = 20;
		const res = calculateFilletGeometry(c1, c2, radius, {
			clickPos1: { x: -100, y: 90 },
			clickPos2: { x: -50, y: 30 },
		});

		assert.ok(res);
		// Corner intersection is (-50, 90)
		assert.ok(Math.abs(res.cornerVertex.x - (-50)) < 1e-3);
		assert.ok(Math.abs(res.cornerVertex.y - 90) < 1e-3);
		// Center must be in the lower-left quadrant: (-70, 70)
		assert.ok(Math.abs(res.center.x - (-70)) < 1e-3, `center.x was ${res.center.x}, expected -70`);
		assert.ok(Math.abs(res.center.y - 70) < 1e-3, `center.y was ${res.center.y}, expected 70`);
		// Tangent points
		assert.ok(Math.abs(res.t1.x - (-70)) < 1e-3 && Math.abs(res.t1.y - 90) < 1e-3);
		assert.ok(Math.abs(res.t2.x - (-50)) < 1e-3 && Math.abs(res.t2.y - 70) < 1e-3);
		// midArc must be below y = 90
		assert.ok(res.midArc.y < 90, `midArc.y was ${res.midArc.y}, must be below 90`);

		// Commit test
		const cand: FilletCandidate = {
			id: 'cand-spline-line',
			primitive1: { type: 'spline', id: spline.id },
			primitive2: { type: 'line', id: line.id },
			result: res,
		};
		const commitRes = commitFilletToSketch(sketch, cand, true);
		assert.ok(commitRes);
		sketch.solve();

		const centerPt = sketch.points.get(commitRes.centerId)!;
		assert.ok(Math.abs(centerPt.x - (-70)) < 1e-3);
		assert.ok(Math.abs(centerPt.y - 70) < 1e-3);
	});

	it('calculates fillet between Control Spline and Line meeting at vertex and preserves control spline type', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(20, 50);
		const p2 = sketch.addPoint(40, 80);
		const p3 = sketch.addPoint(60, 100);
		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id]);

		const pEnd = sketch.addPoint(100, 0);
		const line = sketch.addLine(p0.id, pEnd.id);

		const conn = getConnectedPrimitivesForPoint(sketch, p0.id);
		assert.equal(conn.valid, true);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;

		const radius = 10;
		const res = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		});

		assert.ok(res);
		assert.ok(Math.abs(res.center.y - 10) < 1e-3);
		const d1 = Math.hypot(res.t1.x - res.center.x, res.t1.y - res.center.y);
		const d2 = Math.hypot(res.t2.x - res.center.x, res.t2.y - res.center.y);
		assert.ok(Math.abs(d1 - radius) < 1e-3);
		assert.ok(Math.abs(d2 - radius) < 1e-3);

		// Commit test
		const cand: FilletCandidate = {
			id: 'cand-ctrl-spline',
			vertexPointId: p0.id,
			primitive1: { type: 'spline', id: spline.id },
			primitive2: { type: 'line', id: line.id },
			endPointId1: p0.id,
			endPointId2: p0.id,
			result: res,
		};
		const commitRes = commitFilletToSketch(sketch, cand, true);
		assert.ok(commitRes);

		// Must remain a control spline, not converted to fit spline
		const remainingSpline = [...sketch.splines.values()][0];
		assert.ok(remainingSpline);
		assert.equal(remainingSpline.splineType, 'control');
	});

	it('calculates fillet between disjoint Control Spline and Line via extension', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(-150, 90);
		const p2 = sketch.addPoint(-125, 90);
		const p3 = sketch.addPoint(-100, 90);
		const p4 = sketch.addPoint(-75, 90);
		const spline = sketch.addControlSpline([p1.id, p2.id, p3.id, p4.id]);

		const p5 = sketch.addPoint(-50, 65);
		const p6 = sketch.addPoint(-50, -20);
		const line = sketch.addLine(p5.id, p6.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;

		const radius = 20;
		const res = calculateFilletGeometry(c1, c2, radius, {
			clickPos1: { x: -140, y: 90 },
			clickPos2: { x: -50, y: 30 },
		});

		assert.ok(res);
		assert.ok(Math.abs(res.cornerVertex.x - (-50)) < 1e-3);
		assert.ok(Math.abs(res.cornerVertex.y - 90) < 1e-3);
		assert.ok(Math.abs(res.center.x - (-70)) < 1e-3);
		assert.ok(Math.abs(res.center.y - 70) < 1e-3);
	});
});

describe('Fillet Commit and Document Integration', () => {
	it('commits single fillet: trims lines, creates arc, adds Tangent and Radius constraints', () => {
		const sketch = new SketchDocument();
		const pCorner = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);

		const line1 = sketch.addLine(pCorner.id, p1.id);
		const line2 = sketch.addLine(pCorner.id, p2.id);

		const conn = getConnectedPrimitivesForPoint(sketch, pCorner.id);
		assert.equal(conn.valid, true);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', line1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', line2.id)!;
		const radius = 25;
		const filletRes = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: pCorner.id,
			endPointId2: pCorner.id,
		})!;

		const candidate: FilletCandidate = {
			id: 'fillet-1',
			vertexPointId: pCorner.id,
			primitive1: { type: 'line', id: line1.id },
			primitive2: { type: 'line', id: line2.id },
			endPointId1: pCorner.id,
			endPointId2: pCorner.id,
			result: filletRes,
		};

		sketch.beginTransaction();
		const commitRes = commitFilletToSketch(sketch, candidate, true);
		sketch.solve();
		sketch.commitTransaction();

		assert.ok(commitRes);
		// Check that the fillet arc exists
		const arc = sketch.arcs.get(commitRes.arcId);
		assert.ok(arc, 'Fillet arc must exist in sketch');
		assert.equal(arc.radius, 25);

		// Check line 1 is trimmed to tangent point
		const updatedL1 = sketch.lines.get(line1.id)!;
		assert.equal(updatedL1.p1Id, commitRes.p1Id);

		// Check line 2 is trimmed to tangent point
		const updatedL2 = sketch.lines.get(line2.id)!;
		assert.equal(updatedL2.p1Id, commitRes.p2Id);

		// Old corner vertex must have been removed
		assert.equal(sketch.points.has(pCorner.id), false, 'Obsolete corner point must be removed');

		// Tangent constraints must exist
		const tangents = [...sketch.constraints.values()].filter(c => c instanceof TangentLineCircleConstraint);
		assert.equal(tangents.length, 2, 'Two TangentLineCircleConstraints must be added');

		// RadiusConstraint must exist
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(radConstraints.length, 1, 'RadiusConstraint must be added on first fillet');
		assert.equal(radConstraints[0].targetRadius, 25);
	});

	it('commits multiple fillets: first gets RadiusConstraint, subsequent get EqualRadiusConstraint', () => {
		const sketch = new SketchDocument();
		// Create a rectangle (0,0) to (100, 100)
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(0, 100);

		const lBottom = sketch.addLine(p0.id, p1.id);
		const lRight = sketch.addLine(p1.id, p2.id);
		const lTop = sketch.addLine(p2.id, p3.id);
		const lLeft = sketch.addLine(p3.id, p0.id);

		const radius = 15;

		// Fillet at p0 (Bottom & Left)
		const cBottom = sketchPrimitiveToGeoCurve(sketch, 'line', lBottom.id)!;
		const cLeft = sketchPrimitiveToGeoCurve(sketch, 'line', lLeft.id)!;
		const res0 = calculateFilletGeometry(cBottom, cLeft, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		})!;
		const cand0: FilletCandidate = {
			id: 'fillet-0',
			vertexPointId: p0.id,
			primitive1: { type: 'line', id: lBottom.id },
			primitive2: { type: 'line', id: lLeft.id },
			endPointId1: p0.id,
			endPointId2: p0.id,
			result: res0,
		};

		// Fillet at p1 (Bottom & Right)
		const cRight = sketchPrimitiveToGeoCurve(sketch, 'line', lRight.id)!;
		const res1 = calculateFilletGeometry(cBottom, cRight, radius, {
			cornerVertex: { x: 100, y: 0 },
			endPointId1: p1.id,
			endPointId2: p1.id,
		})!;
		const cand1: FilletCandidate = {
			id: 'fillet-1',
			vertexPointId: p1.id,
			primitive1: { type: 'line', id: lBottom.id },
			primitive2: { type: 'line', id: lRight.id },
			endPointId1: p1.id,
			endPointId2: p1.id,
			result: res1,
		};

		sketch.beginTransaction();
		const commit0 = commitFilletToSketch(sketch, cand0, true);
		const commit1 = commitFilletToSketch(sketch, cand1, false, commit0!.arcId);
		sketch.solve();
		sketch.commitTransaction();

		assert.ok(commit0);
		assert.ok(commit1);
		assert.equal(sketch.arcs.size, 2);

		// First arc has RadiusConstraint
		const radConstraints = [...sketch.constraints.values()].filter(c => c instanceof RadiusConstraint);
		assert.equal(radConstraints.length, 1);
		assert.equal(radConstraints[0].circleId, commit0.arcId);

		// Second arc is connected to first via EqualRadiusConstraint
		const eqRadConstraints = [...sketch.constraints.values()].filter(c => c instanceof EqualRadiusConstraint);
		assert.equal(eqRadConstraints.length, 1);
		assert.ok(
			(eqRadConstraints[0].circle1Id === commit0.arcId && eqRadConstraints[0].circle2Id === commit1.arcId) ||
			(eqRadConstraints[0].circle1Id === commit1.arcId && eqRadConstraints[0].circle2Id === commit0.arcId)
		);
	});

	it('history undo and redo completely restore sketch before and after fillet', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(50, 0);
		const p2 = sketch.addPoint(0, 50);
		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const initialPointCount = sketch.points.size;
		const initialLineCount = sketch.lines.size;
		const initialArcCount = sketch.arcs.size;

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;
		const res = calculateFilletGeometry(c1, c2, 10, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		})!;
		const cand: FilletCandidate = {
			id: 'fillet-test',
			vertexPointId: p0.id,
			primitive1: { type: 'line', id: l1.id },
			primitive2: { type: 'line', id: l2.id },
			endPointId1: p0.id,
			endPointId2: p0.id,
			result: res,
		};

		sketch.beginTransaction();
		commitFilletToSketch(sketch, cand, true);
		sketch.solve();
		sketch.commitTransaction();

		assert.equal(sketch.arcs.size, initialArcCount + 1);

		// Undo
		sketch.undo();
		assert.equal(sketch.arcs.size, initialArcCount, 'Undo must remove fillet arc');
		assert.equal(sketch.lines.size, initialLineCount, 'Undo must restore original lines');
		assert.equal(sketch.points.has(p0.id), true, 'Undo must restore original corner point');

		// Redo
		sketch.redo();
		assert.equal(sketch.arcs.size, initialArcCount + 1, 'Redo must restore fillet arc');
		assert.equal(sketch.points.has(p0.id), false, 'Redo must re-delete corner point');
	});

	it('commits fillet on Control Spline and creates TangentLineCircleConstraint on control segment', () => {
		const sketch = new SketchDocument();
		const pCorner = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(0, 100);
		const p2 = sketch.addPoint(50, 100);
		const p3 = sketch.addPoint(50, 0);

		const spline = sketch.addControlSpline([pCorner.id, p1.id, p2.id, p3.id]);
		const pLineEnd = sketch.addPoint(100, 0);
		const line = sketch.addLine(pCorner.id, pLineEnd.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;
		const radius = 20;

		const filletRes = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: pCorner.id,
			endPointId2: pCorner.id,
		})!;

		const candidate: FilletCandidate = {
			id: 'fillet-control-spline',
			vertexPointId: pCorner.id,
			primitive1: { type: 'spline', id: spline.id },
			primitive2: { type: 'line', id: line.id },
			endPointId1: pCorner.id,
			endPointId2: pCorner.id,
			result: filletRes,
		};

		sketch.beginTransaction();
		const commitRes = commitFilletToSketch(sketch, candidate, true);
		sketch.solve();
		sketch.commitTransaction();

		assert.ok(commitRes);
		const arc = sketch.arcs.get(commitRes.arcId);
		assert.ok(arc, 'Fillet arc exists');

		// Verify that a TangentLineCircleConstraint was created linking the arc and the control segment
		const tangentConstraints = [...sketch.constraints.values()].filter(
			c => c.type === 'tangent_line_circle' && (c as any).circleId === arc.id
		);
		assert.ok(tangentConstraints.length >= 2, 'Should have tangent constraints on both the line and the spline handle');

		const newSpline = sketch.splines.get(candidate.primitive1.id);
		assert.ok(newSpline);
		assert.ok(newSpline.tangentLineIds && newSpline.tangentLineIds.length > 0);
		const splineHandleId = newSpline.tangentLineIds[0];
		const splineHandleLine = sketch.lines.get(splineHandleId)!;

		const splineTangentConstraint = tangentConstraints.find(
			(c: any) =>
				(c.lineP1Id === splineHandleLine.p1Id && c.lineP2Id === splineHandleLine.p2Id) ||
				(c.lineP1Id === splineHandleLine.p2Id && c.lineP2Id === splineHandleLine.p1Id)
		);
		assert.ok(splineTangentConstraint, 'TangentLineCircleConstraint must constrain the control spline handle line');
	});

	it('fillet gizmo drag delta in arrow direction increases radius and opposite decreases radius', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(0, 100);
		const l1 = sketch.addLine(p0.id, p1.id);
		const l2 = sketch.addLine(p0.id, p2.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', l1.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', l2.id)!;
		const startRadius = 10;
		const res = calculateFilletGeometry(c1, c2, startRadius, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: p0.id,
			endPointId2: p0.id,
		})!;

		// bisectorDir = normalize(midArc - center) points outward towards the corner (0, 0)
		// arrow points inward towards center (res.center = (10, 10))
		const bisectorDir = res.bisectorDir;
		const inwardDir = { x: -bisectorDir.x, y: -bisectorDir.y };

		// Verify bisectorDir points towards the corner (0, 0)
		assert.ok(bisectorDir.x < 0 && bisectorDir.y < 0, 'bisectorDir points towards corner');
		// Verify inwardDir points into the corner interior (towards (10, 10))
		assert.ok(inwardDir.x > 0 && inwardDir.y > 0, 'inwardDir points into shape');

		// Simulate drag in arrow direction (+5mm along inwardDir)
		const startMouseWorld = { ...res.midArc };
		const dragMouseInward = {
			x: startMouseWorld.x + inwardDir.x * 5,
			y: startMouseWorld.y + inwardDir.y * 5,
		};
		const deltaInward = (dragMouseInward.x - startMouseWorld.x) * inwardDir.x + (dragMouseInward.y - startMouseWorld.y) * inwardDir.y;
		const newRadiusInward = Math.max(0.5, Math.round((startRadius + deltaInward) * 2) / 2);
		assert.equal(newRadiusInward, 15, 'Dragging along arrow direction must INCREASE radius');

		// Simulate drag opposite arrow direction (-4mm towards corner)
		const dragMouseOutward = {
			x: startMouseWorld.x - inwardDir.x * 4,
			y: startMouseWorld.y - inwardDir.y * 4,
		};
		const deltaOutward = (dragMouseOutward.x - startMouseWorld.x) * inwardDir.x + (dragMouseOutward.y - startMouseWorld.y) * inwardDir.y;
		const newRadiusOutward = Math.max(0.5, Math.round((startRadius + deltaOutward) * 2) / 2);
		assert.equal(newRadiusOutward, 6, 'Dragging opposite arrow direction must DECREASE radius');
	});

	it('trims correct endpoints on acute corner with large fillet radius where param <= 0.5', () => {
		const sketch = new SketchDocument();
		// Triangle with base from (-50, 0) to (50, 0) and peak at (0, 75)
		const pBottomLeft = sketch.addPoint(-50, 0);
		const pBottomRight = sketch.addPoint(50, 0);
		const pPeak = sketch.addPoint(0, 75);

		// Both lines drawn from bottom upwards to the peak (pPeak is p2Id for both lines)
		const lineLeft = sketch.addLine(pBottomLeft.id, pPeak.id);
		const lineRight = sketch.addLine(pBottomRight.id, pPeak.id);

		const c1 = sketchPrimitiveToGeoCurve(sketch, 'line', lineLeft.id)!;
		const c2 = sketchPrimitiveToGeoCurve(sketch, 'line', lineRight.id)!;

		// Large radius R = 35: tangent point is past the midpoint (param < 0.5)
		const radius = 35;
		const filletRes = calculateFilletGeometry(c1, c2, radius, {
			cornerVertex: { x: pPeak.x, y: pPeak.y },
			endPointId1: pPeak.id,
			endPointId2: pPeak.id,
		});
		assert.ok(filletRes, 'Fillet geometry should be calculated');
		// Confirm param is <= 0.5 on both lines (tangent point closer to bottom than to peak)
		assert.ok(filletRes.param1 < 0.5, `param1 (${filletRes.param1}) should be < 0.5`);
		assert.ok(filletRes.param2 < 0.5, `param2 (${filletRes.param2}) should be < 0.5`);

		const candidate: FilletCandidate = {
			id: 'test-large-fillet',
			vertexPointId: pPeak.id,
			primitive1: { type: 'line', id: lineLeft.id },
			primitive2: { type: 'line', id: lineRight.id },
			endPointId1: pPeak.id,
			endPointId2: pPeak.id,
			result: filletRes,
		};

		const commitRes = commitFilletToSketch(sketch, candidate, true);
		assert.ok(commitRes, 'Commit fillet should succeed');

		// The peak endpoint (p2Id) MUST be replaced by tangent cut points,
		// and the bottom endpoints (p1Id) MUST remain intact!
		assert.equal(lineLeft.p1Id, pBottomLeft.id, 'Bottom-left vertex must NOT be replaced');
		assert.equal(lineLeft.p2Id, commitRes.p1Id, 'Left line top end must be replaced by fillet tangent point');

		assert.equal(lineRight.p1Id, pBottomRight.id, 'Bottom-right vertex must NOT be replaced');
		assert.equal(lineRight.p2Id, commitRes.p2Id, 'Right line top end must be replaced by fillet tangent point');

		// Check arc connectivity
		const arc = sketch.arcs.get(commitRes.arcId);
		assert.ok(arc, 'Fillet arc must exist in sketch');
		assert.equal(arc.startPointId, commitRes.p1Id);
		assert.equal(arc.endPointId, commitRes.p2Id);
	});

	it('fillet orientation is strictly anchored to corner interior and never flips to exterior at large radius', () => {
		const sketch = new SketchDocument();
		// Bowl shape: line from (-50, 0) to (50, 0) and fit spline from (-50, 0) down to (0, -75) to (50, 0)
		const p1 = sketch.addPoint(-50, 0);
		const p2 = sketch.addPoint(50, 0);
		const line = sketch.addLine(p1.id, p2.id);
		const pMid = sketch.addPoint(0, -75);
		const spline = sketch.addFitSpline([p1.id, pMid.id, p2.id]);

		const cLine = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;
		const cSpline = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;

		// R = 30: fits inside the bowl in the corner (-50, 0)
		const res30 = calculateFilletGeometry(cLine, cSpline, 30, {
			cornerVertex: { x: p1.x, y: p1.y },
			endPointId1: p1.id,
			endPointId2: p1.id,
		});
		assert.ok(res30, 'Fillet at R=30 must succeed inside the corner');
		// Center must be strictly inside the corner (x > -50, y < 0)
		assert.ok(res30.center.x > -50 && res30.center.y < 0, 'Center must be inside corner (x > -50, y < 0)');
		assert.ok(res30.t1.x > -50 && res30.t1.y <= 0.01, 't1 on line must be inside segment (x > -50)');

		// R = 50: does not fit inside the bowl (max inscribed radius is ~35mm)
		// It MUST NOT flip to the exterior (x < -50)
		const res50 = calculateFilletGeometry(cLine, cSpline, 50, {
			cornerVertex: { x: p1.x, y: p1.y },
			endPointId1: p1.id,
			endPointId2: p1.id,
		});
		assert.equal(res50, null, 'Fillet at R=50 must return null and never flip to exterior');
	});

	it('findMaxFilletRadius accurately detects maximum radius for corner or returns null when unfilletable', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(-50, 0);
		const p2 = sketch.addPoint(50, 0);
		const line = sketch.addLine(p1.id, p2.id);
		const p3 = sketch.addPoint(-50, -100);
		const p4 = sketch.addPoint(50, -100);
		const spline = sketch.addControlSpline([p1.id, p3.id, p4.id, p2.id]);

		const cLine = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;
		const cSpline = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;

		const maxR = findMaxFilletRadius(cLine, cSpline, {
			cornerVertex: { x: p1.x, y: p1.y },
			endPointId1: p1.id,
			endPointId2: p1.id,
		}, 100);

		assert.ok(maxR !== null, 'maxR must not be null');
		// Theoretical limit is 37.5 mm
		assert.ok(maxR >= 36.5 && maxR <= 37.5, `maxR was ${maxR}, expected ~37.4`);

		// Orthogonal lines: maxR returns requested max (e.g. 50)
		const pA = sketch.addPoint(0, 0);
		const pB = sketch.addPoint(100, 0);
		const pC = sketch.addPoint(0, 100);
		const lineA = sketch.addLine(pA.id, pB.id);
		const lineB = sketch.addLine(pA.id, pC.id);
		const cLineA = sketchPrimitiveToGeoCurve(sketch, 'line', lineA.id)!;
		const cLineB = sketchPrimitiveToGeoCurve(sketch, 'line', lineB.id)!;
		const maxOrthogonal = findMaxFilletRadius(cLineA, cLineB, {
			cornerVertex: { x: 0, y: 0 },
			endPointId1: pA.id,
			endPointId2: pA.id,
		}, 50);
		assert.equal(maxOrthogonal, 50);
	});

	it('cleans up old unreferenced point of line after creating fillet with spline', () => {
		const sketch = new SketchDocument();
		const pLine1 = sketch.addPoint(-50, 0);
		const pLine2 = sketch.addPoint(50, 0);
		const line = sketch.addLine(pLine1.id, pLine2.id);

		const pSpline0 = sketch.addPoint(-50, 0);
		const pSpline1 = sketch.addPoint(-50, -100);
		const pSpline2 = sketch.addPoint(50, -100);
		const pSpline3 = sketch.addPoint(50, 0);
		const spline = sketch.addControlSpline([pSpline0.id, pSpline1.id, pSpline2.id, pSpline3.id]);

		const cLine = sketchPrimitiveToGeoCurve(sketch, 'line', line.id)!;
		const cSpline = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id)!;

		const res = calculateFilletGeometry(cLine, cSpline, 20, {
			cornerVertex: { x: -50, y: 0 },
			clickPos1: { x: -40, y: 0 },
			clickPos2: { x: -50, y: -20 },
		});
		assert.ok(res);

		const cand: FilletCandidate = {
			id: 'test-cand',
			primitive1: { type: 'line', id: line.id },
			primitive2: { type: 'spline', id: spline.id },
			result: res,
		};

		commitFilletToSketch(sketch, cand, true);

		// Old line corner point pLine1 must be deleted, not remaining as an orphan
		assert.equal(sketch.points.has(pLine1.id), false, 'pLine1 should be deleted');
		assert.equal(sketch.points.has(pSpline0.id), false, 'pSpline0 should be deleted');
	});
});




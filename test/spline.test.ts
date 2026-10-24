import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	bsplineToBezier,
	fitPointsToBezier,
	computeNaturalFitHandles,
	evaluateBezier,
	splitBezier,
	getSplinePointAtParam,
	getSplineParamAtPoint,
	extractSplineInterval,
	getSplineSvgPath,
	type BezierSegment,
} from '../src/math/spline';
import { SketchDocument } from '../src/model/sketch';
import { MidpointConstraint } from '../src/solver/constraints';
import {
	getAllGeoCurves,
	intersectSplineCurve,
	getTrimCandidate,
	executeTrim,
	executeBreak,
	type GeoSpline,
	type GeoSegment,
} from '../src/math/intersection';

describe('Spline Mathematics', () => {
	it('bsplineToBezier converts cubic B-spline to Bezier segments', () => {
		// 4 control points produce exactly 1 cubic Bezier segment
		const p4 = [
			{ x: 0, y: 0 },
			{ x: 10, y: 20 },
			{ x: 30, y: 20 },
			{ x: 40, y: 0 },
		];
		const segs4 = bsplineToBezier(p4);
		assert.equal(segs4.length, 1);
		assert.ok(Math.abs(segs4[0][0].x - 0) < 1e-4);
		assert.ok(Math.abs(segs4[0][0].y - 0) < 1e-4);
		assert.ok(Math.abs(segs4[0][3].x - 40) < 1e-4);
		assert.ok(Math.abs(segs4[0][3].y - 0) < 1e-4);

		// 5 control points produce 2 cubic Bezier segments with C0 continuity
		const p5 = [
			{ x: 0, y: 0 },
			{ x: 10, y: 30 },
			{ x: 25, y: -20 },
			{ x: 40, y: 30 },
			{ x: 50, y: 0 },
		];
		const segs5 = bsplineToBezier(p5);
		assert.equal(segs5.length, 2);
		// Segment 0 end should match Segment 1 start
		assert.ok(Math.abs(segs5[0][3].x - segs5[1][0].x) < 1e-4);
		assert.ok(Math.abs(segs5[0][3].y - segs5[1][0].y) < 1e-4);
		// Clamped endpoints
		assert.ok(Math.abs(segs5[0][0].x - 0) < 1e-4);
		assert.ok(Math.abs(segs5[1][3].x - 50) < 1e-4);
	});

	it('computeNaturalFitHandles calculates tangent handles with midpoint at fit point', () => {
		const pts = [
			{ x: 0, y: 0 },
			{ x: 50, y: 50 },
			{ x: 100, y: 0 },
		];
		const handles = computeNaturalFitHandles(pts);
		assert.equal(handles.length, 3);

		// Every fit point must be the midpoint of h1 and h2
		for (let i = 0; i < pts.length; i++) {
			const midX = (handles[i].h1.x + handles[i].h2.x) / 2;
			const midY = (handles[i].h1.y + handles[i].h2.y) / 2;
			assert.ok(Math.abs(midX - pts[i].x) < 1e-4, `Point ${i} X midpoint`);
			assert.ok(Math.abs(midY - pts[i].y) < 1e-4, `Point ${i} Y midpoint`);
		}
	});

	it('computeNaturalFitHandles handles closed loop splines', () => {
		// 4 points in a circle-like arrangement, closed (first === last)
		const pts = [
			{ x: 0, y: 50 },
			{ x: 50, y: 100 },
			{ x: 100, y: 50 },
			{ x: 50, y: 0 },
			{ x: 0, y: 50 }, // closed loop endpoint
		];
		const handles = computeNaturalFitHandles(pts);
		assert.equal(handles.length, 5);

		// First and last handle tangents should be identical
		const tan0X = handles[0].h2.x - handles[0].h1.x;
		const tan0Y = handles[0].h2.y - handles[0].h1.y;
		const tanLastX = handles[4].h2.x - handles[4].h1.x;
		const tanLastY = handles[4].h2.y - handles[4].h1.y;
		assert.ok(Math.abs(tan0X - tanLastX) < 1e-4);
		assert.ok(Math.abs(tan0Y - tanLastY) < 1e-4);
	});

	it('fitPointsToBezier for 4 points of a square closely approximates a circle', () => {
		// 4 points on circle of radius R=50 centered at (50, 50)
		const R = 50;
		const cx = 50, cy = 50;
		const pts = [
			{ x: cx + R, y: cy },
			{ x: cx, y: cy + R },
			{ x: cx - R, y: cy },
			{ x: cx, y: cy - R },
			{ x: cx + R, y: cy },
		];
		const segs = fitPointsToBezier(pts);
		assert.equal(segs.length, 4);

		// Sample each segment at t=0.5 and verify radial distance to center is within 0.5% of R
		for (let i = 0; i < 4; i++) {
			const mid = evaluateBezier(segs[i], 0.5);
			const r = Math.hypot(mid.x - cx, mid.y - cy);
			assert.ok(Math.abs(r - R) / R < 0.005, `Segment ${i} radius error ${Math.abs(r - R)}`);
		}
	});

	it('fitPointsToBezier produces valid cubic segments passing through fit points', () => {
		const pts = [
			{ x: 0, y: 0 },
			{ x: 30, y: 40 },
			{ x: 70, y: 20 },
			{ x: 100, y: 50 },
		];
		const segs = fitPointsToBezier(pts);
		assert.equal(segs.length, 3);

		for (let i = 0; i < segs.length; i++) {
			assert.ok(Math.abs(segs[i][0].x - pts[i].x) < 1e-4);
			assert.ok(Math.abs(segs[i][0].y - pts[i].y) < 1e-4);
			assert.ok(Math.abs(segs[i][3].x - pts[i + 1].x) < 1e-4);
			assert.ok(Math.abs(segs[i][3].y - pts[i + 1].y) < 1e-4);
		}
	});

	it('evaluateBezier and splitBezier evaluate and subdivide curves accurately', () => {
		const seg: BezierSegment = [
			{ x: 0, y: 0 },
			{ x: 0, y: 50 },
			{ x: 100, y: 50 },
			{ x: 100, y: 0 },
		];

		const start = evaluateBezier(seg, 0);
		const end = evaluateBezier(seg, 1);
		const mid = evaluateBezier(seg, 0.5);

		assert.ok(Math.abs(start.x - 0) < 1e-4 && Math.abs(start.y - 0) < 1e-4);
		assert.ok(Math.abs(end.x - 100) < 1e-4 && Math.abs(end.y - 0) < 1e-4);
		assert.ok(Math.abs(mid.x - 50) < 1e-4);
		assert.ok(mid.y > 0);

		const { left, right } = splitBezier(seg, 0.5);
		assert.ok(Math.abs(left[0].x - 0) < 1e-4);
		assert.ok(Math.abs(left[3].x - mid.x) < 1e-4);
		assert.ok(Math.abs(left[3].y - mid.y) < 1e-4);
		assert.ok(Math.abs(right[0].x - mid.x) < 1e-4);
		assert.ok(Math.abs(right[0].y - mid.y) < 1e-4);
		assert.ok(Math.abs(right[3].x - 100) < 1e-4);
	});

	it('getSplinePointAtParam and getSplineParamAtPoint round-trip', () => {
		const segs: BezierSegment[] = [
			[{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 40, y: 0 }],
			[{ x: 40, y: 0 }, { x: 50, y: -20 }, { x: 70, y: -20 }, { x: 80, y: 0 }],
		];

		const targetParam = 0.65;
		const pt = getSplinePointAtParam(segs, targetParam);
		const res = getSplineParamAtPoint(segs, pt);
		assert.ok(Math.abs(res.param - targetParam) < 1e-2);
	});

	it('extractSplineInterval extracts subsegment correctly', () => {
		const segs: BezierSegment[] = [
			[{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 30, y: 30 }, { x: 40, y: 0 }],
		];

		const sub = extractSplineInterval(segs, 0.25, 0.75);
		assert.ok(sub.length >= 1);
		const pStart = getSplinePointAtParam(segs, 0.25);
		const pEnd = getSplinePointAtParam(segs, 0.75);

		assert.ok(Math.abs(sub[0][0].x - pStart.x) < 1e-3);
		assert.ok(Math.abs(sub[0][0].y - pStart.y) < 1e-3);
		assert.ok(Math.abs(sub[sub.length - 1][3].x - pEnd.x) < 1e-3);
		assert.ok(Math.abs(sub[sub.length - 1][3].y - pEnd.y) < 1e-3);
	});

	it('getSplineSvgPath creates valid path data and closes with Z when isClosed is true', () => {
		const segs: BezierSegment[] = [
			[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 0 }],
		];
		const openPath = getSplineSvgPath(segs, p => p, false);
		assert.ok(openPath.startsWith('M 0.00 0.00 C 10.00 10.00'));
		assert.ok(!openPath.endsWith('Z'));

		const closedPath = getSplineSvgPath(segs, p => p, true);
		assert.ok(closedPath.endsWith('Z'));
	});
});

describe('SketchDocument Spline Integration', () => {
	it('addFitSpline creates spline with tangent lines and midpoint constraints', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 40);
		const p3 = sketch.addPoint(100, 0);

		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);
		assert.equal(spline.splineType, 'fit');
		assert.equal(spline.pointIds.length, 3);
		assert.ok(spline.tangentLineIds && spline.tangentLineIds.length === 3);

		// Verify tangent lines and midpoint constraints
		for (let i = 0; i < spline.tangentLineIds.length; i++) {
			const lineId = spline.tangentLineIds[i];
			const line = sketch.lines.get(lineId);
			assert.ok(line, `Tangent line ${lineId} exists`);
			assert.equal(line.isSplineHandle, true);
			assert.equal(line.parentSplineId, spline.id);

			// Corresponding midpoint constraint
			const midPtId = spline.pointIds[i];
			const midC = Array.from(sketch.constraints.values()).find(
				c => c instanceof MidpointConstraint && c.midId === midPtId &&
				((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
			);
			assert.ok(midC, `Midpoint constraint exists for fit point ${midPtId}`);
		}

		// isPointUsed
		assert.ok(sketch.isPointUsed(p1.id));
		assert.ok(sketch.isPointUsed(p2.id));
		assert.ok(sketch.isPointUsed(p3.id));
		const handleLine0 = sketch.lines.get(spline.tangentLineIds[0])!;
		assert.ok(sketch.isPointUsed(handleLine0.p1Id));
		assert.ok(sketch.isPointUsed(handleLine0.p2Id));
	});

	it('addControlSpline creates control point spline', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(20, 50);
		const p3 = sketch.addPoint(70, 50);
		const p4 = sketch.addPoint(90, 0);

		const spline = sketch.addControlSpline([p1.id, p2.id, p3.id, p4.id]);
		assert.equal(spline.splineType, 'control');
		assert.equal(spline.pointIds.length, 4);
		assert.equal(sketch.splines.size, 1);
		assert.ok(sketch.isPointUsed(p2.id));
	});

	it('addFitSpline creates closed loop with isClosed true when endpoints coincident', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 50);
		const p2 = sketch.addPoint(50, 100);
		const p3 = sketch.addPoint(100, 50);
		const p4 = sketch.addPoint(50, 0);

		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id, p4.id, p1.id]);
		assert.equal(spline.isClosed, true);
		assert.equal(spline.pointIds.length, 5);
		assert.equal(spline.pointIds[0], spline.pointIds[spline.pointIds.length - 1]);
	});

	it('deleting fit spline cascades to tangent lines and midpoint constraints', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 30);
		const p3 = sketch.addPoint(100, 0);

		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);
		assert.equal(sketch.lines.size, 3);
		assert.equal(sketch.constraints.size, 3);

		sketch.removeEntity(spline.id);
		assert.equal(sketch.splines.size, 0);
		assert.equal(sketch.lines.size, 0, 'Tangent lines deleted');
		assert.equal(sketch.constraints.size, 0, 'Midpoint constraints deleted');
	});

	it('deleting a fit point keeps the fit spline intact if >= 2 points remain', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 30);
		const p3 = sketch.addPoint(100, 0);

		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);
		assert.equal(spline.pointIds.length, 3);
		assert.equal(spline.tangentLineIds?.length, 3);

		// Delete middle fit point p2
		sketch.removeEntity(p2.id);

		assert.equal(sketch.splines.size, 1, 'Spline survives with 2 remaining points');
		assert.equal(spline.pointIds.length, 2, 'Spline pointIds reduced to 2');
		assert.deepEqual(spline.pointIds, [p1.id, p3.id]);
		assert.equal(spline.tangentLineIds?.length, 2, 'Tangent handles reduced to 2');

		// Now delete p1: only 1 point left, so spline cannot survive
		sketch.removeEntity(p1.id);
		assert.equal(sketch.splines.size, 0, 'Spline cascades to delete when < 2 points remain');
		assert.equal(sketch.lines.size, 0, 'All handles deleted');
	});

	it('deleting a control point keeps control spline intact if >= 4 points remain', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(20, 50);
		const p2 = sketch.addPoint(50, 50);
		const p3 = sketch.addPoint(80, 50);
		const p4 = sketch.addPoint(100, 0);

		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id, p4.id]);
		assert.equal(spline.pointIds.length, 5);

		// Delete middle control point p2
		sketch.removeEntity(p2.id);

		assert.equal(sketch.splines.size, 1, 'Control spline survives with 4 points');
		assert.equal(spline.pointIds.length, 4);
		assert.deepEqual(spline.pointIds, [p0.id, p1.id, p3.id, p4.id]);

		// Now delete another control point: only 3 remain, so cubic spline cannot survive
		sketch.removeEntity(p0.id);
		assert.equal(sketch.splines.size, 0, 'Control spline deleted when < 4 points remain');
	});

	it('cannot delete tangent handle lines or tangent handle points directly', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 30);

		const spline = sketch.addFitSpline([p1.id, p2.id]);
		assert.equal(spline.tangentLineIds?.length, 2);

		const handleLineId = spline.tangentLineIds![0];
		const handleLine = sketch.lines.get(handleLineId)!;
		const handlePtId = handleLine.p1Id;

		// Attempt to delete handle line directly
		sketch.removeEntity(handleLineId);
		assert.ok(sketch.lines.has(handleLineId), 'Tangent handle line must NOT be deleted directly');

		// Attempt to delete handle point directly
		sketch.removeEntity(handlePtId);
		assert.ok(sketch.points.has(handlePtId), 'Tangent handle point must NOT be deleted directly');

		// Attempt to delete via deleteSelected
		sketch.selection.lineIds.add(handleLineId);
		sketch.selection.pointIds.add(handlePtId);
		sketch.deleteSelected();
		assert.ok(sketch.lines.has(handleLineId), 'deleteSelected must ignore tangent handle lines');
		assert.ok(sketch.points.has(handlePtId), 'deleteSelected must ignore tangent handle points');
	});

	it('undo and redo properly restore splines and their handles', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 30);
		const p3 = sketch.addPoint(100, 0);

		sketch.addFitSpline([p1.id, p2.id, p3.id]);
		assert.equal(sketch.splines.size, 1);
		assert.equal(sketch.lines.size, 3);

		// Undo creation
		sketch.undo();
		assert.equal(sketch.splines.size, 0);
		assert.equal(sketch.lines.size, 0);

		// Redo creation
		sketch.redo();
		assert.equal(sketch.splines.size, 1);
		assert.equal(sketch.lines.size, 3);
	});

	it('internal spline midpoint constraints are hidden from entity constraints and protected from removal', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 50);
		const spline = sketch.addFitSpline([p1.id, p2.id]);
		assert.equal(spline.tangentLineIds?.length, 2);

		const handleLineId = spline.tangentLineIds![0];
		const handleLine = sketch.lines.get(handleLineId)!;

		// Find the internal midpoint constraint
		const internalC = [...sketch.constraints.values()].find(c => sketch.isSplineInternalConstraint(c));
		assert.ok(internalC, 'Internal midpoint constraint must exist');

		// getConstraintsForEntity on fit point (p1) must NOT return the internal constraint
		const p1Constraints = sketch.getConstraintsForEntity('point', p1.id);
		assert.ok(!p1Constraints.some(c => c.id === internalC.id), 'Fit point must not list internal midpoint constraint');

		// getConstraintsForEntity on handle line must NOT return the internal constraint
		const lineConstraints = sketch.getConstraintsForEntity('line', handleLineId);
		assert.ok(!lineConstraints.some(c => c.id === internalC.id), 'Handle line must not list internal midpoint constraint');

		// getConstraintsForEntity on handle endpoint must NOT return the internal constraint
		const handlePtConstraints = sketch.getConstraintsForEntity('point', handleLine.p1Id);
		assert.ok(!handlePtConstraints.some(c => c.id === internalC.id), 'Handle endpoint must not list internal midpoint constraint');

		// removeConstraint must ignore internal constraints
		sketch.removeConstraint(internalC.id);
		assert.ok(sketch.constraints.has(internalC.id), 'removeConstraint must not delete internal constraint');

		// deleteSelected must ignore internal constraints even if in selection
		sketch.selection.constraintIds.add(internalC.id);
		sketch.deleteSelected();
		assert.ok(sketch.constraints.has(internalC.id), 'deleteSelected must not delete internal constraint');

		// Regular user midpoint constraint is NOT internal
		const up1 = sketch.addPoint(100, 100);
		const up2 = sketch.addPoint(200, 200);
		const uline = sketch.addLine(up1.id, up2.id);
		const umidPt = sketch.addPoint(150, 150);
		const userMidC = sketch.addMidpointConstraint(umidPt.id, uline.id);
		assert.ok(userMidC);
		assert.equal(sketch.isSplineInternalConstraint(userMidC), false, 'User midpoint constraint must not be considered internal');
		const userLineConstraints = sketch.getConstraintsForEntity('line', uline.id);
		assert.ok(userLineConstraints.some(c => c.id === userMidC.id), 'User midpoint constraint must be returned for line');
	});
});

describe('Spline Intersections, Trim, and Break', () => {
	it('intersectSplineCurve finds intersections between spline and line', () => {
		const segs: BezierSegment[] = [
			[{ x: 0, y: 0 }, { x: 25, y: 50 }, { x: 75, y: 50 }, { x: 100, y: 0 }],
		];
		const geoSpline: GeoSpline = {
			type: 'spline',
			id: 'sp1',
			splineType: 'fit',
			pointIds: ['p0', 'p1', 'p2', 'p3'],
			points: [{ x: 0, y: 0 }, { x: 25, y: 50 }, { x: 75, y: 50 }, { x: 100, y: 0 }],
			bezierSegments: segs,
		};

		// Horizontal line intersecting the arch at y = 25
		const line: GeoSegment = {
			type: 'segment',
			id: 'l1',
			p1: { x: -10, y: 25 },
			p2: { x: 110, y: 25 },
		};

		const pts = intersectSplineCurve(geoSpline, line);
		assert.equal(pts.length, 2, 'Arch should intersect horizontal line at 2 points');
		assert.ok(pts[0].x > 0 && pts[0].x < 50);
		assert.ok(Math.abs(pts[0].y - 25) < 1e-3);
		assert.ok(pts[1].x > 50 && pts[1].x < 100);
		assert.ok(Math.abs(pts[1].y - 25) < 1e-3);
	});

	it('executeBreak splits spline into two splines at intersection', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 50);
		const p3 = sketch.addPoint(100, 0);
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);

		// Crossing line at x=50, y from -10 to 60
		const lp1 = sketch.addPoint(50, -10);
		const lp2 = sketch.addPoint(50, 60);
		sketch.addLine(lp1.id, lp2.id);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = allCurves.find(c => c.id === spline.id) as GeoSpline;
		assert.ok(spCurve);

		const candidate = getTrimCandidate(spCurve, allCurves, { x: 25, y: 30 });
		assert.ok(candidate);

		executeBreak(sketch, candidate);

		// Original spline should be replaced by 2 splines
		assert.equal(sketch.splines.size, 2);
	});

	it('executeTrim trims the end of a spline intersected by a line', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 50);
		const p3 = sketch.addPoint(100, 0);
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);

		// Vertical cutting line at x=50
		const lp1 = sketch.addPoint(50, -10);
		const lp2 = sketch.addPoint(50, 60);
		sketch.addLine(lp1.id, lp2.id);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = allCurves.find(c => c.id === spline.id) as GeoSpline;
		assert.ok(spCurve);

		const candidate = getTrimCandidate(spCurve, allCurves, { x: 80, y: 20 });
		assert.ok(candidate, 'Trim candidate found for right branch');
		assert.equal(candidate.curve.id, spline.id);

		executeTrim(sketch, candidate);
		// Remaining spline should exist
		assert.equal(sketch.splines.size, 1);
	});

	it('trim on closed spline removes clicked interval and leaves single open spline without start/end seam', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(100, 50);
		const p2 = sketch.addPoint(50, 100);
		const p3 = sketch.addPoint(0, 50);
		const p4 = sketch.addPoint(50, 0);

		// Closed spline passing through 4 cardinal points
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id, p4.id, p1.id]);
		assert.equal(spline.isClosed, true);

		// Horizontal cutting line at y=50 cutting through p1 and p3
		const lp1 = sketch.addPoint(-20, 50);
		const lp2 = sketch.addPoint(120, 50);
		sketch.addLine(lp1.id, lp2.id);

		const allCurves = getAllGeoCurves(sketch);
		const spCurve = allCurves.find(c => c.id === spline.id) as GeoSpline;
		assert.ok(spCurve);

		// Click top half near (50, 90)
		const candidate = getTrimCandidate(spCurve, allCurves, { x: 50, y: 90 });
		assert.ok(candidate);
		assert.equal(candidate.isWholeEntity, false);

		executeTrim(sketch, candidate);

		// Exactly ONE open spline remains (the bottom half)
		assert.equal(sketch.splines.size, 1);
		const remaining = Array.from(sketch.splines.values())[0];
		assert.equal(remaining.isClosed, false);
		// Bottom half should preserve p4 and include the two cuts, without generating random intermediate sample points
		assert.ok(remaining.pointIds.includes(p4.id));
	});

	it('trim and break on closed spline preserve exact circular shape with zero distortion', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 50);
		const p2 = sketch.addPoint(50, 100);
		const p3 = sketch.addPoint(100, 50);
		const p4 = sketch.addPoint(50, 0);

		// Circular fit spline: center (50, 50), radius 50
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id, p4.id, p1.id]);
		const l1 = sketch.addPoint(-20, 40);
		const l2 = sketch.addPoint(120, 60);
		sketch.addLine(l1.id, l2.id, true);

		const curves = getAllGeoCurves(sketch);
		const sCurve = curves.find(c => c.id === spline.id) as GeoSpline;

		// Click top half near (50, 95)
		const candidate = getTrimCandidate(sCurve, curves, { x: 50, y: 95 });
		assert.ok(candidate);

		// Execute trim
		executeTrim(sketch, candidate);
		sketch.solve();

		const remainingCurves = getAllGeoCurves(sketch).filter(c => c.type === 'spline') as GeoSpline[];
		assert.equal(remainingCurves.length, 1);
		const bottomSpline = remainingCurves[0];

		// Sample 50 points on the remaining bottom spline: all must stay on the circle (radius 50) within 0.05% error
		for (let i = 0; i <= 50; i++) {
			const pt = getSplinePointAtParam(bottomSpline.bezierSegments, i / 50);
			const r = Math.hypot(pt.x - 50, pt.y - 50);
			assert.ok(Math.abs(r - 50) < 0.05, `Point at param ${i / 50} radius was ${r}, expected ~50`);
		}
	});

	it('control spline is always open even if endpoints match', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(0, 100);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(100, 0);

		const sp = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id, p0.id]);
		assert.equal(sp.isClosed, false);
	});

	it('trim on control spline allows trimming start [0, u] and end [u, 1] without distortion', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(0, 100);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(100, 0);
		const p4 = sketch.addPoint(50, -50);

		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id, p4.id]);
		assert.equal(spline.isClosed, false);

		// Add a cutting line cutting across the spline
		const l1 = sketch.addPoint(-20, 50);
		const l2 = sketch.addPoint(120, 50);
		sketch.addLine(l1.id, l2.id, true);

		const curves = getAllGeoCurves(sketch);
		const sCurve = curves.find(c => c.id === spline.id) as GeoSpline;
		assert.ok(sCurve);

		// Click near the start (0, 10) to trim the start portion [0, u]
		const candidate = getTrimCandidate(sCurve, curves, { x: 0, y: 10 });
		assert.ok(candidate);
		assert.ok(candidate.interval[0] <= 1e-4, 'Trim interval should start at 0');

		executeTrim(sketch, candidate);

		const remainingSplines = getAllGeoCurves(sketch).filter(c => c.type === 'spline') as GeoSpline[];
		assert.equal(remainingSplines.length, 1);
		const trimmedCurve = remainingSplines[0];
		assert.equal(trimmedCurve.isClosed, false);

		// Compare remaining segment [uB, 1] with original spline
		const uB = candidate.interval[1];
		const expectedSub = extractSplineInterval(sCurve.bezierSegments, uB, 1);
		let maxDiff = 0;
		for (let s = 0; s < expectedSub.length; s++) {
			for (let k = 0; k < 4; k++) {
				const dx = Math.abs(trimmedCurve.bezierSegments[s][k].x - expectedSub[s][k].x);
				const dy = Math.abs(trimmedCurve.bezierSegments[s][k].y - expectedSub[s][k].y);
				maxDiff = Math.max(maxDiff, dx, dy);
			}
		}
		assert.ok(maxDiff < 0.05, `Max difference was ${maxDiff}, expected < 0.05 px`);
	});

	it('executeBreak on open control spline splits into two exact open control splines', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(0, 100);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(100, 0);
		const p4 = sketch.addPoint(50, -50);

		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id, p4.id]);
		const l1 = sketch.addPoint(-20, 50);
		const l2 = sketch.addPoint(120, 50);
		sketch.addLine(l1.id, l2.id, true);

		const curves = getAllGeoCurves(sketch);
		const sCurve = curves.find(c => c.id === spline.id) as GeoSpline;
		assert.ok(sCurve);

		const candidate = getTrimCandidate(sCurve, curves, { x: 0, y: 10 });
		assert.ok(candidate);

		executeBreak(sketch, candidate);

		const splinesAfterBreak = getAllGeoCurves(sketch).filter(c => c.type === 'spline') as GeoSpline[];
		assert.equal(splinesAfterBreak.length, 2);
		for (const sp of splinesAfterBreak) {
			assert.equal(sp.isClosed, false);
			assert.ok(sp.bezierSegments.length > 0);
		}
	});
});

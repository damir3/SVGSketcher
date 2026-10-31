import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	toggleOrExtendChain,
	getValidChainContinuations,
	calculateOffsetGeometry,
	commitOffsetToSketch,
} from '../src/math/offset';
import { dist } from '../src/math/vector';

describe('Offset Chain Building and Continuation', () => {
	it('builds closed chain for circle and ellipse', () => {
		const sketch = new SketchDocument();
		const cp = sketch.addPoint(0, 0);
		const circle = sketch.addCircle(cp.id, 20);

		const chain = toggleOrExtendChain(sketch, null, circle.id, 'circle', true);
		assert.ok(chain);
		assert.equal(chain.isClosed, true);
		assert.equal(chain.items.length, 1);
		assert.equal(chain.items[0].id, circle.id);

		// Continuation on closed circle returns empty set
		const conts = getValidChainContinuations(sketch, chain);
		assert.equal(conts.size, 0);
	});

	it('automatically traverses connected lines with chainSelection = true until branching or loop closes', () => {
		const sketch = new SketchDocument();
		// Create a rectangle: p0 -> p1 -> p2 -> p3 -> p0
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(100, 50);
		const p3 = sketch.addPoint(0, 50);

		const l0 = sketch.addLine(p0.id, p1.id);
		const l1 = sketch.addLine(p1.id, p2.id);
		const l2 = sketch.addLine(p2.id, p3.id);
		const l3 = sketch.addLine(p3.id, p0.id);

		// Select l0 with chainSelection = true
		const chain = toggleOrExtendChain(sketch, null, l0.id, 'line', true);
		assert.ok(chain);
		assert.equal(chain.isClosed, true);
		assert.equal(chain.items.length, 4);

		// Verify all 4 rectangle lines are in chain
		const ids = chain.items.map(it => it.id);
		assert.ok(ids.includes(l0.id));
		assert.ok(ids.includes(l1.id));
		assert.ok(ids.includes(l2.id));
		assert.ok(ids.includes(l3.id));
	});

	it('stops traversal at branch point where multiple lines emanate', () => {
		const sketch = new SketchDocument();
		// T-junction: p0 -> p1, and at p1 there are two lines: p1 -> p2 and p1 -> p3
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(50, 0);
		const p2 = sketch.addPoint(100, 50);
		const p3 = sketch.addPoint(100, -50);

		const l0 = sketch.addLine(p0.id, p1.id);
		const l1 = sketch.addLine(p1.id, p2.id);
		const l2 = sketch.addLine(p1.id, p3.id);

		const chain = toggleOrExtendChain(sketch, null, l0.id, 'line', true);
		assert.ok(chain);
		assert.equal(chain.isClosed, false);
		// Traversal stopped at p1 because 2 lines (l1, l2) emanate from p1!
		assert.equal(chain.items.length, 1);
		assert.equal(chain.items[0].id, l0.id);

		// Valid continuations should only be l1 and l2!
		const conts = getValidChainContinuations(sketch, chain);
		assert.ok(conts.has(l1.id));
		assert.ok(conts.has(l2.id));

		// Now user chooses l1
		const extended = toggleOrExtendChain(sketch, chain, l1.id, 'line', true);
		assert.ok(extended);
		assert.equal(extended.items.length, 2);
		assert.equal(extended.items[1].id, l1.id);
	});
});

describe('Offset Geometry Calculation', () => {
	it('calculates one_side offset for circle', () => {
		const sketch = new SketchDocument();
		const cp = sketch.addPoint(0, 0);
		const circle = sketch.addCircle(cp.id, 20);
		const chain = toggleOrExtendChain(sketch, null, circle.id, 'circle', true)!;

		// Outward (+10)
		const geomOut = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
		assert.ok(geomOut.isValid);
		assert.equal(geomOut.sides.length, 1);
		assert.equal(geomOut.sides[0].primitives[0].circleRadius, 30);

		// Inward (-5)
		const geomIn = calculateOffsetGeometry(sketch, chain, 'one_side', -5, 10, false);
		assert.ok(geomIn.isValid);
		assert.equal(geomIn.sides[0].primitives[0].circleRadius, 15);

		// Symmetric (+10 and -10)
		const geomSym = calculateOffsetGeometry(sketch, chain, 'symmetric', 10, 10, false);
		assert.ok(geomSym.isValid);
		assert.equal(geomSym.sides.length, 2);
		assert.equal(geomSym.sides[0].primitives[0].circleRadius, 30);
		assert.equal(geomSym.sides[1].primitives[0].circleRadius, 10);
	});

	it('calculates rectangular closed chain offset with corner intersections', () => {
		const sketch = new SketchDocument();
		// Square 100x100: (0,0) -> (100,0) -> (100,100) -> (0,100) -> (0,0)
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(0, 100);

		const l0 = sketch.addLine(p0.id, p1.id);
		const l1 = sketch.addLine(p1.id, p2.id);
		const l2 = sketch.addLine(p2.id, p3.id);
		const l3 = sketch.addLine(p3.id, p0.id);

		const chain = toggleOrExtendChain(sketch, null, l0.id, 'line', true)!;
		assert.equal(chain.isClosed, true);

		// Outward offset (+10mm): rectangle expands to 120x120 (-10 to 110)
		const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
		assert.ok(geom.isValid);
		assert.equal(geom.sides.length, 1);
		const prims = geom.sides[0].primitives;
		assert.equal(prims.length, 4);

		// Check corners joined:
		// Line 0 (bottom): should run from x = -10, y = -10 to x = 110, y = -10
		// or similar outer boundary
		for (let i = 0; i < 4; i++) {
			const cur = prims[i];
			const next = prims[(i + 1) % 4];
			assert.ok(cur.p2 && next.p1);
			assert.ok(dist(cur.p2, next.p1) < 1e-4, `Corner ${i} must match`);
		}
	});

	it('commits offset to sketch with OffsetConstraint', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(100, 0);
		const l0 = sketch.addLine(p0.id, p1.id);

		const chain = toggleOrExtendChain(sketch, null, l0.id, 'line', false)!;
		const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 15, 15, false);

		const res = commitOffsetToSketch(sketch, chain, geom, 'one_side', 15, 15, false);
		assert.ok(res);
		assert.equal(res.createdIds.length, 1);
		assert.equal(res.constraintIds.length, 1);

		// Verify new line created
		const newLine = sketch.lines.get(res.createdIds[0]);
		assert.ok(newLine);

		// Verify OffsetConstraint exists
		const offC = sketch.constraints.get(res.constraintIds[0]);
		assert.ok(offC);
		assert.equal(offC.type, 'offset');
	});

	it('positions gizmo anchor at the exact middle of the first selected primitive', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(-50, 0);
		const p1 = sketch.addPoint(50, 0);
		const p2 = sketch.addPoint(0, 80);

		const lBottom = sketch.addLine(p0.id, p1.id);
		const lLeft = sketch.addLine(p0.id, p2.id);
		sketch.addLine(p1.id, p2.id);

		// Selecting bottom line first: middle should be (0, 0)
		const chain1 = toggleOrExtendChain(sketch, null, lBottom.id, 'line', true)!;
		const geom1 = calculateOffsetGeometry(sketch, chain1, 'one_side', 10, 10, false);
		assert.equal(geom1.gizmoAnchor.x, 0);
		assert.equal(geom1.gizmoAnchor.y, 0);
		assert.ok(Math.abs(geom1.gizmoNormal.x - 0) < 1e-4);
		assert.ok(Math.abs(geom1.gizmoNormal.y - (-1)) < 1e-4);

		// Selecting left leg first: middle should be (-25, 40)
		const chain2 = toggleOrExtendChain(sketch, null, lLeft.id, 'line', true)!;
		const geom2 = calculateOffsetGeometry(sketch, chain2, 'one_side', 10, 10, false);
		assert.equal(geom2.gizmoAnchor.x, -25);
		assert.equal(geom2.gizmoAnchor.y, 40);
	});

	it('correctly offsets a closed loop formed by a line and a spline with shared vertices and tangent corner joins', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(0, 0);
		const p1 = sketch.addPoint(75, 0);
		const p2 = sketch.addPoint(0, 50);
		const p3 = sketch.addPoint(75, 50);

		const line = sketch.addLine(p0.id, p1.id);
		const spline = sketch.addFitSpline([p0.id, p2.id, p3.id, p1.id]);

		const chain = toggleOrExtendChain(sketch, null, line.id, 'line', true)!;
		assert.ok(chain);
		assert.equal(chain.isClosed, true);
		assert.equal(chain.items.length, 2);

		const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
		assert.ok(geom.isValid);
		assert.equal(geom.sides.length, 1);
		const side = geom.sides[0];
		assert.equal(side.primitives.length, 2);

		const offLine = side.primitives[0];
		assert.equal(offLine.type, 'line');
		// Line stays horizontal at y = -10 (outward)
		assert.ok(Math.abs(offLine.p1!.y - (-10)) < 1e-4);
		assert.ok(Math.abs(offLine.p2!.y - (-10)) < 1e-4);
		assert.ok(offLine.p1!.x < 0);
		assert.ok(offLine.p2!.x > 75);

		// Commit to sketch
		const res = commitOffsetToSketch(sketch, chain, geom, 'one_side', 10, 10, false)!;
		assert.ok(res);
		assert.equal(res.createdIds.length, 2);

		const createdLine = sketch.lines.get(res.createdIds[0])!;
		const createdSpline = sketch.splines.get(res.createdIds[1])!;

		// Line and spline must share exact endpoint vertices
		assert.equal(createdLine.p2Id, createdSpline.pointIds[0]);
		assert.equal(createdLine.p1Id, createdSpline.pointIds[createdSpline.pointIds.length - 1]);

		// Verify solve keeps geometry at expected positions
		sketch.solve();
		const pt1 = sketch.points.get(createdLine.p1Id)!;
		const pt2 = sketch.points.get(createdLine.p2Id)!;
		assert.ok(Math.abs(pt1.y - (-10)) < 1e-4);
		assert.ok(Math.abs(pt2.y - (-10)) < 1e-4);

		const midPtId = createdSpline.pointIds[Math.floor(createdSpline.pointIds.length / 2)];
		const initialSplineMidY = sketch.points.get(midPtId)!.y;

		// Update offset constraint distance from 10 to 30
		sketch.updateDimensionalConstraint(res.constraintIds[0], 30);

		// Line moves to y = -30
		assert.ok(Math.abs(sketch.points.get(createdLine.p1Id)!.y - (-30)) < 1e-4);
		assert.ok(Math.abs(sketch.points.get(createdLine.p2Id)!.y - (-30)) < 1e-4);

		// Created spline expands along its normal by +20 distance
		const updatedSplineMidY = sketch.points.get(midPtId)!.y;
		assert.ok(Math.abs(updatedSplineMidY - (initialSplineMidY + 20)) < 0.1);

		// Endpoints remain shared
		assert.equal(createdLine.p2Id, createdSpline.pointIds[0]);
		assert.equal(createdLine.p1Id, createdSpline.pointIds[createdSpline.pointIds.length - 1]);

		// Now update offset constraint distance down to 3: corners and handles must update cleanly
		sketch.updateDimensionalConstraint(res.constraintIds[0], 3);

		assert.ok(Math.abs(sketch.points.get(createdLine.p1Id)!.y - (-3)) < 1e-4);
		assert.ok(Math.abs(sketch.points.get(createdLine.p2Id)!.y - (-3)) < 1e-4);
		assert.ok(Math.abs(sketch.points.get(createdLine.p1Id)!.x - (-3)) < 0.1);
		assert.ok(Math.abs(sketch.points.get(createdLine.p2Id)!.x - 78) < 0.1);

		// Verify tangent handle at corner is strictly vertical (matching original curve vertical tangent)
		const lastHandleLineId = createdSpline.tangentLineIds![createdSpline.tangentLineIds!.length - 1];
		const lastHandleLine = sketch.lines.get(lastHandleLineId)!;
		const h1 = sketch.points.get(lastHandleLine.p1Id)!;
		const h2 = sketch.points.get(lastHandleLine.p2Id)!;
		assert.ok(Math.abs(h1.x - (-3)) < 1e-4, `h1.x was ${h1.x}, expected -3`);
		assert.ok(Math.abs(h2.x - (-3)) < 1e-4, `h2.x was ${h2.x}, expected -3`);
	});

	it('correctly offsets a control point spline (B-spline) rather than treating it as a fit spline', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint(-50, 0);
		const p1 = sketch.addPoint(50, 0);
		const p2 = sketch.addPoint(-50, 100);
		const p3 = sketch.addPoint(50, 100);

		const line = sketch.addLine(p0.id, p1.id);
		// Control spline with 4 points: curve passes through (-50, 0), top at y = 75, ends at (50, 0)
		const controlSpline = sketch.addControlSpline([p0.id, p2.id, p3.id, p1.id]);
		assert.equal(controlSpline.splineType, 'control');

		const chain = toggleOrExtendChain(sketch, null, line.id, 'line', true)!;
		assert.ok(chain);
		assert.equal(chain.isClosed, true);

		// Offset at distance 10
		const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
		assert.ok(geom.isValid);
		const sGeom = geom.sides[0].primitives[1];

		// True midpoint of B-spline is at y = 75, so offset at distance 10 should be at y = 85 (not 130)
		const midFitPt = sGeom.fitPoints![Math.floor(sGeom.fitPoints!.length / 2)];
		assert.ok(Math.abs(midFitPt.x - 0) < 1e-4);
		assert.ok(Math.abs(midFitPt.y - 85) < 0.5, `midFitPt.y was ${midFitPt.y}, expected 85`);

		const res = commitOffsetToSketch(sketch, chain, geom, 'one_side', 10, 10, false)!;
		assert.ok(res);

		// Update offset distance constraint to 3
		sketch.updateDimensionalConstraint(res.constraintIds[0], 3);

		// At distance 3, midpoint should be at y = 78
		const createdSpline = sketch.splines.get(res.createdIds[1])!;
		const splineMidPt = sketch.points.get(createdSpline.pointIds[Math.floor(createdSpline.pointIds.length / 2)])!;
		assert.ok(Math.abs(splineMidPt.y - 78) < 0.5, `splineMidPt.y was ${splineMidPt.y}, expected 78`);
	});
});

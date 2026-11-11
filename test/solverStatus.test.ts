import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findSketchRegions } from '../src/math/regions';
import { setCircleOrArcRadius } from '../src/model/inspectorOperations';
import { SketchDocument, type PatternCopyData } from '../src/model/sketch';
import { NumericalSolver } from '../src/solver/solver';

describe('solver status without constraints', () => {
	it('reports four free coordinates for the imported issue scene', () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot({
			points: [
				{ type: 'point', id: 'Point-4', x: -50, y: 0, fixed: false },
				{ type: 'point', id: 'Point-5', x: 0, y: 25, fixed: false },
			],
			lines: [{ type: 'line', id: 'Line-4', p1Id: 'Point-4', p2Id: 'Point-5', isConstruction: false }],
			circles: [],
			arcs: [],
			constraints: [],
			idCounter: 14,
		});

		assert.equal(sketch.lastSolverResult?.degreesOfFreedom, 4);
		assert.equal(sketch.lastSolverResult?.status, 'UNDER_CONSTRAINED');
	});

	it('keeps a line with fixed endpoints fully constrained', () => {
		const sketch = new SketchDocument();
		const start = sketch.addPoint({ x: -50, y: 0 }, true);
		const end = sketch.addPoint({ x: 0, y: 25 }, true);
		sketch.addLine(start.id, end.id);

		assert.equal(sketch.lastSolverResult?.degreesOfFreedom, 0);
		assert.equal(sketch.lastSolverResult?.status, 'CONVERGED');
	});

	it('keeps an empty scene converged', () => {
		const sketch = new SketchDocument();
		sketch.solve();

		assert.equal(sketch.lastSolverResult?.degreesOfFreedom, 0);
		assert.equal(sketch.lastSolverResult?.status, 'CONVERGED');
	});
});

it('solves a 0.1 mm radius and propagates it through an equal radius constraint', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 0, y: 0 }, true);
	const start = sketch.addPoint({ x: 2, y: 0 });
	const end = sketch.addPoint({ x: 0, y: 2 });
	const arc = sketch.addArc(center.id, start.id, end.id, 2);
	const circle = sketch.addCircle(sketch.addPoint({ x: 5, y: 0 }, true).id, 2);
	sketch.addEqualRadiusConstraint(arc.id, circle.id);
	const dimension = sketch.addRadiusConstraint(arc.id, 2)!;

	assert.ok(sketch.updateDimensionalConstraint(dimension.id, '0.1'));

	assert.equal(arc.radius, 0.1);
	assert.ok(Math.abs(circle.radius - 0.1) < 1e-6);
	assert.ok(Math.abs(Math.hypot(start.x, start.y) - 0.1) < 1e-6);
	assert.ok(Math.abs(Math.hypot(end.x, end.y) - 0.1) < 1e-6);
	assert.equal(sketch.lastSolverResult?.status, 'UNDER_CONSTRAINED');
	assert.ok(sketch.lastSolverResult!.finalError < 1e-10);
});

it('goes directly to the free-radius pass when a pattern copy must change radius', t => {
	const sketch = new SketchDocument();
	const pivot = sketch.addPoint({ x: 0, y: 0 }, true);
	const sourceCenter = sketch.addPoint({ x: 10, y: 0 });
	const source = sketch.addCircle(sourceCenter.id, 1);
	const copyCenter = sketch.addPoint({ x: -10, y: 0 });
	const copy = sketch.addCircle(copyCenter.id, 1);
	sketch.addCircularPatternConstraint(pivot.id, [source.id], 'full', 360, 2, false, [], [
		{
			copyIndex: 1,
			pointPairs: [{ sourcePtId: sourceCenter.id, patternPtId: copyCenter.id }],
			radiusPairs: [{ sourceCircleId: source.id, patternCircleId: copy.id }],
			createdEntityIds: [{ type: 'circle', id: copy.id }],
		},
	]);
	const dimension = sketch.addRadiusConstraint(source.id, 1, 'radius')!;
	const solve = t.mock.method(sketch['solver'], 'solve');

	assert.ok(sketch.updateDimensionalConstraint(dimension.id, 2));

	assert.equal(solve.mock.callCount(), 1);
	assert.ok(Math.abs(copy.radius - 2) < 1e-6);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-10);
});

it('keeps iterating past small ill-conditioned gradients to close a shallow loop', () => {
	const createShallowLoop = (gradRelTolerance?: number) => {
		const sketch = new SketchDocument();
		if (gradRelTolerance !== undefined) {
			sketch['solver'] = new NumericalSolver({ gradRelTolerance });
		}
		let pMidAId = '';
		let pMidBId = '';
		sketch.withDeferredSolve(() => {
			const pLeft = sketch.addPoint({ x: -10, y: 0 }, true);
			const pRight = sketch.addPoint({ x: 10, y: 0 }, true);
			const pMidA = sketch.addPoint({ x: 0, y: 0.002 });
			const pMidB = sketch.addPoint({ x: 0.00004, y: 0.00204 });
			pMidAId = pMidA.id;
			pMidBId = pMidB.id;
			const pBotLeft = sketch.addPoint({ x: -10, y: -10 }, true);
			const pBotRight = sketch.addPoint({ x: 10, y: -10 }, true);

			sketch.addLine(pLeft.id, pMidA.id);
			sketch.addLine(pMidB.id, pRight.id);
			sketch.addLine(pRight.id, pBotRight.id);
			sketch.addLine(pBotRight.id, pBotLeft.id);
			sketch.addLine(pBotLeft.id, pLeft.id);

			sketch.addCoincidentConstraint(pMidA.id, pMidB.id);
			sketch.addDistanceConstraint(pLeft.id, pMidA.id, 10.0002);
			sketch.addDistanceConstraint(pMidB.id, pRight.id, 10.0002);
		});
		const a = sketch.points.get(pMidAId)!;
		const b = sketch.points.get(pMidBId)!;
		return {
			sketch,
			gap: Math.hypot(a.x - b.x, a.y - b.y),
			finalError: sketch.lastSolverResult!.finalError,
		};
	};

	const withoutRelTol = createShallowLoop(0);
	assert.ok(withoutRelTol.gap > 1e-5, 'baseline zero gradRelTolerance stops with an open gap');

	const withDefaultRelTol = createShallowLoop();
	assert.ok(withDefaultRelTol.gap < 1e-6);
	assert.ok(withDefaultRelTol.finalError < 1e-12);
	assert.equal(findSketchRegions(withDefaultRelTol.sketch).length, 1);
});

it('updates feasible circular-pattern fillet radii and cleanly rolls back infeasible edits', () => {
	const sketch = new SketchDocument();
	const n = 52;
	const dTheta = (2 * Math.PI) / n;
	const hs = dTheta / 2;
	const Rtip = 108;
	const Rroot = 102;
	const initialRadius = 2.0;

	let arcId = '';
	let copyArcId = '';
	let seamEndId = '';
	let seamNextStartId = '';

	sketch.withDeferredSolve(() => {
		const pivot = sketch.addPoint({ x: 0, y: 0 }, true);
		const pStart = sketch.addPoint({ x: Rtip * Math.cos(-hs), y: Rtip * Math.sin(-hs) }, true);
		const pEnd = sketch.addPoint({ x: Rtip * Math.cos(hs), y: Rtip * Math.sin(hs) }, true);
		const center = sketch.addPoint({ x: Rroot, y: 0 });
		const dx = pStart.x - Rroot;
		const dy = pStart.y;
		const phi = Math.atan2(dy, dx);
		const alpha = Math.acos(initialRadius / Math.hypot(dx, dy));
		const pA = sketch.addPoint({
			x: Rroot + initialRadius * Math.cos(phi - alpha),
			y: initialRadius * Math.sin(phi - alpha),
		});
		const pB = sketch.addPoint({
			x: Rroot + initialRadius * Math.cos(-phi + alpha),
			y: initialRadius * Math.sin(-phi + alpha),
		});

		const lA = sketch.addLine(pStart.id, pA.id);
		const arc = sketch.addArc(center.id, pA.id, pB.id, initialRadius);
		const lB = sketch.addLine(pB.id, pEnd.id);
		arcId = arc.id;

		sketch.addTangentConstraint(lA.id, arc.id);
		sketch.addTangentConstraint(lB.id, arc.id);
		sketch.addEqualLengthConstraint(lA.id, lB.id);
		sketch.addDistanceConstraint(pivot.id, center.id, Rroot);

		const copies: PatternCopyData[] = [];
		const ends: Array<{ startId: string; endId: string }> = [{ startId: pStart.id, endId: pEnd.id }];
		for (let i = 1; i < n; i++) {
			const ang = i * dTheta;
			const cosA = Math.cos(ang);
			const sinA = Math.sin(ang);
			const rot = (pt: { x: number; y: number }) => ({
				x: pt.x * cosA - pt.y * sinA,
				y: pt.x * sinA + pt.y * cosA,
			});
			const cStart = sketch.addPoint(rot(pStart));
			const cEnd = sketch.addPoint(rot(pEnd));
			const cCenter = sketch.addPoint(rot(center));
			const cA = sketch.addPoint(rot(pA));
			const cB = sketch.addPoint(rot(pB));
			const clA = sketch.addLine(cStart.id, cA.id);
			const cArc = sketch.addArc(cCenter.id, cA.id, cB.id, initialRadius);
			const clB = sketch.addLine(cB.id, cEnd.id);
			if (i === 1) copyArcId = cArc.id;
			ends.push({ startId: cStart.id, endId: cEnd.id });
			copies.push({
				copyIndex: i,
				pointPairs: [
					{ sourcePtId: pStart.id, patternPtId: cStart.id },
					{ sourcePtId: pEnd.id, patternPtId: cEnd.id },
					{ sourcePtId: center.id, patternPtId: cCenter.id },
					{ sourcePtId: pA.id, patternPtId: cA.id },
					{ sourcePtId: pB.id, patternPtId: cB.id },
				],
				radiusPairs: [{ sourceCircleId: arc.id, patternCircleId: cArc.id }],
				createdEntityIds: [
					{ type: 'line', id: clA.id },
					{ type: 'arc', id: cArc.id },
					{ type: 'line', id: clB.id },
				],
			});
		}
		for (let i = 0; i < n; i++) {
			const curr = ends[i];
			const next = ends[(i + 1) % n];
			sketch.addCoincidentConstraint(curr.endId, next.startId);
			if (i === n - 1) {
				seamEndId = curr.endId;
				seamNextStartId = next.startId;
			}
		}
		sketch.addCircularPatternConstraint(pivot.id, [lA.id, arc.id, lB.id], 'full', 360, n, false, [], copies);
	});

	assert.equal(findSketchRegions(sketch).length, 1);

	assert.equal(setCircleOrArcRadius(sketch, arcId, 3.0), true);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-10);
	assert.ok(Math.abs(sketch.arcs.get(arcId)!.radius - 3.0) < 1e-6);
	assert.ok(Math.abs(sketch.arcs.get(copyArcId)!.radius - 3.0) < 1e-6);
	const seamEnd = sketch.points.get(seamEndId)!;
	const seamStart = sketch.points.get(seamNextStartId)!;
	assert.ok(Math.hypot(seamEnd.x - seamStart.x, seamEnd.y - seamStart.y) < 1e-6);
	assert.equal(findSketchRegions(sketch).length, 1);

	// Radius > dist(pStart, center) (~8.83) cannot close tangentially and must roll back cleanly.
	assert.equal(setCircleOrArcRadius(sketch, arcId, 10.0), false);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-10);
	assert.ok(Math.abs(sketch.arcs.get(arcId)!.radius - 3.0) < 1e-6);
	assert.ok(Math.abs(sketch.arcs.get(copyArcId)!.radius - 3.0) < 1e-6);
	assert.equal(findSketchRegions(sketch).length, 1);
});

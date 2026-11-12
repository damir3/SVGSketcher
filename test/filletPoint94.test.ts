import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateFilletGeometry,
	commitFilletToSketch,
	findMaxFilletRadius,
	getConnectedPrimitivesForPoint,
	type FilletCandidate,
} from '../src/math/fillet';
import { evaluateBezier, evaluateBezierDerivative } from '../src/math/splineReference';

const source = JSON.parse(
	readFileSync(new URL('./fixtures/point94-fillet.json', import.meta.url), 'utf8')
) as ReturnType<SketchDocument['takeSnapshot']>;
function scene(reverseArc = false, reverseSpline = false) {
	const snapshot = structuredClone(source);
	if (reverseArc) {
		const arc = snapshot.arcs.find(a => a.id === 'Arc-1')!;
		[arc.startPointId, arc.endPointId] = [arc.endPointId, arc.startPointId];
		arc.clockwise = !arc.clockwise;
		const endpoints = snapshot.constraints.find(c => c.type === 'arc_endpoints' && c.arcId === arc.id)!;
		endpoints.startPointId = arc.startPointId;
		endpoints.endPointId = arc.endPointId;
		endpoints.entityIds = [arc.id, arc.centerId, arc.startPointId, arc.endPointId];
	}
	if (reverseSpline) {
		snapshot.splines[0].pointIds.reverse();
		snapshot.splines[0].tangentLineIds!.reverse();
		for (const line of snapshot.lines) if (line.isSplineHandle) [line.p1Id, line.p2Id] = [line.p2Id, line.p1Id];
	}
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(snapshot);
	sketch.clearHistory();
	const corner = sketch.points.get('Point-94')!.clone();
	const conn = getConnectedPrimitivesForPoint(sketch, 'Point-94');
	assert.ok(conn.valid);
	assert.deepEqual(
		conn.primitives.map(p => p.type),
		['arc', 'spline']
	);
	const arc = sketch.arcs.get('Arc-1')!.toGeoCurve(sketch)!;
	const spline = sketch.splines.get('Spline-1')!.toGeoCurve(sketch)!;
	const options = { cornerVertex: corner, endPointId1: 'Point-94', endPointId2: 'Point-94' };
	return { sketch, corner, arc, spline, options };
}
for (const reverseArc of [false, true])
	for (const reverseSpline of [false, true])
		for (const swap of [false, true])
			test(`Point-94 fillet anchors sides at the corner: arc reversed=${reverseArc}, spline reversed=${reverseSpline}, swapped=${swap}`, () => {
				const { corner, arc, spline, options } = scene(reverseArc, reverseSpline);
				const c1 = swap ? spline : arc,
					c2 = swap ? arc : spline;
				for (const radius of [0.5, 1, 2, 5, 10, 20, 30]) {
					const r = calculateFilletGeometry(c1, c2, radius, options);
					assert.ok(r, `R=${radius} must fit the arc/spline corner`);
					const arcParam = swap ? r.param2 : r.param1,
						splineParam = swap ? r.param1 : r.param2;
					const arcPoint = swap ? r.t2 : r.t1,
						splinePoint = swap ? r.t1 : r.t2;
					assert.ok(arcParam > 0 && arcParam < 1, 'tangency must lie on the selected arc span');
					assert.ok(splineParam > 0 && splineParam < 1, 'tangency must lie on the selected spline');
					assert.ok(r.center.x > corner.x && r.center.y > corner.y, 'center must stay inside the corner');
					assert.ok(Math.abs(r.center.distanceTo(arcPoint) - radius) < 1e-3);
					assert.ok(Math.abs(r.center.distanceTo(splinePoint) - radius) < 1e-3);
					assert.ok(
						Math.abs(r.center.distanceTo(arc.center) - (arc.radius + radius)) < 1e-3,
						'arc circles must be externally tangent'
					);
					const value = splineParam * spline.bezierSegments.length,
						index = Math.min(Math.floor(value), spline.bezierSegments.length - 1),
						t = value - index;
					assert.ok(evaluateBezier(spline.bezierSegments[index], t).distanceTo(splinePoint) < 0.05);
					const tangent = evaluateBezierDerivative(spline.bezierSegments[index], t).normalizeOrUnitX();
					assert.ok(
						Math.abs(r.center.clone().sub(splinePoint).dot(tangent)) < 0.05,
						'spline tangent must be perpendicular to fillet radius'
					);
				}
				const max = findMaxFilletRadius(c1, c2, options, 100, 0.1);
				assert.ok(max !== null && max >= 30 && max < 100);
				assert.ok(calculateFilletGeometry(c1, c2, max, options));
			});

test('Point-94 fillet commits and survives undo/redo', () => {
	const { sketch, arc, spline, options } = scene();
	const before = sketch.takeSnapshot();
	const result = calculateFilletGeometry(arc, spline, 10, options);
	assert.ok(result);
	const candidate: FilletCandidate = {
		id: 'point94',
		vertexPointId: 'Point-94',
		primitive1: { type: 'arc', id: arc.id },
		primitive2: { type: 'spline', id: spline.id },
		...options,
		result,
	};
	sketch.beginTransaction();
	const created = sketch.withDeferredSolve(() => commitFilletToSketch(sketch, candidate, true));
	sketch.commitTransaction();
	assert.ok(created);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
	assert.equal(sketch.arcs.size, 3);
	assert.equal(sketch.splines.size, 1);
	assert.ok(Math.abs(sketch.arcs.get(created.arcId)!.radius - 10) < 1e-8);
	const after = sketch.takeSnapshot();
	assert.equal(sketch.undo(), true);
	assert.deepEqual(sketch.takeSnapshot(), before);
	assert.equal(sketch.redo(), true);
	const restored = sketch.takeSnapshot();
	// Restore runs the solver; geometry must already be stable at the stored solution.
	for (const point of after.points) assert.ok(sketch.points.get(point.id)!.distanceTo(point) < 1e-6);
	assert.deepEqual(restored.arcs, after.arcs);
});

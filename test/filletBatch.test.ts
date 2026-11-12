import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateFilletGeometry,
	commitFilletsToSketch,
	getConnectedPrimitivesForPoint,
	type FilletCandidate,
} from '../src/math/fillet';
import { extractSplineInterval } from '../src/math/splineReference';
import { EqualRadiusConstraint, RadiusConstraint, TangentLineCircleConstraint } from '../src/solver/constraints';

const source = JSON.parse(
	readFileSync(new URL('./fixtures/point94-fillet.json', import.meta.url), 'utf8')
) as ReturnType<SketchDocument['takeSnapshot']>;
// Undo can reinsert map entries in a different order; entity and curve-point order stay intact.
function sortedSnapshot(snapshot: ReturnType<SketchDocument['takeSnapshot']>) {
	return Object.fromEntries(
		Object.entries(snapshot).map(([key, value]) => [
			key,
			Array.isArray(value) && value.every(item => typeof item.id === 'string')
				? [...value].sort((a, b) => a.id.localeCompare(b.id))
				: value,
		])
	);
}
function candidates(sketch: SketchDocument, ids: string[], radius = 10, swap = false) {
	return ids.map(pointId => {
		const conn = getConnectedPrimitivesForPoint(sketch, pointId);
		assert.ok(conn.valid);
		const [p1, p2] = swap ? [...conn.primitives].reverse() : conn.primitives;
		const options = {
			cornerVertex: sketch.points.get(pointId)!.clone(),
			endPointId1: p1.endPointId,
			endPointId2: p2.endPointId,
		};
		const result = calculateFilletGeometry(
			sketch.toGeoCurve(p1.id, p1.type)!,
			sketch.toGeoCurve(p2.id, p2.type)!,
			radius,
			options
		);
		assert.ok(result);
		return {
			id: pointId,
			vertexPointId: pointId,
			primitive1: { type: p1.type, id: p1.id },
			primitive2: { type: p2.type, id: p2.id },
			...options,
			result,
		} satisfies FilletCandidate;
	});
}
for (const reverse of [false, true])
	for (const swap of [false, true])
		test(`Point-94 and Point-98 trim the shared spline at both ends: reversed=${reverse}, swapped=${swap}`, () => {
			const sketch = new SketchDocument();
			sketch.restoreSnapshot(structuredClone(source));
			sketch.clearHistory();
			const before = sketch.takeSnapshot(),
				ids = reverse ? ['Point-98', 'Point-94'] : ['Point-94', 'Point-98'];
			const pending = candidates(sketch, ids, 10, swap);
			const spline = sketch.splines.get('Spline-1')!.toGeoCurve(sketch)!;
			const param = (id: string) => {
				const f = pending.find(f => f.id === id)!;
				return swap ? f.result.param1 : f.result.param2;
			};
			const expected = extractSplineInterval(spline.bezierSegments, param('Point-94'), param('Point-98'));
			const created = commitFilletsToSketch(sketch, pending, '10');
			assert.ok(created);
			assert.equal(created.length, 2);
			assert.equal(sketch.arcs.size, 4);
			assert.equal(sketch.splines.size, 1);
			const remaining = [...sketch.splines.values()][0],
				curve = remaining.toGeoCurve(sketch)!;
			assert.ok(!remaining.pointIds.includes('Point-94') && !remaining.pointIds.includes('Point-98'));
			assert.equal(curve.bezierSegments.length, expected.length);
			// Both partial spans meet at exactly the retained original interior handles.
			for (let i = 0; i < expected.length; i++)
				for (const j of i === 0 ? [2, 3] : [0, 1])
					assert.ok(curve.bezierSegments[i][j].distanceTo(expected[i][j]) < 1e-6, 'retained join changed shape');
			for (const [i, f] of pending.entries()) {
				const splineId = (swap ? f.primitive1 : f.primitive2).id;
				assert.equal(splineId, remaining.id);
				const pointId = swap ? created[i].p1Id : created[i].p2Id;
				const atStart = f.id === 'Point-94';
				assert.equal(atStart ? remaining.pointIds[0] : remaining.pointIds.at(-1), pointId);
				const handle = atStart ? remaining.tangentLineIds![0] : remaining.tangentLineIds!.at(-1)!;
				assert.ok(
					[...sketch.constraints.values()].some(
						c =>
							c instanceof TangentLineCircleConstraint &&
							c.entityIds.includes(created[i].arcId) &&
							c.entityIds.includes(handle)
					),
					'fillet lost its spline tangency'
				);
			}
			assert.ok(
				[...sketch.constraints.values()].some(
					c => c instanceof EqualRadiusConstraint && created.every(r => c.entityIds.includes(r.arcId))
				)
			);
			assert.equal(
				[...sketch.constraints.values()].filter(
					c => c instanceof RadiusConstraint && created.some(r => c.entityIds.includes(r.arcId))
				).length,
				1
			);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
			const after = sketch.takeSnapshot();
			assert.equal(sketch.undo(), true);
			assert.deepEqual(sortedSnapshot(sketch.takeSnapshot()), sortedSnapshot(before));
			assert.equal(sketch.canUndo(), false);
			assert.equal(sketch.redo(), true);
			for (const p of after.points)
				assert.ok(
					sketch.points.get(p.id)!.distanceTo(p) < 1e-5,
					`redo moved ${p.id} by ${sketch.points.get(p.id)!.distanceTo(p)}`
				);
			assert.deepEqual(
				[...sketch.splines.values()].map(s => s.pointIds),
				[remaining.pointIds]
			);
		});

for (const reverse of [false, true])
	test(`batch trimming preserves a control spline, reversed=${reverse}`, () => {
		const sketch = new SketchDocument();
		const ids = sketch.withDeferredSolve(() => {
			const points = [
				[0, 0],
				[0, 30],
				[30, 60],
				[60, 30],
				[60, 0],
			].map(([x, y]) => sketch.addPoint({ x, y }).id);
			sketch.addControlSpline(points);
			sketch.addLine(points[0], sketch.addPoint({ x: -40, y: 0 }).id);
			sketch.addLine(points.at(-1)!, sketch.addPoint({ x: 100, y: 0 }).id);
			return [points[0], points.at(-1)!];
		});
		const pending = candidates(sketch, reverse ? ids.reverse() : ids, 5);
		const created = commitFilletsToSketch(sketch, pending);
		assert.ok(created);
		assert.equal(sketch.splines.size, 1);
		const spline = [...sketch.splines.values()][0];
		assert.equal(spline.splineType, 'control');
		for (const r of created) assert.ok(spline.pointIds.includes(r.p2Id));
		assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
	});

test('overlapping cuts of a shared spline reject the whole operation before mutation', () => {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(structuredClone(source));
	sketch.clearHistory();
	const pending = candidates(sketch, ['Point-94', 'Point-98'], 20),
		before = sketch.takeSnapshot(),
		previews = structuredClone(pending);
	assert.ok(pending[0].result.param2 > pending[1].result.param2);
	assert.equal(commitFilletsToSketch(sketch, pending), null);
	assert.deepEqual(sketch.takeSnapshot(), before);
	assert.deepEqual(structuredClone(pending), previews);
	assert.equal(sketch.canUndo(), false);
});

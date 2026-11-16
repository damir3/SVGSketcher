import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel } from '../src/kernel';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import {
	getAllGeoCurves,
	getCurveIntersections,
	getPointAtParam,
	getTrimCandidate,
	executeBreak,
	type GeoSpline,
} from '../src/math/intersection';
import { extractSplineInterval } from '../src/math/splineReference';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/splineBreakPrecision.json', import.meta.url), 'utf8'));
const native = !!getGeometryKernel().editing;

test('intersection parameters reproduce their 2D points without the old 0.01 mm projection drift', {
	skip: !native,
}, () => {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture.snapshot);
	const curves = getAllGeoCurves(sketch);
	let count = 0;
	for (const curve of curves) {
		if (curve.type !== 'spline') continue;
		for (const hit of getCurveIntersections(curve, curves)) {
			const reconstructed = getPointAtParam(curve, hit.param);
			assert.ok(
				reconstructed.distanceTo(hit.point) < 1e-8,
				`${curve.id}: ${reconstructed.distanceTo(hit.point)} mm drift`
			);
			count++;
		}
	}
	assert.ok(count >= 4);
});

test('Break at (54, 19) keeps the exact shared intersection and retained cubics through undo/redo', {
	skip: !native,
}, () => {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture.snapshot);
	sketch.clearHistory();
	const before = sketch.takeSnapshot(),
		curves = getAllGeoCurves(sketch);
	const original = curves.find(c => c.id === 'Spline-3') as GeoSpline;
	const shared = sketch.points.get('Point-40')!.clone();
	const candidate = getTrimCandidate(original, curves, new Vec2(54, 19))!;
	assert.equal(candidate.isWholeEntity, false);
	assert.ok(['Spline-2', 'Spline-4'].includes(candidate.endCuttingCurveId!));
	assert.ok(candidate.cutEndWorld.distanceTo(shared) < 1e-8);
	assert.equal(candidate.interval[0], 0);
	const expected = [
		extractSplineInterval(original.bezierSegments, 0, candidate.interval[1]),
		extractSplineInterval(original.bezierSegments, candidate.interval[1], 1),
	];
	sketch.beginTransaction();
	executeBreak(sketch, candidate);
	sketch.commitTransaction(false);
	assert.ok(sketch.points.get('Point-40')!.distanceTo(shared) < 1e-10);
	const pieces = [...sketch.splines.values()].filter(s => s.id !== 'Spline-2' && s.id !== 'Spline-4');
	assert.equal(pieces.length, 2);
	const cutId = pieces[0].pointIds.at(-1)!;
	assert.equal(pieces[1].pointIds[0], cutId);
	assert.ok(sketch.points.get(cutId)!.distanceTo(shared) < 1e-8);
	assert.ok(
		[...sketch.constraints.values()].some(
			c => c.type === 'coincident' && c.entityIds.includes(cutId) && c.entityIds.includes('Point-40')
		)
	);
	pieces.forEach((piece, k) => {
		const actual = (piece.toGeoCurve(sketch) as GeoSpline).bezierSegments;
		assert.equal(actual.length, expected[k].length);
		actual.forEach((cubic, i) =>
			cubic.forEach((p, j) => assert.ok(p.distanceTo(expected[k][i][j]) < 1e-8, `${piece.id} cubic ${i}/${j}`))
		);
	});
	const after = sketch.takeSnapshot();
	assert.equal(sketch.undo(), true);
	assert.deepEqual(sketch.takeSnapshot(), before);
	assert.equal(sketch.redo(), true);
	assert.deepEqual(sketch.takeSnapshot(), after);
});

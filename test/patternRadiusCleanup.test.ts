import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import type { SketchSnapshot } from '../src/model/history';
import { CircularPatternConstraint } from '../src/solver/constraints';
import { getAllGeoCurves, getTrimCandidate, executeTrim } from '../src/math/intersection';
import { Vec2 } from '../src/math/vector';

const fixture = JSON.parse(
	readFileSync(new URL('./fixtures/arc18-pattern-trim.json', import.meta.url), 'utf8')
) as SketchSnapshot;
function snapshot(sketch: SketchDocument) {
	return Object.fromEntries(
		Object.entries(JSON.parse(JSON.stringify(sketch.takeSnapshot()))).map(([key, value]) => [
			key,
			Array.isArray(value) && value.every(item => item && typeof item === 'object' && 'id' in item)
				? [...value].sort((a, b) => a.id.localeCompare(b.id))
				: value,
		])
	);
}

test('trimming Arc-18 preserves the circular pattern and the rest of the imported drawing', () => {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture);
	sketch.clearHistory();
	const before = sketch.takeSnapshot(),
		beforeUndo = snapshot(sketch),
		original = sketch.arcs.get('Arc-18')!;
	const pattern = sketch.constraints.get('c_cpat-3') as CircularPatternConstraint;
	const pairs = pattern.copies.map(copy => copy.pointPairs.map(pair => ({ ...pair })));
	const beforeRadiusPairs = pattern.copies.flatMap(copy => copy.radiusPairs ?? []);
	const curves = getAllGeoCurves(sketch),
		target = curves.find(curve => curve.id === original.id)!;
	const candidate = getTrimCandidate(target, curves, new Vec2(-32.1, 43.8))!;
	assert.equal(candidate.isWholeEntity, false);
	assert.ok(candidate.interval[0] > 0 && candidate.interval[1] < 1);
	assert.equal(candidate.startCuttingCurveId, 'Circle-1');
	assert.equal(candidate.endCuttingCurveId, 'Circle-1');
	assert.ok(sketch.lastSolverResult!.finalError < 1e-8);

	sketch.beginTransaction();
	executeTrim(sketch, candidate);
	sketch.commitTransaction();
	assert.equal(sketch.arcs.has(original.id), false);
	const fragments = [...sketch.arcs.values()].filter(arc => !before.arcs.some(old => old.id === arc.id));
	assert.equal(fragments.length, 2);
	for (const fragment of fragments) {
		assert.equal(fragment.centerId, original.centerId);
		assert.ok(Math.abs(fragment.radius - original.radius) < 1e-8);
	}
	for (const point of before.points) {
		const current = sketch.points.get(point.id)!;
		assert.ok(current, point.id);
		assert.ok(Math.hypot(current.x - point.x, current.y - point.y) < 1e-8, `${point.id} moved`);
	}
	for (const arc of before.arcs.filter(arc => arc.id !== original.id))
		assert.ok(Math.abs(sketch.arcs.get(arc.id)!.radius - arc.radius) < 1e-8, `${arc.id} changed radius`);
	assert.equal(
		sketch.constraints.get(pattern.id),
		pattern,
		'retain the live pattern instead of deleting all its links'
	);
	assert.deepEqual(
		pattern.copies.map(copy => copy.pointPairs),
		pairs
	);
	assert.deepEqual(
		pattern.copies.flatMap(copy => copy.radiusPairs ?? []),
		beforeRadiusPairs.filter(pair => pair.patternCircleId !== original.id)
	);
	assert.equal(pattern.entityIds.includes(original.id), false);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-8);

	const afterUndo = snapshot(sketch);
	assert.ok(sketch.undo());
	assert.deepEqual(snapshot(sketch), beforeUndo);
	assert.ok(sketch.redo());
	assert.deepEqual(snapshot(sketch), afterUndo);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
	const exported = sketch.exportSVG();
	const metadata = JSON.parse(exported.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]);
	const reopened = new SketchDocument();
	reopened.restoreSnapshot(metadata.snapshot);
	assert.deepEqual(snapshot(reopened), afterUndo);
	assert.ok(reopened.lastSolverResult!.finalError < 1e-8);
});

for (const kind of ['circular', 'rectangular'] as const)
	for (const removed of ['source', 'copy'] as const) {
		test(`${kind} pattern drops a missing ${removed} radius while retaining point links`, () => {
			const sketch = new SketchDocument();
			const pivot = sketch.addPoint(new Vec2(0, 0), true);
			const a = sketch.addPoint(new Vec2(10, 0), true),
				b = sketch.addPoint(new Vec2(kind === 'circular' ? -10 : 30, 0), true);
			const source = sketch.addCircle(a.id, 5),
				copy = sketch.addCircle(b.id, 5);
			sketch.addLine(a.id, b.id, true); // retain both centers when either circle is deleted
			const data = {
				copyIndex: 1,
				i: 1,
				j: 0,
				pointPairs: [{ sourcePtId: a.id, patternPtId: b.id }],
				radiusPairs: [{ sourceCircleId: source.id, patternCircleId: copy.id }],
				createdEntityIds: [{ id: copy.id, type: 'circle' as const }],
			};
			const pattern =
				kind === 'circular'
					? sketch.addCircularPatternConstraint(pivot.id, [source.id, a.id], 'full', 360, 2, false, [], [data])!
					: sketch.addRectangularPatternConstraint(
							[source.id, a.id],
							null,
							null,
							2,
							20,
							'one_direction',
							1,
							0,
							'one_direction',
							false,
							[],
							[data]
						)!;
			const deleted = removed === 'source' ? source : copy,
				survivor = removed === 'source' ? copy : source;
			sketch.removeEntity(deleted.id);
			assert.equal(sketch.constraints.get(pattern.id), pattern);
			assert.deepEqual(pattern.copies[0].radiusPairs, []);
			assert.equal(pattern.copies[0].pointPairs.length, 1);
			assert.equal(pattern.entityIds.includes(deleted.id), false);
			assert.equal(pattern.getEquationsCount(), 2);
			assert.ok(Math.abs(survivor.radius - 5) < 1e-8);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
		});
	}

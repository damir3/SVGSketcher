import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { findSketchRegions } from '../src/math/regions';
import { OffsetConstraint } from '../src/solver/constraints';
import type { DistanceConstraint } from '../src/solver/constraints';
import { toggleOrExtendChain, calculateOffsetGeometry, commitOffsetToSketch, type OffsetChain } from '../src/math/offset';
import { generateCircularPatternCopy } from '../src/model/patterns';
import { syncOffsetSources } from '../src/model/offsetSync';

const snapshot = JSON.parse(
	readFileSync(new URL('./fixtures/offset-polygon-source-dimension.json', import.meta.url), 'utf8')
);

function polygon() {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(structuredClone(snapshot));
	sketch.clearHistory();
	return sketch;
}

function assertSolvedPolygon(sketch: SketchDocument, target: number, dof = 3) {
	for (let i = 1; i <= 6; i++) {
		const line = sketch.lines.get(`Line-${i}`)!;
		const length = sketch.points.get(line.p1Id)!.distanceTo(sketch.points.get(line.p2Id)!);
		assert.ok(Math.abs(length - target) < 1e-5, `${line.id}: ${length} vs ${target}`);
	}
	const offset = sketch.constraints.get('c_offset-1') as OffsetConstraint;
	assert.ok(!offset.isReference);
	assert.equal(offset.targetDistance, 20);
	const values = sketch.paramManager.getCurrentValues();
	for (const c of sketch.constraints.values()) {
		assert.ok(
			c.evaluate(values).every(r => Math.abs(r) < 1e-5),
			`${c.id} is unsatisfied`
		);
	}
	assert.notEqual(sketch.lastSolverResult!.status, 'OVER_CONSTRAINED');
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, dof);
}

test('source polygon length can be changed through the inspector', () => {
	const sketch = polygon();
	for (const target of [50, 10, 100]) {
		assert.equal(sketch.setLineLength('Line-1', target), true);
		assertSolvedPolygon(sketch, target, 4);
		assert.equal(sketch.constraints.size, 2, 'inspector edits must not create a persistent dimension');
	}
});

for (const target of [5, 20, 50, 100]) {
	test(`source polygon length can be set directly to ${target}`, () => {
		const sketch = polygon();
		const line = sketch.lines.get('Line-1')!;
		const c = sketch.addDistanceConstraint(line.p1Id, line.p2Id, target)!;
		assert.ok(c);
		assert.ok(!c.isReference);
		assert.equal(c.targetDistance, target);
		assertSolvedPolygon(sketch, target);
	});
}

test('editing the default source length keeps it driving and supports undo/redo', () => {
	const sketch = polygon();
	const line = sketch.lines.get('Line-1')!;
	const c = sketch.addDistanceConstraint(line.p1Id, line.p2Id)!;
	assert.ok(!c.isReference);
	let references = 0;
	sketch.solverCoordinator.onReferenceCreated(() => references++);
	for (const target of [50, 10, 100]) {
		sketch.clearHistory();
		const current = sketch.constraints.get(c.id) as DistanceConstraint;
		const oldValue = current.targetDistance;
		assert.equal(sketch.updateDimensionalConstraint(c.id, target), true);
		assert.ok(!current.isReference);
		assertSolvedPolygon(sketch, target);
		assert.equal(sketch.undo(), true);
		assert.equal((sketch.constraints.get(c.id) as DistanceConstraint).targetDistance, oldValue);
		assert.equal(sketch.canUndo(), false);
		assert.equal(sketch.redo(), true);
		assertSolvedPolygon(sketch, target);
	}
	assert.equal(references, 0);
});

test('small residual on tangent circular-pattern seam closes cleanly when an offset is present', () => {
	const sketch = new SketchDocument();
	const count = 12;
	const pitchR = 40;
	const arcR = 5;
	const filletR = 6;
	const step = (2 * Math.PI) / count;
	const halfChord = pitchR * Math.sin(step / 2);
	const c1 = sketch.addPoint({ x: 0, y: pitchR });
	// Externally-tangent fillet center on the +x side (angle = pi/2 - step/2)
	const dFillet =
		pitchR * Math.cos(step / 2) + Math.sqrt((arcR + filletR) ** 2 - halfChord * halfChord);
	const c2x = dFillet * Math.sin(step / 2);
	const c2y = dFillet * Math.cos(step / 2);
	const dx = c2x - c1.x;
	const dy = c2y - c1.y;
	const dist = Math.hypot(dx, dy);
	const t1 = sketch.addPoint({ x: c1.x + (dx * arcR) / dist, y: c1.y + (dy * arcR) / dist });
	// Mirror t1 across Y-axis for start of arc1 (on the -x side)
	const t0 = sketch.addPoint({ x: -t1.x, y: t1.y });
	// Rotate t0 CW by step (-step) to land on the start of the adjacent copy's arc1
	const cosS = Math.cos(-step);
	const sinS = Math.sin(-step);
	const t2 = sketch.addPoint({ x: t0.x * cosS - t0.y * sinS, y: t0.x * sinS + t0.y * cosS });
	const c2 = sketch.addPoint({ x: c2x, y: c2y });

	let arc1!: ReturnType<SketchDocument['addArc']>;
	let arc2!: ReturnType<SketchDocument['addArc']>;
	let adjArc1!: ReturnType<SketchDocument['addArc']>;
	sketch.withDeferredSolve(() => {
		arc1 = sketch.addArc(c1.id, t0.id, t1.id, arcR, false);
		arc2 = sketch.addArc(c2.id, t1.id, t2.id, filletR, true);
		const pitchCircle = sketch.addCircle('origin', pitchR);
		pitchCircle.lineType = 'construction';
		sketch.addRadiusConstraint(arc1.id, arcR);
		sketch.addTangentConstraint(arc1.id, arc2.id);
		sketch.addPointOnAxisConstraint(c1.id, 'y');
		sketch.addRadiusConstraint(pitchCircle.id, pitchR);
		sketch.addPointOnCircleConstraint(c1.id, pitchCircle.id);

		const sourceIds = [arc1.id, arc2.id];
		const copies = [];
		for (let i = 1; i < count; i++) {
			const copy = generateCircularPatternCopy(sketch, 'origin', sourceIds, i, count, 'full', 360);
			assert.ok(copy);
			copies.push(copy);
		}
		const pat = sketch.addCircularPatternConstraint('origin', sourceIds, 'full', 360, count, false, [], copies);
		assert.ok(pat);
		const adjArc1Id = copies
			.map(c => c.radiusPairs!.find(p => p.sourceCircleId === arc1.id)!.patternCircleId)
			.find(id => sketch.points.get(sketch.arcs.get(id)!.startPointId)!.distanceTo(t2) < 1e-3)!;
		assert.ok(adjArc1Id);
		adjArc1 = sketch.arcs.get(adjArc1Id)!;
		sketch.addCoincidentConstraint(arc2.endPointId, adjArc1.startPointId);
		sketch.addTangentConstraint(adjArc1Id, arc2.id);
	});

	// Add an outward offset of the closed scalloped chain
	const chain = toggleOrExtendChain(sketch, null, arc1.id, 'arc', true);
	assert.ok(chain && chain.isClosed);
	const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 2, 2, true);
	assert.ok(geom.isValid);
	commitOffsetToSketch(sketch, chain, geom, 'one_side', 2, 2, true);

	// Perturb the seam slightly (~5e-5, so initial error is ~1e-9 << 1e-2)
	const pABefore = sketch.points.get(arc2.endPointId)!;
	const pBBefore = sketch.points.get(adjArc1.startPointId)!;
	assert.ok(pABefore.distanceTo(pBBefore) < 1e-5, `before perturb: ${pABefore.distanceTo(pBBefore)}`);
	pABefore.x += 4e-5;
	pABefore.y -= 3e-5;
	sketch.solve();

	// Seam must close tightly (< 1e-6), allowing both inner and outer regions to be detected
	const pA = sketch.points.get(arc2.endPointId)!;
	const pB = sketch.points.get(adjArc1.startPointId)!;
	const seamGap = pA.distanceTo(pB);
	assert.ok(seamGap < 1e-6, `expected seam gap < 1e-6, got ${seamGap}`);

	const regions = findSketchRegions(sketch);
	assert.equal(regions.length, 2, `expected 2 regions (inner + ring), got ${regions.length}`);
});

test('offset source arc tangency straightens a seam linked by coincidence constraints', () => {
	const sketch = new SketchDocument();
	const addPoint = (x: number, y: number, fixed = false) => sketch.addPoint({ x, y }, fixed);
	const end = addPoint(0, 0);
	const link = addPoint(0, 0);
	const start = addPoint(0, 0);
	const chain = sketch.withDeferredSolve((): OffsetChain => {
		const first = sketch.addArc(addPoint(-50, 0, true).id, addPoint(-10, 30, true).id, end.id, 50);
		const second = sketch.addArc(addPoint(30, 0, true).id, start.id, addPoint(12, 24, true).id, 30, true);
		sketch.addRadiusConstraint(first.id, 50);
		sketch.addRadiusConstraint(second.id, 30);
		assert.ok(sketch.addCoincidentConstraint(end.id, link.id));
		assert.ok(sketch.addCoincidentConstraint(link.id, start.id));
		const tangent = sketch.addCircleTangentConstraint(first.id, second.id);
		assert.ok(tangent);
		assert.equal(tangent.sharedPointId, null);
		return {
			items: [first, second].map(arc => ({
				id: arc.id,
				type: 'arc',
				startPointId: arc.startPointId,
				endPointId: arc.endPointId,
			})),
			isClosed: false,
		};
	});
	const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
	assert.ok(commitOffsetToSketch(sketch, chain, geom, 'one_side', 10, 10, false));
	const constraintCount = sketch.constraints.size;

	end.y = link.y = start.y = 0.002;
	sketch.solve();

	for (const point of [end, link, start]) assert.ok(Math.abs(point.y) < 1e-6);
	assert.equal(sketch.constraints.size, constraintCount);
});

test('offset topology is refreshed after settling the first source update', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 2, y: 3 });
	const source = sketch.addCircle(center.id, 10);
	const chain: OffsetChain = { items: [{ id: source.id, type: 'circle' }], isClosed: true };
	const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 5, 5, true);
	const created = commitOffsetToSketch(sketch, chain, geom, 'one_side', 5, 5, true);
	assert.ok(created);
	const offset = sketch.constraints.get(created.constraintIds[0]);
	assert.ok(offset instanceof OffsetConstraint);

	syncOffsetSources(sketch, [offset], () => {
		if (source.radius === 10) {
			source.radius = 4;
		} else if (source.radius === 4) {
			assert.equal(offset.pairs.length, 0);
			source.radius = 8;
		}
	});

	assert.equal(offset.pairs.length, 1);
	const [pair] = offset.pairs;
	assert.equal(pair.kind, 'circle');
	assert.equal(sketch.circles.get(pair.offId)?.radius, 3);
});

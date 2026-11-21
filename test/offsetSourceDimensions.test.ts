import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { OffsetConstraint } from '../src/solver/constraints';
import type { DistanceConstraint } from '../src/solver/constraints';

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

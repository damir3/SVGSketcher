import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { AngleConstraint } from '../src/solver/constraints';
import { NumericalSolver } from '../src/solver/solver';
import { DimensionModal } from '../src/ui/modal';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/triangle-reference-angle.json', import.meta.url), 'utf8'));

function triangle(scale = 1, removeAngle?: string, solver?: NumericalSolver) {
	const snapshot = structuredClone(fixture);
	for (const point of snapshot.points) {
		point.x *= scale;
		point.y *= scale;
	}
	if (removeAngle) snapshot.constraints = snapshot.constraints.filter((c: { id: string }) => c.id !== removeAngle);
	const sketch = new SketchDocument({ solver });
	sketch.restoreSnapshot(snapshot);
	sketch.clearHistory();
	return sketch;
}

class CountingSolver extends NumericalSolver {
	calls = 0;
	override solve(...args: Parameters<NumericalSolver['solve']>) {
		this.calls++;
		return super.solve(...args);
	}
}

for (const scale of [1e-6, 1, 1e6]) {
	test(`triangle angles leave its scale free (${scale})`, () => {
		const sketch = triangle(scale);
		for (let i = 0; i < 3; i++) {
			const result = sketch.solve();
			assert.equal(result.status, 'UNDER_CONSTRAINED');
			assert.equal(result.degreesOfFreedom, 1);
		}
	});
}

test('a dependent triangle angle is reference immediately without running the solver', () => {
	const solver = new CountingSolver();
	const sketch = triangle(1, 'c_ang-3', solver);
	const before = sketch.paramManager.getCurrentValues();
	const calls = solver.calls;
	const angle = sketch.addAngleConstraint('Line-7', 'Line-9')!;
	assert.equal(angle.isReference, true);
	assert.ok(Math.abs(angle.targetAngle - 90) < 1e-8);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(solver.calls, calls);
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, 1);
});

test('the first side length sets triangle scale and the next side length is reference', () => {
	const solver = new CountingSolver();
	const sketch = triangle(1, undefined, solver);
	const first = sketch.lines.get('Line-7')!;
	const dimension = sketch.addDistanceConstraint(first.p1Id, first.p2Id, 50)!;
	assert.ok(!dimension.isReference);
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, 0);
	const before = sketch.paramManager.getCurrentValues();
	const calls = solver.calls;
	const second = sketch.lines.get('Line-9')!;
	const reference = sketch.addDistanceConstraint(second.p1Id, second.p2Id)!;
	assert.equal(reference.isReference, true);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(solver.calls, calls);
});

for (const scale of [1e-6, 1, 1e6]) {
	for (const target of [80, 100]) {
		test(`incompatible edit to existing triangle angle ${target} rolls back without collapsing (scale=${scale})`, () => {
			const sketch = triangle(scale);
			const before = sketch.paramManager.getCurrentValues();
			const visibleStates: Map<string, number>[] = [];
			sketch.onChange(() => visibleStates.push(sketch.paramManager.getCurrentValues()));
			let rejected = 0;
			let references = 0;
			sketch.solverCoordinator.onConstraintRejected(() => rejected++);
			sketch.solverCoordinator.onReferenceCreated(() => references++);
			assert.equal(sketch.updateDimensionalConstraint('c_ang-3', target), false);
			const c = sketch.constraints.get('c_ang-3') as AngleConstraint;
			assert.ok(!c.isReference);
			assert.ok(Math.abs(c.targetAngle - 90) < 1e-6);
			assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
			assert.ok(visibleStates.length > 0);
			for (const values of visibleStates) assert.deepEqual(values, before, 'a collapsed trial must never reach the UI');
			assert.equal(rejected, 1);
			assert.equal(references, 0);
			assert.equal(sketch.canUndo(), false);
			assert.notEqual(sketch.lastSolverResult!.status, 'OVER_CONSTRAINED');
		});
	}
}

test('adding the inconsistent triangle angle directly also creates a reference', () => {
	const sketch = triangle(1, 'c_ang-3');
	const before = sketch.paramManager.getCurrentValues();
	const c = sketch.addAngleConstraint('Line-7', 'Line-9', 80)!;
	assert.ok(c);
	assert.equal(c.isReference, true);
	assert.ok(Math.abs(c.targetAngle - 90) < 1e-6);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
});

test('a compatible triangle angle edit stays driving and preserves a nondegenerate triangle', () => {
	const sketch = triangle(1, 'c_ang-4');
	assert.equal(sketch.updateDimensionalConstraint('c_ang-3', 80), true);
	const c = sketch.constraints.get('c_ang-3') as AngleConstraint;
	assert.ok(!c.isReference);
	assert.equal(c.targetAngle, 80);
	const a = sketch.points.get('Point-8')!;
	const b = sketch.points.get('Point-9')!;
	const d = sketch.points.get('Point-10')!;
	const area = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / 2;
	assert.ok(area > 100);
	for (const line of sketch.lines.values()) {
		assert.ok(sketch.points.get(line.p1Id)!.distanceTo(sketch.points.get(line.p2Id)!) > 1);
	}
});

test('adding a reference triangle angle can be undone and redone without changing geometry', () => {
	const sketch = triangle(1, 'c_ang-3');
	const before = sketch.paramManager.getCurrentValues();
	const added = sketch.addAngleConstraint('Line-7', 'Line-9', 80)!;
	assert.equal(added.isReference, true);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.constraints.has(added.id), false);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.canUndo(), false);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.constraints.get(added.id)!.isReference, true);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
});

test('confirming 80 in the angle popup rejects the edit, keeps the popup open, and leaves the triangle intact', () => {
	const sketch = triangle();
	const before = sketch.paramManager.getCurrentValues();
	const classes = new Set<string>();
	const classList = {
		add: (name: string) => classes.add(name),
		remove: (name: string) => classes.delete(name),
		contains: (name: string) => classes.has(name),
	};
	const input = { value: '80', focus() {}, select() {}, setSelectionRange() {} };
	const preview = { textContent: '', classList };
	const modal = Object.assign(Object.create(DimensionModal.prototype), {
		sketch,
		currentConstraint: sketch.constraints.get('c_ang-3'),
		currentMode: 'radius',
		pendingCreation: false,
		modalEl: {
			querySelector: (selector: string) => (selector === '#dim-input-val' ? input : preview),
			classList,
		},
	});
	modal.apply();
	assert.equal(classes.has('hidden'), false);
	assert.equal(preview.textContent, 'Failed to solve');
	const c = sketch.constraints.get('c_ang-3') as AngleConstraint;
	assert.ok(!c.isReference);
	assert.equal(c.targetAngle, 90);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
});

for (const size of [1e-12, 1, 1e12]) {
	test(`angle validation checks direction independently of ray length (${size})`, () => {
		const c = new AngleConstraint('angle', '', '', 'a', 'b', 'a', 'd', 90);
		const values = new Map([
			['a.x', 0],
			['a.y', 0],
			['b.x', size],
			['b.y', 0],
			['d.x', 0],
			['d.y', size],
		]);
		assert.equal(c.isSatisfied(values), true);
		c.targetAngle = 80;
		assert.equal(c.isSatisfied(values), false);
		c.targetAngle = 90;
		values.set('d.y', -size);
		assert.equal(c.isSatisfied(values), false, 'opposite rays are not the requested angle');
		values.set('d.y', 0);
		assert.equal(c.isSatisfied(values), false, 'an angle with a zero-length ray is undefined');
	});
}

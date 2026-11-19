import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SketchDocument } from '../src/model/sketch';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { DimensionModal } from '../src/ui/modal';
import { Viewport } from '../src/canvas/viewport';
import { DistanceConstraint, FixedConstraint, HorizontalConstraint } from '../src/solver/constraints';

function constrainedLine() {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 0 });
	const line = sketch.addLine(a.id, b.id);
	sketch.addDistanceConstraint(a.id, b.id, 10);
	sketch.addHorizontalConstraint(a.id, b.id);
	sketch.clearHistory();
	return { sketch, a, b, line };
}

function offsetPatternLine() {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(
		JSON.parse(readFileSync(new URL('./fixtures/offset-pattern-line11.json', import.meta.url), 'utf8'))
	);
	sketch.clearHistory();
	const line = sketch.lines.get('Line-11')!;
	return { sketch, line };
}

function dimensionPopup(sketch: SketchDocument, constraint: DistanceConstraint, value: string, isNew = false) {
	const classes = new Set<string>();
	const classList = {
		add: (value: string) => classes.add(value),
		remove: (value: string) => classes.delete(value),
		contains: (value: string) => classes.has(value),
	};
	const input = { value, focus() {}, select() {}, setSelectionRange() {} };
	const preview = { textContent: '', classList };
	const modal = Object.assign(Object.create(DimensionModal.prototype), {
		sketch,
		currentConstraint: constraint,
		currentMode: 'radius',
		pendingCreation: isNew,
		modalEl: {
			classList,
			querySelector: (selector: string) => (selector === '#dim-input-val' ? input : preview),
		},
	});
	return { modal, classes, preview };
}

test('creates a reference for conflicting distance=50 on Line-11 without moving geometry', () => {
	const { sketch, line } = offsetPatternLine();
	const before = sketch.paramManager.getCurrentValues();
	const dof = sketch.lastSolverResult!.degreesOfFreedom;
	const c = sketch.addDistanceConstraint(line.p1Id, line.p2Id, 50)!;
	assert.equal(c.isReference, true);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(c.targetDistance, sketch.points.get(line.p1Id)!.distanceTo(sketch.points.get(line.p2Id)!));
	assert.equal(sketch.lastSolverResult!.degreesOfFreedom, dof);
	assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
	assert.equal(sketch.canUndo(), true);
});

test('detects the default Line-11 dimension as reference before any value edit', () => {
	const { sketch, line } = offsetPatternLine();
	const before = sketch.paramManager.getCurrentValues();
	let references = 0;
	sketch.solverCoordinator.onReferenceCreated(() => references++);
	const c = sketch.addDistanceConstraint(line.p1Id, line.p2Id)!;
	assert.equal(c.isReference, true);
	assert.equal(c.targetDistance, sketch.points.get(line.p1Id)!.distanceTo(sketch.points.get(line.p2Id)!));
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(references, 1);
	assert.equal(sketch.updateDimensionalConstraint(c.id, 50), false, 'references are read-only');
});

test('adding a dependent Line-11 dimension skips the editor and commits one undo step', () => {
	const { sketch, line } = offsetPatternLine();
	const before = sketch.paramManager.getCurrentValues();
	sketch.selectEntity(line.id, 'line', false);
	assert.equal(
		ConstraintTool.applyConstraintToSelection('distance', {
			sketch,
			viewport: new Viewport(800, 600),
			svg: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as SVGSVGElement,
			showToast() {},
			onEditDimension: () => assert.fail('a reference must not open an editor'),
		}),
		true
	);
	assert.equal(sketch.isInTransaction(), false);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.equal(sketch.getDistanceConstraint(line.p1Id, line.p2Id)!.isReference, true);
	assert.equal(sketch.constraints.size, 4);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.hasDistanceConstraint(line.p1Id, line.p2Id), false);
	assert.equal(sketch.canUndo(), false);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.getDistanceConstraint(line.p1Id, line.p2Id)!.isReference, true);
	assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
});

test('confirming a new dimension creates one undo step for creation and its value', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 0 });
	const line = sketch.addLine(a.id, b.id);
	sketch.clearHistory();
	sketch.selectEntity(line.id, 'line', false);
	let popup: ReturnType<typeof dimensionPopup> | undefined;
	ConstraintTool.applyConstraintToSelection('distance', {
		sketch,
		viewport: new Viewport(800, 600),
		svg: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as SVGSVGElement,
		showToast() {},
		onEditDimension: (constraint, _pos, isNew) => {
			popup = dimensionPopup(sketch, constraint, '50', isNew);
			return isNew;
		},
	});
	assert.ok(popup);
	popup.modal.apply();
	assert.equal(sketch.isInTransaction(), false);
	assert.equal(sketch.getDistanceConstraint(a.id, b.id)!.targetDistance, 50);
	assert.ok(Math.abs(b.x - 50) < 1e-5);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.hasDistanceConstraint(a.id, b.id), false);
	assert.equal(sketch.canUndo(), false);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.getDistanceConstraint(a.id, b.id)!.targetDistance, 50);
});

test('rejects a conflicting constraint without changing geometry, selection, history or visible solver status', () => {
	const { sketch, a, b, line } = constrainedLine();
	sketch.selectEntity(line.id, 'line', false);
	const before = sketch.takeSnapshot();
	const selection = [...sketch.selection.lineIds];
	let rejected = 0;
	const unsubscribe = sketch.solverCoordinator.onConstraintRejected(() => rejected++);
	const statuses: string[] = [];
	sketch.onChange(() => statuses.push(sketch.lastSolverResult!.status));
	assert.equal(sketch.addConstraint(new FixedConstraint('conflict', b.id, 20, 0)), false);
	assert.deepEqual(sketch.takeSnapshot(), before);
	assert.equal(sketch.points.get(b.id), b, 'rollback preserves object references');
	assert.deepEqual([...sketch.selection.lineIds], selection);
	assert.equal(sketch.canUndo(), false);
	assert.equal(rejected, 1);
	assert.ok(statuses.every(status => status !== 'OVER_CONSTRAINED'));
	unsubscribe();
});

test('checks constant residuals when all points are fixed and returns null from helpers', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 10 }, true);
	sketch.clearHistory();
	assert.equal(sketch.addHorizontalConstraint(a.id, b.id), null);
	const reference = sketch.addDistanceConstraint(a.id, b.id, 30)!;
	assert.equal(reference.isReference, true);
	assert.equal(reference.targetDistance, Math.sqrt(200));
	assert.equal(sketch.constraints.size, 1);
	assert.equal(sketch.canUndo(), true);
	assert.equal(sketch.lastSolverResult?.status, 'CONVERGED');
});

test('creates a reference radius for an incompatible radius dimension', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 0, y: 0 }, true);
	const edge = sketch.addPoint({ x: 10, y: 0 }, true);
	const circle = sketch.addCircle(center.id, 10);
	assert.ok(sketch.addPointOnCircleConstraint(edge.id, circle.id));
	sketch.clearHistory();
	const reference = sketch.addRadiusConstraint(circle.id, 20)!;
	assert.equal(reference.isReference, true);
	assert.equal(reference.targetRadius, 10);
	assert.equal(circle.radius, 10);
	assert.equal(sketch.hasRadiusConstraint(circle.id), true);
	assert.equal(sketch.canUndo(), true);
	assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
});

test('keeps accepted constraints undoable and preserves redo after rejection', () => {
	const { sketch, a, b } = constrainedLine();
	const accepted = new HorizontalConstraint('redundant', a.id, b.id);
	assert.equal(sketch.addConstraint(accepted), true);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.canRedo(), true);
	assert.equal(sketch.addConstraint(new FixedConstraint('conflict', b.id, 20, 0)), false);
	assert.equal(sketch.canRedo(), true);
	assert.equal(sketch.redo(), true);
	assert.ok(sketch.constraints.has(accepted.id));
});

test('restores the previous constraint when a replacement with the same id fails', () => {
	const { sketch, a, b } = constrainedLine();
	const existing = [...sketch.constraints.values()].find(c => c instanceof HorizontalConstraint)!;
	assert.equal(sketch.addConstraint(new DistanceConstraint(existing.id, a.id, b.id, 20)), false);
	assert.equal(sketch.constraints.get(existing.id), existing);
});

test('validates deferred additions together and removes an unsolvable batch', () => {
	const { sketch, a, b } = constrainedLine();
	const before = sketch.paramManager.getCurrentValues();
	let rejected = 0;
	sketch.solverCoordinator.onConstraintRejected(() => rejected++);
	sketch.withDeferredSolve(() => {
		sketch.addConstraint(new HorizontalConstraint('pending-valid', a.id, b.id));
		sketch.addConstraint(new FixedConstraint('pending-conflict', b.id, 20, 0));
	});
	assert.equal(sketch.constraints.has('pending-valid'), false);
	assert.equal(sketch.constraints.has('pending-conflict'), false);
	assert.deepEqual(sketch.paramManager.getCurrentValues(), before);
	assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
	assert.equal(rejected, 1);
	assert.equal(sketch.canUndo(), false);
});

test('accepts a solvable deferred batch as one undoable edit', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 1 });
	sketch.clearHistory();
	sketch.withDeferredSolve(() => {
		sketch.addConstraint(new HorizontalConstraint('horizontal', a.id, b.id));
		sketch.addConstraint(new DistanceConstraint('distance', a.id, b.id, 20));
	});
	assert.equal(sketch.constraints.size, 2);
	assert.ok(Math.abs(b.y) < 1e-5);
	assert.ok(Math.abs(b.x - 20) < 1e-5);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.constraints.size, 0);
	assert.equal(sketch.canUndo(), false);
	assert.equal(sketch.redo(), true);
	assert.equal(sketch.constraints.size, 2);
});

test('constraint tool reports Failed to solve instead of success and does not open an editor', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 10, y: 10 }, true);
	const line = sketch.addLine(a.id, b.id);
	sketch.selectEntity(line.id, 'line', false);
	const messages: string[] = [];
	const applied = ConstraintTool.applyConstraintToSelection('horizontal', {
		sketch,
		showToast: message => messages.push(message),
		onEditDimension: () => assert.fail('rejected dimensions must not open the editor'),
	});
	assert.equal(applied, false);
	assert.deepEqual(messages, ['Failed to solve']);
	assert.equal(sketch.constraints.size, 0);
});

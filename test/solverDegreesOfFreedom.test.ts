import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeNullspace, Matrix, solveLinearSystem } from '../src/math/matrix';
import { SketchDocument } from '../src/model/sketch';

function restoreTangentCircleScene(): SketchDocument {
	const sketch = new SketchDocument();
	const fixture = new URL('./fixtures/tangent-circle-free-motion.json', import.meta.url);
	// Snapshot from sketch_1793089155851-fd-issue.svg, including its saved rounding errors.
	sketch.restoreSnapshot(JSON.parse(readFileSync(fixture, 'utf8')));
	return sketch;
}

describe('degrees of freedom with dependent constraints', () => {
	it('preserves the tangent circle scene freedom after loading and solving again', () => {
		const sketch = restoreTangentCircleScene();
		assert.equal(sketch.lastSolverResult?.status, 'UNDER_CONSTRAINED');
		assert.equal(sketch.lastSolverResult?.degreesOfFreedom, 1);
		assert.equal(sketch.solve().degreesOfFreedom, 1);
	});

	it('allows the circle to move while preserving hard constraints and its reported freedom', () => {
		const sketch = restoreTangentCircleScene();
		const center = sketch.points.get('Point-12')!;
		const originalX = center.x;
		sketch.dragCircle('Circle-1', originalX + 10, center.y);
		const result = sketch.solve();

		assert.ok(Math.abs(center.x - originalX) > 1);
		assert.equal(sketch.circles.get('Circle-1')!.radius, 25);
		assert.ok(result.finalError < 1e-8);
		assert.equal(result.status, 'UNDER_CONSTRAINED');
		assert.equal(result.degreesOfFreedom, 1);
	});

	it('reports the scene fully constrained once the circle center is fixed', () => {
		const sketch = restoreTangentCircleScene();
		sketch.points.get('Point-12')!.fixed = true;
		sketch.rebuildParamManager();
		const result = sketch.solve();

		assert.equal(result.status, 'CONVERGED');
		assert.equal(result.degreesOfFreedom, 0);
	});
});

it('distinguishes fixed coordinates from pivots that move with free coordinates', () => {
	// The first two rows fix x but allow y and z to move together.
	// The last row fixes w, whose pivot comes after the free column z.
	const matrix = new Matrix(3, 4, [1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1]);
	assert.deepEqual(analyzeNullspace(matrix), { rank: 3, fixedColumns: [0, 3] });
});

it('returns the linear solution in the original variable order after reordering and pivoting', () => {
	const matrix = new Matrix(3, 3, [1, 2, 3, 0, 0, 4, 0, 5, 0]);
	const rhs = new Float64Array([14, 12, 10]);
	assert.deepEqual(solveLinearSystem(matrix, rhs), new Float64Array([1, 2, 3]));
});

it('reports fixed parameters in a mixed sketch, excluding temporary drag targets', () => {
	const sketch = new SketchDocument();
	const anchor = sketch.addPoint({ x: 20, y: 20 }, true);
	const center = sketch.addPoint({ x: 20, y: 20 });
	const free = sketch.addPoint({ x: 50, y: 50 });
	sketch.addCoincidentConstraint(anchor.id, center.id);
	const circle = sketch.addCircle(center.id, 10);

	const initial = sketch.solve();
	assert.equal(initial.status, 'UNDER_CONSTRAINED');
	assert.ok(initial.constrainedParams.has(`${center.id}.x`));
	assert.ok(initial.constrainedParams.has(`${center.id}.y`));
	assert.ok(!initial.constrainedParams.has(`${circle.id}.r`));

	const radius = sketch.addRadiusConstraint(circle.id, 10)!;
	const dragged = sketch.dragPoint(free.id, 60, 60);
	assert.equal(dragged.degreesOfFreedom, 2);
	assert.ok(dragged.constrainedParams.has(`${circle.id}.r`));
	assert.ok(!dragged.constrainedParams.has(`${free.id}.x`));
	assert.ok(!dragged.constrainedParams.has(`${free.id}.y`));

	sketch.removeConstraint(radius.id);
	assert.ok(!sketch.lastSolverResult?.constrainedParams.has(`${circle.id}.r`));
});

it('restores a missing arc endpoint constraint in a saved sketch', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint({ x: 0, y: 0 }, true);
	const start = sketch.addPoint({ x: 100, y: 0 });
	const end = sketch.addPoint({ x: 0, y: 100 });
	const arc = sketch.addArc(center.id, start.id, end.id, 100);
	const radius = sketch.addRadiusConstraint(arc.id, 100)!;
	const snapshot = sketch.takeSnapshot();
	snapshot.constraints = snapshot.constraints.filter(c => c.type !== 'arc_endpoints');
	const dimension = snapshot.constraints.find(c => c.id === radius.id);
	assert.ok(dimension?.type === 'radius');
	dimension.targetRadius = 113;
	dimension.value = 113;

	sketch.restoreSnapshot(snapshot);

	assert.equal(sketch.arcs.get(arc.id)?.radius, 113);
	assert.equal(sketch.lastSolverResult?.degreesOfFreedom, 2);
	for (const id of [start.id, end.id]) {
		const point = sketch.points.get(id)!;
		assert.ok(Math.abs(Math.hypot(point.x, point.y) - 113) < 1e-6);
	}
});

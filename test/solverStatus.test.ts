import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';

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

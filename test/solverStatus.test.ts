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

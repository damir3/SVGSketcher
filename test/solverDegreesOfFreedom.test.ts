import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

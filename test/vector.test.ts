import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ORIGIN, Vec2, projectPointOntoLine, projectPointOntoSegment } from '../src/math/vector';

it('mutates the receiver and leaves cloned inputs and coordinate operands intact', () => {
	const point = new Vec2(2, 3);
	const offset = { x: 1, y: -2 };
	const result = point.clone();

	assert.equal(result.addScaledVector(offset, 2).subScalar(1), result);
	assert.deepEqual(result, new Vec2(3, -2));
	assert.deepEqual(point, new Vec2(2, 3));
	assert.deepEqual(offset, { x: 1, y: -2 });
});

it('keeps zero normalization and sketch direction fallbacks distinct', () => {
	assert.deepEqual(ORIGIN.clone().normalize(), new Vec2());
	assert.deepEqual(ORIGIN.clone().normalizeOrUnitX(), new Vec2(1, 0));
	assert.deepEqual(new Vec2(1e-13, 1e-13).normalizeOrUnitX(), new Vec2(1, 0));

	const short = new Vec2(3, 4);
	assert.equal(short.normalizeOrNull(5), null);
	assert.deepEqual(short, new Vec2(3, 4));
});

it('projects persisted coordinates to independent vectors even for a degenerate segment', () => {
	const start = { x: 1, y: 2 };
	const end = { x: 3, y: 2 };
	const point = { x: 4, y: 2 };
	assert.deepEqual(projectPointOntoLine(point, start, end), { point: new Vec2(4, 2), t: 1.5, dist: 0 });
	assert.deepEqual(projectPointOntoSegment(point, start, end), { point: new Vec2(3, 2), t: 1, dist: 1 });

	const projection = projectPointOntoSegment(point, start, start);
	assert.deepEqual(projection, { point: new Vec2(1, 2), t: 0, dist: 3 });
	projection.point.set(0, 0);
	assert.deepEqual(start, { x: 1, y: 2 });
});

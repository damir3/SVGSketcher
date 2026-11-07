import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { intersectSegmentCircle } from '../src/math/intersection';

describe('segment-circle tangency', () => {
	const circle = { type: 'circle' as const, id: 'circle', center: { x: 0, y: 0 }, radius: 25 };

	it('returns one contact for solver roundoff on either side, independent of segment length', () => {
		for (const halfLength of [1, 100, 10000]) {
			for (const error of [-5e-6, -1e-6, -5e-8, 0, 5e-8, 1e-6, 5e-6]) {
				const y = 25 + error;
				const hits = intersectSegmentCircle(
					{ type: 'segment', id: 'line', p1: { x: -halfLength, y }, p2: { x: halfLength, y } },
					circle
				);
				assert.equal(hits.length, 1);
				assert.ok(Math.abs(hits[0].x) < 1e-7);
				assert.equal(hits[0].y, y);
			}
		}
	});

	it('preserves real gaps and two distinct crossings', () => {
		const line = (y: number) => ({
			type: 'segment' as const,
			id: 'line',
			p1: { x: -100, y },
			p2: { x: 100, y },
		});
		assert.equal(intersectSegmentCircle(line(25.001), circle).length, 0);
		const hits = intersectSegmentCircle(line(24.999), circle);
		assert.equal(hits.length, 2);
		assert.ok(hits[0].x < 0 && hits[1].x > 0);
	});
});

import assert from 'node:assert/strict';
import { Vec2 } from '../../src/math/vector';
import { evaluateBezier, evaluateBezierDerivative, type BezierSegment } from '../../src/math/splineReference';

export function closestCubicParameter(curve: BezierSegment, point: Vec2): number {
	if (curve[0].distanceTo(point) < 1e-9) return 0;
	if (curve[3].distanceTo(point) < 1e-9) return 1;
	let best = 0,
		error = Infinity;
	for (let i = 0; i <= 32; i++) {
		const d = evaluateBezier(curve, i / 32).distanceToSquared(point);
		if (d < error) {
			best = i / 32;
			error = d;
		}
	}
	let a = Math.max(0, best - 1 / 32),
		b = Math.min(1, best + 1 / 32);
	for (let i = 0; i < 64; i++) {
		const u = a + (b - a) / 3,
			v = b - (b - a) / 3;
		if (evaluateBezier(curve, u).distanceToSquared(point) < evaluateBezier(curve, v).distanceToSquared(point)) b = v;
		else a = u;
	}
	return (a + b) / 2;
}
export function distanceToCubics(curves: readonly BezierSegment[], point: Vec2): number {
	return Math.min(...curves.map(b => evaluateBezier(b, closestCubicParameter(b, point)).distanceTo(point)));
}
/** Independent geometric check: document segments may be exact subdivisions of a compact preview cubic. */
export function assertSameCubicGeometry(actual: readonly BezierSegment[], expected: readonly BezierSegment[]): void {
	const covered: [number, number][][] = expected.map(() => []);
	for (const curve of actual) {
		let best: { index: number; start: number; end: number; error: number } | undefined;
		for (let i = 0; i < expected.length; i++) {
			const b = expected[i],
				start = closestCubicParameter(b, curve[0]),
				end = closestCubicParameter(b, curve[3]);
			if (end < start - 1e-9) continue;
			const p = evaluateBezier(b, start),
				q = evaluateBezier(b, end),
				du = (end - start) / 3;
			const restricted = [
				p,
				p.clone().addScaledVector(evaluateBezierDerivative(b, start), du),
				q.clone().addScaledVector(evaluateBezierDerivative(b, end), -du),
				q,
			];
			const error = Math.max(...restricted.map((p, k) => p.distanceTo(curve[k])));
			if (!best || error < best.error) best = { index: i, start, end, error };
		}
		assert.ok(best && best.error < 1e-5, `applied cubic differs from the preview by ${best?.error}`);
		covered[best.index].push([best.start, best.end]);
	}
	for (let i = 0; i < expected.length; i++) {
		if (expected[i].every(p => p.distanceTo(expected[i][0]) < 1e-8)) continue;
		let end = 0;
		for (const interval of covered[i].sort((a, b) => a[0] - b[0])) {
			assert.ok(interval[0] <= end + 1e-7, 'missing part of a preview cubic');
			end = Math.max(end, interval[1]);
		}
		assert.ok(end >= 1 - 1e-7, 'applied curve does not cover the complete preview');
	}
}

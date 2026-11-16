import type { QueryCurve } from './queryTypes';
import { Vec2 } from '../math/vector';
import { ellipseAxes, ellipseParameterAtPoint } from '../math/ellipse';

type Arc = Extract<QueryCurve, { type: 'arc' | 'elliptical_arc' }>;
const tau = 2 * Math.PI;
const positive = (t: number) => {
	const d = t % tau;
	return d < 0 ? d + tau : d;
};

/** World-space crossing selection: intersect the actual swept conic with box edges. */
export function arcCrossesBox(curve: Arc, min: Vec2, max: Vec2): boolean {
	const inside = (p: { x: number; y: number }) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
	if (inside(curve.start) || inside(curve.end)) return true;
	const center = Vec2.from(curve.center),
		r =
			curve.type === 'arc'
				? new Vec2(curve.radius, curve.radius)
				: center.distancesTo(curve.majorAxisPoint, curve.minorAxisPoint);
	if (r.x === 0 || r.y === 0) return curve.type === 'arc' && inside(center);
	const { axisU: u, axisV: v } = ellipseAxes(curve.type === 'arc' ? 0 : center.angleToPoint(curve.majorAxisPoint));
	const param = (p: { x: number; y: number }) =>
		curve.type === 'arc' ? center.angleToPoint(p) : ellipseParameterAtPoint(p, center, r, u, v);
	const begin = param(curve.start),
		direction = curve.clockwise ? -1 : 1,
		span = positive((param(curve.end) - begin) * direction);
	const epsilon =
		32 *
		Number.EPSILON *
		Math.max(
			Math.abs(center.x),
			Math.abs(center.y),
			r.x,
			r.y,
			Math.abs(min.x),
			Math.abs(min.y),
			Math.abs(max.x),
			Math.abs(max.y)
		);
	for (const axis of ['x', 'y'] as const) {
		const other = axis === 'x' ? 'y' : 'x',
			a = r.x * u[axis],
			b = r.y * v[axis],
			amplitude = Math.hypot(a, b),
			phase = Math.atan2(b, a);
		if (amplitude === 0) continue;
		for (const edge of [min[axis], max[axis]]) {
			const value = (edge - center[axis]) / amplitude;
			if (value < -1 - 32 * Number.EPSILON || value > 1 + 32 * Number.EPSILON) continue;
			const delta = Math.acos(Math.max(-1, Math.min(1, value)));
			for (const t of [phase - delta, phase + delta]) {
				const along = positive((t - begin) * direction);
				if (along > span + 64 * Number.EPSILON && along < tau - 64 * Number.EPSILON) continue;
				const coordinate = center[other] + r.x * Math.cos(t) * u[other] + r.y * Math.sin(t) * v[other];
				if (coordinate >= min[other] - epsilon && coordinate <= max[other] + epsilon) return true;
			}
		}
	}
	return false;
}

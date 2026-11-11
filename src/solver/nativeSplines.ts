import { PointOnSplineConstraint } from './constraints/pointOnSpline';
import { AutomaticSplineHandlesConstraint } from './constraints/automaticSplineHandles';
import type { MidpointConstraint } from './constraints/midpoint';
import { type Description, point, constant } from './nativeConstraintData';
import type { IConstraint } from './types';

function validKnots(count: number, knots: number[]): boolean {
	return (
		knots.every((v, i) => Number.isFinite(v) && (i === 0 || v >= knots[i - 1])) &&
		knots.slice(0, 4).every(v => v === knots[0]) &&
		knots.slice(-4).every(v => v === knots[knots.length - 1]) &&
		knots[0] < knots[knots.length - 1] &&
		knots.slice(4, -4).every(v => v > knots[0] && v < knots[knots.length - 1]) &&
		knots.length === count + 4
	);
}

export function describeSplineConstraint(c: IConstraint): Description | null {
	if (c instanceof PointOnSplineConstraint) {
		const count = c.splinePointIds.length;
		if (c.splineType === 'control') {
			const knots = count >= 5 && c.knots?.length === count + 4 ? c.knots : [];
			// Keep unusual nonclamped vectors on the independent TS path.
			if (knots.length && !validKnots(count, knots)) return null;
			return {
				kind: 29,
				refs: [...point(c.pointId), ...c.splinePointIds.flatMap(point), ...knots.map(constant)],
				a: 1,
				b: count,
				numeric: true,
			};
		}
		return {
			kind: 29,
			refs: [
				...point(c.pointId),
				...c.splinePointIds.flatMap(point),
				...c.splinePointIds.flatMap((_, i) => {
					const h = c.handlePoints?.[i];
					return h
						? [constant(1), ...point(h.p1Id), ...point(h.p2Id)]
						: [constant(0), constant(0), constant(0), constant(0), constant(0)];
				}),
			],
			a: 0,
			b: count,
			numeric: true,
		};
	}
	if (c instanceof AutomaticSplineHandlesConstraint) {
		if (Reflect.get(c, 'naturalHandles') !== Reflect.get(AutomaticSplineHandlesConstraint.prototype, 'naturalHandles'))
			return null;
		// Solve-time constraints expose ordinary TS-private fields at this numeric boundary.
		const ids = Reflect.get(c, 'fitPointIds') as string[];
		const handles = Reflect.get(c, 'handles') as Array<{ index: number; midpoint: MidpointConstraint }>;
		if (handles.some(h => !Number.isInteger(h.index) || h.index < 0 || h.index >= ids.length || ids.length < 2))
			return null;
		return {
			kind: 30,
			refs: [
				...ids.flatMap(point),
				...handles.flatMap(h => [constant(h.index), ...point(h.midpoint.p1Id), ...point(h.midpoint.p2Id)]),
			],
			a: ids.length,
			b: handles.length,
		};
	}
	return null;
}

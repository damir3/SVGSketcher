import { Vec2 } from '../math/vector';
import * as reference from '../math/splineReference';
import type { CubicBezier } from './types';
import type { SplineKernel } from './splineTypes';

const curve = (b: CubicBezier): reference.BezierSegment => b.map(Vec2.from) as reference.BezierSegment;
export const typescriptSplineKernel: SplineKernel = {
	naturalHandles: pts => reference.computeNaturalFitHandles(pts.map(Vec2.from)),
	fitToBezier: (pts, handles) =>
		reference.fitPointsToBezier(
			pts.map(Vec2.from),
			handles?.map(h => h && { h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) })
		),
	controlToBezier: (pts, knots) => reference.bsplineToBezier(pts.map(Vec2.from), knots && [...knots]),
	pointAt: (segments, param) => reference.getSplinePointAtParam(segments.map(curve), param),
	tangentAt: (segments, param) => reference.getSplineTangentAtParam(segments.map(curve), param),
	project: (segments, target) => reference.getSplineParamAtPoint(segments.map(curve), Vec2.from(target)),
	evaluateBezier: (b, t) => reference.evaluateBezier(curve(b), t),
	derivativeBezier: (b, t) => reference.evaluateBezierDerivative(curve(b), t),
	splitBezier: (b, t) => reference.splitBezier(curve(b), t),
};

/** Vectors of other lengths are ignored by the legacy cubic conversion. */
export function nativeKnots(count: number, knots?: readonly number[]): readonly number[] | null {
	if (count < 5 || knots?.length !== count + 4) return [];
	if (
		!knots.every((v, i) => Number.isFinite(v) && (i === 0 || v >= knots[i - 1])) ||
		!knots.slice(0, 4).every(v => v === knots[0]) ||
		!knots.slice(-4).every(v => v === knots[knots.length - 1]) ||
		!(knots[0] < knots[knots.length - 1]) ||
		!knots.slice(4, -4).every(v => v > knots[0] && v < knots[knots.length - 1])
	)
		return null;
	return knots;
}

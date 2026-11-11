import { Vec2 } from './vector';
import { getGeometryKernel } from '../kernel';
import { typescriptSplineKernel } from '../kernel/splineReference';
import * as reference from './splineReference';
import type { BezierSegment } from './splineReference';
import type { CubicBezier } from '../kernel/types';
export type { BezierSegment } from './splineReference';

// The reference backend keeps the original Vec2 path without repacking its inputs.
function active() {
	const api = getGeometryKernel().spline;
	return api === typescriptSplineKernel ? undefined : api;
}
const hydrate = (b: CubicBezier): BezierSegment => b.map(Vec2.from) as BezierSegment;

export function evaluateBezier(b: BezierSegment, t: number): Vec2 {
	const api = active();
	return api ? Vec2.from(api.evaluateBezier(b, t)) : reference.evaluateBezier(b, t);
}
export function evaluateBezierDerivative(b: BezierSegment, t: number): Vec2 {
	const api = active();
	return api ? Vec2.from(api.derivativeBezier(b, t)) : reference.evaluateBezierDerivative(b, t);
}
export function splitBezier(b: BezierSegment, t: number): { left: BezierSegment; right: BezierSegment } {
	const api = active();
	if (!api) return reference.splitBezier(b, t);
	const result = api.splitBezier(b, t);
	const middle = Vec2.from(result.left[3]);
	return {
		left: [b[0], Vec2.from(result.left[1]), Vec2.from(result.left[2]), middle],
		right: [middle, Vec2.from(result.right[1]), Vec2.from(result.right[2]), b[3]],
	};
}
export function bsplineToBezier(pts: Vec2[], explicitKnots?: number[]): BezierSegment[] {
	const api = active();
	if (!api) return reference.bsplineToBezier(pts, explicitKnots);
	const result = api.controlToBezier(pts, explicitKnots).map(hydrate);
	// The legacy knot-insertion result shares adjoining endpoints.
	if (pts.length >= 5) for (let i = 1; i < result.length; i++) result[i][0] = result[i - 1][3];
	return result;
}
export function computeNaturalFitHandles(fitPts: Vec2[]): Array<{ h1: Vec2; h2: Vec2 }> {
	const api = active();
	return api
		? api.naturalHandles(fitPts).map(h => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }))
		: reference.computeNaturalFitHandles(fitPts);
}
export function fitPointsToBezier(fitPts: Vec2[], handles?: Array<{ h1: Vec2; h2: Vec2 } | null>): BezierSegment[] {
	const api = active();
	return api ? api.fitToBezier(fitPts, handles).map(hydrate) : reference.fitPointsToBezier(fitPts, handles);
}
export function getSplinePointAtParam(segments: BezierSegment[], param: number): Vec2 {
	const api = active();
	return api ? Vec2.from(api.pointAt(segments, param)) : reference.getSplinePointAtParam(segments, param);
}
export function getSplineTangentAtParam(segments: BezierSegment[], param: number): Vec2 {
	const api = active();
	return api ? Vec2.from(api.tangentAt(segments, param)) : reference.getSplineTangentAtParam(segments, param);
}
export function getSplineParamAtPoint(
	segments: BezierSegment[],
	pt: Vec2
): { param: number; distance: number; point: Vec2 } {
	if (!segments.length) return { param: 0, distance: Infinity, point: pt };
	const api = active();
	if (!api) return reference.getSplineParamAtPoint(segments, pt);
	const result = api.project(segments, pt);
	return { ...result, point: Vec2.from(result.point) };
}

/**
 * Splits a multi-segment spline at normalized parameter t in (0, 1).
 */
export function splitSplineAtParam(
	segments: BezierSegment[],
	param: number
): { leftSegments: BezierSegment[]; rightSegments: BezierSegment[]; splitPoint: Vec2 } {
	const count = segments.length;
	const clampedParam = Math.max(0, Math.min(1, param));
	const val = clampedParam * count;
	const idx = Math.min(Math.floor(val), count - 1);
	const localT = val - idx;

	const { left, right } = splitBezier(segments[idx], localT);

	const leftSegments: BezierSegment[] = [];
	for (let i = 0; i < idx; i++) leftSegments.push(segments[i]);
	leftSegments.push(left);

	const rightSegments: BezierSegment[] = [];
	rightSegments.push(right);
	for (let i = idx + 1; i < count; i++) rightSegments.push(segments[i]);

	return {
		leftSegments,
		rightSegments,
		splitPoint: left[3],
	};
}

/**
 * Trims a single cubic Bezier curve to sub-interval [t0, t1] in [0, 1].
 */
export function trimBezier(b: BezierSegment, t0: number, t1: number): BezierSegment {
	let seg = b;
	if (t1 < 1 - 1e-6) {
		seg = splitBezier(seg, t1).left;
	}
	if (t0 > 1e-6) {
		const newT0 = t0 / Math.max(t1, 1e-6);
		seg = splitBezier(seg, Math.min(1, newT0)).right;
	}
	return seg;
}

/**
 * Extracts a sub-interval [paramA, paramB] of a spline as Bezier segments.
 */
export function extractSplineInterval(segments: BezierSegment[], paramA: number, paramB: number): BezierSegment[] {
	if (Math.abs(paramA - paramB) < 1e-5) return [];

	if (paramA > paramB) {
		const part1 = extractSplineInterval(segments, paramA, 1.0);
		const part2 = extractSplineInterval(segments, 0.0, paramB);
		return [...part1, ...part2];
	}

	if (paramA <= 1e-5 && paramB >= 1 - 1e-5) return segments;

	const count = segments.length;
	const result: BezierSegment[] = [];

	for (let i = 0; i < count; i++) {
		const segStart = i / count;
		const segEnd = (i + 1) / count;

		if (segEnd <= paramA + 1e-6 || segStart >= paramB - 1e-6) {
			continue;
		}

		const u0 = Math.max(segStart, paramA);
		const u1 = Math.min(segEnd, paramB);

		const t0 = Math.max(0, Math.min(1, (u0 - segStart) * count));
		const t1 = Math.max(0, Math.min(1, (u1 - segStart) * count));

		if (t1 - t0 < 1e-6) continue;

		result.push(trimBezier(segments[i], t0, t1));
	}

	return result;
}

/**
 * Converts Bezier segments to an SVG path string `M ... C ... C ...`.
 */
export function getSplineSvgPath(
	segments: BezierSegment[],
	coordTransform: (p: Vec2) => Vec2 = p => p,
	isClosed: boolean = false
): string {
	if (segments.length === 0) return '';

	const start = coordTransform(segments[0][0]);
	let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;

	for (const seg of segments) {
		const p1 = coordTransform(seg[1]);
		const p2 = coordTransform(seg[2]);
		const p3 = coordTransform(seg[3]);
		d += ` C ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}, ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`;
	}
	if (isClosed) {
		d += ' Z';
	}
	return d;
}

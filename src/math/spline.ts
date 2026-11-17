import { Vec2 } from './vector';
import { getGeometryKernel } from '../kernel';
import { typescriptSplineKernel } from '../kernel/splineReference';
import * as reference from './splineReference';
import type { BezierSegment } from './splineReference';
import type { CubicBezier } from '../kernel/types';
import type { SplinePiece } from '../kernel/splineTypes';
export type { BezierSegment } from './splineReference';

// The reference backend keeps the original Vec2 path without repacking its inputs.
function active() {
	const api = getGeometryKernel().spline;
	return api === typescriptSplineKernel ? undefined : api;
}
const hydrate = (b: CubicBezier): BezierSegment => b.map(Vec2.from) as BezierSegment;
function hydratePiece(segments: BezierSegment[], piece: SplinePiece): BezierSegment {
	const source = segments[piece.sourceIndex];
	if (piece.originalPoints === 15) return source;
	const result = hydrate(piece.curve);
	if (piece.originalPoints & 1) result[0] = source[0];
	if (piece.originalPoints & 8) result[3] = source[3];
	return result;
}

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
	const query = active()?.splitSpline;
	if (!query) return reference.splitSplineAtParam(segments, param);
	const result = query(segments, param);
	const leftSegments = result.left.map(piece => hydratePiece(segments, piece));
	const rightSegments = result.right.map(piece => hydratePiece(segments, piece));
	const splitPoint = leftSegments.at(-1)![3];
	rightSegments[0][0] = splitPoint;
	return { leftSegments, rightSegments, splitPoint };
}

/**
 * Trims a single cubic Bezier curve to sub-interval [t0, t1] in [0, 1].
 */
export function trimBezier(b: BezierSegment, t0: number, t1: number): BezierSegment {
	const query = active()?.trimBezier;
	return query ? hydratePiece([b], query(b, t0, t1)) : reference.trimBezier(b, t0, t1);
}

/**
 * Extracts a sub-interval [paramA, paramB] of a spline as Bezier segments.
 */
export function extractSplineInterval(segments: BezierSegment[], paramA: number, paramB: number): BezierSegment[] {
	const query = active()?.extractInterval;
	if (!query) return reference.extractSplineInterval(segments, paramA, paramB);
	const result = query(segments, paramA, paramB);
	return result.reuseSource ? segments : result.pieces.map(piece => hydratePiece(segments, piece));
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

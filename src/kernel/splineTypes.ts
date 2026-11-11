import type { CubicBezier, Point2 } from './types';

export interface SplineHandles {
	h1: Point2;
	h2: Point2;
}
export interface SplineProjection {
	param: number;
	distance: number;
	point: Point2;
}
/** UI-independent operations in the caller's coordinate system; outputs never alias document state. */
export interface SplineKernel {
	naturalHandles(points: readonly Point2[]): SplineHandles[];
	fitToBezier(points: readonly Point2[], handles?: readonly (SplineHandles | null)[]): CubicBezier[];
	controlToBezier(points: readonly Point2[], knots?: readonly number[]): CubicBezier[];
	pointAt(segments: readonly CubicBezier[], param: number): Point2;
	tangentAt(segments: readonly CubicBezier[], param: number): Point2;
	project(segments: readonly CubicBezier[], target: Point2): SplineProjection;
	evaluateBezier(curve: CubicBezier, t: number): Point2;
	derivativeBezier(curve: CubicBezier, t: number): Point2;
	splitBezier(curve: CubicBezier, t: number): { left: CubicBezier; right: CubicBezier };
}

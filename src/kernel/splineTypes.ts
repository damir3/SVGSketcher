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
export interface SplineSelfIntersection {
	point: Point2;
	paramA: number;
	paramB: number;
}
/** Source provenance lets the public Vec2 adapter retain the editor's existing object sharing. */
export interface SplinePiece {
	curve: CubicBezier;
	sourceIndex: number;
	/** Bit i means control point i retains its original source object; 15 retains the whole cubic. */
	originalPoints: number;
}
export interface SplineInterval {
	pieces: SplinePiece[];
	reuseSource: boolean;
}
/** UI-independent operations in the caller's coordinate system; outputs never alias document state. */
export interface SplineKernel {
	selfIntersections?(segments: readonly CubicBezier[], closed: boolean): SplineSelfIntersection[];
	splitSpline?(segments: readonly CubicBezier[], param: number): { left: SplinePiece[]; right: SplinePiece[] };
	trimBezier?(curve: CubicBezier, start: number, end: number): SplinePiece;
	extractInterval?(segments: readonly CubicBezier[], start: number, end: number): SplineInterval;
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

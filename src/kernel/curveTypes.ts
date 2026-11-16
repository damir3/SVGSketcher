import type { Point2 } from './types';
import type { RegionKernelCurve } from './regionTypes';

export interface CurveFrame {
	point: Point2;
	tangent: Point2;
	normal: Point2;
}
export interface PreparedCurvePath {
	readonly length: number;
	samples(distances: readonly number[]): CurveFrame[];
}
/** Pure numerical operations; parameters retain the editor's SVG-angle convention.
 * Path distances use world units and preserve each curve family's continuation rules. */
export interface CurveEvaluationKernel {
	preparePath(curve: RegionKernelCurve): PreparedCurvePath;
	pointsAtParameters(curve: RegionKernelCurve, parameters: readonly number[]): Point2[];
	parametersAtPoints(curve: RegionKernelCurve, points: readonly Point2[]): number[];
}

import type { Point2 } from './types';
import type { RegionKernelCurve } from './regionTypes';

export type QueryCurve = RegionKernelCurve;
export interface CurveBounds {
	min: Point2;
	max: Point2;
}
export interface QueryRegion {
	points: readonly Point2[];
	holes: readonly (readonly Point2[])[];
}
export interface QueryMatch {
	index: number;
	distance: number;
	/** Present for snapping, in the same coordinates as the input curves. */
	point?: Point2;
	/** Segment interpolation parameter; zero for other snap types. */
	param?: number;
}
/** No viewport or document state. Hit/snap inputs use caller-supplied screen coordinates;
 * bounds and box selection use world coordinates. Ties retain the first curve. */
export interface GeometryQueryKernel {
	bounds(curves: readonly QueryCurve[]): (CurveBounds | null)[];
	distances(curves: readonly QueryCurve[], point: Point2, threshold: number): (number | null)[];
	closest(
		curves: readonly QueryCurve[],
		point: Point2,
		threshold: number,
		snap?: boolean,
		tolerance?: number
	): QueryMatch | null;
	box(curves: readonly QueryCurve[], min: Point2, max: Point2, contained: boolean): boolean[];
	contains(regions: readonly QueryRegion[], point: Point2): boolean[];
}

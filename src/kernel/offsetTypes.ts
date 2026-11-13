import type { RegionKernelCurve } from './regionTypes';
import type { Point2 } from './types';
export type OffsetDirection = 'one_side' | 'two_sides' | 'symmetric';
export interface OffsetKernelItem {
	sourceId: string;
	kind: 'line' | 'arc' | 'spline' | 'circle' | 'ellipse' | 'elliptical_arc';
	curve: RegionKernelCurve | null;
	reversed?: boolean;
	endpointReversed?: boolean;
	gizmoClockwise?: boolean;
}
export interface KernelOffsetPrimitive {
	sourceId: string;
	/** Independent closed boundary within this offset side; omitted for the first contour. */
	contourIndex?: number;
	type: 'line' | 'arc' | 'circle' | 'spline';
	p1?: Point2;
	p2?: Point2;
	center?: Point2;
	start?: Point2;
	end?: Point2;
	radius?: number;
	clockwise?: boolean;
	circleCenter?: Point2;
	circleRadius?: number;
	fitPoints?: Point2[];
	fitBases?: Point2[];
	fitNormals?: Point2[];
	startTangent?: Point2;
	endTangent?: Point2;
	handles?: { h1: Point2; h2: Point2 }[];
	isSplineClosed?: boolean;
}
export interface KernelOffsetSide {
	primitives: KernelOffsetPrimitive[];
	side: number;
	distance: number;
	isValid: boolean;
	errorMessage?: string;
}
export interface KernelOffsetResult {
	sides: KernelOffsetSide[];
	gizmoAnchor: Point2;
	gizmoNormal: Point2;
	isValid: boolean;
	errorMessage?: string;
}
export interface OffsetKernel {
	calculate(
		items: readonly OffsetKernelItem[],
		closed: boolean,
		reference: number,
		direction: OffsetDirection,
		dist1: number,
		dist2: number,
		flip: boolean
	): KernelOffsetResult;
}

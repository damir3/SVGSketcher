import type { CubicBezier, KernelCurve, Point2 } from './types';

export type RegionKernelCurve = (
	| Exclude<KernelCurve, { type: 'bezier' }>
	| { type: 'arc'; center: Point2; radius: number; start: Point2; end: Point2; clockwise: boolean }
	| {
			type: 'elliptical_arc';
			center: Point2;
			majorAxisPoint: Point2;
			minorAxisPoint: Point2;
			start: Point2;
			end: Point2;
			clockwise: boolean;
	  }
	| { type: 'spline'; bezierSegments: readonly CubicBezier[]; isClosed?: boolean }
) & { id: string };

export interface KernelRegionRing {
	points: Point2[];
	/** M=0 (2), L=1 (2), C=2 (6), A=3 (7), Z=4 (0); coordinates are world-space. */
	commands: Float64Array;
}
export interface KernelRegion {
	area: number;
	rings: KernelRegionRing[];
}
export type RegionKernel = (curves: readonly RegionKernelCurve[]) => KernelRegion[];

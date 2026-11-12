import type { RegionKernelCurve } from './regionTypes';
import type { Point2 } from './types';

export type EditingCurve = RegionKernelCurve & { splineType?: 'fit' | 'control' };
export interface KernelCurveIntersection {
	point: Point2;
	param: number;
	source: number;
}
export interface KernelTrimCandidate {
	interval: [number, number];
	start: Point2;
	end: Point2;
	startSource?: number;
	endSource?: number;
	whole: boolean;
}
export interface KernelExtendCandidate {
	edge: 'start' | 'end';
	from: Point2;
	to: Point2;
	source?: number;
	fullLoop: boolean;
}
export interface EditingKernel {
	intersections(target: EditingCurve, curves: readonly EditingCurve[]): KernelCurveIntersection[];
	trim(target: EditingCurve, curves: readonly EditingCurve[], cursor: Point2): KernelTrimCandidate;
	extend(target: EditingCurve, curves: readonly EditingCurve[], cursor: Point2): KernelExtendCandidate | null;
}

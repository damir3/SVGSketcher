import type { RegionKernelCurve } from './regionTypes';
import type { Point2 } from './types';

export interface FilletOptions {
	cornerVertex?: Point2;
	clickPos1?: Point2;
	clickPos2?: Point2;
	endPointId1?: string;
	endPointId2?: string;
}
export interface KernelFilletResult {
	center: Point2;
	radius: number;
	t1: Point2;
	t2: Point2;
	clockwise: boolean;
	cornerVertex: Point2;
	midArc: Point2;
	bisectorDir: Point2;
	param1: number;
	param2: number;
}
export interface FilletKernel {
	evaluate(curve: RegionKernelCurve, t: number): { point: Point2; tangent: Point2; normal: Point2 };
	project(curve: RegionKernelCurve, point: Point2): { t: number; point: Point2; dist: number };
	calculate(
		curve1: RegionKernelCurve,
		curve2: RegionKernelCurve,
		radius: number,
		options: FilletOptions
	): KernelFilletResult | null;
	maxRadius(
		curve1: RegionKernelCurve,
		curve2: RegionKernelCurve,
		options: FilletOptions,
		maxR: number,
		minR: number
	): number | null;
}

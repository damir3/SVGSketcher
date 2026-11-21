import { getGeometryKernel } from '../kernel';
import type { RegionKernelCurve } from '../kernel/regionTypes';
import type { Point2 } from '../kernel/types';
import { Vec2 } from './vector';

export interface CurveSample {
	point: Vec2;
	tangent: Vec2;
	normal: Vec2;
}
export interface PathEvaluator {
	readonly length: number;
	getSampleAtDistance(distance: number): CurveSample;
	getSamplesAtDistances(distances: readonly number[]): CurveSample[];
}
export const getCurveEvaluationKernel = () => {
	const curves = getGeometryKernel().curves;
	if (!curves) throw new Error('Curve evaluation requires the Rust/WASM kernel');
	return curves;
};

/** Prepared paths capture a geometry snapshot and reuse one distance table for every batch. */
export function createCurvePath(curve: RegionKernelCurve): PathEvaluator {
	const path = getCurveEvaluationKernel().preparePath(curve);
	const sample = (distances: readonly number[]) =>
		path
			.samples(distances)
			.map(f => ({ point: Vec2.from(f.point), tangent: Vec2.from(f.tangent), normal: Vec2.from(f.normal) }));
	return { length: path.length, getSampleAtDistance: distance => sample([distance])[0], getSamplesAtDistances: sample };
}
export function pointsAtCurveParameters(curve: RegionKernelCurve, parameters: readonly number[]): Vec2[] {
	return getCurveEvaluationKernel().pointsAtParameters(curve, parameters).map(Vec2.from);
}
export function parametersAtCurvePoints(curve: RegionKernelCurve, points: readonly Point2[]): number[] {
	return getCurveEvaluationKernel().parametersAtPoints(curve, points);
}

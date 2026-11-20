import type { Point2 } from './types';
export interface TransformInput {
	center: Point2;
	translation: Point2;
	angleDegrees: number;
	scale: number;
	points: readonly Point2[];
	vectors: readonly Point2[];
	sizes: readonly number[];
}
export interface TransformResult {
	points: Point2[];
	vectors: Point2[];
	sizes: number[];
}
export type TransformKernel = (input: TransformInput) => TransformResult;

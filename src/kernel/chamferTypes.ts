import type { Point2 } from './types';

export type ChamferMode = 'equal_distance' | 'two_distance' | 'distance_angle';
export interface ChamferFrame {
	dir1: Point2;
	dir2: Point2;
	len1: number;
	len2: number;
	cornerAngleRad: number;
}
export interface ChamferCorner extends ChamferFrame {
	vertexPos: Point2;
}
export interface KernelChamferResult {
	t1: Point2;
	t2: Point2;
	dist1: number;
	dist2: number;
	angleDeg: number;
	chamferLength: number;
	midPoint: Point2;
	bisectorDir: Point2;
	maxDist1: number;
	maxDist2: number;
	isValid: boolean;
	errorMessage?: string;
}
export interface ChamferKernel {
	corner(vertex: Point2, other1: Point2, other2: Point2): ChamferFrame | null;
	calculate(
		corner: ChamferCorner,
		mode: ChamferMode,
		dist1: number,
		dist2: number,
		angle: number,
		flip: boolean
	): KernelChamferResult;
}

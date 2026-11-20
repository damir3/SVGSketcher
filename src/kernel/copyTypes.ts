import type { Point2 } from './types';
export type CopyOperation =
	| { type: 'mirror'; a: Point2; b: Point2 }
	| {
			type: 'circular';
			center: Point2;
			index: number;
			quantity: number;
			distribution: 'full' | 'partial' | 'symmetric';
			angle: number;
	  }
	| {
			type: 'rectangular';
			i: number;
			j: number;
			distance1: number;
			distance2: number;
			direction1: 'one_direction' | 'symmetric';
			direction2: 'one_direction' | 'symmetric';
			u1: Point2;
			u2: Point2;
	  }
	| { type: 'rotation'; center: Point2; angle: number }
	| { type: 'translation'; offset: Point2 }
	| { type: 'directions'; line1: readonly [Point2, Point2] | null; line2: readonly [Point2, Point2] | null };
export interface CopyResult {
	valid: boolean;
	angle: number;
	offset: Point2;
	normal: Point2;
	points: Point2[];
	near: boolean[];
}
export type CopyKernel = (points: readonly Point2[], operations: readonly CopyOperation[]) => CopyResult[];

import type { Point2 } from './types';
export interface TracePlacementInput {
	width: number;
	height: number;
	yScale: number;
	placement: { x: number; y: number; width: number; height: number; angle: number };
	points: readonly Point2[];
	radii: readonly number[];
	arcs: readonly (readonly [number, number, number])[];
}
export interface TracePlacementResult {
	scale: number;
	points: Point2[];
	radii: number[];
	clockwise: boolean[];
}
export type TracePair = readonly [number, number];
export interface TraceRelationInput {
	lines: readonly (readonly [Point2, Point2] | null)[];
	radial: readonly { center: Point2 | null; radius: number }[];
	angleTolerance: number;
	tolerance: number;
	scale: number;
	horizontalVertical: boolean;
	parallelPerpendicular: boolean;
	equal: boolean;
	concentric: boolean;
	rejectedPerpendicular?: readonly TracePair[];
	rejectedConcentric?: readonly TracePair[];
}
export interface TraceRelations {
	axes: Array<{ line: number; vertical: boolean }>;
	parallel: TracePair[];
	perpendicular: TracePair[];
	equalLength: TracePair[];
	equalRadius: TracePair[];
	concentric: TracePair[];
}
export interface TracePostprocessKernel {
	place(input: TracePlacementInput): TracePlacementResult;
	relations(input: TraceRelationInput): TraceRelations;
	moved(original: readonly Point2[], current: readonly Point2[], threshold: number): number[];
}

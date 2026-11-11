import type { KernelSolve } from './solverTypes';
import type { SplineKernel } from './splineTypes';

/** Versioned, UI-independent boundary for migrated kernel operations. */
export const GEOMETRY_KERNEL_API_VERSION = 10;
export const KERNEL_CURVE_STRIDE = 9;
export const MAX_BEZIER_INTERSECTION_CANDIDATES = 17;
// The existing sampled conic algorithm can emit one candidate per interval, including coincident curves.
export const MAX_CONIC_INTERSECTION_CANDIDATES = 128;

export interface Point2 {
	x: number;
	y: number;
}

export type CubicBezier = readonly [Point2, Point2, Point2, Point2];

export type KernelCurve =
	| { type: 'segment'; p1: Point2; p2: Point2 }
	| { type: 'circle'; center: Point2; radius: number }
	| { type: 'ellipse'; center: Point2; majorAxisPoint: Point2; minorAxisPoint: Point2 }
	| { type: 'bezier'; points: CubicBezier };

export interface IntersectionPair {
	a: KernelCurve;
	b: KernelCurve;
}

export interface GeometryKernel {
	readonly backend: 'typescript' | 'wasm';
	readonly apiVersion: typeof GEOMETRY_KERNEL_API_VERSION;
	/** Candidate points in world coordinates, one result per pair. Filter arc spans before deduplication. */
	intersectPairs(pairs: readonly IntersectionPair[]): Point2[][];
	/** Omitted by the TS reference backend, which retains the original NumericalSolver implementation. */
	solveSystem?: KernelSolve;
	spline?: SplineKernel;
}

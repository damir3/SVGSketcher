import type { Vec2 } from '../../math/vector';

export type TraceMode = 'outline' | 'centerline';
export type OutlineAlgorithm = 'marching-squares' | 'pixel-edges';
export type CenterlineAlgorithm = 'zhang-suen' | 'guo-hall';
export type ImageAfterConvert = 'keep' | 'dim' | 'delete';

/** Settings shared by the raster tracer (worker) and the sketch builder. Lengths are in processed image pixels. */
export interface ImageTraceSettings {
	mode: TraceMode;
	outlineAlgorithm: OutlineAlgorithm;
	centerlineAlgorithm: CenterlineAlgorithm;
	/** Longest side of the raster that is traced, in pixels. Larger images are downscaled. */
	maxResolution: number;
	autoThreshold: boolean;
	/** Gray level (0-255). Darker pixels are foreground unless `invert` is set. */
	threshold: number;
	invert: boolean;
	/** Gaussian blur radius applied to the grayscale image before thresholding. */
	blur: number;
	/** Foreground specks and background holes smaller than this area are removed. */
	despeckle: number;
	/** Gaussian smoothing applied to traced paths before fitting. */
	smoothing: number;
	/** Maximum deviation of a fitted primitive from the traced path. */
	tolerance: number;
	autoMinSegment: boolean;
	/** Lines and arcs shorter than this are not created; such parts become splines. */
	minSegment: number;
	/** Direction changes sharper than this angle split a path into separate pieces. */
	cornerAngle: number;
	useArcs: boolean;
	useCircles: boolean;
	constraints: {
		tangent: boolean;
		horizontalVertical: boolean;
		parallelPerpendicular: boolean;
		equal: boolean;
		concentric: boolean;
	};
	/** Angle tolerance for horizontal, vertical, parallel and perpendicular detection, in degrees. */
	angleTolerance: number;
	construction: boolean;
	afterConvert: ImageAfterConvert;
}

export const DEFAULT_TRACE_SETTINGS: ImageTraceSettings = {
	mode: 'outline',
	outlineAlgorithm: 'marching-squares',
	centerlineAlgorithm: 'zhang-suen',
	maxResolution: 1000,
	autoThreshold: true,
	threshold: 128,
	invert: false,
	blur: 0,
	despeckle: 16,
	smoothing: 1,
	tolerance: 1.5,
	autoMinSegment: true,
	minSegment: 12,
	cornerAngle: 40,
	useArcs: true,
	useCircles: true,
	constraints: {
		tangent: true,
		horizontalVertical: true,
		parallelPerpendicular: false,
		equal: false,
		concentric: false,
	},
	angleTolerance: 3,
	construction: false,
	afterConvert: 'keep',
};

export function cloneTraceSettings(settings: ImageTraceSettings): ImageTraceSettings {
	return { ...settings, constraints: { ...settings.constraints } };
}

/** Automatic minimum segment length, in pixels. */
export function getAutoMinSegment(
	settings: Pick<ImageTraceSettings, 'tolerance'>,
	width: number,
	height: number
): number {
	return Math.max(8, settings.tolerance * 5, Math.hypot(width, height) * 0.01);
}

export function getEffectiveMinSegment(settings: ImageTraceSettings, width: number, height: number): number {
	return settings.autoMinSegment ? getAutoMinSegment(settings, width, height) : Math.max(0, settings.minSegment);
}

/** Fitting options derived from settings and the image placement. Lengths are in fitting units (x pixels). */
export interface FitOptions {
	tolerance: number;
	minSegment: number;
	cornerAngle: number;
	smoothing: number;
	useArcs: boolean;
	useCircles: boolean;
	minRadius: number;
	maxRadius: number;
}

export type TracedSegment =
	| { kind: 'line'; a: number; b: number }
	| { kind: 'arc'; a: number; b: number; center: Vec2; radius: number; mid: Vec2 }
	/** Fit spline from vertex `a` through `points` to vertex `b`. `handles` has one entry per fit point including both ends. */
	| { kind: 'spline'; a: number; b: number; points: Vec2[]; handles: Array<{ h1: Vec2; h2: Vec2 }> };

export interface TracedPath {
	segments: TracedSegment[];
	closed: boolean;
	/** `tangent[i]` is true when segment `i` continues smoothly from the previous one (wrapping for closed paths). */
	tangent: boolean[];
}

export interface TracedCircle {
	center: Vec2;
	radius: number;
}

/** Closed spline that has no shared vertices (a smooth closed loop that is not a circle). */
export interface TracedClosedSpline {
	points: Vec2[];
	handles: Array<{ h1: Vec2; h2: Vec2 }>;
}

export interface TraceStats {
	lines: number;
	arcs: number;
	circles: number;
	splines: number;
}

export interface TraceResult {
	/** Size of the processed raster. */
	width: number;
	height: number;
	/** Fitting units are x pixels; image y coordinates were multiplied by this factor. */
	yScale: number;
	threshold: number;
	vertices: Vec2[];
	paths: TracedPath[];
	circles: TracedCircle[];
	closedSplines: TracedClosedSpline[];
	stats: TraceStats;
	elapsedMs: number;
}

export function countTraceStats(result: Pick<TraceResult, 'paths' | 'circles' | 'closedSplines'>): TraceStats {
	const stats: TraceStats = { lines: 0, arcs: 0, circles: result.circles.length, splines: result.closedSplines.length };
	for (const path of result.paths) {
		for (const segment of path.segments) {
			if (segment.kind === 'line') stats.lines++;
			else if (segment.kind === 'arc') stats.arcs++;
			else stats.splines++;
		}
	}
	return stats;
}

export function getTracePrimitiveCount(stats: TraceStats): number {
	return stats.lines + stats.arcs + stats.circles + stats.splines;
}

/** Above this many primitives the solver becomes noticeably slow. */
export const TRACE_PRIMITIVE_WARNING = 300;

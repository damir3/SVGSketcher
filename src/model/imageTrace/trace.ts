import { Vec2 } from '../../math/vector';
import { marchingSquares, pixelEdgeContours } from './contours';
import {
	circleToClosedSpline,
	detectClosedCircle,
	fitPolyline,
	polylineLength,
	type FittedPiece,
	type FittedPolyline,
} from './fit';
import { binarize, despeckle, gaussianBlur, otsuThreshold } from './raster';
import { extractSkeletonGraph, pruneSkeletonGraph, thin } from './skeleton';
import {
	countTraceStats,
	getEffectiveMinSegment,
	type FitOptions,
	type ImageTraceSettings,
	type TracedPath,
	type TracedSegment,
	type TraceResult,
} from './types';

export interface TraceInput {
	/** Grayscale values 0..255, row-major. Transparent pixels should already be composited onto white. */
	gray: Float32Array;
	width: number;
	height: number;
	/** Ratio of the world size of a pixel in y to its size in x. Fitting happens in x-pixel units. */
	yScale: number;
	/** World size (mm) of one pixel in x. Used to reject arcs below the sketch's minimum radius. */
	pixelSize: number;
}

/** Sketch radii are clamped to at least 1 mm. */
const MIN_WORLD_RADIUS = 1.05;

export function getFitOptions(settings: ImageTraceSettings, input: Omit<TraceInput, 'gray'>): FitOptions {
	return {
		tolerance: Math.max(0.1, settings.tolerance),
		minSegment: getEffectiveMinSegment(settings, input.width, input.height),
		cornerAngle: settings.cornerAngle,
		smoothing: settings.smoothing,
		useCircles: settings.useCircles,
		useSplines: settings.useSplines,
		minRadius: Math.max(settings.tolerance * 2, MIN_WORLD_RADIUS / Math.max(1e-9, input.pixelSize)),
		maxRadius: Math.hypot(input.width, input.height * input.yScale) * 3,
	};
}

export function prepareMask(input: TraceInput, settings: ImageTraceSettings): { mask: Uint8Array; threshold: number } {
	const blurred = gaussianBlur(input.gray, input.width, input.height, settings.blur);
	const threshold = settings.autoThreshold ? otsuThreshold(blurred) : settings.threshold;
	const binary = binarize(blurred, threshold, settings.invert);
	const mask = despeckle(binary, input.width, input.height, Math.round(settings.despeckle));
	return { mask, threshold };
}

export function traceImage(input: TraceInput, settings: ImageTraceSettings): TraceResult {
	const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const { width, height, yScale } = input;
	const options = getFitOptions(settings, input);
	const { mask, threshold } = prepareMask(input, settings);
	const scaleY = (points: Vec2[]) => points.map(p => new Vec2(p.x, p.y * yScale));

	const builder = new TraceBuilder(options);
	if (settings.mode === 'outline') {
		let contours: Vec2[][];
		if (settings.outlineAlgorithm === 'pixel-edges') {
			contours = pixelEdgeContours(mask, width, height);
		} else {
			const field = new Float32Array(mask.length);
			for (let i = 0; i < mask.length; i++) field[i] = mask[i];
			contours = marchingSquares(gaussianBlur(field, width, height, 0.8), width, height, 0.5);
		}
		for (const contour of contours) builder.addClosed(scaleY(contour));
	} else {
		const skeleton = thin(mask, width, height, settings.centerlineAlgorithm);
		const graph = pruneSkeletonGraph(
			extractSkeletonGraph(skeleton, width, height),
			Math.max(options.minSegment * 0.75, options.tolerance * 3)
		);
		const nodeVertices = new Map<number, number>();
		const nodeVertex = (node: number) => {
			let vertex = nodeVertices.get(node);
			if (vertex === undefined) {
				const p = graph.nodes[node];
				vertex = builder.addVertex(new Vec2(p.x, p.y * yScale));
				nodeVertices.set(node, vertex);
			}
			return vertex;
		};
		for (const edge of graph.edges) {
			const points = scaleY(edge.points);
			if (polylineLength(points) < options.tolerance * 2) continue;
			builder.addOpen(points, nodeVertex(edge.a), nodeVertex(edge.b));
		}
		for (const loop of graph.loops) builder.addClosed(scaleY(loop));
	}

	const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
	const result = {
		width,
		height,
		yScale,
		threshold,
		vertices: builder.vertices,
		paths: builder.paths,
		circles: builder.circles,
		closedSplines: builder.closedSplines,
	};
	return filterTracePrimitives({ ...result, stats: countTraceStats(result), elapsedMs }, settings);
}

class TraceBuilder {
	readonly vertices: Vec2[] = [];
	readonly paths: TracedPath[] = [];
	readonly circles: TraceResult['circles'] = [];
	readonly closedSplines: TraceResult['closedSplines'] = [];
	private readonly options: FitOptions;

	constructor(options: FitOptions) {
		this.options = options;
	}

	addVertex(p: Vec2): number {
		this.vertices.push(p.clone());
		return this.vertices.length - 1;
	}

	addClosed(points: Vec2[]): void {
		if (points.length < 3 || polylineLength([...points, points[0]]) < this.options.minSegment) return;
		const circle = detectClosedCircle(points, this.options);
		if (circle) {
			if (this.options.useSplines) {
				this.closedSplines.push(circleToClosedSpline(circle));
			} else {
				this.circles.push(circle);
			}
			return;
		}
		const fitted = fitPolyline({ points, closed: true }, this.options);
		if (!fitted || !fitted.pieces.length) return;
		if (fitted.pieces.length === 1 && fitted.pieces[0].kind === 'spline') {
			const piece = fitted.pieces[0];
			// A single closed spline: drop the repeated end point.
			this.closedSplines.push({ points: piece.points.slice(0, -1), handles: piece.handles.slice(0, -1) });
			return;
		}
		const vertices = fitted.pieces.map(piece => this.addVertex(fitted.points[piece.start]));
		this.pushPath(fitted, vertices, vertices[0]);
	}

	addOpen(points: Vec2[], startVertex: number, endVertex: number): void {
		const fitted = fitPolyline({ points, closed: false, pinEnds: true }, this.options);
		if (!fitted || !fitted.pieces.length) return;
		const vertices = fitted.pieces.map((piece, index) =>
			index === 0 ? startVertex : this.addVertex(fitted.points[piece.start])
		);
		this.pushPath(fitted, vertices, endVertex);
	}

	private pushPath(fitted: FittedPolyline, startVertices: number[], lastVertex: number): void {
		const segments: TracedSegment[] = fitted.pieces.map((piece, index) => {
			const a = startVertices[index];
			const b = index + 1 < startVertices.length ? startVertices[index + 1] : lastVertex;
			return toSegment(fitted.points, piece, a, b);
		});
		const tangent = fitted.pieces.map((piece, index) => {
			if (fitted.corners[index]) return false;
			const previousIndex = index > 0 ? index - 1 : fitted.closed ? fitted.pieces.length - 1 : -1;
			if (previousIndex < 0 || previousIndex === index) return false;
			const previous = fitted.pieces[previousIndex];
			if (previous.kind === 'spline' || piece.kind === 'spline') return false;
			if (previous.kind === 'line' && piece.kind === 'line') return false;
			const incoming = endDirection(fitted.points, previous, 'end');
			const outgoing = endDirection(fitted.points, piece, 'start');
			const cos = incoming.x * outgoing.x + incoming.y * outgoing.y;
			return cos > Math.cos((Math.min(12, this.options.cornerAngle / 2) * Math.PI) / 180);
		});
		this.paths.push({ segments, closed: fitted.closed, tangent });
	}
}

/** Filters fitted primitives without changing the underlying trace or connecting across gaps. */
export function filterTracePrimitives(result: TraceResult, settings: ImageTraceSettings): TraceResult {
	if (
		settings.useSplines ||
		(settings.useLines && settings.useArcs && settings.useCircles && settings.includeSplines)
	) {
		return result;
	}

	const included = { line: settings.useLines, arc: settings.useArcs, spline: settings.includeSplines };
	const paths: TracedPath[] = [];
	for (const original of result.paths) {
		const { segments, closed, tangent } = original;
		const gap = segments.findIndex(segment => !included[segment.kind]);
		if (gap === -1) {
			paths.push(original);
			continue;
		}

		// Start after a gap in a closed path to keep connected segments across the seam together.
		const start = closed ? gap + 1 : 0;
		let path: TracedPath | undefined;
		for (let offset = 0; offset < segments.length; offset++) {
			const index = (start + offset) % segments.length;
			const segment = segments[index];
			if (!included[segment.kind]) {
				path = undefined;
				continue;
			}
			if (!path) {
				path = { segments: [], closed: false, tangent: [] };
				paths.push(path);
			}
			path.tangent.push(path.segments.length > 0 && tangent[index]);
			path.segments.push(segment);
		}
	}

	const filtered = {
		...result,
		paths,
		circles: settings.useCircles ? result.circles : [],
		closedSplines: settings.includeSplines ? result.closedSplines : [],
	};
	return { ...filtered, stats: countTraceStats(filtered) };
}

function toSegment(points: Vec2[], piece: FittedPiece, a: number, b: number): TracedSegment {
	if (piece.kind === 'line') return { kind: 'line', a, b };
	if (piece.kind === 'arc') {
		const mid = points[Math.round((piece.start + piece.end) / 2)];
		return { kind: 'arc', a, b, center: piece.center, radius: piece.radius, mid: mid.clone() };
	}
	return { kind: 'spline', a, b, points: piece.points.slice(1, -1), handles: piece.handles };
}

/** Unit direction of travel at the start or end of a fitted piece. */
function endDirection(points: Vec2[], piece: FittedPiece, at: 'start' | 'end'): Vec2 {
	const p = points[at === 'start' ? piece.start : piece.end];
	const near = points[at === 'start' ? Math.min(piece.end, piece.start + 2) : Math.max(piece.start, piece.end - 2)];
	const travel = at === 'start' ? new Vec2().subVectors(near, p) : new Vec2().subVectors(p, near);
	let direction: Vec2;
	if (piece.kind === 'line') {
		const a = points[piece.start];
		const b = points[piece.end];
		direction = new Vec2().subVectors(b, a);
	} else if (piece.kind === 'arc') {
		const radial = new Vec2().subVectors(p, piece.center);
		direction = radial.clone().perpendicular();
		if (direction.x * travel.x + direction.y * travel.y < 0) direction = direction.clone().negate();
	} else {
		direction = travel;
	}
	const l = direction.length() || 1;
	return direction.clone().divideScalar(l);
}

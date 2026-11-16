import { getGeometryKernel } from '../../kernel';
import { countTraceStats, type TraceInput, type ImageTraceSettings, type TraceResult, type TracedPath } from './types';
export type { TraceInput } from './types';

/** Image tracing requires the Rust/WASM implementation. */
export function traceImage(input: TraceInput, settings: ImageTraceSettings): TraceResult {
	const trace = getGeometryKernel().traceImage;
	if (!trace) throw new Error('Image tracing requires the Rust/WASM kernel');
	return trace(input, settings);
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

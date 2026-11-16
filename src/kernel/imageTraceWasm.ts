import type { TraceInput } from '../model/imageTrace/types';
import {
	countTraceStats,
	type ImageTraceSettings,
	type TraceResult,
	type TracedPath,
	type TracedSegment,
} from '../model/imageTrace/types';

export type ImageTraceKernel = (input: TraceInput, settings: ImageTraceSettings) => TraceResult;
export type ImageTraceBinding = (gray: Float32Array, settings: Float64Array) => Float64Array;
export function createWasmImageTrace(binding: ImageTraceBinding): ImageTraceKernel {
	return (input, s) => {
		const start = performance.now();
		const { width, height, yScale, pixelSize, gray } = input;
		if (
			!Number.isInteger(width) ||
			!Number.isInteger(height) ||
			width < 1 ||
			height < 1 ||
			width > 4096 ||
			height > 4096 ||
			gray.length !== width * height
		)
			throw new Error('Invalid image trace raster size');
		if (
			!['outline', 'centerline'].includes(s.mode) ||
			!['marching-squares', 'pixel-edges'].includes(s.outlineAlgorithm) ||
			!['zhang-suen', 'guo-hall'].includes(s.centerlineAlgorithm)
		)
			throw new Error('Invalid image trace algorithm');
		const settings = new Float64Array([
			width,
			height,
			yScale,
			pixelSize,
			Number(s.mode === 'centerline'),
			Number(s.outlineAlgorithm === 'pixel-edges'),
			Number(s.centerlineAlgorithm === 'guo-hall'),
			Number(s.autoThreshold),
			s.threshold,
			Number(s.invert),
			s.blur,
			s.despeckle,
			s.smoothing,
			s.tolerance,
			Number(s.autoMinSegment),
			s.minSegment,
			s.cornerAngle,
			Number(s.useLines),
			Number(s.useArcs),
			Number(s.useCircles),
			Number(s.includeSplines),
			Number(s.useSplines),
		]);
		const data = binding(gray, settings);
		if (!data.every(Number.isFinite)) throw new Error('Non-finite WASM image trace result');
		let offset = 0;
		const number = () => {
			if (offset >= data.length) throw new Error('Truncated WASM image trace result');
			return data[offset++];
		};
		const count = (stride = 1) => {
			const value = number();
			if (!Number.isSafeInteger(value) || value < 0 || value > (data.length - offset) / stride)
				throw new Error('Invalid WASM image trace count');
			return value;
		};
		const flag = () => {
			const v = number();
			if (v !== 0 && v !== 1) throw new Error('Invalid WASM image trace flag');
			return v === 1;
		};
		const point = () => ({ x: number(), y: number() });
		const points = (n: number) => Array.from({ length: n }, point);
		// A closed cubic path can have two anchors (two curved spans or a retraced thin stroke).
		const spline = (closed: boolean) => {
			const n = count(2),
				h = count(4);
			if (h !== n + (closed ? 0 : 2) || (closed && n < 2)) throw new Error('Invalid WASM image trace spline');
			return { points: points(n), handles: Array.from({ length: h }, () => ({ h1: point(), h2: point() })) };
		};
		const threshold = number();
		if (threshold < 0 || threshold > 256) throw new Error('Invalid WASM image trace threshold');
		const vertices = points(count(2));
		const vertex = () => {
			const id = number();
			if (!Number.isInteger(id) || id < 0 || id >= vertices.length) throw new Error('Invalid WASM image trace vertex');
			return id;
		};
		const paths: TracedPath[] = Array.from({ length: count(2) }, () => {
			const closed = flag(),
				n = count(4);
			if (!n) throw new Error('Empty WASM image trace path');
			const tangent: boolean[] = [];
			const segments: TracedSegment[] = Array.from({ length: n }, () => {
				const kind = number(),
					a = vertex(),
					b = vertex();
				tangent.push(flag());
				if (kind === 0) return { kind: 'line', a, b };
				if (kind === 1) {
					const center = point(),
						radius = number(),
						mid = point();
					if (radius <= 0) throw new Error('Invalid WASM image trace radius');
					return { kind: 'arc', a, b, center, radius, mid };
				}
				if (kind === 2) return { kind: 'spline', a, b, ...spline(false) };
				throw new Error('Invalid WASM image trace primitive');
			});
			return { closed, segments, tangent };
		});
		const circles = Array.from({ length: count(3) }, () => {
			const center = point(),
				radius = number();
			if (radius <= 0) throw new Error('Invalid WASM image trace radius');
			return { center, radius };
		});
		const closedSplines = Array.from({ length: count(2) }, () => spline(true));
		if (offset !== data.length) throw new Error('Trailing WASM image trace data');
		const geometry = { paths, circles, closedSplines };
		return {
			width,
			height,
			yScale,
			threshold,
			vertices,
			...geometry,
			stats: countTraceStats(geometry),
			elapsedMs: performance.now() - start,
		};
	};
}

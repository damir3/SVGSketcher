import type { TracePostprocessKernel, TracePair } from './tracePostprocessTypes';
export type TracePostprocessBinding = (mode: number, data: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmTracePostprocess(binding: TracePostprocessBinding): TracePostprocessKernel {
	const call = (mode: number, data: number[], settings: number[]) => {
		if (!data.every(Number.isFinite) || !settings.every(Number.isFinite))
			throw Error('Non-finite trace postprocess input');
		return binding(mode, new Float64Array(data), new Float64Array(settings));
	};
	return {
		place(input) {
			const p = input.placement,
				data: number[] = [];
			for (const v of input.points) data.push(v.x, v.y);
			for (const r of input.radii) data.push(r);
			for (const a of input.arcs) data.push(...a);
			const out = call(0, data, [
				input.width,
				input.height,
				input.yScale,
				p.x,
				p.y,
				p.width,
				p.height,
				p.angle,
				input.points.length,
				input.radii.length,
				input.arcs.length,
			]);
			if (out.length !== 1 + 2 * input.points.length + input.radii.length + input.arcs.length)
				throw Error('Invalid trace placement result');
			let at = 1;
			const points = input.points.map(() => ({ x: out[at++], y: out[at++] })),
				radii = input.radii.map(() => out[at++]);
			const clockwise = input.arcs.map(() => {
				const v = out[at++];
				if (v !== 0 && v !== 1) throw Error('Invalid trace winding flag');
				return !!v;
			});
			return { scale: out[0], points, radii, clockwise };
		},
		relations(input) {
			const data: number[] = [];
			for (const line of input.lines)
				data.push(Number(!!line), ...(line ? line.flatMap(p => [p.x, p.y]) : [0, 0, 0, 0]));
			for (const r of input.radial) data.push(Number(!!r.center), r.center?.x ?? 0, r.center?.y ?? 0, r.radius);
			for (const pair of input.rejectedPerpendicular ?? []) data.push(...pair);
			for (const pair of input.rejectedConcentric ?? []) data.push(...pair);
			const flags =
				Number(input.horizontalVertical) +
				2 * Number(input.parallelPerpendicular) +
				4 * Number(input.equal) +
				8 * Number(input.concentric);
			const out = call(1, data, [
				input.lines.length,
				input.radial.length,
				input.angleTolerance,
				input.tolerance,
				input.scale,
				flags,
				input.rejectedPerpendicular?.length ?? 0,
				input.rejectedConcentric?.length ?? 0,
			]);
			let at = 0;
			const integer = (limit: number) => {
				const v = out[at++];
				if (!Number.isSafeInteger(v) || v < 0 || v >= limit) throw Error('Invalid trace relation index');
				return v;
			};
			const count = () => {
				const n = out[at++];
				if (!Number.isSafeInteger(n) || n < 0 || n > (out.length - at) / 2) throw Error('Invalid trace relation count');
				return n;
			};
			const axes = Array.from({ length: count() }, () => ({
				line: integer(input.lines.length),
				vertical: !!integer(2),
			}));
			const pairs = (limit: number): TracePair[] =>
				Array.from({ length: count() }, () => {
					const a = integer(limit),
						b = integer(limit);
					if (a === b) throw Error('Self trace relation');
					return [a, b] as const;
				});
			const result = {
				axes,
				parallel: pairs(input.lines.length),
				perpendicular: pairs(input.lines.length),
				equalLength: pairs(input.lines.length),
				equalRadius: pairs(input.radial.length),
				concentric: pairs(input.radial.length),
			};
			if (at !== out.length) throw Error('Trailing trace relation output');
			return result;
		},
		moved(original, current, threshold) {
			if (original.length !== current.length) throw Error('Invalid trace displacement size');
			const data: number[] = [];
			original.forEach((p, i) => data.push(p.x, p.y, current[i].x, current[i].y));
			const out = Array.from(call(2, data, [threshold]));
			if (out.some((v, i) => !Number.isSafeInteger(v) || v < 0 || v >= original.length || (i > 0 && v <= out[i - 1])))
				throw Error('Invalid trace displacement result');
			return out;
		},
	};
}

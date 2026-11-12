import { packRegionCurves } from './regionWasm';
import type { FilletKernel, FilletOptions } from './filletTypes';
import type { RegionKernelCurve } from './regionTypes';

export type FilletBinding = (curves: Float64Array, settings: Float64Array) => Float64Array;

export function createWasmFilletKernel(binding: FilletBinding): FilletKernel {
	const fail = (): never => {
		throw new Error('Invalid WASM fillet result');
	};
	function query(mode: number, curves: readonly RegionKernelCurve[], a: number, b = 0, options: FilletOptions = {}) {
		const { cornerVertex: v, clickPos1: c1, clickPos2: c2 } = options;
		const data = binding(
			packRegionCurves(curves),
			new Float64Array([mode, a, b, Number(!!v), v?.x ?? 0, v?.y ?? 0, c1?.x ?? 0, c1?.y ?? 0, c2?.x ?? 0, c2?.y ?? 0])
		);
		const emptyProjection = mode === 1 && curves[0].type === 'spline' && !curves[0].bezierSegments.length;
		if (!data.every((v, i) => Number.isFinite(v) || (emptyProjection && i === 3 && v === Infinity))) fail();
		return data;
	}
	const point = (data: Float64Array, i: number) => ({ x: data[i], y: data[i + 1] });
	return {
		evaluate(curve, t) {
			const data = query(0, [curve], t);
			if (data.length !== 6) fail();
			return { point: point(data, 0), tangent: point(data, 2), normal: point(data, 4) };
		},
		project(curve, p) {
			const data = query(1, [curve], p.x, p.y);
			if (data.length !== 4 || data[3] < 0) fail();
			return { t: data[0], point: point(data, 1), dist: data[3] };
		},
		calculate(c1, c2, radius, options) {
			const data = query(2, [c1, c2], radius, 0, options);
			if (data.length === 1 && data[0] === 0) return null;
			if (
				data.length !== 17 ||
				data[0] !== 1 ||
				data[3] <= 0.01 ||
				data[3] !== radius ||
				(data[8] !== 0 && data[8] !== 1)
			)
				fail();
			return {
				center: point(data, 1),
				radius: data[3],
				t1: point(data, 4),
				t2: point(data, 6),
				clockwise: data[8] === 1,
				cornerVertex: point(data, 9),
				midArc: point(data, 11),
				bisectorDir: point(data, 13),
				param1: data[15],
				param2: data[16],
			};
		},
		maxRadius(c1, c2, options, maxR, minR) {
			const data = query(3, [c1, c2], maxR, minR, options);
			if (data.length === 1 && data[0] === 0) return null;
			if (
				data.length !== 2 ||
				data[0] !== 1 ||
				data[1] <= 0.01 ||
				data[1] < Math.min(minR, maxR) ||
				data[1] > Math.max(minR, maxR)
			)
				fail();
			return data[1];
		},
	};
}

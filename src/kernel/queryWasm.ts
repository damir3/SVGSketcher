import { packRegionCurves } from './regionWasm';
import type { GeometryQueryKernel, QueryCurve, QueryMatch } from './queryTypes';
import type { Point2 } from './types';

export type QueryBinding = (curves: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmQueryKernel(binding: QueryBinding): GeometryQueryKernel {
	const call = (mode: number, curves: readonly QueryCurve[], p: Point2 = { x: 0, y: 0 }, a = 0, b = 0) =>
		binding(packRegionCurves(curves), new Float64Array([mode, p.x, p.y, a, b]));
	const check = (data: Float64Array, length: number) => {
		if (data.length !== length || !data.every(Number.isFinite)) throw new Error('Invalid WASM geometry query result');
		return data;
	};
	const flag = (v: number) => {
		if (v !== 0 && v !== 1) throw new Error('Invalid WASM geometry query flag');
		return v === 1;
	};
	return {
		bounds(curves) {
			const data = check(call(0, curves), curves.length * 5);
			return curves.map((_, i) => {
				const [present, minX, minY, maxX, maxY] = data.subarray(i * 5, i * 5 + 5);
				if (!flag(present)) {
					if (minX !== 0 || minY !== 0 || maxX !== 0 || maxY !== 0) throw new Error('Invalid empty WASM query bounds');
					return null;
				}
				if (minX > maxX || minY > maxY) throw new Error('Invalid WASM query bounds');
				return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
			});
		},
		distances(curves, point, threshold) {
			const data = check(call(1, curves, point, threshold), curves.length * 2);
			return curves.map((_, i) => {
				if (!flag(data[i * 2])) {
					if (data[i * 2 + 1] !== 0) throw new Error('Invalid empty WASM query distance');
					return null;
				}
				const d = data[i * 2 + 1];
				if (d < 0) throw new Error('Negative WASM query distance');
				return d;
			});
		},
		closest(curves, point, threshold, snap = false, tolerance = threshold): QueryMatch | null {
			const data = check(call(snap ? 3 : 2, curves, point, threshold, tolerance), 5),
				index = data[0];
			if (index === -1) {
				if (data.slice(1).some(v => v !== 0)) throw new Error('Invalid empty WASM query match');
				return null;
			}
			if (
				!Number.isSafeInteger(index) ||
				index < 0 ||
				index >= curves.length ||
				data[1] < 0 ||
				data[1] >= threshold ||
				data[4] < 0 ||
				data[4] > 1
			)
				throw new Error('Invalid WASM query match');
			return { index, distance: data[1], ...(snap ? { point: { x: data[2], y: data[3] }, param: data[4] } : {}) };
		},
		box(curves, min, max, contained) {
			return [...check(call(contained ? 5 : 4, curves, min, max.x, max.y), curves.length)].map(flag);
		},
		contains(regions, p) {
			const values: number[] = [regions.length];
			for (const region of regions) {
				const rings = [region.points, ...region.holes];
				values.push(rings.length);
				for (const ring of rings) {
					values.push(ring.length);
					for (const p of ring) values.push(p.x, p.y);
				}
			}
			return [...check(binding(new Float64Array(values), new Float64Array([6, p.x, p.y, 0, 0])), regions.length)].map(
				flag
			);
		},
	};
}

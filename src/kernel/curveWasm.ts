import type { CurveEvaluationKernel, CurveFrame } from './curveTypes';
import { packRegionCurves } from './regionWasm';
import { isQueryableCurve } from '../math/queries';

export type CurvePathBinding = (
	curve: Float64Array,
	table: Float64Array,
	values: Float64Array,
	mode: number
) => Float64Array;
const empty = new Float64Array();
function checked(data: Float64Array, size: number): Float64Array {
	if (data.length !== size || !data.every(Number.isFinite)) throw new Error('Invalid WASM curve path result');
	return data;
}
export function createWasmCurveKernel(binding: CurvePathBinding): CurveEvaluationKernel {
	return {
		preparePath(curve) {
			if (!isQueryableCurve(curve)) throw new Error('Non-finite curve path input');
			const data = packRegionCurves([curve]),
				table = binding(data, empty, empty, 0),
				n = (table.length - 4) / 3;
			const countValid =
				curve.type === 'spline'
					? n === (curve.bezierSegments.length ? curve.bezierSegments.length * 20 + 1 : 0)
					: curve.type === 'ellipse' || curve.type === 'elliptical_arc'
						? n === 257 || n === 258
						: n === 0;
			checked(table, table.length);
			if (!countValid || table.length < 4 || table[0] < 0 || table[1] < 0 || ![1, -1].includes(table[3]))
				throw new Error('Invalid WASM curve path table');
			// Keep the packed snapshot and its table together; no Rust allocation handles escape.
			return {
				length: table[0],
				samples(distances) {
					if (!distances.every(Number.isFinite)) throw new Error('Non-finite curve path distance');
					if (!distances.length) return [];
					const out = checked(binding(data, table, new Float64Array(distances), 1), distances.length * 6);
					return distances.map(
						(_, i): CurveFrame => ({
							point: { x: out[i * 6], y: out[i * 6 + 1] },
							tangent: { x: out[i * 6 + 2], y: out[i * 6 + 3] },
							normal: { x: out[i * 6 + 4], y: out[i * 6 + 5] },
						})
					);
				},
			};
		},
		pointsAtParameters(curve, parameters) {
			if (!isQueryableCurve(curve) || !parameters.every(Number.isFinite))
				throw new Error('Non-finite curve parameter input');
			if (!parameters.length) return [];
			const out = checked(
				binding(packRegionCurves([curve]), empty, new Float64Array(parameters), 2),
				parameters.length * 2
			);
			return parameters.map((_, i) => ({ x: out[i * 2], y: out[i * 2 + 1] }));
		},
		parametersAtPoints(curve, points) {
			if (!isQueryableCurve(curve) || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
				throw new Error('Non-finite curve point input');
			if (!points.length) return [];
			const data = new Float64Array(points.length * 2);
			points.forEach((p, i) => {
				data[i * 2] = p.x;
				data[i * 2 + 1] = p.y;
			});
			const result = checked(binding(packRegionCurves([curve]), empty, data, 3), points.length);
			const period = curve.type === 'circle' || curve.type === 'ellipse' ? 2 * Math.PI : 1;
			if (!result.every(t => t >= 0 && t <= period)) throw new Error('Invalid WASM curve parameter');
			return [...result];
		},
	};
}

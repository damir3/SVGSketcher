import type { ChamferKernel } from './chamferTypes';
export type ChamferBinding = (geometry: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmChamferKernel(binding: ChamferBinding): ChamferKernel {
	const fail = (): never => {
		throw new Error('Invalid WASM chamfer result');
	};
	const point = (data: Float64Array, i: number) => ({ x: data[i], y: data[i + 1] });
	const errors = [
		undefined,
		'Angle must be greater than 0°',
		'Angle too large for corner',
		'Distance too large for corner',
	] as const;
	return {
		corner(vertex, other1, other2) {
			const data = binding(
				new Float64Array([vertex.x, vertex.y, other1.x, other1.y, other2.x, other2.y]),
				new Float64Array(6)
			);
			if (data.length === 1 && data[0] === 0) return null;
			if (
				data.length !== 8 ||
				!data.every(Number.isFinite) ||
				data[0] !== 1 ||
				data[5] < 1e-4 ||
				data[6] < 1e-4 ||
				data[7] <= 0 ||
				data[7] >= Math.PI
			)
				fail();
			return { dir1: point(data, 1), dir2: point(data, 3), len1: data[5], len2: data[6], cornerAngleRad: data[7] };
		},
		calculate(c, mode, d1, d2, angle, flip) {
			const data = binding(
				new Float64Array([
					c.vertexPos.x,
					c.vertexPos.y,
					c.dir1.x,
					c.dir1.y,
					c.dir2.x,
					c.dir2.y,
					c.len1,
					c.len2,
					c.cornerAngleRad,
				]),
				new Float64Array([
					1,
					['equal_distance', 'two_distance', 'distance_angle'].indexOf(mode),
					d1,
					d2,
					angle,
					Number(flip),
				])
			);
			if (
				data.length !== 15 ||
				!data.every(Number.isFinite) ||
				!Number.isInteger(data[14]) ||
				data[14] < 0 ||
				data[14] > 3 ||
				data[4] < 0 ||
				data[5] < 0 ||
				data[6] < 0 ||
				data[6] > 180 ||
				data[7] < 0 ||
				data[12] < 0.1 ||
				data[13] < 0.1
			)
				fail();
			return {
				t1: point(data, 0),
				t2: point(data, 2),
				dist1: data[4],
				dist2: data[5],
				angleDeg: data[6],
				chamferLength: data[7],
				midPoint: point(data, 8),
				bisectorDir: point(data, 10),
				maxDist1: data[12],
				maxDist2: data[13],
				isValid: data[14] === 0,
				errorMessage: errors[data[14]],
			};
		},
	};
}

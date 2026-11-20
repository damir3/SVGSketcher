import type { TransformKernel } from './transformTypes';
export type TransformBinding = (data: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmTransform(binding: TransformBinding): TransformKernel {
	return input => {
		const settings = new Float64Array([
			input.center.x,
			input.center.y,
			input.translation.x,
			input.translation.y,
			input.angleDegrees,
			input.scale,
			input.points.length,
			input.vectors.length,
			input.sizes.length,
		]);
		const data = new Float64Array(2 * (input.points.length + input.vectors.length) + input.sizes.length);
		let at = 0;
		for (const points of [input.points, input.vectors])
			for (const p of points) {
				data[at++] = p.x;
				data[at++] = p.y;
			}
		for (const size of input.sizes) data[at++] = size;
		if (!settings.every(Number.isFinite) || !data.every(Number.isFinite)) throw new Error('Non-finite transform input');
		const out = binding(data, settings);
		if (out.length !== data.length) throw new Error('Invalid WASM transform result');
		// Overflow is checked by the editor before committing any geometry.
		at = 0;
		const points = (count: number) => Array.from({ length: count }, () => ({ x: out[at++], y: out[at++] }));
		return {
			points: points(input.points.length),
			vectors: points(input.vectors.length),
			sizes: Array.from(out.subarray(at)),
		};
	};
}

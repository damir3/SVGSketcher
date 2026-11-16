import { MAX_OFFSET_SPLINE_POINTS, type OffsetSplineResize } from './offsetTypes';

export type OffsetSplineResizeBinding = (data: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmOffsetSplineResize(binding: OffsetSplineResizeBinding): OffsetSplineResize {
	return (spline, count, distance) => {
		const n = spline.points.length;
		if (
			n < 2 ||
			spline.normals.length !== n ||
			spline.handles.length !== n ||
			!Number.isSafeInteger(count) ||
			count < n ||
			count > MAX_OFFSET_SPLINE_POINTS ||
			!Number.isFinite(distance)
		)
			throw new Error('Invalid offset spline resize input');
		const data = new Float64Array(2 + n * 8);
		data[0] = Number(spline.closed);
		data[1] = n;
		for (let i = 0; i < n; i++) {
			const points = [spline.points[i], spline.normals[i], spline.handles[i].h1, spline.handles[i].h2];
			points.forEach((p, j) => {
				data[2 + i * 8 + j * 2] = p.x;
				data[3 + i * 8 + j * 2] = p.y;
			});
		}
		if (!data.every(Number.isFinite)) throw new Error('Non-finite offset spline resize input');
		const result = binding(data, new Float64Array([count, distance]));
		if (result.length !== count * 10 || !result.every(Number.isFinite))
			throw new Error('Invalid WASM offset spline resize result');
		const point = (i: number, offset: number) => ({ x: result[i * 10 + offset], y: result[i * 10 + offset + 1] });
		const indices = Array.from({ length: count }, (_, i) => i);
		return {
			points: indices.map(i => point(i, 0)),
			normals: indices.map(i => point(i, 2)),
			bases: indices.map(i => point(i, 4)),
			handles: indices.map(i => ({ h1: point(i, 6), h2: point(i, 8) })),
		};
	};
}

import type { CubicBezier, Point2 } from './types';
import type { SplineKernel } from './splineTypes';
import { nativeKnots, typescriptSplineKernel as reference } from './splineReference';

export type SplineGeometryBinding = (
	points: Float64Array,
	handles: Float64Array,
	knots: Float64Array,
	settings: Float64Array
) => Float64Array;
const empty = new Float64Array();
function pack(points: readonly Point2[]): Float64Array | null {
	const data = new Float64Array(points.length * 2);
	for (let i = 0; i < points.length; i++) {
		const { x, y } = points[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
		data[i * 2] = x;
		data[i * 2 + 1] = y;
	}
	return data;
}
const packCurves = (curves: readonly CubicBezier[]) => pack(curves.flatMap(b => [...b]));
function checked(data: Float64Array, size: number): Float64Array {
	if (data.length !== size || !data.every(Number.isFinite)) throw new Error('Invalid WASM spline result');
	return data;
}
const point = (data: Float64Array, at = 0): Point2 => ({ x: data[at], y: data[at + 1] });
function curves(data: Float64Array, min: number, max = min): CubicBezier[] {
	if (data.length % 8 !== 0 || data.length / 8 < min || data.length / 8 > max)
		throw new Error('Invalid WASM spline segment count');
	checked(data, data.length);
	return Array.from({ length: data.length / 8 }, (_, i) => [
		point(data, i * 8),
		point(data, i * 8 + 2),
		point(data, i * 8 + 4),
		point(data, i * 8 + 6),
	]);
}

export function createWasmSplineKernel(binding: SplineGeometryBinding): SplineKernel {
	const query = (
		mode: number,
		data: Float64Array,
		param = 0,
		target: Point2 = { x: 0, y: 0 },
		handles = empty,
		knots = empty
	) => binding(data, handles, knots, new Float64Array([mode, target.x, target.y, param]));
	return {
		naturalHandles(pts) {
			if (pts.length < 2) return [];
			const packed = pack(pts);
			if (!packed) return reference.naturalHandles(pts);
			const data = checked(query(0, packed), pts.length * 4);
			return Array.from({ length: pts.length }, (_, i) => ({ h1: point(data, i * 4), h2: point(data, i * 4 + 2) }));
		},
		fitToBezier(pts, handles) {
			if (pts.length < 2) return [];
			const packed = pack(pts);
			const hs = handles ? new Float64Array(pts.length * 5) : empty;
			for (let i = 0; handles && i < pts.length; i++) {
				const h = handles[i];
				if (!h) continue;
				if (![h.h1.x, h.h1.y, h.h2.x, h.h2.y].every(Number.isFinite)) return reference.fitToBezier(pts, handles);
				hs.set([1, h.h1.x, h.h1.y, h.h2.x, h.h2.y], i * 5);
			}
			if (!packed) return reference.fitToBezier(pts, handles);
			return curves(query(1, packed, 0, undefined, hs), pts.length - 1);
		},
		controlToBezier(pts, knots) {
			if (pts.length < 2) return [];
			const canonical = nativeKnots(pts.length, knots),
				packed = pack(pts);
			if (!canonical || !packed) return reference.controlToBezier(pts, knots);
			return curves(query(2, packed, 0, undefined, empty, new Float64Array(canonical)), 1, Math.max(1, pts.length - 3));
		},
		pointAt(segments, param) {
			if (!segments.length) return { x: 0, y: 0 };
			const packed = packCurves(segments);
			return packed && Number.isFinite(param)
				? point(checked(query(4, packed, param), 2))
				: reference.pointAt(segments, param);
		},
		tangentAt(segments, param) {
			if (!segments.length) return { x: 1, y: 0 };
			const packed = packCurves(segments);
			return packed && Number.isFinite(param)
				? point(checked(query(5, packed, param), 2))
				: reference.tangentAt(segments, param);
		},
		project(segments, target) {
			if (!segments.length) return { param: 0, distance: Infinity, point: { ...target } };
			const packed = packCurves(segments);
			if (!packed || !Number.isFinite(target.x) || !Number.isFinite(target.y))
				return reference.project(segments, target);
			const data = checked(query(9, packed, 0, target), 4);
			if (data[0] < 0 || data[0] > 1 || data[1] < 0) throw new Error('Invalid WASM spline projection');
			return { param: data[0], distance: data[1], point: point(data, 2) };
		},
		evaluateBezier(b, t) {
			const packed = pack(b);
			return packed && Number.isFinite(t) ? point(checked(query(6, packed, t), 2)) : reference.evaluateBezier(b, t);
		},
		derivativeBezier(b, t) {
			const packed = pack(b);
			return packed && Number.isFinite(t) ? point(checked(query(7, packed, t), 2)) : reference.derivativeBezier(b, t);
		},
		splitBezier(b, t) {
			const packed = pack(b);
			if (!packed || !Number.isFinite(t)) return reference.splitBezier(b, t);
			const result = curves(query(8, packed, t), 2);
			return { left: result[0], right: result[1] };
		},
	};
}

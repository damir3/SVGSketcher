import type { CubicBezier, Point2 } from './types';
import type { SplineKernel, SplinePiece } from './splineTypes';

export type SplineGeometryBinding = (
	points: Float64Array,
	handles: Float64Array,
	knots: Float64Array,
	settings: Float64Array
) => Float64Array;
const empty = new Float64Array();

function nativeKnots(count: number, knots?: readonly number[]): readonly number[] | null {
	if (count < 5 || knots?.length !== count + 4) return [];
	if (
		!knots.every((v, i) => Number.isFinite(v) && (i === 0 || v >= knots[i - 1])) ||
		!knots.slice(0, 4).every(v => v === knots[0]) ||
		!knots.slice(-4).every(v => v === knots[knots.length - 1]) ||
		!(knots[0] < knots[knots.length - 1]) ||
		!knots.slice(4, -4).every(v => v > knots[0] && v < knots[knots.length - 1])
	)
		return null;
	return knots;
}
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

function pieces(data: Float64Array, source: readonly CubicBezier[], min: number, max = min): SplinePiece[] {
	if (data.length % 10 || data.length / 10 < min || data.length / 10 > max)
		throw new Error('Invalid WASM spline cut count');
	checked(data, data.length);
	return Array.from({ length: data.length / 10 }, (_, i) => {
		const at = i * 10,
			sourceIndex = data[at],
			originalPoints = data[at + 1];
		if (
			!Number.isInteger(sourceIndex) ||
			sourceIndex < 0 ||
			sourceIndex >= source.length ||
			![0, 1, 8, 15].includes(originalPoints)
		)
			throw new Error('Invalid WASM spline cut provenance');
		const curve: CubicBezier = [point(data, at + 2), point(data, at + 4), point(data, at + 6), point(data, at + 8)];
		for (let p = 0; p < 4; p++) {
			if (
				originalPoints & (1 << p) &&
				(curve[p].x !== source[sourceIndex][p].x || curve[p].y !== source[sourceIndex][p].y)
			)
				throw new Error('Invalid WASM spline cut source point');
		}
		return { curve, sourceIndex, originalPoints };
	});
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
	const cut = (mode: number, segments: readonly CubicBezier[], start: number, end = 0) => {
		const packed = packCurves(segments);
		if (!packed || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Non-finite spline cut input');
		return binding(packed, empty, empty, new Float64Array([mode, start, end, 0]));
	};
	return {
		splitSpline(segments, param) {
			const data = cut(11, segments, param),
				count = data[0];
			if (!Number.isInteger(count) || count < 1 || count > segments.length)
				throw new Error('Invalid WASM spline split count');
			const result = pieces(data.subarray(1), segments, segments.length + 1);
			for (const [i, piece] of result.entries()) {
				const expectedMask = i === count - 1 ? 1 : i === count ? 8 : 15;
				if (piece.sourceIndex !== i - Number(i >= count) || piece.originalPoints !== expectedMask)
					throw new Error('Invalid WASM spline split provenance');
			}
			const a = result[count - 1].curve[3],
				b = result[count].curve[0];
			if (a.x !== b.x || a.y !== b.y) throw new Error('Invalid WASM spline split point');
			return { left: result.slice(0, count), right: result.slice(count) };
		},
		trimBezier(curve, start, end) {
			return pieces(cut(12, [curve], start, end), [curve], 1)[0];
		},
		extractInterval(segments, start, end) {
			const data = cut(13, segments, start, end);
			if (![0, 1].includes(data[0])) throw new Error('Invalid WASM spline interval flag');
			const result = pieces(data.subarray(1), segments, 0, 2 * segments.length);
			if (
				data[0] === 1 &&
				(result.length !== segments.length || result.some((p, i) => p.sourceIndex !== i || p.originalPoints !== 15))
			)
				throw new Error('Invalid WASM spline interval provenance');
			return { pieces: result, reuseSource: data[0] === 1 };
		},
		selfIntersections(segments, closed) {
			const packed = packCurves(segments);
			if (!packed) throw new Error('Non-finite spline self-intersection input');
			const data = query(10, packed, Number(closed));
			const maxHits = segments.length + (16 * segments.length * (segments.length - 1)) / 2;
			if (data.length % 4 !== 0 || data.length / 4 > maxHits)
				throw new Error('Invalid WASM spline self-intersection count');
			checked(data, data.length);
			return Array.from({ length: data.length / 4 }, (_, i) => {
				const paramA = data[i * 4 + 2],
					paramB = data[i * 4 + 3];
				if (paramA < 0 || paramB > 1 || paramA >= paramB)
					throw new Error('Invalid WASM spline self-intersection parameters');
				return { point: point(data, i * 4), paramA, paramB };
			});
		},
		naturalHandles(pts) {
			if (pts.length < 2) return [];
			const packed = pack(pts);
			if (!packed) throw new Error('Non-finite spline input');
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
				if (![h.h1.x, h.h1.y, h.h2.x, h.h2.y].every(Number.isFinite)) throw new Error('Non-finite spline input');
				hs.set([1, h.h1.x, h.h1.y, h.h2.x, h.h2.y], i * 5);
			}
			if (!packed) throw new Error('Non-finite spline input');
			return curves(query(1, packed, 0, undefined, hs), pts.length - 1);
		},
		controlToBezier(pts, knots) {
			if (pts.length < 2) return [];
			const canonical = nativeKnots(pts.length, knots),
				packed = pack(pts);
			if (!packed) throw new Error('Non-finite spline input');
			if (!canonical) throw new Error('Unsupported non-clamped B-spline knot vector');
			return curves(query(2, packed, 0, undefined, empty, new Float64Array(canonical)), 1, Math.max(1, pts.length - 3));
		},
		pointAt(segments, param) {
			if (!segments.length) return { x: 0, y: 0 };
			const packed = packCurves(segments);
			if (!packed || !Number.isFinite(param)) throw new Error('Non-finite spline input');
			return point(checked(query(4, packed, param), 2));
		},
		tangentAt(segments, param) {
			if (!segments.length) return { x: 1, y: 0 };
			const packed = packCurves(segments);
			if (!packed || !Number.isFinite(param)) throw new Error('Non-finite spline input');
			return point(checked(query(5, packed, param), 2));
		},
		project(segments, target) {
			if (!segments.length) return { param: 0, distance: Infinity, point: { ...target } };
			const packed = packCurves(segments);
			if (!packed || !Number.isFinite(target.x) || !Number.isFinite(target.y))
				throw new Error('Non-finite spline input');
			const data = checked(query(9, packed, 0, target), 4);
			if (data[0] < 0 || data[0] > 1 || data[1] < 0) throw new Error('Invalid WASM spline projection');
			return { param: data[0], distance: data[1], point: point(data, 2) };
		},
		evaluateBezier(b, t) {
			const packed = pack(b);
			if (!packed || !Number.isFinite(t)) throw new Error('Non-finite spline input');
			return point(checked(query(6, packed, t), 2));
		},
		derivativeBezier(b, t) {
			const packed = pack(b);
			if (!packed || !Number.isFinite(t)) throw new Error('Non-finite spline input');
			return point(checked(query(7, packed, t), 2));
		},
		splitBezier(b, t) {
			const packed = pack(b);
			if (!packed || !Number.isFinite(t)) throw new Error('Non-finite spline input');
			const result = curves(query(8, packed, t), 2);
			return { left: result[0], right: result[1] };
		},
	};
}

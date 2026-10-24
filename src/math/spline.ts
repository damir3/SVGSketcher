import type { Vec2 } from './vector';
import { dist } from './vector';

export type BezierSegment = [Vec2, Vec2, Vec2, Vec2];

/**
 * Evaluates a cubic Bezier curve at t in [0, 1].
 */
export function evaluateBezier(b: BezierSegment, t: number): Vec2 {
	const u = 1 - t;
	const tt = t * t;
	const uu = u * u;
	const uuu = uu * u;
	const ttt = tt * t;

	return {
		x: uuu * b[0].x + 3 * uu * t * b[1].x + 3 * u * tt * b[2].x + ttt * b[3].x,
		y: uuu * b[0].y + 3 * uu * t * b[1].y + 3 * u * tt * b[2].y + ttt * b[3].y,
	};
}

/**
 * Evaluates the first derivative of a cubic Bezier curve at t in [0, 1].
 */
export function evaluateBezierDerivative(b: BezierSegment, t: number): Vec2 {
	const u = 1 - t;
	const c0 = 3 * u * u;
	const c1 = 6 * u * t;
	const c2 = 3 * t * t;

	const d1x = b[1].x - b[0].x;
	const d1y = b[1].y - b[0].y;
	const d2x = b[2].x - b[1].x;
	const d2y = b[2].y - b[1].y;
	const d3x = b[3].x - b[2].x;
	const d3y = b[3].y - b[2].y;

	return {
		x: c0 * d1x + c1 * d2x + c2 * d3x,
		y: c0 * d1y + c1 * d2y + c2 * d3y,
	};
}

/**
 * Splits a cubic Bezier curve at parameter t in [0, 1] into two exact cubic Bezier curves using de Casteljau algorithm.
 */
export function splitBezier(b: BezierSegment, t: number): { left: BezierSegment; right: BezierSegment } {
	const p0 = b[0], p1 = b[1], p2 = b[2], p3 = b[3];
	const u = 1 - t;

	const p01 = { x: u * p0.x + t * p1.x, y: u * p0.y + t * p1.y };
	const p12 = { x: u * p1.x + t * p2.x, y: u * p1.y + t * p2.y };
	const p23 = { x: u * p2.x + t * p3.x, y: u * p2.y + t * p3.y };

	const p012 = { x: u * p01.x + t * p12.x, y: u * p01.y + t * p12.y };
	const p123 = { x: u * p12.x + t * p23.x, y: u * p12.y + t * p23.y };

	const p0123 = { x: u * p012.x + t * p123.x, y: u * p012.y + t * p123.y };

	return {
		left: [p0, p01, p012, p0123],
		right: [p0123, p123, p23, p3],
	};
}

/**
 * Converts a clamped uniform cubic B-spline with control points into cubic Bezier segments using Boehm knot insertion.
 */
export function bsplineToBezier(pts: Vec2[], explicitKnots?: number[]): BezierSegment[] {
	const n = pts.length - 1;
	if (n < 1) return [];

	if (n === 1) {
		const dx = (pts[1].x - pts[0].x) / 3;
		const dy = (pts[1].y - pts[0].y) / 3;
		return [[
			{ x: pts[0].x, y: pts[0].y },
			{ x: pts[0].x + dx, y: pts[0].y + dy },
			{ x: pts[1].x - dx, y: pts[1].y - dy },
			{ x: pts[1].x, y: pts[1].y },
		]];
	}

	if (n === 2) {
		// Degree elevated quadratic Bezier
		return [[
			{ x: pts[0].x, y: pts[0].y },
			{ x: pts[0].x + (2 * (pts[1].x - pts[0].x)) / 3, y: pts[0].y + (2 * (pts[1].y - pts[0].y)) / 3 },
			{ x: pts[2].x + (2 * (pts[1].x - pts[2].x)) / 3, y: pts[2].y + (2 * (pts[1].y - pts[2].y)) / 3 },
			{ x: pts[2].x, y: pts[2].y },
		]];
	}

	if (n === 3) {
		return [[
			{ x: pts[0].x, y: pts[0].y },
			{ x: pts[1].x, y: pts[1].y },
			{ x: pts[2].x, y: pts[2].y },
			{ x: pts[3].x, y: pts[3].y },
		]];
	}

	// For n >= 4: clamped cubic B-spline with (n - 2) spans
	const p = 3;
	const K = n - p + 1; // number of Bezier segments
	let knots: number[] = [];
	if (explicitKnots && explicitKnots.length === pts.length + p + 1) {
		knots = [...explicitKnots];
	} else {
		for (let i = 0; i <= p; i++) knots.push(0);
		for (let i = 1; i < K; i++) knots.push(i);
		for (let i = 0; i <= p; i++) knots.push(K);
	}

	let currentKnots = [...knots];
	let currentPts = pts.map(pt => ({ x: pt.x, y: pt.y }));

	// Insert each internal knot until multiplicity 3
	const uniqueInternals = Array.from(new Set(knots.slice(p + 1, knots.length - p - 1))).sort((a, b) => a - b);
	for (const u of uniqueInternals) {
		let mult = currentKnots.filter(k => Math.abs(k - u) < 1e-7).length;
		while (mult < p) {
			let k = 0;
			while (k < currentKnots.length - 1 && currentKnots[k + 1] <= u) k++;

			const nextPts: Vec2[] = [];
			for (let i = 0; i <= k - p; i++) nextPts.push(currentPts[i]);
			for (let i = k - p + 1; i <= k; i++) {
				const denom = currentKnots[i + p] - currentKnots[i];
				const alpha = denom === 0 ? 0 : (u - currentKnots[i]) / denom;
				nextPts.push({
					x: (1 - alpha) * currentPts[i - 1].x + alpha * currentPts[i].x,
					y: (1 - alpha) * currentPts[i - 1].y + alpha * currentPts[i].y,
				});
			}
			for (let i = k; i < currentPts.length; i++) nextPts.push(currentPts[i]);

			currentKnots.splice(k + 1, 0, u);
			currentPts = nextPts;
			mult++;
		}
	}

	const numSegs = Math.floor((currentPts.length - 1) / 3);
	const segments: BezierSegment[] = [];
	for (let s = 0; s < numSegs; s++) {
		segments.push([
			currentPts[s * 3],
			currentPts[s * 3 + 1],
			currentPts[s * 3 + 2],
			currentPts[s * 3 + 3],
		]);
	}
	return segments;
}

/**
 * Computes natural Catmull-Rom tangent handle vectors for fit points.
 * Returns handle endpoints h1 (backward) and h2 (forward) for each fit point, with fit point at midpoint!
 */
export function computeNaturalFitHandles(fitPts: Vec2[]): Array<{ h1: Vec2; h2: Vec2 }> {
	const n = fitPts.length - 1;
	if (n < 1) return [];

	const isClosed = n >= 2 && Math.hypot(fitPts[0].x - fitPts[n].x, fitPts[0].y - fitPts[n].y) < 1e-4;

	if (n === 1) {
		const v = {
			x: (fitPts[1].x - fitPts[0].x) / 3,
			y: (fitPts[1].y - fitPts[0].y) / 3,
		};
		return [
			{
				h1: { x: fitPts[0].x - v.x, y: fitPts[0].y - v.y },
				h2: { x: fitPts[0].x + v.x, y: fitPts[0].y + v.y },
			},
			{
				h1: { x: fitPts[1].x - v.x, y: fitPts[1].y - v.y },
				h2: { x: fitPts[1].x + v.x, y: fitPts[1].y + v.y },
			},
		];
	}

	const handles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let i = 0; i <= n; i++) {
		const fi = fitPts[i];
		let h: Vec2;

		if (isClosed && (i === 0 || i === n)) {
			const prev = fitPts[n - 1];
			const next = fitPts[1];
			const dx = next.x - prev.x;
			const dy = next.y - prev.y;
			const len = Math.hypot(dx, dy);

			const d1 = Math.hypot(fi.x - prev.x, fi.y - prev.y);
			const d2 = Math.hypot(next.x - fi.x, next.y - fi.y);
			let scale = (d1 + d2) / 6;

			if (d1 > 1e-6 && d2 > 1e-6) {
				const cosTheta = Math.max(-0.999, Math.min(1, ((fi.x - prev.x) * (next.x - fi.x) + (fi.y - prev.y) * (next.y - fi.y)) / (d1 * d2)));
				const curvatureFactor = 1 / (3 * (1 + Math.sqrt(Math.max(0, (1 + cosTheta) * 0.5))));
				scale = (d1 + d2) * curvatureFactor;
			}

			if (len > 1e-6) {
				h = {
					x: (dx / len) * scale,
					y: (dy / len) * scale,
				};
			} else {
				h = { x: dx / 6, y: dy / 6 };
			}
		} else if (i === 0) {
			h = {
				x: (fitPts[1].x - fitPts[0].x) / 3,
				y: (fitPts[1].y - fitPts[0].y) / 3,
			};
		} else if (i === n) {
			h = {
				x: (fitPts[n].x - fitPts[n - 1].x) / 3,
				y: (fitPts[n].y - fitPts[n - 1].y) / 3,
			};
		} else {
			const prev = fitPts[i - 1];
			const next = fitPts[i + 1];
			const dx = next.x - prev.x;
			const dy = next.y - prev.y;
			const len = Math.hypot(dx, dy);

			const d1 = Math.hypot(fi.x - prev.x, fi.y - prev.y);
			const d2 = Math.hypot(next.x - fi.x, next.y - fi.y);
			let scale = (d1 + d2) / 6;

			if (d1 > 1e-6 && d2 > 1e-6) {
				const cosTheta = Math.max(-0.999, Math.min(1, ((fi.x - prev.x) * (next.x - fi.x) + (fi.y - prev.y) * (next.y - fi.y)) / (d1 * d2)));
				const curvatureFactor = 1 / (3 * (1 + Math.sqrt(Math.max(0, (1 + cosTheta) * 0.5))));
				scale = (d1 + d2) * curvatureFactor;
			}

			if (len > 1e-6) {
				h = {
					x: (dx / len) * scale,
					y: (dy / len) * scale,
				};
			} else {
				h = { x: dx / 6, y: dy / 6 };
			}
		}

		handles.push({
			h1: { x: fi.x - h.x, y: fi.y - h.y },
			h2: { x: fi.x + h.x, y: fi.y + h.y },
		});
	}
	return handles;
}

/**
 * Builds cubic Bezier segments from fit points and optional explicit handle endpoints.
 */
export function fitPointsToBezier(
	fitPts: Vec2[],
	handles?: Array<{ h1: Vec2; h2: Vec2 } | null>
): BezierSegment[] {
	const n = fitPts.length - 1;
	if (n < 1) return [];

	const defaultHandles = computeNaturalFitHandles(fitPts);
	const segments: BezierSegment[] = [];

	for (let i = 0; i < n; i++) {
		const p0 = fitPts[i];
		const p3 = fitPts[i + 1];

		const hStart = handles && handles[i] ? handles[i]! : defaultHandles[i];
		const hEnd = handles && handles[i + 1] ? handles[i + 1]! : defaultHandles[i + 1];

		const p1 = hStart.h2;
		const p2 = hEnd.h1;

		segments.push([
			{ x: p0.x, y: p0.y },
			{ x: p1.x, y: p1.y },
			{ x: p2.x, y: p2.y },
			{ x: p3.x, y: p3.y },
		]);
	}
	return segments;
}

/**
 * Evaluates spline position at normalized parameter in [0, 1].
 */
export function getSplinePointAtParam(segments: BezierSegment[], param: number): Vec2 {
	if (segments.length === 0) return { x: 0, y: 0 };
	const clampedParam = Math.max(0, Math.min(1, param));
	const count = segments.length;
	const val = clampedParam * count;
	const idx = Math.min(Math.floor(val), count - 1);
	const t = val - idx;
	return evaluateBezier(segments[idx], t);
}

/**
 * Evaluates spline tangent vector at normalized parameter in [0, 1].
 */
export function getSplineTangentAtParam(segments: BezierSegment[], param: number): Vec2 {
	if (segments.length === 0) return { x: 1, y: 0 };
	const clampedParam = Math.max(0, Math.min(1, param));
	const count = segments.length;
	const val = clampedParam * count;
	const idx = Math.min(Math.floor(val), count - 1);
	const t = val - idx;
	return evaluateBezierDerivative(segments[idx], t);
}

/**
 * Finds closest parameter in [0, 1] on a spline to an arbitrary target point.
 */
export function getSplineParamAtPoint(
	segments: BezierSegment[],
	pt: Vec2
): { param: number; distance: number; point: Vec2 } {
	if (segments.length === 0) {
		return { param: 0, distance: Infinity, point: pt };
	}

	let bestParam = 0;
	let bestDist = Infinity;
	let bestPoint = pt;
	const count = segments.length;

	for (let s = 0; s < count; s++) {
		const seg = segments[s];
		// Sample segment with 12 steps
		const steps = 12;
		let localBestT = 0;
		let localBestDist = Infinity;

		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const p = evaluateBezier(seg, t);
			const d = dist(p, pt);
			if (d < localBestDist) {
				localBestDist = d;
				localBestT = t;
			}
		}

		// Refine with Golden Section / ternary search
		let tA = Math.max(0, localBestT - 1 / steps);
		let tB = Math.min(1, localBestT + 1 / steps);
		for (let iter = 0; iter < 10; iter++) {
			const t1 = tA + (tB - tA) * 0.382;
			const t2 = tA + (tB - tA) * 0.618;
			const p1 = evaluateBezier(seg, t1);
			const p2 = evaluateBezier(seg, t2);
			const d1 = dist(p1, pt);
			const d2 = dist(p2, pt);
			if (d1 < d2) {
				tB = t2;
			} else {
				tA = t1;
			}
		}

		const refinedT = (tA + tB) * 0.5;
		const refinedP = evaluateBezier(seg, refinedT);
		const refinedDist = dist(refinedP, pt);

		if (refinedDist < bestDist) {
			bestDist = refinedDist;
			bestParam = (s + refinedT) / count;
			bestPoint = refinedP;
		}
	}

	return { param: bestParam, distance: bestDist, point: bestPoint };
}

/**
 * Splits a multi-segment spline at normalized parameter t in (0, 1).
 */
export function splitSplineAtParam(
	segments: BezierSegment[],
	param: number
): { leftSegments: BezierSegment[]; rightSegments: BezierSegment[]; splitPoint: Vec2 } {
	const count = segments.length;
	const clampedParam = Math.max(0, Math.min(1, param));
	const val = clampedParam * count;
	const idx = Math.min(Math.floor(val), count - 1);
	const localT = val - idx;

	const { left, right } = splitBezier(segments[idx], localT);

	const leftSegments: BezierSegment[] = [];
	for (let i = 0; i < idx; i++) leftSegments.push(segments[i]);
	leftSegments.push(left);

	const rightSegments: BezierSegment[] = [];
	rightSegments.push(right);
	for (let i = idx + 1; i < count; i++) rightSegments.push(segments[i]);

	return {
		leftSegments,
		rightSegments,
		splitPoint: left[3],
	};
}

/**
 * Trims a single cubic Bezier curve to sub-interval [t0, t1] in [0, 1].
 */
export function trimBezier(b: BezierSegment, t0: number, t1: number): BezierSegment {
	let seg = b;
	if (t1 < 1 - 1e-6) {
		seg = splitBezier(seg, t1).left;
	}
	if (t0 > 1e-6) {
		const newT0 = t0 / Math.max(t1, 1e-6);
		seg = splitBezier(seg, Math.min(1, newT0)).right;
	}
	return seg;
}

/**
 * Extracts a sub-interval [paramA, paramB] of a spline as Bezier segments.
 */
export function extractSplineInterval(
	segments: BezierSegment[],
	paramA: number,
	paramB: number
): BezierSegment[] {
	if (Math.abs(paramA - paramB) < 1e-5) return [];

	if (paramA > paramB) {
		const part1 = extractSplineInterval(segments, paramA, 1.0);
		const part2 = extractSplineInterval(segments, 0.0, paramB);
		return [...part1, ...part2];
	}

	if (paramA <= 1e-5 && paramB >= 1 - 1e-5) return segments;

	const count = segments.length;
	const result: BezierSegment[] = [];

	for (let i = 0; i < count; i++) {
		const segStart = i / count;
		const segEnd = (i + 1) / count;

		if (segEnd <= paramA + 1e-6 || segStart >= paramB - 1e-6) {
			continue;
		}

		const u0 = Math.max(segStart, paramA);
		const u1 = Math.min(segEnd, paramB);

		const t0 = Math.max(0, Math.min(1, (u0 - segStart) * count));
		const t1 = Math.max(0, Math.min(1, (u1 - segStart) * count));

		if (t1 - t0 < 1e-6) continue;

		result.push(trimBezier(segments[i], t0, t1));
	}

	return result;
}

/**
 * Converts Bezier segments to an SVG path string `M ... C ... C ...`.
 */
export function getSplineSvgPath(
	segments: BezierSegment[],
	coordTransform: (p: Vec2) => Vec2 = p => p,
	isClosed: boolean = false
): string {
	if (segments.length === 0) return '';

	const start = coordTransform(segments[0][0]);
	let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;

	for (const seg of segments) {
		const p1 = coordTransform(seg[1]);
		const p2 = coordTransform(seg[2]);
		const p3 = coordTransform(seg[3]);
		d += ` C ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}, ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`;
	}
	if (isClosed) {
		d += ' Z';
	}
	return d;
}

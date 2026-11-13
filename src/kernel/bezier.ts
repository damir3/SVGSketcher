// TypeScript reference backend: keep the pre-migration algorithms and their arithmetic.
import { MAX_BEZIER_INTERSECTION_CANDIDATES, type CubicBezier, type KernelCurve, type Point2 } from './types';
import { Vec2, projectPointOntoSegment } from '../math/vector';
import { AABB } from '../math/aabb';
import { evaluateBezier, evaluateBezierDerivative, splitBezier, type BezierSegment } from '../math/spline';
import { ellipseAxes } from '../math/ellipse';

const NEAR_ROOT_TOLERANCE = 1e-4;
const SEGMENT_PROJECTION_TOLERANCE = 1e-2;
const MAX_IMPLICIT_SUBDIV_DEPTH = 24;
const MAX_IMPLICIT_SUBDIV_ITERS = 4096;

export function bezierCurve(points: CubicBezier, other: KernelCurve): Point2[] {
	const b = points.map(Vec2.from) as BezierSegment;
	if (other.type === 'bezier') return intersectBezierBezier(b, other.points.map(Vec2.from) as BezierSegment);
	if (other.type === 'segment') {
		const p1 = Vec2.from(other.p1),
			p2 = Vec2.from(other.p2);
		const a = -(p2.y - p1.y),
			coefficientB = p2.x - p1.x;
		const c = -(a * p1.x + coefficientB * p1.y);
		const length = Math.hypot(a, coefficientB);
		if (length < 1e-12) return [];
		const f = (p: Vec2) => (a * p.x + coefficientB * p.y + c) / length;
		return findBezierImplicitRoots(b, bernsteinDegree3(b, f), -NEAR_ROOT_TOLERANCE, NEAR_ROOT_TOLERANCE, f).filter(
			p => {
				const projected = projectPointOntoSegment(p, p1, p2);
				return projected.dist < SEGMENT_PROJECTION_TOLERANCE && projected.t >= -1e-4 && projected.t <= 1 + 1e-4;
			}
		);
	}
	if (other.type === 'circle') {
		if (other.radius < 0) return [];
		const center = Vec2.from(other.center);
		const r = other.radius;
		const rSq = r * r;
		const d = b.map(p => new Vec2(p.x - center.x, p.y - center.y));
		const gLow = Math.max(0, r - NEAR_ROOT_TOLERANCE) ** 2 - rSq;
		const gHigh = (r + NEAR_ROOT_TOLERANCE) ** 2 - rSq;
		return findBezierImplicitRoots(b, bernsteinDegree6FromVecs(d, rSq), gLow, gHigh, p => {
			const dx = p.x - center.x;
			const dy = p.y - center.y;
			return Math.sqrt(dx * dx + dy * dy) - r;
		});
	}
	const center = new Vec2(other.center.x, -other.center.y);
	const major = new Vec2(other.majorAxisPoint.x, -other.majorAxisPoint.y);
	const minor = new Vec2(other.minorAxisPoint.x, -other.minorAxisPoint.y);
	const radii = center.distancesTo(major, minor);
	if (radii.x < 1e-6 || radii.y < 1e-6) return [];
	const { axisU: u, axisV: v } = ellipseAxes(center.angleToPoint(major));
	const normalized = b.map(p => {
		const direction = new Vec2(p.x, -p.y).sub(center);
		return new Vec2(direction.dot(u) / radii.x, direction.dot(v) / radii.y);
	});
	return findBezierImplicitRoots(
		b,
		bernsteinDegree6FromVecs(normalized, 1),
		-NEAR_ROOT_TOLERANCE,
		NEAR_ROOT_TOLERANCE,
		p => {
			const direction = new Vec2(p.x, -p.y).sub(center);
			const up = direction.dot(u),
				vp = direction.dot(v);
			return (up * up) / (radii.x * radii.x) + (vp * vp) / (radii.y * radii.y) - 1;
		}
	);
}

function deduplicatePoints(pts: Vec2[], eps = 1e-4): Vec2[] {
	const res: Vec2[] = [];
	for (const p of pts) {
		const exists = res.some(existing => p.distanceTo(existing) < eps);
		if (!exists) res.push(p);
	}
	return res;
}

function bernsteinDegree3(b: BezierSegment, f: (p: Vec2) => number): number[] {
	return [f(b[0]), f(b[1]), f(b[2]), f(b[3])];
}

function bernsteinDegree6FromVecs(d: readonly Vec2[], offset: number): number[] {
	const m = (i: number, j: number) => d[i].x * d[j].x + d[i].y * d[j].y;
	return [
		m(0, 0) - offset,
		m(0, 1) - offset,
		(2 * m(0, 2) + 3 * m(1, 1)) / 5 - offset,
		(m(0, 3) + 9 * m(1, 2)) / 10 - offset,
		(2 * m(1, 3) + 3 * m(2, 2)) / 5 - offset,
		m(2, 3) - offset,
		m(3, 3) - offset,
	];
}

function splitBernstein1D(c: readonly number[]): [number[], number[]] {
	const d = c.length - 1;
	const left: number[] = new Array(d + 1);
	const right: number[] = new Array(d + 1);
	const work = c.slice();
	left[0] = work[0];
	right[d] = work[d];
	for (let r = 1; r <= d; r++) {
		for (let i = 0; i <= d - r; i++) {
			work[i] = 0.5 * (work[i] + work[i + 1]);
		}
		left[r] = work[0];
		right[d - r] = work[d - r];
	}
	return [left, right];
}

function signChanges(c: readonly number[]): number {
	let changes = 0;
	let prev = 0;
	for (const v of c) {
		if (v === 0) continue;
		const s = v > 0 ? 1 : -1;
		if (prev !== 0 && s !== prev) changes++;
		prev = s;
	}
	return changes;
}

function bisectImplicitRoot(b: BezierSegment, f: (p: Vec2) => number, tA: number, tB: number, vA: number): number {
	let low = tA;
	let high = tB;
	let fLow = vA;
	for (let iter = 0; iter < 52; iter++) {
		const mid = 0.5 * (low + high);
		const fMid = f(evaluateBezier(b, mid));
		if (fMid === 0 || high - low < 1e-13) return mid;
		if (fLow * fMid <= 0) {
			high = mid;
		} else {
			low = mid;
			fLow = fMid;
		}
	}
	return 0.5 * (low + high);
}

function minimizeAbsImplicit(
	b: BezierSegment,
	f: (p: Vec2) => number,
	t0: number,
	t1: number
): { t: number; v: number } {
	const v0 = f(evaluateBezier(b, t0));
	const v1 = f(evaluateBezier(b, t1));
	if (v0 === 0 && v1 !== 0) return { t: t0, v: 0 };
	if (v1 === 0 && v0 !== 0) return { t: t1, v: 0 };
	const tm0 = 0.5 * (t0 + t1);
	if (f(evaluateBezier(b, tm0)) === 0 && v0 !== 0 && v1 !== 0) return { t: tm0, v: 0 };

	const phi = 0.6180339887498949;
	let a = t0;
	let hi = t1;
	let x1 = hi - phi * (hi - a);
	let x2 = a + phi * (hi - a);
	let f1 = Math.abs(f(evaluateBezier(b, x1)));
	let f2 = Math.abs(f(evaluateBezier(b, x2)));
	for (let k = 0; k < 28; k++) {
		if (f1 < f2) {
			hi = x2;
			x2 = x1;
			f2 = f1;
			x1 = hi - phi * (hi - a);
			f1 = Math.abs(f(evaluateBezier(b, x1)));
		} else {
			a = x1;
			x1 = x2;
			f1 = f2;
			x2 = a + phi * (hi - a);
			f2 = Math.abs(f(evaluateBezier(b, x2)));
		}
	}
	let bestT = 0.5 * (a + hi);
	let bestV = f(evaluateBezier(b, bestT));
	if (Math.abs(v0) < Math.abs(bestV)) {
		bestT = t0;
		bestV = v0;
	}
	if (Math.abs(v1) < Math.abs(bestV)) {
		bestT = t1;
		bestV = v1;
	}
	return { t: bestT, v: bestV };
}

function isLocalExtremumNearRoot(b: BezierSegment, f: (p: Vec2) => number, t: number): boolean {
	const v = f(evaluateBezier(b, t));
	if (Math.abs(v) >= NEAR_ROOT_TOLERANCE) return false;
	const h = 1e-7;
	const vl = t > 0 ? f(evaluateBezier(b, Math.max(0, t - h))) : v;
	const vr = t < 1 ? f(evaluateBezier(b, Math.min(1, t + h))) : v;
	return vl * v >= 0 && vr * v >= 0 && Math.abs(vl) >= Math.abs(v) && Math.abs(vr) >= Math.abs(v);
}

function findBezierImplicitRoots(
	b: BezierSegment,
	coeffs: number[],
	gLow: number,
	gHigh: number,
	f: (p: Vec2) => number
): Vec2[] {
	const flatEps = 1e-12 * Math.max(1, gHigh / NEAR_ROOT_TOLERANCE);
	const roots: number[] = [];
	const stack: Array<{ c: number[]; t0: number; t1: number; depth: number }> = [{ c: coeffs, t0: 0, t1: 1, depth: 0 }];
	let iters = 0;

	while (stack.length > 0 && iters++ < MAX_IMPLICIT_SUBDIV_ITERS) {
		const { c, t0, t1, depth } = stack.pop()!;
		let minC = c[0];
		let maxC = c[0];
		for (let i = 1; i < c.length; i++) {
			if (c[i] < minC) minC = c[i];
			if (c[i] > maxC) maxC = c[i];
		}
		if (minC > gHigh || maxC < gLow) continue;

		// Skip interior flood when the whole cubic coincides with the target; endpoints are checked separately.
		if (depth === 0 && maxC <= flatEps && minC >= -flatEps) continue;

		const c0 = c[0];
		const cLast = c[c.length - 1];
		if (signChanges(c) === 1 && c0 * cLast < 0) {
			roots.push(bisectImplicitRoot(b, f, t0, t1, f(evaluateBezier(b, t0))));
			continue;
		}

		let nonInc = true;
		let nonDec = true;
		for (let i = 0; i < c.length - 1; i++) {
			if (c[i + 1] > c[i]) nonInc = false;
			if (c[i + 1] < c[i]) nonDec = false;
		}
		if (nonInc || nonDec) {
			if ((c0 > 0 && cLast > 0) || (c0 < 0 && cLast < 0)) {
				if (t0 > 0 && isLocalExtremumNearRoot(b, f, t0)) roots.push(t0);
				if (t1 < 1 && isLocalExtremumNearRoot(b, f, t1)) roots.push(t1);
				continue;
			}
			if (c0 === 0 && cLast !== 0) {
				roots.push(t0);
				continue;
			}
			if (cLast === 0 && c0 !== 0) {
				roots.push(t1);
				continue;
			}
		}

		if (depth >= MAX_IMPLICIT_SUBDIV_DEPTH || t1 - t0 < 1e-7) {
			const { t, v } = minimizeAbsImplicit(b, f, t0, t1);
			if (Math.abs(v) < NEAR_ROOT_TOLERANCE) {
				roots.push(t);
			}
			continue;
		}

		const [left, right] = splitBernstein1D(c);
		const tm = 0.5 * (t0 + t1);
		// Push right first so left is popped first, keeping roots in ascending parameter order.
		stack.push({ c: right, t0: tm, t1, depth: depth + 1 });
		stack.push({ c: left, t0, t1: tm, depth: depth + 1 });
	}

	const rootPoints = roots.map(t => evaluateBezier(b, t));
	const hasCloseRoot = (p: Vec2) => rootPoints.some(rp => rp.distanceTo(p) < NEAR_ROOT_TOLERANCE);

	const candidates: Vec2[] = [];
	if (Math.abs(f(b[0])) < NEAR_ROOT_TOLERANCE && !hasCloseRoot(b[0])) candidates.push(b[0]);
	candidates.push(...rootPoints);
	if (Math.abs(f(b[3])) < NEAR_ROOT_TOLERANCE && !hasCloseRoot(b[3])) candidates.push(b[3]);

	const deduplicated = deduplicatePoints(candidates, NEAR_ROOT_TOLERANCE);
	return deduplicated.slice(0, MAX_BEZIER_INTERSECTION_CANDIDATES);
}

function intersectBezierBezier(b1: BezierSegment, b2: BezierSegment): Vec2[] {
	const hits: Array<{ point: Vec2; residual: number }> = [];
	const recordHit = (point: Vec2, residual: number) => {
		for (let i = 0; i < hits.length; i++) {
			if (hits[i].point.distanceTo(point) < 1e-3) {
				if (hits[i].residual > 1e-9 && residual < hits[i].residual) hits[i] = { point, residual };
				return;
			}
		}
		hits.push({ point, residual });
	};

	for (const p1 of [b1[0], b1[3]]) {
		for (const p2 of [b2[0], b2[3]]) {
			const dist = p1.distanceTo(p2);
			if (dist < 1e-9) recordHit(new Vec2().midpoint(p1, p2), dist);
		}
	}

	function getBBox(b: BezierSegment): AABB {
		return AABB.fromPoints(b)!;
	}

	interface Task {
		seg1: BezierSegment;
		t0: number;
		t1: number;
		seg2: BezierSegment;
		u0: number;
		u1: number;
		depth: number;
	}

	const stack: Task[] = [{ seg1: b1, t0: 0, t1: 1, seg2: b2, u0: 0, u1: 1, depth: 0 }];
	let pops = 0;

	while (stack.length > 0 && hits.length < 16 && pops++ < 4096) {
		const { seg1, t0, t1, seg2, u0, u1, depth } = stack.pop()!;
		const box1 = getBBox(seg1);
		const box2 = getBBox(seg2);

		if (
			box1.max.x < box2.min.x - 1e-4 ||
			box1.min.x > box2.max.x + 1e-4 ||
			box1.max.y < box2.min.y - 1e-4 ||
			box1.min.y > box2.max.y + 1e-4
		) {
			continue;
		}

		const span1 = Math.max(box1.max.x - box1.min.x, box1.max.y - box1.min.y);
		const span2 = Math.max(box2.max.x - box2.min.x, box2.max.y - box2.min.y);

		if ((span1 < 1e-4 && span2 < 1e-4) || depth >= 15) {
			let t = (t0 + t1) * 0.5;
			let u = (u0 + u1) * 0.5;

			// Newton-Raphson refinement on the full segments b1 and b2
			for (let iter = 0; iter < 4; iter++) {
				const p1 = evaluateBezier(b1, t);
				const p2 = evaluateBezier(b2, u);
				const f = new Vec2().subVectors(p1, p2);
				if (f.length() < 1e-11) break;

				const d1 = evaluateBezierDerivative(b1, t);
				const d2 = evaluateBezierDerivative(b2, u);
				const det = d2.cross(d1);
				if (Math.abs(det) < 1e-12) break;

				const dt = d2.cross(f) / det;
				const du = d1.cross(f) / det;

				t = Math.max(0, Math.min(1, t - dt));
				u = Math.max(0, Math.min(1, u - du));
			}

			const p1 = evaluateBezier(b1, t);
			const p2 = evaluateBezier(b2, u);
			const dist = p2.distanceTo(p1);
			if (dist < 1e-3) {
				recordHit(new Vec2().midpoint(p1, p2), dist);
			}
			continue;
		}

		const split1 = span1 >= 1e-4;
		const split2 = span2 >= 1e-4;

		if (split1 && split2) {
			const s1 = splitBezier(seg1, 0.5);
			const s2 = splitBezier(seg2, 0.5);
			const tm = (t0 + t1) * 0.5;
			const um = (u0 + u1) * 0.5;
			stack.push({ seg1: s1.left, t0, t1: tm, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({ seg1: s1.left, t0, t1: tm, seg2: s2.right, u0: um, u1, depth: depth + 1 });
			stack.push({ seg1: s1.right, t0: tm, t1, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({
				seg1: s1.right,
				t0: tm,
				t1,
				seg2: s2.right,
				u0: um,
				u1,
				depth: depth + 1,
			});
		} else if (split1) {
			const s1 = splitBezier(seg1, 0.5);
			const tm = (t0 + t1) * 0.5;
			stack.push({ seg1: s1.left, t0, t1: tm, seg2, u0, u1, depth: depth + 1 });
			stack.push({ seg1: s1.right, t0: tm, t1, seg2, u0, u1, depth: depth + 1 });
		} else {
			const s2 = splitBezier(seg2, 0.5);
			const um = (u0 + u1) * 0.5;
			stack.push({ seg1, t0, t1, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({ seg1, t0, t1, seg2: s2.right, u0, u1, depth: depth + 1 });
		}
	}

	return hits.map(hit => hit.point);
}

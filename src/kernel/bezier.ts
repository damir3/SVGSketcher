// TypeScript reference backend: keep the pre-migration algorithms and their arithmetic.
import type { CubicBezier, KernelCurve, Point2 } from './types';
import { Vec2, projectPointOntoSegment } from '../math/vector';
import { AABB } from '../math/aabb';
import { evaluateBezier, evaluateBezierDerivative, splitBezier, type BezierSegment } from '../math/spline';
import { ellipseAxes } from '../math/ellipse';

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
		return findBezierImplicitRoots(b, p => (a * p.x + coefficientB * p.y + c) / length).filter(p => {
			const projected = projectPointOntoSegment(p, p1, p2);
			return projected.dist < 1e-3 && projected.t >= -1e-4 && projected.t <= 1 + 1e-4;
		});
	}
	if (other.type === 'circle') {
		return findBezierImplicitRoots(b, p => Math.hypot(p.x - other.center.x, p.y - other.center.y) - other.radius);
	}
	const center = new Vec2(other.center.x, -other.center.y);
	const major = new Vec2(other.majorAxisPoint.x, -other.majorAxisPoint.y);
	const minor = new Vec2(other.minorAxisPoint.x, -other.minorAxisPoint.y);
	const radii = center.distancesTo(major, minor);
	if (radii.x < 1e-6 || radii.y < 1e-6) return [];
	const { axisU: u, axisV: v } = ellipseAxes(center.angleToPoint(major));
	return findBezierImplicitRoots(b, p => {
		const direction = new Vec2(p.x, -p.y).sub(center);
		const up = direction.dot(u),
			vp = direction.dot(v);
		return (up * up) / (radii.x * radii.x) + (vp * vp) / (radii.y * radii.y) - 1;
	});
}

function deduplicatePoints(pts: Vec2[], eps = 1e-4): Vec2[] {
	const res: Vec2[] = [];
	for (const p of pts) {
		const exists = res.some(existing => p.distanceTo(existing) < eps);
		if (!exists) res.push(p);
	}
	return res;
}

function findBezierImplicitRoots(b: BezierSegment, f: (p: Vec2) => number): Vec2[] {
	const N = 16;
	const nearRootTolerance = 1e-4;
	const vals: number[] = new Array(N + 1);
	for (let i = 0; i <= N; i++) {
		vals[i] = f(evaluateBezier(b, i / N));
	}

	const roots: number[] = [];
	for (let i = 0; i < N; i++) {
		const tA = i / N;
		const tB = (i + 1) / N;
		const vA = vals[i];
		const vB = vals[i + 1];

		if (vA * vB <= 0) {
			let low = tA;
			let high = tB;
			let fLow = vA;
			for (let iter = 0; iter < 28; iter++) {
				const mid = (low + high) * 0.5;
				const fMid = f(evaluateBezier(b, mid));
				if (Math.abs(fMid) < 1e-12 || high - low < 1e-10) {
					low = mid;
					break;
				}
				if (fLow * fMid <= 0) {
					high = mid;
				} else {
					low = mid;
					fLow = fMid;
				}
			}
			roots.push((low + high) * 0.5);
		} else if (
			Math.abs(vA) < nearRootTolerance &&
			(i === 0 || Math.abs(vA) <= Math.abs(vals[i - 1])) &&
			Math.abs(vA) <= Math.abs(vB)
		) {
			roots.push(tA);
		}
	}
	// The loop tests near roots at the left sample of each interval.
	// Include the final sample too if the last interval did not bracket a root.
	const last = vals[N];
	const previous = vals[N - 1];
	if (last * previous > 0 && Math.abs(last) < nearRootTolerance && Math.abs(last) <= Math.abs(previous)) {
		roots.push(1);
	}
	return roots.map(t => evaluateBezier(b, t));
}

function intersectBezierBezier(b1: BezierSegment, b2: BezierSegment): Vec2[] {
	const pts: Vec2[] = [];

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

	while (stack.length > 0 && pts.length < 16) {
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
			if (p2.distanceTo(p1) < 1e-3) {
				pts.push(new Vec2().midpoint(p1, p2));
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

	return deduplicatePoints(pts, 1e-3);
}

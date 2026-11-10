import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import type { GeoCurve } from './intersection';
import { evaluateBezier } from './spline';
import { Vec2, type XY } from './vector';

const TWO_PI = 2 * Math.PI;

export class AABB {
	min: Vec2;
	max: Vec2;

	constructor(point?: XY) {
		this.min = point ? Vec2.from(point) : new Vec2(Infinity, Infinity);
		this.max = point ? Vec2.from(point) : new Vec2(-Infinity, -Infinity);
	}

	addPoint(point: XY): this {
		this.min.x = Math.min(this.min.x, point.x);
		this.min.y = Math.min(this.min.y, point.y);
		this.max.x = Math.max(this.max.x, point.x);
		this.max.y = Math.max(this.max.y, point.y);
		return this;
	}

	static fromPoints(points: Iterable<XY>): AABB | null {
		const iterator = points[Symbol.iterator]();
		const first = iterator.next();
		if (first.done) return null;

		const aabb = new AABB(first.value);
		for (let next = iterator.next(); !next.done; next = iterator.next()) {
			aabb.addPoint(next.value);
		}
		return aabb;
	}
}

/**
 * Checks if a point lies within an axis-aligned bounding box (AABB).
 */
export function pointIntersectsAABB(p: Vec2, min: Vec2, max: Vec2): boolean {
	return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

export function curveContainedInAABB(curve: GeoCurve, min: Vec2, max: Vec2): boolean {
	const bounds = getCurveBoundingBox(curve);
	return !bounds || (pointIntersectsAABB(bounds.min, min, max) && pointIntersectsAABB(bounds.max, min, max));
}

export function getCurveBoundingBox(curve: GeoCurve): AABB | null {
	if (curve.type === 'segment') return new AABB(curve.p1).addPoint(curve.p2);

	if (curve.type === 'spline') {
		if (curve.bezierSegments.length === 0) return null;
		const bounds = new AABB();
		for (const segment of curve.bezierSegments) {
			const [p0, p1, p2, p3] = segment;
			bounds.addPoint(p0).addPoint(p3);
			for (const axis of ['x', 'y'] as const) {
				const d0 = p1[axis] - p0[axis];
				const d1 = p2[axis] - p1[axis];
				const d2 = p3[axis] - p2[axis];
				const a = d0 - 2 * d1 + d2;
				const b = 2 * (d1 - d0);
				const discriminant = b * b - 4 * a * d0;
				const roots =
					a === 0
						? b === 0
							? []
							: [-d0 / b]
						: discriminant >= 0
							? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]
							: [];
				for (const t of roots) {
					if (t > 0 && t < 1) bounds.addPoint(evaluateBezier(segment, t));
				}
			}
		}
		return bounds;
	}

	const { center } = curve;
	const radii =
		curve.type === 'circle' || curve.type === 'arc'
			? new Vec2(curve.radius, curve.radius)
			: center.distancesTo(curve.majorAxisPoint, curve.minorAxisPoint);
	const angle = 'majorAxisPoint' in curve ? center.angleToPoint(curve.majorAxisPoint) : 0;
	const { axisU, axisV } = ellipseAxes(angle);
	const x = Math.hypot(radii.x * axisU.x, radii.y * axisV.x);
	const y = Math.hypot(radii.x * axisU.y, radii.y * axisV.y);
	if (curve.type === 'circle' || curve.type === 'ellipse') {
		const halfSize = new Vec2(x, y);
		return new AABB(center.clone().sub(halfSize)).addPoint(center.clone().add(halfSize));
	}

	const bounds = new AABB(curve.start).addPoint(curve.end);
	const parameterAt = (point: XY) =>
		curve.type === 'arc' ? center.angleToPoint(point) : ellipseParameterAtPoint(point, center, radii, axisU, axisV);
	const start = parameterAt(curve.start);
	const end = parameterAt(curve.end);
	// Clockwise in screen coordinates means decreasing parameter in world coordinates.
	const direction = curve.clockwise ? -1 : 1;
	const distanceFromStart = (t: number) => {
		const delta = ((t - start) * direction) % TWO_PI;
		return delta < 0 ? delta + TWO_PI : delta;
	};
	const sweep = distanceFromStart(end);

	// Only endpoints and the extrema on the swept portion can reach the box edges.
	const tx = Math.atan2(radii.y * axisV.x, radii.x * axisU.x);
	const ty = Math.atan2(radii.y * axisV.y, radii.x * axisU.y);
	if (distanceFromStart(tx) <= sweep) bounds.max.x = Math.max(bounds.max.x, center.x + x);
	if (distanceFromStart(tx + Math.PI) <= sweep) bounds.min.x = Math.min(bounds.min.x, center.x - x);
	if (distanceFromStart(ty) <= sweep) bounds.max.y = Math.max(bounds.max.y, center.y + y);
	if (distanceFromStart(ty + Math.PI) <= sweep) bounds.min.y = Math.min(bounds.min.y, center.y - y);
	return bounds;
}

/**
 * Checks if a 2D line segment between p1 and p2 intersects or is contained within an AABB.
 * Uses Liang-Barsky parametric line clipping.
 */
export function segmentIntersectsAABB(p1: Vec2, p2: Vec2, min: Vec2, max: Vec2): boolean {
	if (p1.x >= min.x && p1.x <= max.x && p1.y >= min.y && p1.y <= max.y) return true;
	if (p2.x >= min.x && p2.x <= max.x && p2.y >= min.y && p2.y <= max.y) return true;

	if (Math.max(p1.x, p2.x) < min.x || Math.min(p1.x, p2.x) > max.x) return false;
	if (Math.max(p1.y, p2.y) < min.y || Math.min(p1.y, p2.y) > max.y) return false;

	const dir = new Vec2().subVectors(p2, p1);
	let t0 = 0.0;
	let t1 = 1.0;

	const p = [-dir.x, dir.x, -dir.y, dir.y];
	const q = [p1.x - min.x, max.x - p1.x, p1.y - min.y, max.y - p1.y];

	for (let i = 0; i < 4; i++) {
		if (p[i] === 0) {
			if (q[i] < 0) return false;
		} else {
			const t = q[i] / p[i];
			if (p[i] < 0) {
				if (t > t1) return false;
				if (t > t0) t0 = t;
			} else {
				if (t < t0) return false;
				if (t < t1) t1 = t;
			}
		}
	}
	return t0 <= t1;
}

/**
 * Checks if a circle perimeter or interior intersects an AABB.
 */
export function circleIntersectsAABB(c: Vec2, r: number, min: Vec2, max: Vec2): boolean {
	if (c.x >= min.x && c.x <= max.x && c.y >= min.y && c.y <= max.y) return true;

	const closest = new Vec2(Math.max(min.x, Math.min(c.x, max.x)), Math.max(min.y, Math.min(c.y, max.y)));
	const distSq = c.distanceToSquared(closest);

	if (distSq > r * r) return false;

	const maxD = new Vec2(
		Math.max(Math.abs(c.x - min.x), Math.abs(c.x - max.x)),
		Math.max(Math.abs(c.y - min.y), Math.abs(c.y - max.y))
	);
	const furthestDistSq = maxD.lengthSq();

	if (furthestDistSq < r * r) return false;

	return true;
}

/**
 * Checks if a circular arc intersects or is inside an AABB.
 */
export function arcIntersectsAABB(
	center: Vec2,
	radius: number,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	min: Vec2,
	max: Vec2
): boolean {
	if (start.x >= min.x && start.x <= max.x && start.y >= min.y && start.y <= max.y) return true;
	if (end.x >= min.x && end.x <= max.x && end.y >= min.y && end.y <= max.y) return true;
	if (center.x >= min.x && center.x <= max.x && center.y >= min.y && center.y <= max.y) return true;

	const as = center.angleToPoint(start);
	const ae = center.angleToPoint(end);

	let sweepAngle = 0;
	if (clockwise) {
		sweepAngle = (ae - as) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	} else {
		sweepAngle = (as - ae) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	}

	const steps = 32;
	let prevX = start.x;
	let prevY = start.y;

	for (let i = 1; i <= steps; i++) {
		const frac = i / steps;
		const angle = clockwise ? as + frac * sweepAngle : as - frac * sweepAngle;
		const curr = Vec2.fromPolar(radius, angle).add(center);

		if (curr.x >= min.x && curr.x <= max.x && curr.y >= min.y && curr.y <= max.y) return true;
		if (segmentIntersectsAABB(new Vec2(prevX, prevY), curr, min, max)) return true;

		prevX = curr.x;
		prevY = curr.y;
	}

	return false;
}

/**
 * Checks if an ellipse intersects or is inside an AABB.
 */
export function ellipseIntersectsAABB(center: Vec2, majorPt: Vec2, minorPt: Vec2, min: Vec2, max: Vec2): boolean {
	if (center.x >= min.x && center.x <= max.x && center.y >= min.y && center.y <= max.y) return true;
	if (majorPt.x >= min.x && majorPt.x <= max.x && majorPt.y >= min.y && majorPt.y <= max.y) return true;
	if (minorPt.x >= min.x && minorPt.x <= max.x && minorPt.y >= min.y && minorPt.y <= max.y) return true;

	const r = center.distancesTo(majorPt, minorPt);
	if (r.x < 0.01 || r.y < 0.01) return false;

	const { axisU: u, axisV: v } = ellipseAxes(center.angleToPoint(majorPt));

	const steps = 36;
	let prevX = center.x + r.x * u.x;
	let prevY = center.y + r.x * u.y;

	for (let i = 1; i <= steps; i++) {
		const t = (i / steps) * TWO_PI;
		const curr = ellipsePointAtParameter(t, center, r, u, v);

		if (curr.x >= min.x && curr.x <= max.x && curr.y >= min.y && curr.y <= max.y) return true;
		if (segmentIntersectsAABB(new Vec2(prevX, prevY), curr, min, max)) return true;

		prevX = curr.x;
		prevY = curr.y;
	}

	return false;
}

/**
 * Checks if an elliptical arc intersects or is inside an AABB.
 */
export function ellipticalArcIntersectsAABB(
	center: Vec2,
	majorPt: Vec2,
	minorPt: Vec2,
	startPt: Vec2,
	endPt: Vec2,
	clockwise: boolean,
	min: Vec2,
	max: Vec2
): boolean {
	if (center.x >= min.x && center.x <= max.x && center.y >= min.y && center.y <= max.y) return true;
	if (startPt.x >= min.x && startPt.x <= max.x && startPt.y >= min.y && startPt.y <= max.y) return true;
	if (endPt.x >= min.x && endPt.x <= max.x && endPt.y >= min.y && endPt.y <= max.y) return true;

	const r = center.distancesTo(majorPt, minorPt);
	if (r.x < 0.01 || r.y < 0.01) return false;

	const { axisU: u, axisV: v } = ellipseAxes(center.angleToPoint(majorPt));

	const ts = ellipseParameterAtPoint(startPt, center, r, u, v);
	const te = ellipseParameterAtPoint(endPt, center, r, u, v);

	let sweepAngle = 0;
	if (clockwise) {
		sweepAngle = (te - ts) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	} else {
		sweepAngle = (ts - te) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	}

	const steps = 36;
	let prevX = startPt.x;
	let prevY = startPt.y;

	for (let i = 1; i <= steps; i++) {
		const frac = i / steps;
		const t = clockwise ? ts + frac * sweepAngle : ts - frac * sweepAngle;
		const curr = ellipsePointAtParameter(t, center, r, u, v);

		if (curr.x >= min.x && curr.x <= max.x && curr.y >= min.y && curr.y <= max.y) return true;
		if (segmentIntersectsAABB(new Vec2(prevX, prevY), curr, min, max)) return true;

		prevX = curr.x;
		prevY = curr.y;
	}

	return false;
}

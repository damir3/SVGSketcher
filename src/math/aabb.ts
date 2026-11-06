import { distancesFrom, type Vec2 } from './vector';

const TWO_PI = 2 * Math.PI;

export class AABB {
	min: Vec2;
	max: Vec2;

	constructor(point?: Vec2) {
		this.min = point ? { ...point } : { x: Infinity, y: Infinity };
		this.max = point ? { ...point } : { x: -Infinity, y: -Infinity };
	}

	addPoint(point: Vec2): this {
		this.min.x = Math.min(this.min.x, point.x);
		this.min.y = Math.min(this.min.y, point.y);
		this.max.x = Math.max(this.max.x, point.x);
		this.max.y = Math.max(this.max.y, point.y);
		return this;
	}

	static fromPoints(points: Iterable<Vec2>): AABB | null {
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

/**
 * Checks if a 2D line segment between p1 and p2 intersects or is contained within an AABB.
 * Uses Liang-Barsky parametric line clipping.
 */
export function segmentIntersectsAABB(p1: Vec2, p2: Vec2, min: Vec2, max: Vec2): boolean {
	if (p1.x >= min.x && p1.x <= max.x && p1.y >= min.y && p1.y <= max.y) return true;
	if (p2.x >= min.x && p2.x <= max.x && p2.y >= min.y && p2.y <= max.y) return true;

	if (Math.max(p1.x, p2.x) < min.x || Math.min(p1.x, p2.x) > max.x) return false;
	if (Math.max(p1.y, p2.y) < min.y || Math.min(p1.y, p2.y) > max.y) return false;

	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	let t0 = 0.0;
	let t1 = 1.0;

	const p = [-dx, dx, -dy, dy];
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

	const closestX = Math.max(min.x, Math.min(c.x, max.x));
	const closestY = Math.max(min.y, Math.min(c.y, max.y));
	const distSq = (c.x - closestX) ** 2 + (c.y - closestY) ** 2;

	if (distSq > r * r) return false;

	const maxDx = Math.max(Math.abs(c.x - min.x), Math.abs(c.x - max.x));
	const maxDy = Math.max(Math.abs(c.y - min.y), Math.abs(c.y - max.y));
	const furthestDistSq = maxDx * maxDx + maxDy * maxDy;

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

	const as = Math.atan2(start.y - center.y, start.x - center.x);
	const ae = Math.atan2(end.y - center.y, end.x - center.x);

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
		const currX = center.x + radius * Math.cos(angle);
		const currY = center.y + radius * Math.sin(angle);

		if (currX >= min.x && currX <= max.x && currY >= min.y && currY <= max.y) return true;
		if (segmentIntersectsAABB({ x: prevX, y: prevY }, { x: currX, y: currY }, min, max)) return true;

		prevX = currX;
		prevY = currY;
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

	const r = distancesFrom(center, majorPt, minorPt);
	if (r.x < 0.01 || r.y < 0.01) return false;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const steps = 36;
	let prevX = center.x + r.x * ux;
	let prevY = center.y + r.x * uy;

	for (let i = 1; i <= steps; i++) {
		const t = (i / steps) * TWO_PI;
		const cosT = Math.cos(t);
		const sinT = Math.sin(t);
		const currX = center.x + r.x * cosT * ux + r.y * sinT * vx;
		const currY = center.y + r.x * cosT * uy + r.y * sinT * vy;

		if (currX >= min.x && currX <= max.x && currY >= min.y && currY <= max.y) return true;
		if (segmentIntersectsAABB({ x: prevX, y: prevY }, { x: currX, y: currY }, min, max)) return true;

		prevX = currX;
		prevY = currY;
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

	const r = distancesFrom(center, majorPt, minorPt);
	if (r.x < 0.01 || r.y < 0.01) return false;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const us = (startPt.x - center.x) * ux + (startPt.y - center.y) * uy;
	const vs = (startPt.x - center.x) * vx + (startPt.y - center.y) * vy;
	const ue = (endPt.x - center.x) * ux + (endPt.y - center.y) * uy;
	const ve = (endPt.x - center.x) * vx + (endPt.y - center.y) * vy;

	const ts = Math.atan2(vs / r.y, us / r.x);
	const te = Math.atan2(ve / r.y, ue / r.x);

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
		const cosT = Math.cos(t);
		const sinT = Math.sin(t);
		const currX = center.x + r.x * cosT * ux + r.y * sinT * vx;
		const currY = center.y + r.x * cosT * uy + r.y * sinT * vy;

		if (currX >= min.x && currX <= max.x && currY >= min.y && currY <= max.y) return true;
		if (segmentIntersectsAABB({ x: prevX, y: prevY }, { x: currX, y: currY }, min, max)) return true;

		prevX = currX;
		prevY = currY;
	}

	return false;
}

import type { Vec2 } from './vector';

const TWO_PI = 2 * Math.PI;

export interface AABB {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Checks if a point lies within an axis-aligned bounding box (AABB).
 */
export function pointIntersectsAABB(
	px: number,
	py: number,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/**
 * Checks if a 2D line segment between (p1x, p1y) and (p2x, p2y) intersects or is contained within an AABB.
 * Uses Liang-Barsky parametric line clipping.
 */
export function segmentIntersectsAABB(
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	if (p1x >= minX && p1x <= maxX && p1y >= minY && p1y <= maxY) return true;
	if (p2x >= minX && p2x <= maxX && p2y >= minY && p2y <= maxY) return true;

	if (Math.max(p1x, p2x) < minX || Math.min(p1x, p2x) > maxX) return false;
	if (Math.max(p1y, p2y) < minY || Math.min(p1y, p2y) > maxY) return false;

	const dx = p2x - p1x;
	const dy = p2y - p1y;
	let t0 = 0.0;
	let t1 = 1.0;

	const p = [-dx, dx, -dy, dy];
	const q = [p1x - minX, maxX - p1x, p1y - minY, maxY - p1y];

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
export function circleIntersectsAABB(
	cx: number,
	cy: number,
	r: number,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) return true;

	const closestX = Math.max(minX, Math.min(cx, maxX));
	const closestY = Math.max(minY, Math.min(cy, maxY));
	const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2;

	if (distSq > r * r) return false;

	const maxDx = Math.max(Math.abs(cx - minX), Math.abs(cx - maxX));
	const maxDy = Math.max(Math.abs(cy - minY), Math.abs(cy - maxY));
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
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	if (start.x >= minX && start.x <= maxX && start.y >= minY && start.y <= maxY) return true;
	if (end.x >= minX && end.x <= maxX && end.y >= minY && end.y <= maxY) return true;
	if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;

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

		if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
		if (segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

		prevX = currX;
		prevY = currY;
	}

	return false;
}

/**
 * Checks if an ellipse intersects or is inside an AABB.
 */
export function ellipseIntersectsAABB(
	center: Vec2,
	majorPt: Vec2,
	minorPt: Vec2,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;
	if (majorPt.x >= minX && majorPt.x <= maxX && majorPt.y >= minY && majorPt.y <= maxY) return true;
	if (minorPt.x >= minX && minorPt.x <= maxX && minorPt.y >= minY && minorPt.y <= maxY) return true;

	const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
	const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
	if (rx < 0.01 || ry < 0.01) return false;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const steps = 36;
	let prevX = center.x + rx * ux;
	let prevY = center.y + rx * uy;

	for (let i = 1; i <= steps; i++) {
		const t = (i / steps) * TWO_PI;
		const cosT = Math.cos(t);
		const sinT = Math.sin(t);
		const currX = center.x + rx * cosT * ux + ry * sinT * vx;
		const currY = center.y + rx * cosT * uy + ry * sinT * vy;

		if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
		if (segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

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
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): boolean {
	if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) return true;
	if (startPt.x >= minX && startPt.x <= maxX && startPt.y >= minY && startPt.y <= maxY) return true;
	if (endPt.x >= minX && endPt.x <= maxX && endPt.y >= minY && endPt.y <= maxY) return true;

	const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
	const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
	if (rx < 0.01 || ry < 0.01) return false;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const us = (startPt.x - center.x) * ux + (startPt.y - center.y) * uy;
	const vs = (startPt.x - center.x) * vx + (startPt.y - center.y) * vy;
	const ue = (endPt.x - center.x) * ux + (endPt.y - center.y) * uy;
	const ve = (endPt.x - center.x) * vx + (endPt.y - center.y) * vy;

	const ts = Math.atan2(vs / ry, us / rx);
	const te = Math.atan2(ve / ry, ue / rx);

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
		const currX = center.x + rx * cosT * ux + ry * sinT * vx;
		const currY = center.y + rx * cosT * uy + ry * sinT * vy;

		if (currX >= minX && currX <= maxX && currY >= minY && currY <= maxY) return true;
		if (segmentIntersectsAABB(prevX, prevY, currX, currY, minX, minY, maxX, maxY)) return true;

		prevX = currX;
		prevY = currY;
	}

	return false;
}

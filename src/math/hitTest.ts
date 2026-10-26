import { type Vec2, dist, projectPointOntoSegment } from './vector';
import { getSplineParamAtPoint, type BezierSegment } from './spline';

const TWO_PI = 2 * Math.PI;

/**
 * Calculates Euclidean distance from a query point to a target point.
 */
export function distanceToPoint(point: Vec2, target: Vec2): number {
	return dist(point, target);
}

/**
 * Calculates perpendicular or endpoint-clamped distance from a query point to a line segment.
 */
export function distanceToSegment(point: Vec2, p1: Vec2, p2: Vec2): number {
	return projectPointOntoSegment(point, p1, p2).dist;
}

/**
 * Calculates distance from a query point to the perimeter of a circle.
 */
export function distanceToCircle(point: Vec2, center: Vec2, radius: number): number {
	return Math.abs(dist(point, center) - radius);
}

/**
 * Calculates distance from a query point to a circular arc.
 * Returns null if the projection of the point falls outside the arc's angular span (with tolerance).
 */
export function distanceToArc(
	point: Vec2,
	center: Vec2,
	radius: number,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	thresholdPx = 18
): number | null {
	const dToCenter = dist(point, center);
	const dToPerimeter = Math.abs(dToCenter - radius);
	if (dToPerimeter > thresholdPx) return null;

	const as = Math.atan2(start.y - center.y, start.x - center.x);
	const ae = Math.atan2(end.y - center.y, end.x - center.x);
	const ap = Math.atan2(point.y - center.y, point.x - center.x);

	let sweepAngle = clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
	if (sweepAngle < 0) sweepAngle += TWO_PI;
	let pAngle = clockwise ? (ap - as) % TWO_PI : (as - ap) % TWO_PI;
	if (pAngle < 0) pAngle += TWO_PI;

	const angTolerance = thresholdPx / Math.max(radius, 1);
	if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
		return dToPerimeter;
	}
	return null;
}

/**
 * Calculates distance from a query point to the perimeter of an oriented ellipse.
 * Returns null if the ellipse is degenerate (rx < 0.1 or ry < 0.1).
 */
export function distanceToEllipse(
	point: Vec2,
	center: Vec2,
	majorPt: Vec2,
	minorPt: Vec2
): number | null {
	const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
	const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
	if (rx < 0.1 || ry < 0.1) return null;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const dx = point.x - center.x;
	const dy = point.y - center.y;
	const u = dx * ux + dy * uy;
	const v = dx * vx + dy * vy;

	const t = Math.atan2(v / ry, u / rx);
	const ex = rx * Math.cos(t) * ux + ry * Math.sin(t) * vx;
	const ey = rx * Math.cos(t) * uy + ry * Math.sin(t) * vy;

	return Math.hypot(dx - ex, dy - ey);
}

/**
 * Calculates distance from a query point to an elliptical arc.
 * Returns null if the point is outside the angular span or exceeds threshold.
 */
export function distanceToEllipticalArc(
	point: Vec2,
	center: Vec2,
	majorPt: Vec2,
	minorPt: Vec2,
	startPt: Vec2,
	endPt: Vec2,
	clockwise: boolean,
	thresholdPx = 18
): number | null {
	const rx = Math.hypot(majorPt.x - center.x, majorPt.y - center.y);
	const ry = Math.hypot(minorPt.x - center.x, minorPt.y - center.y);
	if (rx < 0.1 || ry < 0.1) return null;

	const theta = Math.atan2(majorPt.y - center.y, majorPt.x - center.x);
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const dx = point.x - center.x;
	const dy = point.y - center.y;
	const u = dx * ux + dy * uy;
	const v = dx * vx + dy * vy;

	const t = Math.atan2(v / ry, u / rx);
	const ex = rx * Math.cos(t) * ux + ry * Math.sin(t) * vx;
	const ey = rx * Math.cos(t) * uy + ry * Math.sin(t) * vy;

	const dPerimeter = Math.hypot(dx - ex, dy - ey);
	if (dPerimeter > thresholdPx) return null;

	const us = (startPt.x - center.x) * ux + (startPt.y - center.y) * uy;
	const vs = (startPt.x - center.x) * vx + (startPt.y - center.y) * vy;
	const ue = (endPt.x - center.x) * ux + (endPt.y - center.y) * uy;
	const ve = (endPt.x - center.x) * vx + (endPt.y - center.y) * vy;

	const ts = Math.atan2(vs / ry, us / rx);
	const te = Math.atan2(ve / ry, ue / rx);

	let sweepAngle = clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
	if (sweepAngle < 0) sweepAngle += TWO_PI;
	let pAngle = clockwise ? (t - ts) % TWO_PI : (ts - t) % TWO_PI;
	if (pAngle < 0) pAngle += TWO_PI;

	const angTolerance = thresholdPx / Math.max(Math.min(rx, ry), 1);
	if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
		return dPerimeter;
	}
	return null;
}

/**
 * Calculates distance from a query point to a piecewise cubic Bezier spline.
 */
export function distanceToSpline(point: Vec2, screenSegments: BezierSegment[]): number {
	return getSplineParamAtPoint(screenSegments, point).distance;
}

/**
 * Calculates distance from a query point to a linear dimension line.
 */
export function distanceToLinearDimension(point: Vec2, d1: Vec2, d2: Vec2): number {
	return projectPointOntoSegment(point, d1, d2).dist;
}

/**
 * Calculates distance from a query point to a radial dimension leader line and shelf.
 */
export function distanceToRadiusDimension(
	point: Vec2,
	center: Vec2,
	radius: number,
	screenAngle: number
): number {
	const cosA = Math.cos(screenAngle);
	const sinA = Math.sin(screenAngle);
	const edge = { x: center.x + cosA * radius, y: center.y + sinA * radius };
	const dirX = cosA >= 0 ? 1 : -1;
	const dirY = sinA >= 0 ? 1 : -1;
	const tip = { x: edge.x + dirX * 30, y: edge.y + dirY * 20 };

	const dTip = dist(point, tip);
	const dShelf = projectPointOntoSegment(point, edge, tip).dist;
	const dRadial = projectPointOntoSegment(point, center, edge).dist;

	return Math.min(dTip, dShelf, dRadial);
}

import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import { ORIGIN, angleFromTo, sub, type Vec2, dist, distancesFrom, projectPointOntoSegment } from './vector';
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

	const as = angleFromTo(center, start);
	const ae = angleFromTo(center, end);
	const ap = angleFromTo(center, point);

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
export function distanceToEllipse(point: Vec2, center: Vec2, majorPt: Vec2, minorPt: Vec2): number | null {
	const r = distancesFrom(center, majorPt, minorPt);
	if (r.x < 0.1 || r.y < 0.1) return null;

	const { axisU, axisV } = ellipseAxes(angleFromTo(center, majorPt));

	const dir = sub(point, center);

	const t = ellipseParameterAtPoint(point, center, r, axisU, axisV);
	const ellipsePoint = ellipsePointAtParameter(t, ORIGIN, r, axisU, axisV);

	return Math.hypot(dir.x - ellipsePoint.x, dir.y - ellipsePoint.y);
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
	const r = distancesFrom(center, majorPt, minorPt);
	if (r.x < 0.1 || r.y < 0.1) return null;

	const { axisU, axisV } = ellipseAxes(angleFromTo(center, majorPt));

	const dir = sub(point, center);

	const t = ellipseParameterAtPoint(point, center, r, axisU, axisV);
	const ellipsePoint = ellipsePointAtParameter(t, ORIGIN, r, axisU, axisV);

	const dPerimeter = Math.hypot(dir.x - ellipsePoint.x, dir.y - ellipsePoint.y);
	if (dPerimeter > thresholdPx) return null;

	const ts = ellipseParameterAtPoint(startPt, center, r, axisU, axisV);
	const te = ellipseParameterAtPoint(endPt, center, r, axisU, axisV);

	let sweepAngle = clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
	if (sweepAngle < 0) sweepAngle += TWO_PI;
	let pAngle = clockwise ? (t - ts) % TWO_PI : (ts - t) % TWO_PI;
	if (pAngle < 0) pAngle += TWO_PI;

	const angTolerance = thresholdPx / Math.max(Math.min(r.x, r.y), 1);
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

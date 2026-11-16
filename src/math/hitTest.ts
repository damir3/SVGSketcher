import { getQueryKernel } from './queries';
import { Vec2, projectPointOntoSegment } from './vector';
import type { BezierSegment } from './spline';

// Point/vector arithmetic remains local; curve groups are queried in one kernel call.
export function distanceToPoint(point: Vec2, target: Vec2): number {
	return point.distanceTo(target);
}
export function distanceToSegment(point: Vec2, p1: Vec2, p2: Vec2): number {
	return projectPointOntoSegment(point, p1, p2).dist;
}
export function distanceToCircle(point: Vec2, center: Vec2, radius: number): number {
	return Math.abs(point.distanceTo(center) - radius);
}
export const distanceToLinearDimension = distanceToSegment;
export function distanceToArc(
	point: Vec2,
	center: Vec2,
	radius: number,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	thresholdPx = 18
): number | null {
	return getQueryKernel().distances(
		[{ id: '', type: 'arc', center, radius, start, end, clockwise }],
		point,
		thresholdPx
	)[0];
}
export function distanceToEllipse(
	point: Vec2,
	center: Vec2,
	majorAxisPoint: Vec2,
	minorAxisPoint: Vec2
): number | null {
	return getQueryKernel().distances(
		[{ id: '', type: 'ellipse', center, majorAxisPoint, minorAxisPoint }],
		point,
		18
	)[0];
}
export function distanceToEllipticalArc(
	point: Vec2,
	center: Vec2,
	majorAxisPoint: Vec2,
	minorAxisPoint: Vec2,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	thresholdPx = 18
): number | null {
	return getQueryKernel().distances(
		[{ id: '', type: 'elliptical_arc', center, majorAxisPoint, minorAxisPoint, start, end, clockwise }],
		point,
		thresholdPx
	)[0];
}
export function distanceToSpline(point: Vec2, bezierSegments: BezierSegment[]): number {
	return getQueryKernel().distances([{ id: '', type: 'spline', bezierSegments }], point, 18)[0] ?? Infinity;
}

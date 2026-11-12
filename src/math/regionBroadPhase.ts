import { AABB, getCurveBoundingBox } from './aabb';
import type { GeoCurve } from './intersection';

/** Conservative bounds for intersection rejection, rather than tight display/selection bounds. */
export function getRegionCurveBounds(curve: GeoCurve): AABB | null {
	let bounds: AABB | null;
	if (curve.type === 'spline') {
		// The control hull contains every cubic, including its interior extrema, without root finding.
		bounds = new AABB();
		for (const segment of curve.bezierSegments) for (const point of segment) bounds.addPoint(point);
	} else if (curve.type === 'arc') {
		if (curve.radius < 0) return null;
		bounds = getCurveBoundingBox({
			type: 'circle',
			id: curve.id,
			center: curve.center,
			centerId: curve.centerId,
			radius: curve.radius,
		});
		bounds?.addPoint(curve.start).addPoint(curve.end);
	} else if (curve.type === 'elliptical_arc') {
		// Full conics also cover the angular tolerance used by the arc-span filters.
		bounds = getCurveBoundingBox({ ...curve, type: 'ellipse' });
		bounds?.addPoint(curve.start).addPoint(curve.end);
	} else {
		if (curve.type === 'circle' && curve.radius < 0) return null;
		bounds = getCurveBoundingBox(curve);
	}
	if (!bounds) return null;
	const { min, max } = bounds;
	const extent = Math.max(max.x - min.x, max.y - min.y);
	const magnitude = Math.max(Math.abs(min.x), Math.abs(min.y), Math.abs(max.x), Math.abs(max.y));
	if (![min.x, min.y, max.x, max.y, extent, magnitude].every(Number.isFinite)) return null;
	// Cover 1e-5 segment parameter extension, 1e-4 conic implicit near roots,
	// 1e-3 Bezier contact tolerance, and rounding at translated world coordinates.
	const padding = Math.max(1e-3, extent * 1e-4) + magnitude * Number.EPSILON * 32;
	min.x -= padding;
	min.y -= padding;
	max.x += padding;
	max.y += padding;
	return bounds;
}

export function regionBoundsMayIntersect(
	a: GeoCurve,
	b: GeoCurve,
	boundsA: AABB | null,
	boundsB: AABB | null
): boolean {
	// Segment/ellipse uses an absolute discriminant tolerance in coefficient units.
	// For tiny or eccentric ellipses this can accept contacts far outside geometric bounds.
	// Keep those pairs on the existing exact path, rather than guessing a world-space margin.
	if (
		(a.type === 'segment' && (b.type === 'ellipse' || b.type === 'elliptical_arc')) ||
		(b.type === 'segment' && (a.type === 'ellipse' || a.type === 'elliptical_arc'))
	)
		return true;
	// Unbounded/invalid geometry must retain the exact path (including its validation errors).
	if (!boundsA || !boundsB) return true;
	return !(
		boundsA.max.x < boundsB.min.x ||
		boundsB.max.x < boundsA.min.x ||
		boundsA.max.y < boundsB.min.y ||
		boundsB.max.y < boundsA.min.y
	);
}

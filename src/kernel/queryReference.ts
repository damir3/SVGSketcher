import { arcCrossesBox } from './queryArcBox';
import type { GeometryQueryKernel, QueryCurve, QueryMatch, QueryRegion } from './queryTypes';
import { Vec2, projectPointOntoSegment } from '../math/vector';
import * as hit from '../math/hitTestReference';
import * as box from '../math/aabbReference';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import { getSplineParamAtPoint } from '../math/splineReference';
import { intersectCurves } from '../math/intersection';
import type { GeoCurve } from '../math/intersection';

export function hydrateQueryCurve(c: QueryCurve): GeoCurve {
	switch (c.type) {
		case 'segment':
			return { ...c, p1: Vec2.from(c.p1), p2: Vec2.from(c.p2) };
		case 'circle':
			return { ...c, centerId: '', center: Vec2.from(c.center) };
		case 'arc':
			return {
				...c,
				centerId: '',
				startPointId: '',
				endPointId: '',
				center: Vec2.from(c.center),
				start: Vec2.from(c.start),
				end: Vec2.from(c.end),
			};
		case 'ellipse':
			return {
				...c,
				centerId: '',
				majorAxisPointId: '',
				minorAxisPointId: '',
				center: Vec2.from(c.center),
				majorAxisPoint: Vec2.from(c.majorAxisPoint),
				minorAxisPoint: Vec2.from(c.minorAxisPoint),
			};
		case 'elliptical_arc':
			return {
				...c,
				centerId: '',
				majorAxisPointId: '',
				minorAxisPointId: '',
				startPointId: '',
				endPointId: '',
				center: Vec2.from(c.center),
				majorAxisPoint: Vec2.from(c.majorAxisPoint),
				minorAxisPoint: Vec2.from(c.minorAxisPoint),
				start: Vec2.from(c.start),
				end: Vec2.from(c.end),
			};
		case 'spline':
			return {
				...c,
				splineType: 'control',
				pointIds: [],
				points: [],
				bezierSegments: c.bezierSegments.map(b => [Vec2.from(b[0]), Vec2.from(b[1]), Vec2.from(b[2]), Vec2.from(b[3])]),
			};
	}
}
function distance(c: GeoCurve, point: Vec2, threshold: number): number | null {
	switch (c.type) {
		case 'segment':
			return hit.distanceToSegment(point, c.p1, c.p2);
		case 'circle':
			return hit.distanceToCircle(point, c.center, c.radius);
		case 'arc':
			return hit.distanceToArc(point, c.center, c.radius, c.start, c.end, c.clockwise, threshold);
		case 'ellipse':
			return hit.distanceToEllipse(point, c.center, c.majorAxisPoint, c.minorAxisPoint);
		case 'elliptical_arc':
			return hit.distanceToEllipticalArc(
				point,
				c.center,
				c.majorAxisPoint,
				c.minorAxisPoint,
				c.start,
				c.end,
				c.clockwise,
				threshold
			);
		case 'spline':
			return c.bezierSegments.length ? hit.distanceToSpline(point, c.bezierSegments) : null;
	}
}
const tau = 2 * Math.PI;
function positive(t: number): number {
	const s = t % tau;
	return s < 0 ? s + tau : s;
}
/** Frozen primitive snapping arithmetic, separate from editor visibility and priority rules. */
function snap(
	c: GeoCurve,
	p: Vec2,
	max: number,
	tolerance: number
): { distance: number; point: Vec2; param: number } | null {
	if (c.type === 'segment') {
		const q = projectPointOntoSegment(p, c.p1, c.p2);
		return q.dist < max ? { distance: q.dist, point: q.point, param: q.t } : null;
	}
	if (c.type === 'spline') {
		if (!c.bezierSegments.length) return null;
		const q = getSplineParamAtPoint(c.bezierSegments, p);
		return q.distance < max ? { distance: q.distance, point: q.point, param: 0 } : null;
	}
	if (c.type === 'circle' || c.type === 'arc') {
		const delta = p.clone().sub(c.center),
			length = delta.length(),
			d = Math.abs(length - c.radius);
		if (d >= max) return null;
		if (c.type === 'circle')
			return {
				distance: d,
				point: c.center.clone().addScaledVector(delta, c.radius / Math.max(length, 1e-6)),
				param: 0,
			};
		const a = c.center.angleToPoint(c.start),
			b = c.center.angleToPoint(c.end),
			t = c.center.angleToPoint(p),
			direction = c.clockwise ? 1 : -1,
			span = positive((b - a) * direction),
			angle = positive((t - a) * direction),
			tol = tolerance / Math.max(c.radius, 1);
		if (angle > span + tol && angle < tau - tol) return null;
		const actual = a + direction * Math.max(0, Math.min(span, angle));
		return { distance: d, point: Vec2.fromPolar(c.radius, actual).add(c.center), param: 0 };
	}
	const center = c.center,
		r = center.distancesTo(c.majorAxisPoint, c.minorAxisPoint);
	if (r.x < 1 || r.y < 1) return null;
	const axes =
		c.type === 'ellipse'
			? {
					axisU: c.majorAxisPoint
						.clone()
						.sub(center)
						.multiplyScalar(1 / r.x),
					axisV: c.minorAxisPoint
						.clone()
						.sub(center)
						.multiplyScalar(1 / r.y),
				}
			: ellipseAxes(center.angleToPoint(c.majorAxisPoint));
	let t = ellipseParameterAtPoint(p, center, r, axes.axisU, axes.axisV);
	if (c.type === 'elliptical_arc') {
		const a = ellipseParameterAtPoint(c.start, center, r, axes.axisU, axes.axisV),
			b = ellipseParameterAtPoint(c.end, center, r, axes.axisU, axes.axisV),
			direction = c.clockwise ? 1 : -1,
			span = positive((b - a) * direction),
			angle = positive((t - a) * direction),
			tol = tolerance / Math.max(Math.min(r.x, r.y), 1);
		if (angle > span + tol && angle < tau - tol) return null;
		t = a + direction * (angle >= tau - tol ? 0 : Math.min(span, Math.max(0, angle)));
	}
	const point = ellipsePointAtParameter(t, center, r, axes.axisU, axes.axisV),
		d = p.distanceTo(point);
	return d < max ? { distance: d, point, param: 0 } : null;
}
function crossing(c: GeoCurve, min: Vec2, max: Vec2): boolean {
	switch (c.type) {
		case 'segment':
			return box.segmentIntersectsAABB(c.p1, c.p2, min, max);
		case 'circle':
			return box.circleIntersectsAABB(c.center, c.radius, min, max);
		case 'arc':
			return arcCrossesBox(c, min, max);
		case 'ellipse':
			return box.ellipseIntersectsAABB(c.center, c.majorAxisPoint, c.minorAxisPoint, min, max);
		case 'elliptical_arc':
			return arcCrossesBox(c, min, max);
		case 'spline': {
			if (
				c.bezierSegments.some(
					([a, , , b]) => box.pointIntersectsAABB(a, min, max) || box.pointIntersectsAABB(b, min, max)
				)
			)
				return true;
			const corners = [min, new Vec2(max.x, min.y), max, new Vec2(min.x, max.y)];
			return corners.some(
				(p, i) => intersectCurves(c, { id: '', type: 'segment', p1: p, p2: corners[(i + 1) % 4] }).length > 0
			);
		}
	}
}
function inRing(p: Vec2, ring: QueryRegion['points']): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i],
			b = ring[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}
export const typescriptQueryKernel: GeometryQueryKernel = {
	bounds: curves => curves.map(c => box.getCurveBoundingBox(hydrateQueryCurve(c))),
	distances: (curves, p, t) => curves.map(c => distance(hydrateQueryCurve(c), Vec2.from(p), t)),
	closest(curves, p, threshold, isSnap = false, tolerance = threshold) {
		let best: QueryMatch | null = null,
			max = threshold;
		curves.forEach((c, index) => {
			const curve = hydrateQueryCurve(c),
				point = Vec2.from(p),
				q = isSnap ? snap(curve, point, max, tolerance) : null,
				d = isSnap ? q?.distance : distance(curve, point, max);
			if (d != null && d < max) {
				max = d;
				best = { index, distance: d, ...(q ? { point: q.point, param: q.param } : {}) };
			}
		});
		return best;
	},
	box: (curves, min, max, contained) =>
		curves.map(c =>
			contained
				? box.curveContainedInAABB(hydrateQueryCurve(c), Vec2.from(min), Vec2.from(max))
				: crossing(hydrateQueryCurve(c), Vec2.from(min), Vec2.from(max))
		),
	contains: (regions, p) =>
		regions.map(r => inRing(Vec2.from(p), r.points) && !r.holes.some(h => inRing(Vec2.from(p), h))),
};

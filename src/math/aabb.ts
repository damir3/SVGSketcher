import type { GeoCurve } from './intersection';
import { Vec2, type XY } from './vector';
import type { QueryCurve } from '../kernel/queryTypes';
import { getQueryKernel, isQueryableCurve } from './queries';

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
	return getQueryKernel().box([curve], min, max, true)[0];
}

export function curvesIntersectAABB(curves: readonly QueryCurve[], min: Vec2, max: Vec2, contained = false): boolean[] {
	return getQueryKernel().box(curves, min, max, contained);
}

export function getCurveBoundingBoxes(curves: readonly QueryCurve[]): (AABB | null)[] {
	const valid = curves.map(isQueryableCurve);
	const bounds = getQueryKernel().bounds(curves.filter((_, i) => valid[i]));
	let index = 0;
	return valid.map(v => {
		const b = v ? bounds[index++] : null;
		return b ? new AABB(b.min).addPoint(b.max) : null;
	});
}

export function getCurveBoundingBox(curve: GeoCurve): AABB | null {
	return getCurveBoundingBoxes([curve])[0];
}

export function segmentIntersectsAABB(p1: Vec2, p2: Vec2, min: Vec2, max: Vec2): boolean {
	return curvesIntersectAABB([{ id: '', type: 'segment', p1, p2 }], min, max)[0];
}
export function circleIntersectsAABB(center: Vec2, radius: number, min: Vec2, max: Vec2): boolean {
	return curvesIntersectAABB([{ id: '', type: 'circle', center, radius }], min, max)[0];
}
export function arcIntersectsAABB(
	center: Vec2,
	radius: number,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	min: Vec2,
	max: Vec2
): boolean {
	return curvesIntersectAABB([{ id: '', type: 'arc', center, radius, start, end, clockwise }], min, max)[0];
}
export function ellipseIntersectsAABB(
	center: Vec2,
	majorAxisPoint: Vec2,
	minorAxisPoint: Vec2,
	min: Vec2,
	max: Vec2
): boolean {
	return curvesIntersectAABB([{ id: '', type: 'ellipse', center, majorAxisPoint, minorAxisPoint }], min, max)[0];
}
export function ellipticalArcIntersectsAABB(
	center: Vec2,
	majorAxisPoint: Vec2,
	minorAxisPoint: Vec2,
	start: Vec2,
	end: Vec2,
	clockwise: boolean,
	min: Vec2,
	max: Vec2
): boolean {
	return curvesIntersectAABB(
		[{ id: '', type: 'elliptical_arc', center, majorAxisPoint, minorAxisPoint, start, end, clockwise }],
		min,
		max
	)[0];
}

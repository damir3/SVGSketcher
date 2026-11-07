import type { ToolContext } from '../types';
import { centroid, type Vec2 } from '../../../math/vector';
import type { SketchDocument } from '../../../model/sketch';

/**
 * Calculates the centroid (mean of all vertices/centers) for the given entities in the sketch.
 */
export function calculateObjectsCentroid(sketch: SketchDocument, objectIds: Iterable<string>): Vec2 | null {
	const points: Vec2[] = [];
	for (const objId of objectIds) {
		const pt = sketch.points.get(objId);
		if (pt) {
			points.push(pt);
			continue;
		}
		const l = sketch.lines.get(objId);
		if (l) {
			const p1 = sketch.points.get(l.p1Id);
			const p2 = sketch.points.get(l.p2Id);
			if (p1) points.push(p1);
			if (p2) points.push(p2);
			continue;
		}
		const c = sketch.circles.get(objId);
		if (c) {
			const cp = sketch.points.get(c.centerId);
			if (cp) points.push(cp);
			continue;
		}
		const a = sketch.arcs.get(objId);
		if (a) {
			const cp = sketch.points.get(a.centerId);
			if (cp) points.push(cp);
			continue;
		}
		const el = sketch.ellipses.get(objId);
		if (el) {
			const cp = sketch.points.get(el.centerId);
			if (cp) points.push(cp);
			continue;
		}
		const ea = sketch.ellipticalArcs.get(objId);
		if (ea) {
			const cp = sketch.points.get(ea.centerId);
			if (cp) points.push(cp);
			continue;
		}
		for (const id of new Set(sketch.splines.get(objId)?.pointIds)) {
			const point = sketch.points.get(id);
			if (point) points.push(point);
		}
	}
	if (points.length === 0) return null;
	return centroid(points);
}

export function findTransformObjectId(ctx: ToolContext, screen: Vec2): string | null {
	const point = ctx.findPointNear(screen);
	if (point && !ctx.sketch.isSplineHandlePoint(point.id)) return point.id;
	const line = ctx.findLineNear(screen);
	if (line && !line.isSplineHandle) return line.id;
	return (
		ctx.findCircleNear(screen)?.id ??
		ctx.findArcNear(screen)?.id ??
		ctx.findEllipseNear?.(screen)?.id ??
		ctx.findEllipticalArcNear?.(screen)?.id ??
		ctx.findSplineNear?.(screen)?.id ??
		null
	);
}

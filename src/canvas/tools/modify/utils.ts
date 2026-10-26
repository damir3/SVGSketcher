import type { Vec2 } from '../../../math/vector';
import type { SketchDocument } from '../../../model/sketch';

/**
 * Calculates the centroid (mean of all vertices/centers) for the given entities in the sketch.
 */
export function calculateObjectsCentroid(sketch: SketchDocument, objectIds: Iterable<string>): Vec2 | null {
	let sumX = 0;
	let sumY = 0;
	let ptCount = 0;
	for (const objId of objectIds) {
		const pt = sketch.points.get(objId);
		if (pt) {
			sumX += pt.x;
			sumY += pt.y;
			ptCount++;
			continue;
		}
		const l = sketch.lines.get(objId);
		if (l) {
			const p1 = sketch.points.get(l.p1Id);
			const p2 = sketch.points.get(l.p2Id);
			if (p1) { sumX += p1.x; sumY += p1.y; ptCount++; }
			if (p2) { sumX += p2.x; sumY += p2.y; ptCount++; }
			continue;
		}
		const c = sketch.circles.get(objId);
		if (c) {
			const cp = sketch.points.get(c.centerId);
			if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
			continue;
		}
		const a = sketch.arcs.get(objId);
		if (a) {
			const cp = sketch.points.get(a.centerId);
			if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
			continue;
		}
		const el = sketch.ellipses.get(objId);
		if (el) {
			const cp = sketch.points.get(el.centerId);
			if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
			continue;
		}
		const ea = sketch.ellipticalArcs.get(objId);
		if (ea) {
			const cp = sketch.points.get(ea.centerId);
			if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
			continue;
		}
	}
	if (ptCount === 0) return null;
	return { x: sumX / ptCount, y: sumY / ptCount };
}

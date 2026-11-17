import type { ToolContext } from '../types';
import { Vec2 } from '../../../math/vector';
import type { SketchDocument } from '../../../model/sketch';
import { LABEL_DISTANCE_PX } from '../../distances';

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
		const centered =
			sketch.circles.get(objId) ??
			sketch.arcs.get(objId) ??
			sketch.ellipses.get(objId) ??
			sketch.ellipticalArcs.get(objId);
		if (centered) {
			const cp = sketch.points.get(centered.centerId);
			if (cp) points.push(cp);
			continue;
		}
		for (const id of new Set(sketch.splines.get(objId)?.pointIds)) {
			const point = sketch.points.get(id);
			if (point) points.push(point);
		}
	}
	if (points.length === 0) return null;
	return Vec2.centroid(points);
}

export function findPatternCheckboxAtScreen(ctx: ToolContext | undefined, screen: Vec2) {
	for (const entry of ctx?.renderer?.patternCheckboxPositions?.values() ?? []) {
		if (
			!entry.constraintId &&
			Math.abs(screen.x - entry.x) <= LABEL_DISTANCE_PX &&
			Math.abs(screen.y - entry.y) <= LABEL_DISTANCE_PX
		) {
			return entry;
		}
	}
	return null;
}

export function togglePatternCheckboxAtScreen(
	ctx: ToolContext,
	state: { suppression: boolean; suppressedIndices: Set<number> },
	screen: Vec2,
	onToggle: () => void
): boolean {
	if (!state.suppression) return false;
	const entry = findPatternCheckboxAtScreen(ctx, screen);
	if (!entry) return false;
	if (state.suppressedIndices.has(entry.copyIndex)) {
		state.suppressedIndices.delete(entry.copyIndex);
	} else {
		state.suppressedIndices.add(entry.copyIndex);
	}
	onToggle();
	return true;
}

export function collectPatternCheckboxesToAABB(ctx: ToolContext, suppression: boolean, pts: Vec2[]): void {
	if (!suppression || !ctx.renderer?.patternCheckboxPositions) return;
	for (const entry of ctx.renderer.patternCheckboxPositions.values()) {
		if (!entry.constraintId) {
			pts.push(Vec2.from(entry).subScalar(14), Vec2.from(entry).addScalar(14));
		}
	}
}

export function formatLineLengthLabel(
	sketch: SketchDocument | undefined,
	lineId: string | null | undefined,
	fallback: string
): string {
	if (!lineId || !sketch) return fallback;
	const line = sketch.lines.get(lineId);
	if (!line) return lineId;
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	const len = p1 && p2 ? ` (${p1.distanceTo(p2).toFixed(1)} mm)` : '';
	return `${line.id}${len}`;
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

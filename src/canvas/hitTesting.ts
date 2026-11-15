import { ORIGIN, type Vec2 } from '../math/vector';
import type { GeoCurve } from '../math/intersection';
import type { SketchDocument } from '../model/sketch';
import type {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
	SketchText,
} from '../model/types';
import type { IConstraint } from '../solver/types';
import { LINE_DISTANCE_PX, POINT_DISTANCE_PX } from './distances';
import { isSplineHandleLineVisible } from './snapping';
import type { ToolType } from './tools/types';
import type { Viewport } from './viewport';

export function findClosest<
	T extends {
		distanceTo?(screen: Vec2, sketch: SketchDocument, viewport: Viewport, thresholdPx?: number): number | null;
	},
>(sketch: SketchDocument, viewport: Viewport, items: Iterable<T>, screen: Vec2, thresholdPx: number): T | null {
	let closestDist = thresholdPx;
	let found: T | null = null;
	for (const item of items) {
		if (!item.distanceTo) continue;
		const d = item.distanceTo(screen, sketch, viewport, closestDist);
		if (d !== null && d < closestDist) {
			closestDist = d;
			found = item;
		}
	}
	return found;
}

export function findPointNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = POINT_DISTANCE_PX,
	excludePointId?: string
): SketchPoint | null {
	let closestDist = thresholdPx;
	let foundPoint: SketchPoint | null = null;

	for (const pt of sketch.points.values()) {
		if (excludePointId && pt.id === excludePointId) continue;
		const d = pt.distanceTo(screen, sketch, viewport, closestDist);
		if (d !== null && d < closestDist) {
			closestDist = d;
			foundPoint = pt;
		}
	}

	if (excludePointId !== 'origin') {
		const sOrigin = viewport.worldToScreen(ORIGIN);
		const dOrigin = sOrigin.distanceTo(screen);
		if (dOrigin < closestDist) {
			closestDist = dOrigin;
			foundPoint = { id: 'origin', x: 0, y: 0 } as SketchPoint;
		}
	}

	return foundPoint;
}

export function findAxisNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchLine | null {
	const sOrigin = viewport.worldToScreen(ORIGIN);
	const dAxisX = Math.abs(screen.y - sOrigin.y);
	const dAxisY = Math.abs(screen.x - sOrigin.x);
	if (dAxisX <= thresholdPx && dAxisX <= dAxisY) {
		return sketch.getLine('axis_x') ?? null;
	}
	if (dAxisY <= thresholdPx) {
		return sketch.getLine('axis_y') ?? null;
	}
	return null;
}

export function findLineNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	activeTool: ToolType,
	thresholdPx = LINE_DISTANCE_PX,
	includeAxes = false
): SketchLine | null {
	let closestDist = thresholdPx;
	let foundLine: SketchLine | null = null;

	for (const line of sketch.lines.values()) {
		if (!isSplineHandleLineVisible(sketch, line, activeTool)) {
			continue;
		}
		const d = line.distanceTo(screen, sketch, viewport, closestDist);
		if (d !== null && d < closestDist) {
			closestDist = d;
			foundLine = line;
		}
	}

	if (!foundLine && includeAxes) {
		return findAxisNear(sketch, viewport, screen, thresholdPx);
	}

	return foundLine;
}

export function findCircleNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchCircle | null {
	return findClosest(sketch, viewport, sketch.circles.values(), screen, thresholdPx);
}

export function findArcNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchArc | null {
	return findClosest(sketch, viewport, sketch.arcs.values(), screen, thresholdPx);
}

export function findConstraintNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): IConstraint | null {
	return findClosest(sketch, viewport, sketch.constraints.values(), screen, thresholdPx);
}

export function findEllipseNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchEllipse | null {
	return findClosest(sketch, viewport, sketch.ellipses.values(), screen, thresholdPx);
}

export function findEllipticalArcNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchEllipticalArc | null {
	return findClosest(sketch, viewport, sketch.ellipticalArcs.values(), screen, thresholdPx);
}

export function findSplineNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): SketchSpline | null {
	return findClosest(sketch, viewport, sketch.splines.values(), screen, thresholdPx);
}

export function findTextNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	targetEl?: SVGElement | null
): SketchText | null {
	const textIdFromAttr =
		targetEl?.getAttribute('data-text-id') || targetEl?.closest('[data-text-id]')?.getAttribute('data-text-id');
	if (textIdFromAttr) {
		const t = sketch.texts.get(textIdFromAttr);
		if (t) return t;
	}

	for (const t of sketch.texts.values()) {
		const d = t.distanceTo(screen, sketch, viewport);
		if (d !== null && d <= 15) {
			return t;
		}
	}

	return null;
}

export function findSelectableEntityNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	activeTool: ToolType,
	target?: SVGElement | null
): {
	id: string;
	type: 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'text' | 'constraint';
} | null {
	const hitConstraint = activeTool === 'select' ? findConstraintNear(sketch, viewport, screen) : null;
	if (hitConstraint && !hitConstraint.isInternalConstraint?.(sketch)) {
		return { id: hitConstraint.id, type: 'constraint' };
	}
	const hitLine = findLineNear(sketch, viewport, screen, activeTool);
	if (hitLine) return { id: hitLine.id, type: 'line' };
	const hitCircle = findCircleNear(sketch, viewport, screen);
	if (hitCircle) return { id: hitCircle.id, type: 'circle' };
	const hitArc = findArcNear(sketch, viewport, screen);
	if (hitArc) return { id: hitArc.id, type: 'arc' };
	const hitEllipse = findEllipseNear(sketch, viewport, screen);
	if (hitEllipse) return { id: hitEllipse.id, type: 'ellipse' };
	const hitEllipticalArc = findEllipticalArcNear(sketch, viewport, screen, LINE_DISTANCE_PX);
	if (hitEllipticalArc) return { id: hitEllipticalArc.id, type: 'elliptical_arc' };
	const hitSpline = findSplineNear(sketch, viewport, screen);
	if (hitSpline) return { id: hitSpline.id, type: 'spline' };
	const hitText = findTextNear(sketch, viewport, screen, target);
	if (hitText) return { id: hitText.id, type: 'text' };

	const hitAxis = findAxisNear(sketch, viewport, screen);
	if (hitAxis) {
		return { id: hitAxis.id, type: 'line' };
	}
	return null;
}

export function findTrimTargetNear(
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	thresholdPx = LINE_DISTANCE_PX
): GeoCurve | null {
	let bestDist = thresholdPx;
	let bestCurve: GeoCurve | null = null;

	for (const prim of sketch.getCurvePrimitives()) {
		if (prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
		const d = prim.distanceTo(screen, sketch, viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestCurve = prim.toGeoCurve(sketch);
		}
	}

	return bestCurve;
}

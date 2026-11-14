import type { ToolContext } from './types';
import { ORIGIN, Vec2 } from '../../math/vector';
import { LINE_DISTANCE_PX, POINT_DISTANCE_PX } from '../distances';

export interface HoverTarget {
	type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
	id: string;
}

export interface FindHoverTargetOptions {
	allowSplineHandles?: boolean;
	allowAxes?: boolean;
	allowOrigin?: boolean;
	maxProximityDist?: number;
	pointRadius?: number;
}

export function findHoverTarget(
	ctx: ToolContext,
	screen: Vec2,
	rawTarget?: SVGElement,
	options: FindHoverTargetOptions = {}
): HoverTarget | null {
	const allowSplineHandles = options.allowSplineHandles ?? false;
	const allowAxes = options.allowAxes ?? true;
	const allowOrigin = options.allowOrigin ?? true;
	const pointRadius = options.pointRadius ?? POINT_DISTANCE_PX;
	const maxProximityDist = options.maxProximityDist ?? LINE_DISTANCE_PX;

	// 1. Direct SVG DOM hit test on constraint if rawTarget provided
	if (rawTarget) {
		const targetEl = rawTarget.closest?.('[data-id]') as SVGElement | null;
		if (targetEl) {
			const id = targetEl.getAttribute('data-id');
			const type = targetEl.getAttribute('data-type');
			if (allowOrigin && id === 'origin' && type === 'point') {
				return { type: 'point', id: 'origin' };
			}
			if (allowAxes && (id === 'axis_x' || id === 'axis_y') && type === 'line') {
				return { type: 'line', id };
			}
			if (type === 'constraint' && id && ctx.sketch.constraints.has(id)) {
				const c = ctx.sketch.constraints.get(id);
				if (c && !c.isInternalConstraint?.(ctx.sketch)) {
					return { type: 'constraint', id };
				}
			}
		}
	}

	// 2. Proximity check on constraint badges in SVG DOM
	if (ctx.svg && typeof ctx.svg.querySelectorAll === 'function') {
		for (const badge of Array.from(ctx.svg.querySelectorAll('.constraint-badge[data-id]'))) {
			const rect = badge.querySelector('rect');
			if (!rect) continue;
			const pos = new Vec2(parseFloat(rect.getAttribute('x') || '0'), parseFloat(rect.getAttribute('y') || '0'));
			const bw = parseFloat(rect.getAttribute('width') || '18');
			const bh = parseFloat(rect.getAttribute('height') || '18');
			if (screen.x >= pos.x - 3 && screen.x <= pos.x + bw + 3 && screen.y >= pos.y - 3 && screen.y <= pos.y + bh + 3) {
				const cid = badge.getAttribute('data-id');
				if (cid && ctx.sketch.constraints.has(cid)) {
					const c = ctx.sketch.constraints.get(cid);
					if (c && !c.isInternalConstraint?.(ctx.sketch)) {
						return { type: 'constraint', id: cid };
					}
				}
			}
		}
	}

	// 3. Point priority
	const pt = ctx.findPointNear(screen);
	if (pt && (allowSplineHandles || !ctx.sketch.isSplineHandlePoint(pt.id))) {
		return { type: 'point', id: pt.id };
	}
	const sOrigin = ctx.viewport.worldToScreen(ORIGIN);
	if (allowOrigin && sOrigin.distanceTo(screen) <= pointRadius) {
		return { type: 'point', id: 'origin' };
	}

	// 4. Dimensional constraints vs curve geometry by proximity
	let bestDist = maxProximityDist;
	let bestTarget: HoverTarget | null = null;

	const c = ctx.findConstraintNear?.(screen);
	const line = ctx.findLineNear(screen);
	const validLine =
		line && (allowSplineHandles || (!line.isSplineHandle && !ctx.sketch.isSplineHandleLine(line.id))) ? line : null;

	const candidates: Array<{
		type: HoverTarget['type'];
		item:
			| { id: string; distanceTo?(screen: Vec2, sketch: any, viewport: any, thresholdPx?: number): number | null }
			| null
			| undefined;
	}> = [
		{ type: 'constraint', item: c && !c.isInternalConstraint?.(ctx.sketch) ? c : null },
		{ type: 'line', item: validLine },
		{ type: 'circle', item: ctx.findCircleNear(screen) },
		{ type: 'arc', item: ctx.findArcNear(screen) },
		{ type: 'ellipse', item: ctx.findEllipseNear?.(screen) },
		{ type: 'elliptical_arc', item: ctx.findEllipticalArcNear?.(screen) },
		{ type: 'spline', item: ctx.findSplineNear(screen) },
	];

	for (const { type, item } of candidates) {
		if (!item?.distanceTo) continue;
		const d = item.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type, id: item.id };
		}
	}

	if (allowAxes) {
		const dAxisX = Math.abs(screen.y - sOrigin.y);
		if (dAxisX < bestDist) {
			bestDist = dAxisX;
			bestTarget = { type: 'line', id: 'axis_x' };
		}
		const dAxisY = Math.abs(screen.x - sOrigin.x);
		if (dAxisY < bestDist) {
			bestDist = dAxisY;
			bestTarget = { type: 'line', id: 'axis_y' };
		}
	}

	return bestTarget;
}

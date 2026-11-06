import type { ToolContext } from './types';
import { ORIGIN, vec, type Vec2 } from '../../math/vector';
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
				if (
					c &&
					!ctx.sketch.isSplineInternalConstraint(c) &&
					c.type !== 'arc_endpoints' &&
					c.type !== 'elliptical_arc_endpoints'
				) {
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
			const pos = vec(parseFloat(rect.getAttribute('x') || '0'), parseFloat(rect.getAttribute('y') || '0'));
			const bw = parseFloat(rect.getAttribute('width') || '18');
			const bh = parseFloat(rect.getAttribute('height') || '18');
			if (screen.x >= pos.x - 3 && screen.x <= pos.x + bw + 3 && screen.y >= pos.y - 3 && screen.y <= pos.y + bh + 3) {
				const cid = badge.getAttribute('data-id');
				if (cid && ctx.sketch.constraints.has(cid)) {
					const c = ctx.sketch.constraints.get(cid);
					if (
						c &&
						!ctx.sketch.isSplineInternalConstraint(c) &&
						c.type !== 'arc_endpoints' &&
						c.type !== 'elliptical_arc_endpoints'
					) {
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
	if (allowOrigin && Math.hypot(screen.x - sOrigin.x, screen.y - sOrigin.y) <= pointRadius) {
		return { type: 'point', id: 'origin' };
	}

	// 4. Dimensional constraints vs curve geometry by proximity
	let bestDist = maxProximityDist;
	let bestTarget: HoverTarget | null = null;

	const c = ctx.findConstraintNear?.(screen);
	if (
		c &&
		!ctx.sketch.isSplineInternalConstraint(c) &&
		c.type !== 'arc_endpoints' &&
		c.type !== 'elliptical_arc_endpoints'
	) {
		const d = c.distanceTo ? c.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist) : null;
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'constraint', id: c.id };
		}
	}

	const line = ctx.findLineNear(screen);
	if (line && (allowSplineHandles || (!line.isSplineHandle && !ctx.sketch.isSplineHandleLine(line.id)))) {
		const d = line.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'line', id: line.id };
		}
	}

	const circle = ctx.findCircleNear(screen);
	if (circle) {
		const d = circle.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'circle', id: circle.id };
		}
	}

	const arc = ctx.findArcNear(screen);
	if (arc) {
		const d = arc.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'arc', id: arc.id };
		}
	}

	const ellipse = ctx.findEllipseNear?.(screen);
	if (ellipse) {
		const d = ellipse.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'ellipse', id: ellipse.id };
		}
	}

	const earc = ctx.findEllipticalArcNear?.(screen);
	if (earc) {
		const d = earc.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'elliptical_arc', id: earc.id };
		}
	}

	const spline = ctx.findSplineNear(screen);
	if (spline) {
		const d = spline.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'spline', id: spline.id };
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

	if (bestTarget) {
		return bestTarget;
	}

	return null;
}

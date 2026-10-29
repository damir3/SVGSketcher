import type { ToolContext } from './types';
import type { Vec2 } from '../../math/vector';

export interface HoverTarget {
	type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
	id: string;
}

export interface FindHoverTargetOptions {
	allowSplineHandles?: boolean;
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
	const pointRadius = options.pointRadius ?? 14;
	const maxProximityDist = options.maxProximityDist ?? 18;

	// 1. Direct SVG DOM hit test on constraint if rawTarget provided
	if (rawTarget) {
		const targetEl = rawTarget.closest?.('[data-id]') as SVGElement | null;
		if (targetEl) {
			const id = targetEl.getAttribute('data-id');
			const type = targetEl.getAttribute('data-type');
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
			const bx = parseFloat(rect.getAttribute('x') || '0');
			const by = parseFloat(rect.getAttribute('y') || '0');
			const bw = parseFloat(rect.getAttribute('width') || '18');
			const bh = parseFloat(rect.getAttribute('height') || '18');
			if (screen.x >= bx - 3 && screen.x <= bx + bw + 3 && screen.y >= by - 3 && screen.y <= by + bh + 3) {
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
	const pt = ctx.findPointNear(screen, pointRadius);
	if (pt && (allowSplineHandles || !ctx.sketch.isSplineHandlePoint(pt.id))) {
		return { type: 'point', id: pt.id };
	}

	// 4. Dimensional constraints vs curve geometry by proximity
	let bestDist = maxProximityDist;
	let bestTarget: HoverTarget | null = null;

	const c = ctx.findConstraintNear?.(screen, bestDist);
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

	const line = ctx.findLineNear(screen, bestDist);
	if (line && (allowSplineHandles || (!line.isSplineHandle && !ctx.sketch.isSplineHandleLine(line.id)))) {
		const d = line.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'line', id: line.id };
		}
	}

	const circle = ctx.findCircleNear(screen, bestDist);
	if (circle) {
		const d = circle.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'circle', id: circle.id };
		}
	}

	const arc = ctx.findArcNear(screen, bestDist);
	if (arc) {
		const d = arc.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'arc', id: arc.id };
		}
	}

	const ellipse = ctx.findEllipseNear?.(screen, bestDist);
	if (ellipse) {
		const d = ellipse.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'ellipse', id: ellipse.id };
		}
	}

	const earc = ctx.findEllipticalArcNear?.(screen, bestDist);
	if (earc) {
		const d = earc.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'elliptical_arc', id: earc.id };
		}
	}

	const spline = ctx.findSplineNear(screen, bestDist);
	if (spline) {
		const d = spline.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestTarget = { type: 'spline', id: spline.id };
		}
	}

	if (bestTarget) {
		return bestTarget;
	}

	// 5. Fallback: direct SVG DOM hit test on primitives/entities
	if (rawTarget) {
		const targetEl = rawTarget.closest?.('[data-id]') as SVGElement | null;
		if (targetEl) {
			const id = targetEl.getAttribute('data-id');
			const type = targetEl.getAttribute('data-type') as HoverTarget['type'] | null;
			if (id && type) {
				return { type, id };
			}
		}
	}

	return null;
}

import {
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
	type ISketchPrimitive,
	type PrimitiveSnapCandidate,
} from '../model/types';
import type { SketchDocument } from '../model/sketch';
import type { GeoCurve } from '../math/intersection';
import type { QueryCurve } from '../kernel/queryTypes';
import { getQueryKernel } from '../math/queries';
import { Vec2 } from '../math/vector';
import type { Viewport } from './viewport';

const classes = [SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc, SketchSpline];
/** Preserve polymorphic behavior for extensions and overridden primitive methods. */
export function canBatchQuery(
	item: unknown,
	method: 'distanceTo' | 'snapTo' | 'intersectsAABB'
): item is ISketchPrimitive {
	return classes.some(
		cls => item instanceof cls && item[method] === cls.prototype[method] && item.toGeoCurve === cls.prototype.toGeoCurve
	);
}

export function screenQueryCurve(curve: GeoCurve, viewport: Viewport): QueryCurve {
	const p = (v: Vec2) => viewport.worldToScreen(v);
	switch (curve.type) {
		case 'segment':
			return { ...curve, p1: p(curve.p1), p2: p(curve.p2) };
		case 'circle':
			return { ...curve, center: p(curve.center), radius: curve.radius * viewport.zoom };
		case 'arc':
			return {
				...curve,
				center: p(curve.center),
				radius: curve.radius * viewport.zoom,
				start: p(curve.start),
				end: p(curve.end),
			};
		case 'ellipse':
			return {
				...curve,
				center: p(curve.center),
				majorAxisPoint: p(curve.majorAxisPoint),
				minorAxisPoint: p(curve.minorAxisPoint),
			};
		case 'elliptical_arc':
			return {
				...curve,
				center: p(curve.center),
				majorAxisPoint: p(curve.majorAxisPoint),
				minorAxisPoint: p(curve.minorAxisPoint),
				start: p(curve.start),
				end: p(curve.end),
			};
		case 'spline':
			return { ...curve, bezierSegments: curve.bezierSegments.map(b => [p(b[0]), p(b[1]), p(b[2]), p(b[3])]) };
	}
}

export function closestPrimitive<T>(
	items: readonly T[],
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	threshold: number
): T | null | undefined {
	if (!items.every(item => canBatchQuery(item, 'distanceTo'))) return undefined;
	const entries = (items as (T & ISketchPrimitive)[]).flatMap(item => {
		const curve = item.toGeoCurve(sketch);
		return curve ? [{ item, curve: screenQueryCurve(curve, viewport) }] : [];
	});
	if (!entries.length) return null;
	const hit = getQueryKernel().closest(
		entries.map(e => e.curve),
		screen,
		threshold
	);
	return hit ? entries[hit.index].item : null;
}

export function snapPrimitives(
	items: readonly ISketchPrimitive[],
	sketch: SketchDocument,
	viewport: Viewport,
	screen: Vec2,
	threshold: number
): PrimitiveSnapCandidate | null {
	if (!items.every(item => canBatchQuery(item, 'snapTo'))) {
		let best: PrimitiveSnapCandidate | null = null,
			max = threshold;
		for (const item of items) {
			const snap = item.snapTo(screen, sketch, viewport, max, threshold);
			if (snap && snap.dist < max) {
				best = snap;
				max = snap.dist;
			}
		}
		return best;
	}
	const entries = items.flatMap(item => {
		const world = item.toGeoCurve(sketch);
		return world ? [{ item, world, screen: screenQueryCurve(world, viewport) }] : [];
	});
	if (!entries.length) return null;
	const snap = getQueryKernel().closest(
		entries.map(e => e.screen),
		screen,
		threshold,
		true,
		threshold
	);
	if (!snap?.point) return null;
	const { item, world } = entries[snap.index],
		screenPos = Vec2.from(snap.point);
	return {
		type:
			item.type === 'arc'
				? 'circle'
				: item.type === 'elliptical_arc'
					? 'ellipse'
					: (item.type as PrimitiveSnapCandidate['type']),
		id: item.id,
		dist: snap.distance,
		screenPos,
		worldPos:
			world.type === 'segment' ? world.p1.clone().lerp(world.p2, snap.param!) : viewport.screenToWorld(screenPos),
	};
}

import type { OffsetKernelItem } from '../kernel/offsetTypes';
import { getSplinePointAtParam, type BezierSegment } from './splineReference';
import { Vec2 } from './vector';

function samples(item: OffsetKernelItem): Vec2[] {
	const c = item.curve;
	if (!c) return [];
	if (c.type === 'segment') return [Vec2.from(c.p1), Vec2.from(c.p2)];
	if (c.type === 'spline') {
		if (!c.bezierSegments.length) return [];
		const curves = c.bezierSegments.map(b => b.map(Vec2.from) as BezierSegment),
			count = Math.min(8192, Math.max(512, curves.length * 256));
		return Array.from({ length: count + 1 }, (_, i) =>
			getSplinePointAtParam(curves, item.reversed ? 1 - i / count : i / count)
		);
	}
	if (c.type === 'arc' || c.type === 'circle') {
		const center = Vec2.from(c.center),
			start = c.type === 'arc' ? center.angleToPoint(c.start) : 0;
		let span =
			c.type === 'arc'
				? c.clockwise
					? start - center.angleToPoint(c.end)
					: center.angleToPoint(c.end) - start
				: 2 * Math.PI;
		while (span < 0) span += 2 * Math.PI;
		return Array.from({ length: 513 }, (_, i) =>
			Vec2.fromPolar(c.radius, start + ((c.type === 'arc' && c.clockwise ? -1 : 1) * span * i) / 512).add(center)
		);
	}
	const center = Vec2.from(c.center),
		major = Vec2.from(c.majorAxisPoint).sub(center),
		a = major.length(),
		b = Vec2.from(c.minorAxisPoint).distanceTo(center),
		u = major.normalizeOrUnitX(),
		v = u.clone().perpendicular();
	const parameter = (p: { x: number; y: number }) => {
		const q = Vec2.from(p).sub(center);
		return Math.atan2(q.dot(v) / b, q.dot(u) / a);
	};
	const start = c.type === 'elliptical_arc' ? parameter(c.start) : 0;
	let span =
		c.type === 'elliptical_arc' ? (c.clockwise ? start - parameter(c.end) : parameter(c.end) - start) : 2 * Math.PI;
	while (span < 0) span += 2 * Math.PI;
	return Array.from({ length: 1025 }, (_, i) => {
		const t = start + ((c.type === 'elliptical_arc' && c.clockwise ? -1 : 1) * span * i) / 1024;
		return center
			.clone()
			.addScaledVector(u, a * Math.cos(t))
			.addScaledVector(v, b * Math.sin(t));
	});
}
interface Cell {
	x: number;
	y: number;
	hx: number;
	hy: number;
	upper: number;
}

// Bound constant-width medial ridges without subdividing their entire length
// down to the numerical tolerance (parallel lines and concentric circular arcs).
function narrowBands(
	items: readonly OffsetKernelItem[],
	radius: number,
	tolerance: number
): ((cell: Cell) => boolean)[] {
	const bands: ((cell: Cell) => boolean)[] = [];
	for (let i = 0; i < items.length; i++)
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i].curve,
				b = items[j].curve;
			if (a?.type === 'segment' && b?.type === 'segment') {
				const av = Vec2.from(a.p2).sub(a.p1),
					bv = Vec2.from(b.p2).sub(b.p1),
					al = av.length(),
					bl = bv.length();
				if (al < 1e-9 || bl < 1e-9) continue;
				const u = av.divideScalar(al),
					v = bv.divideScalar(bl),
					n = u.clone().perpendicular();
				if (Math.abs(u.cross(v)) > 1e-10 || u.dot(v) > -1 + 1e-10) continue;
				const offset = Vec2.from(b.p1).sub(a.p1).dot(n),
					lo = Math.min(0, offset),
					hi = Math.max(0, offset);
				if ((hi - lo) / 2 > radius + tolerance) continue;
				bands.push(c => {
					const s = (c.x - a.p1.x) * n.x + (c.y - a.p1.y) * n.y,
						extent = Math.abs(n.x) * c.hx + Math.abs(n.y) * c.hy;
					if (s - extent < lo - 1e-9 || s + extent > hi + 1e-9) return false;
					const covers = (p: { x: number; y: number }, dir: Vec2, len: number) => {
						const t = (c.x - p.x) * dir.x + (c.y - p.y) * dir.y,
							spread = Math.abs(dir.x) * c.hx + Math.abs(dir.y) * c.hy;
						return t - spread >= -1e-9 && t + spread <= len + 1e-9;
					};
					return covers(a.p1, u, al) && covers(b.p1, v, bl);
				});
			} else if (
				a?.type === 'arc' &&
				b?.type === 'arc' &&
				a.clockwise !== b.clockwise &&
				Vec2.from(a.center).distanceTo(b.center) < 1e-9
			) {
				const low = Math.min(a.radius, b.radius),
					high = Math.max(a.radius, b.radius);
				if ((high - low) / 2 > radius + tolerance) continue;
				bands.push(c => {
					const dx = c.x - a.center.x,
						dy = c.y - a.center.y,
						centerDistance = Math.hypot(dx, dy),
						diagonal = Math.hypot(c.hx, c.hy);
					if (
						centerDistance <= diagonal ||
						Math.hypot(Math.max(0, Math.abs(dx) - c.hx), Math.max(0, Math.abs(dy) - c.hy)) < low - 1e-9 ||
						Math.hypot(Math.abs(dx) + c.hx, Math.abs(dy) + c.hy) > high + 1e-9
					)
						return false;
					const angle = Math.atan2(dy, dx),
						margin = Math.asin(Math.min(1, diagonal / centerDistance));
					return [a, b].every(arc => {
						const begin = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x),
							end = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x);
						let span = arc.clockwise ? begin - end : end - begin,
							t = arc.clockwise ? begin - angle : angle - begin;
						while (span < 0) span += 2 * Math.PI;
						while (t < 0) t += 2 * Math.PI;
						return t >= margin - 1e-9 && t + margin <= span + 1e-9;
					});
				});
			}
		}
	return bands;
}

/** Whether erosion has no two-dimensional interior left. Only closed inward offsets call this. */
export function isOffsetCollapsed(items: readonly OffsetKernelItem[], radius: number): boolean {
	if (!items.length || radius <= 0 || items.some(i => !i.curve)) return false;
	const single = items.length === 1 ? items[0].curve : null;
	if (single?.type === 'circle') return radius >= single.radius;
	if (single?.type === 'ellipse')
		return (
			radius >=
			Math.min(
				Vec2.from(single.majorAxisPoint).distanceTo(single.center),
				Vec2.from(single.minorAxisPoint).distanceTo(single.center)
			)
		);
	const parts = items.map(samples);
	if (parts.some(points => points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
		return false;
	const polygon = parts.flatMap(points => points.slice(0, -1));
	if (polygon.length < 3) return false;
	const [minX, maxX, minY, maxY] = polygon.reduce(
		(b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.y), Math.max(b[3], p.y)],
		[Infinity, -Infinity, Infinity, -Infinity]
	);
	const width = maxX - minX,
		height = maxY - minY,
		tolerance = Math.max(1e-5, Math.max(width, height) * 1e-7);
	if (radius >= Math.min(width, height) / 2 - tolerance) return true;
	const bands = narrowBands(items, radius, tolerance);
	const clearance = (x: number, y: number) => {
		let inside = false,
			closest = Infinity;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
			const a = polygon[j],
				b = polygon[i],
				dx = b.x - a.x,
				dy = b.y - a.y,
				len = dx * dx + dy * dy;
			const t = len > 1e-20 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
			closest = Math.min(closest, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
			if (a.y > y !== b.y > y && x < (dx * (y - a.y)) / dy + a.x) inside = !inside;
		}
		return Math.sqrt(closest) * (inside ? 1 : -1);
	};
	// A signed distance is 1-Lipschitz, so the center distance plus cell radius
	// bounds the clearance everywhere in that cell. Visit the largest bound first.
	const heap: Cell[] = [];
	const push = (cell: Cell) => {
		let i = heap.length;
		heap.push(cell);
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (heap[parent].upper >= cell.upper) break;
			heap[i] = heap[parent];
			i = parent;
		}
		heap[i] = cell;
	};
	const pop = () => {
		const top = heap[0],
			tail = heap.pop()!;
		if (heap.length) {
			let i = 0;
			for (;;) {
				let child = 2 * i + 1;
				if (child >= heap.length) break;
				if (child + 1 < heap.length && heap[child + 1].upper > heap[child].upper) child++;
				if (heap[child].upper <= tail.upper) break;
				heap[i] = heap[child];
				i = child;
			}
			heap[i] = tail;
		}
		return top;
	};
	const add = (x: number, y: number, hx: number, hy: number) => {
		if (bands.some(covers => covers({ x, y, hx, hy, upper: 0 }))) return false;
		const distance = clearance(x, y);
		if (distance > radius + tolerance) return true;
		const upper = distance + Math.hypot(hx, hy);
		if (upper > radius + tolerance) push({ x, y, hx, hy, upper });
		return false;
	};
	if (add((minX + maxX) / 2, (minY + maxY) / 2, width / 2, height / 2)) return false;
	while (heap.length) {
		const c = pop();
		if (c.hx >= c.hy) {
			const h = c.hx / 2;
			if (add(c.x - h, c.y, h, c.hy) || add(c.x + h, c.y, h, c.hy)) return false;
		} else {
			const h = c.hy / 2;
			if (add(c.x, c.y - h, c.hx, h) || add(c.x, c.y + h, c.hx, h)) return false;
		}
	}
	return true;
}

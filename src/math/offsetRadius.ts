import {
	MIN_OFFSET_RADIUS,
	supportedOffsetRadius,
	type OffsetKernelItem,
	type KernelOffsetPrimitive,
	type KernelOffsetResult,
	type KernelOffsetSide,
} from '../kernel/offsetTypes';
import { Vec2 } from './vector';
import { getSplinePointAtParam, type BezierSegment } from './splineReference';
import { arcNode } from './offsetContours';

export function offsetSourceCounterClockwise(items: readonly OffsetKernelItem[]): boolean {
	const points = items.flatMap(item => {
		const c = item.curve;
		if (!c) return [];
		if (c.type === 'segment') return [Vec2.from(c.p1)];
		if (c.type === 'arc')
			return Array.from(
				{ length: 4 },
				(_, i) =>
					arcNode(
						{
							sourceId: item.sourceId,
							type: 'arc',
							center: c.center,
							start: c.start,
							end: c.end,
							radius: c.radius,
							clockwise: c.clockwise,
						},
						i / 4
					).p
			);
		if (c.type === 'spline') {
			const curves = c.bezierSegments.map(b => b.map(Vec2.from) as BezierSegment);
			return Array.from({ length: 4 }, (_, i) => getSplinePointAtParam(curves, item.reversed ? 1 - i / 4 : i / 4));
		}
		if (c.type === 'circle')
			return Array.from({ length: 4 }, (_, i) => Vec2.fromPolar(c.radius, (i * Math.PI) / 2).add(c.center));
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
		return Array.from({ length: 4 }, (_, i) => {
			const t = start + ((c.type === 'elliptical_arc' && c.clockwise ? -1 : 1) * span * i) / 4;
			return center
				.clone()
				.addScaledVector(u, a * Math.cos(t))
				.addScaledVector(v, b * Math.sin(t));
		});
	});
	return points.reduce((s, p, i) => s + p.cross(points[(i + 1) % points.length]), 0) > 0;
}

const start = (p: KernelOffsetPrimitive) => Vec2.from(p.p1 ?? p.start ?? p.fitPoints![0]);
const end = (p: KernelOffsetPrimitive) => Vec2.from(p.p2 ?? p.end ?? p.fitPoints!.at(-1)!);
function setEnd(p: KernelOffsetPrimitive, q: Vec2, first: boolean): void {
	if (p.type === 'line') {
		if (first) p.p1 = q;
		else p.p2 = q;
	} else if (p.type === 'arc') {
		if (first) p.start = q;
		else p.end = q;
	} else p.fitPoints![first ? 0 : p.fitPoints!.length - 1] = q;
}
function lines(a: Vec2, u: Vec2, b: Vec2, v: Vec2): Vec2 | undefined {
	const det = u.cross(v);
	return Math.abs(det) < 1e-7 ? undefined : a.clone().addScaledVector(u, b.clone().sub(a).cross(v) / det);
}
function lineCircle(a: Vec2, u: Vec2, arc: KernelOffsetPrimitive, near: Vec2): Vec2 | undefined {
	const c = Vec2.from(arc.center!),
		t = c.clone().sub(a).dot(u),
		foot = a.clone().addScaledVector(u, t),
		d2 = foot.distanceToSquared(c),
		r = arc.radius!;
	if (d2 > r * r) return;
	const dt = Math.sqrt(Math.max(0, r * r - d2)),
		p = a.clone().addScaledVector(u, t - dt),
		q = a.clone().addScaledVector(u, t + dt);
	return p.distanceTo(near) < q.distanceTo(near) ? p : q;
}
// Reproduce the legacy endpoint joins before the shared contour refinement.
function join(
	a: KernelOffsetPrimitive,
	b: KernelOffsetPrimitive,
	dirs: Map<string, Vec2>,
	d: number
): Vec2 | undefined {
	const ae = end(a),
		bs = start(b);
	if (a.type === 'line' && b.type === 'line') return lines(start(a), dirs.get(a.sourceId)!, bs, dirs.get(b.sourceId)!);
	if (a.type === 'line' && b.type === 'arc') return lineCircle(start(a), dirs.get(a.sourceId)!, b, ae);
	if (a.type === 'arc' && b.type === 'line') return lineCircle(bs, dirs.get(b.sourceId)!, a, ae);
	if ((a.type === 'line' && b.type === 'spline') || (a.type === 'spline' && b.type === 'line')) {
		const p =
			a.type === 'line'
				? lines(start(a), dirs.get(a.sourceId)!, bs, Vec2.from(b.startTangent!))
				: lines(bs, dirs.get(b.sourceId)!, ae, Vec2.from(a.endTangent!));
		return p && p.distanceTo(a.type === 'line' ? ae : bs) <= 4 * Math.abs(d) ? p : ae.midpoint(ae, bs);
	}
	if (a.type === 'arc' && b.type === 'spline')
		return lineCircle(bs, Vec2.from(b.startTangent!), a, ae) ?? ae.midpoint(ae, bs);
	if (a.type === 'spline' && b.type === 'arc')
		return lineCircle(ae, Vec2.from(a.endTangent!), b, bs) ?? ae.midpoint(ae, bs);
	return ae.midpoint(ae, bs);
}

function arcContains(center: Vec2, startPt: Vec2, endPt: Vec2, cw: boolean, p: Vec2): boolean {
	const a = center.angleToPoint(startPt),
		b = center.angleToPoint(endPt),
		t = center.angleToPoint(p),
		tau = Math.PI * 2;
	const sweep = (u: number, v: number) => {
		let s = cw ? u - v : v - u;
		while (s < 0) s += tau;
		return s;
	};
	return sweep(a, t) <= sweep(a, b) + 1e-7;
}
function joinArcsValid(a: KernelOffsetPrimitive, b: KernelOffsetPrimitive, d: number, vertex?: Vec2): Vec2 | undefined {
	if (a.type !== 'arc' || b.type !== 'arc') return undefined;
	const aEnd = Vec2.from(a.end!),
		bStart = Vec2.from(b.start!);
	if (aEnd.distanceTo(bStart) < 1e-8) return aEnd.midpoint(aEnd, bStart);
	const c = Vec2.from(a.center!),
		qCenter = Vec2.from(b.center!),
		delta = qCenter.clone().sub(c),
		distance = Math.sqrt(delta.lengthSq()),
		r = a.radius!,
		s = b.radius!;
	if (distance < 1e-12 || distance > r + s + 1e-8 || distance < Math.abs(r - s) - 1e-8) return undefined;
	const x = (r * r - s * s + distance * distance) / (2 * distance),
		height = Math.sqrt(Math.max(0, r * r - x * x)),
		u = delta.divideScalar(distance),
		mid = c.clone().addScaledVector(u, x),
		normal = u.clone().perpendicular(),
		near = new Vec2().midpoint(aEnd, bStart),
		p = mid.clone().addScaledVector(normal, height),
		q = mid.clone().addScaledVector(normal, -height),
		hit = p.distanceToSquared(near) < q.distanceToSquared(near) ? p : q;
	if (
		arcContains(c, Vec2.from(a.start!), aEnd, !!a.clockwise, hit) &&
		arcContains(qCenter, bStart, Vec2.from(b.end!), !!b.clockwise, hit)
	) {
		return hit;
	}
	if (vertex && vertex.distanceTo(hit) > 2.5 * Math.abs(d)) return undefined;
	return hit;
}
function sourceEnd(item: OffsetKernelItem): Vec2 | undefined {
	const c = item.curve;
	if (c?.type === 'segment') return Vec2.from(c.p2);
	if (c?.type === 'arc') return Vec2.from(c.end);
	return undefined;
}
function sourceStart(item: OffsetKernelItem): Vec2 | undefined {
	const c = item.curve;
	if (c?.type === 'segment') return Vec2.from(c.p1);
	if (c?.type === 'arc') return Vec2.from(c.start);
	return undefined;
}
function untrimmedEnds(
	item: OffsetKernelItem,
	prim: KernelOffsetPrimitive,
	d: number,
	ccw: boolean
): [Vec2, Vec2] | undefined {
	const c = item.curve;
	if (c?.type === 'segment' && prim.type === 'line') {
		const t = Vec2.from(c.p2).sub(c.p1).normalizeOrUnitX(),
			n = t
				.clone()
				.perpendicular()
				.multiplyScalar(ccw ? -1 : 1);
		return [Vec2.from(c.p1).addScaledVector(n, d), Vec2.from(c.p2).addScaledVector(n, d)];
	}
	if (c?.type === 'arc' && prim.type === 'arc') {
		const center = Vec2.from(prim.center!),
			r = prim.radius!;
		return [
			center.clone().addScaledVector(Vec2.from(c.start).sub(center).normalizeOrUnitX(), r),
			center.clone().addScaledVector(Vec2.from(c.end).sub(center).normalizeOrUnitX(), r),
		];
	}
	return undefined;
}

/** Recover radius cases rejected by the frozen pre-migration reference. */
export function recoverOffsetRadii(
	items: readonly OffsetKernelItem[],
	closed: boolean,
	result: KernelOffsetResult,
	zero: () => KernelOffsetSide
): KernelOffsetResult {
	let base: KernelOffsetSide | undefined;
	for (const side of result.sides) {
		if (
			side.isValid ||
			!['Offset collapses arc radius', 'Offset distance exceeds circle radius'].includes(side.errorMessage!)
		)
			continue;
		const d = side.distance;
		if (items.length === 1 && items[0].curve?.type === 'circle') {
			const c = items[0].curve,
				radius = c.radius + d;
			if (!supportedOffsetRadius(radius)) continue;
			side.primitives = [
				{
					sourceId: items[0].sourceId,
					type: 'circle',
					circleCenter: c.center,
					circleRadius: Math.max(MIN_OFFSET_RADIUS, radius),
				},
			];
		} else {
			base ??= zero();
			if (!base.isValid || base.primitives.length !== items.length) continue;
			const ccw = offsetSourceCounterClockwise(items),
				dirs = new Map<string, Vec2>(),
				primitives: KernelOffsetPrimitive[] = [];
			for (let i = 0; i < items.length; i++) {
				const item = items[i],
					c = item.curve;
				if (!c) break;
				const seed = base.primitives[i];
				if (c.type === 'segment') {
					const t = Vec2.from(c.p2).sub(c.p1).normalizeOrUnitX(),
						n = t
							.clone()
							.perpendicular()
							.multiplyScalar(closed && ccw ? -1 : 1);
					dirs.set(item.sourceId, t);
					primitives.push({
						sourceId: item.sourceId,
						type: 'line',
						p1: Vec2.from(c.p1).addScaledVector(n, d),
						p2: Vec2.from(c.p2).addScaledVector(n, d),
					});
				} else if (c.type === 'arc') {
					const center = Vec2.from(c.center),
						radius = c.radius + d * (closed ? (ccw !== !!c.clockwise ? 1 : -1) : c.clockwise ? 1 : -1);
					const consumed = closed && d < 0 && radius <= 0;
					if (!consumed && !supportedOffsetRadius(radius)) break;
					const r = consumed ? radius : Math.max(MIN_OFFSET_RADIUS, radius),
						a = center.clone().addScaledVector(Vec2.from(c.start).sub(center).normalizeOrUnitX(), r),
						b = center.clone().addScaledVector(Vec2.from(c.end).sub(center).normalizeOrUnitX(), r);
					primitives.push(
						consumed
							? { sourceId: item.sourceId, type: 'line', p1: a, p2: b }
							: { sourceId: item.sourceId, type: 'arc', center, start: a, end: b, radius: r, clockwise: !!c.clockwise }
					);
				} else if (seed.fitBases && seed.fitNormals) {
					primitives.push({
						...seed,
						fitPoints: seed.fitBases.map((p, j) => Vec2.from(p).addScaledVector(seed.fitNormals![j], d)),
					});
				} else break;
			}
			if (primitives.length !== items.length) continue;
			const consumed = (i: number) => items[i].kind === 'arc' && primitives[i].type === 'line';
			for (let i = 0; i < (closed ? items.length : items.length - 1); i++) {
				const j = (i + 1) % items.length;
				if (consumed(i) || consumed(j)) continue;
				const a = primitives[i],
					b = primitives[j];
				if (
					closed &&
					((a.type === 'arc' && b.type === 'arc') ||
						(a.type === 'line' && b.type === 'arc') ||
						(a.type === 'arc' && b.type === 'line'))
				) {
					const se = sourceEnd(items[i]),
						ss = sourceStart(items[j]),
						vertex = se && ss ? se.midpoint(se, ss) : (se ?? ss);
					const p = a.type === 'arc' && b.type === 'arc' ? joinArcsValid(a, b, d, vertex) : join(a, b, dirs, d);
					if (p) {
						setEnd(a, p, false);
						setEnd(b, p, true);
					}
					continue;
				}
				const p = join(a, b, dirs, d);
				if (p) {
					setEnd(a, p, false);
					setEnd(b, p, true);
				}
			}
			side.primitives = primitives;
		}
		side.side = d < 0 ? -1 : 1;
		side.distance = Math.abs(d);
		side.isValid = true;
		delete side.errorMessage;
	}
	if (closed)
		for (const side of result.sides) {
			if (!side.isValid || side.primitives.length !== items.length) continue;
			const d = side.side * side.distance;
			if (Math.abs(d) <= 1e-12) continue;
			const ccw = offsetSourceCounterClockwise(items);
			const rawEnds = items.map((it, i) => untrimmedEnds(it, side.primitives[i], d, ccw));
			const dirs = new Map<string, Vec2>();
			for (const it of items) {
				if (it.curve?.type === 'segment')
					dirs.set(it.sourceId, Vec2.from(it.curve.p2).sub(it.curve.p1).normalizeOrUnitX());
			}
			for (let i = 0; i < side.primitives.length; i++) {
				const j = (i + 1) % side.primitives.length;
				if (i === j) continue;
				const a = side.primitives[i],
					b = side.primitives[j];
				if ((items[i].kind === 'arc' && a.type === 'line') || (items[j].kind === 'arc' && b.type === 'line')) continue;
				const ra = rawEnds[i],
					rb = rawEnds[j];
				if (!ra || !rb) continue;
				const se = sourceEnd(items[i]),
					ss = sourceStart(items[j]),
					vertex = se && ss ? se.midpoint(se, ss) : (se ?? ss);
				if (a.type === 'arc' && b.type === 'arc') {
					const tmpA: KernelOffsetPrimitive = { ...a, start: ra[0], end: ra[1] };
					const tmpB: KernelOffsetPrimitive = { ...b, start: rb[0], end: rb[1] };
					const hit = joinArcsValid(tmpA, tmpB, d, vertex);
					if (hit) {
						a.end = hit;
						b.start = hit;
					} else {
						a.end = ra[1];
						b.start = rb[0];
					}
				} else if ((a.type === 'line' && b.type === 'arc') || (a.type === 'arc' && b.type === 'line')) {
					const tmpA: KernelOffsetPrimitive =
						a.type === 'line' ? { ...a, p1: ra[0], p2: ra[1] } : { ...a, start: ra[0], end: ra[1] };
					const tmpB: KernelOffsetPrimitive =
						b.type === 'line' ? { ...b, p1: rb[0], p2: rb[1] } : { ...b, start: rb[0], end: rb[1] };
					const hit =
						tmpA.type === 'line'
							? lineCircle(Vec2.from(tmpA.p1!), dirs.get(tmpA.sourceId)!, tmpB, Vec2.from(tmpA.p2!))
							: lineCircle(Vec2.from(tmpB.p1!), dirs.get(tmpB.sourceId)!, tmpA, Vec2.from(tmpA.end!));
					if (!hit) {
						setEnd(a, ra[1], false);
						setEnd(b, rb[0], true);
					}
				}
			}
		}
	return result;
}

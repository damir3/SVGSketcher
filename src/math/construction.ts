import { getGeometryKernel } from '../kernel';
import type { ConstructionMode } from '../kernel/constructionTypes';
import { Vec2, type XY } from './vector';
const coords = (...points: readonly XY[]) => points.flatMap(p => [p.x, p.y]);
const query = (mode: ConstructionMode, data: readonly number[]) => {
	const api = getGeometryKernel().construction;
	if (!api) throw new Error('Primitive construction requires the Rust/WASM kernel');
	return api(mode, data);
};
const required = (mode: ConstructionMode, data: readonly number[]) => {
	const out = query(mode, data);
	if (!out) throw new Error('Degenerate construction');
	return out;
};
const p = (d: readonly number[], i = 0) => new Vec2(d[i], d[i + 1]);
const circle = (d: number[] | null) => (d ? { center: p(d), radius: d[2] } : null);
const arc = (d: number[] | null) => (d ? { center: p(d), radius: d[2], clockwise: !!d[3], sweepAngle: d[4] } : null);
export type ConstructionLine = { p: XY; n: XY };
const lines = (items: readonly ConstructionLine[]) => items.flatMap(l => coords(l.p, l.n));
export function circumcircle(a: XY, b: XY, c: XY) {
	return circle(query('circumcircle', coords(a, b, c)));
}
export function circlePreview(a: XY, b: XY, cursor: XY) {
	return circle(query('circle_preview', coords(a, b, cursor)));
}
export function circleChord(a: XY, b: XY, cursor: XY, diameter: number) {
	return circle(query('circle_chord', [...coords(a, b, cursor), diameter]));
}
export function lineIntersection(a: ConstructionLine, b: ConstructionLine, oa = 0, ob = 0) {
	const d = query('line_intersection', [...lines([a, b]), oa, ob]);
	return d ? p(d) : null;
}
export function circleTwoTangent(a: ConstructionLine, b: ConstructionLine, cursor: XY, radius?: number) {
	return circle(
		query(radius === undefined ? 'circle_two_tangent' : 'circle_two_tangent_radius', [
			...lines([a, b]),
			...coords(cursor),
			...(radius === undefined ? [] : [radius]),
		])
	);
}
export function circleThreeTangent(items: readonly ConstructionLine[]) {
	return circle(query('circle_three_tangent', lines(items)));
}
export interface ArcLocks {
	radius?: number;
	angle?: number;
}
export function arcThreePoint(start: XY, end: XY, cursor: XY, locks: ArcLocks, orientation: number) {
	return arc(
		query('arc_three_point', [
			...coords(start, end, cursor),
			Number(locks.radius !== undefined),
			locks.radius ?? 0,
			Number(locks.angle !== undefined),
			locks.angle ?? 0,
			orientation,
		])
	);
}
export function arcTangent(start: XY, cursor: XY, tangent: XY, locks: ArcLocks, orientation: number) {
	const d = query('arc_tangent', [
		...coords(start, cursor, tangent),
		Number(locks.radius !== undefined),
		locks.radius ?? 0,
		Number(locks.angle !== undefined),
		locks.angle ?? 0,
		orientation,
	]);
	return d ? { ...arc(d)!, end: p(d, 5) } : null;
}
export function arcCenter(
	center: XY,
	start: XY,
	cursor: XY,
	totalAngle: number,
	lockedAngle: number | undefined,
	orientation: number
) {
	const d = required('arc_center', [...coords(center, start, cursor), totalAngle, lockedAngle ?? -1, orientation]);
	return { end: p(d), radius: d[2], clockwise: !!d[3], sweep: d[4] };
}
export function slotCenters(a: XY, b: XY, radius: number, mode: number) {
	const d = required('slot_centers', [...coords(a, b), radius, mode]);
	return {
		c1: mode === 0 && a instanceof Vec2 ? a : p(d),
		c2: mode < 2 && b instanceof Vec2 ? b : p(d, 2),
		u: p(d, 4),
		n: p(d, 6),
		effectiveR: d[8],
	};
}
export function slotOutline(a: XY, b: XY, u: XY, n: XY, radius: number) {
	const d = required('slot_outline', [...coords(a, b, u, n), radius]);
	return { pt1: p(d), pt2: p(d, 2), pt3: p(d, 4), pt4: p(d, 6) };
}
export function slotRadius(a: XY, b: XY, cursor: XY, mode: number, radius: number) {
	return required('slot_radius', [...coords(a, b, cursor), mode, radius])[0];
}
export function arcSlot(center: XY, a: XY, b: XY, radius: number, sign: number, slotRadius: number) {
	const d = required('arc_slot', [...coords(center, a, b), radius, sign, slotRadius]);
	return {
		effectiveR: d[0],
		p1Inner: p(d, 1),
		p1Outer: p(d, 3),
		p2Inner: p(d, 5),
		p2Outer: p(d, 7),
		midCenterArc: p(d, 9),
		midOuterArc: p(d, 11),
		midInnerArc: p(d, 13),
		midCap1: p(d, 15),
		midCap2: p(d, 17),
	};
}
export function arcSlotRadius(center: XY, cursor: XY, radius: number) {
	return required('arc_slot_radius', [...coords(center, cursor), radius])[0];
}
export function polygonEdge(a: XY, b: XY, sides: number, reversed: boolean) {
	const d = required('polygon_edge', [...coords(a, b), sides, Number(reversed)]);
	return { center: p(d), radius: d[2], angle: d[3] };
}
export function polygonVertices(center: XY, radius: number, sides: number, angle: number, toVertex: boolean) {
	const d = required('polygon_vertices', [
		...coords(center),
		radius,
		Math.max(3, Math.round(sides)),
		angle,
		Number(toVertex),
	]);
	return Array.from({ length: d.length / 2 }, (_, i) => p(d, i * 2));
}
export function pointAtDistance(start: XY, toward: XY, distance: number, tolerance = 0) {
	return p(required('point_at_distance', [...coords(start, toward), distance, tolerance]));
}
/** Direction tests use screen points directly, preserving SVG Y-down and test viewports. */
export function arcThrough(center: XY, start: XY, end: XY, mid: XY) {
	return !!required('arc_through', coords(center, start, end, mid))[0];
}
export function viewOrientation(viewport: { worldToScreen(point: Vec2): Vec2 }) {
	const o = viewport.worldToScreen(new Vec2()),
		x = Vec2.from(viewport.worldToScreen(new Vec2(1, 0))).sub(o),
		y = Vec2.from(viewport.worldToScreen(new Vec2(0, 1))).sub(o);
	return x.cross(y) < 0 ? -1 : 1;
}

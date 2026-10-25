import type { Vec2 } from './vector';
import { dist } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchSpline } from '../model/types';
import { CoincidentConstraint, MidpointConstraint } from '../solver/constraints';
import {
	sketchPrimitiveToGeoCurve,
	getPointAtParam,
	type GeoCurve,
	type GeoSpline,
} from './intersection';
import { extractSplineInterval, getSplineParamAtPoint } from './spline';

const TWO_PI = 2 * Math.PI;

export interface ConnectedPrimitiveInfo {
	type: 'line' | 'arc' | 'spline';
	id: string;
	endPointId: string; // The endpoint coincident with the corner
	otherPointId?: string;
}

export interface ConnectedPrimitivesResult {
	valid: boolean;
	pointIds: Set<string>;
	primitives: ConnectedPrimitiveInfo[];
}

/**
 * Finds all points coincident to startPointId and returns all non-construction, non-handle
 * primitives (line, arc, spline) connected to them.
 * A corner is valid for a fillet if and only if exactly 2 primitives emanate from it.
 */
export function getConnectedPrimitivesForPoint(
	sketch: SketchDocument,
	startPointId: string
): ConnectedPrimitivesResult {
	if (!sketch.points.has(startPointId)) {
		return { valid: false, pointIds: new Set(), primitives: [] };
	}

	// 1. Traverse CoincidentConstraint graph to find equivalence class
	const pointIds = new Set<string>([startPointId]);
	const queue = [startPointId];

	while (queue.length > 0) {
		const curr = queue.pop()!;
		for (const c of sketch.constraints.values()) {
			if (c instanceof CoincidentConstraint) {
				if (c.p1Id === curr && !pointIds.has(c.p2Id)) {
					pointIds.add(c.p2Id);
					queue.push(c.p2Id);
				} else if (c.p2Id === curr && !pointIds.has(c.p1Id)) {
					pointIds.add(c.p1Id);
					queue.push(c.p1Id);
				}
			}
		}
	}

	// 2. Collect all primitives connected to any point in pointIds
	const primitives: ConnectedPrimitiveInfo[] = [];
	const seenIds = new Set<string>();

	// Lines
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue; // Skip spline tangent handles
		const p1In = pointIds.has(line.p1Id);
		const p2In = pointIds.has(line.p2Id);
		if (p1In || p2In) {
			if (!seenIds.has(line.id)) {
				seenIds.add(line.id);
				primitives.push({
					type: 'line',
					id: line.id,
					endPointId: p1In ? line.p1Id : line.p2Id,
					otherPointId: p1In ? line.p2Id : line.p1Id,
				});
			}
		}
	}

	// Arcs
	for (const arc of sketch.arcs.values()) {
		const startIn = pointIds.has(arc.startPointId);
		const endIn = pointIds.has(arc.endPointId);
		if (startIn || endIn) {
			if (!seenIds.has(arc.id)) {
				seenIds.add(arc.id);
				primitives.push({
					type: 'arc',
					id: arc.id,
					endPointId: startIn ? arc.startPointId : arc.endPointId,
					otherPointId: startIn ? arc.endPointId : arc.startPointId,
				});
			}
		}
	}

	// Splines
	for (const spline of sketch.splines.values()) {
		if (spline.pointIds.length >= 2) {
			const startPt = spline.pointIds[0];
			const endPt = spline.pointIds[spline.pointIds.length - 1];
			const startIn = pointIds.has(startPt);
			const endIn = pointIds.has(endPt);
			if (startIn || endIn) {
				if (!seenIds.has(spline.id)) {
					seenIds.add(spline.id);
					primitives.push({
						type: 'spline',
						id: spline.id,
						endPointId: startIn ? startPt : endPt,
						otherPointId: startIn ? spline.pointIds[1] : spline.pointIds[spline.pointIds.length - 2],
					});
				}
			}
		}
	}

	const valid = primitives.length === 2;
	return { valid, pointIds, primitives };
}

export interface FilletResult {
	center: Vec2;
	radius: number;
	t1: Vec2;
	t2: Vec2;
	clockwise: boolean;
	cornerVertex: Vec2;
	midArc: Vec2;
	bisectorDir: Vec2;
	param1: number;
	param2: number;
	endPointId1?: string;
	endPointId2?: string;
}

export interface FilletCandidate {
	id: string;
	vertexPointId?: string;
	primitive1: { type: 'line' | 'arc' | 'spline'; id: string };
	primitive2: { type: 'line' | 'arc' | 'spline'; id: string };
	clickPos1?: Vec2;
	clickPos2?: Vec2;
	endPointId1?: string;
	endPointId2?: string;
	result?: FilletResult | null;
}

/**
 * Normalizes vector to unit length
 */
function normalize(v: Vec2): Vec2 {
	const len = Math.hypot(v.x, v.y);
	if (len < 1e-12) return { x: 1, y: 0 };
	return { x: v.x / len, y: v.y / len };
}

/**
 * Calculates intersection of two infinite 2D lines
 */
function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
	const cross = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(cross) < 1e-9) return null;
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const t = (dx * d2.y - dy * d2.x) / cross;
	return {
		x: p1.x + t * d1.x,
		y: p1.y + t * d1.y,
	};
}

/**
 * Evaluates position, unit tangent, and unit normal on a curve at parameter t,
 * with support for linear tangential extension outside [0, 1].
 */
export function evaluateCurveExtended(
	curve: GeoCurve,
	t: number
): { point: Vec2; tangent: Vec2; normal: Vec2 } {
	if (curve.type === 'segment') {
		const p1 = curve.p1;
		const p2 = curve.p2;
		const d = normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
		const normal = { x: -d.y, y: d.x };
		const point = {
			x: p1.x + t * (p2.x - p1.x),
			y: p1.y + t * (p2.y - p1.y),
		};
		return { point, tangent: d, normal };
	}

	if (curve.type === 'arc') {
		const point = getPointAtParam(curve, t);
		const dt = 1e-4;
		const pNext = getPointAtParam(curve, t + dt);
		const tangent = normalize({ x: pNext.x - point.x, y: pNext.y - point.y });
		const normal = { x: -tangent.y, y: tangent.x };
		return { point, tangent, normal };
	}

	if (curve.type === 'spline') {
		const spline = curve;
		const segs = spline.bezierSegments;
		if (segs.length === 0) {
			return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
		}

		if (t >= 0 && t <= 1) {
			const pt = getPointAtParam(curve, t);
			// Derivative by finite difference
			const dt = 1e-4;
			const tA = Math.max(0, t - dt);
			const tB = Math.min(1, t + dt);
			const pA = getPointAtParam(curve, tA);
			const pB = getPointAtParam(curve, tB);
			const tangent = normalize({ x: pB.x - pA.x, y: pB.y - pA.y });
			const normal = { x: -tangent.y, y: tangent.x };
			return { point: pt, tangent, normal };
		}

		// Linear tangential extension
		if (t < 0) {
			const p0 = segs[0][0];
			const p1 = segs[0][1];
			const d = normalize({ x: p1.x - p0.x, y: p1.y - p0.y });
			const point = {
				x: p0.x + t * d.x * 100,
				y: p0.y + t * d.y * 100,
			};
			const tangent = d;
			const normal = { x: -tangent.y, y: tangent.x };
			return { point, tangent, normal };
		} else {
			const lastSeg = segs[segs.length - 1];
			const pEnd = lastSeg[3];
			const pPrev = lastSeg[2];
			const d = normalize({ x: pEnd.x - pPrev.x, y: pEnd.y - pPrev.y });
			const point = {
				x: pEnd.x + (t - 1) * d.x * 100,
				y: pEnd.y + (t - 1) * d.y * 100,
			};
			const tangent = d;
			const normal = { x: -tangent.y, y: tangent.x };
			return { point, tangent, normal };
		}
	}

	const pt = { x: 0, y: 0 };
	return { point: pt, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
}

/**
 * Projects a point onto a curve (or its linear extension) and returns parameter t and distance.
 */
export function projectOntoCurveExtended(
	curve: GeoCurve,
	pt: Vec2
): { t: number; point: Vec2; dist: number } {
	if (curve.type === 'segment') {
		const p1 = curve.p1;
		const p2 = curve.p2;
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const lenSq = dx * dx + dy * dy;
		if (lenSq < 1e-12) return { t: 0, point: p1, dist: dist(pt, p1) };
		const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
		const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
		return { t, point: proj, dist: dist(pt, proj) };
	}

	if (curve.type === 'arc') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const r = curve.radius;
		const spt = { x: pt.x, y: -pt.y };
		const dCenter = normalize({ x: spt.x - sc.x, y: spt.y - sc.y });
		const sproj = { x: sc.x + r * dCenter.x, y: sc.y + r * dCenter.y };
		const ss = { x: curve.start.x, y: -curve.start.y };
		const se = { x: curve.end.x, y: -curve.end.y };
		const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
		const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
		const ap = Math.atan2(sproj.y - sc.y, sproj.x - sc.x);
		const clockwise = curve.clockwise;

		let sweep = 0;
		let cur = 0;
		if (clockwise) {
			sweep = (ae - as) % TWO_PI;
			if (sweep < 0) sweep += TWO_PI;
			cur = (ap - as) % TWO_PI;
			if (cur < 0) cur += TWO_PI;
		} else {
			sweep = (as - ae) % TWO_PI;
			if (sweep < 0) sweep += TWO_PI;
			cur = (as - ap) % TWO_PI;
			if (cur < 0) cur += TWO_PI;
		}
		const t = sweep > 1e-6 ? cur / sweep : 0;
		const proj = { x: sproj.x, y: -sproj.y };
		return { t, point: proj, dist: dist(pt, proj) };
	}

	if (curve.type === 'spline') {
		const segs = curve.bezierSegments;
		const proj = getSplineParamAtPoint(segs, pt);
		if (segs.length > 0) {
			const p0 = segs[0][0];
			const p1 = segs[0][1];
			const d0 = normalize({ x: p0.x - p1.x, y: p0.y - p1.y });
			const v0 = { x: pt.x - p0.x, y: pt.y - p0.y };
			const dot0 = v0.x * d0.x + v0.y * d0.y;
			if (dot0 > 0) {
				const projPt = { x: p0.x + dot0 * d0.x, y: p0.y + dot0 * d0.y };
				const extDist = dist(pt, projPt);
				if (extDist < proj.distance) {
					return { t: -dot0 / 100, point: projPt, dist: extDist };
				}
			}

			const lastSeg = segs[segs.length - 1];
			const pEnd = lastSeg[3];
			const pPrev = lastSeg[2];
			const dEnd = normalize({ x: pEnd.x - pPrev.x, y: pEnd.y - pPrev.y });
			const vEnd = { x: pt.x - pEnd.x, y: pt.y - pEnd.y };
			const dotEnd = vEnd.x * dEnd.x + vEnd.y * dEnd.y;
			if (dotEnd > 0) {
				const projPt = { x: pEnd.x + dotEnd * dEnd.x, y: pEnd.y + dotEnd * dEnd.y };
				const extDist = dist(pt, projPt);
				if (extDist < proj.distance) {
					return { t: 1 + dotEnd / 100, point: projPt, dist: extDist };
				}
			}
		}
		return { t: proj.param, point: proj.point, dist: proj.distance };
	}

	return { t: 0, point: pt, dist: 0 };
}

/**
 * Calculates clockwise orientation in screen space (Y inverted) for the minor arc (< 180°)
 * between t1 and t2 on a circle centered at center.
 */
function computeFilletArcClockwise(center: Vec2, t1: Vec2, t2: Vec2): boolean {
	const asScreen = Math.atan2(-(t1.y - center.y), t1.x - center.x);
	const aeScreen = Math.atan2(-(t2.y - center.y), t2.x - center.x);
	let sweepCW = (aeScreen - asScreen) % TWO_PI;
	if (sweepCW < 0) sweepCW += TWO_PI;
	return sweepCW < Math.PI;
}

/**
 * Calculates the midpoint of the minor arc (< 180°) between t1 and t2 on a circle centered at center.
 */
function computeFilletMidArc(center: Vec2, t1: Vec2, t2: Vec2, radius: number): Vec2 {
	const v1 = { x: t1.x - center.x, y: t1.y - center.y };
	const v2 = { x: t2.x - center.x, y: t2.y - center.y };
	const midDir = normalize({ x: v1.x + v2.x, y: v1.y + v2.y });
	return {
		x: center.x + radius * midDir.x,
		y: center.y + radius * midDir.y,
	};
}

function solveFilletBranch(
	prim1: GeoCurve,
	prim2: GeoCurve,
	V: Vec2,
	dir1: Vec2,
	dir2: Vec2,
	bisectorDir: Vec2,
	halfAngle: number,
	radius: number
): { center: Vec2; pt1: Vec2; pt2: Vec2 } | null {
	const r0 = Math.min(radius, 1.0);
	const dTan0 = r0 / Math.tan(halfAngle);
	const p0 = projectOntoCurveExtended(prim1, { x: V.x + dTan0 * dir1.x, y: V.y + dTan0 * dir1.y });
	let t1 = p0.t;

	const isSpline1 = prim1.type === 'spline';
	let isEndpoint1 = false;
	let isStart1 = true;
	if (isSpline1) {
		const s0 = evaluateCurveExtended(prim1, 0).point;
		const s1 = evaluateCurveExtended(prim1, 1).point;
		const d0 = Math.hypot(V.x - s0.x, V.y - s0.y);
		const d1 = Math.hypot(V.x - s1.x, V.y - s1.y);
		isEndpoint1 = Math.min(d0, d1) < 2.0;
		isStart1 = d0 < d1;
	}

	const isSpline2 = prim2.type === 'spline';
	let isEndpoint2 = false;
	let isStart2 = true;
	if (isSpline2) {
		const s0 = evaluateCurveExtended(prim2, 0).point;
		const s1 = evaluateCurveExtended(prim2, 1).point;
		const d0 = Math.hypot(V.x - s0.x, V.y - s0.y);
		const d1 = Math.hypot(V.x - s1.x, V.y - s1.y);
		isEndpoint2 = Math.min(d0, d1) < 2.0;
		isStart2 = d0 < d1;
	}

	// Consistent interior side of curves based on candidate normal pointing towards bisectorDir
	const ev1_0 = evaluateCurveExtended(prim1, t1);
	const na1 = { x: -ev1_0.tangent.y, y: ev1_0.tangent.x };
	const dotNa1 = na1.x * bisectorDir.x + na1.y * bisectorDir.y;
	const side1 = Math.abs(dotNa1) > 1e-4 ? (dotNa1 > 0 ? 1 : -1) : ((na1.x * dir2.x + na1.y * dir2.y) > 0 ? 1 : -1);

	const center0 = { x: ev1_0.point.x + r0 * side1 * na1.x, y: ev1_0.point.y + r0 * side1 * na1.y };
	const proj2_0 = projectOntoCurveExtended(prim2, center0);
	const ev2_0 = evaluateCurveExtended(prim2, proj2_0.t);
	const na2 = { x: -ev2_0.tangent.y, y: ev2_0.tangent.x };
	const dotNa2 = na2.x * bisectorDir.x + na2.y * bisectorDir.y;
	const side2 = Math.abs(dotNa2) > 1e-4 ? (dotNa2 > 0 ? 1 : -1) : ((na2.x * dir1.x + na2.y * dir1.y) > 0 ? 1 : -1);

	const numSteps = radius <= 5 ? 1 : Math.max(2, Math.ceil(radius / 5));
	let center = { x: 0, y: 0 };
	let pt1 = { x: 0, y: 0 };
	let pt2 = { x: 0, y: 0 };

	for (let s = 1; s <= numSteps; s++) {
		const r = (radius * s) / numSteps;
		let stepSolved = false;

		for (let iter = 0; iter < 24; iter++) {
			const ev1 = evaluateCurveExtended(prim1, t1);
			pt1 = ev1.point;
			const n1 = { x: side1 * -ev1.tangent.y, y: side1 * ev1.tangent.x };
			center = { x: pt1.x + r * n1.x, y: pt1.y + r * n1.y };

			const proj2 = projectOntoCurveExtended(prim2, center);
			pt2 = proj2.point;
			const ev2 = evaluateCurveExtended(prim2, proj2.t);
			const n2 = { x: side2 * -ev2.tangent.y, y: side2 * ev2.tangent.x };

			const signedDist = (center.x - pt2.x) * n2.x + (center.y - pt2.y) * n2.y;
			const err = signedDist - r;

			const dotBisector = (center.x - V.x) * bisectorDir.x + (center.y - V.y) * bisectorDir.y;
			const dot1 = (pt1.x - V.x) * dir1.x + (pt1.y - V.y) * dir1.y;
			const dot2 = (pt2.x - V.x) * dir2.x + (pt2.y - V.y) * dir2.y;

			// Center must stay in interior corner direction, and tangent points must not step backwards past corner
			if (dotBisector <= 0 || dot1 < -1.0 || dot2 < -1.0) break;
			if (isEndpoint1 && (isStart1 ? t1 > 0.6 : t1 < 0.4)) break;
			if (isEndpoint2 && (isStart2 ? proj2.t > 0.6 : proj2.t < 0.4)) break;

			if (Math.abs(err) < 1e-3) {
				stepSolved = true;
				break;
			}

			const dt = 1e-3;
			const ev1Next = evaluateCurveExtended(prim1, t1 + dt);
			const n1Next = { x: side1 * -ev1Next.tangent.y, y: side1 * ev1Next.tangent.x };
			const centerNext = { x: ev1Next.point.x + r * n1Next.x, y: ev1Next.point.y + r * n1Next.y };
			const proj2Next = projectOntoCurveExtended(prim2, centerNext);
			const ev2Next = evaluateCurveExtended(prim2, proj2Next.t);
			const n2Next = { x: side2 * -ev2Next.tangent.y, y: side2 * ev2Next.tangent.x };
			const signedDistNext = (centerNext.x - proj2Next.point.x) * n2Next.x + (centerNext.y - proj2Next.point.y) * n2Next.y;

			const deriv = (signedDistNext - signedDist) / dt;
			if (Math.abs(deriv) < 1e-6) break;
			t1 -= Math.max(-0.25, Math.min(0.25, err / deriv));
		}

		if (!stepSolved) return null;
	}
	return { center, pt1, pt2 };
}

/**
 * Calculates fillet arc between two GeoCurves at a specified corner.
 */
export function calculateFilletGeometry(
	curve1: GeoCurve,
	curve2: GeoCurve,
	radius: number,
	options: {
		cornerVertex?: Vec2;
		clickPos1?: Vec2;
		clickPos2?: Vec2;
		endPointId1?: string;
		endPointId2?: string;
	}
): FilletResult | null {
	if (radius <= 0.01) return null;

	let V: Vec2;
	let u1: Vec2;
	let u2: Vec2;

	// Case A: Corner Vertex known (selected via point)
	if (options.cornerVertex) {
		V = options.cornerVertex;

		// Direction into curve 1 away from V
		if (curve1.type === 'segment') {
			const d1 = dist(V, curve1.p1);
			const d2 = dist(V, curve1.p2);
			if (d1 < d2) {
				u1 = normalize({ x: curve1.p2.x - curve1.p1.x, y: curve1.p2.y - curve1.p1.y });
			} else {
				u1 = normalize({ x: curve1.p1.x - curve1.p2.x, y: curve1.p1.y - curve1.p2.y });
			}
		} else if (curve1.type === 'arc') {
			const dStart = dist(V, curve1.start);
			const dEnd = dist(V, curve1.end);
			if (dStart < dEnd) {
				const ev = evaluateCurveExtended(curve1, 0.01);
				u1 = normalize({ x: ev.point.x - V.x, y: ev.point.y - V.y });
			} else {
				const ev = evaluateCurveExtended(curve1, 0.99);
				u1 = normalize({ x: ev.point.x - V.x, y: ev.point.y - V.y });
			}
		} else {
			// Spline
			const ev0 = evaluateCurveExtended(curve1, 0);
			const ev1 = evaluateCurveExtended(curve1, 1);
			if (dist(V, ev0.point) < dist(V, ev1.point)) {
				u1 = ev0.tangent;
			} else {
				u1 = { x: -ev1.tangent.x, y: -ev1.tangent.y };
			}
		}

		// Direction into curve 2 away from V
		if (curve2.type === 'segment') {
			const d1 = dist(V, curve2.p1);
			const d2 = dist(V, curve2.p2);
			if (d1 < d2) {
				u2 = normalize({ x: curve2.p2.x - curve2.p1.x, y: curve2.p2.y - curve2.p1.y });
			} else {
				u2 = normalize({ x: curve2.p1.x - curve2.p2.x, y: curve2.p1.y - curve2.p2.y });
			}
		} else if (curve2.type === 'arc') {
			const dStart = dist(V, curve2.start);
			const dEnd = dist(V, curve2.end);
			if (dStart < dEnd) {
				const ev = evaluateCurveExtended(curve2, 0.01);
				u2 = normalize({ x: ev.point.x - V.x, y: ev.point.y - V.y });
			} else {
				const ev = evaluateCurveExtended(curve2, 0.99);
				u2 = normalize({ x: ev.point.x - V.x, y: ev.point.y - V.y });
			}
		} else {
			// Spline
			const ev0 = evaluateCurveExtended(curve2, 0);
			const ev1 = evaluateCurveExtended(curve2, 1);
			if (dist(V, ev0.point) < dist(V, ev1.point)) {
				u2 = ev0.tangent;
			} else {
				u2 = { x: -ev1.tangent.x, y: -ev1.tangent.y };
			}
		}
	} else {
		// Case B: Selected via two primitives with click positions
		const click1 = options.clickPos1 || { x: 0, y: 0 };
		const click2 = options.clickPos2 || { x: 0, y: 0 };

		// Approximate corner intersection of curve extensions
		if (curve1.type === 'segment' && curve2.type === 'segment') {
			const d1 = normalize({ x: curve1.p2.x - curve1.p1.x, y: curve1.p2.y - curve1.p1.y });
			const d2 = normalize({ x: curve2.p2.x - curve2.p1.x, y: curve2.p2.y - curve2.p1.y });
			const inter = intersectLines(curve1.p1, d1, curve2.p1, d2);
			if (!inter) return null;
			V = inter;
			u1 = normalize({ x: click1.x - V.x, y: click1.y - V.y });
			u2 = normalize({ x: click2.x - V.x, y: click2.y - V.y });
		} else {
			// Find facing endpoints between the two curves for extension
			const ev1_0 = evaluateCurveExtended(curve1, 0);
			const ev1_1 = evaluateCurveExtended(curve1, 1);
			const ev2_0 = evaluateCurveExtended(curve2, 0);
			const ev2_1 = evaluateCurveExtended(curve2, 1);

			let minDist = Infinity;
			let bestT1 = 0;
			let bestT2 = 0;
			const pairs: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
			for (const [tA, tB] of pairs) {
				const ptA = tA === 0 ? ev1_0.point : ev1_1.point;
				const ptB = tB === 0 ? ev2_0.point : ev2_1.point;
				const d = dist(ptA, ptB);
				if (d < minDist) {
					minDist = d;
					bestT1 = tA;
					bestT2 = tB;
				}
			}

			const ev1Facing = evaluateCurveExtended(curve1, bestT1);
			const ev2Facing = evaluateCurveExtended(curve2, bestT2);
			const interFacing = intersectLines(ev1Facing.point, ev1Facing.tangent, ev2Facing.point, ev2Facing.tangent);

			const p1Proj = projectOntoCurveExtended(curve1, click1);
			const p2Proj = projectOntoCurveExtended(curve2, click2);
			const ev1Click = evaluateCurveExtended(curve1, p1Proj.t);
			const ev2Click = evaluateCurveExtended(curve2, p2Proj.t);
			const interClick = intersectLines(ev1Click.point, ev1Click.tangent, ev2Click.point, ev2Click.tangent);

			if (interFacing) {
				V = interFacing;
				u1 = bestT1 === 1 ? { x: -ev1Facing.tangent.x, y: -ev1Facing.tangent.y } : ev1Facing.tangent;
				u2 = bestT2 === 1 ? { x: -ev2Facing.tangent.x, y: -ev2Facing.tangent.y } : ev2Facing.tangent;
			} else if (interClick) {
				V = interClick;
				u1 = normalize({ x: click1.x - V.x, y: click1.y - V.y });
				u2 = normalize({ x: click2.x - V.x, y: click2.y - V.y });
			} else {
				const p1ToClick2 = projectOntoCurveExtended(curve1, click2);
				const p2ToClick1 = projectOntoCurveExtended(curve2, click1);
				V = { x: (p1ToClick2.point.x + p2ToClick1.point.x) * 0.5, y: (p1ToClick2.point.y + p2ToClick1.point.y) * 0.5 };
				u1 = normalize({ x: click1.x - V.x, y: click1.y - V.y });
				u2 = normalize({ x: click2.x - V.x, y: click2.y - V.y });
			}
		}
	}

	const cosTheta = u1.x * u2.x + u1.y * u2.y;
	if (cosTheta > 0.9999 || cosTheta < -0.9999) {
		// Collinear or parallel curves cannot have a fillet
		return null;
	}

	const bisectorDir = normalize({ x: u1.x + u2.x, y: u1.y + u2.y });
	const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 0.5;
	if (halfAngle < 1e-3 || Math.sin(halfAngle) < 1e-4) return null;

	const dTangent = radius / Math.tan(halfAngle);

	// Line-Line: exact closed-form solution
	if (curve1.type === 'segment' && curve2.type === 'segment') {
		const dCenter = radius / Math.sin(halfAngle);

		const center = {
			x: V.x + dCenter * bisectorDir.x,
			y: V.y + dCenter * bisectorDir.y,
		};
		const t1 = {
			x: V.x + dTangent * u1.x,
			y: V.y + dTangent * u1.y,
		};
		const t2 = {
			x: V.x + dTangent * u2.x,
			y: V.y + dTangent * u2.y,
		};

		const clockwise = computeFilletArcClockwise(center, t1, t2);
		const midArc = computeFilletMidArc(center, t1, t2, radius);
		const arcBisectorDir = normalize({ x: midArc.x - center.x, y: midArc.y - center.y });

		const p1Info = projectOntoCurveExtended(curve1, t1);
		const p2Info = projectOntoCurveExtended(curve2, t2);

		return {
			center,
			radius,
			t1,
			t2,
			clockwise,
			cornerVertex: V,
			midArc,
			bisectorDir: arcBisectorDir,
			param1: p1Info.t,
			param2: p2Info.t,
			endPointId1: options.endPointId1,
			endPointId2: options.endPointId2,
		};
	}

	// Line-Arc, Arc-Arc, Spline: iterative root-finding for exact tangency
	// Using signed normal distance and continuation from r -> 0 to anchor the solution
	// strictly in the interior corner defined by (u1, u2) and bisectorDir.
	let branchRes = solveFilletBranch(curve1, curve2, V, u1, u2, bisectorDir, halfAngle, radius);
	let flippedOrder = false;
	if (!branchRes) {
		branchRes = solveFilletBranch(curve2, curve1, V, u2, u1, bisectorDir, halfAngle, radius);
		flippedOrder = true;
	}
	if (!branchRes) return null;

	const pt1 = flippedOrder ? branchRes.pt2 : branchRes.pt1;
	const pt2 = flippedOrder ? branchRes.pt1 : branchRes.pt2;
	const center = branchRes.center;

	const clockwise = computeFilletArcClockwise(center, pt1, pt2);
	const midArc = computeFilletMidArc(center, pt1, pt2, radius);

	const p1Info = projectOntoCurveExtended(curve1, pt1);
	const p2Info = projectOntoCurveExtended(curve2, pt2);

	return {
		center,
		radius,
		t1: pt1,
		t2: pt2,
		clockwise,
		cornerVertex: V,
		midArc,
		bisectorDir: normalize({ x: midArc.x - center.x, y: midArc.y - center.y }),
		param1: p1Info.t,
		param2: p2Info.t,
		endPointId1: options.endPointId1,
		endPointId2: options.endPointId2,
	};
}

/**
 * Commits a single fillet into the SketchDocument.
 */
export function commitFilletToSketch(
	sketch: SketchDocument,
	fillet: FilletCandidate,
	isFirstFillet: boolean,
	firstArcId?: string
): { arcId: string; centerId: string; p1Id: string; p2Id: string } | null {
	const res = fillet.result;
	if (!res) return null;

	// 1. Create tangent points and arc center
	const pT1 = sketch.addPoint(res.t1.x, res.t1.y);
	const pT2 = sketch.addPoint(res.t2.x, res.t2.y);
	const pCenter = sketch.addPoint(res.center.x, res.center.y);

	// 2. Create the fillet arc
	const filletArc = sketch.addArc(
		pCenter.id,
		pT1.id,
		pT2.id,
		res.radius,
		res.clockwise
	);

	// 3. Trim or extend primitive 1
	const oldPt1 = trimOrExtendPrimitive(sketch, fillet.primitive1, pT1.id, res.param1, fillet.endPointId1, res.cornerVertex);

	// 4. Trim or extend primitive 2
	const oldPt2 = trimOrExtendPrimitive(sketch, fillet.primitive2, pT2.id, res.param2, fillet.endPointId2, res.cornerVertex);

	// 5. If corner vertex or old endpoints exist and are now unreferenced, delete them
	const candidatesToClean = new Set<string>();
	if (oldPt1) candidatesToClean.add(oldPt1);
	if (oldPt2) candidatesToClean.add(oldPt2);
	if (fillet.vertexPointId) candidatesToClean.add(fillet.vertexPointId);
	if (fillet.endPointId1) candidatesToClean.add(fillet.endPointId1);
	if (fillet.endPointId2) candidatesToClean.add(fillet.endPointId2);

	if (res.cornerVertex) {
		for (const pt of sketch.points.values()) {
			if (dist(pt, res.cornerVertex) < 0.5 && !sketch.isPointUsed(pt.id)) {
				candidatesToClean.add(pt.id);
			}
		}
	}

	for (const pid of candidatesToClean) {
		if (sketch.points.has(pid)) {
			const conn = getConnectedPrimitivesForPoint(sketch, pid);
			if (conn.primitives.length === 0) {
				for (const id of conn.pointIds) {
					sketch.removeEntity(id);
				}
			} else if (!sketch.isPointUsed(pid)) {
				sketch.removeEntity(pid);
			}
		}
	}

	// 6. Add Tangent Constraints
	const addTangentForPrim = (prim: { type: 'line' | 'arc' | 'spline'; id: string }, cutPointId: string) => {
		if (prim.type === 'spline') {
			const spline = sketch.splines.get(prim.id);
			if (spline && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
				const isStart = spline.pointIds[0] === cutPointId;
				const handleLineId = isStart
					? spline.tangentLineIds[0]
					: spline.tangentLineIds[spline.tangentLineIds.length - 1];
				if (handleLineId) {
					sketch.addTangentConstraint(filletArc.id, handleLineId);
				}
			}
		} else {
			sketch.addTangentConstraint(filletArc.id, prim.id);
		}
	};

	addTangentForPrim(fillet.primitive1, pT1.id);
	addTangentForPrim(fillet.primitive2, pT2.id);

	// 7. Add Radius Constraint / EqualRadius Constraint
	if (isFirstFillet) {
		sketch.addRadiusConstraint(filletArc.id, res.radius);
	} else if (firstArcId) {
		sketch.addEqualRadiusConstraint(firstArcId, filletArc.id);
	}

	return {
		arcId: filletArc.id,
		centerId: pCenter.id,
		p1Id: pT1.id,
		p2Id: pT2.id,
	};
}

function isPointAtOrCoincident(sketch: SketchDocument, targetPointId: string, candidatePointId: string): boolean {
	if (targetPointId === candidatePointId) return true;
	const visited = new Set<string>([targetPointId]);
	const queue = [targetPointId];
	while (queue.length > 0) {
		const curr = queue.pop()!;
		for (const c of sketch.constraints.values()) {
			if (c instanceof CoincidentConstraint) {
				const next = c.p1Id === curr ? c.p2Id : c.p2Id === curr ? c.p1Id : null;
				if (next) {
					if (next === candidatePointId) return true;
					if (!visited.has(next)) {
						visited.add(next);
						queue.push(next);
					}
				}
			}
		}
	}
	return false;
}

/**
 * Trims or extends a primitive so its endpoint connects to newCutPointId.
 */
function trimOrExtendPrimitive(
	sketch: SketchDocument,
	primitive: { type: 'line' | 'arc' | 'spline'; id: string },
	newCutPointId: string,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2
): string | undefined {
	if (primitive.type === 'line') {
		const line = sketch.lines.get(primitive.id);
		if (!line) return undefined;

		let replaceP1: boolean;
		if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, line.p1Id)) {
			replaceP1 = true;
		} else if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, line.p2Id)) {
			replaceP1 = false;
		} else if (cornerVertex) {
			const pt1 = sketch.points.get(line.p1Id);
			const pt2 = sketch.points.get(line.p2Id);
			if (pt1 && pt2) {
				replaceP1 = dist(pt1, cornerVertex) < dist(pt2, cornerVertex);
			} else {
				replaceP1 = param <= 0.5;
			}
		} else {
			replaceP1 = param <= 0.5;
		}

		const oldPtId = replaceP1 ? line.p1Id : line.p2Id;
		if (replaceP1) {
			line.p1Id = newCutPointId;
		} else {
			line.p2Id = newCutPointId;
		}
		sketch.rebuildParamManager();
		return oldPtId;
	} else if (primitive.type === 'arc') {
		const arc = sketch.arcs.get(primitive.id);
		if (!arc) return undefined;

		let replaceStart: boolean;
		if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, arc.startPointId)) {
			replaceStart = true;
		} else if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, arc.endPointId)) {
			replaceStart = false;
		} else if (cornerVertex) {
			const ptStart = sketch.points.get(arc.startPointId);
			const ptEnd = sketch.points.get(arc.endPointId);
			if (ptStart && ptEnd) {
				replaceStart = dist(ptStart, cornerVertex) < dist(ptEnd, cornerVertex);
			} else {
				replaceStart = param <= 0.5;
			}
		} else {
			replaceStart = param <= 0.5;
		}

		const oldPtId = replaceStart ? arc.startPointId : arc.endPointId;
		if (replaceStart) {
			arc.startPointId = newCutPointId;
		} else {
			arc.endPointId = newCutPointId;
		}
		sketch.rebuildParamManager();
		return oldPtId;
	} else if (primitive.type === 'spline') {
		const spline = sketch.splines.get(primitive.id);
		if (!spline) return undefined;

		let isNearStart: boolean;
		const startPtId = spline.pointIds[0];
		const endPtId = spline.pointIds[spline.pointIds.length - 1];
		if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, startPtId)) {
			isNearStart = true;
		} else if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, endPtId)) {
			isNearStart = false;
		} else if (cornerVertex) {
			const ptStart = sketch.points.get(startPtId);
			const ptEnd = sketch.points.get(endPtId);
			if (ptStart && ptEnd) {
				isNearStart = dist(ptStart, cornerVertex) < dist(ptEnd, cornerVertex);
			} else {
				isNearStart = param <= 0.5;
			}
		} else {
			isNearStart = param <= 0.5;
		}

		if (param >= 0 && param <= 1) {
			const curve = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id) as GeoSpline | null;
			if (curve) {
				let newSpline: SketchSpline | null = null;
				if (isNearStart) {
					// Replace [param, 1]
					newSpline = replaceSplineWithInterval(sketch, curve, param, 1, newCutPointId, endPtId);
				} else {
					// Replace [0, param]
					newSpline = replaceSplineWithInterval(sketch, curve, 0, param, startPtId, newCutPointId);
				}
				sketch.removeEntity(spline.id);
				if (newSpline) {
					primitive.id = newSpline.id;
				}
				return isNearStart ? startPtId : endPtId;
			}
		}

		// Linear extension outside [0, 1]: update endpoint position, shift tangent handle, and update midpoint constraint
		const oldPointId = isNearStart ? startPtId : endPtId;
		const oldPt = sketch.points.get(oldPointId);
		const newPt = sketch.points.get(newCutPointId);
		if (spline.splineType === 'control') {
			const handleLineId = isNearStart
				? spline.tangentLineIds?.[0]
				: spline.tangentLineIds?.[spline.tangentLineIds.length - 1];
			if (handleLineId) {
				const hLine = sketch.lines.get(handleLineId);
				if (hLine) {
					if (hLine.p1Id === oldPointId) hLine.p1Id = newCutPointId;
					else if (hLine.p2Id === oldPointId) hLine.p2Id = newCutPointId;
				}
			}
		} else if (oldPt && newPt && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
			const dx = newPt.x - oldPt.x;
			const dy = newPt.y - oldPt.y;
			const handleLineId = isNearStart
				? spline.tangentLineIds[0]
				: spline.tangentLineIds[spline.tangentLineIds.length - 1];
			if (handleLineId) {
				const hLine = sketch.lines.get(handleLineId);
				if (hLine) {
					const hp1 = sketch.points.get(hLine.p1Id);
					const hp2 = sketch.points.get(hLine.p2Id);
					if (hp1) {
						hp1.x += dx;
						hp1.y += dy;
					}
					if (hp2) {
						hp2.x += dx;
						hp2.y += dy;
					}
				}
			}
		}

		if (isNearStart) {
			spline.pointIds[0] = newCutPointId;
		} else {
			spline.pointIds[spline.pointIds.length - 1] = newCutPointId;
		}
		for (const c of sketch.constraints.values()) {
			if (c instanceof MidpointConstraint && c.midId === oldPointId) {
				(c as { midId: string }).midId = newCutPointId;
				c.entityIds[0] = newCutPointId;
			}
		}
		if (oldPointId !== newCutPointId) {
			sketch.removeEntity(oldPointId);
		}
		sketch.rebuildParamManager();
		return oldPointId;
	}
	return undefined;
}

function replaceSplineWithInterval(
	sketch: SketchDocument,
	curve: GeoSpline,
	uA: number,
	uB: number,
	startPointId: string,
	endPointId: string
): SketchSpline | null {
	if (curve.bezierSegments.length === 0) return null;
	const subSegments = extractSplineInterval(curve.bezierSegments, uA, uB);
	if (subSegments.length === 0) return null;

	const M = subSegments.length;

	if (curve.splineType === 'control') {
		const controlRawPoints: Vec2[] = [subSegments[0][0]];
		for (let s = 0; s < M; s++) {
			controlRawPoints.push(subSegments[s][1]);
			controlRawPoints.push(subSegments[s][2]);
			controlRawPoints.push(subSegments[s][3]);
		}

		const controlPtIds: string[] = [startPointId];
		for (let k = 1; k < controlRawPoints.length - 1; k++) {
			const pos = controlRawPoints[k];
			let matchedId: string | null = null;
			for (const pid of curve.pointIds) {
				const pt = sketch.points.get(pid);
				if (pt && Math.hypot(pt.x - pos.x, pt.y - pos.y) < 1e-2) {
					matchedId = pid;
					break;
				}
			}
			if (!matchedId) {
				const newPt = sketch.addPoint(pos.x, pos.y);
				matchedId = newPt.id;
			}
			controlPtIds.push(matchedId);
		}
		controlPtIds.push(endPointId);

		const knots: number[] = [0, 0, 0, 0];
		for (let i = 1; i < M; i++) knots.push(i, i, i);
		knots.push(M, M, M, M);

		return sketch.addControlSpline(controlPtIds, curve.isConstruction, undefined, false, knots);
	}

	const rawPoints: Vec2[] = [];
	const rawHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];

	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			const p0 = subSegments[0][0];
			rawPoints.push(p0);
			const v = { x: subSegments[0][1].x - p0.x, y: subSegments[0][1].y - p0.y };
			rawHandles.push({ h1: { x: p0.x - v.x, y: p0.y - v.y }, h2: { x: p0.x + v.x, y: p0.y + v.y } });
		} else if (j === M) {
			const pM = subSegments[M - 1][3];
			rawPoints.push(pM);
			const v = { x: pM.x - subSegments[M - 1][2].x, y: pM.y - subSegments[M - 1][2].y };
			rawHandles.push({ h1: { x: pM.x - v.x, y: pM.y - v.y }, h2: { x: pM.x + v.x, y: pM.y + v.y } });
		} else {
			const pJ = subSegments[j][0];
			rawPoints.push(pJ);
			const vin = { x: pJ.x - subSegments[j - 1][2].x, y: pJ.y - subSegments[j - 1][2].y };
			const vout = { x: subSegments[j][1].x - pJ.x, y: subSegments[j][1].y - pJ.y };
			const v = { x: (vin.x + vout.x) * 0.5, y: (vin.y + vout.y) * 0.5 };
			rawHandles.push({ h1: { x: pJ.x - v.x, y: pJ.y - v.y }, h2: { x: pJ.x + v.x, y: pJ.y + v.y } });
		}
	}

	const newPointIds: string[] = [];
	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			newPointIds.push(startPointId);
		} else if (j === M) {
			newPointIds.push(endPointId);
		} else {
			const pt = sketch.addPoint(rawPoints[j].x, rawPoints[j].y);
			newPointIds.push(pt.id);
		}
	}

	return sketch.addFitSpline(newPointIds, undefined, false, undefined, false, rawHandles);
}

/**
 * Finds the maximum valid fillet radius for two curves at a corner within [minR, maxR].
 * Uses binary search.
 */
export function findMaxFilletRadius(
	curve1: GeoCurve,
	curve2: GeoCurve,
	options: {
		cornerVertex?: Vec2;
		clickPos1?: Vec2;
		clickPos2?: Vec2;
		endPointId1?: string;
		endPointId2?: string;
	},
	maxR = 100,
	minR = 0.1
): number | null {
	// First check if minR is possible at all
	const minRes = calculateFilletGeometry(curve1, curve2, minR, options);
	if (!minRes) return null;

	// If maxR already works, return maxR
	const maxRes = calculateFilletGeometry(curve1, curve2, maxR, options);
	if (maxRes) return maxR;

	let low = minR;
	let high = maxR;
	for (let i = 0; i < 10; i++) {
		const mid = (low + high) * 0.5;
		const res = calculateFilletGeometry(curve1, curve2, mid, options);
		if (res) {
			low = mid;
		} else {
			high = mid;
		}
	}
	const rounded = Math.floor(low * 10) / 10;
	return rounded >= minR ? rounded : low;
}

import { Vec2 } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchLine, SketchSpline } from '../model/types';
import { remapLineConstraints } from '../model/constraintLinks';
import {
	CircularPatternConstraint,
	CoincidentConstraint,
	DistanceConstraint,
	MidpointConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import { getPointAtParam, type GeoCurve, type GeoSpline } from './intersection';
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
 * Calculates intersection of two infinite 2D lines
 */
function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
	const determinant = d1.cross(d2);
	if (Math.abs(determinant) < 1e-9) return null;
	const dir = new Vec2().subVectors(p2, p1);
	const t = dir.cross(d2) / determinant;
	return p1.clone().addScaledVector(d1, t);
}

/**
 * Evaluates position, unit tangent, and unit normal on a curve at parameter t,
 * with support for linear tangential extension outside [0, 1].
 */
export function evaluateCurveExtended(curve: GeoCurve, t: number): { point: Vec2; tangent: Vec2; normal: Vec2 } {
	if (curve.type === 'segment') {
		const p1 = curve.p1;
		const p2 = curve.p2;
		const d = new Vec2().subVectors(p2, p1).normalizeOrUnitX();
		const normal = d.clone().perpendicular();
		const point = p1.clone().lerp(p2, t);
		return { point, tangent: d, normal };
	}

	if (curve.type === 'arc') {
		const point = getPointAtParam(curve, t);
		const dt = 1e-4;
		const pNext = getPointAtParam(curve, t + dt);
		const tangent = new Vec2().subVectors(pNext, point).normalizeOrUnitX();
		const normal = tangent.clone().perpendicular();
		return { point, tangent, normal };
	}

	if (curve.type === 'spline') {
		const spline = curve;
		const segs = spline.bezierSegments;
		if (segs.length === 0) {
			return { point: new Vec2(0, 0), tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
		}

		if (t >= 0 && t <= 1) {
			const pt = getPointAtParam(curve, t);
			// Derivative by finite difference
			const dt = 1e-4;
			const tA = Math.max(0, t - dt);
			const tB = Math.min(1, t + dt);
			const pA = getPointAtParam(curve, tA);
			const pB = getPointAtParam(curve, tB);
			const tangent = new Vec2().subVectors(pB, pA).normalizeOrUnitX();
			const normal = tangent.clone().perpendicular();
			return { point: pt, tangent, normal };
		}

		// Linear tangential extension
		if (t < 0) {
			const p0 = segs[0][0];
			const p1 = segs[0][1];
			const d = new Vec2().subVectors(p1, p0).normalizeOrUnitX();
			const point = p0.clone().addScaledVector(d, 100 * t);
			const tangent = d;
			const normal = tangent.clone().perpendicular();
			return { point, tangent, normal };
		} else {
			const lastSeg = segs[segs.length - 1];
			const pEnd = lastSeg[3];
			const pPrev = lastSeg[2];
			const d = new Vec2().subVectors(pEnd, pPrev).normalizeOrUnitX();
			const point = pEnd.clone().addScaledVector(d, 100 * (t - 1));
			const tangent = d;
			const normal = tangent.clone().perpendicular();
			return { point, tangent, normal };
		}
	}

	const pt = new Vec2(0, 0);
	return { point: pt, tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
}

/**
 * Projects a point onto a curve (or its linear extension) and returns parameter t and distance.
 */
export function projectOntoCurveExtended(curve: GeoCurve, pt: Vec2): { t: number; point: Vec2; dist: number } {
	if (curve.type === 'segment') {
		const p1 = curve.p1;
		const p2 = curve.p2;
		const delta = new Vec2().subVectors(p2, p1);
		const lenSq = delta.lengthSq();
		if (lenSq < 1e-12) return { t: 0, point: p1, dist: pt.distanceTo(p1) };
		const t = new Vec2().subVectors(pt, p1).dot(delta) / lenSq;
		const proj = p1.clone().addScaledVector(delta, t);
		return { t, point: proj, dist: pt.distanceTo(proj) };
	}

	if (curve.type === 'arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const r = curve.radius;
		const spt = new Vec2(pt.x, -pt.y);
		const dCenter = new Vec2().subVectors(spt, sc).normalizeOrUnitX();
		const sproj = Vec2.from(sc).addScaledVector(dCenter, r);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const as = Vec2.from(sc).angleToPoint(ss);
		const ae = Vec2.from(sc).angleToPoint(se);
		const ap = Vec2.from(sc).angleToPoint(sproj);
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
		const proj = new Vec2(sproj.x, -sproj.y);
		return { t, point: proj, dist: pt.distanceTo(proj) };
	}

	if (curve.type === 'spline') {
		const segs = curve.bezierSegments;
		const proj = getSplineParamAtPoint(segs, pt);
		if (segs.length > 0) {
			const p0 = segs[0][0];
			const p1 = segs[0][1];
			const d0 = new Vec2().subVectors(p0, p1).normalizeOrUnitX();
			const v0 = new Vec2().subVectors(pt, p0);
			const dot0 = v0.dot(d0);
			if (dot0 > 0) {
				const projPt = p0.clone().addScaledVector(d0, dot0);
				const extDist = pt.distanceTo(projPt);
				if (extDist < proj.distance) {
					return { t: -dot0 / 100, point: projPt, dist: extDist };
				}
			}

			const lastSeg = segs[segs.length - 1];
			const pEnd = lastSeg[3];
			const pPrev = lastSeg[2];
			const dEnd = new Vec2().subVectors(pEnd, pPrev).normalizeOrUnitX();
			const vEnd = new Vec2().subVectors(pt, pEnd);
			const dotEnd = vEnd.dot(dEnd);
			if (dotEnd > 0) {
				const projPt = pEnd.clone().addScaledVector(dEnd, dotEnd);
				const extDist = pt.distanceTo(projPt);
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
	const asScreen = -center.angleToPoint(t1);
	const aeScreen = -center.angleToPoint(t2);
	let sweepCW = (aeScreen - asScreen) % TWO_PI;
	if (sweepCW < 0) sweepCW += TWO_PI;
	return sweepCW < Math.PI;
}

/**
 * Calculates the midpoint of the minor arc (< 180°) between t1 and t2 on a circle centered at center.
 */
function computeFilletMidArc(center: Vec2, t1: Vec2, t2: Vec2, radius: number): Vec2 {
	const v1 = new Vec2().subVectors(t1, center);
	const v2 = new Vec2().subVectors(t2, center);
	const midDir = new Vec2().addVectors(v1, v2).normalizeOrUnitX();
	return center.clone().addScaledVector(midDir, radius);
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
	const p0 = projectOntoCurveExtended(prim1, V.clone().addScaledVector(dir1, dTan0));
	let t1 = p0.t;

	const isSpline1 = prim1.type === 'spline';
	let isEndpoint1 = false;
	let isStart1 = true;
	if (isSpline1) {
		const s0 = evaluateCurveExtended(prim1, 0).point;
		const s1 = evaluateCurveExtended(prim1, 1).point;
		const d0 = s0.distanceTo(V);
		const d1 = s1.distanceTo(V);
		isEndpoint1 = Math.min(d0, d1) < 2.0;
		isStart1 = d0 < d1;
	}

	const isSpline2 = prim2.type === 'spline';
	let isEndpoint2 = false;
	let isStart2 = true;
	if (isSpline2) {
		const s0 = evaluateCurveExtended(prim2, 0).point;
		const s1 = evaluateCurveExtended(prim2, 1).point;
		const d0 = s0.distanceTo(V);
		const d1 = s1.distanceTo(V);
		isEndpoint2 = Math.min(d0, d1) < 2.0;
		isStart2 = d0 < d1;
	}

	// Consistent interior side of curves based on candidate normal pointing towards bisectorDir
	const ev1_0 = evaluateCurveExtended(prim1, t1);
	const na1 = ev1_0.tangent.clone().perpendicular();
	const dotNa1 = Vec2.from(na1).dot(bisectorDir);
	const side1 = Math.abs(dotNa1) > 1e-4 ? (dotNa1 > 0 ? 1 : -1) : Vec2.from(na1).dot(dir2) > 0 ? 1 : -1;

	const center0 = ev1_0.point.clone().addScaledVector(na1, r0 * side1);
	const proj2_0 = projectOntoCurveExtended(prim2, center0);
	const ev2_0 = evaluateCurveExtended(prim2, proj2_0.t);
	const na2 = ev2_0.tangent.clone().perpendicular();
	const dotNa2 = Vec2.from(na2).dot(bisectorDir);
	const side2 = Math.abs(dotNa2) > 1e-4 ? (dotNa2 > 0 ? 1 : -1) : Vec2.from(na2).dot(dir1) > 0 ? 1 : -1;

	const numSteps = radius <= 5 ? 1 : Math.max(2, Math.ceil(radius / 5));
	let center = new Vec2(0, 0);
	let pt1 = new Vec2(0, 0);
	let pt2 = new Vec2(0, 0);

	for (let s = 1; s <= numSteps; s++) {
		const r = (radius * s) / numSteps;
		let stepSolved = false;

		for (let iter = 0; iter < 24; iter++) {
			const ev1 = evaluateCurveExtended(prim1, t1);
			pt1 = ev1.point;
			const n1 = ev1.tangent.clone().perpendicular().multiplyScalar(side1);
			center = Vec2.from(pt1).addScaledVector(n1, r);

			const proj2 = projectOntoCurveExtended(prim2, center);
			pt2 = proj2.point;
			const ev2 = evaluateCurveExtended(prim2, proj2.t);
			const n2 = ev2.tangent.clone().perpendicular().multiplyScalar(side2);

			const signedDist = new Vec2().subVectors(center, pt2).dot(n2);
			const err = signedDist - r;

			const dotBisector = new Vec2().subVectors(center, V).dot(bisectorDir);
			const dot1 = new Vec2().subVectors(pt1, V).dot(dir1);
			const dot2 = new Vec2().subVectors(pt2, V).dot(dir2);

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
			const n1Next = ev1Next.tangent.clone().perpendicular().multiplyScalar(side1);
			const centerNext = ev1Next.point.clone().addScaledVector(n1Next, r);
			const proj2Next = projectOntoCurveExtended(prim2, centerNext);
			const ev2Next = evaluateCurveExtended(prim2, proj2Next.t);
			const n2Next = ev2Next.tangent.clone().perpendicular().multiplyScalar(side2);
			const signedDistNext = new Vec2().subVectors(centerNext, proj2Next.point).dot(n2Next);

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
			const d1 = V.distanceTo(curve1.p1);
			const d2 = V.distanceTo(curve1.p2);
			if (d1 < d2) {
				u1 = new Vec2().subVectors(curve1.p2, curve1.p1).normalizeOrUnitX();
			} else {
				u1 = new Vec2().subVectors(curve1.p1, curve1.p2).normalizeOrUnitX();
			}
		} else if (curve1.type === 'arc') {
			const dStart = V.distanceTo(curve1.start);
			const dEnd = V.distanceTo(curve1.end);
			if (dStart < dEnd) {
				const ev = evaluateCurveExtended(curve1, 0.01);
				u1 = new Vec2().subVectors(ev.point, V).normalizeOrUnitX();
			} else {
				const ev = evaluateCurveExtended(curve1, 0.99);
				u1 = new Vec2().subVectors(ev.point, V).normalizeOrUnitX();
			}
		} else {
			// Spline
			const ev0 = evaluateCurveExtended(curve1, 0);
			const ev1 = evaluateCurveExtended(curve1, 1);
			if (V.distanceTo(ev0.point) < V.distanceTo(ev1.point)) {
				u1 = ev0.tangent;
			} else {
				u1 = ev1.tangent.clone().negate();
			}
		}

		// Direction into curve 2 away from V
		if (curve2.type === 'segment') {
			const d1 = V.distanceTo(curve2.p1);
			const d2 = V.distanceTo(curve2.p2);
			if (d1 < d2) {
				u2 = new Vec2().subVectors(curve2.p2, curve2.p1).normalizeOrUnitX();
			} else {
				u2 = new Vec2().subVectors(curve2.p1, curve2.p2).normalizeOrUnitX();
			}
		} else if (curve2.type === 'arc') {
			const dStart = V.distanceTo(curve2.start);
			const dEnd = V.distanceTo(curve2.end);
			if (dStart < dEnd) {
				const ev = evaluateCurveExtended(curve2, 0.01);
				u2 = new Vec2().subVectors(ev.point, V).normalizeOrUnitX();
			} else {
				const ev = evaluateCurveExtended(curve2, 0.99);
				u2 = new Vec2().subVectors(ev.point, V).normalizeOrUnitX();
			}
		} else {
			// Spline
			const ev0 = evaluateCurveExtended(curve2, 0);
			const ev1 = evaluateCurveExtended(curve2, 1);
			if (V.distanceTo(ev0.point) < V.distanceTo(ev1.point)) {
				u2 = ev0.tangent;
			} else {
				u2 = ev1.tangent.clone().negate();
			}
		}
	} else {
		// Case B: Selected via two primitives with click positions
		const click1 = options.clickPos1 || new Vec2(0, 0);
		const click2 = options.clickPos2 || new Vec2(0, 0);

		// Approximate corner intersection of curve extensions
		if (curve1.type === 'segment' && curve2.type === 'segment') {
			const d1 = new Vec2().subVectors(curve1.p2, curve1.p1).normalizeOrUnitX();
			const d2 = new Vec2().subVectors(curve2.p2, curve2.p1).normalizeOrUnitX();
			const inter = intersectLines(curve1.p1, d1, curve2.p1, d2);
			if (!inter) return null;
			V = inter;
			u1 = new Vec2().subVectors(click1, V).normalizeOrUnitX();
			u2 = new Vec2().subVectors(click2, V).normalizeOrUnitX();
		} else {
			// Find facing endpoints between the two curves for extension
			const ev1_0 = evaluateCurveExtended(curve1, 0);
			const ev1_1 = evaluateCurveExtended(curve1, 1);
			const ev2_0 = evaluateCurveExtended(curve2, 0);
			const ev2_1 = evaluateCurveExtended(curve2, 1);

			let minDist = Infinity;
			let bestT1 = 0;
			let bestT2 = 0;
			const pairs: [number, number][] = [
				[0, 0],
				[0, 1],
				[1, 0],
				[1, 1],
			];
			for (const [tA, tB] of pairs) {
				const ptA = tA === 0 ? ev1_0.point : ev1_1.point;
				const ptB = tB === 0 ? ev2_0.point : ev2_1.point;
				const d = ptA.distanceTo(ptB);
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
				u1 = bestT1 === 1 ? ev1Facing.tangent.clone().negate() : ev1Facing.tangent;
				u2 = bestT2 === 1 ? ev2Facing.tangent.clone().negate() : ev2Facing.tangent;
			} else if (interClick) {
				V = interClick;
				u1 = new Vec2().subVectors(click1, V).normalizeOrUnitX();
				u2 = new Vec2().subVectors(click2, V).normalizeOrUnitX();
			} else {
				const p1ToClick2 = projectOntoCurveExtended(curve1, click2);
				const p2ToClick1 = projectOntoCurveExtended(curve2, click1);
				V = new Vec2().midpoint(p1ToClick2.point, p2ToClick1.point);
				u1 = new Vec2().subVectors(click1, V).normalizeOrUnitX();
				u2 = new Vec2().subVectors(click2, V).normalizeOrUnitX();
			}
		}
	}

	const cosTheta = u1.dot(u2);
	if (cosTheta > 0.9999 || cosTheta < -0.9999) {
		// Collinear or parallel curves cannot have a fillet
		return null;
	}

	const bisectorDir = new Vec2().addVectors(u1, u2).normalizeOrUnitX();
	const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 0.5;
	if (halfAngle < 1e-3 || Math.sin(halfAngle) < 1e-4) return null;

	const dTangent = radius / Math.tan(halfAngle);

	// Line-Line: exact closed-form solution
	if (curve1.type === 'segment' && curve2.type === 'segment') {
		const dCenter = radius / Math.sin(halfAngle);

		const center = V.clone().addScaledVector(bisectorDir, dCenter);
		const t1 = V.clone().addScaledVector(u1, dTangent);
		const t2 = V.clone().addScaledVector(u2, dTangent);

		const clockwise = computeFilletArcClockwise(center, t1, t2);
		const midArc = computeFilletMidArc(center, t1, t2, radius);
		const arcBisectorDir = new Vec2().subVectors(midArc, center).normalizeOrUnitX();

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
		bisectorDir: new Vec2().subVectors(midArc, center).normalizeOrUnitX(),
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
	firstArcId?: string,
	expression?: string
): { arcId: string; centerId: string; p1Id: string; p2Id: string } | null {
	const res = fillet.result;
	if (!res) return null;
	const referencePoints = new Set<string>();
	for (const c of sketch.constraints.values()) {
		if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
			for (const id of [...c.entityIds, ...c.sourceObjectIds]) {
				if (sketch.points.has(id)) referencePoints.add(id);
			}
		} else if (c instanceof DistanceConstraint) {
			referencePoints.add(c.p1Id);
			referencePoints.add(c.p2Id);
		}
	}

	// 1. Create tangent points and arc center
	const pT1 = sketch.addPoint(res.t1);
	const pT2 = sketch.addPoint(res.t2);
	const pCenter = sketch.addPoint(res.center);

	// 2. Create the fillet arc
	const filletArc = sketch.addArc(pCenter.id, pT1.id, pT2.id, res.radius, res.clockwise);

	// 3. Trim or extend primitive 1
	const oldPt1 = trimOrExtendPrimitive(
		sketch,
		fillet.primitive1,
		pT1.id,
		res.param1,
		fillet.endPointId1,
		res.cornerVertex
	);

	// 4. Trim or extend primitive 2
	const oldPt2 = trimOrExtendPrimitive(
		sketch,
		fillet.primitive2,
		pT2.id,
		res.param2,
		fillet.endPointId2,
		res.cornerVertex
	);

	// Keep dimension and pattern references at the original intersection.
	const retainedPoints = new Set(referencePoints);
	for (const [primitive, pointId] of [
		[fillet.primitive1, oldPt1],
		[fillet.primitive2, oldPt2],
	] as const) {
		if (primitive.type !== 'line' || !pointId) continue;
		const { pointIds } = getConnectedPrimitivesForPoint(sketch, pointId);
		if ([...pointIds].some(id => referencePoints.has(id))) {
			for (const id of pointIds) retainedPoints.add(id);
			sketch.addPointOnLineConstraint(pointId, primitive.id);
		}
	}

	// 5. If corner vertex or old endpoints exist and are now unreferenced, delete them
	const candidatesToClean = new Set<string>();
	if (oldPt1) candidatesToClean.add(oldPt1);
	if (oldPt2) candidatesToClean.add(oldPt2);
	if (fillet.vertexPointId) candidatesToClean.add(fillet.vertexPointId);
	if (fillet.endPointId1) candidatesToClean.add(fillet.endPointId1);
	if (fillet.endPointId2) candidatesToClean.add(fillet.endPointId2);

	if (res.cornerVertex) {
		for (const pt of sketch.points.values()) {
			if (pt.distanceTo(res.cornerVertex) < 0.5 && !sketch.isPointUsed(pt.id)) {
				candidatesToClean.add(pt.id);
			}
		}
	}

	for (const pid of candidatesToClean) {
		if (sketch.points.has(pid) && !retainedPoints.has(pid)) {
			const conn = getConnectedPrimitivesForPoint(sketch, pid);
			if (conn.primitives.length === 0) {
				for (const id of conn.pointIds) {
					if (!retainedPoints.has(id)) sketch.removeEntity(id);
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
		const c = sketch.addRadiusConstraint(filletArc.id, res.radius);
		if (c && expression) {
			c.expression = expression;
		}
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

export function getFilletLineEndPointId(
	sketch: SketchDocument,
	line: SketchLine,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2
): string {
	if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, line.p1Id)) return line.p1Id;
	if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, line.p2Id)) return line.p2Id;
	if (cornerVertex) {
		const p1 = sketch.points.get(line.p1Id);
		const p2 = sketch.points.get(line.p2Id);
		if (p1 && p2) return p1.distanceTo(cornerVertex) < p2.distanceTo(cornerVertex) ? line.p1Id : line.p2Id;
	}
	return param <= 0.5 ? line.p1Id : line.p2Id;
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

		const oldPtId = getFilletLineEndPointId(sketch, line, param, hintEndPointId, cornerVertex);
		const replaceP1 = oldPtId === line.p1Id;
		remapLineConstraints(sketch, line, oldPtId, newCutPointId);
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
				replaceStart = ptStart.distanceTo(cornerVertex) < ptEnd.distanceTo(cornerVertex);
			} else {
				replaceStart = param <= 0.5;
			}
		} else {
			replaceStart = param <= 0.5;
		}

		const oldPtId = replaceStart ? arc.startPointId : arc.endPointId;
		sketch.replaceArcEndpoint(arc, replaceStart ? 'start' : 'end', newCutPointId);
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
				isNearStart = ptStart.distanceTo(cornerVertex) < ptEnd.distanceTo(cornerVertex);
			} else {
				isNearStart = param <= 0.5;
			}
		} else {
			isNearStart = param <= 0.5;
		}

		if (param >= 0 && param <= 1) {
			const curve = spline.toGeoCurve(sketch);
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
			const dir = new Vec2().subVectors(newPt, oldPt);
			const handleLineId = isNearStart
				? spline.tangentLineIds[0]
				: spline.tangentLineIds[spline.tangentLineIds.length - 1];
			if (handleLineId) {
				const hLine = sketch.lines.get(handleLineId);
				if (hLine) {
					const hp1 = sketch.points.get(hLine.p1Id);
					const hp2 = sketch.points.get(hLine.p2Id);
					if (hp1) {
						hp1.x += dir.x;
						hp1.y += dir.y;
					}
					if (hp2) {
						hp2.x += dir.x;
						hp2.y += dir.y;
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
				if (pt && pos.distanceTo(pt) < 1e-2) {
					matchedId = pid;
					break;
				}
			}
			if (!matchedId) {
				const newPt = sketch.addPoint(pos);
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
			const v = new Vec2().subVectors(subSegments[0][1], p0);
			rawHandles.push({
				h1: new Vec2().subVectors(p0, v),
				h2: new Vec2().addVectors(p0, v),
			});
		} else if (j === M) {
			const pM = subSegments[M - 1][3];
			rawPoints.push(pM);
			const v = new Vec2().subVectors(pM, subSegments[M - 1][2]);
			rawHandles.push({
				h1: new Vec2().subVectors(pM, v),
				h2: new Vec2().addVectors(pM, v),
			});
		} else {
			const pJ = subSegments[j][0];
			rawPoints.push(pJ);
			const vin = new Vec2().subVectors(pJ, subSegments[j - 1][2]);
			const vout = new Vec2().subVectors(subSegments[j][1], pJ);
			const tangentSum = new Vec2().addVectors(vin, vout);
			rawHandles.push({
				h1: pJ.clone().addScaledVector(tangentSum, -0.5),
				h2: pJ.clone().addScaledVector(tangentSum, 0.5),
			});
		}
	}

	const newPointIds: string[] = [];
	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			newPointIds.push(startPointId);
		} else if (j === M) {
			newPointIds.push(endPointId);
		} else {
			const pt = sketch.addPoint(rawPoints[j]);
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

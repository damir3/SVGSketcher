import type { Vec2 } from './vector';
import { projectPointOntoSegment } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchPoint, SketchLine, SketchSpline } from '../model/types';
import {
	getSplinePointAtParam,
	getSplineParamAtPoint,
	evaluateBezier,
	evaluateBezierDerivative,
	splitBezier,
	extractSplineInterval,
	type BezierSegment,
} from './spline';
import {
	HorizontalConstraint,
	VerticalConstraint,
	ParallelConstraint,
	CollinearConstraint,
	PerpendicularConstraint,
	AngleConstraint,
	TangentLineCircleConstraint,
	PointOnLineConstraint,
	PointToLineDistanceConstraint,
	SymmetryConstraint,
} from '../solver/constraints';
import type { IConstraint } from '../solver/types';

const TWO_PI = 2 * Math.PI;

export interface GeoSegment {
	type: 'segment';
	id: string;
	p1: Vec2;
	p2: Vec2;
	isConstruction?: boolean;
}

export interface GeoCircle {
	type: 'circle';
	id: string;
	center: Vec2;
	centerId: string;
	radius: number;
	isConstruction?: boolean;
}

export interface GeoArc {
	type: 'arc';
	id: string;
	center: Vec2;
	centerId: string;
	startPointId: string;
	endPointId: string;
	radius: number;
	start: Vec2;
	end: Vec2;
	clockwise: boolean;
	isConstruction?: boolean;
}

export interface GeoEllipse {
	type: 'ellipse';
	id: string;
	center: Vec2;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	majorAxisPoint: Vec2;
	minorAxisPoint: Vec2;
	isConstruction?: boolean;
}

export interface GeoEllipticalArc {
	type: 'elliptical_arc';
	id: string;
	center: Vec2;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	startPointId: string;
	endPointId: string;
	majorAxisPoint: Vec2;
	minorAxisPoint: Vec2;
	start: Vec2;
	end: Vec2;
	clockwise: boolean;
	isConstruction?: boolean;
}

export interface GeoSpline {
	type: 'spline';
	id: string;
	splineType: 'fit' | 'control';
	pointIds: string[];
	points: Vec2[];
	tangentLineIds?: string[];
	bezierSegments: BezierSegment[];
	isClosed?: boolean;
	isConstruction?: boolean;
}

export type GeoCurve = GeoSegment | GeoCircle | GeoArc | GeoEllipse | GeoEllipticalArc | GeoSpline;
export type CurveType = GeoCurve['type'];

export interface TrimCandidate {
	curve: GeoCurve;
	interval: [number, number]; // [paramA, paramB]
	cutStartWorld: Vec2;
	cutEndWorld: Vec2;
	startCuttingCurveId?: string;
	startCuttingCurveType?: CurveType;
	endCuttingCurveId?: string;
	endCuttingCurveType?: CurveType;
	isWholeEntity: boolean;
}

/**
 * Converts sketch document primitives into normalized GeoCurves.
 * Delegates polymorphically to primitive.toGeoCurve(sketch).
 */
export function sketchPrimitiveToGeoCurve(
	sketch: SketchDocument,
	type: 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline',
	id: string
): GeoCurve | null {
	return sketch.getPrimitive(id, type)?.toGeoCurve(sketch) ?? null;
}

export function getAllGeoCurves(sketch: SketchDocument): GeoCurve[] {
	const curves: GeoCurve[] = [];
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue; // Skip tangent handles
		const c = line.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	for (const circle of sketch.circles.values()) {
		const c = circle.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	for (const arc of sketch.arcs.values()) {
		const c = arc.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	for (const ellipse of sketch.ellipses.values()) {
		const c = ellipse.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	for (const elArc of sketch.ellipticalArcs.values()) {
		const c = elArc.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	for (const spline of sketch.splines.values()) {
		const c = spline.toGeoCurve(sketch);
		if (c) curves.push(c);
	}
	return curves;
}

/**
 * Returns point in world coordinates at parameter `param` on `curve`.
 * - For Segment / Arc / EllipticalArc / Spline: param in [0, 1]
 * - For Circle / Ellipse: param in [0, 2pi) in SVG-coordinate angle
 */
export function getPointAtParam(curve: GeoCurve, param: number): Vec2 {
	if (curve.type === 'spline') {
		return getSplinePointAtParam(curve.bezierSegments, param);
	} else if (curve.type === 'segment') {
		const t = Math.max(0, Math.min(1, param));
		return {
			x: curve.p1.x + t * (curve.p2.x - curve.p1.x),
			y: curve.p1.y + t * (curve.p2.y - curve.p1.y),
		};
	} else if (curve.type === 'circle') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const sq = {
			x: sc.x + curve.radius * Math.cos(param),
			y: sc.y + curve.radius * Math.sin(param),
		};
		return { x: sq.x, y: -sq.y };
	} else if (curve.type === 'arc') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const ss = { x: curve.start.x, y: -curve.start.y };
		const se = { x: curve.end.x, y: -curve.end.y };
		const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
		const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const ang = curve.clockwise ? as + u * sweep : as - u * sweep;
		const sq = {
			x: sc.x + curve.radius * Math.cos(ang),
			y: sc.y + curve.radius * Math.sin(ang),
		};
		return { x: sq.x, y: -sq.y };
	} else if (curve.type === 'ellipse') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const smaj = { x: curve.majorAxisPoint.x, y: -curve.majorAxisPoint.y };
		const smin = { x: curve.minorAxisPoint.x, y: -curve.minorAxisPoint.y };
		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
		const ux = Math.cos(theta), uy = Math.sin(theta);
		const vx = -Math.sin(theta), vy = Math.cos(theta);
		const up = rx * Math.cos(param);
		const vp = ry * Math.sin(param);
		const sq = {
			x: sc.x + up * ux + vp * vx,
			y: sc.y + up * uy + vp * vy,
		};
		return { x: sq.x, y: -sq.y };
	} else if (curve.type === 'elliptical_arc') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const smaj = { x: curve.majorAxisPoint.x, y: -curve.majorAxisPoint.y };
		const smin = { x: curve.minorAxisPoint.x, y: -curve.minorAxisPoint.y };
		const ss = { x: curve.start.x, y: -curve.start.y };
		const se = { x: curve.end.x, y: -curve.end.y };
		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
		const ux = Math.cos(theta), uy = Math.sin(theta);
		const vx = -Math.sin(theta), vy = Math.cos(theta);
		const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
		const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
		const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
		const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;
		const ts = Math.atan2(vs / ry, us / rx);
		const te = Math.atan2(ve / ry, ue / rx);
		let sweep = curve.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const t = curve.clockwise ? ts + u * sweep : ts - u * sweep;
		const up = rx * Math.cos(t);
		const vp = ry * Math.sin(t);
		const sq = {
			x: sc.x + up * ux + vp * vx,
			y: sc.y + up * uy + vp * vy,
		};
		return { x: sq.x, y: -sq.y };
	}
	return { x: 0, y: 0 };
}

/**
 * Computes parameter of point `pt` (in world coordinates) along `curve`.
 */
export function getParamAtPoint(curve: GeoCurve, pt: Vec2): number {
	if (curve.type === 'spline') {
		return getSplineParamAtPoint(curve.bezierSegments, pt).param;
	} else if (curve.type === 'segment') {
		const dx = curve.p2.x - curve.p1.x;
		const dy = curve.p2.y - curve.p1.y;
		const l2 = dx * dx + dy * dy;
		if (l2 < 1e-12) return 0;
		const t = ((pt.x - curve.p1.x) * dx + (pt.y - curve.p1.y) * dy) / l2;
		return Math.max(0, Math.min(1, t));
	} else if (curve.type === 'circle') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const sp = { x: pt.x, y: -pt.y };
		let ang = Math.atan2(sp.y - sc.y, sp.x - sc.x);
		if (ang < 0) ang += TWO_PI;
		return ang;
	} else if (curve.type === 'arc') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const ss = { x: curve.start.x, y: -curve.start.y };
		const se = { x: curve.end.x, y: -curve.end.y };
		const sp = { x: pt.x, y: -pt.y };
		const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
		const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
		const ap = Math.atan2(sp.y - sc.y, sp.x - sc.x);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		let delta = curve.clockwise ? (ap - as) % TWO_PI : (as - ap) % TWO_PI;
		if (delta < 0) delta += TWO_PI;
		if (sweep < 1e-6) return 0;
		return Math.max(0, Math.min(1, delta / sweep));
	} else if (curve.type === 'ellipse') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const smaj = { x: curve.majorAxisPoint.x, y: -curve.majorAxisPoint.y };
		const smin = { x: curve.minorAxisPoint.x, y: -curve.minorAxisPoint.y };
		const sp = { x: pt.x, y: -pt.y };
		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
		const ux = Math.cos(theta), uy = Math.sin(theta);
		const vx = -Math.sin(theta), vy = Math.cos(theta);
		const dx = sp.x - sc.x, dy = sp.y - sc.y;
		const up = dx * ux + dy * uy;
		const vp = dx * vx + dy * vy;
		let t = Math.atan2(vp / Math.max(ry, 1e-6), up / Math.max(rx, 1e-6));
		if (t < 0) t += TWO_PI;
		return t;
	} else if (curve.type === 'elliptical_arc') {
		const sc = { x: curve.center.x, y: -curve.center.y };
		const smaj = { x: curve.majorAxisPoint.x, y: -curve.majorAxisPoint.y };
		const smin = { x: curve.minorAxisPoint.x, y: -curve.minorAxisPoint.y };
		const ss = { x: curve.start.x, y: -curve.start.y };
		const se = { x: curve.end.x, y: -curve.end.y };
		const sp = { x: pt.x, y: -pt.y };
		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
		const ux = Math.cos(theta), uy = Math.sin(theta);
		const vx = -Math.sin(theta), vy = Math.cos(theta);
		const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
		const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
		const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
		const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;
		const ts = Math.atan2(vs / Math.max(ry, 1e-6), us / Math.max(rx, 1e-6));
		const te = Math.atan2(ve / Math.max(ry, 1e-6), ue / Math.max(rx, 1e-6));
		const dp = { x: sp.x - sc.x, y: sp.y - sc.y };
		const up = dp.x * ux + dp.y * uy;
		const vp = dp.x * vx + dp.y * vy;
		const tp = Math.atan2(vp / Math.max(ry, 1e-6), up / Math.max(rx, 1e-6));
		let sweep = curve.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		let delta = curve.clockwise ? (tp - ts) % TWO_PI : (ts - tp) % TWO_PI;
		if (delta < 0) delta += TWO_PI;
		if (sweep < 1e-6) return 0;
		return Math.max(0, Math.min(1, delta / sweep));
	}
	return 0;
}

/**
 * Checks if point pt (in world coords) lies on an arc within tolerance.
 */
function isPointOnArc(pt: Vec2, arc: GeoArc, tol = 1e-3): boolean {
	const sc = { x: arc.center.x, y: -arc.center.y };
	const ss = { x: arc.start.x, y: -arc.start.y };
	const se = { x: arc.end.x, y: -arc.end.y };
	const sp = { x: pt.x, y: -pt.y };
	const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
	const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
	const ap = Math.atan2(sp.y - sc.y, sp.x - sc.x);
	let sweep = arc.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
	if (sweep < 0) sweep += TWO_PI;
	let delta = arc.clockwise ? (ap - as) % TWO_PI : (as - ap) % TWO_PI;
	if (delta < 0) delta += TWO_PI;
	const angTol = tol / Math.max(arc.radius, 1);
	return delta <= sweep + angTol || delta >= TWO_PI - angTol;
}

/**
 * Checks if point pt (in world coords) lies on an elliptical arc within tolerance.
 */
function isPointOnEllipticalArc(pt: Vec2, arc: GeoEllipticalArc, tol = 1e-3): boolean {
	const sc = { x: arc.center.x, y: -arc.center.y };
	const smaj = { x: arc.majorAxisPoint.x, y: -arc.majorAxisPoint.y };
	const smin = { x: arc.minorAxisPoint.x, y: -arc.minorAxisPoint.y };
	const ss = { x: arc.start.x, y: -arc.start.y };
	const se = { x: arc.end.x, y: -arc.end.y };
	const sp = { x: pt.x, y: -pt.y };
	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	if (rx < 1e-6 || ry < 1e-6) return false;
	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const ux = Math.cos(theta), uy = Math.sin(theta);
	const vx = -Math.sin(theta), vy = Math.cos(theta);
	const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
	const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
	const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
	const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;
	const ts = Math.atan2(vs / ry, us / rx);
	const te = Math.atan2(ve / ry, ue / rx);
	const dp = { x: sp.x - sc.x, y: sp.y - sc.y };
	const up = dp.x * ux + dp.y * uy;
	const vp = dp.x * vx + dp.y * vy;
	const tp = Math.atan2(vp / ry, up / rx);
	let sweep = arc.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
	if (sweep < 0) sweep += TWO_PI;
	let delta = arc.clockwise ? (tp - ts) % TWO_PI : (ts - tp) % TWO_PI;
	if (delta < 0) delta += TWO_PI;
	const angTol = tol / Math.max(Math.min(rx, ry), 1);
	return delta <= sweep + angTol || delta >= TWO_PI - angTol;
}

function deduplicatePoints(pts: Vec2[], eps = 1e-4): Vec2[] {
	const res: Vec2[] = [];
	for (const p of pts) {
		const exists = res.some(existing => Math.hypot(existing.x - p.x, existing.y - p.y) < eps);
		if (!exists) res.push(p);
	}
	return res;
}

// --- INTERSECTION ROUTINES ---

export function intersectSegmentSegment(s1: GeoSegment, s2: GeoSegment): Vec2[] {
	const x1 = s1.p1.x, y1 = s1.p1.y, x2 = s1.p2.x, y2 = s1.p2.y;
	const x3 = s2.p1.x, y3 = s2.p1.y, x4 = s2.p2.x, y4 = s2.p2.y;

	const dx1 = x2 - x1;
	const dy1 = y2 - y1;
	const dx2 = x4 - x3;
	const dy2 = y4 - y3;

	const det = dx1 * dy2 - dy1 * dx2;
	if (Math.abs(det) < 1e-10) return [];

	const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / det;
	const u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / det;

	const eps = 1e-5;
	if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
		const clampedT = Math.max(0, Math.min(1, t));
		return [{ x: x1 + clampedT * dx1, y: y1 + clampedT * dy1 }];
	}
	return [];
}

export function intersectSegmentCircle(s: GeoSegment, c: GeoCircle | GeoArc): Vec2[] {
	const p1 = s.p1;
	const p2 = s.p2;
	const vx = p2.x - p1.x;
	const vy = p2.y - p1.y;
	const wx = p1.x - c.center.x;
	const wy = p1.y - c.center.y;

	const A = vx * vx + vy * vy;
	if (A < 1e-12) return [];

	const B = 2 * (wx * vx + wy * vy);
	const C0 = wx * wx + wy * wy - c.radius * c.radius;

	const disc = B * B - 4 * A * C0;
	if (disc < -1e-7) return [];

	const sqrtD = Math.sqrt(Math.max(0, disc));
	const tCandidates = [(-B - sqrtD) / (2 * A), (-B + sqrtD) / (2 * A)];
	const pts: Vec2[] = [];
	const eps = 1e-5;

	for (const t of tCandidates) {
		if (t >= -eps && t <= 1 + eps) {
			const clampedT = Math.max(0, Math.min(1, t));
			const pt: Vec2 = { x: p1.x + clampedT * vx, y: p1.y + clampedT * vy };
			if (c.type === 'circle' || isPointOnArc(pt, c)) {
				pts.push(pt);
			}
		}
	}
	return deduplicatePoints(pts);
}

export function intersectSegmentEllipse(s: GeoSegment, e: GeoEllipse | GeoEllipticalArc): Vec2[] {
	const sc = { x: e.center.x, y: -e.center.y };
	const smaj = { x: e.majorAxisPoint.x, y: -e.majorAxisPoint.y };
	const smin = { x: e.minorAxisPoint.x, y: -e.minorAxisPoint.y };
	const s1 = { x: s.p1.x, y: -s.p1.y };
	const s2 = { x: s.p2.x, y: -s.p2.y };

	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	if (rx < 1e-6 || ry < 1e-6) return [];

	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const ux = Math.cos(theta), uy = Math.sin(theta);
	const vx = -Math.sin(theta), vy = Math.cos(theta);

	// Transform line segment endpoints to ellipse-local coordinates
	const d1 = { x: s1.x - sc.x, y: s1.y - sc.y };
	const d2 = { x: s2.x - sc.x, y: s2.y - sc.y };

	const u1 = d1.x * ux + d1.y * uy;
	const v1 = d1.x * vx + d1.y * vy;
	const u2 = d2.x * ux + d2.y * uy;
	const v2 = d2.x * vx + d2.y * vy;

	const du = u2 - u1;
	const dv = v2 - v1;

	const A = ry * ry * du * du + rx * rx * dv * dv;
	if (A < 1e-12) return [];

	const B = 2 * (ry * ry * u1 * du + rx * rx * v1 * dv);
	const C0 = ry * ry * u1 * u1 + rx * rx * v1 * v1 - rx * rx * ry * ry;

	const disc = B * B - 4 * A * C0;
	if (disc < -1e-7) return [];

	const sqrtD = Math.sqrt(Math.max(0, disc));
	const tCandidates = [(-B - sqrtD) / (2 * A), (-B + sqrtD) / (2 * A)];
	const pts: Vec2[] = [];
	const eps = 1e-5;

	for (const t of tCandidates) {
		if (t >= -eps && t <= 1 + eps) {
			const clampedT = Math.max(0, Math.min(1, t));
			const worldPt: Vec2 = {
				x: s.p1.x + clampedT * (s.p2.x - s.p1.x),
				y: s.p1.y + clampedT * (s.p2.y - s.p1.y),
			};
			if (e.type === 'ellipse' || isPointOnEllipticalArc(worldPt, e)) {
				pts.push(worldPt);
			}
		}
	}
	return deduplicatePoints(pts);
}

export function intersectCircleCircle(c1: GeoCircle | GeoArc, c2: GeoCircle | GeoArc): Vec2[] {
	const dx = c2.center.x - c1.center.x;
	const dy = c2.center.y - c1.center.y;
	const d = Math.hypot(dx, dy);

	if (d < 1e-9) return []; // concentric or identical
	if (d > c1.radius + c2.radius + 1e-5 || d < Math.abs(c1.radius - c2.radius) - 1e-5) return [];

	const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d);
	const h2 = c1.radius * c1.radius - a * a;
	const h = Math.sqrt(Math.max(0, h2));

	const p0x = c1.center.x + (a / d) * dx;
	const p0y = c1.center.y + (a / d) * dy;

	const candidates: Vec2[] = [];
	if (h < 1e-7) {
		candidates.push({ x: p0x, y: p0y });
	} else {
		const nx = -dy / d;
		const ny = dx / d;
		candidates.push({ x: p0x + h * nx, y: p0y + h * ny });
		candidates.push({ x: p0x - h * nx, y: p0y - h * ny });
	}

	const pts: Vec2[] = [];
	for (const pt of candidates) {
		const ok1 = c1.type === 'circle' || isPointOnArc(pt, c1);
		const ok2 = c2.type === 'circle' || isPointOnArc(pt, c2);
		if (ok1 && ok2) pts.push(pt);
	}
	return deduplicatePoints(pts);
}

/**
 * General ellipse/circle vs ellipse/circle intersection using bracketed numerical root finding.
 */
export function intersectEllipseEllipse(
	e1: GeoCircle | GeoArc | GeoEllipse | GeoEllipticalArc,
	e2: GeoCircle | GeoArc | GeoEllipse | GeoEllipticalArc
): Vec2[] {
	// Parametrize e1 in SVG space
	const sc1 = { x: e1.center.x, y: -e1.center.y };
	let rx1 = 0, ry1 = 0, theta1 = 0;
	if (e1.type === 'circle' || e1.type === 'arc') {
		rx1 = e1.radius;
		ry1 = e1.radius;
		theta1 = 0;
	} else {
		const maj = { x: e1.majorAxisPoint.x, y: -e1.majorAxisPoint.y };
		const min = { x: e1.minorAxisPoint.x, y: -e1.minorAxisPoint.y };
		rx1 = Math.hypot(maj.x - sc1.x, maj.y - sc1.y);
		ry1 = Math.hypot(min.x - sc1.x, min.y - sc1.y);
		theta1 = Math.atan2(maj.y - sc1.y, maj.x - sc1.x);
	}
	if (rx1 < 1e-6 || ry1 < 1e-6) return [];

	const ux1 = Math.cos(theta1), uy1 = Math.sin(theta1);
	const vx1 = -Math.sin(theta1), vy1 = Math.cos(theta1);

	// Parametrize e2 implicit equation in SVG space
	const sc2 = { x: e2.center.x, y: -e2.center.y };
	let rx2 = 0, ry2 = 0, theta2 = 0;
	if (e2.type === 'circle' || e2.type === 'arc') {
		rx2 = e2.radius;
		ry2 = e2.radius;
		theta2 = 0;
	} else {
		const maj = { x: e2.majorAxisPoint.x, y: -e2.majorAxisPoint.y };
		const min = { x: e2.minorAxisPoint.x, y: -e2.minorAxisPoint.y };
		rx2 = Math.hypot(maj.x - sc2.x, maj.y - sc2.y);
		ry2 = Math.hypot(min.x - sc2.x, min.y - sc2.y);
		theta2 = Math.atan2(maj.y - sc2.y, maj.x - sc2.x);
	}
	if (rx2 < 1e-6 || ry2 < 1e-6) return [];

	const ux2 = Math.cos(theta2), uy2 = Math.sin(theta2);
	const vx2 = -Math.sin(theta2), vy2 = Math.cos(theta2);

	// Evaluate point on e1 at parameter t
	const pointOnE1 = (t: number): Vec2 => {
		const up = rx1 * Math.cos(t);
		const vp = ry1 * Math.sin(t);
		return {
			x: sc1.x + up * ux1 + vp * vx1,
			y: sc1.y + up * uy1 + vp * vy1,
		};
	};

	// Implicit value F2 of a point on e2: F2 = 0 on perimeter
	const implicitE2 = (p: Vec2): number => {
		const dx = p.x - sc2.x;
		const dy = p.y - sc2.y;
		const u = dx * ux2 + dy * uy2;
		const v = dx * vx2 + dy * vy2;
		return (u * u) / (rx2 * rx2) + (v * v) / (ry2 * ry2) - 1.0;
	};

	const g = (t: number) => implicitE2(pointOnE1(t));

	const N = 128;
	const step = TWO_PI / N;
	const gVals: number[] = new Array(N + 1);
	for (let i = 0; i <= N; i++) {
		gVals[i] = g(i * step);
	}

	const roots: number[] = [];
	for (let i = 0; i < N; i++) {
		const tA = i * step;
		const tB = (i + 1) * step;
		const gA = gVals[i];
		const gB = gVals[i + 1];

		if (gA * gB <= 0) {
			let low = tA;
			let high = tB;
			let fLow = gA;
			for (let iter = 0; iter < 28; iter++) {
				const mid = (low + high) * 0.5;
				const fMid = g(mid);
				if (Math.abs(fMid) < 1e-12 || high - low < 1e-10) {
					low = mid;
					break;
				}
				if (fLow * fMid <= 0) {
					high = mid;
				} else {
					low = mid;
					fLow = fMid;
				}
			}
			roots.push((low + high) * 0.5);
		} else if (Math.abs(gA) < 1e-4 && (i === 0 || Math.abs(gA) <= Math.abs(gVals[i - 1])) && Math.abs(gA) <= Math.abs(gB)) {
			// Near tangency minimum
			roots.push(tA);
		}
	}

	const pts: Vec2[] = [];
	for (const t of roots) {
		const svgP = pointOnE1(t);
		const worldP: Vec2 = { x: svgP.x, y: -svgP.y };

		let ok1 = true;
		if (e1.type === 'arc') ok1 = isPointOnArc(worldP, e1);
		else if (e1.type === 'elliptical_arc') ok1 = isPointOnEllipticalArc(worldP, e1);

		let ok2 = true;
		if (e2.type === 'arc') ok2 = isPointOnArc(worldP, e2);
		else if (e2.type === 'elliptical_arc') ok2 = isPointOnEllipticalArc(worldP, e2);

		if (ok1 && ok2) {
			pts.push(worldP);
		}
	}
	return deduplicatePoints(pts);
}

function findBezierImplicitRoots(b: BezierSegment, f: (p: Vec2) => number): Vec2[] {
	const N = 16;
	const vals: number[] = new Array(N + 1);
	for (let i = 0; i <= N; i++) {
		vals[i] = f(evaluateBezier(b, i / N));
	}

	const roots: number[] = [];
	for (let i = 0; i < N; i++) {
		const tA = i / N;
		const tB = (i + 1) / N;
		const vA = vals[i];
		const vB = vals[i + 1];

		if (vA * vB <= 0) {
			let low = tA;
			let high = tB;
			let fLow = vA;
			for (let iter = 0; iter < 28; iter++) {
				const mid = (low + high) * 0.5;
				const fMid = f(evaluateBezier(b, mid));
				if (Math.abs(fMid) < 1e-12 || high - low < 1e-10) {
					low = mid;
					break;
				}
				if (fLow * fMid <= 0) {
					high = mid;
				} else {
					low = mid;
					fLow = fMid;
				}
			}
			roots.push((low + high) * 0.5);
		} else if (Math.abs(vA) < 1e-4 && (i === 0 || Math.abs(vA) <= Math.abs(vals[i - 1])) && Math.abs(vA) <= Math.abs(vB)) {
			roots.push(tA);
		}
	}
	return roots.map(t => evaluateBezier(b, t));
}

/**
 * Computes all intersection points between two cubic Bezier segments using recursive bounding box subdivision
 * and Newton-Raphson parameter refinement.
 */
export function intersectBezierBezier(b1: BezierSegment, b2: BezierSegment): Vec2[] {
	const pts: Vec2[] = [];

	function getBBox(b: BezierSegment) {
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < 4; i++) {
			const p = b[i];
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		return { minX, maxX, minY, maxY };
	}

	interface Task {
		seg1: BezierSegment;
		t0: number;
		t1: number;
		seg2: BezierSegment;
		u0: number;
		u1: number;
		depth: number;
	}

	const stack: Task[] = [{ seg1: b1, t0: 0, t1: 1, seg2: b2, u0: 0, u1: 1, depth: 0 }];

	while (stack.length > 0 && pts.length < 16) {
		const { seg1, t0, t1, seg2, u0, u1, depth } = stack.pop()!;
		const box1 = getBBox(seg1);
		const box2 = getBBox(seg2);

		if (
			box1.maxX < box2.minX - 1e-4 ||
			box1.minX > box2.maxX + 1e-4 ||
			box1.maxY < box2.minY - 1e-4 ||
			box1.minY > box2.maxY + 1e-4
		) {
			continue;
		}

		const span1 = Math.max(box1.maxX - box1.minX, box1.maxY - box1.minY);
		const span2 = Math.max(box2.maxX - box2.minX, box2.maxY - box2.minY);

		if ((span1 < 1e-4 && span2 < 1e-4) || depth >= 15) {
			let t = (t0 + t1) * 0.5;
			let u = (u0 + u1) * 0.5;

			// Newton-Raphson refinement on the full segments b1 and b2
			for (let iter = 0; iter < 4; iter++) {
				const p1 = evaluateBezier(b1, t);
				const p2 = evaluateBezier(b2, u);
				const fx = p1.x - p2.x;
				const fy = p1.y - p2.y;
				if (Math.hypot(fx, fy) < 1e-11) break;

				const d1 = evaluateBezierDerivative(b1, t);
				const d2 = evaluateBezierDerivative(b2, u);
				const det = -d1.x * d2.y + d1.y * d2.x;
				if (Math.abs(det) < 1e-12) break;

				const dt = (-d2.y * fx + d2.x * fy) / det;
				const du = (-d1.y * fx + d1.x * fy) / det;

				t = Math.max(0, Math.min(1, t - dt));
				u = Math.max(0, Math.min(1, u - du));
			}

			const p1 = evaluateBezier(b1, t);
			const p2 = evaluateBezier(b2, u);
			if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 1e-3) {
				pts.push({ x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 });
			}
			continue;
		}

		const split1 = span1 >= 1e-4;
		const split2 = span2 >= 1e-4;

		if (split1 && split2) {
			const s1 = splitBezier(seg1, 0.5);
			const s2 = splitBezier(seg2, 0.5);
			const tm = (t0 + t1) * 0.5;
			const um = (u0 + u1) * 0.5;
			stack.push({ seg1: s1.left, t0, t1: tm, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({ seg1: s1.left, t0, t1: tm, seg2: s2.right, u0: um, u1, depth: depth + 1 });
			stack.push({ seg1: s1.right, t0: tm, t1, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({ seg1: s1.right, t0: tm, t1, seg2: s2.right, u0: um, u1, depth: depth + 1 });
		} else if (split1) {
			const s1 = splitBezier(seg1, 0.5);
			const tm = (t0 + t1) * 0.5;
			stack.push({ seg1: s1.left, t0, t1: tm, seg2, u0, u1, depth: depth + 1 });
			stack.push({ seg1: s1.right, t0: tm, t1, seg2, u0, u1, depth: depth + 1 });
		} else {
			const s2 = splitBezier(seg2, 0.5);
			const um = (u0 + u1) * 0.5;
			stack.push({ seg1, t0, t1, seg2: s2.left, u0, u1: um, depth: depth + 1 });
			stack.push({ seg1, t0, t1, seg2: s2.right, u0, u1, depth: depth + 1 });
		}
	}

	return deduplicatePoints(pts, 1e-3);
}

export function intersectSplineCurve(spline: GeoSpline, other: GeoCurve): Vec2[] {
	if (spline.id === other.id) return [];
	const pts: Vec2[] = [];

	for (const b of spline.bezierSegments) {
		if (other.type === 'segment') {
			const p1 = other.p1;
			const p2 = other.p2;
			const A = -(p2.y - p1.y);
			const B = p2.x - p1.x;
			const C = -(A * p1.x + B * p1.y);
			const len = Math.hypot(A, B);
			if (len < 1e-12) continue;

			const f = (p: Vec2) => (A * p.x + B * p.y + C) / len;
			const rPts = findBezierImplicitRoots(b, f);
			for (const rPt of rPts) {
				const proj = projectPointOntoSegment(rPt, p1, p2);
				if (proj.dist < 1e-3 && proj.t >= -1e-4 && proj.t <= 1 + 1e-4) {
					pts.push(rPt);
				}
			}
		} else if (other.type === 'circle' || other.type === 'arc') {
			const f = (p: Vec2) => Math.hypot(p.x - other.center.x, p.y - other.center.y) - other.radius;
			const rPts = findBezierImplicitRoots(b, f);
			for (const rPt of rPts) {
				if (other.type === 'circle' || isPointOnArc(rPt, other)) {
					pts.push(rPt);
				}
			}
		} else if (other.type === 'ellipse' || other.type === 'elliptical_arc') {
			const sc = { x: other.center.x, y: -other.center.y };
			const maj = { x: other.majorAxisPoint.x, y: -other.majorAxisPoint.y };
			const min = { x: other.minorAxisPoint.x, y: -other.minorAxisPoint.y };
			const rx = Math.hypot(maj.x - sc.x, maj.y - sc.y);
			const ry = Math.hypot(min.x - sc.x, min.y - sc.y);
			if (rx < 1e-6 || ry < 1e-6) continue;
			const theta = Math.atan2(maj.y - sc.y, maj.x - sc.x);
			const ux = Math.cos(theta), uy = Math.sin(theta);
			const vx = -Math.sin(theta), vy = Math.cos(theta);

			const f = (p: Vec2) => {
				const sp = { x: p.x, y: -p.y };
				const dx = sp.x - sc.x;
				const dy = sp.y - sc.y;
				const up = dx * ux + dy * uy;
				const vp = dx * vx + dy * vy;
				return (up * up) / (rx * rx) + (vp * vp) / (ry * ry) - 1.0;
			};
			const rPts = findBezierImplicitRoots(b, f);
			for (const rPt of rPts) {
				if (other.type === 'ellipse' || isPointOnEllipticalArc(rPt, other)) {
					pts.push(rPt);
				}
			}
		} else if (other.type === 'spline') {
			for (const b2 of other.bezierSegments) {
				const bPts = intersectBezierBezier(b, b2);
				for (const pt of bPts) {
					pts.push(pt);
				}
			}
		}
	}

	return deduplicatePoints(pts);
}

/**
 * Finds all intersection points between two arbitrary GeoCurves.
 */
export function intersectCurves(c1: GeoCurve, c2: GeoCurve): Vec2[] {
	if (c1.id === c2.id) return [];

	if (c1.type === 'spline') {
		return intersectSplineCurve(c1, c2);
	}
	if (c2.type === 'spline') {
		return intersectSplineCurve(c2, c1);
	}

	if (c1.type === 'segment') {
		if (c2.type === 'segment') return intersectSegmentSegment(c1, c2);
		if (c2.type === 'circle' || c2.type === 'arc') return intersectSegmentCircle(c1, c2);
		return intersectSegmentEllipse(c1, c2);
	}

	if (c2.type === 'segment') {
		if (c1.type === 'circle' || c1.type === 'arc') return intersectSegmentCircle(c2, c1);
		return intersectSegmentEllipse(c2, c1);
	}

	if ((c1.type === 'circle' || c1.type === 'arc') && (c2.type === 'circle' || c2.type === 'arc')) {
		return intersectCircleCircle(c1, c2);
	}

	return intersectEllipseEllipse(c1, c2);
}

/**
 * Computes all intersection points of `target` curve with all other curves in `allCurves`.
 * Returns intersection points with their parameter values along `target`.
 */
export interface CurveIntersection {
	point: Vec2;
	param: number;
	cuttingCurveId: string;
	cuttingCurveType: CurveType;
}

/**
 * Finds all intersection points of `target` with `allCurves` (excluding target itself),
 * parameterized along target curve in ascending order.
 */
export function getCurveIntersections(
	target: GeoCurve,
	allCurves: GeoCurve[]
): CurveIntersection[] {
	const results: CurveIntersection[] = [];

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const pts = intersectCurves(target, other);
		for (const pt of pts) {
			const param = getParamAtPoint(target, pt);
			// For open curves (segment, arc, elliptical_arc, open spline), ignore intersections right at the endpoints
			if (
				target.type === 'segment' ||
				target.type === 'arc' ||
				target.type === 'elliptical_arc' ||
				(target.type === 'spline' && !target.isClosed)
			) {
				if (param < 1e-4 || param > 1 - 1e-4) {
					continue;
				}
			}
			results.push({ point: pt, param, cuttingCurveId: other.id, cuttingCurveType: other.type });
		}
	}

	// Sort and deduplicate by param
	results.sort((a, b) => a.param - b.param);
	const unique: CurveIntersection[] = [];
	for (const item of results) {
		const eps = target.type === 'circle' || target.type === 'ellipse' ? 1e-3 : 1e-4;
		const exists = unique.some(u => Math.abs(u.param - item.param) < eps);
		if (!exists) {
			unique.push(item);
		}
	}

	return unique;
}

/**
 * Computes the TrimCandidate (the exact segment containing `cursorWorldPos` to be removed).
 */
export function getTrimCandidate(
	target: GeoCurve,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): TrimCandidate | null {
	const intersections = getCurveIntersections(target, allCurves);
	const cursorParam = getParamAtPoint(target, cursorWorldPos);

	const isClosedCurve =
		target.type === 'circle' ||
		target.type === 'ellipse' ||
		(target.type === 'spline' && target.splineType !== 'control' && !!target.isClosed);

	if (!isClosedCurve) {
		// Open curves: domain [0, 1]
		if (intersections.length === 0) {
			// Entire curve will be removed
			return {
				curve: target,
				interval: [0, 1],
				cutStartWorld: getPointAtParam(target, 0),
				cutEndWorld: getPointAtParam(target, 1),
				isWholeEntity: true,
			};
		}

		// Partition into intervals between [0, p1, p2, ..., 1]
		const params = [0, ...intersections.map(i => i.param), 1];
		for (let i = 0; i < params.length - 1; i++) {
			const pA = params[i];
			const pB = params[i + 1];
			if (cursorParam >= pA - 1e-5 && cursorParam <= pB + 1e-5) {
				const startCut = i > 0 ? intersections[i - 1] : undefined;
				const endCut = i < intersections.length ? intersections[i] : undefined;
				return {
					curve: target,
					interval: [pA, pB],
					cutStartWorld: getPointAtParam(target, pA),
					cutEndWorld: getPointAtParam(target, pB),
					startCuttingCurveId: startCut?.cuttingCurveId,
					startCuttingCurveType: startCut?.cuttingCurveType,
					endCuttingCurveId: endCut?.cuttingCurveId,
					endCuttingCurveType: endCut?.cuttingCurveType,
					isWholeEntity: false,
				};
			}
		}

		// Fallback to nearest interval
		const fallbackEnd = intersections[0];
		return {
			curve: target,
			interval: [0, params[1]],
			cutStartWorld: getPointAtParam(target, 0),
			cutEndWorld: getPointAtParam(target, params[1]),
			endCuttingCurveId: fallbackEnd?.cuttingCurveId,
			endCuttingCurveType: fallbackEnd?.cuttingCurveType,
			isWholeEntity: false,
		};
	}

	// Closed curves (Circle, Ellipse, Closed Spline):
	const period = target.type === 'circle' || target.type === 'ellipse' ? TWO_PI : 1.0;

	if (intersections.length < 2) {
		// As requested: closed curves with < 2 intersections are completely deleted!
		return {
			curve: target,
			interval: [0, period],
			cutStartWorld: getPointAtParam(target, 0),
			cutEndWorld: getPointAtParam(target, period),
			isWholeEntity: true,
		};
	}

	// For >= 2 intersections on closed curve:
	// Cyclic intervals: [p0, p1], [p1, p2], ..., [pn-1, p0] (wrapping)
	const thetas = intersections.map(i => i.param);
	const n = thetas.length;

	let chosenIdxA = n - 1;
	let chosenIdxB = 0;

	let found = false;
	for (let i = 0; i < n - 1; i++) {
		if (cursorParam >= thetas[i] - 1e-5 && cursorParam <= thetas[i + 1] + 1e-5) {
			chosenIdxA = i;
			chosenIdxB = i + 1;
			found = true;
			break;
		}
	}
	if (!found) {
		chosenIdxA = n - 1;
		chosenIdxB = 0;
	}

	const cutA = intersections[chosenIdxA];
	const cutB = intersections[chosenIdxB];

	return {
		curve: target,
		interval: [cutA.param, cutB.param],
		cutStartWorld: getPointAtParam(target, cutA.param),
		cutEndWorld: getPointAtParam(target, cutB.param),
		startCuttingCurveId: cutA.cuttingCurveId,
		startCuttingCurveType: cutA.cuttingCurveType,
		endCuttingCurveId: cutB.cuttingCurveId,
		endCuttingCurveType: cutB.cuttingCurveType,
		isWholeEntity: false,
	};
}

/**
 * Creates a new cut endpoint at pos.
 * - If an existing point in sketch is at pos (within eps), adds a CoincidentConstraint (point-point).
 * - Otherwise, if cut by a line, attaches point-on-line constraint; if cut by a circle/arc, attaches point-on-circle constraint.
 */
export function createCutPoint(
	sketch: SketchDocument,
	pos: Vec2,
	cuttingCurveId?: string,
	cuttingCurveType?: CurveType,
	eps = 1e-3
): SketchPoint {
	const newPt = sketch.addPoint(pos.x, pos.y);

	// Check if there is already an existing point at pos (excluding newPt)
	let attachedCoincident = false;
	for (const pt of sketch.points.values()) {
		if (pt.id !== newPt.id && Math.hypot(pt.x - pos.x, pt.y - pos.y) < eps) {
			const c = sketch.addCoincidentConstraint(newPt.id, pt.id);
			if (c) {
				attachedCoincident = true;
				break;
			}
		}
	}

	// If no existing point was at this position, attach to the cutting entity
	if (!attachedCoincident && cuttingCurveId) {
		if (cuttingCurveType === 'segment') {
			sketch.addPointOnLineConstraint(newPt.id, cuttingCurveId);
		} else if (cuttingCurveType === 'circle' || cuttingCurveType === 'arc') {
			sketch.addPointOnCircleConstraint(newPt.id, cuttingCurveId);
		}
	}

	return newPt;
}

/**
 * Backward compatibility alias for createCutPoint.
 */
export function getOrCreatePointAt(
	sketch: SketchDocument,
	pos: Vec2,
	cuttingCurveId?: string,
	cuttingCurveType?: CurveType,
	eps = 1e-3
): SketchPoint {
	return createCutPoint(sketch, pos, cuttingCurveId, cuttingCurveType, eps);
}

function matchesEndpoints(pA: string, pB: string, end1: string, end2: string): boolean {
	return (pA === end1 && pB === end2) || (pA === end2 && pB === end1);
}

function getLineConstraints(sketch: SketchDocument, line: SketchLine): IConstraint[] {
	const constraints = sketch.getConstraintsForEntity('line', line.id);
	for (const c of sketch.constraints.values()) {
		if (c instanceof PointToLineDistanceConstraint && c.lineId === line.id) {
			if (!constraints.some(sc => sc.id === c.id)) {
				constraints.push(c);
			}
		}
	}
	return constraints;
}

function transferLineConstraints(
	sketch: SketchDocument,
	oldLine: SketchLine,
	newLine: SketchLine,
	oldConstraints: IConstraint[]
): void {
	for (const c of oldConstraints) {
		if (c instanceof HorizontalConstraint) {
			sketch.addHorizontalConstraint(newLine.p1Id, newLine.p2Id);
		} else if (c instanceof VerticalConstraint) {
			sketch.addVerticalConstraint(newLine.p1Id, newLine.p2Id);
		} else if (c instanceof ParallelConstraint) {
			const isL1 = matchesEndpoints(c.l1P1, c.l1P2, oldLine.p1Id, oldLine.p2Id);
			const otherP1 = isL1 ? c.l2P1 : c.l1P1;
			const otherP2 = isL1 ? c.l2P2 : c.l1P2;
			const otherLine = sketch.getLineBetween(otherP1, otherP2);
			if (otherLine && otherLine.id !== oldLine.id) {
				sketch.addParallelConstraint(newLine.id, otherLine.id);
			}
		} else if (c instanceof CollinearConstraint) {
			const isL1 = matchesEndpoints(c.l1P1, c.l1P2, oldLine.p1Id, oldLine.p2Id);
			const otherP1 = isL1 ? c.l2P1 : c.l1P1;
			const otherP2 = isL1 ? c.l2P2 : c.l1P2;
			const otherLine = sketch.getLineBetween(otherP1, otherP2);
			if (otherLine && otherLine.id !== oldLine.id) {
				sketch.addCollinearConstraint(newLine.id, otherLine.id);
			}
		} else if (c instanceof PerpendicularConstraint) {
			const isL1 = matchesEndpoints(c.l1P1, c.l1P2, oldLine.p1Id, oldLine.p2Id);
			const otherP1 = isL1 ? c.l2P1 : c.l1P1;
			const otherP2 = isL1 ? c.l2P2 : c.l1P2;
			const otherLine = sketch.getLineBetween(otherP1, otherP2);
			if (otherLine && otherLine.id !== oldLine.id) {
				sketch.addPerpendicularConstraint(newLine.id, otherLine.id);
			}
		} else if (c instanceof AngleConstraint) {
			const isL1 = c.line1Id === oldLine.id || matchesEndpoints(c.l1P1, c.l1P2, oldLine.p1Id, oldLine.p2Id);
			const otherId = isL1 ? c.line2Id : c.line1Id;
			const otherP1 = isL1 ? c.l2P1 : c.l1P1;
			const otherP2 = isL1 ? c.l2P2 : c.l1P2;
			const otherLine = sketch.lines.get(otherId) ?? sketch.getLineBetween(otherP1, otherP2);
			if (otherLine && otherLine.id !== oldLine.id) {
				if (isL1) {
					sketch.addAngleConstraint(newLine.id, otherLine.id, c.targetAngle, c.arcRadius, c.s1, c.s2, c.sign);
				} else {
					sketch.addAngleConstraint(otherLine.id, newLine.id, c.targetAngle, c.arcRadius, c.s1, c.s2, c.sign);
				}
			}
		} else if (c instanceof TangentLineCircleConstraint) {
			sketch.addTangentConstraint(newLine.id, c.circleId);
		} else if (c instanceof PointOnLineConstraint) {
			if (matchesEndpoints(c.lineP1Id, c.lineP2Id, oldLine.p1Id, oldLine.p2Id)) {
				if (c.pointId !== newLine.p1Id && c.pointId !== newLine.p2Id) {
					sketch.addPointOnLineConstraint(c.pointId, newLine.id);
				}
			}
		} else if (c instanceof PointToLineDistanceConstraint) {
			if (c.lineId === oldLine.id || matchesEndpoints(c.lineP1Id, c.lineP2Id, oldLine.p1Id, oldLine.p2Id)) {
				if (c.pointId !== newLine.p1Id && c.pointId !== newLine.p2Id) {
					sketch.addPointToLineDistanceConstraint(c.pointId, newLine.id, c.targetDistance, c.offset);
				}
			}
		} else if (c instanceof SymmetryConstraint) {
			if (c.lineId === oldLine.id || matchesEndpoints(c.lineP1Id, c.lineP2Id, oldLine.p1Id, oldLine.p2Id)) {
				if (c.p1Id !== newLine.p1Id && c.p1Id !== newLine.p2Id && c.p2Id !== newLine.p1Id && c.p2Id !== newLine.p2Id) {
					sketch.addSymmetryConstraint(c.p1Id, c.p2Id, newLine.id);
				}
			}
		}
	}
}

function replaceSplineWithInterval(
	sketch: SketchDocument,
	originalSpline: SketchSpline,
	curve: GeoSpline,
	uA: number,
	uB: number,
	startPointId: string,
	endPointId: string
): void {
	if (curve.bezierSegments.length === 0) return;

	const subSegments = extractSplineInterval(curve.bezierSegments, uA, uB);
	if (subSegments.length === 0) return;

	const M = subSegments.length;
	const rawPoints: Vec2[] = [];
	const rawHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];

	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			const p0 = subSegments[0][0];
			rawPoints.push(p0);
			const v = {
				x: subSegments[0][1].x - p0.x,
				y: subSegments[0][1].y - p0.y,
			};
			rawHandles.push({
				h1: { x: p0.x - v.x, y: p0.y - v.y },
				h2: { x: p0.x + v.x, y: p0.y + v.y },
			});
		} else if (j === M) {
			const pM = subSegments[M - 1][3];
			rawPoints.push(pM);
			const v = {
				x: pM.x - subSegments[M - 1][2].x,
				y: pM.y - subSegments[M - 1][2].y,
			};
			rawHandles.push({
				h1: { x: pM.x - v.x, y: pM.y - v.y },
				h2: { x: pM.x + v.x, y: pM.y + v.y },
			});
		} else {
			const pJ = subSegments[j][0];
			rawPoints.push(pJ);
			rawHandles.push({
				h1: { x: subSegments[j - 1][2].x, y: subSegments[j - 1][2].y },
				h2: { x: subSegments[j][1].x, y: subSegments[j][1].y },
			});
		}
	}

	// Filter any degenerate segments (points closer than 1e-3)
	const points: Vec2[] = [];
	const handles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let k = 0; k < rawPoints.length; k++) {
		if (points.length === 0 || Math.hypot(rawPoints[k].x - points[points.length - 1].x, rawPoints[k].y - points[points.length - 1].y) >= 1e-3) {
			points.push(rawPoints[k]);
			handles.push(rawHandles[k]);
		}
	}
	if (points.length < 2) return;

	// Assign startPointId, matched intermediate IDs, and endPointId
	const ptIds: string[] = [startPointId];
	for (let k = 1; k < points.length - 1; k++) {
		const pos = points[k];
		let matchedId: string | null = null;
		for (const pid of originalSpline.pointIds) {
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
		ptIds.push(matchedId);
	}
	ptIds.push(endPointId);

	// Deduplicate consecutive identical IDs if any
	const cleanPtIds: string[] = [];
	const cleanHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let k = 0; k < ptIds.length; k++) {
		if (cleanPtIds.length === 0 || cleanPtIds[cleanPtIds.length - 1] !== ptIds[k]) {
			cleanPtIds.push(ptIds[k]);
			cleanHandles.push(handles[k]);
		}
	}

	if (cleanPtIds.length < 2) return;

	if (originalSpline.splineType === 'control') {
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
			for (const pid of originalSpline.pointIds) {
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

		sketch.addControlSpline(controlPtIds, originalSpline.isConstruction, undefined, false, knots);
		return;
	}

	if (originalSpline.splineType === 'fit') {
		sketch.addFitSpline(cleanPtIds, undefined, originalSpline.isConstruction, undefined, false, cleanHandles);
	}
}

/**
 * Executes a trim on the SketchDocument given a TrimCandidate.
 */
export function executeTrim(sketch: SketchDocument, candidate: TrimCandidate): void {
	const { curve, interval, isWholeEntity } = candidate;

	if (isWholeEntity) {
		sketch.removeEntity(curve.id);
		return;
	}

	if (curve.type === 'segment') {
		const line = sketch.lines.get(curve.id);
		if (!line) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) {
			sketch.removeEntity(line.id);
			return;
		}

		if (isStart) {
			// Trim off start: keep [uB, 1]
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const newLine = sketch.addLine(pB.id, line.p2Id, line.isConstruction);

			// Inherit constraints from old line
			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, newLine, oldConstraints);
			sketch.removeEntity(line.id);
		} else if (isEnd) {
			// Trim off end: keep [0, uA]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const newLine = sketch.addLine(line.p1Id, pA.id, line.isConstruction);

			// Inherit constraints from old line
			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, newLine, oldConstraints);
			sketch.removeEntity(line.id);
		} else {
			// Trim middle: keep [0, uA] and [uB, 1]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

			const line1 = sketch.addLine(line.p1Id, pA.id, line.isConstruction);
			const line2 = sketch.addLine(pB.id, line.p2Id, line.isConstruction);

			// Rule 2: 2 new points must have point on line constraint
			sketch.addPointOnLineConstraint(pA.id, line2.id);
			sketch.addPointOnLineConstraint(pB.id, line1.id);

			// Transfer orientation constraints to line1
			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, line1, oldConstraints);
			sketch.removeEntity(line.id);
		}
	} else if (curve.type === 'circle') {
		const circle = sketch.circles.get(curve.id);
		if (!circle) return;
		const [thetaA, thetaB] = interval;

		// Cut from thetaA to thetaB in clockwise direction.
		// Remaining is arc from thetaB around clockwise to thetaA!
		const pA = createCutPoint(sketch, getPointAtParam(curve, thetaA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = createCutPoint(sketch, getPointAtParam(curve, thetaB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		// Check if old circle had a RadiusConstraint
		const radConstraint = sketch.getConstraintsForEntity('circle', circle.id).find(
			c => c.type === 'radius'
		) as any;

		// Add arc FIRST to keep centerId in use
		const newArc = sketch.addArc(circle.centerId, pB.id, pA.id, circle.radius, true, circle.isConstruction);
		sketch.removeEntity(circle.id);

		if (radConstraint && radConstraint.targetRadius) {
			sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
		}
	} else if (curve.type === 'arc') {
		const arc = sketch.arcs.get(curve.id);
		if (!arc) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) {
			sketch.removeEntity(arc.id);
			return;
		}

		const radConstraint = sketch.getConstraintsForEntity('arc', arc.id).find(
			c => c.type === 'radius'
		) as any;

		if (isStart) {
			// Trim off start: keep [uB, 1]
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const newArc = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else if (isEnd) {
			// Trim off end: keep [0, uA]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const newArc = sketch.addArc(arc.centerId, arc.startPointId, pA.id, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else {
			// Trim middle: keep [0, uA] and [uB, 1]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pA.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		}
	} else if (curve.type === 'ellipse') {
		const ellipse = sketch.ellipses.get(curve.id);
		if (!ellipse) return;
		const [thetaA, thetaB] = interval;

		// Cut from thetaA to thetaB. Remaining is elliptical arc from thetaB around clockwise to thetaA!
		const pA = createCutPoint(sketch, getPointAtParam(curve, thetaA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = createCutPoint(sketch, getPointAtParam(curve, thetaB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		// Add elliptical arc FIRST to keep center and axis points in use
		sketch.addEllipticalArc(
			ellipse.centerId,
			ellipse.majorAxisPointId,
			ellipse.minorAxisPointId,
			pB.id,
			pA.id,
			true,
			ellipse.isConstruction
		);
		sketch.removeEntity(ellipse.id);
	} else if (curve.type === 'elliptical_arc') {
		const arc = sketch.ellipticalArcs.get(curve.id);
		if (!arc) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) {
			sketch.removeEntity(arc.id);
			return;
		}

		if (isStart) {
			// Trim off start: keep [uB, 1]
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				pB.id,
				arc.endPointId,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.removeEntity(arc.id);
		} else if (isEnd) {
			// Trim off end: keep [0, uA]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				arc.startPointId,
				pA.id,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.removeEntity(arc.id);
		} else {
			// Trim middle: keep [0, uA] and [uB, 1]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				arc.startPointId,
				pA.id,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				pB.id,
				arc.endPointId,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.removeEntity(arc.id);
		}
	} else if (curve.type === 'spline') {
		const spline = sketch.splines.get(curve.id);
		if (!spline) return;
		const [uA, uB] = interval;

		if (spline.isClosed && spline.splineType === 'fit') {
			// Closed spline: cut out [uA, uB], remaining is an open spline from uB around to uA!
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, uB, uA, pB.id, pA.id);
			sketch.removeEntity(spline.id);
			return;
		}

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) {
			sketch.removeEntity(spline.id);
			return;
		}

		if (isStart) {
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else if (isEnd) {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			sketch.removeEntity(spline.id);
		} else {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		}
	}
}

/**
 * Executes a break/split on the SketchDocument given a TrimCandidate.
 * Unlike trim, it does NOT delete the candidate interval, but splits the curve
 * into segments at the cut points.
 */
export function executeBreak(sketch: SketchDocument, candidate: TrimCandidate): void {
	const { curve, interval, isWholeEntity } = candidate;

	if (isWholeEntity) {
		return;
	}

	if (curve.type === 'segment') {
		const line = sketch.lines.get(curve.id);
		if (!line) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) {
			return;
		}

		if (isStart) {
			// One cut at uB: split into [0, uB] and [uB, 1]
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const line1 = sketch.addLine(line.p1Id, pB.id, line.isConstruction);
			sketch.addLine(pB.id, line.p2Id, line.isConstruction);

			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, line1, oldConstraints);
			sketch.removeEntity(line.id);
		} else if (isEnd) {
			// One cut at uA: split into [0, uA] and [uA, 1]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const line1 = sketch.addLine(line.p1Id, pA.id, line.isConstruction);
			sketch.addLine(pA.id, line.p2Id, line.isConstruction);

			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, line1, oldConstraints);
			sketch.removeEntity(line.id);
		} else {
			// Two cuts at uA and uB: split into [0, uA], [uA, uB], and [uB, 1]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

			const line1 = sketch.addLine(line.p1Id, pA.id, line.isConstruction);
			sketch.addLine(pA.id, pB.id, line.isConstruction);
			sketch.addLine(pB.id, line.p2Id, line.isConstruction);

			const oldConstraints = getLineConstraints(sketch, line);
			for (const c of oldConstraints) {
				sketch.removeConstraint(c.id);
			}
			transferLineConstraints(sketch, line, line1, oldConstraints);
			sketch.removeEntity(line.id);
		}
	} else if (curve.type === 'circle') {
		const circle = sketch.circles.get(curve.id);
		if (!circle) return;
		const [thetaA, thetaB] = interval;

		const pA = createCutPoint(sketch, getPointAtParam(curve, thetaA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = createCutPoint(sketch, getPointAtParam(curve, thetaB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		const radConstraint = sketch.getConstraintsForEntity('circle', circle.id).find(
			c => c.type === 'radius'
		) as any;

		// Break into 2 arcs covering the full circle
		const arc1 = sketch.addArc(circle.centerId, pB.id, pA.id, circle.radius, true, circle.isConstruction);
		const arc2 = sketch.addArc(circle.centerId, pA.id, pB.id, circle.radius, true, circle.isConstruction);

		sketch.removeEntity(circle.id);

		if (radConstraint && radConstraint.targetRadius) {
			sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
			sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
		}
	} else if (curve.type === 'arc') {
		const arc = sketch.arcs.get(curve.id);
		if (!arc) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) return;

		const radConstraint = sketch.getConstraintsForEntity('arc', arc.id).find(
			c => c.type === 'radius'
		) as any;

		if (isStart) {
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pB.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else if (isEnd) {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pA.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pA.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pA.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pA.id, pB.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc3 = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc3.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		}
	} else if (curve.type === 'ellipse') {
		const ellipse = sketch.ellipses.get(curve.id);
		if (!ellipse) return;
		const [thetaA, thetaB] = interval;

		const pA = createCutPoint(sketch, getPointAtParam(curve, thetaA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = createCutPoint(sketch, getPointAtParam(curve, thetaB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		sketch.addEllipticalArc(
			ellipse.centerId,
			ellipse.majorAxisPointId,
			ellipse.minorAxisPointId,
			pB.id,
			pA.id,
			true,
			ellipse.isConstruction
		);
		sketch.addEllipticalArc(
			ellipse.centerId,
			ellipse.majorAxisPointId,
			ellipse.minorAxisPointId,
			pA.id,
			pB.id,
			true,
			ellipse.isConstruction
		);
		sketch.removeEntity(ellipse.id);
	} else if (curve.type === 'elliptical_arc') {
		const arc = sketch.ellipticalArcs.get(curve.id);
		if (!arc) return;
		const [uA, uB] = interval;

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) return;

		if (isStart) {
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, arc.startPointId, pB.id, arc.clockwise, arc.isConstruction);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, pB.id, arc.endPointId, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
		} else if (isEnd) {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, arc.startPointId, pA.id, arc.clockwise, arc.isConstruction);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, pA.id, arc.endPointId, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
		} else {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, arc.startPointId, pA.id, arc.clockwise, arc.isConstruction);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, pA.id, pB.id, arc.clockwise, arc.isConstruction);
			sketch.addEllipticalArc(arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, pB.id, arc.endPointId, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
		}
	} else if (curve.type === 'spline') {
		const spline = sketch.splines.get(curve.id);
		if (!spline) return;
		const [uA, uB] = interval;

		if (spline.isClosed && spline.splineType === 'fit') {
			// Closed spline: break into 2 open splines covering the full loop: [uA, uB] and [uB, uA]
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, uA, uB, pA.id, pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, uA, pB.id, pA.id);
			sketch.removeEntity(spline.id);
			return;
		}

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) return;

		if (isStart) {
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, 0, uB, spline.pointIds[0], pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else if (isEnd) {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			replaceSplineWithInterval(sketch, spline, curve, uA, 1, pA.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else {
			const pA = createCutPoint(sketch, getPointAtParam(curve, uA), candidate.startCuttingCurveId, candidate.startCuttingCurveType);
			const pB = createCutPoint(sketch, getPointAtParam(curve, uB), candidate.endCuttingCurveId, candidate.endCuttingCurveType);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			replaceSplineWithInterval(sketch, spline, curve, uA, uB, pA.id, pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		}
	}
}


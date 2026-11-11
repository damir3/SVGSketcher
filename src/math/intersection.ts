import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import { Vec2 } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchPoint, SketchLine, SketchSpline } from '../model/types';
import { getSplinePointAtParam, getSplineParamAtPoint, extractSplineInterval, type BezierSegment } from './spline';
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
import { getGeometryKernel } from '../kernel';
import type { IntersectionPair, KernelCurve, Point2 } from '../kernel/types';

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
		return curve.p1.clone().lerp(curve.p2, t);
	} else if (curve.type === 'circle') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const sq = Vec2.fromPolar(curve.radius, param).add(sc);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const as = Vec2.from(sc).angleToPoint(ss);
		const ae = Vec2.from(sc).angleToPoint(se);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const ang = curve.clockwise ? as + u * sweep : as - u * sweep;
		const sq = Vec2.fromPolar(curve.radius, ang).add(sc);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'ellipse') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU: u, axisV: v } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const sq = ellipsePointAtParameter(param, sc, r, u, v);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'elliptical_arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const ts = ellipseParameterAtPoint(ss, sc, r, axisU, axisV);
		const te = ellipseParameterAtPoint(se, sc, r, axisU, axisV);
		let sweep = curve.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const t = curve.clockwise ? ts + u * sweep : ts - u * sweep;
		const sq = ellipsePointAtParameter(t, sc, r, axisU, axisV);
		return new Vec2(sq.x, -sq.y);
	}
	return new Vec2(0, 0);
}

/**
 * Computes parameter of point `pt` (in world coordinates) along `curve`.
 */
export function getParamAtPoint(curve: GeoCurve, pt: Vec2): number {
	if (curve.type === 'spline') {
		return getSplineParamAtPoint(curve.bezierSegments, pt).param;
	} else if (curve.type === 'segment') {
		const dir = new Vec2().subVectors(curve.p2, curve.p1);
		const l2 = dir.lengthSq();
		if (l2 < 1e-12) return 0;
		const t = new Vec2().subVectors(pt, curve.p1).dot(dir) / l2;
		return Math.max(0, Math.min(1, t));
	} else if (curve.type === 'circle') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const sp = new Vec2(pt.x, -pt.y);
		let ang = Vec2.from(sc).angleToPoint(sp);
		if (ang < 0) ang += TWO_PI;
		return ang;
	} else if (curve.type === 'arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const sp = new Vec2(pt.x, -pt.y);
		const as = Vec2.from(sc).angleToPoint(ss);
		const ae = Vec2.from(sc).angleToPoint(se);
		const ap = Vec2.from(sc).angleToPoint(sp);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		let delta = curve.clockwise ? (ap - as) % TWO_PI : (as - ap) % TWO_PI;
		if (delta < 0) delta += TWO_PI;
		if (sweep < 1e-6) return 0;
		return Math.max(0, Math.min(1, delta / sweep));
	} else if (curve.type === 'ellipse') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const sp = new Vec2(pt.x, -pt.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const paramRadii = new Vec2(Math.max(r.x, 1e-6), Math.max(r.y, 1e-6));
		let t = ellipseParameterAtPoint(sp, sc, paramRadii, axisU, axisV);
		if (t < 0) t += TWO_PI;
		return t;
	} else if (curve.type === 'elliptical_arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const sp = new Vec2(pt.x, -pt.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const paramRadii = new Vec2(Math.max(r.x, 1e-6), Math.max(r.y, 1e-6));
		const ts = ellipseParameterAtPoint(ss, sc, paramRadii, axisU, axisV);
		const te = ellipseParameterAtPoint(se, sc, paramRadii, axisU, axisV);
		const tp = ellipseParameterAtPoint(sp, sc, paramRadii, axisU, axisV);
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
	const sc = new Vec2(arc.center.x, -arc.center.y);
	const ss = new Vec2(arc.start.x, -arc.start.y);
	const se = new Vec2(arc.end.x, -arc.end.y);
	const sp = new Vec2(pt.x, -pt.y);
	const as = Vec2.from(sc).angleToPoint(ss);
	const ae = Vec2.from(sc).angleToPoint(se);
	const ap = Vec2.from(sc).angleToPoint(sp);
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
	const sc = new Vec2(arc.center.x, -arc.center.y);
	const smaj = new Vec2(arc.majorAxisPoint.x, -arc.majorAxisPoint.y);
	const smin = new Vec2(arc.minorAxisPoint.x, -arc.minorAxisPoint.y);
	const ss = new Vec2(arc.start.x, -arc.start.y);
	const se = new Vec2(arc.end.x, -arc.end.y);
	const sp = new Vec2(pt.x, -pt.y);
	const r = Vec2.from(sc).distancesTo(smaj, smin);
	if (r.x < 1e-6 || r.y < 1e-6) return false;
	const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
	const ts = ellipseParameterAtPoint(ss, sc, r, axisU, axisV);
	const te = ellipseParameterAtPoint(se, sc, r, axisU, axisV);
	const tp = ellipseParameterAtPoint(sp, sc, r, axisU, axisV);
	let sweep = arc.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
	if (sweep < 0) sweep += TWO_PI;
	let delta = arc.clockwise ? (tp - ts) % TWO_PI : (ts - tp) % TWO_PI;
	if (delta < 0) delta += TWO_PI;
	const angTol = tol / Math.max(Math.min(r.x, r.y), 1);
	return delta <= sweep + angTol || delta >= TWO_PI - angTol;
}

function deduplicatePoints(pts: Vec2[], eps = 1e-4): Vec2[] {
	const res: Vec2[] = [];
	for (const p of pts) {
		const exists = res.some(existing => p.distanceTo(existing) < eps);
		if (!exists) res.push(p);
	}
	return res;
}

// --- INTERSECTION ROUTINES ---

export function intersectSegmentSegment(s1: GeoSegment, s2: GeoSegment): Vec2[] {
	return intersectKernelCurves(s1, s2);
}

export function intersectSegmentCircle(s: GeoSegment, c: GeoCircle | GeoArc): Vec2[] {
	return intersectKernelCurves(s, c);
}

export function intersectSegmentEllipse(s: GeoSegment, e: GeoEllipse | GeoEllipticalArc): Vec2[] {
	return intersectKernelCurves(s, e);
}

export function intersectCircleCircle(c1: GeoCircle | GeoArc, c2: GeoCircle | GeoArc): Vec2[] {
	return intersectKernelCurves(c1, c2);
}

function toKernelCurve(curve: GeoCurve): KernelCurve | null {
	if (curve.type === 'segment') return curve;
	if (curve.type === 'circle' || curve.type === 'arc') {
		return { type: 'circle', center: curve.center, radius: curve.radius };
	}
	if (curve.type === 'ellipse' || curve.type === 'elliptical_arc') {
		return {
			type: 'ellipse',
			center: curve.center,
			majorAxisPoint: curve.majorAxisPoint,
			minorAxisPoint: curve.minorAxisPoint,
		};
	}
	return null;
}

function isWithinCurveSpan(p: Vec2, curve: GeoCurve): boolean {
	if (curve.type === 'arc') return isPointOnArc(p, curve);
	if (curve.type === 'elliptical_arc') return isPointOnEllipticalArc(p, curve);
	return true;
}

function filterKernelPoints(points: Point2[], a: GeoCurve, b: GeoCurve): Vec2[] {
	return deduplicatePoints(points.map(Vec2.from).filter(p => isWithinCurveSpan(p, a) && isWithinCurveSpan(p, b)));
}

function intersectKernelCurves(a: GeoCurve, b: GeoCurve): Vec2[] {
	const points = getGeometryKernel().intersectPairs([{ a: toKernelCurve(a)!, b: toKernelCurve(b)! }])[0];
	return filterKernelPoints(points, a, b);
}

/** Flatten composite splines in legacy traversal order, then intersect all primitive pairs in one call. */
export function intersectCurvePairs(pairs: readonly (readonly [GeoCurve, GeoCurve])[]): Vec2[][] {
	const results: Point2[][] = pairs.map(() => []);
	const supported: IntersectionPair[] = [];
	const indices: number[] = [];
	pairs.forEach(([first, second], i) => {
		// Spline order was defined by the spline operand, even when it was passed second.
		const [a, b] = first.type !== 'spline' && second.type === 'spline' ? [second, first] : [first, second];
		if (a.id === b.id) return;
		const curves = (curve: GeoCurve): KernelCurve[] =>
			curve.type === 'spline'
				? curve.bezierSegments.map(points => ({ type: 'bezier', points }))
				: [toKernelCurve(curve)!];
		const curvesA = curves(a),
			curvesB = curves(b);
		for (const ka of curvesA)
			for (const kb of curvesB) {
				supported.push({ a: ka, b: kb });
				indices.push(i);
			}
	});
	if (supported.length) {
		const hits = getGeometryKernel().intersectPairs(supported);
		indices.forEach((index, i) => {
			for (const point of hits[i]) results[index].push(point);
		});
	}
	return results.map((points, i) => filterKernelPoints(points, pairs[i][0], pairs[i][1]));
}

/**
 * General ellipse/circle vs ellipse/circle intersection using bracketed numerical root finding.
 */
export function intersectEllipseEllipse(
	e1: GeoCircle | GeoArc | GeoEllipse | GeoEllipticalArc,
	e2: GeoCircle | GeoArc | GeoEllipse | GeoEllipticalArc
): Vec2[] {
	return intersectKernelCurves(e1, e2);
}

/** Intersect two cubic segments through the active kernel; retain the 1e-3 pair deduplication. */
export function intersectBezierBezier(b1: BezierSegment, b2: BezierSegment): Vec2[] {
	return getGeometryKernel()
		.intersectPairs([{ a: { type: 'bezier', points: b1 }, b: { type: 'bezier', points: b2 } }])[0]
		.map(Vec2.from);
}

export function intersectSplineCurve(spline: GeoSpline, other: GeoCurve): Vec2[] {
	return intersectCurvePairs([[spline, other]])[0];
}

/**
 * Finds all intersection points between two arbitrary GeoCurves.
 */
export function intersectCurves(c1: GeoCurve, c2: GeoCurve): Vec2[] {
	return intersectCurvePairs([[c1, c2]])[0];
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
export function getCurveIntersections(target: GeoCurve, allCurves: GeoCurve[]): CurveIntersection[] {
	const results: CurveIntersection[] = [];

	const others = allCurves.filter(other => other.id !== target.id);
	const intersections = intersectCurvePairs(others.map(other => [target, other]));
	for (const [index, other] of others.entries()) {
		const pts = intersections[index];
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
			results.push({
				point: pt,
				param,
				cuttingCurveId: other.id,
				cuttingCurveType: other.type,
			});
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
export function getTrimCandidate(target: GeoCurve, allCurves: GeoCurve[], cursorWorldPos: Vec2): TrimCandidate | null {
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
	const newPt = sketch.addPoint(pos);

	// Check if there is already an existing point at pos (excluding newPt)
	let attachedCoincident = false;
	for (const pt of sketch.points.values()) {
		if (pt.id !== newPt.id && pos.distanceTo(pt) < eps) {
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
		} else if (cuttingCurveType === 'ellipse' || cuttingCurveType === 'elliptical_arc') {
			sketch.addPointOnEllipseConstraint(newPt.id, cuttingCurveId);
		} else if (cuttingCurveType === 'spline') {
			sketch.addPointOnSplineConstraint(newPt.id, cuttingCurveId);
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
			rawHandles.push({
				h1: subSegments[j - 1][2],
				h2: subSegments[j][1],
			});
		}
	}

	// Filter any degenerate segments (points closer than 1e-3)
	const points: Vec2[] = [];
	const handles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let k = 0; k < rawPoints.length; k++) {
		if (points.length === 0 || points[points.length - 1].distanceTo(rawPoints[k]) >= 1e-3) {
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
			if (pt && pos.distanceTo(pt) < 1e-2) {
				matchedId = pid;
				break;
			}
		}
		if (!matchedId) {
			const newPt = sketch.addPoint(pos);
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
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);

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
		const pA = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaA),
			candidate.startCuttingCurveId,
			candidate.startCuttingCurveType
		);
		const pB = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaB),
			candidate.endCuttingCurveId,
			candidate.endCuttingCurveType
		);

		// Check if old circle had a RadiusConstraint
		const radConstraint = sketch.getConstraintsForEntity('circle', circle.id).find(c => c.type === 'radius') as any;

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

		const radConstraint = sketch.getConstraintsForEntity('arc', arc.id).find(c => c.type === 'radius') as any;

		if (isStart) {
			// Trim off start: keep [uB, 1]
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			const newArc = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else if (isEnd) {
			// Trim off end: keep [0, uA]
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const newArc = sketch.addArc(
				arc.centerId,
				arc.startPointId,
				pA.id,
				arc.radius,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else {
			// Trim middle: keep [0, uA] and [uB, 1]
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
		const pA = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaA),
			candidate.startCuttingCurveId,
			candidate.startCuttingCurveType
		);
		const pB = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaB),
			candidate.endCuttingCurveId,
			candidate.endCuttingCurveType
		);

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
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
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
		} else if (isEnd) {
			// Trim off end: keep [0, uA]
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else if (isEnd) {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			sketch.removeEntity(spline.id);
		} else {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
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
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);

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

		const pA = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaA),
			candidate.startCuttingCurveId,
			candidate.startCuttingCurveType
		);
		const pB = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaB),
			candidate.endCuttingCurveId,
			candidate.endCuttingCurveType
		);

		const radConstraint = sketch.getConstraintsForEntity('circle', circle.id).find(c => c.type === 'radius') as any;

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

		const radConstraint = sketch.getConstraintsForEntity('arc', arc.id).find(c => c.type === 'radius') as any;

		if (isStart) {
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pB.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pB.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else if (isEnd) {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const arc1 = sketch.addArc(arc.centerId, arc.startPointId, pA.id, arc.radius, arc.clockwise, arc.isConstruction);
			const arc2 = sketch.addArc(arc.centerId, pA.id, arc.endPointId, arc.radius, arc.clockwise, arc.isConstruction);
			sketch.removeEntity(arc.id);
			if (radConstraint && radConstraint.targetRadius) {
				sketch.addRadiusConstraint(arc1.id, radConstraint.targetRadius, radConstraint.displayMode);
				sketch.addRadiusConstraint(arc2.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		} else {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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

		const pA = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaA),
			candidate.startCuttingCurveId,
			candidate.startCuttingCurveType
		);
		const pB = createCutPoint(
			sketch,
			getPointAtParam(curve, thetaB),
			candidate.endCuttingCurveId,
			candidate.endCuttingCurveType
		);

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
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				arc.startPointId,
				pB.id,
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
		} else if (isEnd) {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
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
				pA.id,
				arc.endPointId,
				arc.clockwise,
				arc.isConstruction
			);
			sketch.removeEntity(arc.id);
		} else {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
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
				pA.id,
				pB.id,
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
			// Closed spline: break into 2 open splines covering the full loop: [uA, uB] and [uB, uA]
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, uA, uB, pA.id, pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, uA, pB.id, pA.id);
			sketch.removeEntity(spline.id);
			return;
		}

		const isStart = uA <= 1e-4;
		const isEnd = uB >= 1 - 1e-4;

		if (isStart && isEnd) return;

		if (isStart) {
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, 0, uB, spline.pointIds[0], pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else if (isEnd) {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			replaceSplineWithInterval(sketch, spline, curve, uA, 1, pA.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		} else {
			const pA = createCutPoint(
				sketch,
				getPointAtParam(curve, uA),
				candidate.startCuttingCurveId,
				candidate.startCuttingCurveType
			);
			const pB = createCutPoint(
				sketch,
				getPointAtParam(curve, uB),
				candidate.endCuttingCurveId,
				candidate.endCuttingCurveType
			);
			replaceSplineWithInterval(sketch, spline, curve, 0, uA, spline.pointIds[0], pA.id);
			replaceSplineWithInterval(sketch, spline, curve, uA, uB, pA.id, pB.id);
			replaceSplineWithInterval(sketch, spline, curve, uB, 1, pB.id, spline.pointIds[spline.pointIds.length - 1]);
			sketch.removeEntity(spline.id);
		}
	}
}

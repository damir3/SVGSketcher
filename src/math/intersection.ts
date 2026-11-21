import { pointsAtCurveParameters, parametersAtCurvePoints } from './curvePath';
import {
	getCurveIntersections as getCurveIntersectionsReference,
	getTrimCandidate as getTrimCandidateReference,
} from './trimReference';
import { ellipseAxes, ellipseParameterAtPoint } from './ellipse';
import { Vec2 } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchPoint, SketchLine, SketchSpline } from '../model/types';
import { extractSplineInterval, type BezierSegment } from './spline';
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
import { POINT_TOLERANCE } from '../constants';

export { POINT_TOLERANCE };

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
	for (const prim of sketch.getCurvePrimitives()) {
		if (prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
		const c = prim.toGeoCurve(sketch);
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
	return pointsAtCurveParameters(curve, [param])[0];
}

/** Computes the editor parameter (SVG angle for full conics, otherwise [0,1]). */
export function getParamAtPoint(curve: GeoCurve, point: Vec2): number {
	return parametersAtCurvePoints(curve, [point])[0];
}

function isAngleWithinSweep(
	startAngle: number,
	endAngle: number,
	testAngle: number,
	clockwise: boolean,
	angTol: number
): boolean {
	const wrap = (diff: number) => ((diff % TWO_PI) + TWO_PI) % TWO_PI;
	const sweep = wrap(clockwise ? endAngle - startAngle : startAngle - endAngle);
	const delta = wrap(clockwise ? testAngle - startAngle : startAngle - testAngle);
	return delta <= sweep + angTol || delta >= TWO_PI - angTol;
}

/**
 * Checks if point pt (in world coords) lies on an arc within tolerance.
 */
function isPointOnArc(pt: Vec2, arc: GeoArc, tol = POINT_TOLERANCE): boolean {
	const sc = new Vec2(arc.center.x, -arc.center.y);
	return isAngleWithinSweep(
		sc.angleToPoint(new Vec2(arc.start.x, -arc.start.y)),
		sc.angleToPoint(new Vec2(arc.end.x, -arc.end.y)),
		sc.angleToPoint(new Vec2(pt.x, -pt.y)),
		arc.clockwise,
		tol / Math.max(arc.radius, 1)
	);
}

/**
 * Checks if point pt (in world coords) lies on an elliptical arc within tolerance.
 */
function isPointOnEllipticalArc(pt: Vec2, arc: GeoEllipticalArc, tol = POINT_TOLERANCE): boolean {
	const sc = new Vec2(arc.center.x, -arc.center.y);
	const smaj = new Vec2(arc.majorAxisPoint.x, -arc.majorAxisPoint.y);
	const smin = new Vec2(arc.minorAxisPoint.x, -arc.minorAxisPoint.y);
	const r = sc.distancesTo(smaj, smin);
	if (r.x < 1e-6 || r.y < 1e-6) return false;
	const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));
	return isAngleWithinSweep(
		ellipseParameterAtPoint(new Vec2(arc.start.x, -arc.start.y), sc, r, axisU, axisV),
		ellipseParameterAtPoint(new Vec2(arc.end.x, -arc.end.y), sc, r, axisU, axisV),
		ellipseParameterAtPoint(new Vec2(pt.x, -pt.y), sc, r, axisU, axisV),
		arc.clockwise,
		tol / Math.max(Math.min(r.x, r.y), 1)
	);
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

/** Finds genuine self-intersection points and parameter pairs in one native query. */
export function getSplineSelfIntersections(
	segments: BezierSegment[],
	isClosed = false
): Array<{ point: Vec2; paramA: number; paramB: number }> {
	const query = getGeometryKernel().spline?.selfIntersections;
	if (!query) throw new Error('Spline self-intersections require the Rust/WASM kernel');
	return query(segments, isClosed).map(hit => ({ ...hit, point: Vec2.from(hit.point) }));
}

function splineSelfCurveIntersections(target: GeoSpline): CurveIntersection[] {
	const selfHits: CurveIntersection[] = [];
	for (const { point, paramA, paramB } of getSplineSelfIntersections(target.bezierSegments, !!target.isClosed)) {
		for (const param of [paramA, paramB]) {
			if (!target.isClosed && (param < 1e-4 || param > 1 - 1e-4)) continue;
			selfHits.push({ point, param, cuttingCurveId: target.id, cuttingCurveType: 'spline' });
		}
	}
	return selfHits;
}

function mergeCurveIntersections(items: CurveIntersection[], eps: number): CurveIntersection[] {
	const sorted = [...items].sort((a, b) => a.param - b.param);
	const unique: CurveIntersection[] = [];
	for (const item of sorted) {
		if (!unique.some(u => Math.abs(u.param - item.param) < eps)) unique.push(item);
	}
	return unique;
}

function buildTrimCandidateFromIntersections(
	target: GeoCurve,
	intersections: CurveIntersection[],
	cursorWorldPos: Vec2
): TrimCandidate {
	const cursorParam = getParamAtPoint(target, cursorWorldPos);
	const isClosedCurve =
		target.type === 'circle' ||
		target.type === 'ellipse' ||
		(target.type === 'spline' && target.splineType !== 'control' && !!target.isClosed);

	if (!isClosedCurve) {
		if (intersections.length === 0) {
			return {
				curve: target,
				interval: [0, 1],
				cutStartWorld: getPointAtParam(target, 0),
				cutEndWorld: getPointAtParam(target, 1),
				isWholeEntity: true,
			};
		}
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

	const period = target.type === 'circle' || target.type === 'ellipse' ? TWO_PI : 1.0;
	if (intersections.length < 2) {
		return {
			curve: target,
			interval: [0, period],
			cutStartWorld: getPointAtParam(target, 0),
			cutEndWorld: getPointAtParam(target, period),
			isWholeEntity: true,
		};
	}
	const thetas = intersections.map(i => i.param);
	const n = thetas.length;
	let chosenIdxA = n - 1;
	let chosenIdxB = 0;
	for (let i = 0; i < n - 1; i++) {
		if (cursorParam >= thetas[i] - 1e-5 && cursorParam <= thetas[i + 1] + 1e-5) {
			chosenIdxA = i;
			chosenIdxB = i + 1;
			break;
		}
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
 * Finds all intersection points of `target` with `allCurves` (including spline self-intersections),
 * parameterized along target curve in ascending order.
 */
export function getCurveIntersections(target: GeoCurve, allCurves: GeoCurve[]): CurveIntersection[] {
	const editing = getGeometryKernel().editing;
	if (!editing) {
		const ref = getCurveIntersectionsReference(target, allCurves);
		if (target.type !== 'spline') return ref;
		const selfHits = splineSelfCurveIntersections(target);
		return selfHits.length === 0 ? ref : mergeCurveIntersections([...ref, ...selfHits], 1e-4);
	}
	return editing.intersections(target, allCurves).map(hit => {
		const cutter = allCurves[hit.source] ?? target;
		return {
			point: Vec2.from(hit.point),
			param: hit.param,
			cuttingCurveId: cutter.id,
			cuttingCurveType: cutter.type,
		};
	});
}

export function getTrimCandidate(target: GeoCurve, allCurves: GeoCurve[], cursorWorldPos: Vec2): TrimCandidate | null {
	const editing = getGeometryKernel().editing;
	if (!editing) {
		if (target.type === 'spline') {
			const selfHits = splineSelfCurveIntersections(target);
			if (selfHits.length > 0) {
				const merged = mergeCurveIntersections(
					[...getCurveIntersectionsReference(target, allCurves), ...selfHits],
					1e-4
				);
				return buildTrimCandidateFromIntersections(target, merged, cursorWorldPos);
			}
		}
		return getTrimCandidateReference(target, allCurves, cursorWorldPos);
	}
	const result = editing.trim(target, allCurves, cursorWorldPos);
	const start = result.startSource === undefined ? undefined : (allCurves[result.startSource] ?? target);
	const end = result.endSource === undefined ? undefined : (allCurves[result.endSource] ?? target);
	if (result.whole)
		return {
			curve: target,
			interval: result.interval,
			cutStartWorld: Vec2.from(result.start),
			cutEndWorld: Vec2.from(result.end),
			isWholeEntity: true,
		};
	return {
		curve: target,
		interval: result.interval,
		cutStartWorld: Vec2.from(result.start),
		cutEndWorld: Vec2.from(result.end),
		startCuttingCurveId: start?.id,
		startCuttingCurveType: start?.type,
		endCuttingCurveId: end?.id,
		endCuttingCurveType: end?.type,
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
		} else if (
			c instanceof ParallelConstraint ||
			c instanceof CollinearConstraint ||
			c instanceof PerpendicularConstraint
		) {
			const isL1 = matchesEndpoints(c.l1P1, c.l1P2, oldLine.p1Id, oldLine.p2Id);
			const otherLine = sketch.getLineBetween(isL1 ? c.l2P1 : c.l1P1, isL1 ? c.l2P2 : c.l1P2);
			if (otherLine && otherLine.id !== oldLine.id) {
				if (c instanceof ParallelConstraint) sketch.addParallelConstraint(newLine.id, otherLine.id);
				else if (c instanceof CollinearConstraint) sketch.addCollinearConstraint(newLine.id, otherLine.id);
				else sketch.addPerpendicularConstraint(newLine.id, otherLine.id);
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

export function mapSplineIntervalPointIds(
	sketch: SketchDocument,
	existingIds: readonly string[],
	raw: readonly Vec2[],
	startPointId: string,
	endPointId: string
): string[] {
	const ids = [startPointId];
	for (let k = 1; k < raw.length - 1; k++) {
		const pos = raw[k];
		const matchedId = existingIds.find(pid => {
			const pt = sketch.points.get(pid);
			return pt && pos.distanceTo(pt) < 1e-2;
		});
		ids.push(matchedId ?? sketch.addPoint(pos).id);
	}
	ids.push(endPointId);
	return ids;
}

export function buildControlSplineInterval(
	sketch: SketchDocument,
	sourcePointIds: readonly string[],
	subSegments: readonly BezierSegment[],
	startPointId: string,
	endPointId: string,
	isConstruction?: boolean
): SketchSpline {
	const M = subSegments.length;
	const controlRawPoints: Vec2[] = [subSegments[0][0]];
	const knots: number[] = [0, 0, 0, 0];
	for (let s = 0; s < M; s++) {
		controlRawPoints.push(subSegments[s][1], subSegments[s][2], subSegments[s][3]);
		if (s > 0) knots.push(s, s, s);
	}
	knots.push(M, M, M, M);
	return sketch.addControlSpline(
		mapSplineIntervalPointIds(sketch, sourcePointIds, controlRawPoints, startPointId, endPointId),
		isConstruction,
		undefined,
		false,
		knots
	);
}

export function extractFitSplineIntervalHandles(subSegments: readonly BezierSegment[]): {
	rawPoints: Vec2[];
	rawHandles: Array<{ h1: Vec2; h2: Vec2 }>;
} {
	const M = subSegments.length;
	const rawPoints: Vec2[] = [];
	const rawHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			const p0 = subSegments[0][0];
			const v = new Vec2().subVectors(subSegments[0][1], p0);
			rawPoints.push(p0);
			rawHandles.push({ h1: new Vec2().subVectors(p0, v), h2: new Vec2().addVectors(p0, v) });
		} else if (j === M) {
			const pM = subSegments[M - 1][3];
			const v = new Vec2().subVectors(pM, subSegments[M - 1][2]);
			rawPoints.push(pM);
			rawHandles.push({ h1: new Vec2().subVectors(pM, v), h2: new Vec2().addVectors(pM, v) });
		} else {
			rawPoints.push(subSegments[j][0]);
			// Preserve both handles at the join; averaging them alters the retained cubic span.
			rawHandles.push({ h1: subSegments[j - 1][2], h2: subSegments[j][1] });
		}
	}
	return { rawPoints, rawHandles };
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

	if (originalSpline.splineType === 'control') {
		buildControlSplineInterval(
			sketch,
			originalSpline.pointIds,
			subSegments,
			startPointId,
			endPointId,
			originalSpline.isConstruction
		);
		return;
	}

	const { rawPoints, rawHandles } = extractFitSplineIntervalHandles(subSegments);

	// Filter degenerate segments and duplicate consecutive IDs
	const points: Vec2[] = [];
	const handles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let k = 0; k < rawPoints.length; k++) {
		if (points.length === 0 || points[points.length - 1].distanceTo(rawPoints[k]) >= POINT_TOLERANCE) {
			points.push(rawPoints[k]);
			handles.push(rawHandles[k]);
		}
	}
	if (points.length < 2) return;

	const ptIds = mapSplineIntervalPointIds(sketch, originalSpline.pointIds, points, startPointId, endPointId);
	const cleanPtIds: string[] = [];
	const cleanHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];
	for (let k = 0; k < ptIds.length; k++) {
		if (cleanPtIds.length === 0 || cleanPtIds[cleanPtIds.length - 1] !== ptIds[k]) {
			cleanPtIds.push(ptIds[k]);
			cleanHandles.push(handles[k]);
		}
	}

	if (cleanPtIds.length >= 2 && originalSpline.splineType === 'fit') {
		sketch.addFitSpline(cleanPtIds, undefined, originalSpline.isConstruction, undefined, false, cleanHandles);
	}
}

/**
 * Executes a trim on the SketchDocument given a TrimCandidate.
 */
export function executeTrim(sketch: SketchDocument, candidate: TrimCandidate): void {
	executeSplitOperation(sketch, candidate, 'trim');
}

/**
 * Executes a break/split on the SketchDocument given a TrimCandidate.
 * Unlike trim, it does NOT delete the candidate interval, but splits the curve
 * into segments at the cut points.
 */
export function executeBreak(sketch: SketchDocument, candidate: TrimCandidate): void {
	executeSplitOperation(sketch, candidate, 'break');
}

function executeSplitOperation(sketch: SketchDocument, candidate: TrimCandidate, mode: 'trim' | 'break'): void {
	const { curve, interval, isWholeEntity } = candidate;

	if (isWholeEntity) {
		if (mode === 'trim') sketch.removeEntity(curve.id);
		return;
	}

	const [uA, uB] = interval;
	const cutPoint = (param: number, cuttingCurveId?: string, cuttingCurveType?: CurveType, ignoreSelf = false) => {
		const validId = cuttingCurveId && (!ignoreSelf || cuttingCurveId !== curve.id);
		return createCutPoint(
			sketch,
			getPointAtParam(curve, param),
			validId ? cuttingCurveId : undefined,
			validId ? cuttingCurveType : undefined
		);
	};

	const buildOpenSpans = (startId: string, endId: string, ignoreSelfCut = false) => {
		const isStart = uA <= POINT_TOLERANCE;
		const isEnd = uB >= 1 - POINT_TOLERANCE;
		if (isStart && isEnd) return null;

		const pA = isStart
			? null
			: cutPoint(uA, candidate.startCuttingCurveId, candidate.startCuttingCurveType, ignoreSelfCut);
		const pB = isEnd ? null : cutPoint(uB, candidate.endCuttingCurveId, candidate.endCuttingCurveType, ignoreSelfCut);

		const spans: Array<[number, number, string, string]> = [];
		if (pA) spans.push([0, uA, startId, pA.id]);
		if (mode === 'break') {
			const cutStart = pA ? uA : 0;
			const cutEnd = pB ? uB : 1;
			spans.push([cutStart, cutEnd, pA ? pA.id : startId, pB ? pB.id : endId]);
		}
		if (pB) spans.push([uB, 1, pB.id, endId]);
		return { spans, pA, pB, isStart, isEnd };
	};

	const copyRadiusConstraints = (
		entityType: 'circle' | 'arc',
		entityId: string,
		newArcs: Array<{ id: string }>,
		removeAfter?: () => void
	) => {
		const radConstraint = sketch.getConstraintsForEntity(entityType, entityId).find(c => c.type === 'radius') as any;
		removeAfter?.();
		if (radConstraint && radConstraint.targetRadius) {
			for (const newArc of newArcs) {
				sketch.addRadiusConstraint(newArc.id, radConstraint.targetRadius, radConstraint.displayMode);
			}
		}
	};

	if (curve.type === 'segment') {
		const line = sketch.lines.get(curve.id);
		if (!line) return;
		const split = buildOpenSpans(line.p1Id, line.p2Id);
		if (!split) {
			if (mode === 'trim') sketch.removeEntity(line.id);
			return;
		}

		const newLines = split.spans.map(([, , p1, p2]) => sketch.addLine(p1, p2, line.lineType));
		if (mode === 'trim' && !split.isStart && !split.isEnd && split.pA && split.pB && newLines.length === 2) {
			sketch.addPointOnLineConstraint(split.pA.id, newLines[1].id);
			sketch.addPointOnLineConstraint(split.pB.id, newLines[0].id);
		}

		const oldConstraints = getLineConstraints(sketch, line);
		for (const c of oldConstraints) {
			sketch.removeConstraint(c.id);
		}
		transferLineConstraints(sketch, line, newLines[0], oldConstraints);
		sketch.removeEntity(line.id);
	} else if (curve.type === 'circle') {
		const circle = sketch.circles.get(curve.id);
		if (!circle) return;
		const pA = cutPoint(uA, candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = cutPoint(uB, candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		copyRadiusConstraints(
			'circle',
			circle.id,
			[
				sketch.addArc(circle.centerId, pB.id, pA.id, circle.radius, true, circle.lineType),
				...(mode === 'break'
					? [sketch.addArc(circle.centerId, pA.id, pB.id, circle.radius, true, circle.lineType)]
					: []),
			],
			() => sketch.removeEntity(circle.id)
		);
	} else if (curve.type === 'arc') {
		const arc = sketch.arcs.get(curve.id);
		if (!arc) return;
		const split = buildOpenSpans(arc.startPointId, arc.endPointId);
		if (!split) {
			if (mode === 'trim') sketch.removeEntity(arc.id);
			return;
		}

		copyRadiusConstraints(
			'arc',
			arc.id,
			split.spans.map(([, , s, e]) => sketch.addArc(arc.centerId, s, e, arc.radius, arc.clockwise, arc.lineType)),
			() => sketch.removeEntity(arc.id)
		);
	} else if (curve.type === 'ellipse') {
		const ellipse = sketch.ellipses.get(curve.id);
		if (!ellipse) return;
		const pA = cutPoint(uA, candidate.startCuttingCurveId, candidate.startCuttingCurveType);
		const pB = cutPoint(uB, candidate.endCuttingCurveId, candidate.endCuttingCurveType);

		sketch.addEllipticalArc(
			ellipse.centerId,
			ellipse.majorAxisPointId,
			ellipse.minorAxisPointId,
			pB.id,
			pA.id,
			true,
			ellipse.isConstruction
		);
		if (mode === 'break') {
			sketch.addEllipticalArc(
				ellipse.centerId,
				ellipse.majorAxisPointId,
				ellipse.minorAxisPointId,
				pA.id,
				pB.id,
				true,
				ellipse.isConstruction
			);
		}
		sketch.removeEntity(ellipse.id);
	} else if (curve.type === 'elliptical_arc') {
		const arc = sketch.ellipticalArcs.get(curve.id);
		if (!arc) return;
		const split = buildOpenSpans(arc.startPointId, arc.endPointId);
		if (!split) {
			if (mode === 'trim') sketch.removeEntity(arc.id);
			return;
		}

		for (const [, , s, e] of split.spans) {
			sketch.addEllipticalArc(
				arc.centerId,
				arc.majorAxisPointId,
				arc.minorAxisPointId,
				s,
				e,
				arc.clockwise,
				arc.isConstruction
			);
		}
		sketch.removeEntity(arc.id);
	} else if (curve.type === 'spline') {
		const spline = sketch.splines.get(curve.id);
		if (!spline) return;

		if (spline.isClosed && spline.splineType === 'fit') {
			const pA = cutPoint(uA, candidate.startCuttingCurveId, candidate.startCuttingCurveType, true);
			const pB = cutPoint(uB, candidate.endCuttingCurveId, candidate.endCuttingCurveType, true);
			if (mode === 'break') {
				replaceSplineWithInterval(sketch, spline, curve, uA, uB, pA.id, pB.id);
			}
			replaceSplineWithInterval(sketch, spline, curve, uB, uA, pB.id, pA.id);
			sketch.removeEntity(spline.id);
			return;
		}

		const split = buildOpenSpans(spline.pointIds[0], spline.pointIds[spline.pointIds.length - 1], true);
		if (!split) {
			if (mode === 'trim') sketch.removeEntity(spline.id);
			return;
		}

		for (const [sU, eU, sId, eId] of split.spans) {
			replaceSplineWithInterval(sketch, spline, curve, sU, eU, sId, eId);
		}
		sketch.removeEntity(spline.id);
	}
}

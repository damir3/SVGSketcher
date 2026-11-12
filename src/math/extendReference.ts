// Frozen extend calculation before native routing. No document writes.
import type { SketchDocument } from '../model/sketch';
import type { ExtendCandidate } from './extend';
import { Vec2 } from './vector';
import { ellipseAxes, ellipseParameterAtPoint } from './ellipse';
import {
	type GeoCurve,
	type GeoSegment,
	type GeoCircle,
	type GeoArc,
	type GeoEllipse,
	type GeoEllipticalArc,
	type GeoSpline,
	intersectCurves,
	getPointAtParam,
} from './intersection';
import { getSplineTangentAtParam } from './spline';

export function findExtendCandidate(
	sketch: SketchDocument,
	target: GeoCurve,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): ExtendCandidate | null {
	if (target.type === 'segment') {
		return findExtendCandidateForLine(sketch, target, allCurves, cursorWorldPos);
	}
	if (target.type === 'arc') {
		return findExtendCandidateForArc(sketch, target, allCurves, cursorWorldPos);
	}
	if (target.type === 'elliptical_arc') {
		return findExtendCandidateForEllipticalArc(sketch, target, allCurves, cursorWorldPos);
	}
	if (target.type === 'spline') {
		return findExtendCandidateForSpline(sketch, target, allCurves, cursorWorldPos);
	}
	return null;
}

/**
 * Extend candidate for Line (segment).
 */
function findExtendCandidateForLine(
	_sketch: SketchDocument,
	target: GeoSegment,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): ExtendCandidate | null {
	const p1 = target.p1;
	const p2 = target.p2;
	const d1 = cursorWorldPos.distanceTo(p1);
	const d2 = cursorWorldPos.distanceTo(p2);

	const edge: 'start' | 'end' = d2 <= d1 ? 'end' : 'start';
	const fromPoint = edge === 'end' ? p2 : p1;
	const baseOtherPoint = edge === 'end' ? p1 : p2;
	const dir = new Vec2().subVectors(fromPoint, baseOtherPoint).normalizeOrUnitX();

	// Forward ray segment
	const rayLen = 50000;
	const raySegment: GeoSegment = {
		type: 'segment',
		id: '__extend_ray__',
		p1: fromPoint,
		p2: fromPoint.clone().addScaledVector(dir, rayLen),
	};

	let closestT = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(raySegment, other);
		for (const pt of inters) {
			const t = new Vec2().subVectors(pt, fromPoint).dot(dir);
			if (t > 1e-3 && t < closestT) {
				closestT = t;
				closestPt = pt;
				intersectedCurve = other;
			}
		}
	}

	let toPoint: Vec2;
	let intersectedCurveId: string | undefined;
	let intersectedCurveType: string | undefined;

	if (closestPt && isFinite(closestT)) {
		toPoint = closestPt;
		intersectedCurveId = intersectedCurve?.id;
		intersectedCurveType = intersectedCurve?.type;
	} else {
		// No intersection ahead: extend by +50mm
		toPoint = fromPoint.clone().addScaledVector(dir, 50);
	}

	return {
		target,
		targetType: 'line',
		targetId: target.id,
		edge,
		fromPoint,
		toPoint,
		intersectedCurveId,
		intersectedCurveType,
		previewType: 'line',
		previewData: { from: fromPoint, to: toPoint },
	};
}

/**
 * Extend candidate for Arc.
 */
function findExtendCandidateForArc(
	_sketch: SketchDocument,
	target: GeoArc,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): ExtendCandidate | null {
	const c = target.center;
	const r = target.radius;
	const pStart = target.start;
	const pEnd = target.end;

	const dStart = cursorWorldPos.distanceTo(pStart);
	const dEnd = cursorWorldPos.distanceTo(pEnd);
	const edge: 'start' | 'end' = dEnd <= dStart ? 'end' : 'start';
	const fromPoint = edge === 'end' ? pEnd : pStart;

	const thetaS = c.angleToPoint(pStart);
	const thetaE = c.angleToPoint(pEnd);

	let currentSweep = target.clockwise ? thetaS - thetaE : thetaE - thetaS;
	while (currentSweep < 0) currentSweep += 2 * Math.PI;
	while (currentSweep >= 2 * Math.PI) currentSweep -= 2 * Math.PI;

	const maxExtensionSweep = 2 * Math.PI - currentSweep - 1e-4;
	if (maxExtensionSweep <= 1e-4) return null;

	// Full circle to find intersections with all other curves
	const fullCircle: GeoCircle = {
		type: 'circle',
		id: '__extend_circle__',
		center: c,
		radius: r,
		centerId: target.centerId,
	};

	let closestSweep = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(fullCircle, other);
		for (const pt of inters) {
			const thetaP = c.angleToPoint(pt);
			let sweep: number;
			if (edge === 'end') {
				sweep = target.clockwise ? thetaE - thetaP : thetaP - thetaE;
			} else {
				sweep = target.clockwise ? thetaP - thetaS : thetaS - thetaP;
			}
			while (sweep < 0) sweep += 2 * Math.PI;
			while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;

			if (sweep > 1e-3 && sweep <= maxExtensionSweep && sweep < closestSweep) {
				closestSweep = sweep;
				closestPt = pt;
				intersectedCurve = other;
			}
		}
	}

	if (closestPt && isFinite(closestSweep)) {
		const extendingClockwise = edge === 'end' ? !!target.clockwise : !target.clockwise;
		return {
			target,
			targetType: 'arc',
			targetId: target.id,
			edge,
			fromPoint,
			toPoint: closestPt,
			intersectedCurveId: intersectedCurve?.id,
			intersectedCurveType: intersectedCurve?.type,
			becomesFullLoop: false,
			previewType: 'arc',
			previewData: {
				center: c,
				radius: r,
				from: fromPoint,
				to: closestPt,
				clockwise: extendingClockwise,
			},
		};
	}

	// No intersection found: extend to complete full Circle
	return {
		target,
		targetType: 'arc',
		targetId: target.id,
		edge,
		fromPoint,
		toPoint: fromPoint,
		becomesFullLoop: true,
		previewType: 'arc',
		previewData: {
			center: c,
			radius: r,
			becomesFullCircle: true,
		},
	};
}

/**
 * Extend candidate for Elliptical Arc.
 */
function findExtendCandidateForEllipticalArc(
	_sketch: SketchDocument,
	target: GeoEllipticalArc,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): ExtendCandidate | null {
	const c = target.center;
	const pStart = target.start;
	const pEnd = target.end;

	const dStart = cursorWorldPos.distanceTo(pStart);
	const dEnd = cursorWorldPos.distanceTo(pEnd);
	const edge: 'start' | 'end' = dEnd <= dStart ? 'end' : 'start';
	const fromPoint = edge === 'end' ? pEnd : pStart;

	const fullEllipse: GeoEllipse = {
		type: 'ellipse',
		id: '__extend_ellipse__',
		center: c,
		majorAxisPoint: target.majorAxisPoint,
		minorAxisPoint: target.minorAxisPoint,
		centerId: target.centerId,
		majorAxisPointId: target.majorAxisPointId,
		minorAxisPointId: target.minorAxisPointId,
	};

	const maj = target.majorAxisPoint;
	const min = target.minorAxisPoint;
	const radii = new Vec2(c.distanceTo(maj), c.distanceTo(min));
	const { axisU, axisV } = ellipseAxes(c.angleToPoint(maj));
	const thetaS = ellipseParameterAtPoint(pStart, c, radii, axisU, axisV);
	const thetaE = ellipseParameterAtPoint(pEnd, c, radii, axisU, axisV);
	let currentSweep = target.clockwise ? thetaS - thetaE : thetaE - thetaS;
	while (currentSweep < 0) currentSweep += 2 * Math.PI;
	while (currentSweep >= 2 * Math.PI) currentSweep -= 2 * Math.PI;
	const maxExtensionSweep = 2 * Math.PI - currentSweep - 1e-4;

	let closestSweep = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(fullEllipse, other);
		for (const pt of inters) {
			const thetaP = ellipseParameterAtPoint(pt, c, radii, axisU, axisV);
			let sweep: number;
			if (edge === 'end') {
				sweep = target.clockwise ? thetaE - thetaP : thetaP - thetaE;
			} else {
				sweep = target.clockwise ? thetaP - thetaS : thetaS - thetaP;
			}
			while (sweep < 0) sweep += 2 * Math.PI;
			while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;

			if (sweep > 1e-3 && sweep <= maxExtensionSweep && sweep < closestSweep) {
				closestSweep = sweep;
				closestPt = pt;
				intersectedCurve = other;
			}
		}
	}

	if (closestPt && isFinite(closestSweep)) {
		return {
			target,
			targetType: 'elliptical_arc',
			targetId: target.id,
			edge,
			fromPoint,
			toPoint: closestPt,
			intersectedCurveId: intersectedCurve?.id,
			intersectedCurveType: intersectedCurve?.type,
			becomesFullLoop: false,
			previewType: 'arc',
			previewData: {
				center: c,
				majorAxisPoint: target.majorAxisPoint,
				minorAxisPoint: target.minorAxisPoint,
				from: fromPoint,
				to: closestPt,
				clockwise: edge === 'end' ? !!target.clockwise : !target.clockwise,
			},
		};
	}

	return {
		target,
		targetType: 'elliptical_arc',
		targetId: target.id,
		edge,
		fromPoint,
		toPoint: fromPoint,
		becomesFullLoop: true,
		previewType: 'arc',
		previewData: {
			center: c,
			majorAxisPoint: target.majorAxisPoint,
			minorAxisPoint: target.minorAxisPoint,
			becomesFullEllipse: true,
		},
	};
}

/**
 * Extend candidate for Spline.
 */
function findExtendCandidateForSpline(
	_sketch: SketchDocument,
	target: GeoSpline,
	allCurves: GeoCurve[],
	cursorWorldPos: Vec2
): ExtendCandidate | null {
	if (target.isClosed && target.splineType !== 'control') return null;

	const pStart = getPointAtParam(target, 0);
	const pEnd = getPointAtParam(target, 1);

	const dStart = cursorWorldPos.distanceTo(pStart);
	const dEnd = cursorWorldPos.distanceTo(pEnd);
	const edge: 'start' | 'end' = dEnd <= dStart ? 'end' : 'start';
	const fromPoint = edge === 'end' ? pEnd : pStart;

	let dir: Vec2;
	if (edge === 'end') {
		const tEnd = getSplineTangentAtParam(target.bezierSegments, 1.0);
		dir = tEnd.clone().normalizeOrUnitX();
	} else {
		const tStart = getSplineTangentAtParam(target.bezierSegments, 0.0);
		dir = tStart.clone().multiplyScalar(-1).clone().normalizeOrUnitX();
	}

	const rayLen = 50000;
	const raySegment: GeoSegment = {
		type: 'segment',
		id: '__extend_ray__',
		p1: fromPoint,
		p2: fromPoint.clone().addScaledVector(dir, rayLen),
	};

	let closestT = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(raySegment, other);
		for (const pt of inters) {
			const t = new Vec2().subVectors(pt, fromPoint).dot(dir);
			if (t > 1e-3 && t < closestT) {
				closestT = t;
				closestPt = pt;
				intersectedCurve = other;
			}
		}
	}

	let toPoint: Vec2;
	let intersectedCurveId: string | undefined;
	let intersectedCurveType: string | undefined;

	if (closestPt && isFinite(closestT)) {
		toPoint = closestPt;
		intersectedCurveId = intersectedCurve?.id;
		intersectedCurveType = intersectedCurve?.type;
	} else {
		// No intersection ahead: extend by +50mm
		toPoint = fromPoint.clone().addScaledVector(dir, 50);
	}

	return {
		target,
		targetType: 'spline',
		targetId: target.id,
		edge,
		fromPoint,
		toPoint,
		intersectedCurveId,
		intersectedCurveType,
		previewType: 'spline',
		previewData: { from: fromPoint, to: toPoint },
	};
}

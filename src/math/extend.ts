import type { SketchDocument } from '../model/sketch';
import type { SketchPoint } from '../model/types';
import {
	DistanceConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	CoincidentConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	PointOnEllipseConstraint,
	PointOnSplineConstraint,
	MidpointConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	AngleConstraint,
	TangentLineCircleConstraint,
	EqualLengthConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
} from '../solver/constraints';
import { dist, normalize, type Vec2 } from './vector';
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
import { getSplineTangentAtParam, computeNaturalFitHandles } from './spline';

export type ExtendPrimitiveType = 'line' | 'arc' | 'elliptical_arc' | 'spline';

export interface ExtendCandidate {
	target: GeoCurve;
	targetType: ExtendPrimitiveType;
	targetId: string;
	/** 'start' or 'end' - which endpoint is being extended */
	edge: 'start' | 'end';
	/** The current endpoint position that is being extended */
	fromPoint: Vec2;
	/** The target position to which the primitive will extend */
	toPoint: Vec2;
	/** If extending to an intersection with another curve */
	intersectedCurveId?: string;
	intersectedCurveType?: string;
	/** If arc is extending into a full circle/ellipse */
	becomesFullLoop?: boolean;
	/** Type of preview to render */
	previewType: 'line' | 'arc' | 'spline';
	previewData?: any;
}

/**
 * Finds the nearest extendable primitive near the given screen position.
 */
export function findExtendTarget(ctx: any, screen: Vec2, thresholdPx = 18): GeoCurve | null {
	let bestDist = thresholdPx;
	let bestCurve: GeoCurve | null = null;

	// 1. Lines
	for (const line of ctx.sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		const d = line.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestCurve = line.toGeoCurve(ctx.sketch);
		}
	}

	// 2. Arcs
	for (const arc of ctx.sketch.arcs.values()) {
		const d = arc.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestCurve = arc.toGeoCurve(ctx.sketch);
		}
	}

	// 3. Elliptical Arcs
	for (const ea of ctx.sketch.ellipticalArcs.values()) {
		const d = ea.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestCurve = ea.toGeoCurve(ctx.sketch);
		}
	}

	// 4. Splines (only open splines can be extended)
	for (const spline of ctx.sketch.splines.values()) {
		if (spline.isClosed && spline.splineType !== 'control') continue;
		const d = spline.distanceTo(screen, ctx.sketch, ctx.viewport, bestDist);
		if (d !== null && d < bestDist) {
			bestDist = d;
			bestCurve = spline.toGeoCurve(ctx.sketch);
		}
	}

	return bestCurve;
}

/**
 * Calculates the extension candidate for the hovered curve and cursor position.
 */
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
	const d1 = dist(cursorWorldPos, p1);
	const d2 = dist(cursorWorldPos, p2);

	const edge: 'start' | 'end' = d2 <= d1 ? 'end' : 'start';
	const fromPoint = edge === 'end' ? p2 : p1;
	const baseOtherPoint = edge === 'end' ? p1 : p2;
	const dir = normalize({
		x: fromPoint.x - baseOtherPoint.x,
		y: fromPoint.y - baseOtherPoint.y,
	});

	// Forward ray segment
	const rayLen = 50000;
	const raySegment: GeoSegment = {
		type: 'segment',
		id: '__extend_ray__',
		p1: fromPoint,
		p2: { x: fromPoint.x + rayLen * dir.x, y: fromPoint.y + rayLen * dir.y },
	};

	let closestT = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(raySegment, other);
		for (const pt of inters) {
			const t = (pt.x - fromPoint.x) * dir.x + (pt.y - fromPoint.y) * dir.y;
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
		toPoint = { x: fromPoint.x + 50 * dir.x, y: fromPoint.y + 50 * dir.y };
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

	const dStart = dist(cursorWorldPos, pStart);
	const dEnd = dist(cursorWorldPos, pEnd);
	const edge: 'start' | 'end' = dEnd <= dStart ? 'end' : 'start';
	const fromPoint = edge === 'end' ? pEnd : pStart;

	const thetaS = Math.atan2(pStart.y - c.y, pStart.x - c.x);
	const thetaE = Math.atan2(pEnd.y - c.y, pEnd.x - c.x);

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
			const thetaP = Math.atan2(pt.y - c.y, pt.x - c.x);
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

	const dStart = dist(cursorWorldPos, pStart);
	const dEnd = dist(cursorWorldPos, pEnd);
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
	const a = dist(c, maj);
	const b = dist(c, min);
	const rot = Math.atan2(maj.y - c.y, maj.x - c.x);
	const cosR = Math.cos(rot),
		sinR = Math.sin(rot);

	const toParam = (p: Vec2) => {
		const dx = p.x - c.x,
			dy = p.y - c.y;
		const ex = dx * cosR + dy * sinR;
		const ey = -dx * sinR + dy * cosR;
		return Math.atan2(ey / b, ex / a);
	};

	const thetaS = toParam(pStart);
	const thetaE = toParam(pEnd);
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
			const thetaP = toParam(pt);
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

	const dStart = dist(cursorWorldPos, pStart);
	const dEnd = dist(cursorWorldPos, pEnd);
	const edge: 'start' | 'end' = dEnd <= dStart ? 'end' : 'start';
	const fromPoint = edge === 'end' ? pEnd : pStart;

	let dir: Vec2;
	if (edge === 'end') {
		const tEnd = getSplineTangentAtParam(target.bezierSegments, 1.0);
		dir = normalize(tEnd);
	} else {
		const tStart = getSplineTangentAtParam(target.bezierSegments, 0.0);
		dir = normalize({ x: -tStart.x, y: -tStart.y });
	}

	const rayLen = 50000;
	const raySegment: GeoSegment = {
		type: 'segment',
		id: '__extend_ray__',
		p1: fromPoint,
		p2: { x: fromPoint.x + rayLen * dir.x, y: fromPoint.y + rayLen * dir.y },
	};

	let closestT = Infinity;
	let closestPt: Vec2 | null = null;
	let intersectedCurve: GeoCurve | null = null;

	for (const other of allCurves) {
		if (other.id === target.id) continue;
		const inters = intersectCurves(raySegment, other);
		for (const pt of inters) {
			const t = (pt.x - fromPoint.x) * dir.x + (pt.y - fromPoint.y) * dir.y;
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
		toPoint = { x: fromPoint.x + 50 * dir.x, y: fromPoint.y + 50 * dir.y };
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

/**
 * Executes the extension into the SketchDocument.
 */
export function executeExtend(
	sketch: SketchDocument,
	candidate: ExtendCandidate
): { createdEntityId?: string; modifiedEntityId: string } | null {
	const { targetType, targetId, edge, toPoint, becomesFullLoop, intersectedCurveId, intersectedCurveType } = candidate;

	if (targetType === 'line') {
		const line = sketch.lines.get(targetId);
		if (!line) return null;

		const movingEndId = edge === 'end' ? line.p2Id : line.p1Id;
		const fixedEndId = edge === 'end' ? line.p1Id : line.p2Id;
		const movingPt = sketch.points.get(movingEndId);
		if (!movingPt) return null;

		const otherLines = Array.from(sketch.lines.values()).filter(
			l => l.id !== line.id && (l.p1Id === movingEndId || l.p2Id === movingEndId)
		);
		const otherArcs = Array.from(sketch.arcs.values()).filter(
			a => a.startPointId === movingEndId || a.endPointId === movingEndId
		);
		const otherSplines = Array.from(sketch.splines.values()).filter(s => s.pointIds.includes(movingEndId));
		const otherCoincidents = Array.from(sketch.constraints.values()).filter(
			c => c instanceof CoincidentConstraint && (c.p1Id === movingEndId || c.p2Id === movingEndId)
		);

		const isSharedEndpoint =
			otherLines.length > 0 || otherArcs.length > 0 || otherSplines.length > 0 || otherCoincidents.length > 0;

		// Remove conflicting EqualLengthConstraint on this line if present
		// (since extending the line explicitly changes its length)
		for (const c of Array.from(sketch.constraints.values())) {
			if (c instanceof EqualLengthConstraint) {
				const matches =
					(c.line1P1 === line.p1Id && c.line1P2 === line.p2Id) ||
					(c.line1P1 === line.p2Id && c.line1P2 === line.p1Id) ||
					(c.line2P1 === line.p1Id && c.line2P2 === line.p2Id) ||
					(c.line2P1 === line.p2Id && c.line2P2 === line.p1Id);
				if (matches) {
					sketch.removeConstraint(c.id);
				}
			}
		}

		let newEndPtId = movingEndId;

		if (isSharedEndpoint || movingPt.fixed) {
			const newPt = sketch.addPoint(toPoint);
			newEndPtId = newPt.id;
			if (edge === 'end') {
				line.p2Id = newEndPtId;
			} else {
				line.p1Id = newEndPtId;
			}
			sketch.addPointOnLineConstraint(movingPt.id, line.id);

			// Transfer line orientation and distance constraints from movingEndId to newEndPtId
			for (const c of Array.from(sketch.constraints.values())) {
				if (c instanceof HorizontalConstraint || c instanceof VerticalConstraint) {
					if ((c.p1Id === fixedEndId && c.p2Id === movingEndId) || (c.p2Id === fixedEndId && c.p1Id === movingEndId)) {
						if (c.p1Id === movingEndId) {
							(c as any).p1Id = newEndPtId;
							(c as any).entityIds = [newEndPtId, c.p2Id];
						} else {
							(c as any).p2Id = newEndPtId;
							(c as any).entityIds = [c.p1Id, newEndPtId];
						}
					}
				} else if (c instanceof DistanceConstraint) {
					if ((c.p1Id === fixedEndId && c.p2Id === movingEndId) || (c.p2Id === fixedEndId && c.p1Id === movingEndId)) {
						if (c.p1Id === movingEndId) {
							(c as any).p1Id = newEndPtId;
							(c as any).entityIds = [newEndPtId, fixedEndId];
						} else {
							(c as any).p2Id = newEndPtId;
							(c as any).entityIds = [fixedEndId, newEndPtId];
						}
						const fixedPt = sketch.points.get(fixedEndId);
						if (fixedPt) {
							const newLen = Math.hypot(toPoint.x - fixedPt.x, toPoint.y - fixedPt.y);
							c.targetDistance = newLen;
							c.value = newLen;
						}
					}
				} else if (
					c instanceof ParallelConstraint ||
					c instanceof PerpendicularConstraint ||
					c instanceof CollinearConstraint
				) {
					if ((c as any).l1P1 === movingEndId) (c as any).l1P1 = newEndPtId;
					if ((c as any).l1P2 === movingEndId) (c as any).l1P2 = newEndPtId;
					if ((c as any).l2P1 === movingEndId) (c as any).l2P1 = newEndPtId;
					if ((c as any).l2P2 === movingEndId) (c as any).l2P2 = newEndPtId;
					c.entityIds = [(c as any).l1P1, (c as any).l1P2, (c as any).l2P1, (c as any).l2P2];
				} else if (c instanceof AngleConstraint) {
					if (c.line1Id === line.id || c.line2Id === line.id) {
						if ((c as any).l1P1 === movingEndId) (c as any).l1P1 = newEndPtId;
						if ((c as any).l1P2 === movingEndId) (c as any).l1P2 = newEndPtId;
						if ((c as any).l2P1 === movingEndId) (c as any).l2P1 = newEndPtId;
						if ((c as any).l2P2 === movingEndId) (c as any).l2P2 = newEndPtId;
						c.entityIds = Array.from(
							new Set([c.line1Id, c.line2Id, (c as any).l1P1, (c as any).l1P2, (c as any).l2P1, (c as any).l2P2])
						);
					}
				} else if (c instanceof TangentLineCircleConstraint) {
					if (c.lineP1Id === movingEndId || c.lineP2Id === movingEndId) {
						if (c.lineP1Id === movingEndId) (c as any).lineP1Id = newEndPtId;
						if (c.lineP2Id === movingEndId) (c as any).lineP2Id = newEndPtId;
						c.entityIds = [c.lineP1Id, c.lineP2Id, c.circleCenterId, c.circleId];
					}
				} else if (c instanceof PointToLineDistanceConstraint) {
					if (c.lineId === line.id) {
						if (c.lineP1Id === movingEndId) (c as any).lineP1Id = newEndPtId;
						if (c.lineP2Id === movingEndId) (c as any).lineP2Id = newEndPtId;
						c.entityIds = [c.pointId, c.lineP1Id, c.lineP2Id];
					}
				} else if (c instanceof OffsetConstraint) {
					for (const p of c.pairs) {
						if (p.kind === 'line' && p.offLineId === line.id) {
							if (p.offP1Id === movingEndId) p.offP1Id = newEndPtId;
							if (p.offP2Id === movingEndId) p.offP2Id = newEndPtId;
						}
					}
				}
			}
		} else {
			// Remove conflicting constraints tying movingEndId to external entities FIRST
			// while movingPt is still at its current valid position
			const toRemove: string[] = [];
			for (const c of sketch.constraints.values()) {
				if (
					c instanceof PointOnLineConstraint ||
					c instanceof PointOnCircleConstraint ||
					c instanceof PointOnEllipseConstraint ||
					c instanceof PointOnSplineConstraint
				) {
					if (c.pointId === movingEndId) {
						toRemove.push(c.id);
					}
				} else if (c instanceof HorizontalConstraint || c instanceof VerticalConstraint) {
					const p1 = (c as any).p1Id;
					const p2 = (c as any).p2Id;
					if ((p1 === movingEndId && p2 !== fixedEndId) || (p2 === movingEndId && p1 !== fixedEndId)) {
						toRemove.push(c.id);
					}
				}
			}
			for (const cid of toRemove) {
				sketch.removeConstraint(cid);
			}

			// Now move point to target position
			movingPt.x = toPoint.x;
			movingPt.y = toPoint.y;
		}

		// Update DistanceConstraint length if present
		const fixedPt = sketch.points.get(fixedEndId);
		if (fixedPt) {
			const newLen = Math.hypot(toPoint.x - fixedPt.x, toPoint.y - fixedPt.y);
			for (const c of sketch.constraints.values()) {
				if (
					c instanceof DistanceConstraint &&
					((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
				) {
					c.targetDistance = newLen;
					c.value = newLen;
				}
			}
		}

		// Geometric constraint with intersected curve
		if (intersectedCurveId) {
			if (intersectedCurveType === 'line' || intersectedCurveType === 'segment') {
				sketch.addPointOnLineConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'circle' || intersectedCurveType === 'arc') {
				sketch.addPointOnCircleConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'ellipse' || intersectedCurveType === 'elliptical_arc') {
				sketch.addPointOnEllipseConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'spline') {
				sketch.addPointOnSplineConstraint(newEndPtId, intersectedCurveId);
			}
		}

		sketch.solve();
		return { modifiedEntityId: line.id };
	}

	if (targetType === 'arc') {
		const arc = sketch.arcs.get(targetId);
		if (!arc) return null;

		if (becomesFullLoop) {
			// Extend arc into full Circle
			const circle = sketch.addCircle(arc.centerId, arc.radius, arc.isConstruction);
			const radC = sketch.getConstraintsForEntity('arc', arc.id).find(c => c.type === 'radius');
			sketch.removeEntity(arc.id);
			if (radC && (radC as any).targetRadius) {
				sketch.addRadiusConstraint(circle.id, (radC as any).targetRadius, (radC as any).displayMode);
			}
			sketch.solve();
			return { createdEntityId: circle.id, modifiedEntityId: arc.id };
		}

		const movingEndId = edge === 'end' ? arc.endPointId : arc.startPointId;
		const movingPt = sketch.points.get(movingEndId);
		if (!movingPt) return null;

		const otherEntities = [
			...Array.from(sketch.lines.values()).filter(l => l.p1Id === movingEndId || l.p2Id === movingEndId),
			...Array.from(sketch.arcs.values()).filter(
				a => a.id !== arc.id && (a.startPointId === movingEndId || a.endPointId === movingEndId)
			),
			...Array.from(sketch.splines.values()).filter(s => s.pointIds.includes(movingEndId)),
		];

		let newEndPtId = movingEndId;
		if (otherEntities.length > 0 || movingPt.fixed) {
			const newPt = sketch.addPoint(toPoint);
			newEndPtId = newPt.id;
			if (edge === 'end') {
				arc.endPointId = newEndPtId;
			} else {
				arc.startPointId = newEndPtId;
			}
		} else {
			const toRemove: string[] = [];
			for (const c of sketch.constraints.values()) {
				if (
					c instanceof PointOnLineConstraint ||
					c instanceof PointOnCircleConstraint ||
					c instanceof PointOnEllipseConstraint ||
					c instanceof PointOnSplineConstraint
				) {
					if (c.pointId === movingEndId) {
						toRemove.push(c.id);
					}
				}
			}
			for (const cid of toRemove) {
				sketch.removeConstraint(cid);
			}

			movingPt.x = toPoint.x;
			movingPt.y = toPoint.y;
		}

		if (intersectedCurveId) {
			if (intersectedCurveType === 'line' || intersectedCurveType === 'segment') {
				sketch.addPointOnLineConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'circle' || intersectedCurveType === 'arc') {
				sketch.addPointOnCircleConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'ellipse' || intersectedCurveType === 'elliptical_arc') {
				sketch.addPointOnEllipseConstraint(newEndPtId, intersectedCurveId);
			} else if (intersectedCurveType === 'spline') {
				sketch.addPointOnSplineConstraint(newEndPtId, intersectedCurveId);
			}
		}

		sketch.solve();
		return { modifiedEntityId: arc.id };
	}

	if (targetType === 'elliptical_arc') {
		const ea = sketch.ellipticalArcs.get(targetId);
		if (!ea) return null;

		if (becomesFullLoop) {
			const ellipse = sketch.addEllipse(ea.centerId, ea.majorAxisPointId, ea.minorAxisPointId, ea.isConstruction);
			sketch.removeEntity(ea.id);
			sketch.solve();
			return { createdEntityId: ellipse.id, modifiedEntityId: ea.id };
		}

		const movingEndId = edge === 'end' ? ea.endPointId : ea.startPointId;
		const movingPt = sketch.points.get(movingEndId);
		if (!movingPt) return null;

		movingPt.x = toPoint.x;
		movingPt.y = toPoint.y;
		sketch.solve();
		return { modifiedEntityId: ea.id };
	}

	if (targetType === 'spline') {
		const spline = sketch.splines.get(targetId);
		if (!spline) return null;

		const newPt = sketch.addPoint(toPoint);
		const isControl = spline.splineType === 'control';

		if (isControl) {
			const oldBoundaryPtId = edge === 'end' ? spline.pointIds[spline.pointIds.length - 1] : spline.pointIds[0];
			if (edge === 'end') {
				spline.pointIds.push(newPt.id);
			} else {
				spline.pointIds.unshift(newPt.id);
			}
			delete spline.knots;

			const p1 = edge === 'end' ? oldBoundaryPtId : newPt.id;
			const p2 = edge === 'end' ? newPt.id : oldBoundaryPtId;
			const polyLine = sketch.addLine(p1, p2);
			polyLine.isConstruction = true;
			polyLine.isSplineHandle = true;
			polyLine.parentSplineId = spline.id;

			if (!spline.tangentLineIds) spline.tangentLineIds = [];
			if (edge === 'end') {
				spline.tangentLineIds.push(polyLine.id);
			} else {
				spline.tangentLineIds.unshift(polyLine.id);
			}
		} else {
			// Fit spline: update pointIds and regenerate handles safely without deleting fit points
			if (edge === 'end') {
				spline.pointIds.push(newPt.id);
			} else {
				spline.pointIds.unshift(newPt.id);
			}

			// Clean up old tangent lines, their handle points, and their midpoint constraints
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const l = sketch.lines.get(lid);
					if (l) {
						sketch.lines.delete(lid);
						sketch.points.delete(l.p1Id);
						sketch.points.delete(l.p2Id);
						for (const c of Array.from(sketch.constraints.values())) {
							if (c.entityIds.includes(lid) || c.entityIds.includes(l.p1Id) || c.entityIds.includes(l.p2Id)) {
								sketch.constraints.delete(c.id);
							}
						}
					}
				}
				spline.tangentLineIds = [];
			}

			// Construct fresh handles for all fit points
			const pts = spline.pointIds.map(pid => sketch.points.get(pid)).filter((p): p is SketchPoint => !!p);
			if (pts.length >= 2) {
				const handles = computeNaturalFitHandles(pts);
				for (let i = 0; i < pts.length; i++) {
					const h = handles[i];
					const pFit = pts[i];
					const h1 = sketch.addPoint(h.h1);
					const h2 = sketch.addPoint(h.h2);
					const hLine = sketch.addLine(h1.id, h2.id);
					hLine.isConstruction = true;
					hLine.isSplineHandle = true;
					hLine.parentSplineId = spline.id;
					spline.tangentLineIds.push(hLine.id);
					sketch.addConstraint(new MidpointConstraint(sketch.nextId('c_mid'), pFit.id, h1.id, h2.id, 1.0, 0.5));
				}
			}
		}

		if (intersectedCurveId) {
			if (intersectedCurveType === 'line' || intersectedCurveType === 'segment') {
				sketch.addPointOnLineConstraint(newPt.id, intersectedCurveId);
			} else if (intersectedCurveType === 'circle' || intersectedCurveType === 'arc') {
				sketch.addPointOnCircleConstraint(newPt.id, intersectedCurveId);
			} else if (intersectedCurveType === 'ellipse' || intersectedCurveType === 'elliptical_arc') {
				sketch.addPointOnEllipseConstraint(newPt.id, intersectedCurveId);
			} else if (intersectedCurveType === 'spline') {
				sketch.addPointOnSplineConstraint(newPt.id, intersectedCurveId);
			}
		}

		sketch.rebuildParamManager();
		sketch.solve();
		return { modifiedEntityId: spline.id };
	}

	return null;
}

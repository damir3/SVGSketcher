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
import { Vec2 } from './vector';
import { intersectCurves, type GeoCurve, type GeoSegment } from './intersection';
import { computeNaturalFitHandles, getSplineTangentAtParam } from './spline';
import { getGeometryKernel } from '../kernel';
import { findExtendCandidate as findExtendCandidateReference } from './extendReference';

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
	const editing = getGeometryKernel().editing;
	if (!editing) {
		const ref = findExtendCandidateReference(sketch, target, allCurves, cursorWorldPos);
		if (!ref || target.type !== 'spline' || (target.isClosed && target.splineType !== 'control')) return ref;
		const tangent = getSplineTangentAtParam(target.bezierSegments, ref.edge === 'end' ? 1.0 : 0.0);
		const dir = (ref.edge === 'end' ? tangent.clone() : tangent.clone().multiplyScalar(-1)).normalizeOrUnitX();
		const raySegment: GeoSegment = {
			type: 'segment',
			id: '__extend_ray__',
			p1: ref.fromPoint,
			p2: ref.fromPoint.clone().addScaledVector(dir, 50000),
		};
		let bestT = ref.intersectedCurveId ? new Vec2().subVectors(ref.toPoint, ref.fromPoint).dot(dir) : Infinity;
		let bestPt: Vec2 | null = null;
		for (const pt of intersectCurves(raySegment, target)) {
			const t = new Vec2().subVectors(pt, ref.fromPoint).dot(dir);
			if (t > 1e-3 && t < bestT) {
				bestT = t;
				bestPt = pt;
			}
		}
		if (!bestPt) return ref;
		return {
			...ref,
			toPoint: bestPt,
			intersectedCurveId: target.id,
			intersectedCurveType: 'spline',
			previewData: { from: ref.fromPoint, to: bestPt },
		};
	}
	const result = editing.extend(target, allCurves, cursorWorldPos);
	if (!result) return null;
	if (target.type === 'circle' || target.type === 'ellipse') throw new Error('Invalid native extend target');
	const end = result.edge === 'end';
	const fromPoint =
		target.type === 'segment'
			? end
				? target.p2
				: target.p1
			: target.type === 'spline'
				? Vec2.from(result.from)
				: end
					? target.end
					: target.start;
	const toPoint = result.fullLoop ? fromPoint : Vec2.from(result.to);
	const candidate: ExtendCandidate = {
		target,
		targetType: target.type === 'segment' ? 'line' : target.type,
		targetId: target.id,
		edge: result.edge,
		fromPoint,
		toPoint,
		previewType: target.type === 'segment' ? 'line' : target.type === 'spline' ? 'spline' : 'arc',
	};
	if (!result.fullLoop) {
		const cutter = result.source === undefined ? undefined : (allCurves[result.source] ?? target);
		candidate.intersectedCurveId = cutter?.id;
		candidate.intersectedCurveType = cutter?.type;
	}
	if (target.type === 'arc' || target.type === 'elliptical_arc') {
		candidate.becomesFullLoop = result.fullLoop;
		const geometry =
			target.type === 'arc'
				? { center: target.center, radius: target.radius }
				: { center: target.center, majorAxisPoint: target.majorAxisPoint, minorAxisPoint: target.minorAxisPoint };
		candidate.previewData = result.fullLoop
			? { ...geometry, ...(target.type === 'arc' ? { becomesFullCircle: true } : { becomesFullEllipse: true }) }
			: { ...geometry, from: fromPoint, to: toPoint, clockwise: end ? !!target.clockwise : !target.clockwise };
	} else candidate.previewData = { from: fromPoint, to: toPoint };
	return candidate;
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
							const newLen = fixedPt.distanceTo(toPoint);
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
			const newLen = fixedPt.distanceTo(toPoint);
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
			sketch.replaceArcEndpoint(arc, edge, newEndPtId);
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
		if (spline.splineType === 'control') {
			extendControlSpline(sketch, spline, edge, toPoint, newPt);
		} else {
			extendFitSpline(sketch, spline, edge, toPoint, newPt);
		}

		if (intersectedCurveId && intersectedCurveId !== spline.id) {
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

function addHandlePolygonLine(sketch: SketchDocument, splineId: string, p1Id: string, p2Id: string): string {
	const polyLine = sketch.addLine(p1Id, p2Id);
	polyLine.isConstruction = true;
	polyLine.isSplineHandle = true;
	polyLine.parentSplineId = splineId;
	return polyLine.id;
}

function addFitHandle(
	sketch: SketchDocument,
	splineId: string,
	fitPt: SketchPoint,
	h1Pos: Vec2,
	h2Pos: Vec2,
	isAutomaticSplineHandle: boolean
): string {
	const h1 = sketch.addPoint(h1Pos);
	const h2 = sketch.addPoint(h2Pos);
	const hLine = sketch.addLine(h1.id, h2.id);
	hLine.isConstruction = true;
	hLine.isSplineHandle = true;
	hLine.parentSplineId = splineId;
	hLine.isAutomaticSplineHandle = isAutomaticSplineHandle;
	const d1 = fitPt.distanceTo(h1Pos);
	const d2 = fitPt.distanceTo(h2Pos);
	const ratio = d1 + d2 > 1e-6 ? d1 / (d1 + d2) : 0.5;
	sketch.addConstraint(new MidpointConstraint(sketch.nextId('c_mid'), fitPt.id, h1.id, h2.id, 1.0, ratio));
	return hLine.id;
}

function defaultClampedKnots(pointCount: number): number[] {
	if (pointCount <= 4) return [0, 0, 0, 0, 1, 1, 1, 1];
	const spans = pointCount - 3;
	const knots = [0, 0, 0, 0];
	for (let i = 1; i < spans; i++) knots.push(i);
	knots.push(spans, spans, spans, spans);
	return knots;
}

/**
 * Extends a control spline by appending/prepending a straight tangent cubic span
 * while keeping all existing Bezier spans invariant.
 */
function extendControlSpline(
	sketch: SketchDocument,
	spline: NonNullable<ReturnType<SketchDocument['splines']['get']>>,
	edge: 'start' | 'end',
	toPoint: Vec2,
	newPt: SketchPoint
): void {
	const oldPtIds = [...spline.pointIds];
	const oldPts = oldPtIds.map(id => sketch.points.get(id)).filter((p): p is SketchPoint => !!p);
	const oldCurve = spline.toGeoCurve(sketch);
	const oldBoundaryPt = edge === 'end' ? oldPts[oldPts.length - 1] : oldPts[0];
	const oldBoundaryId = edge === 'end' ? oldPtIds[oldPtIds.length - 1] : oldPtIds[0];
	if (!oldBoundaryPt || !oldBoundaryId) return;

	const delta = new Vec2().subVectors(toPoint, oldBoundaryPt);
	// For 'end': oldEnd -> e1 -> e2 -> newPt; for 'start': newPt -> e1 -> e2 -> oldStart.
	const e1Pos =
		edge === 'end'
			? oldBoundaryPt.clone().addScaledVector(delta, 1 / 3)
			: toPoint.clone().addScaledVector(delta, -1 / 3);
	const e2Pos =
		edge === 'end'
			? toPoint.clone().addScaledVector(delta, -1 / 3)
			: oldBoundaryPt.clone().addScaledVector(delta, 1 / 3);
	const e1Pt = sketch.addPoint(e1Pos);
	const e2Pt = sketch.addPoint(e2Pos);

	if (oldPts.length < 4 && oldCurve && oldCurve.bezierSegments.length === 1) {
		// Low-degree (< 4 pts) B-splines ignore knots in bsplineToBezier; elevate the existing span cleanly.
		const seg0 = oldCurve.bezierSegments[0];
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) sketch.removeEntity(lid);
		}
		const b1Pt = sketch.addPoint(seg0[1]);
		const b2Pt = sketch.addPoint(seg0[2]);
		const startId = oldPtIds[0];
		const endId = oldPtIds[oldPtIds.length - 1];
		const middleUnusedId = oldPtIds.length === 3 ? oldPtIds[1] : null;
		const baseIds = [startId, b1Pt.id, b2Pt.id, endId];
		spline.pointIds =
			edge === 'end' ? [...baseIds, e1Pt.id, e2Pt.id, newPt.id] : [newPt.id, e1Pt.id, e2Pt.id, ...baseIds];
		spline.knots = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2];
		spline.tangentLineIds = [];
		for (let i = 0; i < spline.pointIds.length - 1; i++) {
			spline.tangentLineIds.push(addHandlePolygonLine(sketch, spline.id, spline.pointIds[i], spline.pointIds[i + 1]));
		}
		if (middleUnusedId) {
			const usedElsewhere =
				[...sketch.constraints.values()].some(c => c.entityIds.includes(middleUnusedId)) ||
				[...sketch.lines.values()].some(l => l.p1Id === middleUnusedId || l.p2Id === middleUnusedId);
			if (!usedElsewhere) sketch.points.delete(middleUnusedId);
		}
		return;
	}

	const baseKnots =
		spline.knots && spline.knots.length === oldPtIds.length + 4
			? [...spline.knots]
			: defaultClampedKnots(oldPtIds.length);

	if (!spline.tangentLineIds) spline.tangentLineIds = [];
	if (edge === 'end') {
		const kEnd = baseKnots[baseKnots.length - 1];
		const kNew = kEnd + 1;
		spline.knots = [...baseKnots.slice(0, -1), kNew, kNew, kNew, kNew];
		spline.pointIds.push(e1Pt.id, e2Pt.id, newPt.id);
		spline.tangentLineIds.push(
			addHandlePolygonLine(sketch, spline.id, oldBoundaryId, e1Pt.id),
			addHandlePolygonLine(sketch, spline.id, e1Pt.id, e2Pt.id),
			addHandlePolygonLine(sketch, spline.id, e2Pt.id, newPt.id)
		);
	} else {
		const kStart = baseKnots[0];
		spline.knots = [kStart, kStart, kStart, kStart, ...baseKnots.slice(1).map(k => k + 1)];
		spline.pointIds.unshift(newPt.id, e1Pt.id, e2Pt.id);
		spline.tangentLineIds.unshift(
			addHandlePolygonLine(sketch, spline.id, newPt.id, e1Pt.id),
			addHandlePolygonLine(sketch, spline.id, e1Pt.id, e2Pt.id),
			addHandlePolygonLine(sketch, spline.id, e2Pt.id, oldBoundaryId)
		);
	}
}

/**
 * Extends a fit spline without modifying existing handles or segments.
 * Only freezes the old boundary handle (so Catmull-Rom updates do not bend the prior segment),
 * clamps its outward side if shorter extension requires it, and appends the new endpoint handle.
 */
function extendFitSpline(
	sketch: SketchDocument,
	spline: NonNullable<ReturnType<SketchDocument['splines']['get']>>,
	edge: 'start' | 'end',
	toPoint: Vec2,
	newPt: SketchPoint
): void {
	const oldPts = spline.pointIds.map(pid => sketch.points.get(pid)).filter((p): p is SketchPoint => !!p);
	if (oldPts.length < 2) return;

	if (!spline.tangentLineIds || spline.tangentLineIds.length < oldPts.length) {
		const natural = computeNaturalFitHandles(oldPts);
		spline.tangentLineIds = oldPts.map((pt, i) =>
			addFitHandle(sketch, spline.id, pt, natural[i].h1, natural[i].h2, true)
		);
	}

	const oldBoundaryIdx = edge === 'end' ? oldPts.length - 1 : 0;
	const oldBoundaryPt = oldPts[oldBoundaryIdx];
	const oldBoundaryLineId = spline.tangentLineIds[oldBoundaryIdx];
	const oldBoundaryLine = oldBoundaryLineId ? sketch.lines.get(oldBoundaryLineId) : undefined;

	const delta = new Vec2().subVectors(toPoint, oldBoundaryPt);
	const extLen = delta.length();
	const tHat = delta.clone().normalizeOrNull(1e-9);

	let dIn = extLen > 1e-6 ? extLen / 3 : 1;
	if (oldBoundaryLine) {
		// Prevent solve() from recomputing this endpoint's handle with the interior Catmull-Rom rule.
		oldBoundaryLine.isAutomaticSplineHandle = false;
		const h1 = sketch.points.get(oldBoundaryLine.p1Id);
		const h2 = sketch.points.get(oldBoundaryLine.p2Id);
		if (h1 && h2) {
			const inPt = edge === 'end' ? h1 : h2;
			const outPt = edge === 'end' ? h2 : h1;
			dIn = oldBoundaryPt.distanceTo(inPt);
			const outVec = new Vec2().subVectors(outPt, oldBoundaryPt);
			const outLen = outVec.length();
			const isAligned = extLen > 1e-6 && outLen > 1e-6 && tHat !== null && outVec.dot(tHat) / outLen > 1 - 1e-6;
			if (tHat && extLen > 1e-6 && (!isAligned || outLen > extLen * 0.5 || outLen <= 1e-6)) {
				const newOutLen = Math.min(outLen > 1e-6 ? outLen : extLen / 3, extLen * 0.5);
				outPt.x = oldBoundaryPt.x + tHat.x * newOutLen;
				outPt.y = oldBoundaryPt.y + tHat.y * newOutLen;
				const newRatio = dIn + newOutLen > 1e-6 ? (edge === 'end' ? dIn : newOutLen) / (dIn + newOutLen) : 0.5;
				for (const c of Array.from(sketch.constraints.values())) {
					if (
						c instanceof MidpointConstraint &&
						c.midId === oldBoundaryPt.id &&
						c.p1Id === oldBoundaryLine.p1Id &&
						c.p2Id === oldBoundaryLine.p2Id
					) {
						sketch.constraints.set(c.id, new MidpointConstraint(c.id, c.midId, c.p1Id, c.p2Id, c.weight, newRatio));
						break;
					}
				}
			}
		}
	}

	const oppositeIdx = edge === 'end' ? 0 : oldPts.length - 1;
	const oppositePt = oldPts[oppositeIdx];
	if (oppositePt && toPoint.distanceTo(oppositePt) < 1e-3) {
		const oppLine = sketch.lines.get(spline.tangentLineIds[oppositeIdx]);
		if (oppLine) oppLine.isAutomaticSplineHandle = false;
	}

	const dir = tHat ?? new Vec2(1, 0);
	const dNew = extLen > 1e-6 ? Math.min(dIn > 1e-6 ? dIn : extLen / 3, extLen / 3) : 1;
	const newH1Pos =
		edge === 'end'
			? new Vec2(toPoint.x - dir.x * dNew, toPoint.y - dir.y * dNew)
			: new Vec2(toPoint.x + dir.x * dNew, toPoint.y + dir.y * dNew);
	const newH2Pos =
		edge === 'end'
			? new Vec2(toPoint.x + dir.x * dNew, toPoint.y + dir.y * dNew)
			: new Vec2(toPoint.x - dir.x * dNew, toPoint.y - dir.y * dNew);
	const newHLineId = addFitHandle(sketch, spline.id, newPt, newH1Pos, newH2Pos, false);

	if (edge === 'end') {
		spline.pointIds.push(newPt.id);
		spline.tangentLineIds.push(newHLineId);
	} else {
		spline.pointIds.unshift(newPt.id);
		spline.tangentLineIds.unshift(newHLineId);
	}
}

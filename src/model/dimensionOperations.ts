import type { SketchDocument } from './sketch';
import { addConstraint, findConstraint, getRadial, isBuiltInLineId } from './constraintOperations';
import { matchesEndpoints } from './constraintLinks';
import { applyOffsetConstraintValue } from './offsetSync';
import type { IConstraint } from '../solver/types';
import {
	CoincidentConstraint,
	DistanceConstraint,
	RadiusConstraint,
	CollinearConstraint,
	PointOnLineConstraint,
	AngleConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
} from '../solver/constraints';
import type { SketchPoint } from './types';
import { Vec2 } from '../math/vector';
import { MIN_OFFSET_RADIUS as MIN_SOLVER_RADIUS } from '../kernel/offsetTypes';

function roundDimensionDefault(measured: number, min = 0.01): number {
	return Math.max(min, Number(measured.toFixed(2)));
}

function updateExistingDistanceConstraint<T extends DistanceConstraint | PointToLineDistanceConstraint>(
	sketch: SketchDocument,
	existing: T,
	targetDist?: number,
	offset?: number
): T {
	if (offset !== undefined && existing.offset !== offset) {
		existing.offset = offset;
	}
	if (targetDist !== undefined && existing.targetDistance !== targetDist) {
		sketch.pushHistory();
		existing.targetDistance = targetDist;
		existing.value = targetDist;
		sketch.solve();
	}
	return existing;
}

function upsertPointDistance(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	measured: number,
	orientation: 'aligned' | 'horizontal' | 'vertical',
	targetDist?: number,
	offset?: number,
	sign?: number
): DistanceConstraint {
	const existing = getDistanceConstraint(sketch, p1Id, p2Id, orientation);
	if (existing) return updateExistingDistanceConstraint(sketch, existing, targetDist, offset);
	const dist = targetDist ?? roundDimensionDefault(measured);
	const c = new DistanceConstraint(
		sketch.nextId('c_dist'),
		p1Id,
		p2Id,
		dist,
		1.0,
		offset,
		orientation,
		undefined,
		sign
	);
	addConstraint(sketch, c);
	return c;
}

function updateExistingAngleConstraint(
	sketch: SketchDocument,
	existing: AngleConstraint,
	targetAngleDeg?: number,
	arcRadius?: number
): AngleConstraint {
	if (arcRadius !== undefined && existing.arcRadius !== arcRadius) {
		existing.arcRadius = arcRadius;
	}
	if (targetAngleDeg !== undefined && existing.targetAngle !== targetAngleDeg) {
		sketch.pushHistory();
		existing.targetAngle = targetAngleDeg;
		existing.value = targetAngleDeg;
		sketch.solve();
	}
	return existing;
}

function createAngleConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	p1: SketchPoint,
	p2: SketchPoint,
	p3: SketchPoint,
	p4: SketchPoint,
	targetAngleDeg?: number,
	arcRadius?: number,
	cursorPos?: { x: number; y: number },
	s1Override?: number,
	s2Override?: number,
	signOverride?: number
): AngleConstraint {
	const geom = calculateLinesAngleGeometry(
		sketch,
		p1,
		p2,
		p3,
		p4,
		cursorPos,
		line1Id || undefined,
		line2Id || undefined
	);
	const angleVal = targetAngleDeg ?? Math.max(0.1, Math.min(179.9, Math.round(geom.initialAngleDeg * 10) / 10));
	const c = new AngleConstraint(
		sketch.nextId('c_ang'),
		line1Id,
		line2Id,
		p1.id,
		p2.id,
		p3.id,
		p4.id,
		angleVal,
		arcRadius ?? 40,
		s1Override ?? geom.s1,
		s2Override ?? geom.s2,
		signOverride ?? geom.sign
	);
	addConstraint(sketch, c);
	return c;
}

function formatRadiusConstraintName(radius: number, mode: 'radius' | 'diameter'): string {
	const dispVal = mode === 'diameter' ? Number((radius * 2).toFixed(2)) : Number(radius.toFixed(2));
	return mode === 'diameter' ? `Diameter (${dispVal})` : `Radius (${dispVal})`;
}

export function getDistanceConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	orientation?: 'aligned' | 'horizontal' | 'vertical'
): DistanceConstraint | undefined {
	return findConstraint(
		sketch,
		DistanceConstraint,
		c =>
			!c.circleIds &&
			matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id) &&
			(!orientation || (c.orientation ?? 'aligned') === orientation)
	);
}

export function hasDistanceConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	orientation?: 'aligned' | 'horizontal' | 'vertical'
): boolean {
	return getDistanceConstraint(sketch, p1Id, p2Id, orientation) !== undefined;
}

export function addDistanceConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	targetDist?: number,
	offset?: number,
	orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
): DistanceConstraint | null {
	const p1 = sketch.points.get(p1Id);
	const p2 = sketch.points.get(p2Id);
	if (!p1 || !p2) return null;

	const eff = orientation ?? 'aligned';
	const measured =
		eff === 'horizontal' ? Math.abs(p2.x - p1.x) : eff === 'vertical' ? Math.abs(p2.y - p1.y) : p1.distanceTo(p2);
	return upsertPointDistance(sketch, p1Id, p2Id, measured, eff, targetDist, offset);
}

export function canAddCircleDistanceConstraint(sketch: SketchDocument, circle1Id: string, circle2Id: string): boolean {
	if (circle1Id === circle2Id) return false;
	const a = getRadial(sketch, circle1Id);
	const b = getRadial(sketch, circle2Id);
	const p1 = a && sketch.points.get(a.centerId);
	const p2 = b && sketch.points.get(b.centerId);
	return !!p1 && !!p2 && p1.distanceTo(p2) < 1e-5;
}

export function addCircleDistanceConstraint(
	sketch: SketchDocument,
	circle1Id: string,
	circle2Id: string,
	targetDistance?: number
): DistanceConstraint | null {
	const existing = findConstraint(
		sketch,
		DistanceConstraint,
		c => !!c.circleIds && c.circleIds.includes(circle1Id) && c.circleIds.includes(circle2Id) && circle1Id !== circle2Id
	);
	if (existing) {
		return updateExistingDistanceConstraint(sketch, existing, targetDistance);
	}
	if (!canAddCircleDistanceConstraint(sketch, circle1Id, circle2Id)) return null;
	const a = getRadial(sketch, circle1Id)!;
	const b = getRadial(sketch, circle2Id)!;
	const distance = targetDistance ?? roundDimensionDefault(Math.abs(a.radius - b.radius));
	const c = new DistanceConstraint(sketch.nextId('c_dist'), a.centerId, b.centerId, distance);
	c.circleIds = [circle1Id, circle2Id];
	c.leaderOffset = -Math.abs(a.radius - b.radius) / 2;
	c.entityIds = [...new Set([a.centerId, b.centerId, circle1Id, circle2Id])];
	c.name = c.displayName;
	addConstraint(sketch, c);
	return c;
}

export function canAddCircleToLineDistanceConstraint(
	sketch: SketchDocument,
	radialId: string,
	lineId: string
): boolean {
	const radial = getRadial(sketch, radialId);
	const line = sketch.getLine(lineId);
	return !!radial && !!line && radial.centerId !== line.p1Id && radial.centerId !== line.p2Id;
}

export function addCircleToLineDistanceConstraint(
	sketch: SketchDocument,
	radialId: string,
	lineId: string,
	targetDistance?: number
): DistanceConstraint | PointToLineDistanceConstraint | null {
	if (!canAddCircleToLineDistanceConstraint(sketch, radialId, lineId)) return null;
	const radial = getRadial(sketch, radialId)!;
	const c =
		lineId === 'axis_x' || lineId === 'axis_y'
			? addPointToAxisDistanceConstraint(sketch, radial.centerId, lineId === 'axis_x' ? 'x' : 'y', targetDistance)
			: addPointToLineDistanceConstraint(sketch, radial.centerId, lineId, targetDistance);
	if (c && !c.entityIds.includes(radialId)) c.entityIds.push(radialId);
	return c;
}

export function getPointToLineDistanceConstraint(
	sketch: SketchDocument,
	pointId: string,
	lineId: string
): PointToLineDistanceConstraint | undefined {
	return findConstraint(sketch, PointToLineDistanceConstraint, c => c.pointId === pointId && c.lineId === lineId);
}

export function hasPointToLineDistanceConstraint(sketch: SketchDocument, pointId: string, lineId: string): boolean {
	return getPointToLineDistanceConstraint(sketch, pointId, lineId) !== undefined;
}

export function addPointToLineDistanceConstraint(
	sketch: SketchDocument,
	pointId: string,
	lineId: string,
	targetDist?: number,
	offset?: number
): PointToLineDistanceConstraint | null {
	const pt = sketch.points.get(pointId);
	const line = sketch.lines.get(lineId);
	if (!pt || !line) return null;
	if (pointId === line.p1Id || pointId === line.p2Id) return null;

	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return null;

	const existing = getPointToLineDistanceConstraint(sketch, pointId, lineId);
	if (existing) {
		return updateExistingDistanceConstraint(sketch, existing, targetDist, offset);
	}

	const dir = new Vec2().subVectors(p2, p1);
	const lineLen = Math.max(dir.length(), 1e-7);
	const signedArea = new Vec2().subVectors(pt, p1).cross(dir);
	const measured = Math.abs(signedArea) / lineLen;
	const side = signedArea >= 0 ? 1 : -1;

	const currentDist = targetDist ?? roundDimensionDefault(measured);
	const c = new PointToLineDistanceConstraint(
		sketch.nextId('c_pt_line_dist'),
		pointId,
		lineId,
		line.p1Id,
		line.p2Id,
		currentDist,
		side,
		1.0,
		offset
	);
	addConstraint(sketch, c);
	return c;
}

export function getLineToLineDistanceConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string
): PointToLineDistanceConstraint | undefined {
	return findConstraint(
		sketch,
		PointToLineDistanceConstraint,
		c => !!c.constrainedLineId && matchesEndpoints(c.lineId, c.constrainedLineId, line1Id, line2Id)
	);
}

export function canAddLineToLineDistanceConstraint(sketch: SketchDocument, line1Id: string, line2Id: string): boolean {
	if (line1Id === line2Id || (isBuiltInLineId(sketch, line1Id) && isBuiltInLineId(sketch, line2Id))) return false;
	const l1 = sketch.getLine(line1Id);
	const l2 = sketch.getLine(line2Id);
	if (!l1 || !l2) return false;
	const p1 = sketch.points.get(l1.p1Id),
		p2 = sketch.points.get(l1.p2Id);
	const p3 = sketch.points.get(l2.p1Id),
		p4 = sketch.points.get(l2.p2Id);
	if (!p1 || !p2 || !p3 || !p4) return false;
	const d1 = new Vec2().subVectors(p2, p1);
	const d2 = new Vec2().subVectors(p4, p3);
	const len1 = d1.length(),
		len2 = d2.length();
	// Normalize the cross product so the parallel tolerance is independent of line length and direction.
	return len1 > 1e-7 && len2 > 1e-7 && Math.abs(d1.cross(d2)) / len1 / len2 < 1e-5;
}

export function addLineToLineDistanceConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	targetDist?: number,
	offset?: number
): PointToLineDistanceConstraint | null {
	const existing = getLineToLineDistanceConstraint(sketch, line1Id, line2Id);
	if (existing) return updateExistingDistanceConstraint(sketch, existing, targetDist, offset);
	if (!canAddLineToLineDistanceConstraint(sketch, line1Id, line2Id)) return null;
	// An axis is always the reference, regardless of selection order.
	if (isBuiltInLineId(sketch, line2Id)) [line1Id, line2Id] = [line2Id, line1Id];
	const reference = sketch.getLine(line1Id)!;
	const line = sketch.getLine(line2Id)!;
	const a = sketch.points.get(reference.p1Id)!;
	const b = sketch.points.get(reference.p2Id)!;
	const mid = new Vec2().midpoint(sketch.points.get(line.p1Id)!, sketch.points.get(line.p2Id)!);
	const dir = new Vec2().subVectors(b, a);
	const signedDistance = new Vec2().subVectors(mid, a).cross(dir) / dir.length();
	const c = new PointToLineDistanceConstraint(
		sketch.nextId('c_pt_line_dist'),
		line.p1Id,
		line1Id,
		reference.p1Id,
		reference.p2Id,
		targetDist ?? roundDimensionDefault(Math.abs(signedDistance), 0),
		signedDistance >= 0 ? 1 : -1,
		1,
		offset,
		undefined,
		line.p2Id,
		line2Id
	);
	addConstraint(sketch, c);
	return c;
}

export function getOriginConstraint(
	sketch: SketchDocument,
	pointId: string,
	orientation?: 'aligned' | 'horizontal' | 'vertical'
): DistanceConstraint | CoincidentConstraint | undefined {
	for (const c of sketch.constraints.values()) {
		if (
			((c instanceof DistanceConstraint && !c.circleIds) || c instanceof CoincidentConstraint) &&
			matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId) &&
			(orientation === undefined ||
				(c instanceof DistanceConstraint ? c.orientation === orientation : orientation === 'aligned'))
		) {
			return c;
		}
	}
	return undefined;
}

export function hasOriginConstraint(
	sketch: SketchDocument,
	pointId: string,
	orientation?: 'aligned' | 'horizontal' | 'vertical'
): boolean {
	return getOriginConstraint(sketch, pointId, orientation) !== undefined;
}

export function addOriginDistanceConstraint(
	sketch: SketchDocument,
	pointId: string,
	targetDist?: number,
	orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned',
	offset?: number
): DistanceConstraint | null {
	const pt = sketch.points.get(pointId);
	if (!pt) return null;
	const signed = orientation === 'horizontal' ? pt.x : orientation === 'vertical' ? pt.y : pt.length();
	return upsertPointDistance(
		sketch,
		'origin',
		pointId,
		Math.abs(signed),
		orientation,
		targetDist,
		offset,
		orientation === 'aligned' ? undefined : signed >= 0 ? 1 : -1
	);
}

export function getPointToAxisConstraint(
	sketch: SketchDocument,
	pointId: string,
	axis: 'x' | 'y'
): DistanceConstraint | PointOnLineConstraint | undefined {
	const axisId = `axis_${axis}`;
	for (const c of sketch.constraints.values()) {
		if (
			(c instanceof DistanceConstraint &&
				matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId) &&
				c.orientation === (axis === 'x' ? 'vertical' : 'horizontal')) ||
			(c instanceof PointOnLineConstraint && c.pointId === pointId && c.lineP1Id === 'origin' && c.lineP2Id === axisId)
		) {
			return c;
		}
	}
	return undefined;
}

export function hasPointToAxisConstraint(sketch: SketchDocument, pointId: string, axis: 'x' | 'y'): boolean {
	return getPointToAxisConstraint(sketch, pointId, axis) !== undefined;
}

export function addPointToAxisDistanceConstraint(
	sketch: SketchDocument,
	pointId: string,
	axis: 'x' | 'y',
	targetDist?: number,
	offset?: number
): DistanceConstraint | null {
	return addOriginDistanceConstraint(sketch, pointId, targetDist, axis === 'x' ? 'vertical' : 'horizontal', offset);
}

export function getLineToAxisConstraint(
	sketch: SketchDocument,
	lineId: string,
	axis: 'x' | 'y'
): PointToLineDistanceConstraint | CollinearConstraint | undefined {
	const line = sketch.lines.get(lineId);
	if (!line) return undefined;
	for (const c of sketch.constraints.values()) {
		if (
			(c instanceof PointToLineDistanceConstraint && c.constrainedLineId === lineId && c.lineId === `axis_${axis}`) ||
			(c instanceof CollinearConstraint &&
				c.l1P1 === 'origin' &&
				c.l1P2 === `axis_${axis}` &&
				matchesEndpoints(c.l2P1, c.l2P2, line.p1Id, line.p2Id))
		) {
			return c;
		}
	}
	return undefined;
}

export function hasLineToAxisConstraint(sketch: SketchDocument, lineId: string, axis: 'x' | 'y'): boolean {
	return getLineToAxisConstraint(sketch, lineId, axis) !== undefined;
}

export function addLineToAxisDistanceConstraint(
	sketch: SketchDocument,
	lineId: string,
	axis: 'x' | 'y',
	targetDist?: number,
	offset?: number
): PointToLineDistanceConstraint | null {
	const line = sketch.lines.get(lineId);
	if (!line) return null;
	const p1 = sketch.points.get(line.p1Id),
		p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return null;
	const existing = getLineToAxisConstraint(sketch, lineId, axis);
	if (existing instanceof PointToLineDistanceConstraint) {
		return updateExistingDistanceConstraint(sketch, existing, targetDist, offset);
	}
	const mid = axis === 'x' ? (p1.y + p2.y) / 2 : (p1.x + p2.x) / 2;
	const c = new PointToLineDistanceConstraint(
		sketch.nextId('c_pt_line_dist'),
		line.p1Id,
		`axis_${axis}`,
		'origin',
		`axis_${axis}`,
		targetDist ?? roundDimensionDefault(Math.abs(mid)),
		(mid >= 0 ? 1 : -1) * (axis === 'x' ? -1 : 1),
		1,
		offset,
		undefined,
		line.p2Id,
		lineId
	);
	addConstraint(sketch, c);
	return c;
}

export function calculateLinesAngleGeometry(
	sketch: SketchDocument,
	p1: SketchPoint,
	p2: SketchPoint,
	p3: SketchPoint,
	p4: SketchPoint,
	cursorPos?: { x: number; y: number },
	line1Id?: string,
	line2Id?: string
): {
	pInt: Vec2;
	u1: Vec2;
	u2: Vec2;
	s1: number;
	s2: number;
	initialAngleDeg: number;
	sign: number;
} {
	const isAxis1 = Boolean(
		isBuiltInLineId(sketch, line1Id) || isBuiltInLineId(sketch, p1.id) || isBuiltInLineId(sketch, p2.id)
	);
	const isAxis2 = Boolean(
		isBuiltInLineId(sketch, line2Id) || isBuiltInLineId(sketch, p3.id) || isBuiltInLineId(sketch, p4.id)
	);

	const v1 = new Vec2().subVectors(p2, p1);
	const v2 = new Vec2().subVectors(p4, p3);
	const l1 = Math.max(v1.length(), 1e-7);
	const l2 = Math.max(v2.length(), 1e-7);

	// Direction unit vectors along the raw segments (p1->p2, p3->p4)
	const e1 = v1.clone().multiplyScalar(1.0 / l1);
	const e2 = v2.clone().multiplyScalar(1.0 / l2);

	let pInt: Vec2;
	let defS1 = 1;
	let defS2 = 1;

	const sharedEnd =
		!isAxis1 && !isAxis2
			? (
					[
						[p1, p3, 1, 1],
						[p1, p4, 1, -1],
						[p2, p3, -1, 1],
						[p2, p4, -1, -1],
					] as const
				).find(([a, b]) => a.id === b.id || (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4))
			: undefined;

	if (sharedEnd) {
		pInt = sharedEnd[0].clone();
		defS1 = sharedEnd[2];
		defS2 = sharedEnd[3];
	} else {
		const det = v1.cross(v2);
		if (Math.abs(det) < 1e-6) {
			if (isAxis2) {
				const m1 = new Vec2().midpoint(p1, p2);
				pInt = m1.multiply(new Vec2(Math.abs(e2.x), Math.abs(e2.y)));
				defS1 = 1;
				defS2 = v1.dot(e2) >= 0 ? 1 : -1;
			} else if (isAxis1) {
				const m2 = new Vec2().midpoint(p3, p4);
				pInt = m2.multiply(new Vec2(Math.abs(e1.x), Math.abs(e1.y)));
				defS2 = 1;
				defS1 = v2.dot(e1) >= 0 ? 1 : -1;
			} else {
				pInt = new Vec2().midpoint(p1, p3);
				defS1 = 1;
				defS2 = 1;
			}
		} else {
			const t = new Vec2().subVectors(p3, p1).cross(v2) / det;
			pInt = p1.clone().addScaledVector(v1, t);
			let m1 = new Vec2().midpoint(p1, p2);
			let m2 = new Vec2().midpoint(p3, p4);
			if (isAxis2) {
				m2 = m1.clone().multiply(new Vec2(Math.abs(e2.x), Math.abs(e2.y)));
			} else if (isAxis1) {
				m1 = m2.clone().multiply(new Vec2(Math.abs(e1.x), Math.abs(e1.y)));
			}
			const w1 = new Vec2().subVectors(m1, pInt);
			const w2 = new Vec2().subVectors(m2, pInt);
			defS1 = w1.dot(v1) >= 0 ? 1 : -1;
			defS2 = w2.dot(v2) >= 0 ? 1 : -1;
		}
	}

	// Default rays pointing along the physical segments from pInt:
	const u1Seg = e1.clone().multiplyScalar(defS1);
	const u2Seg = e2.clone().multiplyScalar(defS2);

	let s1 = defS1;
	let s2 = defS2;

	if (cursorPos) {
		const w = new Vec2().subVectors(cursorPos, pInt);
		const wLen = w.length();
		if (wLen > 1e-3) {
			// Decompose w in the basis of (u1Seg, u2Seg):
			// w = alpha * u1Seg + beta * u2Seg
			const detSeg = u1Seg.cross(u2Seg);
			if (Math.abs(detSeg) > 1e-6) {
				const alpha = w.cross(u2Seg) / detSeg;
				const beta = u1Seg.cross(w) / detSeg;
				const signAlpha = alpha >= 0 ? 1 : -1;
				const signBeta = beta >= 0 ? 1 : -1;
				s1 = signAlpha * defS1;
				s2 = signBeta * defS2;
			}
		}
	}

	const u1 = v1.clone().multiplyScalar(s1 / l1);
	const u2 = v2.clone().multiplyScalar(s2 / l2);

	const dotVal = Math.min(1, Math.max(-1, u1.dot(u2)));
	const initialAngleDeg = (Math.acos(dotVal) * 180) / Math.PI;
	const crossVal = u1.cross(u2);
	const sign = crossVal >= 0 ? 1 : -1;

	return { pInt, u1, u2, s1, s2, initialAngleDeg, sign };
}

export function addAngleConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	targetAngleDeg?: number,
	arcRadius?: number,
	cursorPosOrS1?: { x: number; y: number } | number,
	s2Param?: number,
	signParam?: number
): AngleConstraint | null {
	const l1 = sketch.getLine(line1Id);
	const l2 = sketch.getLine(line2Id);
	if (!l1 || !l2 || (!sketch.lines.has(line1Id) && !sketch.lines.has(line2Id))) return null;

	const p1 = sketch.points.get(l1.p1Id);
	const p2 = sketch.points.get(l1.p2Id);
	const p3 = sketch.points.get(l2.p1Id);
	const p4 = sketch.points.get(l2.p2Id);
	if (!p1 || !p2 || !p3 || !p4) return null;

	const existing = findConstraint(
		sketch,
		AngleConstraint,
		c => (c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id)
	);
	if (existing) return updateExistingAngleConstraint(sketch, existing, targetAngleDeg, arcRadius);

	return createAngleConstraint(
		sketch,
		line1Id,
		line2Id,
		p1,
		p2,
		p3,
		p4,
		targetAngleDeg,
		arcRadius,
		typeof cursorPosOrS1 === 'object' && cursorPosOrS1 !== null ? cursorPosOrS1 : undefined,
		typeof cursorPosOrS1 === 'number' ? cursorPosOrS1 : undefined,
		typeof s2Param === 'number' ? s2Param : undefined,
		typeof signParam === 'number' ? signParam : undefined
	);
}

export function addThreePointAngleConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	p3Id: string,
	targetAngleDeg?: number,
	arcRadius?: number,
	s1Param?: number,
	s2Param?: number,
	signParam?: number
): AngleConstraint | null {
	if (p1Id === p2Id || p2Id === p3Id || p1Id === p3Id) return null;
	const p1 = sketch.points.get(p1Id);
	const p2 = sketch.points.get(p2Id);
	const p3 = sketch.points.get(p3Id);
	if (!p1 || !p2 || !p3) return null;

	const existing = findConstraint(
		sketch,
		AngleConstraint,
		c => !c.line1Id && !c.line2Id && c.l1P1 === p2Id && c.l2P1 === p2Id && matchesEndpoints(c.l1P2, c.l2P2, p1Id, p3Id)
	);
	if (existing) return updateExistingAngleConstraint(sketch, existing, targetAngleDeg, arcRadius);

	return createAngleConstraint(
		sketch,
		'',
		'',
		p2,
		p1,
		p2,
		p3,
		targetAngleDeg,
		arcRadius,
		undefined,
		typeof s1Param === 'number' ? s1Param : 1,
		typeof s2Param === 'number' ? s2Param : 1,
		typeof signParam === 'number' ? signParam : undefined
	);
}

export function addArcAngleConstraint(
	sketch: SketchDocument,
	arcId: string,
	targetAngleDeg: number,
	arcRadius = 40,
	sweepSign = 1
): AngleConstraint | null {
	const arc = sketch.arcs.get(arcId);
	if (!arc) return null;
	const pCenter = sketch.points.get(arc.centerId);
	const pStart = sketch.points.get(arc.startPointId);
	const pEnd = sketch.points.get(arc.endPointId);
	if (!pCenter || !pStart || !pEnd) return null;

	const c = new AngleConstraint(
		sketch.nextId('c_ang'),
		arc.id,
		arc.id,
		arc.centerId,
		arc.startPointId,
		arc.centerId,
		arc.endPointId,
		targetAngleDeg,
		arcRadius,
		1,
		1,
		sweepSign >= 0 ? 1 : -1
	);
	addConstraint(sketch, c);
	return c;
}

export function addRadiusConstraint(
	sketch: SketchDocument,
	circleOrArcId: string,
	targetRadius?: number,
	displayMode?: 'radius' | 'diameter',
	placement?: Pick<RadiusConstraint, 'leaderAngle' | 'leaderOffset'>
): RadiusConstraint | null {
	const isCircle = sketch.circles.has(circleOrArcId);
	const entity = getRadial(sketch, circleOrArcId);
	if (!entity) return null;

	const defaultMode: 'radius' | 'diameter' = displayMode ?? (isCircle ? 'diameter' : 'radius');

	// Check if a radius constraint already exists on this circle or arc
	const existing = findConstraint(sketch, RadiusConstraint, c => c.circleId === circleOrArcId);

	if (existing) {
		if (displayMode !== undefined) {
			existing.displayMode = displayMode;
		} else if (!existing.displayMode) {
			existing.displayMode = defaultMode;
		}

		if (targetRadius !== undefined) {
			sketch.pushHistory();
			existing.targetRadius = targetRadius;
			existing.value = targetRadius;
			existing.name = formatRadiusConstraintName(targetRadius, existing.displayMode ?? defaultMode);
			sketch.withStableCircleCenters(() => sketch.solve());
		}
		return existing;
	}

	const r = targetRadius ?? roundDimensionDefault(entity.radius, MIN_SOLVER_RADIUS);
	const c = new RadiusConstraint(sketch.nextId('c_rad'), circleOrArcId, r, 1.0, placement?.leaderAngle, defaultMode);
	c.leaderOffset = placement?.leaderOffset;
	sketch.withStableCircleCenters(() => addConstraint(sketch, c));
	return c;
}

export function applyConstraintValueDirectly(
	sketch: SketchDocument,
	c: IConstraint,
	newValue: number,
	displayMode?: 'radius' | 'diameter'
): boolean {
	if (!isFinite(newValue) || newValue <= 0) return false;

	if (c instanceof DistanceConstraint || c instanceof PointToLineDistanceConstraint) {
		c.targetDistance = newValue;
		c.value = newValue;
		c.name = c.displayName;
		return true;
	}

	if (c instanceof OffsetConstraint) {
		return applyOffsetConstraintValue(sketch, c, newValue);
	}

	if (c instanceof AngleConstraint) {
		const isArcAngle = c.line1Id === c.line2Id && sketch.arcs.has(c.line1Id);
		const maxAngle = isArcAngle ? 359.9 : 179.9;
		const clampedAngle = Math.min(maxAngle, Math.max(0.1, newValue));
		c.targetAngle = clampedAngle;
		c.value = clampedAngle;
		c.name = 'Angle';
		if (isArcAngle) {
			const arc = sketch.arcs.get(c.line1Id);
			if (arc) {
				const center = sketch.points.get(arc.centerId);
				const start = sketch.points.get(arc.startPointId);
				const end = sketch.points.get(arc.endPointId);
				if (center && start && end && !sketch.isPointFixed(arc.endPointId)) {
					const as = center.angleToPoint(start);
					const sweepRad = (clampedAngle * Math.PI) / 180;
					const newAe = arc.clockwise ? as - sweepRad : as + sweepRad;
					end.x = center.x + Math.cos(newAe) * arc.radius;
					end.y = center.y + Math.sin(newAe) * arc.radius;
				}
			}
		}
		return true;
	}

	if (c instanceof RadiusConstraint) {
		const mode = displayMode ?? c.displayMode;
		const targetRad = mode === 'diameter' ? newValue / 2 : newValue;
		c.targetRadius = targetRad;
		c.value = targetRad;
		c.displayMode = mode;
		c.name = formatRadiusConstraintName(targetRad, mode);
		sketch.solverCoordinator.markPreserveCentersOnNextSolve();

		const arc = sketch.arcs.get(c.circleId);
		if (arc) {
			const center = sketch.points.get(arc.centerId);
			if (center) {
				for (const ptId of [arc.startPointId, arc.endPointId]) {
					const pt = sketch.points.get(ptId);
					if (pt && !sketch.isPointFixed(ptId)) {
						const angle = center.angleToPoint(pt);
						pt.x = center.x + Math.cos(angle) * targetRad;
						pt.y = center.y + Math.sin(angle) * targetRad;
					}
				}
			}
		}
		return true;
	}

	return false;
}

export function updateDimensionalConstraint(
	sketch: SketchDocument,
	constraintId: string,
	newValue: number | string,
	displayMode?: 'radius' | 'diameter'
): boolean {
	const c = sketch.constraints.get(constraintId);
	if (!c) return false;

	let val: number;
	let expr: string | undefined;

	if (typeof newValue === 'string') {
		const trimmed = newValue.trim();
		const evalRes = sketch.evaluateExpression(trimmed);
		if (!evalRes.isValid || !evalRes.value || !isFinite(evalRes.value) || evalRes.value <= 0) {
			return false;
		}
		val = evalRes.value;
		if (evalRes.referencedVars.length > 0 || isNaN(Number(trimmed.replace(',', '.')))) {
			expr = trimmed;
		}
	} else {
		if (!isFinite(newValue) || newValue <= 0) return false;
		val = newValue;
		expr = undefined;
	}

	const offsetTransaction = c instanceof OffsetConstraint;
	if (offsetTransaction) sketch.beginTransaction();
	try {
		const applied = applyConstraintValueDirectly(sketch, c, val, displayMode);
		if (applied) {
			c.expression = expr;
			sketch.solve();
			return true;
		}
		return false;
	} finally {
		if (offsetTransaction) sketch.commitTransaction(false);
	}
}

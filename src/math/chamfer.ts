import { Vec2 } from './vector';
import type { SketchDocument } from '../model/sketch';
import { remapLineConstraints } from '../model/constraintLinks';
import { CoincidentConstraint } from '../solver/constraints';

import { getGeometryKernel } from '../kernel';
import * as reference from './chamferReference';
import type { ChamferMode } from '../kernel/chamferTypes';
export type { ChamferMode } from '../kernel/chamferTypes';

export interface ChamferCandidate {
	id: string;
	vertexPointId: string;
	vertexPos: Vec2;
	line1: {
		id: string;
		cornerPointId: string;
		otherPointId: string;
	};
	line2: {
		id: string;
		cornerPointId: string;
		otherPointId: string;
	};
	dir1: Vec2;
	dir2: Vec2;
	len1: number;
	len2: number;
	cornerAngleRad: number;
	result?: ChamferResult;
}

export interface ChamferResult {
	t1: Vec2;
	t2: Vec2;
	dist1: number;
	dist2: number;
	angleDeg: number;
	chamferLength: number;
	midPoint: Vec2;
	bisectorDir: Vec2;
	maxDist1: number;
	maxDist2: number;
	isValid: boolean;
	errorMessage?: string;
}

/**
 * Finds all points coincident with startPointId and returns non-handle lines connected to them.
 * A corner is valid for chamfer if and only if exactly 2 lines (and no other curves) meet at it.
 */
export function getConnectedLinesForPoint(
	sketch: SketchDocument,
	startPointId: string
): { valid: boolean; pointIds: Set<string>; lineIds: string[] } {
	if (!sketch.points.has(startPointId)) {
		return { valid: false, pointIds: new Set(), lineIds: [] };
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

	// 2. Ensure NO arcs or splines are connected to this vertex
	for (const arc of sketch.arcs.values()) {
		if (pointIds.has(arc.startPointId) || pointIds.has(arc.endPointId)) {
			return { valid: false, pointIds, lineIds: [] };
		}
	}
	for (const spline of sketch.splines.values()) {
		if (spline.pointIds.length >= 2) {
			const pStart = spline.pointIds[0];
			const pEnd = spline.pointIds[spline.pointIds.length - 1];
			if (pointIds.has(pStart) || pointIds.has(pEnd)) {
				return { valid: false, pointIds, lineIds: [] };
			}
		}
	}

	// 3. Collect non-handle lines connected to pointIds
	const lineIds: string[] = [];
	const seenIds = new Set<string>();

	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue;
		const p1In = pointIds.has(line.p1Id);
		const p2In = pointIds.has(line.p2Id);
		if (p1In || p2In) {
			if (!seenIds.has(line.id)) {
				seenIds.add(line.id);
				lineIds.push(line.id);
			}
		}
	}

	return {
		valid: lineIds.length === 2,
		pointIds,
		lineIds,
	};
}

/**
 * Creates a ChamferCandidate given a vertex point where exactly 2 lines meet.
 */
export function findChamferCandidateForPoint(sketch: SketchDocument, pointId: string): ChamferCandidate | null {
	const conn = getConnectedLinesForPoint(sketch, pointId);
	if (!conn.valid || conn.lineIds.length !== 2) return null;

	return buildChamferCandidate(sketch, conn.lineIds[0], conn.lineIds[1], conn.pointIds);
}

/**
 * Creates a ChamferCandidate given two lines that share a common vertex point (or coincident points).
 */
export function findChamferCandidateForLines(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string
): ChamferCandidate | null {
	if (line1Id === line2Id) return null;
	const l1 = sketch.lines.get(line1Id);
	const l2 = sketch.lines.get(line2Id);
	if (!l1 || !l2 || l1.isSplineHandle || l2.isSplineHandle) return null;

	// Check if they share a point directly or through coincidence
	const l1Points = [l1.p1Id, l1.p2Id];
	for (const pId of l1Points) {
		const conn = getConnectedLinesForPoint(sketch, pId);
		if (conn.lineIds.includes(line1Id) && conn.lineIds.includes(line2Id)) {
			return buildChamferCandidate(sketch, line1Id, line2Id, conn.pointIds);
		}
	}

	return null;
}

function buildChamferCandidate(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	vertexPointIds: Set<string>
): ChamferCandidate | null {
	const l1 = sketch.lines.get(line1Id);
	const l2 = sketch.lines.get(line2Id);
	if (!l1 || !l2) return null;

	const l1CornerId = vertexPointIds.has(l1.p1Id) ? l1.p1Id : l1.p2Id;
	const l1OtherId = l1CornerId === l1.p1Id ? l1.p2Id : l1.p1Id;

	const l2CornerId = vertexPointIds.has(l2.p1Id) ? l2.p1Id : l2.p2Id;
	const l2OtherId = l2CornerId === l2.p1Id ? l2.p2Id : l2.p1Id;

	const pCorner1 = sketch.points.get(l1CornerId);
	const pOther1 = sketch.points.get(l1OtherId);
	const pOther2 = sketch.points.get(l2OtherId);

	if (!pCorner1 || !pOther1 || !pOther2) return null;

	const vertexPos = pCorner1.clone();

	const api = getGeometryKernel().chamfer;
	const frame = api
		? api.corner(vertexPos, pOther1, pOther2)
		: reference.calculateChamferCorner(vertexPos, pOther1, pOther2);
	if (!frame) return null;
	const { len1, len2, cornerAngleRad } = frame;
	const dir1 = Vec2.from(frame.dir1),
		dir2 = Vec2.from(frame.dir2);

	return {
		id: `chamfer_${line1Id}_${line2Id}`,
		vertexPointId: l1CornerId,
		vertexPos,
		line1: {
			id: line1Id,
			cornerPointId: l1CornerId,
			otherPointId: l1OtherId,
		},
		line2: {
			id: line2Id,
			cornerPointId: l2CornerId,
			otherPointId: l2OtherId,
		},
		dir1,
		dir2,
		len1,
		len2,
		cornerAngleRad,
	};
}

export function calculateChamferGeometry(
	candidate: ChamferCandidate,
	mode: ChamferMode,
	dist1Input: number,
	dist2Input: number,
	angleDegInput: number,
	flip: boolean
): ChamferResult {
	const api = getGeometryKernel().chamfer;
	if (!api) return reference.calculateChamferGeometry(candidate, mode, dist1Input, dist2Input, angleDegInput, flip);
	const r = api.calculate(candidate, mode, dist1Input, dist2Input, angleDegInput, flip);
	return {
		...r,
		t1: Vec2.from(r.t1),
		t2: Vec2.from(r.t2),
		midPoint: Vec2.from(r.midPoint),
		bisectorDir: Vec2.from(r.bisectorDir),
	};
}

/**
 * Commits a chamfer into the SketchDocument.
 */
export function commitChamferToSketch(
	sketch: SketchDocument,
	candidate: ChamferCandidate,
	mode: ChamferMode,
	dist1: number,
	dist2: number,
	angleDeg: number,
	flip: boolean,
	expressions?: { dist1?: string; dist2?: string; angle?: string }
): {
	chamferLineId: string;
	p1Id: string;
	p2Id: string;
	vertexPointId: string;
} | null {
	const res = calculateChamferGeometry(candidate, mode, dist1, dist2, angleDeg, flip);
	if (!res.isValid) return null;

	sketch.beginTransaction();

	// 1. Add points for the chamfer endpoints
	const pA = sketch.addPoint(res.t1);
	const pB = sketch.addPoint(res.t2);

	// 2. Add the chamfer line
	const chamferLine = sketch.addLine(pA.id, pB.id);

	// 3. Shorten line 1 by replacing corner point with pA
	const l1 = sketch.lines.get(candidate.line1.id);
	if (l1) {
		remapLineConstraints(sketch, l1, candidate.line1.cornerPointId, pA.id);
		if (l1.p1Id === candidate.line1.cornerPointId) {
			l1.p1Id = pA.id;
		} else {
			l1.p2Id = pA.id;
		}
	}

	// 4. Shorten line 2 by replacing corner point with pB
	const l2 = sketch.lines.get(candidate.line2.id);
	if (l2) {
		remapLineConstraints(sketch, l2, candidate.line2.cornerPointId, pB.id);
		if (l2.p1Id === candidate.line2.cornerPointId) {
			l2.p1Id = pB.id;
		} else {
			l2.p2Id = pB.id;
		}
	}

	sketch.rebuildParamManager();

	const VId = candidate.vertexPointId;

	// 5. Shortened lines must have PointOnLine (coincident line-point) constraint to V
	if (l1) {
		sketch.addPointOnLineConstraint(VId, l1.id);
	}
	if (l2) {
		sketch.addPointOnLineConstraint(VId, l2.id);
	}

	// 6. Add Distance / Angle constraints
	// Positive dimension offsets use the clockwise normal in world coordinates.
	const offset1 = candidate.dir1.cross(candidate.dir2) > 0 ? 10 : -10;
	const offset2 = -offset1;
	if (mode === 'equal_distance') {
		const c1 = sketch.addDistanceConstraint(VId, pA.id, res.dist1, offset1);
		if (c1 && expressions?.dist1) c1.expression = expressions.dist1;
		const c2 = sketch.addDistanceConstraint(VId, pB.id, res.dist2, offset2);
		if (c2 && expressions?.dist1) c2.expression = expressions.dist1;
	} else if (mode === 'two_distance') {
		const c1 = sketch.addDistanceConstraint(VId, pA.id, res.dist1, offset1);
		const expr1 = flip ? expressions?.dist2 : expressions?.dist1;
		if (c1 && expr1) c1.expression = expr1;
		const c2 = sketch.addDistanceConstraint(VId, pB.id, res.dist2, offset2);
		const expr2 = flip ? expressions?.dist1 : expressions?.dist2;
		if (c2 && expr2) c2.expression = expr2;
	} else if (mode === 'distance_angle') {
		const cornerCentroid = Vec2.centroid([candidate.vertexPos, res.t1, res.t2]);
		if (!flip) {
			// Distance along line 1
			const c1 = sketch.addDistanceConstraint(VId, pA.id, res.dist1, offset1);
			if (c1 && expressions?.dist1) c1.expression = expressions.dist1;
			// Angle between chamfer line and line 1
			if (l1) {
				const cAng = sketch.addAngleConstraint(chamferLine.id, l1.id, res.angleDeg, 30, cornerCentroid);
				if (cAng && expressions?.angle) cAng.expression = expressions.angle;
			}
		} else {
			// Distance along line 2 (offset on other side of line)
			const c2 = sketch.addDistanceConstraint(VId, pB.id, res.dist2, offset2);
			if (c2 && expressions?.dist1) c2.expression = expressions.dist1;
			// Angle between chamfer line and line 2
			if (l2) {
				const cAng = sketch.addAngleConstraint(chamferLine.id, l2.id, res.angleDeg, 30, cornerCentroid);
				if (cAng && expressions?.angle) cAng.expression = expressions.angle;
			}
		}
	}

	sketch.commitTransaction();
	sketch.solve();

	return {
		chamferLineId: chamferLine.id,
		p1Id: pA.id,
		p2Id: pB.id,
		vertexPointId: VId,
	};
}

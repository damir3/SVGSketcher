import type { Vec2 } from './vector';
import { dist, normalize, vec } from './vector';
import type { SketchDocument } from '../model/sketch';
import { CoincidentConstraint } from '../solver/constraints';

export type ChamferMode = 'equal_distance' | 'two_distance' | 'distance_angle';

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
export function findChamferCandidateForPoint(
	sketch: SketchDocument,
	pointId: string
): ChamferCandidate | null {
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

	const vertexPos = vec(pCorner1.x, pCorner1.y);

	const v1 = vec(pOther1.x - vertexPos.x, pOther1.y - vertexPos.y);
	const v2 = vec(pOther2.x - vertexPos.x, pOther2.y - vertexPos.y);

	const len1 = Math.hypot(v1.x, v1.y);
	const len2 = Math.hypot(v2.x, v2.y);

	if (len1 < 1e-4 || len2 < 1e-4) return null;

	const dir1 = vec(v1.x / len1, v1.y / len1);
	const dir2 = vec(v2.x / len2, v2.y / len2);

	const dot = Math.max(-1, Math.min(1, dir1.x * dir2.x + dir1.y * dir2.y));
	// Check collinearity
	if (Math.abs(dot) > 0.9999) return null;

	const cornerAngleRad = Math.acos(dot);

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

/**
 * Calculates chamfer geometry (points t1 and t2, distances, angle) for a candidate given parameters.
 */
export function calculateChamferGeometry(
	candidate: ChamferCandidate,
	mode: ChamferMode,
	dist1Input: number,
	dist2Input: number,
	angleDegInput: number,
	flip: boolean
): ChamferResult {
	const theta = candidate.cornerAngleRad;
	let effDist1 = 0;
	let effDist2 = 0;
	let effAngleDeg = 45;

	let isValid = true;
	let errorMessage: string | undefined;

	const maxDist1 = Math.max(0.1, candidate.len1 - 0.1);
	const maxDist2 = Math.max(0.1, candidate.len2 - 0.1);

	if (mode === 'equal_distance') {
		effDist1 = Math.max(0.1, dist1Input);
		effDist2 = effDist1;
		// In equal distance mode on corner theta, angle at A in triangle VAB:
		// (180 - theta) / 2
		effAngleDeg = ((Math.PI - theta) / 2) * (180 / Math.PI);
	} else if (mode === 'two_distance') {
		const d1 = Math.max(0.1, dist1Input);
		const d2 = Math.max(0.1, dist2Input);
		if (!flip) {
			effDist1 = d1;
			effDist2 = d2;
		} else {
			effDist1 = d2;
			effDist2 = d1;
		}
		// Angle at A via arctan2 / trigonometry in triangle VAB:
		// Vector AB = t2 - t1
		const pt1 = vec(
			candidate.vertexPos.x + candidate.dir1.x * effDist1,
			candidate.vertexPos.y + candidate.dir1.y * effDist1
		);
		const pt2 = vec(
			candidate.vertexPos.x + candidate.dir2.x * effDist2,
			candidate.vertexPos.y + candidate.dir2.y * effDist2
		);
		const vAB = vec(pt2.x - pt1.x, pt2.y - pt1.y);
		const vAV = vec(-candidate.dir1.x, -candidate.dir1.y);
		const dotAB_AV = Math.max(-1, Math.min(1, (vAB.x * vAV.x + vAB.y * vAV.y) / (Math.hypot(vAB.x, vAB.y) || 1)));
		effAngleDeg = Math.acos(dotAB_AV) * (180 / Math.PI);
	} else if (mode === 'distance_angle') {
		const d = Math.max(0.1, dist1Input);
		const aDeg = Math.max(0, Math.min(179.9, angleDegInput));
		effAngleDeg = aDeg;
		const alphaRad = (aDeg * Math.PI) / 180;

		// In triangle VAB, corner at V is theta, angle at reference vertex is alphaRad.
		// Sum of angles = 180 -> beta = pi - theta - alphaRad.
		// For valid triangle, alphaRad + theta must be < pi, and alphaRad > 0.
		if (alphaRad <= 1e-4) {
			isValid = false;
			errorMessage = 'Angle must be greater than 0°';
			effDist1 = d;
			effDist2 = 0;
		} else if (alphaRad + theta >= Math.PI - 1e-4) {
			isValid = false;
			errorMessage = 'Angle too large for corner';
			// Fallback calculation so geometry doesn't blow up
			effDist1 = d;
			effDist2 = d;
		} else {
			const sinBeta = Math.sin(Math.PI - theta - alphaRad);
			const sinAlpha = Math.sin(alphaRad);
			const otherDist = d * (sinAlpha / Math.max(1e-5, sinBeta));

			if (!flip) {
				effDist1 = d;
				effDist2 = otherDist;
			} else {
				effDist2 = d;
				effDist1 = otherDist;
			}
		}
	}

	if (effDist1 > maxDist1 || effDist2 > maxDist2) {
		isValid = false;
		if (!errorMessage) {
			errorMessage = 'Distance too large for corner';
		}
	}

	const t1 = vec(
		candidate.vertexPos.x + candidate.dir1.x * effDist1,
		candidate.vertexPos.y + candidate.dir1.y * effDist1
	);
	const t2 = vec(
		candidate.vertexPos.x + candidate.dir2.x * effDist2,
		candidate.vertexPos.y + candidate.dir2.y * effDist2
	);

	const chamferLength = dist(t1, t2);
	const midPoint = vec((t1.x + t2.x) / 2, (t1.y + t2.y) / 2);
	const bisectorDir = normalize(vec(candidate.dir1.x + candidate.dir2.x, candidate.dir1.y + candidate.dir2.y));

	return {
		t1,
		t2,
		dist1: effDist1,
		dist2: effDist2,
		angleDeg: effAngleDeg,
		chamferLength,
		midPoint,
		bisectorDir,
		maxDist1,
		maxDist2,
		isValid,
		errorMessage,
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
	flip: boolean
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
	const pA = sketch.addPoint(res.t1.x, res.t1.y);
	const pB = sketch.addPoint(res.t2.x, res.t2.y);

	// 2. Add the chamfer line
	const chamferLine = sketch.addLine(pA.id, pB.id);

	// 3. Shorten line 1 by replacing corner point with pA
	const l1 = sketch.lines.get(candidate.line1.id);
	if (l1) {
		if (l1.p1Id === candidate.line1.cornerPointId) {
			l1.p1Id = pA.id;
		} else {
			l1.p2Id = pA.id;
		}
	}

	// 4. Shorten line 2 by replacing corner point with pB
	const l2 = sketch.lines.get(candidate.line2.id);
	if (l2) {
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
	if (mode === 'equal_distance') {
		sketch.addDistanceConstraint(VId, pA.id, res.dist1, 10);
		sketch.addDistanceConstraint(VId, pB.id, res.dist2, -10);
	} else if (mode === 'two_distance') {
		sketch.addDistanceConstraint(VId, pA.id, res.dist1, 10);
		sketch.addDistanceConstraint(VId, pB.id, res.dist2, -10);
	} else if (mode === 'distance_angle') {
		const centroid = {
			x: (candidate.vertexPos.x + res.t1.x + res.t2.x) / 3,
			y: (candidate.vertexPos.y + res.t1.y + res.t2.y) / 3,
		};
		if (!flip) {
			// Distance along line 1
			sketch.addDistanceConstraint(VId, pA.id, res.dist1, 10);
			// Angle between chamfer line and line 1
			if (l1) {
				sketch.addAngleConstraint(chamferLine.id, l1.id, res.angleDeg, 30, centroid);
			}
		} else {
			// Distance along line 2 (offset on other side of line)
			sketch.addDistanceConstraint(VId, pB.id, res.dist2, -10);
			// Angle between chamfer line and line 2
			if (l2) {
				sketch.addAngleConstraint(chamferLine.id, l2.id, res.angleDeg, 30, centroid);
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

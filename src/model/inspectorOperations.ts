import { ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import {
	FixedConstraint,
	DistanceConstraint,
	RadiusConstraint,
	PointOnCircleConstraint,
	DragPointConstraint,
	AngleConstraint,
} from '../solver/constraints';
import { Vec2 } from '../math/vector';

export function setPointCoords(sketch: SketchDocument, pointId: string, targetX: number, targetY: number): boolean {
	const pt = sketch.points.get(pointId);
	if (!pt || !isFinite(targetX) || !isFinite(targetY)) return false;

	const dir = new Vec2(targetX - pt.x, targetY - pt.y);

	let hadFixed = false;
	for (const c of sketch.constraints.values()) {
		if (c instanceof FixedConstraint && c.pointId === pointId) {
			c.targetX = targetX;
			c.targetY = targetY;
			hadFixed = true;
		}
	}

	pt.x = targetX;
	pt.y = targetY;

	// Translate free endpoints of any arc/ellipse centered at this point so they move rigidly
	const extraDrags: IConstraint[] = [];
	if (!hadFixed) {
		extraDrags.push(new DragPointConstraint(pointId, targetX, targetY, 0.005));
	}
	for (const arc of sketch.arcs.values()) {
		if (arc.centerId === pointId) {
			const sPt = sketch.points.get(arc.startPointId);
			const ePt = sketch.points.get(arc.endPointId);
			if (sPt && !sketch.isPointFixed(arc.startPointId)) {
				sPt.x += dir.x;
				sPt.y += dir.y;
				extraDrags.push(new DragPointConstraint(arc.startPointId, sPt.x, sPt.y, 0.005));
			}
			if (ePt && !sketch.isPointFixed(arc.endPointId)) {
				ePt.x += dir.x;
				ePt.y += dir.y;
				extraDrags.push(new DragPointConstraint(arc.endPointId, ePt.x, ePt.y, 0.005));
			}
		}
	}
	for (const el of [...sketch.ellipses.values(), ...sketch.ellipticalArcs.values()]) {
		if (el.centerId === pointId) {
			const majPt = sketch.points.get(el.majorAxisPointId);
			const minPt = sketch.points.get(el.minorAxisPointId);
			if (majPt && !sketch.isPointFixed(el.majorAxisPointId)) {
				majPt.x += dir.x;
				majPt.y += dir.y;
				extraDrags.push(new DragPointConstraint(el.majorAxisPointId, majPt.x, majPt.y, 0.005));
			}
			if (minPt && !sketch.isPointFixed(el.minorAxisPointId)) {
				minPt.x += dir.x;
				minPt.y += dir.y;
				extraDrags.push(new DragPointConstraint(el.minorAxisPointId, minPt.x, minPt.y, 0.005));
			}
			if ('startPointId' in el) {
				const sPt = sketch.points.get(el.startPointId);
				const ePt = sketch.points.get(el.endPointId);
				if (sPt && !sketch.isPointFixed(el.startPointId)) {
					sPt.x += dir.x;
					sPt.y += dir.y;
					extraDrags.push(new DragPointConstraint(el.startPointId, sPt.x, sPt.y, 0.005));
				}
				if (ePt && !sketch.isPointFixed(el.endPointId)) {
					ePt.x += dir.x;
					ePt.y += dir.y;
					extraDrags.push(new DragPointConstraint(el.endPointId, ePt.x, ePt.y, 0.005));
				}
			}
		}
	}

	if (hadFixed) {
		if (extraDrags.length > 0) {
			sketch.solve(extraDrags);
		}
		sketch.solve();
	} else {
		sketch.solveWithTemporaryHardConstraints(
			[new FixedConstraint('__temp_fix', pointId, targetX, targetY, 1.0)],
			extraDrags
		);
	}
	return true;
}

export function setLineLength(sketch: SketchDocument, lineId: string, newLength: number): boolean {
	const line = sketch.lines.get(lineId);
	if (!line || !isFinite(newLength) || newLength <= 0) return false;
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return false;

	const dir = new Vec2().subVectors(p2, p1).normalizeOrNull(1e-9) ?? new Vec2(1, 0);

	// Update any existing distance constraint on this line
	let updatedExisting = false;
	for (const c of sketch.constraints.values()) {
		if (
			c instanceof DistanceConstraint &&
			((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
		) {
			const orient = c.orientation ?? 'aligned';
			if (
				orient === 'aligned' ||
				(orient === 'horizontal' && Math.abs(dir.y) < 1e-4) ||
				(orient === 'vertical' && Math.abs(dir.x) < 1e-4)
			) {
				c.targetDistance = newLength;
				c.value = newLength;
				updatedExisting = true;
			}
		}
	}

	const p1Fixed = sketch.isPointFixed(line.p1Id);
	const p2Fixed = sketch.isPointFixed(line.p2Id);
	if (p2Fixed && !p1Fixed) {
		p1.x = p2.x - dir.x * newLength;
		p1.y = p2.y - dir.y * newLength;
	} else if (!p2Fixed) {
		p2.x = p1.x + dir.x * newLength;
		p2.y = p1.y + dir.y * newLength;
	}

	const fallbackDrags = [
		new DragPointConstraint(line.p1Id, p1.x, p1.y, 0.005),
		new DragPointConstraint(line.p2Id, p2.x, p2.y, 0.005),
	];

	if (updatedExisting) {
		sketch.solve();
	} else {
		sketch.solveWithTemporaryHardConstraints(
			[new DistanceConstraint('__temp_dist', line.p1Id, line.p2Id, newLength, 1.0)],
			fallbackDrags
		);
	}
	return true;
}

export function setLineAngle(sketch: SketchDocument, lineId: string, newAngleDeg: number): boolean {
	const line = sketch.lines.get(lineId);
	if (!line || !isFinite(newAngleDeg)) return false;
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return false;

	const len = p1.distanceTo(p2);
	if (len < 1e-9) return false;
	const rad = (newAngleDeg * Math.PI) / 180;
	const u = Vec2.fromPolar(1, rad);

	const origValues = sketch.paramManager.getCurrentValues();

	const p1Fixed = sketch.isPointFixed(line.p1Id);
	const p2Fixed = sketch.isPointFixed(line.p2Id);
	if (p2Fixed && !p1Fixed) {
		p1.x = p2.x - u.x * len;
		p1.y = p2.y - u.y * len;
	} else if (!p2Fixed) {
		p2.x = p1.x + u.x * len;
		p2.y = p1.y + u.y * len;
	}
	const targetP1 = p1.clone();
	const targetP2 = p2.clone();

	const tempAngleConstraint: IConstraint = {
		id: '__temp_line_angle',
		type: 'angle',
		name: 'Temp Line Angle',
		entityIds: [line.p1Id, line.p2Id],
		weight: 1.0,
		isSoft: false,
		isDimensional: false,
		getEquationsCount: () => 1,
		evaluate: paramMap => {
			const point1 = new Vec2(paramMap.get(`${line.p1Id}.x`) ?? p1.x, paramMap.get(`${line.p1Id}.y`) ?? p1.y);
			const point2 = new Vec2(paramMap.get(`${line.p2Id}.x`) ?? p2.x, paramMap.get(`${line.p2Id}.y`) ?? p2.y);
			return [u.cross(new Vec2().subVectors(point2, point1))];
		},
		jacobian: (paramIndices, baseRow) => {
			const entries = [];
			const idxX1 = paramIndices.get(`${line.p1Id}.x`);
			if (idxX1 !== undefined) entries.push({ row: baseRow, col: idxX1, val: u.y });
			const idxY1 = paramIndices.get(`${line.p1Id}.y`);
			if (idxY1 !== undefined) entries.push({ row: baseRow, col: idxY1, val: -u.x });
			const idxX2 = paramIndices.get(`${line.p2Id}.x`);
			if (idxX2 !== undefined) entries.push({ row: baseRow, col: idxX2, val: -u.y });
			const idxY2 = paramIndices.get(`${line.p2Id}.y`);
			if (idxY2 !== undefined) entries.push({ row: baseRow, col: idxY2, val: u.x });
			return entries;
		},
	};

	const checkDirection = () => {
		const dir = new Vec2().subVectors(p2, p1);
		return dir.length() > 1e-3 && dir.dot(u) > 0;
	};

	const fallbackDrags = [
		new DragPointConstraint(line.p1Id, targetP1.x, targetP1.y, 0.005),
		new DragPointConstraint(line.p2Id, targetP2.x, targetP2.y, 0.005),
	];

	// 1. Try preserving both the requested angle and the current line length (works when DoF >= 2)
	let solved = sketch.tryHardSolve(
		[tempAngleConstraint, new DistanceConstraint('__temp_dist', line.p1Id, line.p2Id, len, 1.0)],
		checkDirection
	);

	// 2. If over-constrained, solve with the angle constraint alone
	if (!solved) {
		sketch.paramManager.restoreValues(origValues);
		solved = sketch.tryHardSolve([tempAngleConstraint], checkDirection);
	}

	// 3. If still not solved and the line has an AngleConstraint with another line, update that AngleConstraint
	if (!solved) {
		for (const c of sketch.constraints.values()) {
			if (c instanceof AngleConstraint && c.line1Id !== c.line2Id && (c.line1Id === lineId || c.line2Id === lineId)) {
				sketch.paramManager.restoreValues(origValues);
				const otherLineId = c.line1Id === lineId ? c.line2Id : c.line1Id;
				const otherLine = sketch.lines.get(otherLineId);
				if (otherLine) {
					const op1 = sketch.points.get(otherLine.p1Id);
					const op2 = sketch.points.get(otherLine.p2Id);
					if (op1 && op2) {
						const otherDir = new Vec2().subVectors(op2, op1);
						const otherLen = Math.max(otherDir.length(), 1e-7);
						const otherUnit = otherDir.clone().divideScalar(otherLen);
						const u1 = (c.line1Id === lineId ? u : otherUnit).clone().multiplyScalar(c.s1);
						const u2 = (c.line2Id === lineId ? u : otherUnit).clone().multiplyScalar(c.s2);
						const dotVal = Math.max(-1, Math.min(1, u1.dot(u2)));
						const newRelAngle = Math.min(179.9, Math.max(0.1, (Math.acos(dotVal) * 180) / Math.PI));
						c.targetAngle = newRelAngle;
						c.value = newRelAngle;
						solved =
							sketch.tryHardSolve(
								[tempAngleConstraint, new DistanceConstraint('__temp_dist', line.p1Id, line.p2Id, len, 1.0)],
								checkDirection
							) || sketch.tryHardSolve([tempAngleConstraint], checkDirection);
						if (solved) break;
					}
				}
			}
		}
	}

	if (!solved) {
		p1.x = targetP1.x;
		p1.y = targetP1.y;
		p2.x = targetP2.x;
		p2.y = targetP2.y;
		sketch.solve(fallbackDrags);
	}

	sketch.solve();
	return true;
}

export function setLinesRelativeAngle(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	newAngleDeg: number
): boolean {
	const hasUserLine1 = sketch.lines.has(line1Id);
	const hasUserLine2 = sketch.lines.has(line2Id);
	if (!hasUserLine1 && !hasUserLine2) return false;

	const l1 = sketch.getLine(line1Id);
	const l2 = sketch.getLine(line2Id);
	if (!l1 || !l2 || !isFinite(newAngleDeg) || newAngleDeg <= 0) return false;

	const existing = [...sketch.constraints.values()].find(
		c =>
			c instanceof AngleConstraint &&
			((c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id))
	) as AngleConstraint | undefined;
	if (existing) {
		return sketch.updateDimensionalConstraint(existing.id, newAngleDeg);
	}

	const p1 = sketch.points.get(l1.p1Id);
	const p2 = sketch.points.get(l1.p2Id);
	const p3 = sketch.points.get(l2.p1Id);
	const p4 = sketch.points.get(l2.p2Id);
	if (!p1 || !p2 || !p3 || !p4) return false;

	const clampedAngle = Math.min(179.9, Math.max(0.1, newAngleDeg));
	const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, undefined, line1Id, line2Id);
	const len1 = p1.distanceTo(p2);
	const len2 = p3.distanceTo(p4);
	if (len1 < 1e-7 || len2 < 1e-7) return false;

	const originalDir1 = new Vec2().subVectors(p2, p1);
	const originalDir2 = new Vec2().subVectors(p4, p3);

	const tempRelAngle = new AngleConstraint(
		'__temp_rel_ang',
		line1Id,
		line2Id,
		l1.p1Id,
		l1.p2Id,
		l2.p1Id,
		l2.p2Id,
		clampedAngle,
		40,
		geom.s1,
		geom.s2,
		geom.sign
	);
	const tempDist1 = hasUserLine1 ? new DistanceConstraint('__temp_d1', l1.p1Id, l1.p2Id, len1, 1.0) : null;
	const tempDist2 = hasUserLine2 ? new DistanceConstraint('__temp_d2', l2.p1Id, l2.p2Id, len2, 1.0) : null;

	const checkNonDegenerate = () => {
		const dir1 = new Vec2().subVectors(p2, p1);
		const dir2 = new Vec2().subVectors(p4, p3);
		const d1 = dir1.length();
		const d2 = dir2.length();
		if (d1 < 1e-3 || d2 < 1e-3) return false;
		const u1 = dir1.clone().multiplyScalar((geom.s1 * 1) / d1);
		const u2 = dir2.clone().multiplyScalar((geom.s2 * 1) / d2);
		const dotVal = Math.max(-1, Math.min(1, u1.dot(u2)));
		const achievedDeg = (Math.acos(dotVal) * 180) / Math.PI;
		return (
			Math.abs(achievedDeg - clampedAngle) < 0.5 &&
			dir1.dot(originalDir1) > -0.5 * d1 * len1 &&
			dir2.dot(originalDir2) > -0.5 * d2 * len2
		);
	};

	const activeDists = [tempDist1, tempDist2].filter(Boolean) as DistanceConstraint[];
	const candidates: IConstraint[][] = [
		[tempRelAngle, ...activeDists],
		...(activeDists.length > 1
			? [
					[tempRelAngle, activeDists[0]],
					[tempRelAngle, activeDists[1]],
				]
			: []),
		[tempRelAngle],
	];

	for (const cand of candidates) {
		if (sketch.tryHardSolve(cand, checkNonDegenerate)) {
			sketch.solve();
			return true;
		}
	}

	sketch.solve();
	return true;
}

export function setCircleOrArcRadius(sketch: SketchDocument, entityId: string, newRadius: number): boolean {
	if (!isFinite(newRadius) || newRadius <= 0) return false;
	const circle = sketch.circles.get(entityId);
	const arc = sketch.arcs.get(entityId);
	const entity = circle ?? arc;
	if (!entity) return false;

	let updatedExisting = false;
	for (const c of sketch.constraints.values()) {
		if (c instanceof RadiusConstraint && c.circleId === entityId) {
			c.targetRadius = newRadius;
			c.value = newRadius;
			const dispVal = c.displayMode === 'diameter' ? Number((newRadius * 2).toFixed(2)) : Number(newRadius.toFixed(2));
			c.name = c.displayMode === 'diameter' ? `Diameter (${dispVal})` : `Radius (${dispVal})`;
			updatedExisting = true;
		}
	}

	const origValues = sketch.paramManager.getCurrentValues();
	entity.radius = newRadius;
	const center = sketch.points.get(entity.centerId);
	if (center && arc) {
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (start && !sketch.isPointFixed(arc.startPointId)) {
			const as = center.angleToPoint(start);
			start.x = center.x + Math.cos(as) * newRadius;
			start.y = center.y + Math.sin(as) * newRadius;
		}
		if (end && !sketch.isPointFixed(arc.endPointId)) {
			const ae = center.angleToPoint(end);
			end.x = center.x + Math.cos(ae) * newRadius;
			end.y = center.y + Math.sin(ae) * newRadius;
		}
	}

	if (center) {
		for (const c of sketch.constraints.values()) {
			if (c instanceof PointOnCircleConstraint && c.circleId === entityId) {
				const pt = sketch.points.get(c.pointId);
				if (pt && !sketch.isPointFixed(c.pointId)) {
					const ang = center.angleToPoint(pt);
					pt.x = center.x + Math.cos(ang) * newRadius;
					pt.y = center.y + Math.sin(ang) * newRadius;
				}
			}
		}
	}

	if (updatedExisting) {
		sketch.solve();
		return true;
	}
	if (sketch.tryHardSolve([new RadiusConstraint('__temp_rad', entityId, newRadius, 1.0)])) {
		sketch.solve();
		return true;
	}
	sketch.paramManager.restoreValues(origValues);
	sketch.solve();
	return false;
}

export function setArcAngle(sketch: SketchDocument, arcId: string, newSweepDeg: number): boolean {
	const arc = sketch.arcs.get(arcId);
	if (!arc || !isFinite(newSweepDeg) || newSweepDeg <= 0) return false;
	const center = sketch.points.get(arc.centerId);
	const start = sketch.points.get(arc.startPointId);
	const end = sketch.points.get(arc.endPointId);
	if (!center || !start || !end) return false;

	const clampedDeg = Math.min(359.9, Math.max(0.1, newSweepDeg));
	let updatedExisting = false;
	for (const c of sketch.constraints.values()) {
		if (
			c instanceof AngleConstraint &&
			((c.line1Id === arcId && c.line2Id === arcId) ||
				(c.l1P1 === arc.centerId &&
					c.l1P2 === arc.startPointId &&
					c.l2P1 === arc.centerId &&
					c.l2P2 === arc.endPointId))
		) {
			c.targetAngle = clampedDeg;
			c.value = clampedDeg;
			updatedExisting = true;
		}
	}

	const sweepRad = (clampedDeg * Math.PI) / 180;
	if (sketch.isPointFixed(arc.endPointId) && !sketch.isPointFixed(arc.startPointId)) {
		const ae = center.angleToPoint(end);
		const newAs = arc.clockwise ? ae + sweepRad : ae - sweepRad;
		start.x = center.x + Math.cos(newAs) * arc.radius;
		start.y = center.y + Math.sin(newAs) * arc.radius;
	} else if (!sketch.isPointFixed(arc.endPointId)) {
		const as = center.angleToPoint(start);
		const newAe = arc.clockwise ? as - sweepRad : as + sweepRad;
		end.x = center.x + Math.cos(newAe) * arc.radius;
		end.y = center.y + Math.sin(newAe) * arc.radius;
	}

	const fallbackDrags = [
		new DragPointConstraint(arc.centerId, center.x, center.y, 0.005),
		new DragPointConstraint(arc.startPointId, start.x, start.y, 0.005),
		new DragPointConstraint(arc.endPointId, end.x, end.y, 0.005),
	];

	if (updatedExisting) {
		sketch.solve();
	} else {
		sketch.solveWithTemporaryHardConstraints(
			[
				new AngleConstraint(
					'__temp_arc_ang',
					arc.id,
					arc.id,
					arc.centerId,
					arc.startPointId,
					arc.centerId,
					arc.endPointId,
					clampedDeg,
					40,
					1,
					1,
					arc.clockwise ? -1 : 1
				),
			],
			fallbackDrags
		);
	}
	return true;
}

export function setEllipseParams(
	sketch: SketchDocument,
	entityId: string,
	params: { rx?: number; ry?: number; rotationDeg?: number }
): boolean {
	const entity = sketch.ellipses.get(entityId) ?? sketch.ellipticalArcs.get(entityId);
	if (!entity) return false;
	const center = sketch.points.get(entity.centerId);
	const majorPt = sketch.points.get(entity.majorAxisPointId);
	const minorPt = sketch.points.get(entity.minorAxisPointId);
	if (!center || !majorPt || !minorPt) return false;

	const u = new Vec2().subVectors(majorPt, center);
	const v = new Vec2().subVectors(minorPt, center);
	const curRx = Math.max(u.length(), 1e-7);
	const curRy = Math.max(v.length(), 1e-7);

	let uHat = u.clone().multiplyScalar(1 / curRx);
	let vHat = v.clone().multiplyScalar(1 / curRy);
	const sign = uHat.cross(vHat) >= 0 ? 1 : -1;

	let tS = 0;
	let tE = 0;
	const startPt = 'startPointId' in entity ? sketch.points.get(entity.startPointId) : undefined;
	const endPt = 'endPointId' in entity ? sketch.points.get(entity.endPointId) : undefined;
	if (startPt && endPt) {
		const radii = new Vec2(curRx, curRy);
		tS = ellipseParameterAtPoint(startPt, center, radii, uHat, vHat);

		tE = ellipseParameterAtPoint(endPt, center, radii, uHat, vHat);
	}

	const newRx = params.rx !== undefined && isFinite(params.rx) && params.rx > 0 ? params.rx : curRx;
	const newRy = params.ry !== undefined && isFinite(params.ry) && params.ry > 0 ? params.ry : curRy;

	if (params.rx !== undefined && isFinite(params.rx) && params.rx > 0) {
		const distC = sketch.getDistanceConstraint(entity.centerId, entity.majorAxisPointId, 'aligned');
		if (distC) {
			distC.targetDistance = newRx;
			distC.value = newRx;
		}
	}
	if (params.ry !== undefined && isFinite(params.ry) && params.ry > 0) {
		const distC = sketch.getDistanceConstraint(entity.centerId, entity.minorAxisPointId, 'aligned');
		if (distC) {
			distC.targetDistance = newRy;
			distC.value = newRy;
		}
	}
	if (params.rotationDeg !== undefined && isFinite(params.rotationDeg)) {
		const rad = (params.rotationDeg * Math.PI) / 180;
		uHat = Vec2.fromPolar(1, rad);
		vHat = new Vec2(-Math.sin(rad) * sign, Math.cos(rad) * sign);
	}

	if (!sketch.isPointFixed(entity.majorAxisPointId)) {
		majorPt.copy(center).addScaledVector(uHat, newRx);
	}
	if (!sketch.isPointFixed(entity.minorAxisPointId)) {
		minorPt.copy(center).addScaledVector(vHat, newRy);
	}

	const extraDrags: IConstraint[] = [
		new DragPointConstraint(entity.centerId, center.x, center.y, 0.005),
		new DragPointConstraint(entity.majorAxisPointId, majorPt.x, majorPt.y, 0.005),
		new DragPointConstraint(entity.minorAxisPointId, minorPt.x, minorPt.y, 0.005),
	];

	if (startPt && endPt && 'startPointId' in entity) {
		const radii = new Vec2(newRx, newRy);
		if (!sketch.isPointFixed(entity.startPointId)) {
			startPt.copy(ellipsePointAtParameter(tS, center, radii, uHat, vHat));
		}
		if (!sketch.isPointFixed(entity.endPointId)) {
			endPt.copy(ellipsePointAtParameter(tE, center, radii, uHat, vHat));
		}
		extraDrags.push(
			new DragPointConstraint(entity.startPointId, startPt.x, startPt.y, 0.005),
			new DragPointConstraint(entity.endPointId, endPt.x, endPt.y, 0.005)
		);
	}

	sketch.solve(extraDrags);
	sketch.solve();
	return true;
}

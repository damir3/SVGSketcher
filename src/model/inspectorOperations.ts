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
import type { SketchPoint } from './types';
import { dist } from '../math/vector';

export function setPointCoords(
	sketch: SketchDocument,
	pointId: string,
	targetX: number,
	targetY: number
): boolean {
	const pt = sketch.points.get(pointId);
	if (!pt || !isFinite(targetX) || !isFinite(targetY)) return false;

	const dx = targetX - pt.x;
	const dy = targetY - pt.y;

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
				sPt.x += dx;
				sPt.y += dy;
				extraDrags.push(new DragPointConstraint(arc.startPointId, sPt.x, sPt.y, 0.005));
			}
			if (ePt && !sketch.isPointFixed(arc.endPointId)) {
				ePt.x += dx;
				ePt.y += dy;
				extraDrags.push(new DragPointConstraint(arc.endPointId, ePt.x, ePt.y, 0.005));
			}
		}
	}
	for (const el of [...sketch.ellipses.values(), ...sketch.ellipticalArcs.values()]) {
		if (el.centerId === pointId) {
			const majPt = sketch.points.get(el.majorAxisPointId);
			const minPt = sketch.points.get(el.minorAxisPointId);
			if (majPt && !sketch.isPointFixed(el.majorAxisPointId)) {
				majPt.x += dx;
				majPt.y += dy;
				extraDrags.push(new DragPointConstraint(el.majorAxisPointId, majPt.x, majPt.y, 0.005));
			}
			if (minPt && !sketch.isPointFixed(el.minorAxisPointId)) {
				minPt.x += dx;
				minPt.y += dy;
				extraDrags.push(new DragPointConstraint(el.minorAxisPointId, minPt.x, minPt.y, 0.005));
			}
			if ('startPointId' in el) {
				const sPt = sketch.points.get(el.startPointId);
				const ePt = sketch.points.get(el.endPointId);
				if (sPt && !sketch.isPointFixed(el.startPointId)) {
					sPt.x += dx;
					sPt.y += dy;
					extraDrags.push(new DragPointConstraint(el.startPointId, sPt.x, sPt.y, 0.005));
				}
				if (ePt && !sketch.isPointFixed(el.endPointId)) {
					ePt.x += dx;
					ePt.y += dy;
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

export function setLineLength(
	sketch: SketchDocument,
	lineId: string,
	newLength: number
): boolean {
	const line = sketch.lines.get(lineId);
	if (!line || !isFinite(newLength) || newLength <= 0) return false;
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return false;

	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const len = Math.hypot(dx, dy);
	const ux = len > 1e-9 ? dx / len : 1;
	const uy = len > 1e-9 ? dy / len : 0;

	// Update any existing distance constraint on this line
	let updatedExisting = false;
	for (const c of sketch.constraints.values()) {
		if (
			c instanceof DistanceConstraint &&
			((c.p1Id === line.p1Id && c.p2Id === line.p2Id) ||
				(c.p1Id === line.p2Id && c.p2Id === line.p1Id))
		) {
			const orient = c.orientation ?? 'aligned';
			if (
				orient === 'aligned' ||
				(orient === 'horizontal' && Math.abs(uy) < 1e-4) ||
				(orient === 'vertical' && Math.abs(ux) < 1e-4)
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
		p1.x = p2.x - ux * newLength;
		p1.y = p2.y - uy * newLength;
	} else if (!p2Fixed) {
		p2.x = p1.x + ux * newLength;
		p2.y = p1.y + uy * newLength;
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

export function setLineAngle(
	sketch: SketchDocument,
	lineId: string,
	newAngleDeg: number
): boolean {
	const line = sketch.lines.get(lineId);
	if (!line || !isFinite(newAngleDeg)) return false;
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	if (!p1 || !p2) return false;

	const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
	if (len < 1e-9) return false;
	const rad = (newAngleDeg * Math.PI) / 180;
	const ux = Math.cos(rad);
	const uy = Math.sin(rad);

	const origValues = sketch.paramManager.getCurrentValues();

	const p1Fixed = sketch.isPointFixed(line.p1Id);
	const p2Fixed = sketch.isPointFixed(line.p2Id);
	if (p2Fixed && !p1Fixed) {
		p1.x = p2.x - ux * len;
		p1.y = p2.y - uy * len;
	} else if (!p2Fixed) {
		p2.x = p1.x + ux * len;
		p2.y = p1.y + uy * len;
	}
	const targetP1 = { x: p1.x, y: p1.y };
	const targetP2 = { x: p2.x, y: p2.y };

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
			const x1 = paramMap.get(`${line.p1Id}.x`) ?? p1.x;
			const y1 = paramMap.get(`${line.p1Id}.y`) ?? p1.y;
			const x2 = paramMap.get(`${line.p2Id}.x`) ?? p2.x;
			const y2 = paramMap.get(`${line.p2Id}.y`) ?? p2.y;
			return [(y2 - y1) * ux - (x2 - x1) * uy];
		},
		jacobian: (paramIndices, baseRow) => {
			const entries = [];
			const idxX1 = paramIndices.get(`${line.p1Id}.x`);
			if (idxX1 !== undefined) entries.push({ row: baseRow, col: idxX1, val: uy });
			const idxY1 = paramIndices.get(`${line.p1Id}.y`);
			if (idxY1 !== undefined) entries.push({ row: baseRow, col: idxY1, val: -ux });
			const idxX2 = paramIndices.get(`${line.p2Id}.x`);
			if (idxX2 !== undefined) entries.push({ row: baseRow, col: idxX2, val: -uy });
			const idxY2 = paramIndices.get(`${line.p2Id}.y`);
			if (idxY2 !== undefined) entries.push({ row: baseRow, col: idxY2, val: ux });
			return entries;
		},
	};

	const checkDirection = () => {
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		return Math.hypot(dx, dy) > 1e-3 && dx * ux + dy * uy > 0;
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
			if (
				c instanceof AngleConstraint &&
				c.line1Id !== c.line2Id &&
				(c.line1Id === lineId || c.line2Id === lineId)
			) {
				sketch.paramManager.restoreValues(origValues);
				const otherLineId = c.line1Id === lineId ? c.line2Id : c.line1Id;
				const otherLine = sketch.lines.get(otherLineId);
				if (otherLine) {
					const op1 = sketch.points.get(otherLine.p1Id);
					const op2 = sketch.points.get(otherLine.p2Id);
					if (op1 && op2) {
						const u1x = c.line1Id === lineId ? ux * c.s1 : ((op2.x - op1.x) / Math.max(dist(op1, op2), 1e-7)) * c.s1;
						const u1y = c.line1Id === lineId ? uy * c.s1 : ((op2.y - op1.y) / Math.max(dist(op1, op2), 1e-7)) * c.s1;
						const u2x = c.line2Id === lineId ? ux * c.s2 : ((op2.x - op1.x) / Math.max(dist(op1, op2), 1e-7)) * c.s2;
						const u2y = c.line2Id === lineId ? uy * c.s2 : ((op2.y - op1.y) / Math.max(dist(op1, op2), 1e-7)) * c.s2;
						const dotVal = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
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
	const isAxis1 = line1Id === 'axis_x' || line1Id === 'axis_y';
	const isAxis2 = line2Id === 'axis_x' || line2Id === 'axis_y';
	if (isAxis1 && isAxis2) return false;

	const l1 = isAxis1 ? null : sketch.lines.get(line1Id);
	const l2 = isAxis2 ? null : sketch.lines.get(line2Id);
	if ((!l1 && !isAxis1) || (!l2 && !isAxis2) || !isFinite(newAngleDeg) || newAngleDeg <= 0) return false;

	const existing = [...sketch.constraints.values()].find(
		c =>
			c instanceof AngleConstraint &&
			((c.line1Id === line1Id && c.line2Id === line2Id) ||
				(c.line1Id === line2Id && c.line2Id === line1Id))
	) as AngleConstraint | undefined;
	if (existing) {
		return sketch.updateDimensionalConstraint(existing.id, newAngleDeg);
	}

	const p1 = isAxis1
		? ({ id: line1Id, x: 0, y: 0 } as SketchPoint)
		: sketch.points.get(l1!.p1Id);
	const p2 = isAxis1
		? ({ id: line1Id, x: line1Id === 'axis_x' ? 1 : 0, y: line1Id === 'axis_x' ? 0 : 1 } as SketchPoint)
		: sketch.points.get(l1!.p2Id);
	const p3 = isAxis2
		? ({ id: line2Id, x: 0, y: 0 } as SketchPoint)
		: sketch.points.get(l2!.p1Id);
	const p4 = isAxis2
		? ({ id: line2Id, x: line2Id === 'axis_x' ? 1 : 0, y: line2Id === 'axis_x' ? 0 : 1 } as SketchPoint)
		: sketch.points.get(l2!.p2Id);
	if (!p1 || !p2 || !p3 || !p4) return false;

	const clampedAngle = Math.min(179.9, Math.max(0.1, newAngleDeg));
	const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, undefined, line1Id, line2Id);
	const len1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
	const len2 = Math.hypot(p4.x - p3.x, p4.y - p3.y);
	if (len1 < 1e-7 || len2 < 1e-7) return false;

	const origDx1 = p2.x - p1.x;
	const origDy1 = p2.y - p1.y;
	const origDx2 = p4.x - p3.x;
	const origDy2 = p4.y - p3.y;

	const tempRelAngle = new AngleConstraint(
		'__temp_rel_ang',
		line1Id,
		line2Id,
		isAxis1 ? '' : l1!.p1Id,
		isAxis1 ? '' : l1!.p2Id,
		isAxis2 ? '' : l2!.p1Id,
		isAxis2 ? '' : l2!.p2Id,
		clampedAngle,
		40,
		geom.s1,
		geom.s2,
		geom.sign
	);
	const tempDist1 = !isAxis1 ? new DistanceConstraint('__temp_d1', l1!.p1Id, l1!.p2Id, len1, 1.0) : null;
	const tempDist2 = !isAxis2 ? new DistanceConstraint('__temp_d2', l2!.p1Id, l2!.p2Id, len2, 1.0) : null;

	const checkNonDegenerate = () => {
		const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
		const d2 = Math.hypot(p4.x - p3.x, p4.y - p3.y);
		if (d1 < 1e-3 || d2 < 1e-3) return false;
		const u1x = ((p2.x - p1.x) / d1) * geom.s1;
		const u1y = ((p2.y - p1.y) / d1) * geom.s1;
		const u2x = ((p4.x - p3.x) / d2) * geom.s2;
		const u2y = ((p4.y - p3.y) / d2) * geom.s2;
		const dotVal = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
		const achievedDeg = (Math.acos(dotVal) * 180) / Math.PI;
		return (
			Math.abs(achievedDeg - clampedAngle) < 0.5 &&
			(isAxis1 || (p2.x - p1.x) * origDx1 + (p2.y - p1.y) * origDy1 > -0.5 * d1 * len1) &&
			(isAxis2 || (p4.x - p3.x) * origDx2 + (p4.y - p3.y) * origDy2 > -0.5 * d2 * len2)
		);
	};

	const activeDists = [tempDist1, tempDist2].filter(Boolean) as DistanceConstraint[];
	const candidates: IConstraint[][] = [
		[tempRelAngle, ...activeDists],
		...(activeDists.length > 1 ? [[tempRelAngle, activeDists[0]], [tempRelAngle, activeDists[1]]] : []),
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

export function setCircleOrArcRadius(
	sketch: SketchDocument,
	entityId: string,
	newRadius: number
): boolean {
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
			const dispVal =
				c.displayMode === 'diameter'
					? Number((newRadius * 2).toFixed(2))
					: Number(newRadius.toFixed(2));
			c.name = c.displayMode === 'diameter' ? `Diameter (${dispVal})` : `Radius (${dispVal})`;
			updatedExisting = true;
		}
	}

	entity.radius = newRadius;
	const center = sketch.points.get(entity.centerId);
	if (center && arc) {
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (start && !sketch.isPointFixed(arc.startPointId)) {
			const as = Math.atan2(start.y - center.y, start.x - center.x);
			start.x = center.x + Math.cos(as) * newRadius;
			start.y = center.y + Math.sin(as) * newRadius;
		}
		if (end && !sketch.isPointFixed(arc.endPointId)) {
			const ae = Math.atan2(end.y - center.y, end.x - center.x);
			end.x = center.x + Math.cos(ae) * newRadius;
			end.y = center.y + Math.sin(ae) * newRadius;
		}
	}

	if (center) {
		for (const c of sketch.constraints.values()) {
			if (c instanceof PointOnCircleConstraint && c.circleId === entityId) {
				const pt = sketch.points.get(c.pointId);
				if (pt && !sketch.isPointFixed(c.pointId)) {
					const ang = Math.atan2(pt.y - center.y, pt.x - center.x);
					pt.x = center.x + Math.cos(ang) * newRadius;
					pt.y = center.y + Math.sin(ang) * newRadius;
				}
			}
		}
	}

	if (updatedExisting) {
		sketch.solve();
	} else {
		sketch.solveWithTemporaryHardConstraints([
			new RadiusConstraint('__temp_rad', entityId, newRadius, 1.0),
		]);
	}
	return true;
}

export function setArcAngle(
	sketch: SketchDocument,
	arcId: string,
	newSweepDeg: number
): boolean {
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
		const ae = Math.atan2(end.y - center.y, end.x - center.x);
		const newAs = arc.clockwise ? ae + sweepRad : ae - sweepRad;
		start.x = center.x + Math.cos(newAs) * arc.radius;
		start.y = center.y + Math.sin(newAs) * arc.radius;
	} else if (!sketch.isPointFixed(arc.endPointId)) {
		const as = Math.atan2(start.y - center.y, start.x - center.x);
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

	const uX = majorPt.x - center.x;
	const uY = majorPt.y - center.y;
	const vX = minorPt.x - center.x;
	const vY = minorPt.y - center.y;
	const curRx = Math.max(Math.hypot(uX, uY), 1e-7);
	const curRy = Math.max(Math.hypot(vX, vY), 1e-7);

	let uHatX = uX / curRx;
	let uHatY = uY / curRx;
	let vHatX = vX / curRy;
	let vHatY = vY / curRy;
	const sign = uHatX * vHatY - uHatY * vHatX >= 0 ? 1 : -1;

	let tS = 0;
	let tE = 0;
	const startPt = 'startPointId' in entity ? sketch.points.get(entity.startPointId) : undefined;
	const endPt = 'endPointId' in entity ? sketch.points.get(entity.endPointId) : undefined;
	if (startPt && endPt) {
		const dsX = startPt.x - center.x;
		const dsY = startPt.y - center.y;
		const uS = dsX * uHatX + dsY * uHatY;
		const vS = dsX * vHatX + dsY * vHatY;
		tS = Math.atan2(vS / curRy, uS / curRx);

		const deX = endPt.x - center.x;
		const deY = endPt.y - center.y;
		const uE = deX * uHatX + deY * uHatY;
		const vE = deX * vHatX + deY * vHatY;
		tE = Math.atan2(vE / curRy, uE / curRx);
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
		uHatX = Math.cos(rad);
		uHatY = Math.sin(rad);
		vHatX = -Math.sin(rad) * sign;
		vHatY = Math.cos(rad) * sign;
	}

	if (!sketch.isPointFixed(entity.majorAxisPointId)) {
		majorPt.x = center.x + uHatX * newRx;
		majorPt.y = center.y + uHatY * newRx;
	}
	if (!sketch.isPointFixed(entity.minorAxisPointId)) {
		minorPt.x = center.x + vHatX * newRy;
		minorPt.y = center.y + vHatY * newRy;
	}

	const extraDrags: IConstraint[] = [
		new DragPointConstraint(entity.centerId, center.x, center.y, 0.005),
		new DragPointConstraint(entity.majorAxisPointId, majorPt.x, majorPt.y, 0.005),
		new DragPointConstraint(entity.minorAxisPointId, minorPt.x, minorPt.y, 0.005),
	];

	if (startPt && endPt && 'startPointId' in entity) {
		if (!sketch.isPointFixed(entity.startPointId)) {
			const uSNew = newRx * Math.cos(tS);
			const vSNew = newRy * Math.sin(tS);
			startPt.x = center.x + uSNew * uHatX + vSNew * vHatX;
			startPt.y = center.y + uSNew * uHatY + vSNew * vHatY;
		}
		if (!sketch.isPointFixed(entity.endPointId)) {
			const uENew = newRx * Math.cos(tE);
			const vENew = newRy * Math.sin(tE);
			endPt.x = center.x + uENew * uHatX + vENew * vHatX;
			endPt.y = center.y + uENew * uHatY + vENew * vHatY;
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

import type { SketchDocument } from './sketch';
import {
	CircularPatternConstraint,
	computePatternCopyAngle,
	type PatternCopyData,
	type PatternPointPair,
	type PatternRadiusPair,
	RectangularPatternConstraint,
	computeRectangularPatternOffset,
	computeRectangularPatternDirections,
	type RectangularPatternCopyData,
} from '../solver/constraints';

export function generateCircularPatternCopy(
	sketch: SketchDocument,
	centerPtId: string,
	sourceObjectIds: string[],
	copyIndex: number,
	quantity: number,
	distribution: 'full' | 'partial' | 'symmetric',
	totalAngle: number
): PatternCopyData | null {
	const centerPt =
		centerPtId === 'origin'
			? ({ id: 'origin', x: 0, y: 0 } as any)
			: sketch.points.get(centerPtId);
	if (!centerPt) return null;

	const angleDeg = computePatternCopyAngle(copyIndex, quantity, distribution, totalAngle);
	const rad = (angleDeg * Math.PI) / 180;
	const cosA = Math.cos(rad);
	const sinA = Math.sin(rad);

	const pointMap = new Map<string, string>();
	const pointPairs: PatternPointPair[] = [];
	const radiusPairs: PatternRadiusPair[] = [];
	const createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}> = [];

	const getOrRotatePoint = (origPtId: string): string => {
		if (pointMap.has(origPtId)) return pointMap.get(origPtId)!;
		if (origPtId === centerPtId) {
			pointMap.set(origPtId, centerPtId);
			return centerPtId;
		}
		const pt = sketch.points.get(origPtId);
		if (!pt) return origPtId;

		const distToCenter = Math.hypot(pt.x - centerPt.x, pt.y - centerPt.y);
		if (distToCenter < 1e-3) {
			pointMap.set(origPtId, centerPtId);
			return centerPtId;
		}

		const dx = pt.x - centerPt.x;
		const dy = pt.y - centerPt.y;
		const rx = centerPt.x + dx * cosA - dy * sinA;
		const ry = centerPt.y + dx * sinA + dy * cosA;

		const newPt = sketch.addPoint(rx, ry, false);
		pointMap.set(origPtId, newPt.id);
		pointPairs.push({ sourcePtId: origPtId, patternPtId: newPt.id });
		createdEntityIds.push({ id: newPt.id, type: 'point' });
		return newPt.id;
	};

	for (const objId of sourceObjectIds) {
		const line = sketch.lines.get(objId);
		if (line) {
			const np1Id = getOrRotatePoint(line.p1Id);
			const np2Id = getOrRotatePoint(line.p2Id);
			if (np1Id !== np2Id) {
				const newLine = sketch.addLine(np1Id, np2Id, line.isConstruction);
				createdEntityIds.push({ id: newLine.id, type: 'line' });
			}
			continue;
		}

		const circle = sketch.circles.get(objId);
		if (circle) {
			const nCenterId = getOrRotatePoint(circle.centerId);
			const newCircle = sketch.addCircle(nCenterId, circle.radius, circle.isConstruction);
			radiusPairs.push({ sourceCircleId: circle.id, patternCircleId: newCircle.id });
			createdEntityIds.push({ id: newCircle.id, type: 'circle' });
			continue;
		}

		const arc = sketch.arcs.get(objId);
		if (arc) {
			const nCenterId = getOrRotatePoint(arc.centerId);
			const nStartId = getOrRotatePoint(arc.startPointId);
			const nEndId = getOrRotatePoint(arc.endPointId);
			const newArc = sketch.addArc(
				nCenterId,
				nStartId,
				nEndId,
				arc.radius,
				arc.clockwise,
				arc.isConstruction
			);
			radiusPairs.push({ sourceCircleId: arc.id, patternCircleId: newArc.id });
			createdEntityIds.push({ id: newArc.id, type: 'arc' });
			continue;
		}

		const ellipse = sketch.ellipses.get(objId);
		if (ellipse) {
			const nCenterId = getOrRotatePoint(ellipse.centerId);
			const nMajorId = getOrRotatePoint(ellipse.majorAxisPointId);
			const nMinorId = getOrRotatePoint(ellipse.minorAxisPointId);
			const newEllipse = sketch.addEllipse(
				nCenterId,
				nMajorId,
				nMinorId,
				ellipse.isConstruction
			);
			createdEntityIds.push({ id: newEllipse.id, type: 'ellipse' });
			continue;
		}

		const elArc = sketch.ellipticalArcs.get(objId);
		if (elArc) {
			const nCenterId = getOrRotatePoint(elArc.centerId);
			const nMajorId = getOrRotatePoint(elArc.majorAxisPointId);
			const nMinorId = getOrRotatePoint(elArc.minorAxisPointId);
			const nStartId = getOrRotatePoint(elArc.startPointId);
			const nEndId = getOrRotatePoint(elArc.endPointId);
			const newElArc = sketch.addEllipticalArc(
				nCenterId,
				nMajorId,
				nMinorId,
				nStartId,
				nEndId,
				elArc.clockwise,
				elArc.isConstruction
			);
			createdEntityIds.push({ id: newElArc.id, type: 'elliptical_arc' });
			continue;
		}

		const pt = sketch.points.get(objId);
		if (pt) {
			getOrRotatePoint(pt.id);
			continue;
		}
	}

	return {
		copyIndex,
		pointPairs,
		radiusPairs,
		createdEntityIds,
	};
}

export function deletePatternCopy(sketch: SketchDocument, copy: PatternCopyData): void {
	for (const item of copy.createdEntityIds) {
		if (item.type === 'line') sketch.lines.delete(item.id);
		else if (item.type === 'circle') sketch.circles.delete(item.id);
		else if (item.type === 'arc') sketch.arcs.delete(item.id);
		else if (item.type === 'ellipse') sketch.ellipses.delete(item.id);
		else if (item.type === 'elliptical_arc') sketch.ellipticalArcs.delete(item.id);
		else if (item.type === 'point') sketch.points.delete(item.id);

		sketch.selection.pointIds.delete(item.id);
		sketch.selection.lineIds.delete(item.id);
		sketch.selection.circleIds.delete(item.id);
		sketch.selection.arcIds.delete(item.id);
		sketch.selection.ellipseIds.delete(item.id);
		sketch.selection.ellipticalArcIds.delete(item.id);
	}
}

export function addCircularPatternConstraint(
	sketch: SketchDocument,
	centerPtId: string,
	sourceObjectIds: string[],
	distribution: 'full' | 'partial' | 'symmetric',
	totalAngle: number,
	quantity: number,
	suppression: boolean,
	suppressedIndices: number[],
	copies: PatternCopyData[],
	id?: string,
	isReadOnly?: boolean,
	totalAngleExpression?: string
): CircularPatternConstraint | null {
	if (centerPtId !== 'origin' && !sketch.points.has(centerPtId)) return null;

	const cid = id || sketch.nextId('c_cpat');
	const c = new CircularPatternConstraint(
		cid,
		centerPtId,
		sourceObjectIds,
		distribution,
		totalAngle,
		quantity,
		suppression,
		suppressedIndices,
		copies,
		1.0,
		isReadOnly,
		totalAngleExpression
	);
	sketch.addConstraint(c);
	return c;
}

export function updateCircularPattern(
	sketch: SketchDocument,
	constraintId: string,
	updates: {
		distribution?: 'full' | 'partial' | 'symmetric';
		totalAngle?: number;
		totalAngleExpression?: string;
		quantity?: number;
		suppression?: boolean;
		suppressedIndices?: number[];
	}
): boolean {
	const c = sketch.constraints.get(constraintId);
	if (!c || !(c instanceof CircularPatternConstraint) || c.isReadOnly) return false;

	sketch.beginTransaction();

	if (updates.totalAngleExpression !== undefined) {
		c.totalAngleExpression = updates.totalAngleExpression;
	}

	const oldDist = c.distribution;
	const oldAngle = c.totalAngle;
	const oldQty = c.quantity;
	const oldSuppression = c.suppression;
	const oldSuppressed = new Set(c.suppressedIndices);

	const newDist = updates.distribution ?? oldDist;
	const newAngle = updates.totalAngle !== undefined ? updates.totalAngle : oldAngle;
	const newQty = updates.quantity !== undefined ? Math.max(2, Math.round(updates.quantity)) : oldQty;
	const newSuppression = updates.suppression !== undefined ? updates.suppression : oldSuppression;
	const newSuppressed = updates.suppressedIndices !== undefined ? new Set(updates.suppressedIndices) : oldSuppressed;

	c.distribution = newDist;
	c.totalAngle = newAngle;
	c.quantity = newQty;
	c.suppression = newSuppression;
	c.suppressedIndices = Array.from(newSuppressed);

	// 1. Delete excess copies if quantity decreased
	for (let i = c.copies.length - 1; i >= 0; i--) {
		const copy = c.copies[i];
		if (copy.copyIndex >= newQty) {
			deletePatternCopy(sketch, copy);
			c.copies.splice(i, 1);
		}
	}

	// 2. Add or remove copies based on quantity and suppression
	for (let k = 1; k < newQty; k++) {
		const shouldBeSuppressed = newSuppression && newSuppressed.has(k);
		const existingIndex = c.copies.findIndex(cp => cp.copyIndex === k);

		if (shouldBeSuppressed) {
			if (existingIndex >= 0) {
				deletePatternCopy(sketch, c.copies[existingIndex]);
				c.copies.splice(existingIndex, 1);
			}
		} else {
			if (existingIndex < 0) {
				const newCopy = generateCircularPatternCopy(
					sketch,
					c.centerPtId,
					c.sourceObjectIds,
					k,
					newQty,
					newDist,
					newAngle
				);
				if (newCopy) {
					c.copies.push(newCopy);
				}
			}
		}
	}

	// 3. Update coordinates of existing copies to new angle/distribution positions
	const centerPt = sketch.points.get(c.centerPtId);
	if (centerPt) {
		for (const copy of c.copies) {
			const aDeg = computePatternCopyAngle(copy.copyIndex, newQty, newDist, newAngle);
			const rad = (aDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);

			for (const pair of copy.pointPairs) {
				const sPt = sketch.points.get(pair.sourcePtId);
				const pPt = sketch.points.get(pair.patternPtId);
				if (sPt && pPt) {
					const dx = sPt.x - centerPt.x;
					const dy = sPt.y - centerPt.y;
					pPt.x = centerPt.x + dx * cosA - dy * sinA;
					pPt.y = centerPt.y + dx * sinA + dy * cosA;
				}
			}
		}
	}

	// 4. Update pointIds on BaseConstraint
	const pointIdSet = new Set<string>();
	pointIdSet.add(c.centerPtId);
	for (const copy of c.copies) {
		for (const pair of copy.pointPairs) {
			pointIdSet.add(pair.sourcePtId);
			pointIdSet.add(pair.patternPtId);
		}
	}
	(c as any).entityIds = Array.from(pointIdSet);

	sketch.rebuildParamManager();
	sketch.solve();
	sketch.commitTransaction();
	return true;
}

export function generateRectangularPatternCopy(
	sketch: SketchDocument,
	sourceObjectIds: string[],
	i: number,
	j: number,
	distance1: number,
	direction1: 'one_direction' | 'symmetric',
	distance2: number,
	direction2: 'one_direction' | 'symmetric',
	u1: { x: number; y: number },
	u2: { x: number; y: number }
): RectangularPatternCopyData | null {
	const offset = computeRectangularPatternOffset(i, j, distance1, direction1, distance2, direction2, u1, u2);
	const pointMap = new Map<string, string>();
	const pointPairs: PatternPointPair[] = [];
	const radiusPairs: PatternRadiusPair[] = [];
	const createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}> = [];

	const getOrTranslatePoint = (origPtId: string): string => {
		if (pointMap.has(origPtId)) return pointMap.get(origPtId)!;
		const pt = sketch.points.get(origPtId);
		if (!pt) return origPtId;

		const tx = pt.x + offset.dx;
		const ty = pt.y + offset.dy;

		const newPt = sketch.addPoint(tx, ty, false);
		pointMap.set(origPtId, newPt.id);
		pointPairs.push({ sourcePtId: origPtId, patternPtId: newPt.id });
		createdEntityIds.push({ id: newPt.id, type: 'point' });
		return newPt.id;
	};

	for (const objId of sourceObjectIds) {
		const line = sketch.lines.get(objId);
		if (line) {
			const np1Id = getOrTranslatePoint(line.p1Id);
			const np2Id = getOrTranslatePoint(line.p2Id);
			if (np1Id !== np2Id) {
				const newLine = sketch.addLine(np1Id, np2Id, line.isConstruction);
				createdEntityIds.push({ id: newLine.id, type: 'line' });
			}
			continue;
		}

		const circle = sketch.circles.get(objId);
		if (circle) {
			const nCenterId = getOrTranslatePoint(circle.centerId);
			const newCircle = sketch.addCircle(nCenterId, circle.radius, circle.isConstruction);
			radiusPairs.push({ sourceCircleId: circle.id, patternCircleId: newCircle.id });
			createdEntityIds.push({ id: newCircle.id, type: 'circle' });
			continue;
		}

		const arc = sketch.arcs.get(objId);
		if (arc) {
			const nCenterId = getOrTranslatePoint(arc.centerId);
			const nStartId = getOrTranslatePoint(arc.startPointId);
			const nEndId = getOrTranslatePoint(arc.endPointId);
			const newArc = sketch.addArc(
				nCenterId,
				nStartId,
				nEndId,
				arc.radius,
				arc.clockwise,
				arc.isConstruction
			);
			radiusPairs.push({ sourceCircleId: arc.id, patternCircleId: newArc.id });
			createdEntityIds.push({ id: newArc.id, type: 'arc' });
			continue;
		}

		const ellipse = sketch.ellipses.get(objId);
		if (ellipse) {
			const nCenterId = getOrTranslatePoint(ellipse.centerId);
			const nMajorId = getOrTranslatePoint(ellipse.majorAxisPointId);
			const nMinorId = getOrTranslatePoint(ellipse.minorAxisPointId);
			const newEllipse = sketch.addEllipse(
				nCenterId,
				nMajorId,
				nMinorId,
				ellipse.isConstruction
			);
			createdEntityIds.push({ id: newEllipse.id, type: 'ellipse' });
			continue;
		}

		const elArc = sketch.ellipticalArcs.get(objId);
		if (elArc) {
			const nCenterId = getOrTranslatePoint(elArc.centerId);
			const nMajorId = getOrTranslatePoint(elArc.majorAxisPointId);
			const nMinorId = getOrTranslatePoint(elArc.minorAxisPointId);
			const nStartId = getOrTranslatePoint(elArc.startPointId);
			const nEndId = getOrTranslatePoint(elArc.endPointId);
			const newElArc = sketch.addEllipticalArc(
				nCenterId,
				nMajorId,
				nMinorId,
				nStartId,
				nEndId,
				elArc.clockwise,
				elArc.isConstruction
			);
			createdEntityIds.push({ id: newElArc.id, type: 'elliptical_arc' });
			continue;
		}

		const pt = sketch.points.get(objId);
		if (pt) {
			getOrTranslatePoint(pt.id);
			continue;
		}
	}

	return {
		copyIndex: i * 1000 + j,
		i,
		j,
		pointPairs,
		radiusPairs,
		createdEntityIds,
	};
}

export function addRectangularPatternConstraint(
	sketch: SketchDocument,
	sourceObjectIds: string[],
	line1Id: string | null,
	line2Id: string | null,
	quantity1: number,
	distance1: number,
	direction1: 'one_direction' | 'symmetric',
	quantity2: number,
	distance2: number,
	direction2: 'one_direction' | 'symmetric',
	suppression: boolean,
	suppressedIndices: number[],
	copies: RectangularPatternCopyData[],
	id?: string,
	distance1Expression?: string,
	distance2Expression?: string
): RectangularPatternConstraint | null {
	const line1 = line1Id ? sketch.lines.get(line1Id) : null;
	const line2 = line2Id ? sketch.lines.get(line2Id) : null;

	const cid = id || sketch.nextId('c_rpat');
	const c = new RectangularPatternConstraint(
		cid,
		sourceObjectIds,
		line1Id,
		line1?.p1Id,
		line1?.p2Id,
		line2Id,
		line2?.p1Id,
		line2?.p2Id,
		quantity1,
		distance1,
		direction1,
		quantity2,
		distance2,
		direction2,
		suppression,
		suppressedIndices,
		copies,
		1.0,
		distance1Expression,
		distance2Expression
	);
	sketch.addConstraint(c);
	return c;
}

export function updateRectangularPattern(
	sketch: SketchDocument,
	constraintId: string,
	updates: {
		line1Id?: string | null;
		line2Id?: string | null;
		quantity1?: number;
		distance1?: number;
		distance1Expression?: string;
		direction1?: 'one_direction' | 'symmetric';
		quantity2?: number;
		distance2?: number;
		distance2Expression?: string;
		direction2?: 'one_direction' | 'symmetric';
		suppression?: boolean;
		suppressedIndices?: number[];
	}
): boolean {
	const c = sketch.constraints.get(constraintId);
	if (!c || !(c instanceof RectangularPatternConstraint)) return false;

	sketch.beginTransaction();

	if (updates.distance1Expression !== undefined) {
		c.distance1Expression = updates.distance1Expression;
	}
	if (updates.distance2Expression !== undefined) {
		c.distance2Expression = updates.distance2Expression;
	}

	const newLine1Id = updates.line1Id !== undefined ? updates.line1Id : c.line1Id;
	const newLine2Id = updates.line2Id !== undefined ? updates.line2Id : c.line2Id;
	const newQty1 = updates.quantity1 !== undefined ? Math.max(1, Math.round(updates.quantity1)) : c.quantity1;
	const newDist1 = updates.distance1 !== undefined ? updates.distance1 : c.distance1;
	const newDir1 = updates.direction1 !== undefined ? updates.direction1 : c.direction1;
	const newQty2 = updates.quantity2 !== undefined ? Math.max(1, Math.round(updates.quantity2)) : c.quantity2;
	const newDist2 = updates.distance2 !== undefined ? updates.distance2 : c.distance2;
	const newDir2 = updates.direction2 !== undefined ? updates.direction2 : c.direction2;
	const newSuppression = updates.suppression !== undefined ? updates.suppression : c.suppression;
	const newSuppressed = updates.suppressedIndices !== undefined ? new Set(updates.suppressedIndices) : new Set(c.suppressedIndices);

	const line1 = newLine1Id ? sketch.lines.get(newLine1Id) : null;
	const line2 = newLine2Id ? sketch.lines.get(newLine2Id) : null;

	c.line1Id = newLine1Id;
	c.line1P1Id = line1?.p1Id ?? null;
	c.line1P2Id = line1?.p2Id ?? null;
	c.line2Id = newLine2Id;
	c.line2P1Id = line2?.p1Id ?? null;
	c.line2P2Id = line2?.p2Id ?? null;
	c.quantity1 = newQty1;
	c.distance1 = newDist1;
	c.direction1 = newDir1;
	c.quantity2 = newQty2;
	c.distance2 = newDist2;
	c.direction2 = newDir2;
	c.suppression = newSuppression;
	c.suppressedIndices = Array.from(newSuppressed);

	const paramMap = new Map<string, number>();
	for (const [pid, pt] of sketch.points.entries()) {
		paramMap.set(`${pid}.x`, pt.x);
		paramMap.set(`${pid}.y`, pt.y);
	}
	const { u1, u2 } = computeRectangularPatternDirections(
		paramMap,
		line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
		line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
	);

	const maxI = Math.abs(newDist1) > 1e-6 ? newQty1 : 1;
	const maxJ = Math.abs(newDist2) > 1e-6 ? newQty2 : 1;

	const neededKeys = new Map<number, { i: number; j: number }>();
	for (let i = 0; i < maxI; i++) {
		for (let j = 0; j < maxJ; j++) {
			if (i === 0 && j === 0) continue;
			const key = i * 1000 + j;
			if (newSuppression && newSuppressed.has(key)) continue;
			neededKeys.set(key, { i, j });
		}
	}

	// 1. Remove copies that are no longer needed
	for (let idx = c.copies.length - 1; idx >= 0; idx--) {
		const copy = c.copies[idx];
		if (!neededKeys.has(copy.copyIndex)) {
			deletePatternCopy(sketch, copy);
			c.copies.splice(idx, 1);
		}
	}

	// 2. Add newly needed copies
	for (const [key, coords] of neededKeys.entries()) {
		const existingIndex = c.copies.findIndex(cp => cp.copyIndex === key);
		if (existingIndex < 0) {
			const newCopy = generateRectangularPatternCopy(
				sketch,
				c.sourceObjectIds,
				coords.i,
				coords.j,
				newDist1,
				newDir1,
				newDist2,
				newDir2,
				u1,
				u2
			);
			if (newCopy) {
				c.copies.push(newCopy);
			}
		}
	}

	// 3. Update coordinates of existing copies
	for (const copy of c.copies) {
		const offset = computeRectangularPatternOffset(
			copy.i,
			copy.j,
			newDist1,
			newDir1,
			newDist2,
			newDir2,
			u1,
			u2
		);
		for (const pair of copy.pointPairs) {
			const sPt = sketch.points.get(pair.sourcePtId);
			const pPt = sketch.points.get(pair.patternPtId);
			if (sPt && pPt) {
				pPt.x = sPt.x + offset.dx;
				pPt.y = sPt.y + offset.dy;
			}
		}
	}

	// 4. Update entityIds on BaseConstraint
	const entityIdSet = new Set<string>();
	if (c.line1P1Id) entityIdSet.add(c.line1P1Id);
	if (c.line1P2Id) entityIdSet.add(c.line1P2Id);
	if (c.line2P1Id) entityIdSet.add(c.line2P1Id);
	if (c.line2P2Id) entityIdSet.add(c.line2P2Id);
	for (const copy of c.copies) {
		for (const pair of copy.pointPairs) {
			entityIdSet.add(pair.sourcePtId);
			entityIdSet.add(pair.patternPtId);
		}
		if (copy.radiusPairs) {
			for (const pair of copy.radiusPairs) {
				entityIdSet.add(pair.sourceCircleId);
				entityIdSet.add(pair.patternCircleId);
			}
		}
	}
	(c as any).entityIds = Array.from(entityIdSet);

	sketch.rebuildParamManager();
	sketch.solve();
	sketch.commitTransaction();
	return true;
}

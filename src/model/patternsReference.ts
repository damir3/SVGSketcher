import { polygonVertices } from '../math/construction';
import type { SketchDocument } from './sketch';
import { deselectEntity } from './selection';
import type { SketchLine, SketchPoint } from './types';
import { Vec2 } from '../math/vector';
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
	type DistanceConstraint,
	type PointToLineDistanceConstraint,
} from '../solver/constraints';

function buildPatternCopyEntities(
	sketch: SketchDocument,
	sourceObjectIds: string[],
	transformPoint: (origPtId: string, pt: SketchPoint) => Vec2 | string
): {
	pointPairs: PatternPointPair[];
	radiusPairs: PatternRadiusPair[];
	createdEntityIds: PatternCopyData['createdEntityIds'];
} {
	const pointMap = new Map<string, string>();
	const pointPairs: PatternPointPair[] = [];
	const radiusPairs: PatternRadiusPair[] = [];
	const createdEntityIds: PatternCopyData['createdEntityIds'] = [];

	const mapPoint = (origPtId: string): string => {
		if (pointMap.has(origPtId)) return pointMap.get(origPtId)!;
		const pt = sketch.points.get(origPtId);
		if (!pt) return origPtId;

		const mapped = transformPoint(origPtId, pt);
		if (typeof mapped === 'string') {
			pointMap.set(origPtId, mapped);
			return mapped;
		}

		const newPt = sketch.addPoint(mapped, false);
		pointMap.set(origPtId, newPt.id);
		pointPairs.push({ sourcePtId: origPtId, patternPtId: newPt.id });
		createdEntityIds.push({ id: newPt.id, type: 'point' });
		return newPt.id;
	};

	for (const objId of sourceObjectIds) {
		const line = sketch.lines.get(objId);
		if (line) {
			const np1Id = mapPoint(line.p1Id);
			const np2Id = mapPoint(line.p2Id);
			if (np1Id !== np2Id) {
				const newLine = sketch.addLine(np1Id, np2Id, line.isSplineHandle ? 'construction' : line.lineType);
				createdEntityIds.push({ id: newLine.id, type: 'line' });
			}
			continue;
		}

		const circle = sketch.circles.get(objId);
		if (circle) {
			const newCircle = sketch.addCircle(mapPoint(circle.centerId), circle.radius, circle.lineType);
			radiusPairs.push({ sourceCircleId: circle.id, patternCircleId: newCircle.id });
			createdEntityIds.push({ id: newCircle.id, type: 'circle' });
			continue;
		}

		const arc = sketch.arcs.get(objId);
		if (arc) {
			const newArc = sketch.addArc(
				mapPoint(arc.centerId),
				mapPoint(arc.startPointId),
				mapPoint(arc.endPointId),
				arc.radius,
				arc.clockwise,
				arc.lineType
			);
			radiusPairs.push({ sourceCircleId: arc.id, patternCircleId: newArc.id });
			createdEntityIds.push({ id: newArc.id, type: 'arc' });
			continue;
		}

		const ellipse = sketch.ellipses.get(objId);
		if (ellipse) {
			const newEllipse = sketch.addEllipse(
				mapPoint(ellipse.centerId),
				mapPoint(ellipse.majorAxisPointId),
				mapPoint(ellipse.minorAxisPointId),
				ellipse.isConstruction
			);
			createdEntityIds.push({ id: newEllipse.id, type: 'ellipse' });
			continue;
		}

		const elArc = sketch.ellipticalArcs.get(objId);
		if (elArc) {
			const newElArc = sketch.addEllipticalArc(
				mapPoint(elArc.centerId),
				mapPoint(elArc.majorAxisPointId),
				mapPoint(elArc.minorAxisPointId),
				mapPoint(elArc.startPointId),
				mapPoint(elArc.endPointId),
				elArc.clockwise,
				elArc.isConstruction
			);
			createdEntityIds.push({ id: newElArc.id, type: 'elliptical_arc' });
			continue;
		}

		const sourceSpline = sketch.splines.get(objId);
		if (sourceSpline) {
			const spline = sketch.copySpline(sourceSpline, mapPoint);
			createdEntityIds.push({ id: spline.id, type: 'spline' });
			for (const id of new Set(spline.tangentLineIds)) {
				if (id) createdEntityIds.push({ id, type: 'line' });
			}
			continue;
		}

		if (sketch.points.get(objId)) {
			mapPoint(objId);
		}
	}

	return { pointPairs, radiusPairs, createdEntityIds };
}

export function generateCircularPatternCopy(
	sketch: SketchDocument,
	centerPtId: string,
	sourceObjectIds: string[],
	copyIndex: number,
	quantity: number,
	distribution: 'full' | 'partial' | 'symmetric',
	totalAngle: number
): PatternCopyData | null {
	const centerPt = sketch.points.get(centerPtId);
	if (!centerPt) return null;

	const angleDeg = computePatternCopyAngle(copyIndex, quantity, distribution, totalAngle);
	const rad = (angleDeg * Math.PI) / 180;
	const splinePointIds = new Set(
		sourceObjectIds.filter(id => sketch.splines.has(id)).flatMap(id => sketch.getPrimitivePointIds(id))
	);

	const data = buildPatternCopyEntities(sketch, sourceObjectIds, (origPtId, pt) => {
		if (origPtId === centerPtId || (centerPt.distanceTo(pt) < 1e-3 && !splinePointIds.has(origPtId))) {
			return centerPtId;
		}
		return pt.clone().rotateAround(centerPt, rad);
	});

	return { copyIndex, ...data };
}

export function deletePatternCopy(sketch: SketchDocument, copy: PatternCopyData): boolean {
	for (const item of copy.createdEntityIds) {
		sketch.getPrimitiveMap(item.type)?.delete(item.id);
		deselectEntity(sketch, item.id, item.type, false);
	}
	const hasSpline = copy.createdEntityIds.some(item => item.type === 'spline');
	if (hasSpline) {
		const removedIds = new Set(copy.createdEntityIds.map(item => item.id));
		for (const c of sketch.constraints.values()) {
			if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) continue;
			if (c.entityIds.some(id => removedIds.has(id))) {
				sketch.constraints.delete(c.id);
				sketch.selection.constraintIds.delete(c.id);
			}
		}
		sketch.cleanOrphanTexts();
	}
	return hasSpline;
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
	if (!sketch.points.get(centerPtId)) return null;

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
	let removedSplineCopy = false;

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

	// 1-2. Prune unneeded/suppressed copies and add new ones
	const neededKeys = new Set<number>();
	for (let k = 1; k < newQty; k++) {
		if (!newSuppression || !newSuppressed.has(k)) neededKeys.add(k);
	}
	removedSplineCopy = syncPatternCopies(sketch, c.copies, neededKeys, k =>
		generateCircularPatternCopy(sketch, c.centerPtId, c.sourceObjectIds, k, newQty, newDist, newAngle)
	);

	// 3. Update coordinates of existing copies to new angle/distribution positions
	const centerPt = sketch.points.get(c.centerPtId);
	if (centerPt) {
		updateCopyPointPositions(sketch, c.copies, (copy, sPt) => {
			const rad = (computePatternCopyAngle(copy.copyIndex, newQty, newDist, newAngle) * Math.PI) / 180;
			return sPt.clone().rotateAround(centerPt, rad);
		});
	}

	// 4. Update pointIds on BaseConstraint
	return finalizePatternUpdate(sketch, c, [c.centerPtId], false, removedSplineCopy);
}

function syncPatternCopies<T extends PatternCopyData>(
	sketch: SketchDocument,
	copies: T[],
	neededKeys: Iterable<number>,
	createCopy: (copyIndex: number) => T | null
): boolean {
	const needed = new Set(neededKeys);
	let removedSplineCopy = false;
	for (let i = copies.length - 1; i >= 0; i--) {
		if (!needed.has(copies[i].copyIndex)) {
			removedSplineCopy = deletePatternCopy(sketch, copies[i]) || removedSplineCopy;
			copies.splice(i, 1);
		}
	}
	for (const key of needed) {
		if (copies.some(cp => cp.copyIndex === key)) continue;
		const newCopy = createCopy(key);
		if (newCopy) copies.push(newCopy);
	}
	return removedSplineCopy;
}

function updateCopyPointPositions<T extends PatternCopyData>(
	sketch: SketchDocument,
	copies: T[],
	mapPoint: (copy: T, sourcePt: SketchPoint) => Vec2
): void {
	for (const copy of copies) {
		for (const pair of copy.pointPairs) {
			const sPt = sketch.points.get(pair.sourcePtId);
			const pPt = sketch.points.get(pair.patternPtId);
			if (sPt && pPt) pPt.copy(mapPoint(copy, sPt));
		}
	}
}

function finalizePatternUpdate(
	sketch: SketchDocument,
	c: CircularPatternConstraint | RectangularPatternConstraint,
	seedEntityIds: Array<string | null | undefined>,
	includeRadiusPairs: boolean,
	removedSplineCopy: boolean
): boolean {
	const entityIdSet = new Set<string>();
	for (const id of seedEntityIds) {
		if (id) entityIdSet.add(id);
	}
	for (const copy of c.copies) {
		for (const pair of copy.pointPairs) {
			entityIdSet.add(pair.sourcePtId);
			entityIdSet.add(pair.patternPtId);
		}
		if (includeRadiusPairs && copy.radiusPairs) {
			for (const pair of copy.radiusPairs) {
				entityIdSet.add(pair.sourceCircleId);
				entityIdSet.add(pair.patternCircleId);
			}
		}
	}
	(c as any).entityIds = Array.from(entityIdSet);

	if (removedSplineCopy) sketch.cleanOrphanConstraints();
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
	const data = buildPatternCopyEntities(sketch, sourceObjectIds, (_origPtId, pt) => pt.clone().add(offset));
	return {
		copyIndex: i * 1000 + j,
		i,
		j,
		...data,
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
	let removedSplineCopy = false;

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
	const newSuppressed =
		updates.suppressedIndices !== undefined ? new Set(updates.suppressedIndices) : new Set(c.suppressedIndices);

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

	// 1-2. Sync pattern copies
	removedSplineCopy = syncPatternCopies(sketch, c.copies, neededKeys.keys(), key => {
		const { i, j } = neededKeys.get(key)!;
		return generateRectangularPatternCopy(
			sketch,
			c.sourceObjectIds,
			i,
			j,
			newDist1,
			newDir1,
			newDist2,
			newDir2,
			u1,
			u2
		);
	});

	// 3. Update coordinates of existing copies
	updateCopyPointPositions(sketch, c.copies, (copy, sPt) =>
		sPt.clone().add(computeRectangularPatternOffset(copy.i, copy.j, newDist1, newDir1, newDist2, newDir2, u1, u2))
	);

	// 4. Update entityIds on BaseConstraint
	return finalizePatternUpdate(
		sketch,
		c,
		[c.line1P1Id, c.line1P2Id, c.line2P1Id, c.line2P2Id],
		true,
		removedSplineCopy
	);
}

export function addPolygon(
	sketch: SketchDocument,
	centerPointId: string,
	radius: number,
	sides: number,
	angleRad: number,
	isConstruction = false,
	addDistanceConstraint = false,
	options: { radiusToVertex?: boolean; vertexIds?: readonly string[]; radiusExpression?: string } = {}
): {
	centerPoint: SketchPoint;
	vertices: SketchPoint[];
	lines: SketchLine[];
	constraint: CircularPatternConstraint;
	distanceConstraint?: PointToLineDistanceConstraint;
	vertexDistanceConstraint?: DistanceConstraint;
} | null {
	const centerPt = sketch.points.get(centerPointId);
	if (!centerPt) return null;

	const N = Math.max(3, Math.round(sides));
	if (!Number.isFinite(radius) || radius <= 1e-4) return null;
	const existingVertices = (options.vertexIds ?? []).map(id => sketch.points.get(id));
	if (existingVertices.some(point => !point)) return null;

	sketch.beginTransaction();

	const vertices: SketchPoint[] = polygonVertices(centerPt, radius, N, angleRad, !!options.radiusToVertex).map(
		(v, k) => existingVertices[k] ?? sketch.addPoint(v, false)
	);

	const lines: SketchLine[] = [];
	for (let k = 0; k < N; k++) {
		const nextK = (k + 1) % N;
		const p1Id = vertices[k].id;
		const p2Id = vertices[nextK].id;
		const existingEdge =
			k === 0 && existingVertices.length === 2
				? [...sketch.lines.values()].find(
						line =>
							line.lineType === (isConstruction ? 'construction' : 'solid') &&
							((line.p1Id === p1Id && line.p2Id === p2Id) || (line.p1Id === p2Id && line.p2Id === p1Id))
					)
				: undefined;
		lines.push(existingEdge ?? sketch.addLine(p1Id, p2Id, isConstruction ? 'construction' : 'solid'));
	}

	const copies: PatternCopyData[] = [];
	for (let k = 1; k < N; k++) {
		copies.push({
			copyIndex: k,
			pointPairs: [{ sourcePtId: vertices[0].id, patternPtId: vertices[k].id }],
			createdEntityIds: existingVertices[k] ? [] : [{ id: vertices[k].id, type: 'point' }],
		});
	}

	const constraint = addCircularPatternConstraint(
		sketch,
		centerPointId,
		[vertices[0].id],
		'full',
		360,
		N,
		false,
		[],
		copies,
		undefined,
		true // isReadOnly
	);

	let distanceConstraint: PointToLineDistanceConstraint | undefined;
	let vertexDistanceConstraint: DistanceConstraint | undefined;
	if (addDistanceConstraint) {
		if (options.radiusToVertex) {
			vertexDistanceConstraint = sketch.addDistanceConstraint(centerPointId, vertices[0].id, radius) ?? undefined;
		} else {
			distanceConstraint = sketch.addPointToLineDistanceConstraint(centerPointId, lines[0].id, radius) ?? undefined;
		}
		const radiusConstraint = vertexDistanceConstraint ?? distanceConstraint;
		if (radiusConstraint && options.radiusExpression) radiusConstraint.expression = options.radiusExpression;
	}

	sketch.commitTransaction();
	sketch.solve();

	if (!constraint) return null;

	return {
		centerPoint: centerPt,
		vertices,
		lines,
		constraint,
		distanceConstraint,
		vertexDistanceConstraint,
	};
}

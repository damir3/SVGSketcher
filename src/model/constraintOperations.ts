import type { SketchDocument } from './sketch';
import { matchesEndpoints } from './constraintLinks';
import type { IConstraint } from '../solver/types';
import {
	FixedConstraint,
	CoincidentConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	EqualLengthConstraint,
	EqualRadiusConstraint,
	ParallelConstraint,
	CollinearConstraint,
	PerpendicularConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	PointOnEllipseConstraint,
	PointOnSplineConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
	OffsetConstraint,
} from '../solver/constraints';
import { SketchEllipticalArc, type SketchArc, type SketchCircle, type SketchLine } from './types';
import { Vec2 } from '../math/vector';

export function getRadial(sketch: SketchDocument, id: string): SketchCircle | SketchArc | undefined {
	return sketch.circles.get(id) ?? sketch.arcs.get(id);
}

export function isBuiltInLineId(sketch: SketchDocument, id?: string): boolean {
	return Boolean(id && !sketch.lines.has(id) && sketch.getLine(id));
}

export function findConstraint<T extends IConstraint>(
	sketch: SketchDocument,
	Ctor: abstract new (...args: never[]) => T,
	predicate: (constraint: T) => boolean
): T | undefined {
	for (const c of sketch.constraints.values()) {
		if (c instanceof Ctor && predicate(c)) return c;
	}
	return undefined;
}

export function addUniqueConstraint<T extends IConstraint>(
	sketch: SketchDocument,
	Ctor: abstract new (...args: never[]) => T,
	predicate: (constraint: T) => boolean,
	create: () => T,
	onExisting: 'return' | 'null' = 'return'
): T | null {
	const existing = findConstraint(sketch, Ctor, predicate);
	if (existing) return onExisting === 'return' ? existing : null;
	const c = create();
	return addConstraint(sketch, c) ? c : null;
}

function addOrientationConstraint<T extends HorizontalConstraint | VerticalConstraint>(
	sketch: SketchDocument,
	Ctor: new (id: string, p1Id: string, p2Id: string) => T,
	prefix: string,
	p1Id: string,
	p2Id: string
): T | null {
	return addUniqueConstraint(
		sketch,
		Ctor,
		c => matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id),
		() => new Ctor(sketch.nextId(prefix), p1Id, p2Id)
	);
}

function matchesLinePair(a1: string, a2: string, b1: string, b2: string, l1: SketchLine, l2: SketchLine): boolean {
	return (
		(matchesEndpoints(a1, a2, l1.p1Id, l1.p2Id) && matchesEndpoints(b1, b2, l2.p1Id, l2.p2Id)) ||
		(matchesEndpoints(a1, a2, l2.p1Id, l2.p2Id) && matchesEndpoints(b1, b2, l1.p1Id, l1.p2Id))
	);
}

function addTwoLineConstraint<T extends IConstraint>(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	Ctor: new (id: string, p1: string, p2: string, p3: string, p4: string) => T,
	prefix: string,
	endpointsOf: (c: T) => [string, string, string, string]
): T | null {
	const l1 = sketch.lines.get(line1Id);
	const l2 = sketch.lines.get(line2Id);
	if (!l1 || !l2) return null;

	return addUniqueConstraint(
		sketch,
		Ctor,
		c => matchesLinePair(...endpointsOf(c), l1, l2),
		() => new Ctor(sketch.nextId(prefix), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id)
	);
}

function partitionThreePointsByMiddle(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	p3Id: string
): { midId: string; end1Id: string; end2Id: string } | null {
	if (p1Id === p2Id || p2Id === p3Id || p1Id === p3Id) return null;
	const p1 = sketch.points.get(p1Id);
	const p2 = sketch.points.get(p2Id);
	const p3 = sketch.points.get(p3Id);
	if (!p1 || !p2 || !p3) return null;

	const d1 = Math.hypot(p1.x - 0.5 * (p2.x + p3.x), p1.y - 0.5 * (p2.y + p3.y));
	const d2 = Math.hypot(p2.x - 0.5 * (p1.x + p3.x), p2.y - 0.5 * (p1.y + p3.y));
	const d3 = Math.hypot(p3.x - 0.5 * (p1.x + p2.x), p3.y - 0.5 * (p1.y + p2.y));

	if (d1 <= d2 && d1 <= d3) {
		return { midId: p1Id, end1Id: p2Id, end2Id: p3Id };
	}
	if (d2 <= d1 && d2 <= d3) {
		return { midId: p2Id, end1Id: p1Id, end2Id: p3Id };
	}
	return { midId: p3Id, end1Id: p1Id, end2Id: p2Id };
}

/**
 * Returns on which side (+1 / -1) of the directed line p1->p2 the given center
 * currently lies, using the same sign convention as TangentLineCircleConstraint.
 * This keeps the circle on its current side when the tangent constraint is applied.
 */
function getTangentSide(sketch: SketchDocument, line: SketchLine, centerId: string): number {
	const p1 = sketch.points.get(line.p1Id);
	const p2 = sketch.points.get(line.p2Id);
	const center = sketch.points.get(centerId);
	if (!p1 || !p2 || !center) return 1;
	const dir = new Vec2().subVectors(p2, p1);
	return new Vec2().subVectors(center, p1).cross(dir) >= 0 ? 1 : -1;
}

function hasConstraintEntity(sketch: SketchDocument, id: string): boolean {
	return !!sketch.points.get(id) || !!sketch.getLine(id) || sketch.hasOwnPrimitive(id);
}

export function addConstraint(sketch: SketchDocument, constraint: IConstraint): boolean {
	return sketch.solverCoordinator.addConstraint(constraint);
}

export function getConstraintCreatedGeometryIds(sketch: SketchDocument, constraintId: string): string[] {
	const c = sketch.constraints.get(constraintId);
	if (!c) return [];

	if (c instanceof OffsetConstraint) {
		const ids: string[] = [];
		const seen = new Set<string>();
		for (const pair of c.pairs) {
			const offId = pair.kind === 'line' ? pair.offLineId : pair.kind === 'circle' ? pair.offId : pair.offSplineId;
			if (!seen.has(offId) && sketch.hasOwnPrimitive(offId)) {
				seen.add(offId);
				ids.push(offId);
			}
		}
		return ids;
	}

	if ((c instanceof CircularPatternConstraint && !c.isReadOnly) || c instanceof RectangularPatternConstraint) {
		const curveIds: string[] = [];
		const seenCurves = new Set<string>();
		const createdPointIds: string[] = [];
		const seenPoints = new Set<string>();

		for (const copy of c.copies) {
			for (const item of copy.createdEntityIds) {
				if (item.type === 'point') {
					if (!seenPoints.has(item.id) && sketch.points.has(item.id) && !sketch.isSplineHandlePoint(item.id)) {
						seenPoints.add(item.id);
						createdPointIds.push(item.id);
					}
					continue;
				}
				if (item.type === 'line' && sketch.isSplineHandleLine(item.id)) continue;
				if (!seenCurves.has(item.id) && sketch.hasOwnPrimitive(item.id, item.type)) {
					seenCurves.add(item.id);
					curveIds.push(item.id);
				}
			}
		}

		// Points that belong to created curves will be cleaned up when those curves are deleted;
		// only include standalone created points directly so user-drawn curves attached to a vertex aren't unexpectedly removed.
		const curvePointIds = new Set<string>();
		for (const curveId of curveIds) {
			for (const ptId of sketch.getPrimitivePointIds(curveId)) curvePointIds.add(ptId);
		}
		const standalonePointIds = createdPointIds.filter(ptId => !curvePointIds.has(ptId));
		return [...curveIds, ...standalonePointIds];
	}

	if (c instanceof SymmetryConstraint && c.isMirrorCopy) {
		if (sketch.points.has(c.p2Id) && !sketch.isSplineHandlePoint(c.p2Id)) {
			return [c.p2Id];
		}
		return [];
	}

	return [];
}

function isPointCoveredByExcludedCurves(
	sketch: SketchDocument,
	pointId: string,
	excludedEntityIds: ReadonlySet<string>
): boolean {
	if (excludedEntityIds.has(pointId)) return true;
	let referencingCurveCount = 0;
	for (const col of sketch.getPrimitiveCollections()) {
		if (!col.isCurve) continue;
		for (const [primId, prim] of col.map.entries()) {
			if (prim.getPointIds(sketch).includes(pointId)) {
				referencingCurveCount++;
				if (!excludedEntityIds.has(primId)) return false;
			}
		}
	}
	return referencingCurveCount > 0;
}

export function getCreatedGeometryConstraintsForIds(
	sketch: SketchDocument,
	constraintIds: Iterable<string>,
	excludedEntityIds?: ReadonlySet<string>
): IConstraint[] {
	const result: IConstraint[] = [];
	const seen = new Set<string>();
	for (const id of constraintIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const c = sketch.constraints.get(id);
		if (!c) continue;
		if (
			c.isInternalConstraint?.(sketch) ||
			sketch.isSplineInternalConstraint(c) ||
			c.type === 'arc_endpoints' ||
			c.type === 'elliptical_arc_endpoints'
		) {
			continue;
		}
		const createdIds = getConstraintCreatedGeometryIds(sketch, id);
		if (createdIds.length === 0) continue;
		if (excludedEntityIds && excludedEntityIds.size > 0) {
			const hasUncovered = createdIds.some(entityId =>
				c instanceof SymmetryConstraint && c.isMirrorCopy
					? !isPointCoveredByExcludedCurves(sketch, entityId, excludedEntityIds)
					: !excludedEntityIds.has(entityId)
			);
			if (!hasUncovered) continue;
		}
		result.push(c);
	}
	return result;
}

export function removeConstraint(
	sketch: SketchDocument,
	id: string,
	options?: { deleteCreatedGeometry?: boolean }
): void {
	const c = sketch.constraints.get(id);
	if (!c) return;
	if (
		c.isInternalConstraint?.(sketch) ||
		sketch.isSplineInternalConstraint(c) ||
		c.type === 'arc_endpoints' ||
		c.type === 'elliptical_arc_endpoints'
	) {
		return;
	}
	if (options?.deleteCreatedGeometry) {
		const createdIds = getConstraintCreatedGeometryIds(sketch, id);
		if (createdIds.length > 0) {
			sketch.beginTransaction();
			if (c instanceof OffsetConstraint) {
				for (const jId of c.junctionConstraintIds ?? []) {
					sketch.constraints.delete(jId);
					sketch.selection.constraintIds.delete(jId);
				}
			}
			sketch.constraints.delete(id);
			sketch.selection.constraintIds.delete(id);
			for (const entityId of createdIds) {
				if (sketch.hasOwnPrimitive(entityId)) {
					sketch.removeEntity(entityId);
				}
			}
			sketch.cleanOrphanConstraints();
			sketch.cleanOrphanTexts();
			sketch.rebuildParamManager();
			sketch.solve();
			sketch.commitTransaction();
			return;
		}
	}
	sketch.pushHistory();
	if (c instanceof FixedConstraint) {
		const pt = sketch.points.get(c.pointId);
		if (pt) pt.fixed = false;
		sketch.rebuildParamManager();
	}
	sketch.constraints.delete(id);
	sketch.selection.constraintIds.delete(id);
	sketch.solve();
}

export function addFixedConstraint(sketch: SketchDocument, pointId: string): FixedConstraint | null {
	const pt = sketch.points.get(pointId);
	if (!pt) return null;
	const existing = findConstraint(sketch, FixedConstraint, c => c.pointId === pointId);
	if (existing) {
		pt.fixed = true;
		return existing;
	}
	sketch.pushHistory();
	pt.fixed = true;
	const c = new FixedConstraint(sketch.nextId('c_fix'), pointId, pt.x, pt.y);
	sketch.constraints.set(c.id, c);
	sketch.rebuildParamManager();
	sketch.solve();
	return c;
}

export function removeFixedConstraint(sketch: SketchDocument, pointId: string): boolean {
	const pt = sketch.points.get(pointId);
	const hasFix = !!findConstraint(sketch, FixedConstraint, c => c.pointId === pointId);
	if (!hasFix && (!pt || !pt.fixed)) {
		return false;
	}

	sketch.pushHistory();
	for (const [id, c] of [...sketch.constraints.entries()]) {
		if (c instanceof FixedConstraint && c.pointId === pointId) {
			sketch.constraints.delete(id);
			sketch.selection.constraintIds.delete(id);
		}
	}
	if (pt) {
		pt.fixed = false;
	}
	sketch.rebuildParamManager();
	sketch.solve();
	return true;
}

export function toggleFixedConstraint(sketch: SketchDocument, pointId: string): boolean {
	if (sketch.isPointFixed(pointId)) {
		removeFixedConstraint(sketch, pointId);
		return false;
	}
	addFixedConstraint(sketch, pointId);
	return true;
}

export function toggleFixedConstraints(sketch: SketchDocument, pointIds: string[]): boolean {
	const validPointIds = pointIds.filter(pid => sketch.points.has(pid));
	if (validPointIds.length === 0) return false;

	sketch.beginTransaction();
	const allFixed = validPointIds.every(pid => sketch.isPointFixed(pid));
	if (allFixed) {
		for (const pid of validPointIds) {
			removeFixedConstraint(sketch, pid);
		}
	} else {
		for (const pid of validPointIds) {
			if (!sketch.isPointFixed(pid)) {
				addFixedConstraint(sketch, pid);
			}
		}
	}
	sketch.commitTransaction();
	return !allFixed;
}

function areOffsetCircleCenters(sketch: SketchDocument, p1Id: string, p2Id: string): boolean {
	for (const constraint of sketch.constraints.values()) {
		if (!(constraint instanceof OffsetConstraint) || constraint.isReference) continue;
		for (const pair of constraint.pairs) {
			if (pair.kind === 'circle' && matchesEndpoints(pair.origCenterId, pair.offCenterId, p1Id, p2Id)) {
				return true;
			}
		}
	}
	return false;
}

export function addCoincidentConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string
): CoincidentConstraint | null {
	if (p1Id === p2Id || !sketch.points.has(p1Id) || !sketch.points.has(p2Id)) return null;
	// Do not constrain endpoints of the same line segment (would collapse length to 0)
	if (sketch.getLineBetween(p1Id, p2Id)) return null;
	// Offset circle/arc pairs already share a center via OffsetConstraint.
	if (areOffsetCircleCenters(sketch, p1Id, p2Id)) return null;
	return addUniqueConstraint(
		sketch,
		CoincidentConstraint,
		c => matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id),
		() => new CoincidentConstraint(sketch.nextId('c_coinc'), p1Id, p2Id),
		'null'
	);
}

export function addCoincidentConstraints(sketch: SketchDocument, pointIds: Iterable<string>): boolean {
	const ids = new Set(pointIds);
	const hasOrigin = ids.delete('origin');
	const [anchor, ...others] = ids;
	if (!anchor || (!hasOrigin && others.length === 0)) return false;
	if ([...ids].some(id => !sketch.points.has(id))) return false;

	// Coincidence is transitive, so any selected segment endpoints would collapse the segment.
	if ([...sketch.lines.values()].some(line => ids.has(line.p1Id) && ids.has(line.p2Id))) return false;

	sketch.beginTransaction();
	if (hasOrigin) {
		for (const id of ids) addOriginCoincidentConstraint(sketch, id);
	} else {
		for (const id of others) addCoincidentConstraint(sketch, anchor, id);
	}
	sketch.commitTransaction();
	return true;
}

export function addOriginCoincidentConstraint(sketch: SketchDocument, pointId: string): CoincidentConstraint | null {
	if (!sketch.points.get(pointId) || pointId === 'origin') return null;
	return addUniqueConstraint(
		sketch,
		CoincidentConstraint,
		c => matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId),
		() => new CoincidentConstraint(sketch.nextId('c_coinc'), 'origin', pointId)
	);
}

export function addHorizontalConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string
): HorizontalConstraint | null {
	return addOrientationConstraint(sketch, HorizontalConstraint, 'c_horiz', p1Id, p2Id);
}

export function addVerticalConstraint(sketch: SketchDocument, p1Id: string, p2Id: string): VerticalConstraint | null {
	return addOrientationConstraint(sketch, VerticalConstraint, 'c_vert', p1Id, p2Id);
}

export function addEqualLengthConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string
): EqualLengthConstraint | null {
	return addTwoLineConstraint(sketch, line1Id, line2Id, EqualLengthConstraint, 'c_eqlen', c => [
		c.line1P1,
		c.line1P2,
		c.line2P1,
		c.line2P2,
	]);
}

export function addEqualRadiusConstraint(
	sketch: SketchDocument,
	circle1Id: string,
	circle2Id: string
): EqualRadiusConstraint | null {
	return addUniqueConstraint(
		sketch,
		EqualRadiusConstraint,
		c => matchesEndpoints(c.circle1Id, c.circle2Id, circle1Id, circle2Id),
		() => new EqualRadiusConstraint(sketch.nextId('c_eqrad'), circle1Id, circle2Id)
	);
}

export function addParallelConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string
): ParallelConstraint | null {
	return addTwoLineConstraint(sketch, line1Id, line2Id, ParallelConstraint, 'c_par', c => [
		c.l1P1,
		c.l1P2,
		c.l2P1,
		c.l2P2,
	]);
}

export function addPerpendicularConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string
): PerpendicularConstraint | null {
	return addTwoLineConstraint(sketch, line1Id, line2Id, PerpendicularConstraint, 'c_perp', c => [
		c.l1P1,
		c.l1P2,
		c.l2P1,
		c.l2P2,
	]);
}

export function addLineCollinearWithAxisConstraint(
	sketch: SketchDocument,
	lineId: string,
	axis: 'x' | 'y'
): CollinearConstraint | null {
	const line = sketch.lines.get(lineId);
	if (!line) return null;
	return addUniqueConstraint(
		sketch,
		CollinearConstraint,
		c => c.l1P1 === 'origin' && c.l1P2 === `axis_${axis}` && matchesEndpoints(c.l2P1, c.l2P2, line.p1Id, line.p2Id),
		() => new CollinearConstraint(sketch.nextId('c_collin'), 'origin', `axis_${axis}`, line.p1Id, line.p2Id)
	);
}

export function addThreePointCollinearConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	p3Id: string
): CollinearConstraint | null {
	const part = partitionThreePointsByMiddle(sketch, p1Id, p2Id, p3Id);
	if (!part) return null;
	const { midId, end1Id, end2Id } = part;
	const targetSet = new Set([p1Id, p2Id, p3Id]);
	return addUniqueConstraint(
		sketch,
		CollinearConstraint,
		c => {
			if (!c.isThreePoint()) return false;
			const cSet = new Set([c.l1P1, c.l1P2, c.l2P1, c.l2P2]);
			return cSet.size === 3 && [...targetSet].every(id => cSet.has(id));
		},
		() => new CollinearConstraint(sketch.nextId('c_collin'), end1Id, midId, midId, end2Id)
	);
}

export function addCollinearConstraint(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	p3Id?: string
): CollinearConstraint | null {
	if (p3Id !== undefined) {
		return addThreePointCollinearConstraint(sketch, line1Id, line2Id, p3Id);
	}
	if (line1Id === line2Id) return null;
	const isAxis1 = line1Id === 'axis_x' || line1Id === 'axis_y';
	const isAxis2 = line2Id === 'axis_x' || line2Id === 'axis_y';
	if (isAxis1 && isAxis2) return null;
	if (isAxis1 || isAxis2) {
		const axis = isAxis1 ? (line1Id === 'axis_x' ? 'x' : 'y') : line2Id === 'axis_x' ? 'x' : 'y';
		const userLineId = isAxis1 ? line2Id : line1Id;
		return addLineCollinearWithAxisConstraint(sketch, userLineId, axis);
	}

	return addTwoLineConstraint(sketch, line1Id, line2Id, CollinearConstraint, 'c_collin', c => [
		c.l1P1,
		c.l1P2,
		c.l2P1,
		c.l2P2,
	]);
}

export function addSymmetryConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	lineId: string,
	isMirrorCopy?: boolean
): SymmetryConstraint | null {
	if (p1Id === p2Id) return null;
	if (!sketch.points.get(p1Id) || !sketch.points.get(p2Id)) return null;

	const isOriginAxis = lineId === 'origin';
	const isBuiltIn = isOriginAxis || isBuiltInLineId(sketch, lineId);
	if (isBuiltIn && (p1Id === 'origin' || p2Id === 'origin')) {
		return null;
	}
	const line = isOriginAxis ? null : sketch.getLine(lineId);
	if (!isOriginAxis && !line) return null;
	if (line && (p1Id === line.p1Id || p1Id === line.p2Id || p2Id === line.p1Id || p2Id === line.p2Id)) {
		// If one of the points is an endpoint of the symmetry line itself, cannot be symmetric to a distinct point
		if (p1Id === line.p1Id && p2Id === line.p2Id) return null;
		if (p1Id === line.p2Id && p2Id === line.p1Id) return null;
	}

	return addUniqueConstraint(
		sketch,
		SymmetryConstraint,
		c =>
			matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id) &&
			(isOriginAxis
				? c.lineId === 'origin'
				: c.lineId === line!.id || matchesEndpoints(c.lineP1Id, c.lineP2Id, line!.p1Id, line!.p2Id)),
		() =>
			new SymmetryConstraint(
				sketch.nextId('c_symm'),
				p1Id,
				p2Id,
				line ? line.p1Id : '',
				line ? line.p2Id : '',
				1.0,
				isOriginAxis ? 'origin' : line!.id,
				isMirrorCopy
			)
	);
}

export function addLineSymmetryConstraints(
	sketch: SketchDocument,
	line1Id: string,
	line2Id: string,
	axisId: string
): IConstraint[] {
	if (line1Id === line2Id || line1Id === axisId || line2Id === axisId) return [];
	const l1 = sketch.lines.get(line1Id);
	const l2 = sketch.lines.get(line2Id);
	if (!l1 || !l2) return [];

	const p11 = sketch.points.get(l1.p1Id);
	const p12 = sketch.points.get(l1.p2Id);
	const p21 = sketch.points.get(l2.p1Id);
	const p22 = sketch.points.get(l2.p2Id);
	if (!p11 || !p12 || !p21 || !p22) return [];

	const reflectAcrossAxis = (p: Vec2): Vec2 => {
		if (axisId === 'origin') {
			return p.clone().multiplyScalar(-1);
		}
		const axisLine = sketch.getLine(axisId);
		if (axisLine) {
			const a = sketch.points.get(axisLine.p1Id);
			const b = sketch.points.get(axisLine.p2Id);
			if (a && b) {
				const dir = new Vec2().subVectors(b, a);
				const lenSq = dir.lengthSq();
				if (lenSq > 1e-12) {
					const len = Math.sqrt(lenSq);
					const normal = dir.clone().perpendicular().divideScalar(len);
					return p.clone().reflectAcrossLine(a, normal);
				}
			}
		}
		return p;
	};

	let swap = false;
	if (l1.p1Id === l2.p2Id || l1.p2Id === l2.p1Id) {
		swap = true;
	} else if (l1.p1Id === l2.p1Id || l1.p2Id === l2.p2Id) {
		swap = false;
	} else {
		const r1 = reflectAcrossAxis(p11);
		const r2 = reflectAcrossAxis(p12);
		const costDirect = (r1.x - p21.x) ** 2 + (r1.y - p21.y) ** 2 + (r2.x - p22.x) ** 2 + (r2.y - p22.y) ** 2;
		const costSwapped = (r1.x - p22.x) ** 2 + (r1.y - p22.y) ** 2 + (r2.x - p21.x) ** 2 + (r2.y - p21.y) ** 2;
		swap = costSwapped < costDirect;
	}

	const pairs: [string, string][] = swap
		? [
				[l1.p1Id, l2.p2Id],
				[l1.p2Id, l2.p1Id],
			]
		: [
				[l1.p1Id, l2.p1Id],
				[l1.p2Id, l2.p2Id],
			];

	const created: IConstraint[] = [];
	sketch.beginTransaction();
	for (const [paId, pbId] of pairs) {
		if (paId === pbId) {
			let c: IConstraint | null = null;
			if (axisId === 'axis_x') {
				c = addPointOnAxisConstraint(sketch, paId, 'x');
			} else if (axisId === 'axis_y') {
				c = addPointOnAxisConstraint(sketch, paId, 'y');
			} else if (axisId === 'origin') {
				c = addOriginCoincidentConstraint(sketch, paId);
			} else {
				c = addPointOnLineConstraint(sketch, paId, axisId);
			}
			if (c) created.push(c);
		} else {
			const c = addSymmetryConstraint(sketch, paId, pbId, axisId);
			if (c) created.push(c);
		}
	}
	sketch.commitTransaction();
	return created;
}

export function addPointOnAxisConstraint(
	sketch: SketchDocument,
	pointId: string,
	axis: 'x' | 'y'
): PointOnLineConstraint | null {
	if (!sketch.points.get(pointId)) return null;
	return addUniqueConstraint(
		sketch,
		PointOnLineConstraint,
		c => c.pointId === pointId && c.lineP1Id === 'origin' && c.lineP2Id === `axis_${axis}`,
		() => new PointOnLineConstraint(sketch.nextId('c_ptline'), pointId, 'origin', `axis_${axis}`)
	);
}

export function addPointOnLineConstraint(
	sketch: SketchDocument,
	pointId: string,
	lineId: string
): PointOnLineConstraint | null {
	const line = sketch.lines.get(lineId);
	if (!line || pointId === line.p1Id || pointId === line.p2Id) return null;
	return addUniqueConstraint(
		sketch,
		PointOnLineConstraint,
		c => c.pointId === pointId && matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id),
		() => new PointOnLineConstraint(sketch.nextId('c_ptline'), pointId, line.p1Id, line.p2Id),
		'null'
	);
}

export function addPointOnCircleConstraint(
	sketch: SketchDocument,
	pointId: string,
	circleOrArcId: string
): PointOnCircleConstraint | null {
	const circle = getRadial(sketch, circleOrArcId);
	if (!circle || pointId === circle.centerId) return null;
	const arc = sketch.arcs.get(circleOrArcId);
	if (arc && (pointId === arc.startPointId || pointId === arc.endPointId)) return null;
	return addUniqueConstraint(
		sketch,
		PointOnCircleConstraint,
		c => c.pointId === pointId && c.circleId === circleOrArcId,
		() => new PointOnCircleConstraint(sketch.nextId('c_ptcirc'), pointId, circle.centerId, circleOrArcId),
		'null'
	);
}

export function addPointOnEllipseConstraint(
	sketch: SketchDocument,
	pointId: string,
	ellipseOrArcId: string
): PointOnEllipseConstraint | null {
	const el = sketch.ellipses.get(ellipseOrArcId) ?? sketch.ellipticalArcs.get(ellipseOrArcId);
	if (!el || pointId === el.centerId || pointId === el.majorAxisPointId || pointId === el.minorAxisPointId) {
		return null;
	}
	if (el instanceof SketchEllipticalArc && (pointId === el.startPointId || pointId === el.endPointId)) {
		return null;
	}
	return addUniqueConstraint(
		sketch,
		PointOnEllipseConstraint,
		c => c.pointId === pointId && c.ellipseId === ellipseOrArcId,
		() =>
			new PointOnEllipseConstraint(
				sketch.nextId('c_ptel'),
				pointId,
				ellipseOrArcId,
				el.centerId,
				el.majorAxisPointId,
				el.minorAxisPointId
			),
		'null'
	);
}

export function addPointOnSplineConstraint(
	sketch: SketchDocument,
	pointId: string,
	splineId: string
): PointOnSplineConstraint | null {
	const spline = sketch.splines.get(splineId);
	if (!spline || spline.pointIds.includes(pointId) || sketch.isSplineHandlePoint(pointId)) return null;
	return addUniqueConstraint(
		sketch,
		PointOnSplineConstraint,
		c => c.pointId === pointId && c.splineId === splineId,
		() => {
			const handlePoints: Array<{ p1Id: string; p2Id: string }> = [];
			for (const lid of spline.tangentLineIds ?? []) {
				const l = sketch.lines.get(lid);
				if (l) handlePoints.push({ p1Id: l.p1Id, p2Id: l.p2Id });
			}
			return new PointOnSplineConstraint(
				sketch.nextId('c_ptspline'),
				pointId,
				spline.id,
				spline.splineType,
				[...spline.pointIds],
				handlePoints.length > 0 ? handlePoints : undefined,
				spline.tangentLineIds ? [...spline.tangentLineIds] : undefined,
				spline.knots ? [...spline.knots] : undefined,
				spline.isClosed
			);
		},
		'null'
	);
}

export function addTangentConstraint(
	sketch: SketchDocument,
	entity1Id: string,
	entity2Id: string
): TangentLineCircleConstraint | TangentCircleCircleConstraint | null {
	const line1 = sketch.getLine(entity1Id);
	const line2 = sketch.getLine(entity2Id);
	const circ1 = getRadial(sketch, entity1Id);
	const circ2 = getRadial(sketch, entity2Id);

	// Case 1: Line (or Coordinate Axis) and Circle/Arc
	if ((line1 && circ2) || (line2 && circ1)) {
		const line = line1 ?? line2!;
		const circ = circ2 ?? circ1!;
		return addUniqueConstraint(
			sketch,
			TangentLineCircleConstraint,
			c =>
				c.circleId === circ.id &&
				(c.lineId === line.id || matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id)),
			() =>
				new TangentLineCircleConstraint(
					sketch.nextId('c_tang'),
					line.p1Id,
					line.p2Id,
					circ.centerId,
					circ.id,
					getTangentSide(sketch, line, circ.centerId),
					1.0,
					line.id
				)
		);
	}

	// Case 2: Circle/Arc and Circle/Arc
	if (circ1 && circ2 && circ1.id !== circ2.id) {
		const existing = findConstraint(sketch, TangentCircleCircleConstraint, c =>
			matchesEndpoints(c.circle1Id, c.circle2Id, circ1.id, circ2.id)
		);
		if (existing) return existing;

		const center1 = sketch.points.get(circ1.centerId);
		const center2 = sketch.points.get(circ2.centerId);
		if (!center1 || !center2) return null;

		const d = center1.distanceTo(center2);
		const isInternal =
			Math.abs(d - Math.abs(circ1.radius - circ2.radius)) < Math.abs(d - (circ1.radius + circ2.radius));
		const outerCircleId = isInternal ? (circ1.radius >= circ2.radius ? circ1.id : circ2.id) : null;
		const arc1 = sketch.arcs.get(circ1.id);
		const arc2 = sketch.arcs.get(circ2.id);
		const sharedPointId =
			arc1 && arc2
				? ([arc1.startPointId, arc1.endPointId].find(id => id === arc2.startPointId || id === arc2.endPointId) ?? null)
				: null;
		const c = new TangentCircleCircleConstraint(
			sketch.nextId('c_tang'),
			circ1.centerId,
			circ1.id,
			circ2.centerId,
			circ2.id,
			isInternal,
			outerCircleId,
			1.0,
			sharedPointId
		);
		return addConstraint(sketch, c) ? c : null;
	}

	return null;
}

export function addCircleTangentConstraint(
	sketch: SketchDocument,
	c1Id: string,
	c2Id: string
): TangentCircleCircleConstraint | null {
	const res = addTangentConstraint(sketch, c1Id, c2Id);
	return res instanceof TangentCircleCircleConstraint ? res : null;
}

export function addConcentricConstraint(
	sketch: SketchDocument,
	c1Id: string,
	c2Id: string
): ConcentricConstraint | null {
	const circ1 = getRadial(sketch, c1Id);
	const circ2 = getRadial(sketch, c2Id);
	if (!circ1 || !circ2) return null;
	if (areOffsetCircleCenters(sketch, circ1.centerId, circ2.centerId)) return null;

	const c = new ConcentricConstraint(sketch.nextId('c_concen'), circ1.centerId, circ2.centerId);
	return addConstraint(sketch, c) ? c : null;
}

export function addMidpointConstraint(
	sketch: SketchDocument,
	pointId: string,
	lineOrP1Id: string,
	p2Id?: string
): MidpointConstraint | null {
	if (!sketch.points.get(pointId)) return null;

	let end1Id: string;
	let end2Id: string;
	if (p2Id !== undefined) {
		if (lineOrP1Id === p2Id || !sketch.points.get(lineOrP1Id) || !sketch.points.get(p2Id)) return null;
		end1Id = lineOrP1Id;
		end2Id = p2Id;
	} else {
		const line = sketch.lines.get(lineOrP1Id);
		if (!line) return null;
		end1Id = line.p1Id;
		end2Id = line.p2Id;
	}

	if (pointId === end1Id || pointId === end2Id) return null;
	return addUniqueConstraint(
		sketch,
		MidpointConstraint,
		c => c.midId === pointId && matchesEndpoints(c.p1Id, c.p2Id, end1Id, end2Id),
		() => new MidpointConstraint(sketch.nextId('c_mid'), pointId, end1Id, end2Id)
	);
}

export function addThreePointMidpointConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	p3Id: string
): MidpointConstraint | null {
	const part = partitionThreePointsByMiddle(sketch, p1Id, p2Id, p3Id);
	if (!part) return null;
	return addMidpointConstraint(sketch, part.midId, part.end1Id, part.end2Id);
}

export function cleanOrphanConstraints(sketch: SketchDocument): void {
	const dropConstraint = (cid: string) => {
		sketch.constraints.delete(cid);
		sketch.selection.constraintIds.delete(cid);
	};
	for (const [cid, constraint] of sketch.constraints.entries()) {
		if (constraint instanceof CircularPatternConstraint || constraint instanceof RectangularPatternConstraint) {
			// A trimmed/deleted arc may leave its center and endpoints in use. Keep the
			// remaining pattern, but never evaluate a radius equation against a missing
			// entity: the solver would read its radius as zero and collapse its source.
			const hasRadius = (id: string) => sketch.circles.has(id) || sketch.arcs.has(id);
			const missingRadiusIds = new Set<string>();
			for (const copy of constraint.copies) {
				if (!copy.radiusPairs) continue;
				copy.radiusPairs = copy.radiusPairs.filter(pair => {
					const sourceExists = hasRadius(pair.sourceCircleId);
					const copyExists = hasRadius(pair.patternCircleId);
					if (!sourceExists) missingRadiusIds.add(pair.sourceCircleId);
					if (!copyExists) missingRadiusIds.add(pair.patternCircleId);
					return sourceExists && copyExists;
				});
			}
			if (missingRadiusIds.size) constraint.entityIds = constraint.entityIds.filter(id => !missingRadiusIds.has(id));
		}
		if (constraint instanceof CircularPatternConstraint) {
			if (!sketch.points.get(constraint.centerPtId)) {
				dropConstraint(cid);
				continue;
			}
			const hasAnySource = constraint.sourceObjectIds.some(id => sketch.hasOwnPrimitive(id));
			const hasMissingSpline = constraint.copies.some(copy =>
				copy.createdEntityIds.some(item => item.type === 'spline' && !sketch.splines.has(item.id))
			);
			const hasMissingPoint = constraint.copies.some(copy =>
				copy.pointPairs.some(pair => !sketch.points.get(pair.sourcePtId) || !sketch.points.get(pair.patternPtId))
			);
			if (!hasAnySource || hasMissingSpline || hasMissingPoint) {
				dropConstraint(cid);
			}
			continue;
		}
		if (constraint instanceof RectangularPatternConstraint) {
			if (constraint.line1Id && !sketch.lines.has(constraint.line1Id)) {
				constraint.line1Id = null;
				constraint.line1P1Id = null;
				constraint.line1P2Id = null;
			}
			if (constraint.line2Id && !sketch.lines.has(constraint.line2Id)) {
				constraint.line2Id = null;
				constraint.line2P1Id = null;
				constraint.line2P2Id = null;
			}
			const hasAnySource = constraint.sourceObjectIds.some(id => sketch.hasOwnPrimitive(id));
			const hasBrokenSplineCopy = constraint.copies.some(copy => {
				const splines = copy.createdEntityIds.filter(item => item.type === 'spline');
				return (
					splines.length > 0 &&
					(splines.some(item => !sketch.splines.has(item.id)) ||
						copy.pointPairs.some(pair => !sketch.points.get(pair.sourcePtId) || !sketch.points.get(pair.patternPtId)))
				);
			});
			if (!hasAnySource || hasBrokenSplineCopy) {
				dropConstraint(cid);
			}
			continue;
		}
		if (constraint.entityIds.some(entId => !hasConstraintEntity(sketch, entId))) {
			dropConstraint(cid);
			continue;
		}
		if (
			constraint instanceof SymmetryConstraint &&
			constraint.lineId &&
			constraint.lineId !== 'origin' &&
			!sketch.getLine(constraint.lineId) &&
			!sketch.getLineBetween(constraint.lineP1Id, constraint.lineP2Id)
		) {
			dropConstraint(cid);
		}
	}
}

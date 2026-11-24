import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import {
	FixedConstraint,
	MidpointConstraint,
	DragPointConstraint,
	PointOnSplineConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import { AutomaticSplineHandlesConstraint } from '../solver/constraints/automaticSplineHandles';
import { SketchPoint, SketchLine, SketchSpline } from './types';
import { Vec2, type XY } from '../math/vector';
import { computeNaturalFitHandles } from '../math/spline';

export function createFitSplineHandle(
	sketch: SketchDocument,
	splineId: string,
	fitPoint: SketchPoint,
	h1Pos: XY,
	h2Pos: XY,
	isAutomaticSplineHandle: boolean
): { lineId: string; p1Id: string; p2Id: string; midpoint: MidpointConstraint } {
	const p1Id = sketch.nextId('Point');
	sketch.points.set(p1Id, new SketchPoint(p1Id, h1Pos.x, h1Pos.y, false));
	const p2Id = sketch.nextId('Point');
	sketch.points.set(p2Id, new SketchPoint(p2Id, h2Pos.x, h2Pos.y, false));
	const lineId = sketch.nextId('Line');
	sketch.lines.set(
		lineId,
		new SketchLine({
			id: lineId,
			p1Id,
			p2Id,
			lineType: 'spline_handle',
			parentSplineId: splineId,
			isAutomaticSplineHandle,
		})
	);
	const d1 = fitPoint.distanceTo(h1Pos);
	const d2 = fitPoint.distanceTo(h2Pos);
	const ratio = d1 + d2 > 1e-6 ? d1 / (d1 + d2) : 0.5;
	const midpoint = new MidpointConstraint(sketch.nextId('c_midpoint'), fitPoint.id, p1Id, p2Id, 1.0, ratio);
	sketch.constraints.set(midpoint.id, midpoint);
	return { lineId, p1Id, p2Id, midpoint };
}

export function createControlSplineHandleLines(
	sketch: SketchDocument,
	splineId: string,
	pointIds: readonly string[]
): string[] {
	const lineIds: string[] = [];
	for (let i = 0; i < pointIds.length - 1; i++) {
		const lineId = sketch.nextId('Line');
		sketch.lines.set(
			lineId,
			new SketchLine({
				id: lineId,
				p1Id: pointIds[i],
				p2Id: pointIds[i + 1],
				lineType: 'spline_handle',
				parentSplineId: splineId,
			})
		);
		lineIds.push(lineId);
	}
	return lineIds;
}

export function addFitSpline(
	sketch: SketchDocument,
	pointIds: string[],
	tangentLineIds?: string[],
	isConstruction = false,
	id?: string,
	isClosed?: boolean,
	explicitHandles?: Array<{ h1: Vec2; h2: Vec2 }>
): SketchSpline {
	sketch.pushHistory();
	const sid = id || sketch.nextId('Spline');

	const closed =
		isClosed ??
		(pointIds.length >= 4 &&
			(pointIds[0] === pointIds[pointIds.length - 1] ||
				(sketch.points.has(pointIds[0]) &&
					sketch.points.has(pointIds[pointIds.length - 1]) &&
					sketch.points.get(pointIds[pointIds.length - 1])!.distanceTo(sketch.points.get(pointIds[0])!) < 1e-4)));

	const actualPointIds = [...pointIds];
	if (closed && actualPointIds[0] !== actualPointIds[actualPointIds.length - 1]) {
		actualPointIds.push(actualPointIds[0]);
	}

	let actualTangentLineIds = tangentLineIds ? [...tangentLineIds] : undefined;

	// Automatically construct tangent handle lines with midpoint constraints if not provided
	if (!actualTangentLineIds || actualTangentLineIds.length === 0) {
		const pts = actualPointIds.map(pid => sketch.points.get(pid)).filter((p): p is SketchPoint => !!p);
		if (pts.length >= 2) {
			const handles = explicitHandles || computeNaturalFitHandles(pts);
			actualTangentLineIds = [];
			const count = closed ? pts.length - 1 : pts.length;
			for (let i = 0; i < count; i++) {
				const { lineId } = createFitSplineHandle(sketch, sid, pts[i], handles[i].h1, handles[i].h2, !explicitHandles);
				actualTangentLineIds.push(lineId);
			}
			if (closed && actualTangentLineIds.length > 0) {
				actualTangentLineIds.push(actualTangentLineIds[0]);
			}
			sketch.rebuildParamManager();
		}
	}

	const spline = new SketchSpline({
		id: sid,
		splineType: 'fit',
		pointIds: actualPointIds,
		tangentLineIds: actualTangentLineIds,
		isClosed: closed,
		isConstruction,
	});
	sketch.splines.set(sid, spline);

	if (actualTangentLineIds) {
		for (const lid of actualTangentLineIds) {
			const line = sketch.lines.get(lid);
			if (line) {
				line.parentSplineId = sid;
				line.isAutomaticSplineHandle ??= false;
				line.lineType = 'spline_handle';
			}
		}
	}

	sketch.notify();
	return spline;
}

export function addControlSpline(
	sketch: SketchDocument,
	pointIds: string[],
	isConstruction = false,
	id?: string,
	_isClosed?: boolean,
	knots?: number[],
	tangentLineIds?: string[]
): SketchSpline {
	sketch.pushHistory();
	const sid = id || sketch.nextId('Spline');

	const actualPointIds = [...pointIds];
	let actualTangentLineIds = tangentLineIds ? [...tangentLineIds] : undefined;

	if (!actualTangentLineIds) {
		actualTangentLineIds = createControlSplineHandleLines(sketch, sid, actualPointIds);
	} else {
		for (const lid of actualTangentLineIds) {
			const line = sketch.lines.get(lid);
			if (line) {
				line.parentSplineId = sid;
				line.lineType = 'spline_handle';
			}
		}
	}

	const spline = new SketchSpline({
		id: sid,
		splineType: 'control',
		pointIds: actualPointIds,
		tangentLineIds: actualTangentLineIds,
		knots: knots ? [...knots] : undefined,
		isClosed: false,
		isConstruction,
	});
	sketch.splines.set(sid, spline);
	sketch.notify();
	return spline;
}

export function copySpline(
	sketch: SketchDocument,
	source: SketchSpline,
	mapPoint: (id: string) => string
): SketchSpline {
	const pointIds = source.pointIds.map(mapPoint);
	if (source.splineType === 'control') {
		return addControlSpline(sketch, pointIds, source.isConstruction, undefined, false, source.knots);
	}

	const constraints = [...sketch.constraints.values()];
	const lines = new Map<string, string>();
	const tangentLineIds = pointIds.map((pointId, index) => {
		const line = sketch.lines.get(source.tangentLineIds?.[index] ?? '');
		if (!line || !sketch.points.get(line.p1Id) || !sketch.points.get(line.p2Id)) return '';
		const existing = lines.get(line.id);
		if (existing) return existing;

		const p1Id = mapPoint(line.p1Id);
		const p2Id = mapPoint(line.p2Id);
		const copy = sketch.addLine(p1Id, p2Id, line.lineType);
		copy.isAutomaticSplineHandle = line.isAutomaticSplineHandle;
		lines.set(line.id, copy.id);
		const midpoint = constraints.find(
			(c): c is MidpointConstraint =>
				c instanceof MidpointConstraint &&
				c.midId === source.pointIds[index] &&
				c.p1Id === line.p1Id &&
				c.p2Id === line.p2Id
		);
		if (midpoint) {
			const c = new MidpointConstraint(
				sketch.nextId('c_midpoint'),
				pointId,
				p1Id,
				p2Id,
				midpoint.weight,
				midpoint.ratio
			);
			sketch.constraints.set(c.id, c);
		}
		return copy.id;
	});
	return addFitSpline(sketch, pointIds, tangentLineIds, source.isConstruction, undefined, source.isClosed);
}

export function isSplineHandleLine(sketch: SketchDocument, lineId: string): boolean {
	const line = sketch.lines.get(lineId);
	return !!line?.isSplineHandle;
}

export function isSplineHandlePoint(sketch: SketchDocument, pointId: string): boolean {
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle && (line.p1Id === pointId || line.p2Id === pointId)) {
			const parentSpline = line.parentSplineId ? sketch.splines.get(line.parentSplineId) : undefined;
			if (parentSpline && parentSpline.pointIds.includes(pointId)) {
				return false;
			}
			return true;
		}
	}
	return false;
}

export function resetFitSplineTangents(
	sketch: SketchDocument,
	selectedLines: string[],
	selectedPoints: string[]
): void {
	for (const spline of sketch.splines.values()) {
		if (spline.splineType !== 'fit' || !spline.tangentLineIds) continue;
		for (const id of new Set(spline.tangentLineIds)) {
			const line = sketch.lines.get(id);
			if (
				!line ||
				line.isAutomaticSplineHandle ||
				(!selectedLines.includes(id) && !selectedPoints.includes(line.p1Id) && !selectedPoints.includes(line.p2Id))
			) {
				continue;
			}

			const midpoint = [...sketch.constraints.values()].find(
				c => c instanceof MidpointConstraint && c.p1Id === line.p1Id && c.p2Id === line.p2Id
			);
			if (!(midpoint instanceof MidpointConstraint)) continue;

			const constrained = [...sketch.constraints.values()].some(
				c =>
					c !== midpoint &&
					!(c instanceof PointOnSplineConstraint) &&
					c.entityIds.some(entityId => entityId === id || entityId === line.p1Id || entityId === line.p2Id)
			);
			if (constrained || sketch.points.get(line.p1Id)?.fixed || sketch.points.get(line.p2Id)?.fixed) continue;

			// Explicit handles can have unequal lengths. The automatic handles are symmetric.
			if (midpoint.ratio !== 0.5) {
				sketch.constraints.set(
					midpoint.id,
					new MidpointConstraint(midpoint.id, midpoint.midId, midpoint.p1Id, midpoint.p2Id, midpoint.weight)
				);
			}
			line.isAutomaticSplineHandle = true;
		}
	}
}

export function isSplineInternalConstraint(sketch: SketchDocument, c: IConstraint): boolean {
	if (c instanceof MidpointConstraint) {
		return c.isInternalConstraint(sketch);
	}
	if (c.type === 'midpoint') {
		const anyC = c as unknown as { p1Id?: string; p2Id?: string };
		for (const line of sketch.lines.values()) {
			if (
				line.isSplineHandle &&
				((line.p1Id === anyC.p1Id && line.p2Id === anyC.p2Id) || (line.p1Id === anyC.p2Id && line.p2Id === anyC.p1Id))
			) {
				return true;
			}
		}
	}
	return false;
}

export function prepareSplineConstraints(
	sketch: SketchDocument,
	extraConstraints: IConstraint[],
	lockedParams: Set<string>,
	editedHandles: SketchLine[]
): IConstraint[] {
	const constraints = [...sketch.constraints.values(), ...extraConstraints].filter(
		c => !c.isReference && !sketch.hasMissingFixedReference(c)
	);
	if (sketch.splines.size === 0) return constraints;
	const splineConstraints: IConstraint[] = [];
	const replaced = new Set<IConstraint>();
	const midpoints = new Map<string, MidpointConstraint>();
	const editedPoints = new Set<string>();
	const constrained = new Set<string>();
	for (const c of constraints) {
		if (c instanceof MidpointConstraint) {
			midpoints.set(c.p1Id, c);
		} else if (!(c instanceof PointOnSplineConstraint)) {
			if (extraConstraints.includes(c) && (c instanceof DragPointConstraint || c instanceof FixedConstraint)) {
				editedPoints.add(c.pointId);
			} else {
				// Copy constraints drive the destination, so automatic source handles can still follow their fit points.
				if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
					for (const copy of c.copies) {
						for (const pair of copy.pointPairs) constrained.add(pair.patternPtId);
					}
					if (c instanceof CircularPatternConstraint) {
						constrained.add(c.centerPtId);
					} else {
						for (const id of [c.line1P1Id, c.line1P2Id, c.line2P1Id, c.line2P2Id]) {
							if (id) constrained.add(id);
						}
					}
				} else {
					for (const id of c.entityIds) {
						if (!(c instanceof SymmetryConstraint && c.isMirrorCopy && id === c.p1Id)) constrained.add(id);
					}
				}
			}
		}
	}

	for (const spline of sketch.splines.values()) {
		if (spline.splineType !== 'fit' || !spline.tangentLineIds || spline.pointIds.length < 2) continue;
		const points = spline.pointIds.map(id => sketch.points.get(id));
		if (points.some(point => !point)) continue;
		const natural = computeNaturalFitHandles(points as SketchPoint[]);
		const automatic: { index: number; midpoint: MidpointConstraint }[] = [];
		for (const [index, lineId] of spline.tangentLineIds.entries()) {
			// Closed splines reuse the first tangent at the closing point.
			if (index === spline.pointIds.length - 1 && index > 0 && lineId === spline.tangentLineIds[0]) continue;
			const line = sketch.lines.get(lineId);
			const fit = points[index];
			if (!line || !fit) continue;
			const midpoint = midpoints.get(line.p1Id);
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!midpoint || midpoint.midId !== fit.id || midpoint.p2Id !== line.p2Id || !p1 || !p2) continue;

			const editP1 = editedPoints.has(p1.id);
			const editP2 = editedPoints.has(p2.id);
			if (editP1 || editP2) {
				editedHandles.push(line);
				lockedParams.add(`${fit.id}.x`);
				lockedParams.add(`${fit.id}.y`);
			}

			if (constrained.has(lineId) || constrained.has(p1.id) || constrained.has(p2.id) || p1.fixed || p2.fixed) {
				continue;
			}

			const ratio = midpoint.ratio;
			const dir: Vec2 = new Vec2().subVectors(fit, p1.clone().lerp(p2, ratio));
			if (editP1 && !editP2 && ratio > 1e-6) {
				p2.addScaledVector(dir, 1 / ratio);
			} else if (editP2 && !editP1 && 1 - ratio > 1e-6) {
				p1.addScaledVector(dir, 1 / (1 - ratio));
			} else if (!editP1 && !editP2 && line.isAutomaticSplineHandle) {
				p1.copy(natural[index].h1);
				p2.copy(natural[index].h2);
				automatic.push({ index, midpoint });
				replaced.add(midpoint);
			} else if (editedPoints.has(fit.id)) {
				p1.add(dir);
				p2.add(dir);
			}
		}
		if (automatic.length > 0) {
			splineConstraints.push(new AutomaticSplineHandlesConstraint(spline.id, spline.pointIds, automatic));
		}
	}
	return [...constraints.filter(c => !replaced.has(c)), ...splineConstraints];
}

function deleteSplineTangentLine(sketch: SketchDocument, lid: string, candidatePointIds?: Set<string>): void {
	const line = sketch.lines.get(lid);
	if (!line) return;
	if (candidatePointIds) {
		candidatePointIds.add(line.p1Id);
		candidatePointIds.add(line.p2Id);
	}
	sketch.lines.delete(lid);
	sketch.selection.lineIds.delete(lid);
}

export function deleteSplineWithHandles(
	sketch: SketchDocument,
	sid: string,
	spline: SketchSpline,
	candidatePointIds: Set<string>
): void {
	for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
	if (spline.tangentLineIds) {
		for (const lid of spline.tangentLineIds) {
			deleteSplineTangentLine(sketch, lid, spline.splineType === 'fit' ? candidatePointIds : undefined);
		}
	}
	sketch.splines.delete(sid);
	sketch.selection.splineIds.delete(sid);
}

export function removePointFromSplines(sketch: SketchDocument, pointId: string, candidatePointIds: Set<string>): void {
	for (const [sid, spline] of sketch.splines.entries()) {
		if (!spline.pointIds.includes(pointId)) continue;
		if (spline.splineType === 'control') {
			const remaining = spline.pointIds.filter(pid => pid !== pointId);
			if (remaining.length >= 2) {
				spline.pointIds = remaining;
				delete spline.knots;
				if (spline.tangentLineIds) {
					for (const lid of spline.tangentLineIds) deleteSplineTangentLine(sketch, lid);
				}
				spline.tangentLineIds = createControlSplineHandleLines(sketch, sid, remaining);
			} else {
				deleteSplineWithHandles(sketch, sid, spline, candidatePointIds);
			}
		} else if (spline.splineType === 'fit') {
			const unique = spline.isClosed ? spline.pointIds.slice(0, -1) : spline.pointIds;
			if (unique.length <= (spline.isClosed ? 3 : 2)) {
				deleteSplineWithHandles(sketch, sid, spline, candidatePointIds);
			} else {
				const idx = unique.indexOf(pointId);
				if (idx !== -1) {
					if (spline.tangentLineIds?.[idx]) {
						deleteSplineTangentLine(sketch, spline.tangentLineIds[idx], candidatePointIds);
					}
					const nextUnique = unique.filter((_, i) => i !== idx);
					spline.pointIds = spline.isClosed ? [...nextUnique, nextUnique[0]] : nextUnique;
					if (spline.tangentLineIds) {
						const baseTangents = spline.isClosed ? spline.tangentLineIds.slice(0, -1) : spline.tangentLineIds;
						const nextTangents = baseTangents.filter((_, i) => i !== idx);
						spline.tangentLineIds = spline.isClosed ? [...nextTangents, nextTangents[0]] : nextTangents;
					}
				}
			}
		}
	}
}

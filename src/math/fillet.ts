import { Vec2 } from './vector';
import type { SketchDocument } from '../model/sketch';
import type { SketchLine, SketchSpline } from '../model/types';
import { remapLineConstraints } from '../model/constraintLinks';
import {
	CircularPatternConstraint,
	CoincidentConstraint,
	DistanceConstraint,
	MidpointConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import type { GeoCurve, GeoSpline } from './intersection';
import { extractSplineInterval } from './spline';
import { getGeometryKernel } from '../kernel';
import * as reference from './filletReference';

type FilletOptions = Parameters<typeof reference.calculateFilletGeometry>[3];

export interface ConnectedPrimitiveInfo {
	type: 'line' | 'arc' | 'spline';
	id: string;
	endPointId: string; // The endpoint coincident with the corner
	otherPointId?: string;
}

export interface ConnectedPrimitivesResult {
	valid: boolean;
	pointIds: Set<string>;
	primitives: ConnectedPrimitiveInfo[];
}

/**
 * Finds all points coincident to startPointId and returns all non-construction, non-handle
 * primitives (line, arc, spline) connected to them.
 * A corner is valid for a fillet if and only if exactly 2 primitives emanate from it.
 */
export function getConnectedPrimitivesForPoint(
	sketch: SketchDocument,
	startPointId: string
): ConnectedPrimitivesResult {
	if (!sketch.points.has(startPointId)) {
		return { valid: false, pointIds: new Set(), primitives: [] };
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

	// 2. Collect all primitives connected to any point in pointIds
	const primitives: ConnectedPrimitiveInfo[] = [];
	const seenIds = new Set<string>();

	// Lines
	for (const line of sketch.lines.values()) {
		if (line.isSplineHandle) continue; // Skip spline tangent handles
		const p1In = pointIds.has(line.p1Id);
		const p2In = pointIds.has(line.p2Id);
		if (p1In || p2In) {
			if (!seenIds.has(line.id)) {
				seenIds.add(line.id);
				primitives.push({
					type: 'line',
					id: line.id,
					endPointId: p1In ? line.p1Id : line.p2Id,
					otherPointId: p1In ? line.p2Id : line.p1Id,
				});
			}
		}
	}

	// Arcs
	for (const arc of sketch.arcs.values()) {
		const startIn = pointIds.has(arc.startPointId);
		const endIn = pointIds.has(arc.endPointId);
		if (startIn || endIn) {
			if (!seenIds.has(arc.id)) {
				seenIds.add(arc.id);
				primitives.push({
					type: 'arc',
					id: arc.id,
					endPointId: startIn ? arc.startPointId : arc.endPointId,
					otherPointId: startIn ? arc.endPointId : arc.startPointId,
				});
			}
		}
	}

	// Splines
	for (const spline of sketch.splines.values()) {
		if (spline.pointIds.length >= 2) {
			const startPt = spline.pointIds[0];
			const endPt = spline.pointIds[spline.pointIds.length - 1];
			const startIn = pointIds.has(startPt);
			const endIn = pointIds.has(endPt);
			if (startIn || endIn) {
				if (!seenIds.has(spline.id)) {
					seenIds.add(spline.id);
					primitives.push({
						type: 'spline',
						id: spline.id,
						endPointId: startIn ? startPt : endPt,
						otherPointId: startIn ? spline.pointIds[1] : spline.pointIds[spline.pointIds.length - 2],
					});
				}
			}
		}
	}

	const valid = primitives.length === 2;
	return { valid, pointIds, primitives };
}

export interface FilletResult {
	center: Vec2;
	radius: number;
	t1: Vec2;
	t2: Vec2;
	clockwise: boolean;
	cornerVertex: Vec2;
	midArc: Vec2;
	bisectorDir: Vec2;
	param1: number;
	param2: number;
	endPointId1?: string;
	endPointId2?: string;
}

export interface FilletCandidate {
	id: string;
	vertexPointId?: string;
	primitive1: { type: 'line' | 'arc' | 'spline'; id: string };
	primitive2: { type: 'line' | 'arc' | 'spline'; id: string };
	clickPos1?: Vec2;
	clickPos2?: Vec2;
	endPointId1?: string;
	endPointId2?: string;
	result?: FilletResult | null;
}

function supported(curve: GeoCurve) {
	return curve.type === 'segment' || curve.type === 'arc' || curve.type === 'spline';
}
export function evaluateCurveExtended(curve: GeoCurve, t: number) {
	const api = getGeometryKernel().fillet;
	if (!api || !supported(curve)) return reference.evaluateCurveExtended(curve, t);
	const r = api.evaluate(curve, t);
	return { point: Vec2.from(r.point), tangent: Vec2.from(r.tangent), normal: Vec2.from(r.normal) };
}
export function projectOntoCurveExtended(curve: GeoCurve, point: Vec2) {
	const api = getGeometryKernel().fillet;
	// Preserve the empty-spline sentinel and degenerate-segment point identity.
	if (
		!api ||
		!supported(curve) ||
		(curve.type === 'spline' && !curve.bezierSegments.length) ||
		(curve.type === 'segment' && new Vec2().subVectors(curve.p1, curve.p2).lengthSq() < 1e-12)
	) {
		return reference.projectOntoCurveExtended(curve, point);
	}
	const r = api.project(curve, point);
	return { ...r, point: Vec2.from(r.point) };
}
export function calculateFilletGeometry(
	curve1: GeoCurve,
	curve2: GeoCurve,
	radius: number,
	options: FilletOptions
): FilletResult | null {
	const api = getGeometryKernel().fillet;
	if (!api || !supported(curve1) || !supported(curve2))
		return reference.calculateFilletGeometry(curve1, curve2, radius, options);
	const r = api.calculate(curve1, curve2, radius, options);
	if (!r) return null;
	return {
		...r,
		center: Vec2.from(r.center),
		t1: Vec2.from(r.t1),
		t2: Vec2.from(r.t2),
		cornerVertex: options.cornerVertex ?? Vec2.from(r.cornerVertex),
		midArc: Vec2.from(r.midArc),
		bisectorDir: Vec2.from(r.bisectorDir),
		endPointId1: options.endPointId1,
		endPointId2: options.endPointId2,
	};
}

type FilletCommitResult = { arcId: string; centerId: string; p1Id: string; p2Id: string };
interface SharedSplineCut {
	fillet: FilletCandidate;
	slot: 0 | 1;
	param: number;
	oldPointId: string;
}
interface SharedSplineTrim {
	curve: GeoSpline;
	start: SharedSplineCut;
	end: SharedSplineCut;
	replacementId?: string;
}
interface FilletBatchContext {
	points: Map<FilletCandidate, readonly [string, string]>;
	splines: Map<string, SharedSplineTrim>;
}

/** Apply previews together so a shared spline is cut once in its original parameter space. */
export function commitFilletsToSketch(
	sketch: SketchDocument,
	fillets: readonly FilletCandidate[],
	expression?: string
): FilletCommitResult[] | null {
	if (!fillets.length || fillets.some(f => !f.result)) return null;
	const uses = new Map<string, SharedSplineCut[]>();
	for (const fillet of fillets) {
		for (const slot of [0, 1] as const) {
			const primitive = slot === 0 ? fillet.primitive1 : fillet.primitive2;
			if (!sketch.getPrimitive(primitive.id, primitive.type)) return null;
			if (primitive.type !== 'spline') continue;
			const spline = sketch.splines.get(primitive.id)!;
			const param = slot === 0 ? fillet.result!.param1 : fillet.result!.param2;
			const hint = slot === 0 ? fillet.endPointId1 : fillet.endPointId2;
			const start = isFilletSplineStart(sketch, spline, param, hint, fillet.result!.cornerVertex);
			const cut = { fillet, slot, param, oldPointId: start ? spline.pointIds[0] : spline.pointIds.at(-1)! };
			const cuts = uses.get(primitive.id) ?? [];
			cuts.push(cut);
			uses.set(primitive.id, cuts);
		}
	}
	const context: FilletBatchContext = { points: new Map(), splines: new Map() };
	for (const [id, cuts] of uses) {
		if (cuts.length < 2) continue;
		const spline = sketch.splines.get(id)!;
		const start = cuts.find(c => c.oldPointId === spline.pointIds[0]);
		const end = cuts.find(c => c.oldPointId === spline.pointIds.at(-1));
		const curve = spline.toGeoCurve(sketch);
		// Validate both limits before changing the document; overlapping fillets have no retained span.
		if (
			cuts.length !== 2 ||
			!start ||
			!end ||
			!curve ||
			!curve.bezierSegments.length ||
			!Number.isFinite(start.param) ||
			!Number.isFinite(end.param) ||
			start.param < 0 ||
			end.param > 1 ||
			start.param >= end.param
		)
			return null;
		context.splines.set(id, { curve, start, end });
	}
	sketch.beginTransaction();
	try {
		const results = sketch.withDeferredSolve(() => {
			for (const fillet of fillets)
				context.points.set(fillet, [sketch.addPoint(fillet.result!.t1).id, sketch.addPoint(fillet.result!.t2).id]);
			const results: FilletCommitResult[] = [];
			for (const fillet of fillets) {
				const result = commitFillet(sketch, fillet, results.length === 0, results[0]?.arcId, expression, context);
				if (!result) throw new Error('Failed to commit prepared fillet');
				results.push(result);
			}
			return results;
		});
		sketch.commitTransaction();
		return results;
	} catch (error) {
		sketch.rollbackTransaction();
		throw error;
	}
}

/**
 * Commits a single fillet into the SketchDocument.
 */
export function commitFilletToSketch(
	sketch: SketchDocument,
	fillet: FilletCandidate,
	isFirstFillet: boolean,
	firstArcId?: string,
	expression?: string
): FilletCommitResult | null {
	return commitFillet(sketch, fillet, isFirstFillet, firstArcId, expression);
}

function commitFillet(
	sketch: SketchDocument,
	fillet: FilletCandidate,
	isFirstFillet: boolean,
	firstArcId?: string,
	expression?: string,
	batch?: FilletBatchContext
): FilletCommitResult | null {
	const res = fillet.result;
	if (!res) return null;
	const referencePoints = new Set<string>();
	for (const c of sketch.constraints.values()) {
		if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
			for (const id of [...c.entityIds, ...c.sourceObjectIds]) {
				if (sketch.points.has(id)) referencePoints.add(id);
			}
		} else if (c instanceof DistanceConstraint) {
			referencePoints.add(c.p1Id);
			referencePoints.add(c.p2Id);
		}
	}

	// 1. Create tangent points and arc center
	const preparedPoints = batch?.points.get(fillet);
	const pT1 = preparedPoints ? sketch.points.get(preparedPoints[0])! : sketch.addPoint(res.t1);
	const pT2 = preparedPoints ? sketch.points.get(preparedPoints[1])! : sketch.addPoint(res.t2);
	const pCenter = sketch.addPoint(res.center);

	// 2. Create the fillet arc
	const filletArc = sketch.addArc(pCenter.id, pT1.id, pT2.id, res.radius, res.clockwise);

	// 3. Trim or extend primitive 1
	const oldPt1 = trimOrExtendPrimitive(
		sketch,
		fillet.primitive1,
		pT1.id,
		res.param1,
		fillet.endPointId1,
		res.cornerVertex,
		batch
	);

	// 4. Trim or extend primitive 2
	const oldPt2 = trimOrExtendPrimitive(
		sketch,
		fillet.primitive2,
		pT2.id,
		res.param2,
		fillet.endPointId2,
		res.cornerVertex,
		batch
	);

	// Keep dimension and pattern references at the original intersection.
	const retainedPoints = new Set(referencePoints);
	// Other previews' cut points may still be waiting for their arc to be created.
	if (batch) for (const points of batch.points.values()) for (const id of points) retainedPoints.add(id);
	for (const [primitive, pointId] of [
		[fillet.primitive1, oldPt1],
		[fillet.primitive2, oldPt2],
	] as const) {
		if (primitive.type !== 'line' || !pointId) continue;
		const { pointIds } = getConnectedPrimitivesForPoint(sketch, pointId);
		if ([...pointIds].some(id => referencePoints.has(id))) {
			for (const id of pointIds) retainedPoints.add(id);
			sketch.addPointOnLineConstraint(pointId, primitive.id);
		}
	}

	// 5. If corner vertex or old endpoints exist and are now unreferenced, delete them
	const candidatesToClean = new Set<string>();
	if (oldPt1) candidatesToClean.add(oldPt1);
	if (oldPt2) candidatesToClean.add(oldPt2);
	if (fillet.vertexPointId) candidatesToClean.add(fillet.vertexPointId);
	if (fillet.endPointId1) candidatesToClean.add(fillet.endPointId1);
	if (fillet.endPointId2) candidatesToClean.add(fillet.endPointId2);

	if (res.cornerVertex) {
		for (const pt of sketch.points.values()) {
			if (pt.distanceTo(res.cornerVertex) < 0.5 && !sketch.isPointUsed(pt.id)) {
				candidatesToClean.add(pt.id);
			}
		}
	}

	for (const pid of candidatesToClean) {
		if (sketch.points.has(pid) && !retainedPoints.has(pid)) {
			const conn = getConnectedPrimitivesForPoint(sketch, pid);
			if (conn.primitives.length === 0) {
				for (const id of conn.pointIds) {
					if (!retainedPoints.has(id)) sketch.removeEntity(id);
				}
			} else if (!sketch.isPointUsed(pid)) {
				sketch.removeEntity(pid);
			}
		}
	}

	// 6. Add Tangent Constraints
	const addTangentForPrim = (prim: { type: 'line' | 'arc' | 'spline'; id: string }, cutPointId: string) => {
		if (prim.type === 'spline') {
			const spline = sketch.splines.get(prim.id);
			if (spline && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
				const isStart = spline.pointIds[0] === cutPointId;
				const handleLineId = isStart
					? spline.tangentLineIds[0]
					: spline.tangentLineIds[spline.tangentLineIds.length - 1];
				if (handleLineId) {
					sketch.addTangentConstraint(filletArc.id, handleLineId);
				}
			}
		} else {
			sketch.addTangentConstraint(filletArc.id, prim.id);
		}
	};

	addTangentForPrim(fillet.primitive1, pT1.id);
	addTangentForPrim(fillet.primitive2, pT2.id);

	// 7. Add Radius Constraint / EqualRadius Constraint
	if (isFirstFillet) {
		const c = sketch.addRadiusConstraint(filletArc.id, res.radius);
		if (c && expression) {
			c.expression = expression;
		}
	} else if (firstArcId) {
		sketch.addEqualRadiusConstraint(firstArcId, filletArc.id);
	}

	return {
		arcId: filletArc.id,
		centerId: pCenter.id,
		p1Id: pT1.id,
		p2Id: pT2.id,
	};
}

function isPointAtOrCoincident(sketch: SketchDocument, targetPointId: string, candidatePointId: string): boolean {
	if (targetPointId === candidatePointId) return true;
	const visited = new Set<string>([targetPointId]);
	const queue = [targetPointId];
	while (queue.length > 0) {
		const curr = queue.pop()!;
		for (const c of sketch.constraints.values()) {
			if (c instanceof CoincidentConstraint) {
				const next = c.p1Id === curr ? c.p2Id : c.p2Id === curr ? c.p1Id : null;
				if (next) {
					if (next === candidatePointId) return true;
					if (!visited.has(next)) {
						visited.add(next);
						queue.push(next);
					}
				}
			}
		}
	}
	return false;
}

/** Resolve the replaced endpoint identically for document edits and previews. */
export function isFilletAtStart(
	sketch: SketchDocument,
	startId: string,
	endId: string,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2
): boolean {
	if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, startId)) return true;
	if (hintEndPointId && isPointAtOrCoincident(sketch, hintEndPointId, endId)) return false;
	if (cornerVertex) {
		const start = sketch.points.get(startId),
			end = sketch.points.get(endId);
		if (start && end) return start.distanceTo(cornerVertex) < end.distanceTo(cornerVertex);
	}
	return param <= 0.5;
}

export function getFilletLineEndPointId(
	sketch: SketchDocument,
	line: SketchLine,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2
): string {
	return isFilletAtStart(sketch, line.p1Id, line.p2Id, param, hintEndPointId, cornerVertex) ? line.p1Id : line.p2Id;
}

function isFilletSplineStart(
	sketch: SketchDocument,
	spline: SketchSpline,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2
): boolean {
	const start = spline.pointIds[0];
	return isFilletAtStart(sketch, start, spline.pointIds.at(-1)!, param, hintEndPointId, cornerVertex);
}

/**
 * Trims or extends a primitive so its endpoint connects to newCutPointId.
 */
function trimOrExtendPrimitive(
	sketch: SketchDocument,
	primitive: { type: 'line' | 'arc' | 'spline'; id: string },
	newCutPointId: string,
	param: number,
	hintEndPointId?: string,
	cornerVertex?: Vec2,
	batch?: FilletBatchContext
): string | undefined {
	const shared = primitive.type === 'spline' ? batch?.splines.get(primitive.id) : undefined;
	if (shared && batch) {
		if (!shared.replacementId) {
			const startPointId = batch.points.get(shared.start.fillet)![shared.start.slot];
			const endPointId = batch.points.get(shared.end.fillet)![shared.end.slot];
			const replacement = replaceSplineWithInterval(
				sketch,
				shared.curve,
				shared.start.param,
				shared.end.param,
				startPointId,
				endPointId
			);
			if (!replacement) throw new Error('Failed to trim shared fillet spline');
			sketch.removeEntity(shared.curve.id);
			shared.replacementId = replacement.id;
		}
		primitive.id = shared.replacementId;
		const startPointId = batch.points.get(shared.start.fillet)![shared.start.slot];
		return newCutPointId === startPointId ? shared.start.oldPointId : shared.end.oldPointId;
	}
	if (primitive.type === 'line') {
		const line = sketch.lines.get(primitive.id);
		if (!line) return undefined;

		const oldPtId = getFilletLineEndPointId(sketch, line, param, hintEndPointId, cornerVertex);
		const replaceP1 = oldPtId === line.p1Id;
		remapLineConstraints(sketch, line, oldPtId, newCutPointId);
		if (replaceP1) {
			line.p1Id = newCutPointId;
		} else {
			line.p2Id = newCutPointId;
		}
		sketch.rebuildParamManager();
		return oldPtId;
	} else if (primitive.type === 'arc') {
		const arc = sketch.arcs.get(primitive.id);
		if (!arc) return undefined;

		const replaceStart = isFilletAtStart(sketch, arc.startPointId, arc.endPointId, param, hintEndPointId, cornerVertex);

		const oldPtId = replaceStart ? arc.startPointId : arc.endPointId;
		sketch.replaceArcEndpoint(arc, replaceStart ? 'start' : 'end', newCutPointId);
		return oldPtId;
	} else if (primitive.type === 'spline') {
		const spline = sketch.splines.get(primitive.id);
		if (!spline) return undefined;

		const startPtId = spline.pointIds[0];
		const endPtId = spline.pointIds[spline.pointIds.length - 1];
		const isNearStart = isFilletSplineStart(sketch, spline, param, hintEndPointId, cornerVertex);

		if (param >= 0 && param <= 1) {
			const curve = spline.toGeoCurve(sketch);
			if (curve) {
				let newSpline: SketchSpline | null = null;
				if (isNearStart) {
					// Replace [param, 1]
					newSpline = replaceSplineWithInterval(sketch, curve, param, 1, newCutPointId, endPtId);
				} else {
					// Replace [0, param]
					newSpline = replaceSplineWithInterval(sketch, curve, 0, param, startPtId, newCutPointId);
				}
				sketch.removeEntity(spline.id);
				if (newSpline) {
					primitive.id = newSpline.id;
				}
				return isNearStart ? startPtId : endPtId;
			}
		}

		// Linear extension outside [0, 1]: update endpoint position, shift tangent handle, and update midpoint constraint
		const oldPointId = isNearStart ? startPtId : endPtId;
		const oldPt = sketch.points.get(oldPointId);
		const newPt = sketch.points.get(newCutPointId);
		if (spline.splineType === 'control') {
			const handleLineId = isNearStart
				? spline.tangentLineIds?.[0]
				: spline.tangentLineIds?.[spline.tangentLineIds.length - 1];
			if (handleLineId) {
				const hLine = sketch.lines.get(handleLineId);
				if (hLine) {
					if (hLine.p1Id === oldPointId) hLine.p1Id = newCutPointId;
					else if (hLine.p2Id === oldPointId) hLine.p2Id = newCutPointId;
				}
			}
		} else if (oldPt && newPt && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
			const dir = new Vec2().subVectors(newPt, oldPt);
			const handleLineId = isNearStart
				? spline.tangentLineIds[0]
				: spline.tangentLineIds[spline.tangentLineIds.length - 1];
			if (handleLineId) {
				const hLine = sketch.lines.get(handleLineId);
				if (hLine) {
					const hp1 = sketch.points.get(hLine.p1Id);
					const hp2 = sketch.points.get(hLine.p2Id);
					if (hp1) {
						hp1.x += dir.x;
						hp1.y += dir.y;
					}
					if (hp2) {
						hp2.x += dir.x;
						hp2.y += dir.y;
					}
				}
			}
		}

		if (isNearStart) {
			spline.pointIds[0] = newCutPointId;
		} else {
			spline.pointIds[spline.pointIds.length - 1] = newCutPointId;
		}
		for (const c of sketch.constraints.values()) {
			if (c instanceof MidpointConstraint && c.midId === oldPointId) {
				(c as { midId: string }).midId = newCutPointId;
				c.entityIds[0] = newCutPointId;
			}
		}
		if (oldPointId !== newCutPointId) {
			sketch.removeEntity(oldPointId);
		}
		sketch.rebuildParamManager();
		return oldPointId;
	}
	return undefined;
}

function replaceSplineWithInterval(
	sketch: SketchDocument,
	curve: GeoSpline,
	uA: number,
	uB: number,
	startPointId: string,
	endPointId: string
): SketchSpline | null {
	if (curve.bezierSegments.length === 0) return null;
	const subSegments = extractSplineInterval(curve.bezierSegments, uA, uB);
	if (subSegments.length === 0) return null;

	const M = subSegments.length;

	if (curve.splineType === 'control') {
		const controlRawPoints: Vec2[] = [subSegments[0][0]];
		for (let s = 0; s < M; s++) {
			controlRawPoints.push(subSegments[s][1]);
			controlRawPoints.push(subSegments[s][2]);
			controlRawPoints.push(subSegments[s][3]);
		}

		const controlPtIds: string[] = [startPointId];
		for (let k = 1; k < controlRawPoints.length - 1; k++) {
			const pos = controlRawPoints[k];
			let matchedId: string | null = null;
			for (const pid of curve.pointIds) {
				const pt = sketch.points.get(pid);
				if (pt && pos.distanceTo(pt) < 1e-2) {
					matchedId = pid;
					break;
				}
			}
			if (!matchedId) {
				const newPt = sketch.addPoint(pos);
				matchedId = newPt.id;
			}
			controlPtIds.push(matchedId);
		}
		controlPtIds.push(endPointId);

		const knots: number[] = [0, 0, 0, 0];
		for (let i = 1; i < M; i++) knots.push(i, i, i);
		knots.push(M, M, M, M);

		return sketch.addControlSpline(controlPtIds, curve.isConstruction, undefined, false, knots);
	}

	const rawPoints: Vec2[] = [];
	const rawHandles: Array<{ h1: Vec2; h2: Vec2 }> = [];

	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			const p0 = subSegments[0][0];
			rawPoints.push(p0);
			const v = new Vec2().subVectors(subSegments[0][1], p0);
			rawHandles.push({
				h1: new Vec2().subVectors(p0, v),
				h2: new Vec2().addVectors(p0, v),
			});
		} else if (j === M) {
			const pM = subSegments[M - 1][3];
			rawPoints.push(pM);
			const v = new Vec2().subVectors(pM, subSegments[M - 1][2]);
			rawHandles.push({
				h1: new Vec2().subVectors(pM, v),
				h2: new Vec2().addVectors(pM, v),
			});
		} else {
			const pJ = subSegments[j][0];
			rawPoints.push(pJ);
			// A partial cubic has a shorter handle at its join with the next span.
			// Preserve both handles; averaging them changes the retained curve.
			rawHandles.push({
				h1: subSegments[j - 1][2],
				h2: subSegments[j][1],
			});
		}
	}

	const newPointIds: string[] = [];
	for (let j = 0; j <= M; j++) {
		if (j === 0) {
			newPointIds.push(startPointId);
		} else if (j === M) {
			newPointIds.push(endPointId);
		} else {
			const pt = sketch.addPoint(rawPoints[j]);
			newPointIds.push(pt.id);
		}
	}

	return sketch.addFitSpline(newPointIds, undefined, false, undefined, false, rawHandles);
}

export function findMaxFilletRadius(
	curve1: GeoCurve,
	curve2: GeoCurve,
	options: FilletOptions,
	maxR = 100,
	minR = 0.1
): number | null {
	const api = getGeometryKernel().fillet;
	return api && supported(curve1) && supported(curve2)
		? api.maxRadius(curve1, curve2, options, maxR, minR)
		: reference.findMaxFilletRadius(curve1, curve2, options, maxR, minR);
}

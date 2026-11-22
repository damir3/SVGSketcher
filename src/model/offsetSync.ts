import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import {
	CoincidentConstraint,
	MidpointConstraint,
	OffsetConstraint,
	TangentCircleCircleConstraint,
	type OffsetPair,
} from '../solver/constraints';
import { SketchPoint, SketchCircle, SketchArc, SketchEllipticalArc, SketchSpline } from './types';
import { createFitSplineHandle } from './splineOperations';
import { Vec2 } from '../math/vector';
import { computeNaturalFitHandles } from '../math/spline';
import {
	calculateOffsetGeometry,
	createOffsetSideGeometry,
	type OffsetGeometryResult,
	type OffsetSideGeometry,
} from '../math/offset';
import { resizeOffsetSpline } from '../math/offsetSpline';

function moveUnfixedPoint(sketch: SketchDocument, id: string, pos: { x: number; y: number }): void {
	const pt = sketch.points.get(id);
	if (pt && !sketch.isPointFixed(id)) {
		pt.x = pos.x;
		pt.y = pos.y;
	}
}

export function addOffsetArcTangencyAlignment(sketch: SketchDocument, constraints: IConstraint[]): void {
	const sourceArcs = new Set<string>();
	for (const c of constraints) {
		if (!(c instanceof OffsetConstraint)) continue;
		for (const item of c.sourceChain?.items ?? []) {
			if (item.type === 'arc') sourceArcs.add(item.id);
		}
	}
	if (sourceArcs.size < 2) return;

	const tangencies = constraints.filter(
		(c): c is TangentCircleCircleConstraint =>
			c instanceof TangentCircleCircleConstraint &&
			!c.isSoft &&
			!c.sharedPointId &&
			sourceArcs.has(c.circle1Id) &&
			sourceArcs.has(c.circle2Id)
	);
	if (!tangencies.length) return;

	const parents = new Map<string, string>();
	const root = (id: string): string => {
		let parent = parents.get(id);
		while (parent !== undefined) {
			const ancestor = parents.get(parent);
			if (ancestor !== undefined) parents.set(id, ancestor);
			id = parent;
			parent = ancestor;
		}
		return id;
	};
	for (const c of constraints) {
		if (!(c instanceof CoincidentConstraint) || c.isSoft) continue;
		const a = root(c.p1Id);
		const b = root(c.p2Id);
		if (a !== b) parents.set(a, b);
	}

	for (const c of tangencies) {
		const a = sketch.arcs.get(c.circle1Id);
		const b = sketch.arcs.get(c.circle2Id);
		if (!a || !b) continue;
		const aRoots = [root(a.startPointId), root(a.endPointId)];
		const shared = [b.startPointId, b.endPointId].filter(id => aRoots.includes(root(id)));
		if (shared.length !== 1 || aRoots[0] === aRoots[1]) continue;

		// Center distance has little sensitivity to sideways motion near tangency.
		// Guide the solve with collinearity while keeping the original tangency branch.
		const alignment = new TangentCircleCircleConstraint(
			`${c.id}:alignment`,
			c.circle1CenterId,
			c.circle1Id,
			c.circle2CenterId,
			c.circle2Id,
			c.isInternal,
			c.outerCircleId,
			c.weight,
			shared[0]
		);
		alignment.isSoft = true;
		constraints.push(alignment);
	}
}

const offsetSourceStates = new WeakMap<OffsetConstraint, Array<string | number | boolean | undefined>>();

export function syncOffsetSources(
	sketch: SketchDocument,
	offsets: OffsetConstraint[],
	onRecompute: () => boolean | void
): void {
	// New/restored constraints already describe their snapshot's source geometry.
	for (const c of offsets) {
		if (!offsetSourceStates.has(c)) offsetSourceStates.set(c, offsetSourceState(sketch, c));
	}
	if (onRecompute() === false || !offsets.length) return;
	// Propagate offsets of offsets, then account for source motion from solving the rebuilt geometry.
	for (let pass = 0; pass <= offsets.length && refreshOffsetSources(sketch, offsets); pass++) {
		if (onRecompute() === false) return;
	}
}

export function applyOffsetConstraintValue(sketch: SketchDocument, c: OffsetConstraint, newValue: number): boolean {
	if (c.isReference) return false;
	const value = Math.abs(newValue);
	const geom = c.sourceChain
		? calculateOffsetGeometry(sketch, c.sourceChain, c.direction || 'one_side', value, value, c.flip || false)
		: undefined;
	if (geom && !geom.isValid) return false;
	const topologyChanged = !!(geom?.isValid && geom.sides.length && !offsetTopologyMatches(sketch, c, geom.sides[0]));
	const layoutChanged = !!(
		geom?.isValid &&
		geom.sides.length &&
		geom.sides[0].primitives.some((prim, i) => {
			const pair = c.pairs[i];
			return (
				pair?.kind === 'spline' &&
				prim.fitPoints &&
				prim.fitPoints.length > (sketch.splines.get(pair.offSplineId)?.pointIds.length ?? 0)
			);
		})
	);
	const structureChanged = topologyChanged || layoutChanged;
	if (structureChanged) sketch.beginTransaction();
	try {
		c.targetDistance = value;
		c.value = value;
		c.name = 'Offset';
		if (geom?.isValid && geom.sides.length) {
			if (structureChanged) {
				sketch.withDeferredSolve(() => {
					if (topologyChanged) reconcileOffsetTopology(sketch, c, geom.sides[0]);
					applyOffsetGeometryUpdate(sketch, c, geom);
				});
			} else {
				applyOffsetGeometryUpdate(sketch, c, geom);
			}
		} else if (!c.sourceChain) {
			for (const pair of c.pairs) {
				if (pair.kind === 'spline') {
					for (const sp of pair.points) {
						moveUnfixedPoint(sketch, sp.pointId, {
							x: sp.basePos.x + sp.side * c.targetDistance * sp.normal.x,
							y: sp.basePos.y + sp.side * c.targetDistance * sp.normal.y,
						});
					}
				}
			}
		}
	} finally {
		if (structureChanged) sketch.commitTransaction();
	}
	return true;
}

function offsetSourceState(sketch: SketchDocument, c: OffsetConstraint): Array<string | number | boolean | undefined> {
	const state: Array<string | number | boolean | undefined> = [JSON.stringify(c.sourceChain)];
	for (const item of c.sourceChain.items) {
		const primitive = sketch.getPrimitive(item.id, item.type);
		state.push(primitive?.id);
		if (!primitive) continue;
		const pointIds = new Set<string>(primitive.getPointIds(sketch));
		if (item.startPointId) pointIds.add(item.startPointId);
		if (item.endPointId) pointIds.add(item.endPointId);
		for (const id of pointIds) {
			const point = sketch.points.get(id);
			state.push(id, point?.x, point?.y);
		}
		if (primitive instanceof SketchCircle || primitive instanceof SketchArc) state.push(primitive.radius);
		if (primitive instanceof SketchArc || primitive instanceof SketchEllipticalArc) state.push(primitive.clockwise);
		if (primitive instanceof SketchSpline)
			state.push(primitive.splineType, primitive.isClosed, ...(primitive.knots ?? []));
	}
	return state;
}

function refreshOffsetSources(sketch: SketchDocument, offsets: OffsetConstraint[]): boolean {
	let changed = false;
	sketch.runSilentDerivedUpdate(() => {
		for (const c of offsets) {
			if (c.isReference || sketch.constraints.get(c.id) !== c) continue;
			const state = offsetSourceState(sketch, c);
			const previous = offsetSourceStates.get(c);
			if (
				previous?.length === state.length &&
				state.every((v, i) =>
					typeof v === 'number' && typeof previous[i] === 'number'
						? Math.abs(v - previous[i]) <= 1e-8
						: v === previous[i]
				)
			) {
				continue;
			}
			offsetSourceStates.set(c, state);
			const geom = calculateOffsetGeometry(
				sketch,
				c.sourceChain,
				c.direction || 'one_side',
				c.targetDistance,
				c.targetDistance,
				c.flip || false
			);
			if (!geom.isValid || !geom.sides.length) continue;
			if (!offsetTopologyMatches(sketch, c, geom.sides[0])) reconcileOffsetTopology(sketch, c, geom.sides[0]);
			applyOffsetGeometryUpdate(sketch, c, geom);
			changed = true;
		}
	});
	return changed;
}

function offsetPairSource(pair: OffsetPair): string {
	return pair.kind === 'line' ? pair.origLineId : pair.kind === 'circle' ? pair.origId : pair.origSplineId;
}

function offsetPairEntity(pair: OffsetPair): string {
	return pair.kind === 'line' ? pair.offLineId : pair.kind === 'circle' ? pair.offId : pair.offSplineId;
}

function offsetPairEndpoints(sketch: SketchDocument, pair: OffsetPair): [string, string] | undefined {
	if (pair.kind === 'line') return [pair.offP1Id, pair.offP2Id];
	if (pair.kind === 'circle') {
		const arc = sketch.arcs.get(pair.offId);
		return arc ? [arc.startPointId, arc.endPointId] : undefined;
	}
	const spline = sketch.splines.get(pair.offSplineId);
	return spline ? [spline.pointIds[0], spline.pointIds.at(-1)!] : undefined;
}

function offsetTopologyMatches(sketch: SketchDocument, c: OffsetConstraint, side: OffsetSideGeometry): boolean {
	return (
		c.pairs.length === side.primitives.length &&
		c.pairs.every(
			(pair, i) =>
				offsetPairSource(pair) === side.primitives[i].sourceId &&
				(pair.contourIndex ?? 0) === (side.primitives[i].contourIndex ?? 0) &&
				offsetPairMatchesPrimitive(sketch, pair, side.primitives[i])
		)
	);
}

function offsetPairMatchesPrimitive(
	sketch: SketchDocument,
	pair: OffsetPair,
	prim: OffsetSideGeometry['primitives'][number]
): boolean {
	return (
		sketch.getPrimitive(offsetPairEntity(pair))?.type === prim.type &&
		(pair.kind !== 'spline' || sketch.splines.get(pair.offSplineId)?.isClosed === !!prim.isSplineClosed)
	);
}

function splitOffsetEndpoint(sketch: SketchDocument, pair: OffsetPair, start: boolean, pos: Vec2): void {
	const endpoints = offsetPairEndpoints(sketch, pair);
	if (!endpoints) return;
	const old = endpoints[start ? 0 : 1];
	const point = sketch.addPoint(pos);
	if (pair.kind === 'line') {
		const line = sketch.lines.get(pair.offLineId)!;
		if (start) {
			line.p1Id = point.id;
			pair.offP1Id = point.id;
		} else {
			line.p2Id = point.id;
			pair.offP2Id = point.id;
		}
	} else if (pair.kind === 'circle') {
		const arc = sketch.arcs.get(pair.offId)!;
		sketch.replaceArcEndpoint(arc, start ? 'start' : 'end', point.id);
	} else {
		const spline = sketch.splines.get(pair.offSplineId)!;
		const index = start ? 0 : spline.pointIds.length - 1;
		spline.pointIds[index] = point.id;
		for (const sp of pair.points) if (sp.pointId === old) sp.pointId = point.id;
		const handle = sketch.lines.get(spline.tangentLineIds?.[index] ?? '');
		if (handle) {
			for (const constraint of sketch.constraints.values()) {
				if (
					constraint instanceof MidpointConstraint &&
					constraint.midId === old &&
					constraint.p1Id === handle.p1Id &&
					constraint.p2Id === handle.p2Id
				) {
					sketch.constraints.set(
						constraint.id,
						new MidpointConstraint(
							constraint.id,
							point.id,
							constraint.p1Id,
							constraint.p2Id,
							constraint.weight,
							constraint.ratio
						)
					);
				}
			}
		}
	}
}

function reconcileOffsetTopology(sketch: SketchDocument, c: OffsetConstraint, side: OffsetSideGeometry): void {
	const oldPairs = new Map<string, OffsetPair[]>();
	for (const pair of c.pairs) {
		const source = offsetPairSource(pair);
		oldPairs.set(source, [...(oldPairs.get(source) ?? []), pair]);
	}
	const dimPair = c.pairs[c.dimPairIndex];
	for (const id of c.junctionConstraintIds ?? []) sketch.constraints.delete(id);
	c.junctionConstraintIds = [];
	// Deleting a vanished child must not remove its own dimension or its surviving siblings.
	sketch.constraints.delete(c.id);
	try {
		c.pairs = side.primitives.map(prim => {
			const candidates = oldPairs.get(prim.sourceId) ?? [];
			const compatible = (pair: OffsetPair) => offsetPairMatchesPrimitive(sketch, pair, prim);
			let index = candidates.findIndex(
				pair => compatible(pair) && (pair.contourIndex ?? 0) === (prim.contourIndex ?? 0)
			);
			if (index < 0) index = candidates.findIndex(compatible);
			if (index >= 0) {
				const existing = candidates.splice(index, 1)[0];
				if (prim.contourIndex) existing.contourIndex = prim.contourIndex;
				else delete existing.contourIndex;
				return existing;
			}
			const built = createOffsetSideGeometry(
				sketch,
				{ ...c.sourceChain, isClosed: false },
				{ ...side, primitives: [prim] }
			);
			if (!built.offsetPairs[0]) throw new Error('Cannot restore an offset primitive');
			return built.offsetPairs[0];
		});
		for (const pairs of oldPairs.values()) {
			for (const pair of pairs) sketch.removeEntity(offsetPairEntity(pair));
		}
		// A restored feature can separate two endpoints that used to be one shared vertex.
		const assigned = new Map<string, Vec2>();
		for (let i = 0; i < c.pairs.length; i++) {
			const prim = side.primitives[i];
			const pair = c.pairs[i];
			const ends = offsetPairEndpoints(sketch, pair);
			if (!ends) continue;
			const positions =
				prim.type === 'line'
					? [prim.p1!, prim.p2!]
					: prim.type === 'arc'
						? [prim.start!, prim.end!]
						: [prim.fitPoints![0], prim.fitPoints!.at(-1)!];
			for (let end = 0; end < 2; end++) {
				const prev = assigned.get(ends[end]);
				if (prev && prev.distanceTo(positions[end]) > 1e-7)
					splitOffsetEndpoint(sketch, pair, end === 0, positions[end]);
				else assigned.set(ends[end], positions[end]);
			}
		}
		const endpoints = c.pairs.map(pair => offsetPairEndpoints(sketch, pair));
		for (let start = 0; start < endpoints.length; ) {
			let end = start + 1;
			while (
				end < endpoints.length &&
				(side.primitives[end].contourIndex ?? 0) === (side.primitives[start].contourIndex ?? 0)
			) {
				end++;
			}
			const count = c.sourceChain?.isClosed ? end : end - 1;
			for (let i = start; i < count; i++) {
				if (side.primitives[i].isSplineClosed) continue;
				const a = endpoints[i]?.[1];
				const b = endpoints[i + 1 < end ? i + 1 : start]?.[0];
				if (!a || !b || a === b) continue;
				const join = new CoincidentConstraint(sketch.nextId('c_coinc'), a, b);
				sketch.constraints.set(join.id, join);
				c.junctionConstraintIds.push(join.id);
			}
			start = end;
		}
		c.cornerPointIds = endpoints.flatMap((p, i) => (p && !side.primitives[i].isSplineClosed ? [p[0]] : []));
		if (!c.sourceChain?.isClosed && endpoints.at(-1)) c.cornerPointIds.push(endpoints.at(-1)![1]);
		c.dimPairIndex = Math.max(0, c.pairs.indexOf(dimPair));
		c.entityIds = [
			...new Set([
				...new OffsetConstraint(c.id, c.pairs, c.targetDistance).entityIds,
				...(c.sourceChain?.items ?? []).map((item: { id: string }) => item.id),
			]),
		];
	} finally {
		sketch.constraints.set(c.id, c);
	}
	sketch.rebuildParamManager();
}

function growOffsetSpline(
	sketch: SketchDocument,
	c: OffsetConstraint,
	pair: Extract<OffsetPair, { kind: 'spline' }>,
	prim: OffsetSideGeometry['primitives'][number]
): void {
	const spline = sketch.splines.get(pair.offSplineId)!;
	while (spline.pointIds.length < prim.fitPoints!.length) {
		const index = spline.pointIds.length - 1;
		const p = prim.fitPoints![index];
		const h = prim.handles![index];
		const point = new SketchPoint(sketch.nextId('Point'), p.x, p.y, false);
		sketch.points.set(point.id, point);
		const { lineId } = createFitSplineHandle(sketch, spline.id, point, h.h1, h.h2, false);
		spline.pointIds.splice(index, 0, point.id);
		spline.tangentLineIds!.splice(index, 0, lineId);
		pair.points.push({
			pointId: point.id,
			basePos: prim.fitBases![index],
			normal: prim.fitNormals![index],
			side: c.flip ? -1 : 1,
		});
	}
	c.entityIds = new OffsetConstraint(c.id, c.pairs, c.targetDistance, 0, 1, c.sourceChain).entityIds;
	sketch.rebuildParamManager();
}

function applyOffsetGeometryUpdate(sketch: SketchDocument, c: OffsetConstraint, geom: OffsetGeometryResult): void {
	if (!geom.sides || !geom.sides.length) return;
	const side = geom.sides[0];
	const numPrims = side.primitives.length;
	if (!numPrims) {
		c.emptyDimension = {
			anchor: Vec2.from(geom.gizmoAnchor),
			normal: Vec2.from(geom.gizmoNormal).multiplyScalar(side.side),
		};
	} else {
		delete c.emptyDimension;
	}

	// Every primitive updates its own endpoints, including shared vertices within a contour.
	for (let i = 0; i < numPrims; i++) {
		const prim = side.primitives[i];
		const pair = c.pairs[i];
		if (!pair) continue;

		if (pair.kind === 'line') {
			if (prim.p1 && prim.p2) {
				moveUnfixedPoint(sketch, pair.offP1Id, prim.p1);
				moveUnfixedPoint(sketch, pair.offP2Id, prim.p2);
			}
		} else if (pair.kind === 'circle') {
			const circ = sketch.circles.get(pair.offId);
			if (circ && prim.circleRadius) circ.radius = prim.circleRadius;
			const arc = sketch.arcs.get(pair.offId);
			if (arc && prim.radius) arc.radius = prim.radius;
			if (arc && prim.start && prim.end) {
				moveUnfixedPoint(sketch, arc.startPointId, prim.start);
				moveUnfixedPoint(sketch, arc.endPointId, prim.end);
			}
		} else if (pair.kind === 'spline') {
			const spline = sketch.splines.get(pair.offSplineId);
			if (spline && prim.fitPoints) {
				if (prim.fitPoints.length > spline.pointIds.length) growOffsetSpline(sketch, c, pair, prim);
				const ptsCount = spline.pointIds.length;
				resizeOffsetSpline(prim, ptsCount, side.side * side.distance);
				// Closed seams share one point ID; creation stores the first branch's basis.
				const sampleById = new Map<string, number>();
				for (const [k, id] of spline.pointIds.entries()) if (!sampleById.has(id)) sampleById.set(id, k);
				for (const sp of pair.points) {
					const k = sampleById.get(sp.pointId);
					if (k !== undefined && prim.fitBases?.[k] && prim.fitNormals?.[k]) {
						sp.basePos = prim.fitBases[k];
						sp.normal = prim.fitNormals[k];
						sp.side = side.side;
					}
				}
				for (let k = 0; k < ptsCount; k++) {
					if (prim.fitPoints[k]) moveUnfixedPoint(sketch, spline.pointIds[k], prim.fitPoints[k]);
				}
				// Update tangent handle points
				const fitPts = spline.pointIds.map(pid => sketch.points.get(pid)).filter((p): p is SketchPoint => !!p);
				if (fitPts.length >= 2 && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
					const handles = prim.handles || computeNaturalFitHandles(fitPts);
					const midpoints = new Map(
						[...sketch.constraints.values()]
							.filter((mc): mc is MidpointConstraint => mc instanceof MidpointConstraint)
							.map(mc => [`${mc.p1Id}:${mc.p2Id}`, mc])
					);
					for (let h = 0; h < spline.tangentLineIds.length; h++) {
						const tLine = sketch.lines.get(spline.tangentLineIds[h]);
						if (tLine && handles[h]) {
							const mid = midpoints.get(`${tLine.p1Id}:${tLine.p2Id}`);
							const a = fitPts[h].distanceTo(handles[h].h1);
							const b = fitPts[h].distanceTo(handles[h].h2);
							const ratio = a + b > 1e-12 ? a / (a + b) : 0.5;
							if (mid && Math.abs(mid.ratio - ratio) > 1e-12) {
								sketch.constraints.set(
									mid.id,
									new MidpointConstraint(mid.id, mid.midId, mid.p1Id, mid.p2Id, mid.weight, ratio)
								);
							}
							moveUnfixedPoint(sketch, tLine.p1Id, handles[h].h1);
							moveUnfixedPoint(sketch, tLine.p2Id, handles[h].h2);
						}
					}
				}
			}
		}
	}
}

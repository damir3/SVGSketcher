import type { SketchDocument } from '../model/sketch';
import type { SketchPoint } from '../model/types';
import { CoincidentConstraint } from '../solver/constraints';
import { Vec2 } from './vector';
import { getGeometryKernel } from '../kernel';
import * as reference from './offsetReference';
import { refineSplineOffsets } from './offsetSpline';
import type { OffsetKernelItem, KernelOffsetPrimitive, OffsetDirection } from '../kernel/offsetTypes';
import { OffsetConstraint, type OffsetPair, type OffsetSplinePoint } from '../solver/constraints/offset';

export type { OffsetDirection } from '../kernel/offsetTypes';

export interface ChainItem {
	id: string;
	type: 'line' | 'arc' | 'spline' | 'circle' | 'ellipse' | 'elliptical_arc';
	startPointId?: string;
	endPointId?: string;
	reversed?: boolean;
}

export interface OffsetChain {
	items: ChainItem[];
	isClosed: boolean;
	firstSelectedId?: string;
}

export interface OffsetPrimitiveGeom {
	sourceId: string;
	type: 'line' | 'arc' | 'circle' | 'spline';
	// Line
	p1?: Vec2;
	p2?: Vec2;
	// Arc
	center?: Vec2;
	start?: Vec2;
	end?: Vec2;
	radius?: number;
	clockwise?: boolean;
	// Circle
	circleCenter?: Vec2;
	circleRadius?: number;
	// Spline
	fitPoints?: Vec2[];
	fitBases?: Vec2[];
	fitNormals?: Vec2[];
	startTangent?: Vec2;
	endTangent?: Vec2;
	handles?: Array<{ h1: Vec2; h2: Vec2 }>;
	isSplineClosed?: boolean;
}

export interface OffsetSideGeometry {
	primitives: OffsetPrimitiveGeom[];
	side: number;
	distance: number;
	isValid: boolean;
	errorMessage?: string;
}

export interface OffsetGeometryResult {
	sides: OffsetSideGeometry[];
	gizmoAnchor: Vec2;
	gizmoNormal: Vec2;
	isValid: boolean;
	errorMessage?: string;
}

/**
 * Returns all point IDs that are topologically coincident with `startPointId`
 * by traversing CoincidentConstraint relationships.
 */
export function getCoincidentPointGroup(sketch: SketchDocument, startPointId: string): Set<string> {
	const group = new Set<string>([startPointId]);
	const queue = [startPointId];
	while (queue.length > 0) {
		const curr = queue.pop()!;
		for (const c of sketch.constraints.values()) {
			if (c instanceof CoincidentConstraint) {
				if (c.p1Id === curr && !group.has(c.p2Id)) {
					group.add(c.p2Id);
					queue.push(c.p2Id);
				} else if (c.p2Id === curr && !group.has(c.p1Id)) {
					group.add(c.p1Id);
					queue.push(c.p1Id);
				}
			}
		}
	}
	return group;
}

/**
 * Gets open boundary endpoints of a primitive.
 * Returns null for closed shapes (circle, full ellipse, closed spline).
 */
export function getPrimitiveEndpoints(
	sketch: SketchDocument,
	type: string,
	id: string
): { p1Id: string; p2Id: string } | null {
	if (type === 'line') {
		const l = sketch.lines.get(id);
		if (!l || l.isSplineHandle) return null;
		return { p1Id: l.p1Id, p2Id: l.p2Id };
	}
	if (type === 'arc') {
		const a = sketch.arcs.get(id);
		if (!a) return null;
		return { p1Id: a.startPointId, p2Id: a.endPointId };
	}
	if (type === 'elliptical_arc') {
		const ea = sketch.ellipticalArcs.get(id);
		if (!ea) return null;
		return { p1Id: ea.startPointId, p2Id: ea.endPointId };
	}
	if (type === 'spline') {
		const s = sketch.splines.get(id);
		if (!s || s.isClosed || s.pointIds.length < 2) return null;
		return { p1Id: s.pointIds[0], p2Id: s.pointIds[s.pointIds.length - 1] };
	}
	return null;
}

/**
 * Finds all other primitives connected to a given vertex (equivalence class of points).
 */
export function getConnectedPrimitivesAtVertex(
	sketch: SketchDocument,
	pointId: string,
	excludePrimitiveId?: string
): Array<{ id: string; type: ChainItem['type']; connectedPointId: string; otherPointId: string }> {
	const pGroup = getCoincidentPointGroup(sketch, pointId);
	const res: Array<{
		id: string;
		type: ChainItem['type'];
		connectedPointId: string;
		otherPointId: string;
	}> = [];

	const check = (type: ChainItem['type'], id: string, p1Id: string, p2Id: string) => {
		if (id === excludePrimitiveId) return;
		const in1 = pGroup.has(p1Id);
		const in2 = pGroup.has(p2Id);
		if (in1 && !in2) {
			res.push({ id, type, connectedPointId: p1Id, otherPointId: p2Id });
		} else if (in2 && !in1) {
			res.push({ id, type, connectedPointId: p2Id, otherPointId: p1Id });
		}
	};

	for (const l of sketch.lines.values()) {
		if (l.isSplineHandle || l.isConstruction) continue;
		check('line', l.id, l.p1Id, l.p2Id);
	}
	for (const a of sketch.arcs.values()) {
		if (a.isConstruction) continue;
		check('arc', a.id, a.startPointId, a.endPointId);
	}
	for (const ea of sketch.ellipticalArcs.values()) {
		if (ea.isConstruction) continue;
		check('elliptical_arc', ea.id, ea.startPointId, ea.endPointId);
	}
	for (const s of sketch.splines.values()) {
		if (s.isConstruction || s.isClosed || s.pointIds.length < 2) continue;
		check('spline', s.id, s.pointIds[0], s.pointIds[s.pointIds.length - 1]);
	}

	return res;
}

/**
 * Returns set of IDs of all primitives that can continue the chain on hover.
 */
export function getValidChainContinuations(sketch: SketchDocument, chain: OffsetChain | null): Set<string> {
	const valid = new Set<string>();

	if (!chain || chain.items.length === 0) {
		// All non-construction, non-spline-handle curves can initiate a chain
		for (const l of sketch.lines.values()) if (!l.isSplineHandle && !l.isConstruction) valid.add(l.id);
		for (const a of sketch.arcs.values()) if (!a.isConstruction) valid.add(a.id);
		for (const c of sketch.circles.values()) if (!c.isConstruction) valid.add(c.id);
		for (const e of sketch.ellipses.values()) if (!e.isConstruction) valid.add(e.id);
		for (const ea of sketch.ellipticalArcs.values()) if (!ea.isConstruction) valid.add(ea.id);
		for (const s of sketch.splines.values()) if (!s.isConstruction) valid.add(s.id);
		return valid;
	}

	if (chain.isClosed) {
		// Closed chain cannot be extended further
		return valid;
	}

	const existingIds = new Set(chain.items.map(it => it.id));
	const head = chain.items[0];
	const tail = chain.items[chain.items.length - 1];

	if (head.startPointId) {
		const headConn = getConnectedPrimitivesAtVertex(sketch, head.startPointId);
		for (const c of headConn) {
			if (!existingIds.has(c.id)) valid.add(c.id);
		}
	}

	if (tail.endPointId) {
		const tailConn = getConnectedPrimitivesAtVertex(sketch, tail.endPointId);
		for (const c of tailConn) {
			if (!existingIds.has(c.id)) valid.add(c.id);
		}
	}

	return valid;
}

/**
 * Deselects a primitive or connected subsegment from the chain.
 */
export function deselectChainSegment(
	sketch: SketchDocument,
	chain: OffsetChain,
	primitiveId: string,
	chainSelection: boolean
): OffsetChain | null {
	if (!chainSelection || chain.items.length <= 1) {
		const remaining = chain.items.filter(it => it.id !== primitiveId);
		if (remaining.length === 0) return null;
		const firstSelectedId = remaining.some(it => it.id === chain.firstSelectedId)
			? chain.firstSelectedId
			: remaining[0]?.id;
		return { items: remaining, isClosed: false, firstSelectedId };
	}

	// chainSelection = true:
	// Find all primitives connected to primitiveId in chain traversing through degree-2 vertices
	const toRemove = new Set<string>([primitiveId]);
	const idx = chain.items.findIndex(it => it.id === primitiveId);
	if (idx === -1) return chain;

	const n = chain.items.length;

	// Traverse forward along chain
	let currIdx = idx;
	while (true) {
		const curr = chain.items[currIdx];
		const nextIdx = (currIdx + 1) % n;
		if (nextIdx === idx || toRemove.has(chain.items[nextIdx].id)) break;
		const vPtId = curr.endPointId;
		if (!vPtId) break;
		const conn = getConnectedPrimitivesAtVertex(sketch, vPtId);
		if (conn.length !== 2) break; // fork or open end! stop here
		toRemove.add(chain.items[nextIdx].id);
		currIdx = nextIdx;
		if (!chain.isClosed && currIdx === n - 1) break;
	}

	// Traverse backward along chain
	currIdx = idx;
	while (true) {
		const curr = chain.items[currIdx];
		const prevIdx = (currIdx - 1 + n) % n;
		if (prevIdx === idx || toRemove.has(chain.items[prevIdx].id)) break;
		const prev = chain.items[prevIdx];
		const vPtId = prev.endPointId || curr.startPointId;
		if (!vPtId) break;
		const conn = getConnectedPrimitivesAtVertex(sketch, vPtId);
		if (conn.length !== 2) break; // fork or open end! stop here
		toRemove.add(chain.items[prevIdx].id);
		currIdx = prevIdx;
		if (!chain.isClosed && currIdx === 0) break;
	}

	const remaining = chain.items.filter(it => !toRemove.has(it.id));
	if (remaining.length === 0) return null;
	const firstSelectedId = remaining.some(it => it.id === chain.firstSelectedId)
		? chain.firstSelectedId
		: remaining[0]?.id;
	return { items: remaining, isClosed: false, firstSelectedId };
}

/**
 * Builds or extends a chain when a primitive is clicked.
 */
export function toggleOrExtendChain(
	sketch: SketchDocument,
	currentChain: OffsetChain | null,
	primitiveId: string,
	primitiveType: ChainItem['type'],
	chainSelection: boolean
): OffsetChain | null {
	// If clicking already selected primitive: deselect / clear
	if (currentChain && currentChain.items.some(it => it.id === primitiveId)) {
		return deselectChainSegment(sketch, currentChain, primitiveId, chainSelection);
	}

	// 1. Initial selection (chain is empty)
	if (!currentChain || currentChain.items.length === 0) {
		// Single closed entities
		if (primitiveType === 'circle' || primitiveType === 'ellipse') {
			return {
				items: [{ id: primitiveId, type: primitiveType }],
				isClosed: true,
				firstSelectedId: primitiveId,
			};
		}
		if (primitiveType === 'spline') {
			const s = sketch.splines.get(primitiveId);
			if (s?.isClosed) {
				return {
					items: [{ id: primitiveId, type: 'spline' }],
					isClosed: true,
					firstSelectedId: primitiveId,
				};
			}
		}

		const endpoints = getPrimitiveEndpoints(sketch, primitiveType, primitiveId);
		if (!endpoints) return null;

		const startItem: ChainItem = {
			id: primitiveId,
			type: primitiveType,
			startPointId: endpoints.p1Id,
			endPointId: endpoints.p2Id,
			reversed: false,
		};

		if (!chainSelection) {
			return { items: [startItem], isClosed: false, firstSelectedId: primitiveId };
		}

		// Auto-traverse along both directions
		const chainItems = [startItem];
		let isClosed = false;

		// Traverse forward from endPointId
		let currEndPt = startItem.endPointId!;
		let prevPrimId = startItem.id;
		while (true) {
			const conn = getConnectedPrimitivesAtVertex(sketch, currEndPt, prevPrimId);
			if (conn.length !== 1) break; // Ambiguity or boundary
			const next = conn[0];
			if (chainItems.some(it => it.id === next.id)) {
				// Connected back to existing chain
				const headPtGroup = getCoincidentPointGroup(sketch, chainItems[0].startPointId!);
				if (headPtGroup.has(next.connectedPointId) || headPtGroup.has(next.otherPointId)) {
					isClosed = true;
				}
				break;
			}
			const ep = getPrimitiveEndpoints(sketch, next.type, next.id);
			const isRev = ep ? getCoincidentPointGroup(sketch, next.connectedPointId).has(ep.p2Id) : false;
			const nextItem: ChainItem = {
				id: next.id,
				type: next.type,
				startPointId: next.connectedPointId,
				endPointId: next.otherPointId,
				reversed: isRev,
			};
			chainItems.push(nextItem);
			prevPrimId = next.id;
			currEndPt = next.otherPointId;

			// Check if we reached the start of the chain (loop closed)
			const headGroup = getCoincidentPointGroup(sketch, chainItems[0].startPointId!);
			if (headGroup.has(currEndPt)) {
				isClosed = true;
				break;
			}
		}

		// If not closed, traverse backward from startPointId
		if (!isClosed) {
			let currStartPt = chainItems[0].startPointId!;
			let prevBackwardId = chainItems[0].id;
			while (true) {
				const conn = getConnectedPrimitivesAtVertex(sketch, currStartPt, prevBackwardId);
				if (conn.length !== 1) break;
				const prev = conn[0];
				if (chainItems.some(it => it.id === prev.id)) break;
				const prevItem: ChainItem = {
					id: prev.id,
					type: prev.type,
					startPointId: prev.otherPointId,
					endPointId: prev.connectedPointId,
					reversed: true,
				};
				chainItems.unshift(prevItem);
				prevBackwardId = prev.id;
				currStartPt = prev.otherPointId;

				const tailGroup = getCoincidentPointGroup(sketch, chainItems[chainItems.length - 1].endPointId!);
				if (tailGroup.has(currStartPt)) {
					isClosed = true;
					break;
				}
			}
		}

		return { items: chainItems, isClosed, firstSelectedId: primitiveId };
	}

	// 2. Extending an existing open chain
	if (currentChain.isClosed) return currentChain; // Cannot extend closed chain

	const endpoints = getPrimitiveEndpoints(sketch, primitiveType, primitiveId);
	if (!endpoints) return currentChain;

	const head = currentChain.items[0];
	const tail = currentChain.items[currentChain.items.length - 1];
	const headGroup = getCoincidentPointGroup(sketch, head.startPointId!);
	const tailGroup = getCoincidentPointGroup(sketch, tail.endPointId!);

	const connectsToTailAsStart = tailGroup.has(endpoints.p1Id);
	const connectsToTailAsEnd = tailGroup.has(endpoints.p2Id);
	const connectsToHeadAsEnd = headGroup.has(endpoints.p2Id);
	const connectsToHeadAsStart = headGroup.has(endpoints.p1Id);

	if (!connectsToTailAsStart && !connectsToTailAsEnd && !connectsToHeadAsEnd && !connectsToHeadAsStart) {
		return currentChain; // Not connected to either end
	}

	const newItems = [...currentChain.items];
	let isClosed = false;

	if (connectsToTailAsStart || connectsToTailAsEnd) {
		const attachStart = connectsToTailAsStart ? endpoints.p1Id : endpoints.p2Id;
		const attachEnd = connectsToTailAsStart ? endpoints.p2Id : endpoints.p1Id;
		const item: ChainItem = {
			id: primitiveId,
			type: primitiveType,
			startPointId: attachStart,
			endPointId: attachEnd,
			reversed: !connectsToTailAsStart,
		};
		newItems.push(item);

		// Check if this closed the chain
		if (headGroup.has(attachEnd)) {
			isClosed = true;
		} else if (chainSelection) {
			// Continue traversing forward
			let currEndPt = attachEnd;
			let prevId = primitiveId;
			while (true) {
				const conn = getConnectedPrimitivesAtVertex(sketch, currEndPt, prevId);
				if (conn.length !== 1) break;
				const next = conn[0];
				if (newItems.some(it => it.id === next.id)) break;
				const ep = getPrimitiveEndpoints(sketch, next.type, next.id);
				const isRev = ep ? getCoincidentPointGroup(sketch, next.connectedPointId).has(ep.p2Id) : false;
				const nextItem: ChainItem = {
					id: next.id,
					type: next.type,
					startPointId: next.connectedPointId,
					endPointId: next.otherPointId,
					reversed: isRev,
				};
				newItems.push(nextItem);
				prevId = next.id;
				currEndPt = next.otherPointId;
				if (headGroup.has(currEndPt)) {
					isClosed = true;
					break;
				}
			}
		}
	} else {
		// Connects to head
		const attachStart = connectsToHeadAsEnd ? endpoints.p1Id : endpoints.p2Id;
		const attachEnd = connectsToHeadAsEnd ? endpoints.p2Id : endpoints.p1Id;
		const item: ChainItem = {
			id: primitiveId,
			type: primitiveType,
			startPointId: attachStart,
			endPointId: attachEnd,
			reversed: !connectsToHeadAsEnd,
		};
		newItems.unshift(item);

		if (tailGroup.has(attachStart)) {
			isClosed = true;
		} else if (chainSelection) {
			// Continue traversing backward
			let currStartPt = attachStart;
			let prevId = primitiveId;
			while (true) {
				const conn = getConnectedPrimitivesAtVertex(sketch, currStartPt, prevId);
				if (conn.length !== 1) break;
				const prev = conn[0];
				if (newItems.some(it => it.id === prev.id)) break;
				const prevItem: ChainItem = {
					id: prev.id,
					type: prev.type,
					startPointId: prev.otherPointId,
					endPointId: prev.connectedPointId,
					reversed: true,
				};
				newItems.unshift(prevItem);
				prevId = prev.id;
				currStartPt = prev.otherPointId;
				if (tailGroup.has(currStartPt)) {
					isClosed = true;
					break;
				}
			}
		}
	}

	return {
		items: newItems,
		isClosed,
		firstSelectedId: currentChain.firstSelectedId || currentChain.items[0]?.id,
	};
}

export { intersectLines2D } from './offsetReference';

export function calculateOffsetGeometry(
	sketch: SketchDocument,
	chain: OffsetChain,
	direction: OffsetDirection,
	dist1: number,
	dist2: number,
	flip: boolean
): OffsetGeometryResult {
	const api = getGeometryKernel().offset;
	const items = (chain?.items ?? []).map(item => collectOffsetItem(sketch, item));
	const selected = chain?.firstSelectedId || chain?.items[0]?.id;
	const ref = Math.max(
		0,
		items.findIndex(item => item.sourceId === selected)
	);
	const result = api
		? api.calculate(items, !!chain?.isClosed, items.length ? ref : -1, direction, dist1, dist2, flip)
		: refineSplineOffsets(
				items,
				reference.calculateOffsetGeometry(sketch, chain, direction, dist1, dist2, flip),
				!!chain?.isClosed
			);
	return {
		...result,
		gizmoAnchor: Vec2.from(result.gizmoAnchor),
		gizmoNormal: Vec2.from(result.gizmoNormal),
		sides: result.sides.map(side => ({ ...side, primitives: side.primitives.map(hydrateOffsetPrimitive) })),
	};
}

function hydrateOffsetPrimitive(primitive: KernelOffsetPrimitive): OffsetPrimitiveGeom {
	const result = { ...primitive };
	for (const key of ['p1', 'p2', 'center', 'start', 'end', 'circleCenter', 'startTangent', 'endTangent'] as const) {
		const p = primitive[key];
		if (p) result[key] = Vec2.from(p);
	}
	for (const key of ['fitPoints', 'fitBases', 'fitNormals'] as const)
		if (primitive[key]) result[key] = primitive[key].map(Vec2.from);
	if (primitive.handles) result.handles = primitive.handles.map(h => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }));
	return result as OffsetPrimitiveGeom;
}

function collectOffsetItem(sketch: SketchDocument, item: ChainItem): OffsetKernelItem {
	const result: OffsetKernelItem = { sourceId: item.id, kind: item.type, curve: null };
	if (item.type === 'spline') {
		const spline = sketch.splines.get(item.id);
		if (!spline || spline.pointIds.length < 2) return result;
		result.curve = spline.toGeoCurve(sketch);
		result.reversed =
			!!item.reversed ||
			!!(item.startPointId && getCoincidentPointGroup(sketch, item.startPointId).has(spline.pointIds.at(-1)!));
		result.endpointReversed = !!item.reversed || (!spline.isClosed && result.reversed);
		return result;
	}
	if (item.type === 'line') {
		const line = sketch.lines.get(item.id);
		const p1 = line && sketch.points.get(item.startPointId || line.p1Id),
			p2 = line && sketch.points.get(item.endPointId || line.p2Id);
		if (p1 && p2) result.curve = { id: item.id, type: 'segment', p1, p2 };
	} else if (item.type === 'circle') {
		const circle = sketch.circles.get(item.id),
			center = circle && sketch.points.get(circle.centerId);
		if (circle && center) result.curve = { id: item.id, type: 'circle', center, radius: circle.radius };
	} else if (item.type === 'arc') {
		const arc = sketch.arcs.get(item.id);
		const center = arc && sketch.points.get(arc.centerId),
			start = arc && sketch.points.get(item.startPointId || arc.startPointId),
			end = arc && sketch.points.get(item.endPointId || arc.endPointId);
		if (arc && center && start && end)
			result.curve = {
				id: item.id,
				type: 'arc',
				center,
				start,
				end,
				radius: arc.radius,
				clockwise: item.startPointId === arc.endPointId ? !arc.clockwise : !!arc.clockwise,
			};
		result.gizmoClockwise = !!arc?.clockwise;
	} else {
		const ellipse = item.type === 'ellipse' ? sketch.ellipses.get(item.id) : sketch.ellipticalArcs.get(item.id);
		const center = ellipse && sketch.points.get(ellipse.centerId),
			majorAxisPoint = ellipse && sketch.points.get(ellipse.majorAxisPointId),
			minorAxisPoint = ellipse && sketch.points.get(ellipse.minorAxisPointId);
		if (ellipse && center && majorAxisPoint && minorAxisPoint) {
			if (item.type === 'ellipse')
				result.curve = { id: item.id, type: 'ellipse', center, majorAxisPoint, minorAxisPoint };
			else {
				const arc = sketch.ellipticalArcs.get(item.id)!;
				const start = sketch.points.get(item.startPointId || arc.startPointId),
					end = sketch.points.get(item.endPointId || arc.endPointId);
				if (start && end)
					result.curve = {
						id: item.id,
						type: 'elliptical_arc',
						center,
						majorAxisPoint,
						minorAxisPoint,
						start,
						end,
						clockwise: item.startPointId === arc.endPointId ? !arc.clockwise : !!arc.clockwise,
					};
				result.gizmoClockwise = !!arc.clockwise;
			}
		}
	}
	return result;
}

/** Shared vertices, including the final endpoint of an open offset chain. */
export function getOffsetCornerPoint(primitives: OffsetPrimitiveGeom[], index: number): Vec2 | undefined {
	const atEnd = index === primitives.length;
	const primitive = primitives[Math.min(index, primitives.length - 1)];
	if (!primitive) return undefined;
	if (primitive.type === 'line') return atEnd ? primitive.p2 : primitive.p1;
	if (primitive.type === 'arc') return atEnd ? primitive.end : primitive.start;
	return atEnd ? primitive.fitPoints?.at(-1) : primitive.fitPoints?.[0];
}

/** Build a side without opening a transaction or solving; also used to restore collapsed features. */
export function createOffsetSideGeometry(sketch: SketchDocument, chain: OffsetChain, side: OffsetSideGeometry) {
	// A split closed spline yields independent loops, each with its own seam and handles.
	if (side.primitives.length > 1 && side.primitives.every(p => p.type === 'spline' && p.isSplineClosed)) {
		const contours = side.primitives.map(prim =>
			createOffsetSideGeometry(sketch, chain, { ...side, primitives: [prim] })
		);
		return {
			createdIds: contours.flatMap(c => c.createdIds),
			offsetPairs: contours.flatMap(c => c.offsetPairs),
			cornerPointIds: contours.flatMap(c => c.cornerPointIds),
		};
	}
	const createdIds: string[] = [];
	const offsetPairs: OffsetPair[] = [];
	const cornerPoints: SketchPoint[] = [];

	// For lines and arcs meeting in a loop or chain, create shared vertices
	const numPrims = side.primitives.length;
	if (numPrims > 1) {
		const cornerCount = chain.isClosed ? numPrims : numPrims + 1;
		for (let i = 0; i < cornerCount; i++) {
			const pt = getOffsetCornerPoint(side.primitives, i) || new Vec2(0, 0);
			cornerPoints.push(sketch.addPoint(pt));
		}
	}

	for (let i = 0; i < numPrims; i++) {
		const prim = side.primitives[i];

		if (prim.type === 'circle') {
			const centerPt = sketch.addPoint(prim.circleCenter!);
			const circle = sketch.addCircle(centerPt.id, prim.circleRadius!);
			createdIds.push(circle.id);

			const origC = sketch.circles.get(prim.sourceId);
			if (origC) {
				const cSide = (prim.circleRadius ?? circle.radius) >= origC.radius ? 1 : -1;
				offsetPairs.push({
					kind: 'circle',
					origId: origC.id,
					origCenterId: origC.centerId,
					offId: circle.id,
					offCenterId: circle.centerId,
					side: cSide,
				});
			}
		} else if (prim.type === 'line') {
			let p1: SketchPoint;
			let p2: SketchPoint;
			if (numPrims > 1) {
				p1 = cornerPoints[i];
				p2 = cornerPoints[(i + 1) % cornerPoints.length];
			} else {
				p1 = sketch.addPoint(prim.p1!);
				p2 = sketch.addPoint(prim.p2!);
			}
			const line = sketch.addLine(p1.id, p2.id);
			createdIds.push(line.id);

			const origLine = sketch.lines.get(prim.sourceId);
			if (origLine) {
				const op1 = sketch.points.get(origLine.p1Id);
				const op2 = sketch.points.get(origLine.p2Id);
				let lineSide = 1;
				if (op1 && op2 && prim.p1) {
					const dir = new Vec2().subVectors(op2, op1).normalizeOrNull(1e-9);
					const hLeft = dir ? dir.cross(new Vec2().subVectors(prim.p1, op1)) : 0;
					lineSide = hLeft >= 0 ? 1 : -1;
				}
				offsetPairs.push({
					kind: 'line',
					origLineId: origLine.id,
					origP1Id: origLine.p1Id,
					origP2Id: origLine.p2Id,
					offLineId: line.id,
					offP1Id: line.p1Id,
					offP2Id: line.p2Id,
					side: lineSide,
				});
			}
		} else if (prim.type === 'arc') {
			const centerPt = sketch.addPoint(prim.center!);
			let pStart: SketchPoint;
			let pEnd: SketchPoint;
			if (numPrims > 1) {
				pStart = cornerPoints[i];
				pEnd = cornerPoints[(i + 1) % cornerPoints.length];
			} else {
				pStart = sketch.addPoint(prim.start!);
				pEnd = sketch.addPoint(prim.end!);
			}
			const arc = sketch.addArc(centerPt.id, pStart.id, pEnd.id, prim.radius!, !!prim.clockwise);
			createdIds.push(arc.id);

			const origArc = sketch.arcs.get(prim.sourceId);
			if (origArc) {
				const aSide = (prim.radius ?? arc.radius) >= origArc.radius ? 1 : -1;
				offsetPairs.push({
					kind: 'circle',
					origId: origArc.id,
					origCenterId: origArc.centerId,
					offId: arc.id,
					offCenterId: arc.centerId,
					side: aSide,
				});
			}
		} else if (prim.type === 'spline') {
			const ptIds: string[] = [];
			const splinePoints: OffsetSplinePoint[] = [];
			if (numPrims > 1) {
				ptIds.push(cornerPoints[i].id);
				for (let k = 1; k < prim.fitPoints!.length - 1; k++) {
					const pt = prim.fitPoints![k];
					const sp = sketch.addPoint(pt);
					ptIds.push(sp.id);
					if (prim.fitBases && prim.fitNormals) {
						splinePoints.push({
							pointId: sp.id,
							basePos: prim.fitBases[k],
							normal: prim.fitNormals[k],
							side: side.side,
						});
					}
				}
				const endCorner = cornerPoints[(i + 1) % cornerPoints.length];
				ptIds.push(endCorner.id);
			} else {
				for (let k = 0; k < prim.fitPoints!.length; k++) {
					const pt = prim.fitPoints![k];
					if (prim.isSplineClosed && k === prim.fitPoints!.length - 1 && pt.distanceTo(prim.fitPoints![0]) < 1e-4) {
						ptIds.push(ptIds[0]);
						continue;
					}
					const sp = sketch.addPoint(pt);
					ptIds.push(sp.id);
					if (prim.fitBases && prim.fitNormals) {
						splinePoints.push({
							pointId: sp.id,
							basePos: prim.fitBases[k],
							normal: prim.fitNormals[k],
							side: side.side,
						});
					}
				}
			}
			const spline = sketch.addFitSpline(ptIds, undefined, false, undefined, !!prim.isSplineClosed, prim.handles);
			createdIds.push(spline.id);

			if (splinePoints.length > 0) {
				offsetPairs.push({
					kind: 'spline',
					origSplineId: prim.sourceId,
					offSplineId: spline.id,
					points: splinePoints,
				});
			}
		}
	}
	return { createdIds, offsetPairs, cornerPointIds: cornerPoints.map(p => p.id) };
}

/**
 * Commits the computed offset geometry into the SketchDocument.
 */
export function commitOffsetToSketch(
	sketch: SketchDocument,
	chain: OffsetChain,
	geomResult: OffsetGeometryResult,
	_direction?: OffsetDirection,
	_dist1?: number,
	_dist2?: number,
	_flip?: boolean,
	expressions?: { dist1?: string; dist2?: string }
): { createdIds: string[]; constraintIds: string[] } | null {
	if (!geomResult.isValid || geomResult.sides.length === 0) return null;

	sketch.beginTransaction();

	const createdIds: string[] = [];
	const constraintIds: string[] = [];

	for (let sideIdx = 0; sideIdx < geomResult.sides.length; sideIdx++) {
		const side = geomResult.sides[sideIdx];
		const { createdIds: sideIds, offsetPairs, cornerPointIds } = createOffsetSideGeometry(sketch, chain, side);
		createdIds.push(...sideIds);
		// Create OffsetConstraint for this side if offset pairs exist
		if (offsetPairs.length > 0) {
			const offC = new OffsetConstraint(
				sketch.nextId('c_offset'),
				offsetPairs,
				Math.abs(side.distance),
				0,
				1.0,
				chain,
				// Each constraint controls one side, including when the tool creates two.
				'one_side',
				side.side < 0,
				cornerPointIds
			);
			if (expressions) {
				const expr =
					sideIdx === 0 || _direction === 'symmetric' ? expressions.dist1 : (expressions.dist2 ?? expressions.dist1);
				if (expr) offC.expression = expr;
			}
			sketch.addConstraint(offC);
			constraintIds.push(offC.id);
		}
	}

	sketch.commitTransaction();
	sketch.solve();

	return { createdIds, constraintIds };
}

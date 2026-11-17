// Frozen before native topology routing. Keep traversal and insertion order independent.
import type { SketchDocument } from '../model/sketch';
import { POINT_TOLERANCE } from '../constants';
import { CoincidentConstraint } from '../solver/constraints';
import type { ChainItem, OffsetChain } from './offset';

/**
 * Returns all point IDs that are topologically or geometrically coincident with `startPointId`
 * by traversing CoincidentConstraint relationships and matching points within POINT_TOLERANCE.
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
		const currPt = sketch.points.get(curr);
		if (currPt) {
			for (const pt of sketch.points.values()) {
				if (
					!group.has(pt.id) &&
					Math.abs(pt.x - currPt.x) <= POINT_TOLERANCE &&
					Math.abs(pt.y - currPt.y) <= POINT_TOLERANCE &&
					currPt.distanceTo(pt) <= POINT_TOLERANCE
				) {
					group.add(pt.id);
					queue.push(pt.id);
				}
			}
			if (
				!group.has('origin') &&
				Math.abs(currPt.x) <= POINT_TOLERANCE &&
				Math.abs(currPt.y) <= POINT_TOLERANCE &&
				Math.hypot(currPt.x, currPt.y) <= POINT_TOLERANCE
			) {
				group.add('origin');
				queue.push('origin');
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

function extendChainDirection(
	sketch: SketchDocument,
	items: ChainItem[],
	startPtId: string,
	startPrimId: string,
	forward: boolean
): boolean {
	const oppositeEndId = forward ? items[0].startPointId! : items[items.length - 1].endPointId!;
	const stopGroup = getCoincidentPointGroup(sketch, oppositeEndId);
	let currPt = startPtId;
	let prevId = startPrimId;

	while (true) {
		const conn = getConnectedPrimitivesAtVertex(sketch, currPt, prevId);
		if (conn.length !== 1) return false;
		const next = conn[0];
		if (items.some(it => it.id === next.id)) {
			return stopGroup.has(next.connectedPointId) || stopGroup.has(next.otherPointId);
		}
		const itemStartId = forward ? next.connectedPointId : next.otherPointId;
		const itemEndId = forward ? next.otherPointId : next.connectedPointId;
		const ep = getPrimitiveEndpoints(sketch, next.type, next.id);
		const isRev = ep ? getCoincidentPointGroup(sketch, itemStartId).has(ep.p2Id) : false;
		const nextItem: ChainItem = {
			id: next.id,
			type: next.type,
			startPointId: itemStartId,
			endPointId: itemEndId,
			reversed: isRev,
		};
		if (forward) items.push(nextItem);
		else items.unshift(nextItem);
		prevId = next.id;
		currPt = next.otherPointId;

		if (stopGroup.has(currPt)) {
			return true;
		}
	}
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
		let isClosed = extendChainDirection(sketch, chainItems, startItem.endPointId!, startItem.id, true);

		// If not closed, traverse backward from startPointId
		if (!isClosed) {
			isClosed = extendChainDirection(sketch, chainItems, chainItems[0].startPointId!, chainItems[0].id, false);
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

		if (headGroup.has(attachEnd)) {
			isClosed = true;
		} else if (chainSelection) {
			isClosed = extendChainDirection(sketch, newItems, attachEnd, primitiveId, true);
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
			isClosed = extendChainDirection(sketch, newItems, attachStart, primitiveId, false);
		}
	}

	return {
		items: newItems,
		isClosed,
		firstSelectedId: currentChain.firstSelectedId || currentChain.items[0]?.id,
	};
}

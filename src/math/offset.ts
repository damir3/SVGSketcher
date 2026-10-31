import type { SketchDocument } from '../model/sketch';
import type { SketchPoint } from '../model/types';
import { CoincidentConstraint } from '../solver/constraints';
import { dist, normalize, type Vec2 } from './vector';
import { computeNaturalFitHandles } from './spline';
import { OffsetConstraint, type OffsetPair, type OffsetSplinePoint } from '../solver/constraints/offset';

export type OffsetDirection = 'one_side' | 'two_sides' | 'symmetric';

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
	const res: Array<{ id: string; type: ChainItem['type']; connectedPointId: string; otherPointId: string }> = [];

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

/**
 * Samples points along a chain item in order from its start to its end.
 */
function sampleChainItemPoints(sketch: SketchDocument, item: ChainItem, numSamples = 16): Vec2[] {
	if (item.type === 'line') {
		const l = sketch.lines.get(item.id);
		if (!l) return [];
		const p1 = sketch.points.get(item.startPointId || l.p1Id);
		const p2 = sketch.points.get(item.endPointId || l.p2Id);
		if (!p1 || !p2) return [];
		return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }];
	}

	if (item.type === 'circle') {
		const c = sketch.circles.get(item.id);
		if (!c) return [];
		const center = sketch.points.get(c.centerId);
		if (!center) return [];
		const pts: Vec2[] = [];
		for (let i = 0; i < numSamples; i++) {
			const a = (i / numSamples) * Math.PI * 2;
			pts.push({ x: center.x + c.radius * Math.cos(a), y: center.y + c.radius * Math.sin(a) });
		}
		pts.push({ ...pts[0] });
		return pts;
	}

	if (item.type === 'ellipse') {
		const el = sketch.ellipses.get(item.id);
		if (!el) return [];
		const center = sketch.points.get(el.centerId);
		const maj = sketch.points.get(el.majorAxisPointId);
		const min = sketch.points.get(el.minorAxisPointId);
		if (!center || !maj || !min) return [];
		const a = dist(center, maj);
		const b = dist(center, min);
		const angle = Math.atan2(maj.y - center.y, maj.x - center.x);
		const cosA = Math.cos(angle);
		const sinA = Math.sin(angle);
		const pts: Vec2[] = [];
		for (let i = 0; i < numSamples; i++) {
			const theta = (i / numSamples) * Math.PI * 2;
			const ex = a * Math.cos(theta);
			const ey = b * Math.sin(theta);
			pts.push({
				x: center.x + ex * cosA - ey * sinA,
				y: center.y + ex * sinA + ey * cosA,
			});
		}
		pts.push({ ...pts[0] });
		return pts;
	}

	if (item.type === 'arc') {
		const arc = sketch.arcs.get(item.id);
		if (!arc) return [];
		const center = sketch.points.get(arc.centerId);
		const pStart = sketch.points.get(item.startPointId || arc.startPointId);
		const pEnd = sketch.points.get(item.endPointId || arc.endPointId);
		if (!center || !pStart || !pEnd) return [];

		const aStart = Math.atan2(pStart.y - center.y, pStart.x - center.x);
		const aEnd = Math.atan2(pEnd.y - center.y, pEnd.x - center.x);
		const isReversed = item.startPointId === arc.endPointId;
		const effectiveClockwise = isReversed ? !arc.clockwise : !!arc.clockwise;

		let sweep = effectiveClockwise ? aStart - aEnd : aEnd - aStart;
		while (sweep < 0) sweep += Math.PI * 2;

		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const ang = effectiveClockwise ? aStart - t * sweep : aStart + t * sweep;
			pts.push({
				x: center.x + arc.radius * Math.cos(ang),
				y: center.y + arc.radius * Math.sin(ang),
			});
		}
		return pts;
	}

	if (item.type === 'spline') {
		const s = sketch.splines.get(item.id);
		if (!s || s.pointIds.length < 2) return [];
		const geo = s.toGeoCurve(sketch);
		if (!geo || !geo.bezierSegments || geo.bezierSegments.length === 0) return [];
		const beziers = geo.bezierSegments;
		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const totalT = t * beziers.length;
			const segIdx = Math.min(Math.floor(totalT), beziers.length - 1);
			const localT = totalT - segIdx;
			const [p0, p1, p2, p3] = beziers[segIdx];
			const mt = 1 - localT;
			const x = mt * mt * mt * p0.x + 3 * mt * mt * localT * p1.x + 3 * mt * localT * localT * p2.x + localT * localT * localT * p3.x;
			const y = mt * mt * mt * p0.y + 3 * mt * mt * localT * p1.y + 3 * mt * localT * localT * p2.y + localT * localT * localT * p3.y;
			pts.push({ x, y });
		}
		const isReversed =
			item.reversed ||
			(item.startPointId ? getCoincidentPointGroup(sketch, item.startPointId).has(s.pointIds[s.pointIds.length - 1]) : false);
		if (isReversed) pts.reverse();
		return pts;
	}

	if (item.type === 'elliptical_arc') {
		const ea = sketch.ellipticalArcs.get(item.id);
		if (!ea) return [];
		const center = sketch.points.get(ea.centerId);
		const maj = sketch.points.get(ea.majorAxisPointId);
		const min = sketch.points.get(ea.minorAxisPointId);
		const pStart = sketch.points.get(item.startPointId || ea.startPointId);
		const pEnd = sketch.points.get(item.endPointId || ea.endPointId);
		if (!center || !maj || !min || !pStart || !pEnd) return [];
		const a = dist(center, maj);
		const b = dist(center, min);
		const rot = Math.atan2(maj.y - center.y, maj.x - center.x);
		const cosR = Math.cos(rot), sinR = Math.sin(rot);

		const toEllipseParam = (p: Vec2) => {
			const dx = p.x - center.x, dy = p.y - center.y;
			const ex = dx * cosR + dy * sinR;
			const ey = -dx * sinR + dy * cosR;
			return Math.atan2(ey / b, ex / a);
		};

		let tStart = toEllipseParam(pStart);
		let tEnd = toEllipseParam(pEnd);
		const isReversed = item.startPointId === ea.endPointId;
		const effectiveClockwise = isReversed ? !ea.clockwise : !!ea.clockwise;

		let sweep = effectiveClockwise ? tStart - tEnd : tEnd - tStart;
		while (sweep < 0) sweep += Math.PI * 2;

		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const ang = effectiveClockwise ? tStart - t * sweep : tStart + t * sweep;
			const ex = a * Math.cos(ang);
			const ey = b * Math.sin(ang);
			pts.push({
				x: center.x + ex * cosR - ey * sinR,
				y: center.y + ex * sinR + ey * cosR,
			});
		}
		return pts;
	}

	return [];
}

/**
 * Calculates 2D line intersection between infinite lines p1 + t*d1 and p2 + s*d2.
 */
export function intersectLines2D(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
	const cross = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(cross) < 1e-7) return null;
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const t = (dx * d2.y - dy * d2.x) / cross;
	return {
		x: p1.x + t * d1.x,
		y: p1.y + t * d1.y,
	};
}

/**
 * Determines outward normal direction for closed chain using signed area.
 * For CCW: left normal is inward, right normal is outward.
 * For CW: left normal is outward, right normal is inward.
 */
function isPolygonCounterClockwise(pts: Vec2[]): boolean {
	let area = 0;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
	}
	return area > 0;
}

/**
 * Checks whether point `pt` is strictly inside the closed polygon `poly` using ray-casting.
 */
function isPointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
	let inside = false;
	const n = poly.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i].x,
			yi = poly[i].y;
		const xj = poly[j].x,
			yj = poly[j].y;
		const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * Computes offset geometry for a single signed distance displacement along the chain.
 */
function computeSingleOffsetSide(
	sketch: SketchDocument,
	chain: OffsetChain,
	signedDistance: number
): OffsetSideGeometry {
	const primitives: OffsetPrimitiveGeom[] = [];
	const n = chain.items.length;
	if (n === 0) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

	// 1. Single closed circle
	if (n === 1 && chain.items[0].type === 'circle') {
		const c = sketch.circles.get(chain.items[0].id);
		const center = c ? sketch.points.get(c.centerId) : null;
		if (!c || !center) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
		const newR = c.radius + signedDistance;
		if (newR <= 0.1) {
			return { primitives: [], side: 1, distance: signedDistance, isValid: false, errorMessage: 'Offset distance exceeds circle radius' };
		}
		return {
			primitives: [{
				sourceId: c.id,
				type: 'circle',
				circleCenter: { x: center.x, y: center.y },
				circleRadius: newR,
			}],
			side: Math.sign(signedDistance) || 1,
			distance: Math.abs(signedDistance),
			isValid: true,
		};
	}

	// 2. Single closed ellipse
	if (n === 1 && chain.items[0].type === 'ellipse') {
		const el = sketch.ellipses.get(chain.items[0].id);
		const center = el ? sketch.points.get(el.centerId) : null;
		const maj = el ? sketch.points.get(el.majorAxisPointId) : null;
		const min = el ? sketch.points.get(el.minorAxisPointId) : null;
		if (!el || !center || !maj || !min) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
		const a = dist(center, maj);
		const b = dist(center, min);
		const rot = Math.atan2(maj.y - center.y, maj.x - center.x);
		const cosR = Math.cos(rot), sinR = Math.sin(rot);

		const samples = 24;
		const fitPts: Vec2[] = [];
		for (let i = 0; i < samples; i++) {
			const theta = (i / samples) * Math.PI * 2;
			// Position on ellipse
			const ex = a * Math.cos(theta);
			const ey = b * Math.sin(theta);
			const px = center.x + ex * cosR - ey * sinR;
			const py = center.y + ex * sinR + ey * cosR;
			// Tangent
			const tx = -a * Math.sin(theta) * cosR - b * Math.cos(theta) * sinR;
			const ty = -a * Math.sin(theta) * sinR + b * Math.cos(theta) * cosR;
			const uT = normalize({ x: tx, y: ty });
			// Outward normal: points away from center
			let nx = uT.y;
			let ny = -uT.x;
			if ((px + nx - center.x) ** 2 + (py + ny - center.y) ** 2 < (px - center.x) ** 2 + (py - center.y) ** 2) {
				nx = -nx;
				ny = -ny;
			}
			fitPts.push({
				x: px + signedDistance * nx,
				y: py + signedDistance * ny,
			});
		}
		fitPts.push({ ...fitPts[0] });

		return {
			primitives: [{
				sourceId: el.id,
				type: 'spline',
				fitPoints: fitPts,
				isSplineClosed: true,
			}],
			side: Math.sign(signedDistance) || 1,
			distance: Math.abs(signedDistance),
			isValid: true,
		};
	}

	// 3. Multi-primitive or general open/closed chain
	// Determine normal direction:
	// For closed chain: calculate signed area to know if CCW or CW
	let isCCW = true;
	if (chain.isClosed) {
		const poly: Vec2[] = [];
		for (const it of chain.items) {
			const pts = sampleChainItemPoints(sketch, it, 4);
			for (let i = 0; i < pts.length - 1; i++) poly.push(pts[i]);
		}
		isCCW = isPolygonCounterClockwise(poly);
	}

	// For each item, compute unjoined raw offset geometry
	interface RawOffsetItem {
		sourceId: string;
		type: 'line' | 'arc' | 'spline';
		// For line
		p1?: Vec2;
		p2?: Vec2;
		dir?: Vec2;
		// For arc
		center?: Vec2;
		start?: Vec2;
		end?: Vec2;
		radius?: number;
		clockwise?: boolean;
		// For spline / sampled
		fitPoints?: Vec2[];
		fitBases?: Vec2[];
		fitNormals?: Vec2[];
		startTangent?: Vec2;
		endTangent?: Vec2;
		handles?: Array<{ h1: Vec2; h2: Vec2 }>;
	}

	const rawItems: RawOffsetItem[] = [];

	for (let i = 0; i < n; i++) {
		const item = chain.items[i];

		if (item.type === 'line') {
			const l = sketch.lines.get(item.id);
			if (!l) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
			const p1 = sketch.points.get(item.startPointId || l.p1Id);
			const p2 = sketch.points.get(item.endPointId || l.p2Id);
			if (!p1 || !p2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const uT = normalize({ x: dx, y: dy });

			// Left normal is (-uT.y, uT.x). Right normal is (uT.y, -uT.x)
			// For closed CCW: outward is right normal (uT.y, -uT.x).
			// For closed CW: outward is left normal (-uT.y, uT.x).
			// For open chain: default outward/positive is left normal (-uT.y, uT.x).
			let norm: Vec2;
			if (chain.isClosed) {
				norm = isCCW ? { x: uT.y, y: -uT.x } : { x: -uT.y, y: uT.x };
			} else {
				norm = { x: -uT.y, y: uT.x };
			}

			const offP1 = { x: p1.x + signedDistance * norm.x, y: p1.y + signedDistance * norm.y };
			const offP2 = { x: p2.x + signedDistance * norm.x, y: p2.y + signedDistance * norm.y };

			rawItems.push({
				sourceId: l.id,
				type: 'line',
				p1: offP1,
				p2: offP2,
				dir: uT,
			});
		} else if (item.type === 'arc') {
			const arc = sketch.arcs.get(item.id);
			if (!arc) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
			const center = sketch.points.get(arc.centerId);
			const p1 = sketch.points.get(item.startPointId || arc.startPointId);
			const p2 = sketch.points.get(item.endPointId || arc.endPointId);
			if (!center || !p1 || !p2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const midSample = sampleChainItemPoints(sketch, item, 4)[2] || p1;
			const toMid = normalize({ x: midSample.x - center.x, y: midSample.y - center.y });

			// Check if chain normal at mid points radially away from center
			const uT = normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
			let chainNorm: Vec2;
			if (chain.isClosed) {
				chainNorm = isCCW ? { x: uT.y, y: -uT.x } : { x: -uT.y, y: uT.x };
			} else {
				chainNorm = { x: -uT.y, y: uT.x };
			}

			const radiallyOutward = (chainNorm.x * toMid.x + chainNorm.y * toMid.y) >= 0;
			const rDelta = radiallyOutward ? signedDistance : -signedDistance;
			const newR = arc.radius + rDelta;

			if (newR <= 0.1) {
				return { primitives: [], side: 1, distance: signedDistance, isValid: false, errorMessage: 'Offset collapses arc radius' };
			}

			const sRad1 = normalize({ x: p1.x - center.x, y: p1.y - center.y });
			const sRad2 = normalize({ x: p2.x - center.x, y: p2.y - center.y });

			const offP1 = { x: center.x + newR * sRad1.x, y: center.y + newR * sRad1.y };
			const offP2 = { x: center.x + newR * sRad2.x, y: center.y + newR * sRad2.y };

			const isReversed = item.startPointId === arc.endPointId;
			const effectiveClockwise = isReversed ? !arc.clockwise : !!arc.clockwise;

			rawItems.push({
				sourceId: arc.id,
				type: 'arc',
				center: { x: center.x, y: center.y },
				start: offP1,
				end: offP2,
				radius: newR,
				clockwise: effectiveClockwise,
			});
		} else {
			// Spline or Elliptical Arc: sample points and offset along normals
			const samples = sampleChainItemPoints(sketch, item, 16);
			if (samples.length < 2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const offSamples: Vec2[] = [];
			const splineBases: Vec2[] = [];
			const splineNormals: Vec2[] = [];
			for (let k = 0; k < samples.length; k++) {
				const prev = samples[Math.max(0, k - 1)];
				const next = samples[Math.min(samples.length - 1, k + 1)];
				const uT = normalize({ x: next.x - prev.x, y: next.y - prev.y });
				let norm: Vec2;
				if (chain.isClosed) {
					norm = isCCW ? { x: uT.y, y: -uT.x } : { x: -uT.y, y: uT.x };
				} else {
					norm = { x: -uT.y, y: uT.x };
				}
				splineBases.push(samples[k]);
				splineNormals.push(norm);
				offSamples.push({
					x: samples[k].x + signedDistance * norm.x,
					y: samples[k].y + signedDistance * norm.y,
				});
			}

			// Compute exact endpoint tangents for spline
			let startTangent = normalize({ x: offSamples[1].x - offSamples[0].x, y: offSamples[1].y - offSamples[0].y });
			let endTangent = normalize({
				x: offSamples[offSamples.length - 1].x - offSamples[offSamples.length - 2].x,
				y: offSamples[offSamples.length - 1].y - offSamples[offSamples.length - 2].y,
			});

			const s = sketch.splines.get(item.id);
			if (s && s.pointIds.length >= 2) {
				const geo = s.toGeoCurve(sketch);
				if (geo && geo.bezierSegments.length > 0) {
					const beziers = geo.bezierSegments;
					const ep = getPrimitiveEndpoints(sketch, item.type, item.id);
					const isReversed =
						item.reversed ||
						(ep && item.startPointId ? getCoincidentPointGroup(sketch, item.startPointId).has(ep.p2Id) : false);
					if (!isReversed) {
						startTangent = normalize({ x: beziers[0][1].x - beziers[0][0].x, y: beziers[0][1].y - beziers[0][0].y });
						endTangent = normalize({
							x: beziers[beziers.length - 1][3].x - beziers[beziers.length - 1][2].x,
							y: beziers[beziers.length - 1][3].y - beziers[beziers.length - 1][2].y,
						});
					} else {
						startTangent = normalize({
							x: beziers[beziers.length - 1][2].x - beziers[beziers.length - 1][3].x,
							y: beziers[beziers.length - 1][2].y - beziers[beziers.length - 1][3].y,
						});
						endTangent = normalize({ x: beziers[0][0].x - beziers[0][1].x, y: beziers[0][0].y - beziers[0][1].y });
					}
				}
			}

			const startNorm = chain.isClosed ? (isCCW ? { x: startTangent.y, y: -startTangent.x } : { x: -startTangent.y, y: startTangent.x }) : { x: -startTangent.y, y: startTangent.x };
			const endNorm = chain.isClosed ? (isCCW ? { x: endTangent.y, y: -endTangent.x } : { x: -endTangent.y, y: endTangent.x }) : { x: -endTangent.y, y: endTangent.x };
			splineNormals[0] = startNorm;
			splineNormals[splineNormals.length - 1] = endNorm;
			offSamples[0] = { x: samples[0].x + signedDistance * startNorm.x, y: samples[0].y + signedDistance * startNorm.y };
			offSamples[offSamples.length - 1] = {
				x: samples[samples.length - 1].x + signedDistance * endNorm.x,
				y: samples[samples.length - 1].y + signedDistance * endNorm.y,
			};

			rawItems.push({
				sourceId: item.id,
				type: 'spline',
				fitPoints: offSamples,
				fitBases: splineBases,
				fitNormals: splineNormals,
				startTangent,
				endTangent,
			});
		}
	}

	// 4. Corner Trimming / Extension
	// For each consecutive pair (i, nextIdx), find intersection of the two offset geometries
	const cornerCount = chain.isClosed ? n : n - 1;
	for (let i = 0; i < cornerCount; i++) {
		const nextIdx = (i + 1) % n;
		const cur = rawItems[i];
		const next = rawItems[nextIdx];

		if (cur.type === 'line' && next.type === 'line') {
			const inter = intersectLines2D(cur.p1!, cur.dir!, next.p1!, next.dir!);
			if (inter) {
				cur.p2 = inter;
				next.p1 = inter;
			}
		} else if (cur.type === 'line' && next.type === 'arc') {
			// Line meeting Arc: intersect line with arc circle
			const c = next.center!;
			const r = next.radius!;
			const p1 = cur.p1!;
			const d = cur.dir!;
			// Project c onto line
			const tProj = (c.x - p1.x) * d.x + (c.y - p1.y) * d.y;
			const perpDistSq = (p1.x + tProj * d.x - c.x) ** 2 + (p1.y + tProj * d.y - c.y) ** 2;
			if (perpDistSq <= r * r) {
				const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
				const i1 = { x: p1.x + (tProj - dt) * d.x, y: p1.y + (tProj - dt) * d.y };
				const i2 = { x: p1.x + (tProj + dt) * d.x, y: p1.y + (tProj + dt) * d.y };
				const best = dist(i1, cur.p2!) < dist(i2, cur.p2!) ? i1 : i2;
				cur.p2 = best;
				next.start = best;
			}
		} else if (cur.type === 'arc' && next.type === 'line') {
			const c = cur.center!;
			const r = cur.radius!;
			const p1 = next.p1!;
			const d = next.dir!;
			const tProj = (c.x - p1.x) * d.x + (c.y - p1.y) * d.y;
			const perpDistSq = (p1.x + tProj * d.x - c.x) ** 2 + (p1.y + tProj * d.y - c.y) ** 2;
			if (perpDistSq <= r * r) {
				const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
				const i1 = { x: p1.x + (tProj - dt) * d.x, y: p1.y + (tProj - dt) * d.y };
				const i2 = { x: p1.x + (tProj + dt) * d.x, y: p1.y + (tProj + dt) * d.y };
				const best = dist(i1, cur.end!) < dist(i2, cur.end!) ? i1 : i2;
				cur.end = best;
				next.p1 = best;
			}
		} else if (cur.type === 'line' && next.type === 'spline') {
			// Line meeting Spline: intersect Line ray with Spline start tangent ray
			const pLine = cur.p1!;
			const dLine = cur.dir!;
			const spPts = next.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[0];
				const dSp = next.startTangent || normalize({ x: spPts[1].x - spPts[0].x, y: spPts[1].y - spPts[0].y });
				const inter = intersectLines2D(pLine, dLine, pSp, dSp);
				if (inter && dist(inter, cur.p2!) <= 4 * Math.abs(signedDistance)) {
					cur.p2 = inter;
					spPts[0] = inter;
					joined = true;
				}
			}
			if (!joined) {
				const avg = { x: (cur.p2!.x + spPts[0].x) / 2, y: (cur.p2!.y + spPts[0].y) / 2 };
				cur.p2 = avg;
				spPts[0] = avg;
			}
		} else if (cur.type === 'spline' && next.type === 'line') {
			// Spline meeting Line: intersect Spline end tangent ray with Line ray
			const spPts = cur.fitPoints!;
			const pLine = next.p1!;
			const dLine = next.dir!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[spPts.length - 1];
				const dSp = cur.endTangent || normalize({ x: pSp.x - spPts[spPts.length - 2].x, y: pSp.y - spPts[spPts.length - 2].y });
				const inter = intersectLines2D(pLine, dLine, pSp, dSp);
				if (inter && dist(inter, next.p1!) <= 4 * Math.abs(signedDistance)) {
					spPts[spPts.length - 1] = inter;
					next.p1 = inter;
					joined = true;
				}
			}
			if (!joined) {
				const avg = { x: (spPts[spPts.length - 1].x + next.p1!.x) / 2, y: (spPts[spPts.length - 1].y + next.p1!.y) / 2 };
				spPts[spPts.length - 1] = avg;
				next.p1 = avg;
			}
		} else if (cur.type === 'arc' && next.type === 'spline') {
			// Arc meeting Spline: intersect Arc circle with Spline start tangent ray
			const c = cur.center!;
			const r = cur.radius!;
			const spPts = next.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[0];
				const dSp = next.startTangent || normalize({ x: spPts[1].x - spPts[0].x, y: spPts[1].y - spPts[0].y });
				const tProj = (c.x - pSp.x) * dSp.x + (c.y - pSp.y) * dSp.y;
				const perpDistSq = (pSp.x + tProj * dSp.x - c.x) ** 2 + (pSp.y + tProj * dSp.y - c.y) ** 2;
				if (perpDistSq <= r * r) {
					const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
					const i1 = { x: pSp.x + (tProj - dt) * dSp.x, y: pSp.y + (tProj - dt) * dSp.y };
					const i2 = { x: pSp.x + (tProj + dt) * dSp.x, y: pSp.y + (tProj + dt) * dSp.y };
					const best = dist(i1, cur.end!) < dist(i2, cur.end!) ? i1 : i2;
					cur.end = best;
					spPts[0] = best;
					joined = true;
				}
			}
			if (!joined) {
				const avg = { x: (cur.end!.x + spPts[0].x) / 2, y: (cur.end!.y + spPts[0].y) / 2 };
				cur.end = avg;
				spPts[0] = avg;
			}
		} else if (cur.type === 'spline' && next.type === 'arc') {
			// Spline meeting Arc: intersect Arc circle with Spline end tangent ray
			const c = next.center!;
			const r = next.radius!;
			const spPts = cur.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[spPts.length - 1];
				const dSp = cur.endTangent || normalize({ x: pSp.x - spPts[spPts.length - 2].x, y: pSp.y - spPts[spPts.length - 2].y });
				const tProj = (c.x - pSp.x) * dSp.x + (c.y - pSp.y) * dSp.y;
				const perpDistSq = (pSp.x + tProj * dSp.x - c.x) ** 2 + (pSp.y + tProj * dSp.y - c.y) ** 2;
				if (perpDistSq <= r * r) {
					const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
					const i1 = { x: pSp.x + (tProj - dt) * dSp.x, y: pSp.y + (tProj - dt) * dSp.y };
					const i2 = { x: pSp.x + (tProj + dt) * dSp.x, y: pSp.y + (tProj + dt) * dSp.y };
					const best = dist(i1, next.start!) < dist(i2, next.start!) ? i1 : i2;
					spPts[spPts.length - 1] = best;
					next.start = best;
					joined = true;
				}
			}
			if (!joined) {
				const avg = { x: (spPts[spPts.length - 1].x + next.start!.x) / 2, y: (spPts[spPts.length - 1].y + next.start!.y) / 2 };
				spPts[spPts.length - 1] = avg;
				next.start = avg;
			}
		} else {
			// Spline-Spline or other: connect endpoints to meet at their average
			const pCurEnd = cur.type === 'line' ? cur.p2! : cur.type === 'arc' ? cur.end! : cur.fitPoints![cur.fitPoints!.length - 1];
			const pNextStart = next.type === 'line' ? next.p1! : next.type === 'arc' ? next.start! : next.fitPoints![0];
			const avg = { x: (pCurEnd.x + pNextStart.x) / 2, y: (pCurEnd.y + pNextStart.y) / 2 };

			if (cur.type === 'line') cur.p2 = avg;
			else if (cur.type === 'arc') cur.end = avg;
			else cur.fitPoints![cur.fitPoints!.length - 1] = avg;

			if (next.type === 'line') next.p1 = avg;
			else if (next.type === 'arc') next.start = avg;
			else next.fitPoints![0] = avg;
		}
	}

	// Compute handles with true endpoint tangents for splines
	for (const raw of rawItems) {
		if (raw.type === 'spline' && raw.fitPoints && raw.fitPoints.length >= 2) {
			const pts = raw.fitPoints;
			const count = pts.length - 1;
			const handles = computeNaturalFitHandles(pts);
			if (raw.startTangent && handles[0]) {
				const d0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) / 3;
				handles[0] = {
					h1: { x: pts[0].x - raw.startTangent.x * d0, y: pts[0].y - raw.startTangent.y * d0 },
					h2: { x: pts[0].x + raw.startTangent.x * d0, y: pts[0].y + raw.startTangent.y * d0 },
				};
			}
			if (raw.endTangent && handles[count]) {
				const dn = Math.hypot(pts[count].x - pts[count - 1].x, pts[count].y - pts[count - 1].y) / 3;
				handles[count] = {
					h1: { x: pts[count].x - raw.endTangent.x * dn, y: pts[count].y - raw.endTangent.y * dn },
					h2: { x: pts[count].x + raw.endTangent.x * dn, y: pts[count].y + raw.endTangent.y * dn },
				};
			}
			raw.handles = handles;
		}
	}

	// Build output primitive geoms
	for (const raw of rawItems) {
		if (raw.type === 'line') {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'line',
				p1: raw.p1,
				p2: raw.p2,
			});
		} else if (raw.type === 'arc') {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'arc',
				center: raw.center,
				start: raw.start,
				end: raw.end,
				radius: raw.radius,
				clockwise: raw.clockwise,
			});
		} else {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'spline',
				fitPoints: raw.fitPoints,
				fitBases: raw.fitBases,
				fitNormals: raw.fitNormals,
				startTangent: raw.startTangent,
				endTangent: raw.endTangent,
				handles: raw.handles,
				isSplineClosed: false,
			});
		}
	}

	return {
		primitives,
		side: Math.sign(signedDistance) || 1,
		distance: Math.abs(signedDistance),
		isValid: true,
	};
}

/**
 * Calculates complete offset geometry for all required sides according to `direction`.
 */
export function calculateOffsetGeometry(
	sketch: SketchDocument,
	chain: OffsetChain,
	direction: OffsetDirection,
	dist1: number,
	dist2: number,
	flip: boolean
): OffsetGeometryResult {
	if (!chain || chain.items.length === 0) {
		return {
			sides: [],
			gizmoAnchor: { x: 0, y: 0 },
			gizmoNormal: { x: 1, y: 0 },
			isValid: false,
			errorMessage: 'No primitives selected in chain',
		};
	}

	// 1. Calculate gizmo anchor and normal at the exact middle of the first selected primitive
	const refId = chain.firstSelectedId || chain.items[0]?.id;
	const refItem = chain.items.find(it => it.id === refId) || chain.items[0];
	let gizmoAnchor: Vec2 = { x: 0, y: 0 };
	let gizmoNormal: Vec2 = { x: 0, y: 1 };

	// Sample poly for inside/outside orientation test if chain is closed
	const poly: Vec2[] = [];
	if (chain.isClosed) {
		for (const it of chain.items) {
			const pts = sampleChainItemPoints(sketch, it, 16);
			for (let i = 0; i < pts.length - 1; i++) poly.push(pts[i]);
		}
	}

	if (refItem.type === 'line') {
		const l = sketch.lines.get(refItem.id);
		const p1 = l ? sketch.points.get(refItem.startPointId || l.p1Id) : null;
		const p2 = l ? sketch.points.get(refItem.endPointId || l.p2Id) : null;
		if (l && p1 && p2) {
			// Exact middle of the first selected line
			gizmoAnchor = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const len = Math.hypot(dx, dy) || 1;
			const uT = { x: dx / len, y: dy / len };
			// Normal candidate (left of line direction)
			gizmoNormal = { x: -uT.y, y: uT.x };
			if (chain.isClosed && poly.length >= 3) {
				const testPt = {
					x: gizmoAnchor.x + 0.5 * gizmoNormal.x,
					y: gizmoAnchor.y + 0.5 * gizmoNormal.y,
				};
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = { x: -gizmoNormal.x, y: -gizmoNormal.y };
				}
			}
		}
	} else if (refItem.type === 'arc') {
		const arc = sketch.arcs.get(refItem.id);
		const center = arc ? sketch.points.get(arc.centerId) : null;
		const p1 = arc ? sketch.points.get(refItem.startPointId || arc.startPointId) : null;
		const p2 = arc ? sketch.points.get(refItem.endPointId || arc.endPointId) : null;
		if (arc && center && p1 && p2) {
			const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
			const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
			let sweep = arc.clockwise ? a1 - a2 : a2 - a1;
			while (sweep < 0) sweep += 2 * Math.PI;
			while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
			const midAngle = arc.clockwise ? a1 - sweep / 2 : a1 + sweep / 2;

			// Exact middle of the arc along its curve
			gizmoAnchor = {
				x: center.x + arc.radius * Math.cos(midAngle),
				y: center.y + arc.radius * Math.sin(midAngle),
			};
			gizmoNormal = { x: Math.cos(midAngle), y: Math.sin(midAngle) };
			if (chain.isClosed && poly.length >= 3) {
				const testPt = {
					x: gizmoAnchor.x + 0.5 * gizmoNormal.x,
					y: gizmoAnchor.y + 0.5 * gizmoNormal.y,
				};
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = { x: -gizmoNormal.x, y: -gizmoNormal.y };
				}
			}
		}
	} else if (refItem.type === 'circle') {
		const c = sketch.circles.get(refItem.id);
		const center = c ? sketch.points.get(c.centerId) : null;
		if (c && center) {
			gizmoAnchor = { x: center.x + c.radius, y: center.y };
			gizmoNormal = { x: 1, y: 0 };
		}
	} else if (refItem.type === 'ellipse') {
		const el = sketch.ellipses.get(refItem.id);
		const center = el ? sketch.points.get(el.centerId) : null;
		const maj = el ? sketch.points.get(el.majorAxisPointId) : null;
		if (el && center && maj) {
			gizmoAnchor = { x: maj.x, y: maj.y };
			gizmoNormal = normalize({ x: maj.x - center.x, y: maj.y - center.y });
		}
	} else if (refItem.type === 'spline') {
		const splinePts = sampleChainItemPoints(sketch, refItem, 64);
		if (splinePts.length >= 2) {
			const midIdx = Math.floor(splinePts.length / 2);
			gizmoAnchor = splinePts[midIdx];
			const pPrev = splinePts[Math.max(0, midIdx - 1)];
			const pNext = splinePts[Math.min(splinePts.length - 1, midIdx + 1)];
			const uT = normalize({ x: pNext.x - pPrev.x, y: pNext.y - pPrev.y });
			gizmoNormal = { x: -uT.y, y: uT.x };
			if (chain.isClosed && poly.length >= 3) {
				const testPt = {
					x: gizmoAnchor.x + 0.5 * gizmoNormal.x,
					y: gizmoAnchor.y + 0.5 * gizmoNormal.y,
				};
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = { x: -gizmoNormal.x, y: -gizmoNormal.y };
				}
			}
		}
	}

	// 2. Compute sides
	const sides: OffsetSideGeometry[] = [];

	if (direction === 'one_side') {
		const sign = flip ? -1 : 1;
		const s1 = computeSingleOffsetSide(sketch, chain, sign * dist1);
		sides.push(s1);
	} else if (direction === 'two_sides') {
		const s1 = computeSingleOffsetSide(sketch, chain, !flip ? dist1 : -dist1);
		const s2 = computeSingleOffsetSide(sketch, chain, !flip ? -dist2 : dist2);
		sides.push(s1, s2);
	} else if (direction === 'symmetric') {
		const s1 = computeSingleOffsetSide(sketch, chain, dist1);
		const s2 = computeSingleOffsetSide(sketch, chain, -dist1);
		sides.push(s1, s2);
	}

	const allValid = sides.length > 0 && sides.every(s => s.isValid);
	const errorMsg = sides.find(s => !s.isValid)?.errorMessage;

	return {
		sides,
		gizmoAnchor,
		gizmoNormal,
		isValid: allValid,
		errorMessage: errorMsg,
	};
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
	_flip?: boolean
): { createdIds: string[]; constraintIds: string[] } | null {
	if (!geomResult.isValid || geomResult.sides.length === 0) return null;

	sketch.beginTransaction();

	const createdIds: string[] = [];
	const constraintIds: string[] = [];

	for (const side of geomResult.sides) {
		const offsetPairs: OffsetPair[] = [];
		const cornerPoints: SketchPoint[] = [];

		// For lines and arcs meeting in a loop or chain, create shared vertices
		const numPrims = side.primitives.length;
		if (numPrims > 1) {
			const cornerCount = chain.isClosed ? numPrims : numPrims + 1;
			for (let i = 0; i < cornerCount; i++) {
				const prim = side.primitives[i % numPrims];
				const pt = (prim.type === 'line' ? prim.p1 : prim.type === 'arc' ? prim.start : prim.fitPoints?.[0]) || { x: 0, y: 0 };
				cornerPoints.push(sketch.addPoint(pt.x, pt.y));
			}
		}

		for (let i = 0; i < numPrims; i++) {
			const prim = side.primitives[i];

			if (prim.type === 'circle') {
				const centerPt = sketch.addPoint(prim.circleCenter!.x, prim.circleCenter!.y);
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
					p1 = sketch.addPoint(prim.p1!.x, prim.p1!.y);
					p2 = sketch.addPoint(prim.p2!.x, prim.p2!.y);
				}
				const line = sketch.addLine(p1.id, p2.id);
				createdIds.push(line.id);

				const origLine = sketch.lines.get(prim.sourceId);
				if (origLine) {
					const op1 = sketch.points.get(origLine.p1Id);
					const op2 = sketch.points.get(origLine.p2Id);
					let lineSide = 1;
					if (op1 && op2 && prim.p1) {
						const dx = op2.x - op1.x;
						const dy = op2.y - op1.y;
						const len = Math.hypot(dx, dy);
						const hLeft = len > 1e-9 ? (dx * (prim.p1.y - op1.y) - dy * (prim.p1.x - op1.x)) / len : 0;
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
				const centerPt = sketch.addPoint(prim.center!.x, prim.center!.y);
				let pStart: SketchPoint;
				let pEnd: SketchPoint;
				if (numPrims > 1) {
					pStart = cornerPoints[i];
					pEnd = cornerPoints[(i + 1) % cornerPoints.length];
				} else {
					pStart = sketch.addPoint(prim.start!.x, prim.start!.y);
					pEnd = sketch.addPoint(prim.end!.x, prim.end!.y);
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
						const sp = sketch.addPoint(pt.x, pt.y);
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
						const sp = sketch.addPoint(pt.x, pt.y);
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

		// Create OffsetConstraint for this side if offset pairs exist
		if (offsetPairs.length > 0) {
			const cornerPointIds = cornerPoints.map(p => p.id);
			const offC = new OffsetConstraint(
				sketch.nextId('c_offset'),
				offsetPairs,
				Math.abs(side.distance),
				0,
				1.0,
				chain,
				_direction || 'one_side',
				_flip || false,
				cornerPointIds
			);
			sketch.addConstraint(offC);
			constraintIds.push(offC.id);
		}
	}

	sketch.commitTransaction();
	sketch.solve();

	return { createdIds, constraintIds };
}

import type { SketchDocument } from '../model/sketch';
import { CoincidentConstraint } from '../solver/constraints';
import { POINT_TOLERANCE } from '../constants';
import { getGeometryKernel } from '../kernel';
import type { TopologyInput } from '../kernel/topologyTypes';
import type { ChainItem, OffsetChain } from './offset';

interface Neighbor {
	id: string;
	type: ChainItem['type'];
	connectedPointId: string;
	otherPointId: string;
}
export interface OffsetTopology {
	group(pointId: string): ReadonlySet<string>;
	connected(pointId: string, excludeId?: string): Neighbor[];
}
export const chainPointIds = (chain: OffsetChain | null) =>
	chain?.items.flatMap(i => [i.startPointId, i.endPointId]) ?? [];

function collect(sketch: SketchDocument, extraIds: readonly (string | undefined)[]) {
	const ids: string[] = [],
		indices = new Map<string, number>();
	const listed = new Set([...sketch.points.values()].map(p => p.id));
	const add = (id: string) => {
		if (!indices.has(id)) {
			indices.set(id, ids.length);
			ids.push(id);
		}
		return indices.get(id)!;
	};
	for (const id of listed) add(id);
	for (const id of ['origin', 'axis_x', 'axis_y']) add(id);
	const links: [number, number][] = [];
	for (const c of sketch.constraints.values())
		if (c instanceof CoincidentConstraint) links.push([add(c.p1Id), add(c.p2Id)]);
	const primitives: { id: string; type: ChainItem['type']; a: number; b: number }[] = [];
	const primitive = (id: string, type: ChainItem['type'], a: string, b: string) =>
		primitives.push({ id, type, a: add(a), b: add(b) });
	for (const l of sketch.lines.values())
		if (!l.isConstruction && !l.isSplineHandle) primitive(l.id, 'line', l.p1Id, l.p2Id);
	for (const a of sketch.arcs.values()) if (!a.isConstruction) primitive(a.id, 'arc', a.startPointId, a.endPointId);
	for (const a of sketch.ellipticalArcs.values())
		if (!a.isConstruction) primitive(a.id, 'elliptical_arc', a.startPointId, a.endPointId);
	for (const s of sketch.splines.values())
		if (!s.isConstruction && !s.isClosed && s.pointIds.length >= 2)
			primitive(s.id, 'spline', s.pointIds[0], s.pointIds.at(-1)!);
	for (const id of extraIds) if (id !== undefined) add(id);
	const points = ids.map(id => {
		const p = sketch.points.get(id);
		return { listed: listed.has(id), ...(p ? { position: { x: p.x, y: p.y } } : {}) };
	});
	const input: TopologyInput = {
		points,
		links,
		endpoints: primitives.map(p => [p.a, p.b]),
		origin: indices.get('origin')!,
	};
	return { input, ids, indices, primitives };
}

export function orderedCoincidentGroup(sketch: SketchDocument, pointId: string): Set<string> {
	const kernel = getGeometryKernel().topology;
	if (!kernel) throw new Error('Offset topology requires the Rust/WASM kernel');
	const data = collect(sketch, [pointId]);
	return new Set(kernel.group(data.input, data.indices.get(pointId)!, POINT_TOLERANCE).map(i => data.ids[i]));
}

/** A call-local snapshot avoids stale coordinates and repeats no document traversal per chain vertex. */
export function createOffsetTopology(
	sketch: SketchDocument,
	extraIds: readonly (string | undefined)[] = []
): OffsetTopology {
	const kernel = getGeometryKernel().topology;
	if (!kernel) throw new Error('Offset topology requires the Rust/WASM kernel');
	const data = collect(sketch, extraIds);
	const snapshot = kernel.prepare(data.input, POINT_TOLERANCE);
	const groups = snapshot.groups.map(g => ({
		members: new Set(g.members.map(i => data.ids[i])),
		connections: g.connections.map(c => ({
			id: data.primitives[c.primitive].id,
			type: data.primitives[c.primitive].type,
			connectedPointId: data.ids[c.connected],
			otherPointId: data.ids[c.other],
		})),
	}));
	const group = (id: string) => groups[snapshot.labels[data.indices.get(id)!]];
	return {
		group: id => group(id).members,
		connected: (id, exclude) => group(id).connections.filter(c => c.id !== exclude),
	};
}

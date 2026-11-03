import type { SketchDocument } from '../model/sketch';
import type { Vec2 } from './vector';
import { getAllGeoCurves, getPointAtParam, getParamAtPoint, intersectCurves } from './intersection';

export interface SketchRegion {
	points: Vec2[];
	holes: Vec2[][];
	area: number;
	path: string;
}

const KEY_SCALE = 1e5;
const key = (p: Vec2) => `${Math.round(p.x * KEY_SCALE)},${Math.round(p.y * KEY_SCALE)}`;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const polygonArea = (points: Vec2[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;
function pointInPolygon(point: Vec2, points: Vec2[]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		if ((points[i].y > point.y) !== (points[j].y > point.y) && point.x < (points[j].x - points[i].x) * (point.y - points[i].y) / (points[j].y - points[i].y) + points[i].x) inside = !inside;
	}
	return inside;
}
const ringPath = (points: Vec2[]) => `M ${points.map(p => `${p.x.toFixed(5)} ${(-p.y).toFixed(5)}`).join(' L ')} Z`;
function intersectionCut(curve: ReturnType<typeof getAllGeoCurves>[number], point: Vec2): { t: number; p: Vec2 } {
	if (curve.type === 'arc' || curve.type === 'elliptical_arc') {
		const tolerance = curve.type === 'arc' ? Math.max(1e-3, curve.radius * 2e-4) : 2e-3;
		if (Math.hypot(point.x - curve.start.x, point.y - curve.start.y) < tolerance) return { t: 0, p: curve.start };
		if (Math.hypot(point.x - curve.end.x, point.y - curve.end.y) < tolerance) return { t: 1, p: curve.end };
	}
	return { t: getParamAtPoint(curve, point), p: point };
}
function curvePointAt(item: { curve: ReturnType<typeof getAllGeoCurves>[number]; periodic: boolean }, param: number): Vec2 {
	if (item.curve.type === 'spline' && item.periodic && (param < 0 || param > 1)) {
		param = ((param % 1) + 1) % 1;
	}
	return getPointAtParam(item.curve, param);
}

/** Finds bounded faces in the planar arrangement of sketch curves. Curves are flattened
 * into short chords; the resulting region boundaries are therefore SVG-ready polylines. */
export function findSketchRegions(sketch: SketchDocument): SketchRegion[] {
	const curves = getAllGeoCurves(sketch).filter((c) => !c.isConstruction);
	const segments: Array<{ a: Vec2; b: Vec2; cuts: Array<{ t: number; p: Vec2 }> }> = [];
	const params = curves.map((curve) => {
		const periodic = curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && curve.isClosed);
		return { curve, periodic, period: curve.type === 'circle' || curve.type === 'ellipse' ? 2 * Math.PI : 1, cuts: [] as Array<{ t: number; p: Vec2 }> };
	});
	for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
		for (const p of intersectCurves(curves[i], curves[j])) {
			params[i].cuts.push(intersectionCut(curves[i], p));
			params[j].cuts.push(intersectionCut(curves[j], p));
		}
	}
	for (const item of params) {
		const { curve, periodic, period } = item;
		const unique = item.cuts.sort((a, b) => a.t - b.t).filter((cut, i, all) => i === 0 || Math.abs(cut.t - all[i - 1].t) > 1e-6);
		const intervals: Array<[number, Vec2, number, Vec2]> = [];
		if (periodic) {
			if (!unique.length) intervals.push([0, getPointAtParam(curve, 0), period, getPointAtParam(curve, 0)]);
			else for (let i = 0; i < unique.length; i++) {
				const a = unique[i], b = unique[(i + 1) % unique.length];
				intervals.push([a.t, a.p, i + 1 < unique.length ? b.t : b.t + period, b.p]);
			}
		} else {
			const cuts = [{ t: 0, p: getPointAtParam(curve, 0) }, ...unique, { t: 1, p: getPointAtParam(curve, 1) }];
			for (let i = 0; i < cuts.length - 1; i++) intervals.push([cuts[i].t, cuts[i].p, cuts[i + 1].t, cuts[i + 1].p]);
		}
		for (const [t0, p0, t1, p1] of intervals) {
			const count = curve.type === 'segment' ? 1 : Math.max(1, Math.ceil((curve.type === 'arc' || curve.type === 'elliptical_arc' ? 48 : 96) * Math.abs(t1 - t0) / period));
			let prev = p0;
			for (let k = 1; k <= count; k++) {
				const next = k === count ? p1 : curvePointAt(item, t0 + (t1 - t0) * k / count);
				if (Math.hypot(next.x - prev.x, next.y - prev.y) > 1e-7) segments.push({ a: prev, b: next, cuts: [{ t: 0, p: prev }, { t: 1, p: next }] });
				prev = next;
			}
		}
	}
	const nodes = new Map<string, Vec2>(), edges = new Map<string, Set<string>>();
	const addEdge = (a: Vec2,b: Vec2) => { const ka=key(a),kb=key(b); if(ka===kb)return; nodes.set(ka,a);nodes.set(kb,b);(edges.get(ka)??(edges.set(ka,new Set()),edges.get(ka)!)).add(kb);(edges.get(kb)??(edges.set(kb,new Set()),edges.get(kb)!)).add(ka); };
	for (const s of segments) { s.cuts.sort((a,b)=>a.t-b.t); for(let i=0;i<s.cuts.length-1;i++) addEdge(s.cuts[i].p,s.cuts[i+1].p); }
	// Open strokes and dangling branches do not bound faces. Remove graph bridges
	// before walking faces so dead ends cannot distort the region boundary traversal.
	const bridges = new Set<string>();
	const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
	const discovery = new Map<string, number>(), low = new Map<string, number>();
	let time = 0;
	const findBridges = (node: string, parent: string | null) => {
		discovery.set(node, ++time); low.set(node, time);
		for (const next of edges.get(node) ?? []) {
			if (next === parent) continue;
			if (!discovery.has(next)) {
				findBridges(next, node);
				low.set(node, Math.min(low.get(node)!, low.get(next)!));
				if (low.get(next)! > discovery.get(node)!) bridges.add(edgeKey(node, next));
			} else low.set(node, Math.min(low.get(node)!, discovery.get(next)!));
		}
	};
	for (const node of edges.keys()) if (!discovery.has(node)) findBridges(node, null);
	for (const [node, adjacent] of edges) for (const next of adjacent) if (bridges.has(edgeKey(node, next))) adjacent.delete(next);
	const visited = new Set<string>(), loops: Array<{ points: Vec2[]; area: number }> = [];
	for (const [from, adjacent] of edges) for (const to of adjacent) {
		const edgeId = (a:string,b:string)=>`${a}>${b}`; if(visited.has(edgeId(from,to)))continue;
		const loop: Vec2[]=[]; const localEdges = new Set<string>(); let a=from,b=to, guard=0;
		while(guard++<10000){ const id=edgeId(a,b); if(localEdges.has(id))break; localEdges.add(id); loop.push(nodes.get(a)!);
			const around=[...(edges.get(b)??[])].sort((u,v)=>Math.atan2(nodes.get(u)!.y-nodes.get(b)!.y,nodes.get(u)!.x-nodes.get(b)!.x)-Math.atan2(nodes.get(v)!.y-nodes.get(b)!.y,nodes.get(v)!.x-nodes.get(b)!.x));
			const index=around.indexOf(a); if(index<0||!around.length)break; const next=around[(index-1+around.length)%around.length]; a=b;b=next; if(a===from&&b===to)break;
		}
		for (const id of localEdges) visited.add(id);
		if(loop.length<3||a!==from||b!==to)continue;
		let area=0; for(let i=0;i<loop.length;i++)area+=cross(loop[i],loop[(i+1)%loop.length]); area/=2;
		if(area<=1e-7)continue;
		loops.push({ points: loop, area });
	}
	// Disconnected nested contours are separate graph components. Build a parent tree
	// so each bounded face gets direct child contours as holes while each child remains
	// a region of its own.
	const parents = loops.map((loop, i) => {
		let parent = -1;
		for (let j = 0; j < loops.length; j++) {
			if (i === j || loops[j].area <= loop.area) continue;
			// Faces created by intersecting curves share their exact intersection
			// vertices. They are adjacent, not nested, even if a boundary vertex
			// happens to pass the point-in-polygon test.
			const sharesBoundary = loop.points.some((p) => loops[j].points.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-4));
			if (sharesBoundary) continue;
			if (pointInPolygon(loop.points[0], loops[j].points) && (parent < 0 || loops[j].area < loops[parent].area)) parent = j;
		}
		return parent;
	});
	return loops.map((loop, i) => {
		const holes = loops.filter((_, child) => parents[child] === i).map(child => child.points);
		const path = [ringPath(loop.points), ...holes.map(ringPath)].join(' ');
		return { points: loop.points, holes, area: loop.area - holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0), path };
	});
}

export function pointInRegion(point: Vec2, region: SketchRegion): boolean {
	return pointInPolygon(point, region.points) && !region.holes.some((hole) => pointInPolygon(point, hole));
}

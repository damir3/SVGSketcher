import type { SketchDocument } from '../model/sketch';
import { Vec2 } from './vector';
import { ellipseAxes, ellipseParameterAtPoint } from './ellipse';
import { getAllGeoCurves, getPointAtParam, getParamAtPoint, intersectCurves } from './intersection';
import { extractSplineInterval, type BezierSegment } from './spline';

export interface SketchRegion {
	points: Vec2[];
	holes: Vec2[][];
	area: number;
	path: string;
}

const KEY_SCALE = 1e5;
const key = (p: Vec2) => `${Math.round(p.x * KEY_SCALE)},${Math.round(p.y * KEY_SCALE)}`;
const polygonArea = (points: Vec2[]) =>
	points.reduce((sum, p, i) => sum + p.cross(points[(i + 1) % points.length]), 0) / 2;
function pointInPolygon(point: Vec2, points: Vec2[]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		if (
			points[i].y > point.y !== points[j].y > point.y &&
			point.x < ((points[j].x - points[i].x) * (point.y - points[i].y)) / (points[j].y - points[i].y) + points[i].x
		)
			inside = !inside;
	}
	return inside;
}
type RegionCurve = ReturnType<typeof getAllGeoCurves>[number];
interface BoundaryEdge {
	curve: RegionCurve;
	t0: number;
	t1: number;
	from: string;
	to: string;
}
function pointText(p: Vec2): string {
	return `${p.x.toFixed(5)} ${(-p.y).toFixed(5)}`;
}
function exactRingPath(points: Vec2[], edges: BoundaryEdge[]): string {
	let d = `M ${pointText(points[0])}`;
	const oriented = edges.map((edge, i) => {
		if (!edge) return null;
		const forward = key(points[i]) === edge.from;
		return {
			edge,
			forward,
			a: forward ? edge.t0 : edge.t1,
			b: forward ? edge.t1 : edge.t0,
			start: i,
			end: (i + 1) % points.length,
		};
	});
	const runs: Array<NonNullable<(typeof oriented)[number]>> = [];
	for (let i = 0; i < oriented.length; i++) {
		const item = oriented[i];
		if (!item) {
			d += ` L ${pointText(points[(i + 1) % points.length])}`;
			continue;
		}
		let run = { ...item };
		while (i + 1 < oriented.length) {
			const next = oriented[i + 1];
			if (!next || next.edge.curve.id !== run.edge.curve.id || Math.abs(run.b - next.a) > 1e-6) break;
			run = { ...run, b: next.b, end: next.end };
			i++;
		}
		runs.push(run);
	}
	for (const run of runs) {
		const curve = run.edge.curve,
			end = points[run.end];
		if (curve.type === 'segment') {
			d += ` L ${pointText(end)}`;
			continue;
		}
		if (curve.type === 'spline') {
			const lo = Math.min(run.a, run.b),
				hi = Math.max(run.a, run.b);
			const pieces =
				hi <= 1
					? extractSplineInterval(curve.bezierSegments, lo, hi)
					: [
							...extractSplineInterval(curve.bezierSegments, lo % 1, 1),
							...extractSplineInterval(curve.bezierSegments, 0, hi % 1),
						];
			const ordered = run.forward ? pieces : [...pieces].reverse();
			for (let i = 0; i < ordered.length; i++) {
				const piece = ordered[i];
				const bezier = run.forward ? piece : ([piece[3], piece[2], piece[1], piece[0]] as BezierSegment);
				d += ` C ${pointText(bezier[1])} ${pointText(bezier[2])} ${pointText(i === ordered.length - 1 ? end : bezier[3])}`;
			}
			continue;
		}
		let rx: number,
			ry: number,
			rotation = 0,
			sweep: number;
		if (curve.type === 'circle' || curve.type === 'arc') {
			rx = ry = curve.radius;
			sweep = curve.type === 'circle' ? (run.forward ? 1 : 0) : curve.clockwise === run.forward ? 1 : 0;
		} else {
			const center = curve.center,
				major = curve.majorAxisPoint,
				minor = curve.minorAxisPoint;
			const r = center.distancesTo(major, minor);
			rx = r.x;
			ry = r.y;
			rotation = -center.angleToPointDeg(major);
			sweep = curve.type === 'ellipse' ? (run.forward ? 1 : 0) : curve.clockwise === run.forward ? 1 : 0;
		}
		const span =
			Math.abs(run.b - run.a) * (curve.type === 'arc' || curve.type === 'elliptical_arc' ? getArcSweep(curve) : 1);
		const arcCommand = (to: Vec2, arcSpan: number) =>
			` A ${rx.toFixed(5)} ${ry.toFixed(5)} ${rotation.toFixed(5)} ${arcSpan > Math.PI ? 1 : 0} ${sweep} ${pointText(to)}`;
		if (end.distanceTo(points[run.start]) < 1e-5 && span > Math.PI * 1.99) {
			const mid = getPointAtParam(curve, (run.a + run.b) / 2);
			d += arcCommand(mid, span / 2) + arcCommand(end, span / 2);
		} else d += arcCommand(end, span);
	}
	return `${d} Z`;
}
function getArcSweep(curve: Extract<RegionCurve, { type: 'arc' | 'elliptical_arc' }>): number {
	if (curve.type === 'elliptical_arc') {
		const center = new Vec2(curve.center.x, -curve.center.y);
		const major = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const minor = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const start = new Vec2(curve.start.x, -curve.start.y);
		const end = new Vec2(curve.end.x, -curve.end.y);
		const r = Vec2.from(center).distancesTo(major, minor);
		const { axisU, axisV } = ellipseAxes(Vec2.from(center).angleToPoint(major));
		const paramRadii = new Vec2(Math.max(r.x, 1e-6), Math.max(r.y, 1e-6));
		const ts = ellipseParameterAtPoint(start, center, paramRadii, axisU, axisV);
		const te = ellipseParameterAtPoint(end, center, paramRadii, axisU, axisV);
		let sweep = curve.clockwise ? (te - ts) % (2 * Math.PI) : (ts - te) % (2 * Math.PI);
		return sweep < 0 ? sweep + 2 * Math.PI : sweep;
	}
	const angle = (point: Vec2) => -curve.center.angleToPoint(point);
	const start = angle(curve.start),
		end = angle(curve.end);
	let sweep = curve.clockwise ? (end - start) % (2 * Math.PI) : (start - end) % (2 * Math.PI);
	if (sweep < 0) sweep += 2 * Math.PI;
	return sweep;
}
function intersectionCut(curve: ReturnType<typeof getAllGeoCurves>[number], point: Vec2): { t: number; p: Vec2 } {
	if (curve.type === 'arc' || curve.type === 'elliptical_arc') {
		const tolerance = curve.type === 'arc' ? Math.max(1e-3, curve.radius * 2e-4) : 2e-3;
		if (curve.start.distanceTo(point) < tolerance) return { t: 0, p: curve.start };
		if (curve.end.distanceTo(point) < tolerance) return { t: 1, p: curve.end };
	} else if (curve.type === 'spline' && !curve.isClosed) {
		const start = curve.bezierSegments[0]?.[0];
		const end = curve.bezierSegments.at(-1)?.[3];
		if (start && point.distanceTo(start) <= 1 / KEY_SCALE) return { t: 0, p: start };
		if (end && point.distanceTo(end) <= 1 / KEY_SCALE) return { t: 1, p: end };
	}
	return { t: getParamAtPoint(curve, point), p: point };
}
function curvePointAt(
	item: { curve: ReturnType<typeof getAllGeoCurves>[number]; periodic: boolean },
	param: number
): Vec2 {
	// Keep bounded-curve endpoints attached to their sketch vertices. Arc endpoints
	// can be a little off the ideal radius after solving/import, while adjacent
	// curves still use the exact same endpoint coordinates.
	if (!item.periodic && (item.curve.type === 'arc' || item.curve.type === 'elliptical_arc')) {
		if (param <= 0) return item.curve.start;
		if (param >= 1) return item.curve.end;
	}
	if (item.curve.type === 'spline' && item.periodic && (param < 0 || param > 1)) {
		param = ((param % 1) + 1) % 1;
	}
	return getPointAtParam(item.curve, param);
}

/** Finds bounded faces in the planar arrangement of sketch curves. Curves are flattened
 * into short chords; the resulting region boundaries are therefore SVG-ready polylines. */
export function findSketchRegions(sketch: SketchDocument): SketchRegion[] {
	return findCurveRegions(getAllGeoCurves(sketch).filter(c => !c.isConstruction));
}

export function findCurveRegions(curves: RegionCurve[]): SketchRegion[] {
	const segments: Array<{ a: Vec2; b: Vec2; curve: RegionCurve; t0: number; t1: number }> = [];
	const params = curves.map(curve => {
		const periodic = curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && curve.isClosed);
		return {
			curve,
			periodic,
			period: curve.type === 'circle' || curve.type === 'ellipse' ? 2 * Math.PI : 1,
			cuts: [] as Array<{ t: number; p: Vec2 }>,
		};
	});
	for (let i = 0; i < curves.length; i++)
		for (let j = i + 1; j < curves.length; j++) {
			for (const p of intersectCurves(curves[i], curves[j])) {
				params[i].cuts.push(intersectionCut(curves[i], p));
				params[j].cuts.push(intersectionCut(curves[j], p));
			}
		}
	for (const item of params) {
		const { curve, periodic, period } = item;
		const unique = item.cuts
			.sort((a, b) => a.t - b.t)
			.filter((cut, i, all) => i === 0 || Math.abs(cut.t - all[i - 1].t) > 1e-6);
		const intervals: Array<[number, Vec2, number, Vec2]> = [];
		if (periodic) {
			if (!unique.length) intervals.push([0, getPointAtParam(curve, 0), period, getPointAtParam(curve, 0)]);
			else
				for (let i = 0; i < unique.length; i++) {
					const a = unique[i],
						b = unique[(i + 1) % unique.length];
					intervals.push([a.t, a.p, i + 1 < unique.length ? b.t : b.t + period, b.p]);
				}
		} else {
			const cuts = [{ t: 0, p: curvePointAt(item, 0) }, ...unique, { t: 1, p: curvePointAt(item, 1) }];
			for (let i = 0; i < cuts.length - 1; i++) intervals.push([cuts[i].t, cuts[i].p, cuts[i + 1].t, cuts[i + 1].p]);
		}
		for (const [t0, p0, t1, p1] of intervals) {
			const count =
				curve.type === 'segment'
					? 1
					: Math.max(
							1,
							Math.ceil(
								((curve.type === 'arc' || curve.type === 'elliptical_arc' ? 48 : 96) * Math.abs(t1 - t0)) / period
							)
						);
			let prev = p0;
			for (let k = 1; k <= count; k++) {
				const next = k === count ? p1 : curvePointAt(item, t0 + ((t1 - t0) * k) / count);
				if (prev.distanceTo(next) > 1e-7) {
					const nextT = t0 + ((t1 - t0) * k) / count;
					const prevT = t0 + ((t1 - t0) * (k - 1)) / count;
					segments.push({ a: prev, b: next, curve, t0: prevT, t1: nextT });
				}
				prev = next;
			}
		}
	}
	const nodes = new Map<string, Vec2>(),
		edges = new Map<string, Set<string>>(),
		edgeSources = new Map<string, BoundaryEdge>();
	const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
	const nodeKey = (point: Vec2): string => {
		const x = Math.round(point.x * KEY_SCALE);
		const y = Math.round(point.y * KEY_SCALE);
		const ownKey = `${x},${y}`;
		if (nodes.has(ownKey)) return ownKey;
		// Coincident endpoints can straddle a rounding boundary after solving.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const neighborKey = `${x + dx},${y + dy}`;
				const neighbor = nodes.get(neighborKey);
				if (neighbor && point.distanceTo(neighbor) <= 1 / KEY_SCALE) return neighborKey;
			}
		}
		nodes.set(ownKey, point);
		return ownKey;
	};
	const addEdge = (segment: (typeof segments)[number]) => {
		const ka = nodeKey(segment.a),
			kb = nodeKey(segment.b);
		if (ka === kb) return;
		(edges.get(ka) ?? (edges.set(ka, new Set()), edges.get(ka)!)).add(kb);
		(edges.get(kb) ?? (edges.set(kb, new Set()), edges.get(kb)!)).add(ka);
		edgeSources.set(edgeKey(ka, kb), {
			curve: segment.curve,
			t0: segment.t0,
			t1: segment.t1,
			from: ka,
			to: kb,
		});
	};
	for (const segment of segments) addEdge(segment);
	// Open strokes and dangling branches do not bound faces. Remove graph bridges
	// before walking faces so dead ends cannot distort the region boundary traversal.
	const bridges = new Set<string>();
	const discovery = new Map<string, number>(),
		low = new Map<string, number>();
	let time = 0;
	const visit = (node: string) => {
		discovery.set(node, ++time);
		low.set(node, time);
		return { node, neighbors: edges.get(node)!.values() };
	};
	for (const root of edges.keys()) {
		if (discovery.has(root)) continue;
		const stack = [visit(root)];
		while (stack.length > 0) {
			const { node, neighbors } = stack[stack.length - 1];
			const parent = stack[stack.length - 2]?.node;
			const step = neighbors.next();
			if (step.done) {
				stack.pop();
				if (parent !== undefined) {
					low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
					if (low.get(node)! > discovery.get(parent)!) bridges.add(edgeKey(parent, node));
				}
			} else if (step.value !== parent) {
				const seen = discovery.get(step.value);
				if (seen === undefined) stack.push(visit(step.value));
				else low.set(node, Math.min(low.get(node)!, seen));
			}
		}
	}
	for (const [node, adjacent] of edges)
		for (const next of adjacent) if (bridges.has(edgeKey(node, next))) adjacent.delete(next);
	const visited = new Set<string>(),
		loops: Array<{ points: Vec2[]; edges: BoundaryEdge[]; area: number; path: string }> = [];
	for (const [from, adjacent] of edges)
		for (const to of adjacent) {
			const edgeId = (a: string, b: string) => `${a}>${b}`;
			if (visited.has(edgeId(from, to))) continue;
			const loop: Vec2[] = [];
			const loopEdges: BoundaryEdge[] = [];
			const localEdges = new Set<string>();
			let a = from,
				b = to,
				guard = 0;
			while (guard++ < 10000) {
				const id = edgeId(a, b);
				if (localEdges.has(id)) break;
				localEdges.add(id);
				loop.push(nodes.get(a)!);
				const source = edgeSources.get(edgeKey(a, b));
				if (source) loopEdges.push(source);
				const around = [...(edges.get(b) ?? [])].sort(
					(u, v) => nodes.get(b)!.angleToPoint(nodes.get(u)!) - nodes.get(b)!.angleToPoint(nodes.get(v)!)
				);
				const index = around.indexOf(a);
				if (index < 0 || !around.length) break;
				const next = around[(index - 1 + around.length) % around.length];
				a = b;
				b = next;
				if (a === from && b === to) break;
			}
			for (const id of localEdges) visited.add(id);
			if (loop.length < 3 || a !== from || b !== to) continue;
			let area = 0;
			for (let i = 0; i < loop.length; i++) area += loop[i].cross(loop[(i + 1) % loop.length]);
			area /= 2;
			if (area <= 1e-7) continue;
			loops.push({
				points: loop,
				edges: loopEdges,
				area,
				path: exactRingPath(loop, loopEdges),
			});
		}
	// Disconnected nested contours are separate graph components. Build a parent tree
	// so each bounded face gets direct child contours as holes while each child remains
	// a region of its own.
	const parents = loops.map(loop => {
		let parent = -1;
		for (let j = 0; j < loops.length; j++) {
			if (loops[j].area <= loop.area || (parent >= 0 && loops[j].area >= loops[parent].area)) continue;
			if (!pointInPolygon(loop.points[0], loops[j].points)) continue;
			// Faces created by intersecting curves share their exact intersection
			// vertices. They are adjacent, not nested, even if a boundary vertex
			// happens to pass the point-in-polygon test.
			const sharesBoundary = loop.points.some(p =>
				loops[j].points.some(q => {
					const dx = p.x - q.x;
					return Math.abs(dx) < 1e-4 && Math.hypot(dx, p.y - q.y) < 1e-4;
				})
			);
			if (!sharesBoundary) parent = j;
		}
		return parent;
	});
	return loops.map((loop, i) => {
		const holeLoops = loops.filter((_, child) => parents[child] === i);
		const holes = holeLoops.map(hole => hole.points);
		const path = [loop.path, ...holeLoops.map(hole => hole.path)].join(' ');
		return {
			points: loop.points,
			holes,
			area: loop.area - holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0),
			path,
		};
	});
}

export function pointInRegion(point: Vec2, region: SketchRegion): boolean {
	return pointInPolygon(point, region.points) && !region.holes.some(hole => pointInPolygon(point, hole));
}

import type { OffsetKernelItem, KernelOffsetResult, KernelOffsetPrimitive } from '../kernel/offsetTypes';
import { Vec2 } from './vector';
import { fitOffsetNodes, OFFSET_FIT_TOLERANCE } from './offsetFit';
import { splitOffsetContours } from './offsetContours';
import {
	getSplinePointAtParam,
	getSplineTangentAtParam,
	splitBezier,
	fitPointsToBezier,
	type BezierSegment,
} from './splineReference';

interface Node {
	p: Vec2;
	n: Vec2;
	t: Vec2;
	corner: boolean;
}
const lerp = (a: Vec2, b: Vec2, t: number) => a.clone().lerp(b, t);
function between(a: Node, b: Node, t: number): Node {
	return {
		p: lerp(a.p, b.p, t),
		n: lerp(a.n, b.n, t).normalizeOrUnitX(),
		t: lerp(a.t, b.t, t).normalizeOrUnitX(),
		corner: false,
	};
}
function intersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
	const u = b.clone().sub(a),
		v = d.clone().sub(c),
		delta = c.clone().sub(a);
	const det = u.cross(v);
	if (Math.abs(det) < 1e-12) return null;
	const t = delta.cross(v) / det,
		s = delta.cross(u) / det;
	return t >= -1e-9 && t <= 1 + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 ? Math.max(0, Math.min(1, t)) : null;
}
function removeLoops(nodes: Node[]): Node[] {
	const out: Node[] = [];
	for (const q of nodes) {
		let again = true;
		while (again && out.length > 2) {
			again = false;
			for (let i = 0; i < out.length - 2; i++) {
				// The repeated endpoint of a closed source is a seam, not a loop.
				if (i === 0 && q.p.distanceTo(out[0].p) < 1e-8) continue;
				const t = intersection(out[i].p, out[i + 1].p, out.at(-1)!.p, q.p);
				if (t === null) continue;
				const hit = between(out[i], out[i + 1], t);
				hit.corner = true;
				out.splice(i + 1);
				if (out[i].p.distanceTo(hit.p) > 1e-8) out.push(hit);
				else out[i].corner = true;
				again = true;
				break;
			}
		}
		if (!out.length || out.at(-1)!.p.distanceTo(q.p) > 1e-8) out.push(q);
	}
	return out;
}
// Keep every valid component when erosion separates a closed spline at a narrow neck.
// Loop removal for an open path cannot do this: the popped section may be another boundary.
function closedContours(nodes: Node[], d: number): Node[][] {
	const pending = [nodes],
		loops: Node[][] = [];
	while (pending.length) {
		const ring = pending.pop()!;
		let split = false;
		search: for (let i = 0; i + 1 < ring.length; i++)
			for (let j = i + 2; j + 1 < ring.length; j++) {
				if (i === 0 && j === ring.length - 2) continue;
				const [aa, ab, ba, bb] = [ring[i].p, ring[i + 1].p, ring[j].p, ring[j + 1].p];
				if (
					Math.max(aa.x, ab.x) < Math.min(ba.x, bb.x) - 1e-9 ||
					Math.max(ba.x, bb.x) < Math.min(aa.x, ab.x) - 1e-9 ||
					Math.max(aa.y, ab.y) < Math.min(ba.y, bb.y) - 1e-9 ||
					Math.max(ba.y, bb.y) < Math.min(aa.y, ab.y) - 1e-9
				)
					continue;
				const t = intersection(ring[i].p, ring[i + 1].p, ring[j].p, ring[j + 1].p);
				if (t === null) continue;
				const a = between(ring[i], ring[i + 1], t),
					delta = ring[j + 1].p.clone().sub(ring[j].p),
					u = delta.lengthSq() > 1e-20 ? a.p.clone().sub(ring[j].p).dot(delta) / delta.lengthSq() : 0,
					b = between(ring[j], ring[j + 1], Math.max(0, Math.min(1, u)));
				a.corner = b.corner = true;
				b.p = a.p.clone();
				const pieces = [
					[a, ...ring.slice(i + 1, j + 1), b],
					[b, ...ring.slice(j + 1, -1), ...ring.slice(0, i + 1), a],
				].map(v => v.filter((n, k) => !k || n.p.distanceTo(v[k - 1].p) > 1e-8));
				// Tangencies and duplicate samples must not produce a non-progressing split.
				if (pieces.some(v => v.length < 4 || v.length >= ring.length)) continue;
				pending.push(...pieces);
				split = true;
				break search;
			}
		if (!split) loops.push(ring);
	}
	if (loops.length < 2) return loops;
	const source = nodes.map(n => n.p.clone().addScaledVector(n.n, -d));
	const area = (v: Vec2[]) => v.reduce((sum, p, i) => sum + p.cross(v[(i + 1) % v.length]), 0);
	const sourceArea = area(source),
		inward = sourceArea * nodes[0].t.clone().perpendicular().dot(nodes[0].n) * d > 0;
	const inside = (p: Vec2) => {
		let odd = false;
		for (let i = 0, j = source.length - 1; i < source.length; j = i++) {
			const a = source[i],
				b = source[j];
			if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
		}
		return odd;
	};
	const valid = loops.filter(loop => {
		const loopArea = area(loop.map(n => n.p));
		if (Math.abs(loopArea) < 1e-10 || (inward && loopArea * sourceArea <= 0)) return false;
		const stride = Math.max(1, Math.floor((loop.length - 1) / 64));
		for (let i = 0; i + 1 < loop.length; i += stride) {
			const p = loop[i].p.clone().lerp(loop[i + 1].p, 0.5);
			if (inside(p) !== inward) return false;
			for (let j = 0; j + 1 < source.length; j++) {
				const a = source[j],
					delta = source[j + 1].clone().sub(a),
					len = delta.lengthSq();
				const t = len > 1e-20 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(delta) / len)) : 0;
				if (p.distanceTo(a.clone().addScaledVector(delta, t)) < Math.abs(d) - OFFSET_FIT_TOLERANCE) return false;
			}
		}
		return true;
	});
	// Stable geometric ordering also keeps the surviving document IDs stable across edits.
	const bounds = (v: Node[]) => [Math.min(...v.map(n => n.p.x)), Math.min(...v.map(n => n.p.y))];
	return valid.sort((a, b) => bounds(a)[0] - bounds(b)[0] || bounds(a)[1] - bounds(b)[1]);
}
function writeFitted(prim: KernelOffsetPrimitive, nodes: Node[], d: number): void {
	if (nodes.length < 2) nodes = [nodes[0], { ...nodes[0] }];
	const pieces = fitOffsetNodes(nodes, undefined, !!prim.isSplineClosed),
		indices = [pieces[0].start, ...pieces.map(p => p.end)],
		points = indices.map(i => nodes[i].p);
	prim.fitPoints = points;
	prim.fitNormals = indices.map(i => nodes[i].n);
	prim.fitBases = indices.map((i, k) => points[k].clone().addScaledVector(nodes[i].n, -d));
	prim.startTangent = nodes[0].t;
	prim.endTangent = nodes.at(-1)!.t;
	prim.handles = points.map((p, i) => ({
		h1: i ? pieces[i - 1].curve[2].clone() : p.clone(),
		h2: i < pieces.length ? pieces[i].curve[1].clone() : p.clone(),
	}));
	// Unused endpoint controls still define a valid collinear handle line for fit-spline constraints.
	prim.handles[0].h1 = points[0].clone().multiplyScalar(2).sub(prim.handles[0].h2);
	prim.handles.at(-1)!.h2 = points.at(-1)!.clone().multiplyScalar(2).sub(prim.handles.at(-1)!.h1);
	if (prim.isSplineClosed) {
		const seam = { h1: Vec2.from(prim.handles.at(-1)!.h1), h2: Vec2.from(prim.handles[0].h2) };
		prim.handles[0] = seam;
		prim.handles[prim.handles.length - 1] = { h1: seam.h1.clone(), h2: seam.h2.clone() };
	}
}
/** Refine compact cubics exactly when an existing document has more fit-point IDs. */
export function resizeOffsetSpline(prim: KernelOffsetPrimitive, count: number, d: number): void {
	if (!prim.fitPoints || !prim.fitNormals || !prim.handles || prim.fitPoints.length >= count) return;
	const points = prim.fitPoints.map(Vec2.from),
		normals = prim.fitNormals.map(Vec2.from),
		handles = prim.handles.map(h => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }));
	while (points.length < count) {
		let index = 0,
			best = -1;
		for (let i = 0; i + 1 < points.length; i++) {
			const length =
				points[i].distanceTo(handles[i].h2) +
				handles[i].h2.distanceTo(handles[i + 1].h1) +
				handles[i + 1].h1.distanceTo(points[i + 1]);
			if (length > best) {
				best = length;
				index = i;
			}
		}
		const { left, right } = splitBezier(
			[points[index], handles[index].h2, handles[index + 1].h1, points[index + 1]],
			0.5
		);
		handles[index].h2 = left[1];
		handles[index + 1].h1 = right[2];
		points.splice(index + 1, 0, left[3]);
		normals.splice(
			index + 1,
			0,
			normals[index]
				.clone()
				.lerp(normals[index + 1], 0.5)
				.normalizeOrUnitX()
		);
		handles.splice(index + 1, 0, { h1: left[2], h2: right[1] });
	}
	if (prim.isSplineClosed) {
		const seam = { h1: handles.at(-1)!.h1.clone(), h2: handles[0].h2.clone() };
		handles[0] = seam;
		handles[handles.length - 1] = { h1: seam.h1.clone(), h2: seam.h2.clone() };
	}
	prim.fitPoints = points;
	prim.fitNormals = normals;
	prim.fitBases = points.map((p, i) => p.clone().addScaledVector(normals[i], -d));
	prim.handles = handles;
}

interface Path {
	nodes: Node[];
	closed: boolean;
}
function crop(path: Path, index: number, t: number, start: boolean, point?: Vec2): void {
	const hit = between(path.nodes[index], path.nodes[index + 1], t);
	if (point) hit.p = point.clone();
	path.nodes = start ? [hit, ...path.nodes.slice(index + 1)] : [...path.nodes.slice(0, index + 1), hit];
	// Avoid a zero length interval at a sampled endpoint.
	path.nodes = path.nodes.filter((n, i, v) => i === 0 || n.p.distanceTo(v[i - 1].p) > 1e-8);
	if (path.nodes.length < 2) path.nodes.push({ ...hit });
}
function extend(path: Path, point: Vec2, start: boolean): void {
	const end = start ? path.nodes[0] : path.nodes.at(-1)!;
	if (end.p.distanceTo(point) < 1e-8) {
		end.p = point.clone();
		return;
	}
	// Keep the exact end of the parallel curve before the straight miter extension.
	end.corner = true;
	const join = { ...end, p: point.clone(), corner: true };
	if (start) path.nodes.unshift(join);
	else path.nodes.push(join);
}
function roots(a: Vec2, delta: Vec2, center: Vec2, radius: number): number[] {
	const v = a.clone().sub(center),
		aa = delta.lengthSq(),
		b = v.dot(delta),
		c = v.lengthSq() - radius * radius;
	if (aa < 1e-20) return [];
	const disc = b * b - aa * c;
	if (disc < -1e-9) return [];
	const h = Math.sqrt(Math.max(0, disc));
	return [(-b - h) / aa, (-b + h) / aa];
}
function arcContains(arc: KernelOffsetPrimitive, p: Vec2): boolean {
	const center = Vec2.from(arc.center!);
	const angle = (p: Vec2) => Math.atan2(p.y - center.y, p.x - center.x);
	const sweep = (a: number, b: number) => {
		let v = arc.clockwise ? a - b : b - a;
		while (v < 0) v += 2 * Math.PI;
		return v;
	};
	return (
		sweep(angle(Vec2.from(arc.start!)), angle(p)) <=
		sweep(angle(Vec2.from(arc.start!)), angle(Vec2.from(arc.end!))) + 1e-7
	);
}
function joinAnalytic(path: Path, shape: KernelOffsetPrimitive, start: boolean, d: number): void {
	if (shape.type !== 'line' && shape.type !== 'arc') {
		if (shape.fitPoints) extend(path, Vec2.from(start ? shape.fitPoints.at(-1)! : shape.fitPoints[0]), start);
		return;
	}
	const nodes = path.nodes,
		endpoint = start ? nodes[0] : nodes.at(-1)!;
	const near = Vec2.from(shape.type === 'line' ? (start ? shape.p2! : shape.p1!) : start ? shape.end! : shape.start!);
	let best: { i: number; t: number; p: Vec2; score: number } | undefined;
	let walked = 0;
	const limit = 8 * Math.abs(d) + 1e-5;
	for (let k = 0; k < nodes.length - 1; k++) {
		const i = start ? k : nodes.length - 2 - k,
			a = nodes[i].p,
			delta = nodes[i + 1].p.clone().sub(a),
			length = delta.length();
		let ts: number[];
		if (shape.type === 'line') {
			const dir = Vec2.from(shape.p2!).sub(shape.p1!),
				det = delta.cross(dir);
			ts = Math.abs(det) < 1e-12 ? [] : [Vec2.from(shape.p1!).sub(a).cross(dir) / det];
		} else ts = roots(a, delta, Vec2.from(shape.center!), shape.radius!);
		for (const t of ts) {
			if (t < -1e-9 || t > 1 + 1e-9) continue;
			const p = a.clone().addScaledVector(delta, Math.max(0, Math.min(1, t)));
			const removed = walked + length * (start ? t : 1 - t);
			if (removed > limit || p.distanceTo(near) > limit || (shape.type === 'arc' && !arcContains(shape, p))) continue;
			const score = removed + p.distanceTo(near);
			if (!best || score < best.score) best = { i, t: Math.max(0, Math.min(1, t)), p, score };
		}
		walked += length;
		if (walked > limit) break;
	}
	let hit: Vec2;
	if (best) {
		hit = best.p;
		crop(path, best.i, best.t, start, hit);
	} else {
		const dir = endpoint.t.clone().multiplyScalar(start ? -1 : 1);
		if (shape.type === 'line') {
			const lineDir = Vec2.from(shape.p2!).sub(shape.p1!),
				det = dir.cross(lineDir);
			const t = Math.abs(det) < 1e-12 ? NaN : Vec2.from(shape.p1!).sub(endpoint.p).cross(lineDir) / det;
			hit = t >= -1e-7 && t <= limit ? endpoint.p.clone().addScaledVector(dir, t) : near;
		} else {
			const ts = roots(endpoint.p, dir, Vec2.from(shape.center!), shape.radius!).filter(t => t >= -1e-7 && t <= limit);
			const candidates = ts.map(t => endpoint.p.clone().addScaledVector(dir, t));
			candidates.sort((a, b) => a.distanceTo(near) - b.distanceTo(near));
			hit = candidates[0] ?? near;
		}
		extend(path, hit, start);
	}
	if (shape.type === 'line') {
		if (start) shape.p2 = hit;
		else shape.p1 = hit;
	} else {
		if (start) shape.end = hit;
		else shape.start = hit;
	}
}
function joinPaths(a: Path, b: Path, d: number): void {
	const limit = 8 * Math.abs(d) + 1e-5;
	let best: { i: number; j: number; t: number; u: number; score: number; p: Vec2 } | undefined;
	let alongA = 0;
	for (let i = a.nodes.length - 2; i >= 0; i--) {
		const aa = a.nodes[i].p,
			da = a.nodes[i + 1].p.clone().sub(aa),
			la = da.length();
		let alongB = 0;
		for (let j = 0; j + 1 < b.nodes.length; j++) {
			const bb = b.nodes[j].p,
				db = b.nodes[j + 1].p.clone().sub(bb),
				lb = db.length();
			const t = intersection(aa, a.nodes[i + 1].p, bb, b.nodes[j + 1].p);
			if (t !== null) {
				const p = aa.clone().addScaledVector(da, t),
					u = lb > 1e-12 ? p.clone().sub(bb).dot(db) / (lb * lb) : 0;
				const score = alongA + la * (1 - t) + alongB + lb * u;
				if (score <= 2 * limit && (!best || score < best.score))
					best = { i, j, t, u: Math.max(0, Math.min(1, u)), score, p };
			}
			alongB += lb;
			if (alongB > limit) break;
		}
		alongA += la;
		if (alongA > limit) break;
	}
	if (best) {
		crop(a, best.i, best.t, false, best.p);
		crop(b, best.j, best.u, true, best.p);
		return;
	}
	const end = a.nodes.at(-1)!,
		start = b.nodes[0],
		det = end.t.cross(start.t),
		delta = start.p.clone().sub(end.p);
	const t = Math.abs(det) < 1e-12 ? NaN : delta.cross(start.t) / det;
	const u = Math.abs(det) < 1e-12 ? NaN : delta.cross(end.t) / det;
	const p =
		t >= -1e-7 && u <= 1e-7 && Math.abs(t) <= limit && Math.abs(u) <= limit
			? end.p.clone().addScaledVector(end.t, t)
			: end.p.clone().lerp(start.p, 0.5);
	extend(a, p, false);
	extend(b, p, true);
}
// Remove loops spanning several primitives, e.g. a fillet that disappears during erosion.
function trimCollapsedSections(
	paths: (Path | undefined)[],
	primitives: KernelOffsetPrimitive[],
	closed: boolean
): number[] {
	let active = primitives.map((_, i) => i);
	const trace = (i: number): Vec2[] => {
		if (paths[i]) return paths[i]!.nodes.map(n => n.p);
		const p = primitives[i];
		if (p.type === 'line') return [Vec2.from(p.p1!), Vec2.from(p.p2!)];
		if (p.type === 'arc') {
			const c = Vec2.from(p.center!),
				a = c.angleToPoint(p.start!),
				b = c.angleToPoint(p.end!);
			let sweep = p.clockwise ? a - b : b - a;
			while (sweep < 0) sweep += 2 * Math.PI;
			return Array.from({ length: 65 }, (_, j) =>
				Vec2.fromPolar(p.radius!, a + ((p.clockwise ? -1 : 1) * sweep * j) / 64).add(c)
			);
		}
		return p.fitPoints?.map(Vec2.from) ?? [];
	};
	const area = (points: Vec2[]) => points.reduce((sum, p, i) => sum + p.cross(points[(i + 1) % points.length]), 0);
	const cut = (id: number, segment: number, t: number, start: boolean, point: Vec2) => {
		if (paths[id]) crop(paths[id]!, segment, t, start, point);
		else if (start) primitives[id].p1 = point;
		else primitives[id].p2 = point;
	};
	for (;;) {
		const traces = active.map(trace),
			boxes = traces.map(v => ({
				minX: Math.min(...v.map(p => p.x)),
				maxX: Math.max(...v.map(p => p.x)),
				minY: Math.min(...v.map(p => p.y)),
				maxY: Math.max(...v.map(p => p.y)),
			}));
		let found = false;
		search: for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				// Arc intersections are handled locally; here a sampled curve crosses another sampled curve or a line.
				if (
					(!paths[active[i]] && primitives[active[i]].type !== 'line') ||
					(!paths[active[j]] && primitives[active[j]].type !== 'line')
				)
					continue;
				const a = boxes[i],
					b = boxes[j];
				if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
				const aa = traces[i],
					bb = traces[j];
				for (let m = 0; m + 1 < aa.length; m++)
					for (let n = 0; n + 1 < bb.length; n++) {
						const t = intersection(aa[m], aa[m + 1], bb[n], bb[n + 1]);
						if (t === null) continue;
						const p = aa[m].clone().lerp(aa[m + 1], t),
							dir = bb[n + 1].clone().sub(bb[n]),
							u = dir.lengthSq() > 1e-20 ? p.clone().sub(bb[n]).dot(dir) / dir.lengthSq() : 0;
						if (u < -1e-9 || u > 1 + 1e-9) continue;
						if (j === i + 1 && p.distanceTo(aa.at(-1)!) < 1e-7 && p.distanceTo(bb[0]) < 1e-7) continue;
						if (
							closed &&
							i === 0 &&
							j === active.length - 1 &&
							p.distanceTo(aa[0]) < 1e-7 &&
							p.distanceTo(bb.at(-1)!) < 1e-7
						)
							continue;
						const loop = [p, ...aa.slice(m + 1), ...traces.slice(i + 1, j).flat(), ...bb.slice(0, n + 1), p];
						const loopArea = area(loop),
							totalArea = closed ? area(traces.flat()) : Infinity;
						const removeForward = !closed || Math.abs(loopArea) <= Math.abs(totalArea - loopArea);
						cut(active[i], m, t, !removeForward, p);
						cut(active[j], n, Math.max(0, Math.min(1, u)), removeForward, p);
						active = removeForward ? [...active.slice(0, i + 1), ...active.slice(j)] : active.slice(i, j + 1);
						found = true;
						break search;
					}
			}
		if (!found) return active;
	}
}
function joinChain(
	items: readonly OffsetKernelItem[],
	paths: (Path | undefined)[],
	primitives: KernelOffsetPrimitive[],
	closed: boolean,
	d: number
): void {
	// Restore arc endpoints adjacent to sampled curves before evaluating finite intersections.
	for (let i = 0; i < items.length; i++) {
		const curve = items[i].curve,
			prim = primitives[i];
		if (curve?.type !== 'arc' || prim.type !== 'arc') continue;
		const prev = i > 0 ? i - 1 : closed ? items.length - 1 : -1,
			next = i + 1 < items.length ? i + 1 : closed ? 0 : -1,
			center = Vec2.from(prim.center!);
		if (paths[prev])
			prim.start = center.clone().addScaledVector(Vec2.from(curve.start).sub(center).normalizeOrUnitX(), prim.radius!);
		if (paths[next])
			prim.end = center.clone().addScaledVector(Vec2.from(curve.end).sub(center).normalizeOrUnitX(), prim.radius!);
	}
	const n = closed ? items.length : items.length - 1;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % items.length,
			a = paths[i],
			b = paths[j];
		if (i === j) continue;
		if (a && b) joinPaths(a, b, d);
		else if (a) joinAnalytic(a, primitives[j], false, d);
		else if (b) joinAnalytic(b, primitives[i], true, d);
	}
}
/** Native counterpart: build every parallel curve before coordinating shared endpoints. */
export function refineSplineOffsets(
	items: readonly OffsetKernelItem[],
	result: KernelOffsetResult,
	closed: boolean
): KernelOffsetResult {
	for (const side of result.sides) {
		if (!side.isValid) continue;
		const d = side.side * side.distance;
		if (items.length === 1 && items[0].kind === 'ellipse') {
			const prim = side.primitives[0],
				curves = fitPointsToBezier(prim.fitPoints!.map(Vec2.from)),
				count = curves.length * 16;
			const nodes = Array.from({ length: count + 1 }, (_, i) => {
				const t = i / count,
					tangent = getSplineTangentAtParam(curves, t).normalizeOrUnitX();
				return { p: getSplinePointAtParam(curves, t), t: tangent, n: tangent.clone().perpendicular(), corner: false };
			});
			prim.isSplineClosed = true;
			writeFitted(prim, nodes, 0);
			delete prim.fitNormals;
			delete prim.fitBases;
			delete prim.startTangent;
			delete prim.endTangent;
			continue;
		}

		const paths: (Path | undefined)[] = items.map((item, i) => {
			const curve = item.curve,
				prim = side.primitives[i];
			if (
				!curve ||
				(curve.type !== 'spline' && curve.type !== 'elliptical_arc') ||
				!prim.fitNormals ||
				!prim.startTangent
			)
				return;
			const sign = Vec2.from(prim.startTangent).perpendicular().dot(prim.fitNormals[0]) >= 0 ? 1 : -1;
			let at: (param: number) => { p: Vec2; t: Vec2 },
				spans = 4;
			if (curve.type === 'spline') {
				if (!curve.bezierSegments.length) return;
				const segments = curve.bezierSegments.map(b => b.map(Vec2.from) as BezierSegment);
				spans = segments.length;
				at = v => {
					const param = item.reversed ? 1 - v : v;
					let t = getSplineTangentAtParam(segments, param);
					if (t.length() < 1e-12)
						t = getSplinePointAtParam(segments, Math.min(1, param + 1e-5)).sub(
							getSplinePointAtParam(segments, Math.max(0, param - 1e-5))
						);
					return {
						p: getSplinePointAtParam(segments, param),
						t: t.normalizeOrUnitX().multiplyScalar(item.reversed ? -1 : 1),
					};
				};
			} else {
				const center = Vec2.from(curve.center),
					major = Vec2.from(curve.majorAxisPoint).sub(center),
					a = major.length(),
					b = Vec2.from(curve.minorAxisPoint).distanceTo(center),
					u = major.normalizeOrUnitX(),
					v = u.clone().perpendicular();
				const parameter = (p: typeof curve.start) => {
					const q = Vec2.from(p).sub(center);
					return Math.atan2(q.dot(v) / b, q.dot(u) / a);
				};
				const begin = parameter(curve.start),
					end = parameter(curve.end);
				let sweep = curve.clockwise ? begin - end : end - begin;
				while (sweep < 0) sweep += 2 * Math.PI;
				at = s => {
					const t = begin + (curve.clockwise ? -1 : 1) * s * sweep;
					return {
						p: center
							.clone()
							.addScaledVector(u, a * Math.cos(t))
							.addScaledVector(v, b * Math.sin(t)),
						t: u
							.clone()
							.multiplyScalar(-a * Math.sin(t))
							.addScaledVector(v, b * Math.cos(t))
							.normalizeOrUnitX()
							.multiplyScalar(curve.clockwise ? -1 : 1),
					};
				};
			}
			const samples = Math.min(4096, Math.max(128, spans * 128));
			let nodes = Array.from({ length: samples + 1 }, (_, j) => {
				const q = at(j / samples),
					n = q.t.clone().perpendicular().multiplyScalar(sign);
				return { p: q.p.addScaledVector(n, d), n, t: q.t, corner: false };
			});
			const isClosed = curve.type === 'spline' && !!curve.isClosed && items.length === 1;
			if (isClosed) nodes[nodes.length - 1] = { ...nodes[0] };
			if (Math.abs(d) > 1e-12 && !isClosed && !(closed && items.length > 1)) nodes = removeLoops(nodes);
			return { nodes, closed: isClosed };
		});
		if (closed && items.length > 1 && Math.abs(d) > 1e-12) {
			const candidates = side.primitives.map(p => ({ ...p }));
			const candidatePaths = paths.map(path => path && { ...path, nodes: path.nodes.map(n => ({ ...n })) });
			joinChain(items, candidatePaths, candidates, closed, d);
			const contours = splitOffsetContours(items, candidates, paths, candidatePaths, d, writeFitted);
			if (contours) {
				side.primitives = contours;
				continue;
			}
			for (const path of paths) if (path && !path.closed) path.nodes = removeLoops(path.nodes);
		}
		if (closed && paths.length === 1 && paths[0]?.closed && Math.abs(d) > 1e-12) {
			const contours = closedContours(paths[0].nodes, d);
			if (contours.length > 0) {
				side.primitives = contours.map((nodes, contourIndex) => {
					const prim = { ...side.primitives[0], isSplineClosed: true, ...(contourIndex ? { contourIndex } : {}) };
					writeFitted(prim, nodes, d);
					return prim;
				});
				continue;
			}
			paths[0].nodes = removeLoops(paths[0].nodes);
		}
		joinChain(items, paths, side.primitives, closed, d);
		const active = Math.abs(d) > 1e-12 ? trimCollapsedSections(paths, side.primitives, closed) : items.map((_, i) => i);
		for (let i = 0; i < paths.length; i++) {
			const path = paths[i];
			if (!path) continue;
			const prim = side.primitives[i];
			prim.isSplineClosed = path.closed;
			writeFitted(prim, Math.abs(d) > 1e-12 ? removeLoops(path.nodes) : path.nodes, d);
		}
		side.primitives = active.map(i => side.primitives[i]);
	}
	return result;
}

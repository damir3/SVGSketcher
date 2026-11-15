import type { KernelOffsetPrimitive, OffsetKernelItem } from '../kernel/offsetTypes';
import { Vec2, projectPointOntoSegment } from './vector';
import { OFFSET_FIT_TOLERANCE } from './offsetFit';

interface Node {
	p: Vec2;
	n: Vec2;
	t: Vec2;
	corner: boolean;
}
interface Path {
	nodes: Node[];
	closed: boolean;
}
interface Edge {
	source: number;
	a: Node;
	b: Node;
	t0: number;
	t1: number;
	len: number;
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}
const tau = 2 * Math.PI;
function sweep(a: number, b: number, cw: boolean): number {
	let s = cw ? a - b : b - a;
	while (s < 0) s += tau;
	return s;
}
function arcSpan(p: KernelOffsetPrimitive): number {
	const c = Vec2.from(p.center!);
	return sweep(c.angleToPoint(p.start!), c.angleToPoint(p.end!), !!p.clockwise);
}
export function arcNode(p: KernelOffsetPrimitive, t: number): Node {
	const c = Vec2.from(p.center!),
		angle = c.angleToPoint(p.start!) + (p.clockwise ? -1 : 1) * arcSpan(p) * t;
	const n = Vec2.fromPolar(1, angle);
	return {
		p: c.addScaledVector(n, p.radius!),
		n,
		t: n
			.clone()
			.perpendicular()
			.multiplyScalar(p.clockwise ? -1 : 1),
		corner: false,
	};
}
function parameter(p: KernelOffsetPrimitive, q: Vec2): number {
	const c = Vec2.from(p.center!),
		span = arcSpan(p);
	const s = sweep(c.angleToPoint(p.start!), c.angleToPoint(q), !!p.clockwise);
	return (s > tau - 1e-8 ? 0 : s) / span;
}
function at(e: Edge, t: number, primitives: KernelOffsetPrimitive[]): Node {
	const p = primitives[e.source];
	if (p.type === 'arc') return arcNode(p, e.t0 + (e.t1 - e.t0) * t);
	return {
		p: e.a.p.clone().lerp(e.b.p, t),
		n: e.a.n.clone().lerp(e.b.n, t).normalizeOrUnitX(),
		t: e.a.t.clone().lerp(e.b.t, t).normalizeOrUnitX(),
		corner: false,
	};
}
function fraction(e: Edge, p: Vec2, primitives: KernelOffsetPrimitive[]): number {
	const shape = primitives[e.source];
	if (shape.type === 'arc') return (parameter(shape, p) - e.t0) / (e.t1 - e.t0);
	const delta = e.b.p.clone().sub(e.a.p);
	return p.clone().sub(e.a.p).dot(delta) / delta.lengthSq();
}
function makeEdge(source: number, a: Node, b: Node, t0: number, t1: number, primitives: KernelOffsetPrimitive[]): Edge {
	const p = primitives[source],
		isArc = p.type === 'arc',
		span = isArc ? arcSpan(p) * (t1 - t0) : 0,
		len = isArc ? p.radius! * span : a.p.distanceTo(b.p),
		pad = isArc ? (p.radius! * span * span) / 8 + 1e-8 : 1e-8;
	return {
		source,
		a,
		b,
		t0,
		t1,
		len,
		minX: Math.min(a.p.x, b.p.x) - pad,
		maxX: Math.max(a.p.x, b.p.x) + pad,
		minY: Math.min(a.p.y, b.p.y) - pad,
		maxY: Math.max(a.p.y, b.p.y) + pad,
	};
}
function crossings(a: Edge, b: Edge, primitives: KernelOffsetPrimitive[]): Vec2[] {
	const aa = primitives[a.source],
		bb = primitives[b.source];
	let candidates: Vec2[] = [];
	if (aa.type === 'arc' && bb.type === 'arc') {
		const c = Vec2.from(aa.center!),
			delta = Vec2.from(bb.center!).sub(c),
			d = delta.length(),
			r = aa.radius!,
			s = bb.radius!;
		if (d < 1e-12) {
			if (Math.abs(r - s) < 1e-8) candidates = [a.a.p, a.b.p, b.a.p, b.b.p];
		} else if (d <= r + s + 1e-8 && d >= Math.abs(r - s) - 1e-8) {
			const x = (r * r - s * s + d * d) / (2 * d),
				h = Math.sqrt(Math.max(0, r * r - x * x)),
				u = delta.divideScalar(d);
			const mid = c.addScaledVector(u, x),
				n = u.clone().perpendicular();
			candidates = [mid.clone().addScaledVector(n, h), mid.clone().addScaledVector(n, -h)];
		}
	} else if (aa.type === 'arc' || bb.type === 'arc') {
		const circle = aa.type === 'arc' ? aa : bb,
			line = aa.type === 'arc' ? b : a;
		const delta = line.b.p.clone().sub(line.a.p),
			v = line.a.p.clone().sub(circle.center!),
			len = delta.lengthSq(),
			dot = v.dot(delta);
		const disc = dot * dot - len * (v.lengthSq() - circle.radius! ** 2);
		if (len > 1e-20 && disc >= -1e-9) {
			const h = Math.sqrt(Math.max(0, disc));
			candidates = [(-dot - h) / len, (-dot + h) / len].map(t => line.a.p.clone().addScaledVector(delta, t));
		}
	} else {
		const u = a.b.p.clone().sub(a.a.p),
			v = b.b.p.clone().sub(b.a.p),
			delta = b.a.p.clone().sub(a.a.p),
			det = u.cross(v);
		if (Math.abs(det) >= 1e-12) candidates = [a.a.p.clone().addScaledVector(u, delta.cross(v) / det)];
		else if (u.lengthSq() > 1e-20 && Math.abs(delta.cross(u)) <= 1e-9 * u.length()) {
			const t0 = delta.dot(u) / u.lengthSq(),
				t1 = b.b.p.clone().sub(a.a.p).dot(u) / u.lengthSq();
			const lo = Math.max(0, Math.min(t0, t1)),
				hi = Math.min(1, Math.max(t0, t1));
			if (lo <= hi + 1e-9) candidates = [lo, hi].map(t => a.a.p.clone().addScaledVector(u, t));
		}
	}
	return candidates.filter(p =>
		[fraction(a, p, primitives), fraction(b, p, primitives)].every(t => t >= -1e-8 && t <= 1 + 1e-8)
	);
}
function cut(e: Edge, p: Vec2, primitives: KernelOffsetPrimitive[]): [Edge, Edge] {
	const t = Math.max(0, Math.min(1, fraction(e, p, primitives))),
		node = at(e, t, primitives);
	node.p = p.clone();
	node.corner = true;
	const param = e.t0 + (e.t1 - e.t0) * t;
	return [
		makeEdge(e.source, e.a, node, e.t0, param, primitives),
		makeEdge(e.source, node, e.b, param, e.t1, primitives),
	];
}
function area(edges: Edge[], primitives: KernelOffsetPrimitive[]): number {
	return edges.reduce((sum, e) => {
		const p = primitives[e.source];
		return (
			sum +
			(p.type === 'arc'
				? Vec2.from(p.center!).cross(e.b.p.clone().sub(e.a.p)) +
					p.radius! ** 2 * arcSpan(p) * (e.t1 - e.t0) * (p.clockwise ? -1 : 1)
				: e.a.p.cross(e.b.p))
		);
	}, 0);
}
function sourceBoundary(items: readonly OffsetKernelItem[], paths: (Path | undefined)[], d: number): Vec2[] {
	return items.flatMap((item, i) => {
		if (paths[i]) return paths[i]!.nodes.slice(0, -1).map(n => n.p.clone().addScaledVector(n.n, -d));
		const c = item.curve;
		if (c?.type === 'segment') return [Vec2.from(c.p1)];
		if (c?.type === 'arc') {
			const p: KernelOffsetPrimitive = {
				sourceId: item.sourceId,
				type: 'arc',
				center: c.center,
				start: c.start,
				end: c.end,
				radius: c.radius,
				clockwise: c.clockwise,
			};
			return Array.from({ length: 256 }, (_, j) => arcNode(p, j / 256).p);
		}
		return [];
	});
}

// Point pinches and retraced edges at a consumed arc require tracing surviving
// edge fragments rather than deciding whether to retain an entire raw ring.
function survivingLoops(
	edges: Edge[],
	primitives: KernelOffsetPrimitive[],
	items: readonly OffsetKernelItem[],
	source: Vec2[],
	d: number
): Edge[][] {
	const cuts = edges.map(() => [0, 1]);
	for (let i = 0; i < edges.length; i++)
		for (let j = i + 1; j < edges.length; j++) {
			const a = edges[i],
				b = edges[j];
			if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
			for (const p of crossings(a, b, primitives)) {
				cuts[i].push(Math.max(0, Math.min(1, fraction(a, p, primitives))));
				cuts[j].push(Math.max(0, Math.min(1, fraction(b, p, primitives))));
			}
		}
	const inside = (p: Vec2) => {
		let odd = false;
		for (let i = 0, j = source.length - 1; i < source.length; j = i++) {
			const a = source[i],
				b = source[j];
			if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
		}
		return odd;
	};
	const valid = (e: Edge) => {
		if (items[e.source].kind === 'arc' && primitives[e.source].type === 'line') return false;
		const p = at(e, 0.5, primitives).p;
		// Reject the folded parallel while retaining contacts around its endpoints.
		const c = items[e.source].curve;
		if (c?.type === 'arc' && -d >= c.radius && p.distanceToSquared(c.center) <= (-d - c.radius) ** 2 + 1e-20)
			return false;
		return (
			inside(p) &&
			source.every(
				(a, i) =>
					projectPointOntoSegment(p, a, source[(i + 1) % source.length]).dist >= Math.abs(d) - OFFSET_FIT_TOLERANCE
			)
		);
	};
	const pieces: Edge[] = [],
		vertices: Vec2[] = [],
		links: [number, number][] = [];
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i],
			sorted = cuts[i].sort((a, b) => a - b),
			ts = sorted.filter((t, i) => i === 0 || t - sorted[i - 1] >= 1e-10);
		for (let j = 0; j + 1 < ts.length; j++) {
			const a = at(e, ts[j], primitives),
				b = at(e, ts[j + 1], primitives);
			a.corner ||= ts[j] > 1e-10 || e.a.corner;
			b.corner ||= ts[j + 1] < 1 - 1e-10 || e.b.corner;
			const piece = makeEdge(
				e.source,
				a,
				b,
				e.t0 + (e.t1 - e.t0) * ts[j],
				e.t0 + (e.t1 - e.t0) * ts[j + 1],
				primitives
			);
			if (piece.len <= 1e-8 || !valid(piece)) continue;
			const ids = [a.p, b.p].map(p => {
				let id = vertices.findIndex(v => v.distanceTo(p) < 1e-7);
				if (id < 0) {
					id = vertices.length;
					vertices.push(p);
				}
				return id;
			}) as [number, number];
			pieces.push(piece);
			links.push(ids);
		}
	}
	const active = pieces.map(() => true);
	for (let i = 0; i < links.length; i++) {
		if (!active[i]) continue;
		for (let j = i + 1; j < links.length; j++) {
			if (!active[j]) continue;
			if (links[i][0] === links[j][0] && links[i][1] === links[j][1]) active[j] = false;
			else if (links[i][0] === links[j][1] && links[i][1] === links[j][0]) {
				active[i] = false;
				active[j] = false;
				break;
			}
		}
	}
	for (;;) {
		const incoming = vertices.map(() => 0),
			outgoing = vertices.map(() => 0);
		links.forEach(([a, b], i) => {
			if (active[i]) {
				outgoing[a]++;
				incoming[b]++;
			}
		});
		let changed = false;
		links.forEach(([a, b], i) => {
			if (active[i] && (!incoming[a] || !outgoing[b])) {
				active[i] = false;
				changed = true;
			}
		});
		if (!changed) break;
	}
	const winding = Math.sign(source.reduce((s, p, i) => s + p.cross(source[(i + 1) % source.length]), 0)),
		loops: Edge[][] = [];
	for (let start = 0; start < pieces.length; start++) {
		if (!active[start]) continue;
		const ring: Edge[] = [];
		let current = start;
		for (;;) {
			active[current] = false;
			ring.push(pieces[current]);
			const end = links[current][1];
			if (end === links[start][0]) {
				loops.push(ring);
				break;
			}
			const tangent = at(pieces[current], 1, primitives).t;
			let next = -1,
				turn = -Infinity;
			for (let i = 0; i < pieces.length; i++)
				if (active[i] && links[i][0] === end) {
					const t = at(pieces[i], 0, primitives).t,
						angle = Math.atan2(tangent.cross(t), tangent.dot(t)) * winding;
					if (angle >= turn) {
						next = i;
						turn = angle;
					}
				}
			if (next < 0) break;
			current = next;
		}
	}
	return loops;
}

/** Split a mixed closed parallel boundary without losing source geometry or independent components. */
export function splitOffsetContours(
	items: readonly OffsetKernelItem[],
	primitives: KernelOffsetPrimitive[],
	rawPaths: (Path | undefined)[],
	paths: (Path | undefined)[],
	d: number,
	fit: (p: KernelOffsetPrimitive, nodes: Node[], d: number) => void,
	consumedArc = false
): KernelOffsetPrimitive[] | undefined {
	const edges = primitives
		.flatMap((p, source): Edge[] => {
			let nodes = paths[source]?.nodes;
			if (!nodes && p.type === 'line') {
				const t = Vec2.from(p.p2!).sub(p.p1!).normalizeOrUnitX(),
					n = t.clone().perpendicular();
				nodes = [p.p1!, p.p2!].map(p => ({ p: Vec2.from(p), n, t, corner: false }));
			}
			if (!nodes && p.type === 'arc') nodes = Array.from({ length: 65 }, (_, j) => arcNode(p, j / 64));
			return (
				nodes
					?.slice(1)
					.map((b, j) =>
						makeEdge(source, nodes![j], b, j / (nodes!.length - 1), (j + 1) / (nodes!.length - 1), primitives)
					) ?? []
			);
		})
		.filter(e => e.len > 1e-8);
	if (edges.length < 3 || edges.some((e, i) => e.b.p.distanceTo(edges[(i + 1) % edges.length].a.p) > 1e-6)) return;
	const source = sourceBoundary(items, rawPaths, d),
		pending = consumedArc ? [] : [edges],
		loops: Edge[][] = consumedArc ? survivingLoops(edges, primitives, items, source, d) : [];
	while (pending.length) {
		const ring = pending.pop()!,
			total = ring.reduce((s, e) => s + e.len, 0);
		let pieces: Edge[][] | undefined;
		search: for (let i = 0; i < ring.length; i++) {
			const a = ring[i];
			for (let j = i + 2; j < ring.length; j++) {
				if (i === 0 && j === ring.length - 1) continue;
				const b = ring[j];
				if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
				for (const p of crossings(a, b, primitives)) {
					const [al, ar] = cut(a, p, primitives),
						[bl, br] = cut(b, p, primitives);
					const parts = [
						[ar, ...ring.slice(i + 1, j), bl],
						[br, ...ring.slice(j + 1), ...ring.slice(0, i), al],
					].map(v => v.filter(e => e.len > 1e-8));
					if (parts.some(v => v.length < 2 || v.reduce((s, e) => s + e.len, 0) >= total - 1e-8)) continue;
					for (const part of parts) {
						part[0] = { ...part[0], a: { ...part[0].a, corner: true } };
						const last = part.length - 1;
						part[last] = { ...part[last], b: { ...part[last].b, corner: true } };
					}
					pieces = parts;
					break search;
				}
			}
		}
		if (pieces) pending.push(...pieces);
		else loops.push(ring);
	}
	if (loops.length < 2 && !consumedArc) return;
	const sourceArea = source.reduce((s, p, i) => s + p.cross(source[(i + 1) % source.length]), 0);
	const inside = (p: Vec2) => {
		let odd = false;
		for (let i = 0, j = source.length - 1; i < source.length; j = i++) {
			const a = source[i],
				b = source[j];
			if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
		}
		return odd;
	};
	const minDist = Math.abs(d) - OFFSET_FIT_TOLERANCE;
	let valid = loops.filter(ring => {
		const a = area(ring, primitives);
		if (Math.abs(a) < 1e-10 || (d < 0 && a * sourceArea <= 0)) return false;
		const stride = Math.max(1, Math.floor(ring.length / 64));
		for (let i = 0; i < ring.length; i += stride) {
			const p = at(ring[i], 0.5, primitives).p;
			if (inside(p) !== d < 0) return false;
			for (let j = 0; j < source.length; j++) {
				const sa = source[j],
					sb = source[(j + 1) % source.length];
				if (
					(sa.x < sb.x ? sb.x : sa.x) < p.x - minDist ||
					(sa.x < sb.x ? sa.x : sb.x) > p.x + minDist ||
					(sa.y < sb.y ? sb.y : sa.y) < p.y - minDist ||
					(sa.y < sb.y ? sa.y : sb.y) > p.y + minDist
				)
					continue;
				if (projectPointOntoSegment(p, sa, sb).dist < minDist) return false;
			}
		}
		return true;
	});
	if (d > 0) {
		// Dilation keeps a connected filled source connected. Extra boundaries can be
		// holes (opposite winding), never another outer loop from a small offset cusp.
		const outer = valid
			.filter(ring => area(ring, primitives) * sourceArea > 0)
			.sort((a, b) => Math.abs(area(b, primitives)) - Math.abs(area(a, primitives)))[0];
		if (outer) valid = valid.filter(ring => ring === outer || area(ring, primitives) * sourceArea < 0);
	}
	if (valid.length === 0 || (valid.length < 2 && !consumedArc)) return;
	const min = (v: Edge[], axis: 'x' | 'y') => Math.min(...v.map(e => Math.min(e.a.p[axis], e.b.p[axis])));
	valid.sort((a, b) => min(a, 'x') - min(b, 'x') || min(a, 'y') - min(b, 'y'));
	return valid.flatMap((ring, contourIndex) => {
		// Start at the lowest source run; join a source's runs across the old seam first.
		const starts = ring.flatMap((e, i) => (e.source !== ring[(i + ring.length - 1) % ring.length].source ? [i] : []));
		starts.sort((i, j) => ring[i].source - ring[j].source || ring[i].t0 - ring[j].t0);
		const start = starts[0] ?? 0,
			ordered = [...ring.slice(start), ...ring.slice(0, start)],
			runs: Edge[][] = [];
		for (const e of ordered) {
			if (runs.at(-1)?.[0].source === e.source) runs.at(-1)!.push(e);
			else runs.push([e]);
		}
		return runs.map(run => {
			const first = run[0],
				last = run.at(-1)!,
				original = primitives[first.source];
			const p: KernelOffsetPrimitive = { ...original, ...(contourIndex ? { contourIndex } : {}) };
			if (p.type === 'line') {
				p.p1 = first.a.p;
				p.p2 = last.b.p;
			} else if (p.type === 'arc') {
				p.start = first.a.p;
				p.end = last.b.p;
			} else {
				p.isSplineClosed = runs.length === 1;
				fit(p, [first.a, ...run.map(e => e.b)], d);
			}
			return p;
		});
	});
}

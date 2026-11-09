import type { Vec2 } from '../../math/vector';
import type { CenterlineAlgorithm } from './types';

/** Thins a binary mask in place to a one pixel wide 8-connected skeleton. */
export function thin(mask: Uint8Array, width: number, height: number, algorithm: CenterlineAlgorithm): Uint8Array {
	const img = mask.slice();
	const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x]);
	let candidates: number[] = [];
	for (let i = 0; i < img.length; i++) if (img[i]) candidates.push(i);

	const remove: number[] = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (let pass = 0; pass < 2; pass++) {
			remove.length = 0;
			for (const index of candidates) {
				if (!img[index]) continue;
				const x = index % width;
				const y = (index - x) / width;
				const p2 = at(x, y - 1);
				const p3 = at(x + 1, y - 1);
				const p4 = at(x + 1, y);
				const p5 = at(x + 1, y + 1);
				const p6 = at(x, y + 1);
				const p7 = at(x - 1, y + 1);
				const p8 = at(x - 1, y);
				const p9 = at(x - 1, y - 1);
				let deletable: boolean;
				if (algorithm === 'guo-hall') {
					const c =
						(!p2 && (p3 || p4) ? 1 : 0) +
						(!p4 && (p5 || p6) ? 1 : 0) +
						(!p6 && (p7 || p8) ? 1 : 0) +
						(!p8 && (p9 || p2) ? 1 : 0);
					const n1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
					const n2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
					const n = Math.min(n1, n2);
					const m = pass === 0 ? (p6 | p7 | (p9 ? 0 : 1)) & p8 : (p2 | p3 | (p5 ? 0 : 1)) & p4;
					deletable = c === 1 && n >= 2 && n <= 3 && m === 0;
				} else {
					const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
					if (b < 2 || b > 6) continue;
					const sequence = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
					let a = 0;
					for (let k = 0; k < 8; k++) if (!sequence[k] && sequence[k + 1]) a++;
					if (a !== 1) continue;
					deletable = pass === 0 ? !(p2 && p4 && p6) && !(p4 && p6 && p8) : !(p2 && p4 && p8) && !(p2 && p6 && p8);
				}
				if (deletable) remove.push(index);
			}
			for (const index of remove) img[index] = 0;
			if (remove.length) changed = true;
		}
		if (changed) candidates = candidates.filter(index => img[index]);
	}
	removeRedundantPixels(img, width, height);
	return img;
}

const RING: Array<[number, number]> = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
];

/** Removes staircase pixels whose neighbours stay connected without them, so that degree counts are reliable. */
function removeRedundantPixels(img: Uint8Array, width: number, height: number): void {
	const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x]);
	let changed = true;
	while (changed) {
		changed = false;
		for (let index = 0; index < img.length; index++) {
			if (!img[index]) continue;
			const x = index % width;
			const y = (index - x) / width;
			const ring = RING.map(([dx, dy]) => at(x + dx, y + dy));
			const count = ring.reduce((sum, v) => sum + v, 0);
			if (count < 2) continue;
			// Count 8-connected groups among the neighbours within the 3x3 window.
			const seen = new Array(8).fill(false);
			let groups = 0;
			for (let k = 0; k < 8; k++) {
				if (!ring[k] || seen[k]) continue;
				groups++;
				const stack = [k];
				seen[k] = true;
				while (stack.length) {
					const current = stack.pop()!;
					const [cx, cy] = RING[current];
					for (let other = 0; other < 8; other++) {
						if (!ring[other] || seen[other]) continue;
						const [ox, oy] = RING[other];
						if (Math.abs(ox - cx) <= 1 && Math.abs(oy - cy) <= 1) {
							seen[other] = true;
							stack.push(other);
						}
					}
				}
			}
			if (groups === 1) {
				img[index] = 0;
				changed = true;
			}
		}
	}
}

export interface SkeletonGraph {
	nodes: Vec2[];
	edges: Array<{ a: number; b: number; points: Vec2[] }>;
	loops: Vec2[][];
}

/** Converts a thinned mask into a graph of polylines between end points and junctions. */
export function extractSkeletonGraph(skeleton: Uint8Array, width: number, height: number): SkeletonGraph {
	const neighbors = (index: number): number[] => {
		const x = index % width;
		const y = (index - x) / width;
		const list: number[] = [];
		for (const [dx, dy] of RING) {
			const xx = x + dx;
			const yy = y + dy;
			if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
			const n = yy * width + xx;
			if (skeleton[n]) list.push(n);
		}
		return list;
	};
	const center = (index: number): Vec2 => {
		const x = index % width;
		return { x: x + 0.5, y: (index - x) / width + 0.5 };
	};

	const degree = new Uint8Array(skeleton.length);
	const pixels: number[] = [];
	for (let i = 0; i < skeleton.length; i++) {
		if (!skeleton[i]) continue;
		pixels.push(i);
		degree[i] = neighbors(i).length;
	}

	// Cluster adjacent node pixels (end points and junctions) into single nodes.
	const nodeOf = new Int32Array(skeleton.length).fill(-1);
	const nodes: Vec2[] = [];
	for (const start of pixels) {
		if (degree[start] === 2 || nodeOf[start] >= 0) continue;
		const id = nodes.length;
		const stack = [start];
		nodeOf[start] = id;
		let sx = 0;
		let sy = 0;
		let count = 0;
		while (stack.length) {
			const index = stack.pop()!;
			const c = center(index);
			sx += c.x;
			sy += c.y;
			count++;
			for (const n of neighbors(index)) {
				if (degree[n] !== 2 && nodeOf[n] < 0) {
					nodeOf[n] = id;
					stack.push(n);
				}
			}
		}
		nodes.push({ x: sx / count, y: sy / count });
	}

	const visited = new Uint8Array(skeleton.length);
	const edges: SkeletonGraph['edges'] = [];
	const directPairs = new Set<string>();
	for (const start of pixels) {
		const a = nodeOf[start];
		if (a < 0) continue;
		for (const first of neighbors(start)) {
			const direct = nodeOf[first];
			if (direct >= 0) {
				if (direct === a) continue;
				const key = start < first ? `${start}:${first}` : `${first}:${start}`;
				if (directPairs.has(key)) continue;
				directPairs.add(key);
				edges.push({ a, b: direct, points: [nodes[a], nodes[direct]] });
				continue;
			}
			if (visited[first]) continue;
			const points: Vec2[] = [nodes[a]];
			let previous = start;
			let current = first;
			let end = -1;
			while (true) {
				visited[current] = 1;
				points.push(center(current));
				const next = neighbors(current).find(n => n !== previous && !(nodeOf[n] === a && points.length === 2));
				const fallback = next ?? neighbors(current).find(n => n !== previous);
				if (fallback === undefined) break;
				if (nodeOf[fallback] >= 0) {
					end = nodeOf[fallback];
					break;
				}
				if (visited[fallback]) break;
				previous = current;
				current = fallback;
			}
			if (end < 0) continue;
			if (end === a && points.length < 4) continue;
			points.push(nodes[end]);
			edges.push({ a, b: end, points });
		}
	}

	const loops: Vec2[][] = [];
	for (const start of pixels) {
		if (visited[start] || degree[start] !== 2) continue;
		const points: Vec2[] = [];
		let previous = -1;
		let current = start;
		while (!visited[current]) {
			visited[current] = 1;
			points.push(center(current));
			const next = neighbors(current).find(n => n !== previous && !visited[n]);
			if (next === undefined) break;
			previous = current;
			current = next;
		}
		if (points.length >= 8) loops.push(points);
	}

	return { nodes, edges, loops };
}

function polylineLength(points: Vec2[]): number {
	let length = 0;
	for (let i = 1; i < points.length; i++)
		length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	return length;
}

/**
 * Removes short spurs that end in a free end point, merges edges through nodes left with two edges,
 * and drops tiny isolated fragments.
 */
export function pruneSkeletonGraph(graph: SkeletonGraph, spurLength: number): SkeletonGraph {
	let edges = graph.edges.map(edge => ({ ...edge, points: [...edge.points] }));
	const loops = graph.loops.map(loop => [...loop]);
	const degreeOf = () => {
		const degree = new Array(graph.nodes.length).fill(0);
		for (const edge of edges) {
			degree[edge.a]++;
			degree[edge.b]++;
		}
		return degree;
	};

	for (let iteration = 0; iteration < 4; iteration++) {
		let changed = false;
		let degree = degreeOf();
		const kept = edges.filter(edge => {
			const length = polylineLength(edge.points);
			const freeA = degree[edge.a] === 1;
			const freeB = degree[edge.b] === 1;
			if (length >= spurLength) return true;
			if ((freeA && degree[edge.b] >= 3) || (freeB && degree[edge.a] >= 3) || (freeA && freeB)) {
				changed = true;
				return false;
			}
			return true;
		});
		edges = kept;

		// Merge chains through nodes that now have exactly two edges.
		degree = degreeOf();
		for (let node = 0; node < graph.nodes.length; node++) {
			if (degree[node] !== 2) continue;
			const attached = edges.filter(edge => edge.a === node || edge.b === node);
			if (attached.length !== 2) continue;
			const [first, second] = attached;
			const firstPoints = first.b === node ? first.points : [...first.points].reverse();
			const firstStart = first.b === node ? first.a : first.b;
			const secondPoints = second.a === node ? second.points : [...second.points].reverse();
			const secondEnd = second.a === node ? second.b : second.a;
			const merged = [...firstPoints, ...secondPoints.slice(1)];
			edges = edges.filter(edge => edge !== first && edge !== second);
			if (firstStart === node && secondEnd === node) {
				loops.push(merged.slice(0, -1));
			} else if (firstStart === secondEnd && first === second) {
				continue;
			} else {
				edges.push({ a: firstStart, b: secondEnd, points: merged });
			}
			degree = degreeOf();
			changed = true;
		}
		if (!changed) break;
	}

	// Edges from a node back to itself are loops through that node; keep them as edges so the node stays shared.
	return {
		nodes: graph.nodes,
		edges,
		loops: loops.filter(loop => polylineLength(loop) >= spurLength * 2),
	};
}

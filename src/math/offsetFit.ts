import { Vec2 } from './vector';
import { evaluateBezier, evaluateBezierDerivative, type BezierSegment } from './splineReference';

export interface OffsetFitNode {
	p: Vec2;
	t: Vec2;
	corner: boolean;
}
export interface OffsetFitPiece {
	start: number;
	end: number;
	curve: BezierSegment;
}
export const OFFSET_FIT_TOLERANCE = 0.05;

function second(b: BezierSegment, u: number): Vec2 {
	return b[2]
		.clone()
		.addScaledVector(b[1], -2)
		.add(b[0])
		.multiplyScalar(6 * (1 - u))
		.addScaledVector(b[3].clone().addScaledVector(b[2], -2).add(b[1]), 6 * u);
}
function generate(
	nodes: readonly OffsetFitNode[],
	start: number,
	end: number,
	params: number[],
	length: number
): BezierSegment {
	const a = nodes[start],
		b = nodes[end],
		chord = b.p.clone().sub(a.p);
	const fixedA = a.corner || a.t.dot(nodes[start + 1].p.clone().sub(a.p)) < 0;
	const fixedB = b.corner || b.t.dot(b.p.clone().sub(nodes[end - 1].p)) < 0;
	let c00 = 0,
		c01 = 0,
		c11 = 0,
		x0 = 0,
		x1 = 0;
	for (let j = 0; j < params.length; j++) {
		const u = params[j],
			v = 1 - u,
			b1 = 3 * v * v * u,
			b2 = 3 * v * u * u;
		const aa = a.t.clone().multiplyScalar(b1),
			bb = b.t.clone().multiplyScalar(-b2);
		const rhs = nodes[start + j].p
			.clone()
			.sub(a.p)
			.addScaledVector(chord, -(b2 + u * u * u));
		c00 += aa.dot(aa);
		c01 += aa.dot(bb);
		c11 += bb.dot(bb);
		x0 += aa.dot(rhs);
		x1 += bb.dot(rhs);
	}
	const det = c00 * c11 - c01 * c01;
	let alpha = fixedA ? 0 : fixedB ? x0 / c00 : (x0 * c11 - x1 * c01) / det;
	let beta = fixedB ? 0 : fixedA ? x1 / c11 : (x1 * c00 - x0 * c01) / det;
	const fallback = chord.length() / 3;
	if (!fixedA && (!Number.isFinite(alpha) || alpha <= 1e-12)) alpha = fallback;
	if (!fixedB && (!Number.isFinite(beta) || beta <= 1e-12)) beta = fallback;
	alpha = Math.min(alpha, length * 0.75);
	beta = Math.min(beta, length * 0.75);
	return [a.p.clone(), a.p.clone().addScaledVector(a.t, alpha), b.p.clone().addScaledVector(b.t, -beta), b.p.clone()];
}
/** Compare restricted cubic controls with a linear cubic: the convex hull bounds both directions of deviation. */
function deviation(curve: BezierSegment, nodes: readonly OffsetFitNode[], start: number, params: number[]) {
	let error = 0,
		split = Math.floor((params.length - 1) / 2);
	for (let j = 0; j + 1 < params.length; j++) {
		const u = params[j],
			v = params[j + 1],
			du = (v - u) / 3,
			a = nodes[start + j].p,
			b = nodes[start + j + 1].p;
		const p = evaluateBezier(curve, u),
			q = evaluateBezier(curve, v),
			delta = b.clone().sub(a);
		const controls = [
			p,
			p.clone().addScaledVector(evaluateBezierDerivative(curve, u), du),
			q.clone().addScaledVector(evaluateBezierDerivative(curve, v), -du),
			q,
		];
		for (let k = 0; k < 4; k++) {
			const fraction =
				k === 0
					? 0
					: k === 3
						? 1
						: Math.max(0, Math.min(1, controls[k].clone().sub(a).dot(delta) / Math.max(delta.lengthSq(), 1e-24)));
			const d = controls[k].distanceTo(a.clone().addScaledVector(delta, fraction));
			if (d > error) {
				error = d;
				split = j + (k > 1 ? 1 : 0);
			}
		}
	}
	return { error, split };
}
export function fitOffsetNodes(
	nodes: readonly OffsetFitNode[],
	tolerance = OFFSET_FIT_TOLERANCE,
	closed = false
): OffsetFitPiece[] {
	if (nodes.length < 2) return [];
	const result: OffsetFitPiece[] = [];
	const cache = new Map<string, { curve: BezierSegment; error: number; split: number }>();
	const approximate = (start: number, end: number) => {
		const key = `${start}:${end}`;
		const cached = cache.get(key);
		if (cached) return cached;
		let params = [0];
		for (let i = start + 1; i <= end; i++) params.push(params.at(-1)! + nodes[i].p.distanceTo(nodes[i - 1].p));
		const length = params.at(-1)!;
		if (length < 1e-12)
			return {
				curve: [nodes[start].p, nodes[start].p, nodes[end].p, nodes[end].p].map(Vec2.from) as BezierSegment,
				error: 0,
				split: 1,
			};
		const a = nodes[start],
			b = nodes[end],
			delta = b.p.clone().sub(a.p),
			length2 = delta.lengthSq();
		const distance = (p: Vec2) =>
			p.distanceTo(
				a.p
					.clone()
					.addScaledVector(delta, Math.max(0, Math.min(1, p.clone().sub(a.p).dot(delta) / Math.max(length2, 1e-24))))
			);
		const chordLength = Math.sqrt(length2);
		const lineCurve = [
			a.p.clone(),
			a.p.clone().addScaledVector(a.t, a.corner || a.t.dot(delta) < 0 ? 0 : chordLength / 3),
			b.p.clone().addScaledVector(b.t, b.corner || b.t.dot(delta) < 0 ? 0 : -chordLength / 3),
			b.p.clone(),
		] as BezierSegment;
		const lineError =
			Math.max(...nodes.slice(start, end + 1).map(n => distance(n.p))) +
			Math.max(distance(lineCurve[1]), distance(lineCurve[2]));
		if (chordLength > 1e-12 && lineError <= tolerance) {
			const value = { curve: lineCurve, error: lineError, split: Math.floor((end - start) / 2) };
			cache.set(key, value);
			return value;
		}
		params = params.map(s => s / length);
		let stalled = 0,
			previousError = Infinity;
		let bestError = Infinity,
			bestSplit = Math.floor((end - start) / 2),
			bestCurve: BezierSegment | undefined;
		for (let iteration = 0; iteration < 64; iteration++) {
			const curve = generate(nodes, start, end, params, length),
				test = deviation(curve, nodes, start, params);
			if (test.error < bestError) {
				bestError = test.error;
				bestSplit = test.split;
				bestCurve = curve;
			}
			if (test.error <= tolerance) {
				const value = { curve, error: test.error, split: test.split };
				cache.set(key, value);
				return value;
			}
			if (iteration >= 12 && bestError > tolerance * 1.1 && bestError >= previousError * 0.9999) stalled++;
			else stalled = 0;
			previousError = bestError;
			if (stalled >= 3 || end - start === 1) break;
			const next = [0];
			for (let j = 1; j + 1 < params.length; j++) {
				const u = params[j],
					p = evaluateBezier(curve, u).sub(nodes[start + j].p),
					d = evaluateBezierDerivative(curve, u),
					den = d.lengthSq() + p.dot(second(curve, u));
				const candidate = Math.abs(den) > 1e-20 ? u - p.dot(d) / den : u;
				next.push(Math.max((params[j - 1] + u) / 2, Math.min((u + params[j + 1]) / 2, candidate)));
			}
			next.push(1);
			params = next;
		}
		if (end - start === 1) {
			const curve = bestCurve!;
			// Shrink controls to the chord until even the smallest interval meets the bound.
			for (let i = 0; i < 48 && deviation(curve, nodes, start, [0, 1]).error > tolerance; i++) {
				curve[1].lerp(curve[0], 0.5);
				curve[2].lerp(curve[3], 0.5);
			}
			if (deviation(curve, nodes, start, [0, 1]).error > tolerance) {
				curve[1] = curve[0].clone();
				curve[2] = curve[3].clone();
			}
			const value = { curve, error: deviation(curve, nodes, start, [0, 1]).error, split: 1 };
			cache.set(key, value);
			return value;
		}
		const value = { curve: bestCurve!, error: bestError, split: bestSplit };
		cache.set(key, value);
		return value;
	};
	const fit = (start: number, end: number): void => {
		const best = approximate(start, end);
		if (best.error <= tolerance) {
			result.push({ start, end, curve: best.curve });
			return;
		}
		const count = end - start,
			split = start + Math.max(Math.ceil(count / 4), Math.min(Math.floor((count * 3) / 4), best.split));
		fit(start, split);
		fit(split, end);
	};
	const protectedIndices = new Set(nodes.flatMap((n, i) => (n.corner && i > 0 && i < nodes.length - 1 ? [i] : [])));
	if (closed && nodes.length > 2 && nodes.some(n => n.p.distanceTo(nodes[0].p) > 1e-12)) {
		for (let q = 1; q < 4; q++)
			protectedIndices.add(Math.max(1, Math.min(nodes.length - 2, Math.floor(((nodes.length - 1) * q) / 4))));
	}
	const breaks = [0, ...[...protectedIndices].sort((a, b) => a - b), nodes.length - 1];
	for (let i = 0; i + 1 < breaks.length; i++) fit(breaks[i], breaks[i + 1]);
	for (let i = 0; i + 1 < result.length; ) {
		if (protectedIndices.has(result[i].end)) {
			i++;
			continue;
		}
		const start = result[i].start,
			end = result[i + 1].end,
			best = approximate(start, end);
		if (best.error <= tolerance) {
			result.splice(i, 2, { start, end, curve: best.curve });
			i = Math.max(0, i - 1);
		} else i++;
	}
	return result;
}

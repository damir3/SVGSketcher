import { Vec2 } from './vector';
import type { BezierSegment } from './splineReference';

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

function secondX(b: BezierSegment, u: number): number {
	return (b[2].x + b[1].x * -2 + b[0].x) * (6 * (1 - u)) + (b[3].x + b[2].x * -2 + b[1].x) * (6 * u);
}
function secondY(b: BezierSegment, u: number): number {
	return (b[2].y + b[1].y * -2 + b[0].y) * (6 * (1 - u)) + (b[3].y + b[2].y * -2 + b[1].y) * (6 * u);
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
		apx = a.p.x,
		apy = a.p.y,
		cx = b.p.x - apx,
		cy = b.p.y - apy,
		atx = a.t.x,
		aty = a.t.y,
		btx = b.t.x,
		bty = b.t.y;
	const fixedA = a.corner || atx * (nodes[start + 1].p.x - apx) + aty * (nodes[start + 1].p.y - apy) < 0;
	const fixedB = b.corner || btx * (b.p.x - nodes[end - 1].p.x) + bty * (b.p.y - nodes[end - 1].p.y) < 0;
	let c00 = 0,
		c01 = 0,
		c11 = 0,
		x0 = 0,
		x1 = 0;
	for (let j = 0; j < params.length; j++) {
		const u = params[j],
			v = 1 - u,
			b1 = 3 * v * v * u,
			b2 = 3 * v * u * u,
			aax = atx * b1,
			aay = aty * b1,
			bbx = btx * -b2,
			bby = bty * -b2,
			scale = -(b2 + u * u * u),
			np = nodes[start + j].p,
			rhsx = np.x - apx + cx * scale,
			rhsy = np.y - apy + cy * scale;
		c00 += aax * aax + aay * aay;
		c01 += aax * bbx + aay * bby;
		c11 += bbx * bbx + bby * bby;
		x0 += aax * rhsx + aay * rhsy;
		x1 += bbx * rhsx + bby * rhsy;
	}
	const det = c00 * c11 - c01 * c01;
	let alpha = fixedA ? 0 : fixedB ? x0 / c00 : (x0 * c11 - x1 * c01) / det;
	let beta = fixedB ? 0 : fixedA ? x1 / c11 : (x1 * c00 - x0 * c01) / det;
	const fallback = Math.hypot(cx, cy) / 3;
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
	const b0x = curve[0].x,
		b0y = curve[0].y,
		b1x = curve[1].x,
		b1y = curve[1].y,
		b2x = curve[2].x,
		b2y = curve[2].y,
		b3x = curve[3].x,
		b3y = curve[3].y,
		d0x = b1x - b0x,
		d0y = b1y - b0y,
		d1x = b2x - b1x,
		d1y = b2y - b1y,
		d2x = b3x - b2x,
		d2y = b3y - b2y;
	let u = params[0],
		mu = 1 - u,
		uu = u * u,
		muu = mu * mu,
		px = b0x * muu * mu + b1x * (3 * muu * u) + b2x * (3 * mu * uu) + b3x * uu * u,
		py = b0y * muu * mu + b1y * (3 * muu * u) + b2y * (3 * mu * uu) + b3y * uu * u,
		dpx = d0x * (3 * muu) + d1x * (6 * mu * u) + d2x * (3 * uu),
		dpy = d0y * (3 * muu) + d1y * (6 * mu * u) + d2y * (3 * uu);
	for (let j = 0; j + 1 < params.length; j++) {
		const v = params[j + 1],
			mv = 1 - v,
			vv = v * v,
			mvv = mv * mv,
			du = (v - u) / 3,
			a = nodes[start + j].p,
			b = nodes[start + j + 1].p,
			qx = b0x * mvv * mv + b1x * (3 * mvv * v) + b2x * (3 * mv * vv) + b3x * vv * v,
			qy = b0y * mvv * mv + b1y * (3 * mvv * v) + b2y * (3 * mv * vv) + b3y * vv * v,
			dqx = d0x * (3 * mvv) + d1x * (6 * mv * v) + d2x * (3 * vv),
			dqy = d0y * (3 * mvv) + d1y * (6 * mv * v) + d2y * (3 * vv),
			dx = b.x - a.x,
			dy = b.y - a.y,
			lenSq = Math.max(dx * dx + dy * dy, 1e-24),
			c1x = px + dpx * du,
			c1y = py + dpy * du,
			c2x = qx + dqx * -du,
			c2y = qy + dqy * -du;
		for (let k = 0; k < 4; k++) {
			const cx = k === 0 ? px : k === 1 ? c1x : k === 2 ? c2x : qx;
			const cy = k === 0 ? py : k === 1 ? c1y : k === 2 ? c2y : qy;
			const fraction =
				k === 0 ? 0 : k === 3 ? 1 : Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / lenSq));
			const d = Math.hypot(cx - (a.x + dx * fraction), cy - (a.y + dy * fraction));
			if (d > error) {
				error = d;
				split = j + (k > 1 ? 1 : 0);
			}
		}
		u = v;
		px = qx;
		py = qy;
		dpx = dqx;
		dpy = dqy;
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
			const next = [0],
				b0x = curve[0].x,
				b0y = curve[0].y,
				b1x = curve[1].x,
				b1y = curve[1].y,
				b2x = curve[2].x,
				b2y = curve[2].y,
				b3x = curve[3].x,
				b3y = curve[3].y,
				d0x = b1x - b0x,
				d0y = b1y - b0y,
				d1x = b2x - b1x,
				d1y = b2y - b1y,
				d2x = b3x - b2x,
				d2y = b3y - b2y;
			for (let j = 1; j + 1 < params.length; j++) {
				const u = params[j],
					mu = 1 - u,
					uu = u * u,
					muu = mu * mu,
					np = nodes[start + j].p,
					px = b0x * muu * mu + b1x * (3 * muu * u) + b2x * (3 * mu * uu) + b3x * uu * u - np.x,
					py = b0y * muu * mu + b1y * (3 * muu * u) + b2y * (3 * mu * uu) + b3y * uu * u - np.y,
					dx = d0x * (3 * muu) + d1x * (6 * mu * u) + d2x * (3 * uu),
					dy = d0y * (3 * muu) + d1y * (6 * mu * u) + d2y * (3 * uu),
					den = dx * dx + dy * dy + (px * secondX(curve, u) + py * secondY(curve, u));
				const candidate = Math.abs(den) > 1e-20 ? u - (px * dx + py * dy) / den : u;
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

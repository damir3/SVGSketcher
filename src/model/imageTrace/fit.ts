import type { Vec2 } from '../../math/vector';
import type { FitOptions } from './types';

/** A fitted piece of a polyline, between point indices `start` and `end` of the processed polyline. */
export type FittedPiece =
	| { kind: 'line'; start: number; end: number }
	| { kind: 'arc'; start: number; end: number; center: Vec2; radius: number }
	| { kind: 'spline'; start: number; end: number; points: Vec2[]; handles: Array<{ h1: Vec2; h2: Vec2 }> };

export interface FittedPolyline {
	/** Processed (resampled and smoothed) polyline. For closed input, the first point is repeated at the end. */
	points: Vec2[];
	pieces: FittedPiece[];
	/** `corners[i]` is true when piece `i` starts with a sharp direction change. */
	corners: boolean[];
	closed: boolean;
}

const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

export function polylineLength(points: Vec2[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += len(points[i - 1], points[i]);
	return total;
}

/** Resamples a polyline at (approximately) uniform spacing, keeping the end points. */
export function resample(points: Vec2[], spacing: number, closed: boolean): Vec2[] {
	const source = closed ? [...points, points[0]] : points;
	if (source.length < 2) return [...points];
	const total = polylineLength(source);
	const count = Math.max(closed ? 3 : 1, Math.round(total / spacing));
	const step = total / count;
	const out: Vec2[] = [{ ...source[0] }];
	let segment = 1;
	let segmentStart = 0;
	for (let k = 1; k < count; k++) {
		const target = k * step;
		while (segment < source.length - 1 && segmentStart + len(source[segment - 1], source[segment]) < target) {
			segmentStart += len(source[segment - 1], source[segment]);
			segment++;
		}
		const a = source[segment - 1];
		const b = source[segment];
		const l = len(a, b);
		const t = l > 1e-12 ? Math.min(1, Math.max(0, (target - segmentStart) / l)) : 0;
		out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	}
	if (!closed) out.push({ ...source[source.length - 1] });
	return out;
}

/** Gaussian smoothing of polyline points; open polylines keep their end points. */
export function smooth(points: Vec2[], sigma: number, closed: boolean, pinned?: Set<number>): Vec2[] {
	if (sigma <= 0.05 || points.length < 3) return points.map(p => ({ ...p }));
	const radius = Math.ceil(sigma * 2.5);
	const weights: number[] = [];
	for (let k = -radius; k <= radius; k++) weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
	const n = points.length;
	return points.map((point, i) => {
		if (pinned?.has(i)) return { ...point };
		if (!closed && (i === 0 || i === n - 1)) return { ...point };
		let sx = 0;
		let sy = 0;
		let total = 0;
		for (let k = -radius; k <= radius; k++) {
			let j = i + k;
			if (closed) j = ((j % n) + n) % n;
			else if (j < 0 || j >= n) continue;
			// Do not smooth across pinned corners.
			if (
				pinned &&
				!closed &&
				((k < 0 && j < i && hasPinnedBetween(pinned, j, i)) || (k > 0 && hasPinnedBetween(pinned, i, j)))
			) {
				continue;
			}
			const w = weights[k + radius];
			sx += points[j].x * w;
			sy += points[j].y * w;
			total += w;
		}
		return { x: sx / total, y: sy / total };
	});
}

function hasPinnedBetween(pinned: Set<number>, a: number, b: number): boolean {
	for (let i = a + 1; i < b; i++) if (pinned.has(i)) return true;
	return false;
}

/** Turning angle (radians, 0..π) at each point measured over a window of `k` points on both sides. */
function turningAngles(points: Vec2[], k: number, closed: boolean): number[] {
	const n = points.length;
	return points.map((p, i) => {
		let a = i - k;
		let b = i + k;
		if (closed) {
			a = ((a % n) + n) % n;
			b = b % n;
		} else if (a < 0 || b >= n) {
			return 0;
		}
		const ux = p.x - points[a].x;
		const uy = p.y - points[a].y;
		const vx = points[b].x - p.x;
		const vy = points[b].y - p.y;
		const lu = Math.hypot(ux, uy);
		const lv = Math.hypot(vx, vy);
		if (lu < 1e-9 || lv < 1e-9) return 0;
		return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
	});
}

/** Finds corner indices: local maxima of the turning angle above `cornerAngle` degrees. */
export function findCorners(points: Vec2[], closed: boolean, cornerAngleDeg: number, window: number): number[] {
	const n = points.length;
	if (n < 5) return [];
	const k = Math.max(2, Math.min(window, Math.floor((n - 1) / 4)));
	const angles = turningAngles(points, k, closed);
	const limit = (cornerAngleDeg * Math.PI) / 180;
	const corners: number[] = [];
	for (let i = 0; i < n; i++) {
		if (angles[i] < limit) continue;
		let isMax = true;
		for (let d = -k; d <= k && isMax; d++) {
			if (!d) continue;
			let j = i + d;
			if (closed) j = ((j % n) + n) % n;
			else if (j < 0 || j >= n) continue;
			if (angles[j] > angles[i] || (angles[j] === angles[i] && j < i)) isMax = false;
		}
		if (isMax) corners.push(i);
	}
	return corners;
}

export interface CircleFit {
	center: Vec2;
	radius: number;
}

/** Algebraic (Kåsa) least-squares circle fit followed by a few geometric Gauss-Newton refinements. */
export function fitCircle(points: Vec2[], from = 0, to = points.length - 1): CircleFit | null {
	const count = to - from + 1;
	if (count < 3) return null;
	let mx = 0;
	let my = 0;
	for (let i = from; i <= to; i++) {
		mx += points[i].x;
		my += points[i].y;
	}
	mx /= count;
	my /= count;
	let suu = 0;
	let svv = 0;
	let suv = 0;
	let suuu = 0;
	let svvv = 0;
	let suvv = 0;
	let svuu = 0;
	for (let i = from; i <= to; i++) {
		const u = points[i].x - mx;
		const v = points[i].y - my;
		suu += u * u;
		svv += v * v;
		suv += u * v;
		suuu += u * u * u;
		svvv += v * v * v;
		suvv += u * v * v;
		svuu += v * u * u;
	}
	const det = suu * svv - suv * suv;
	if (Math.abs(det) < 1e-12) return null;
	const bu = 0.5 * (suuu + suvv);
	const bv = 0.5 * (svvv + svuu);
	let cx = (bu * svv - bv * suv) / det;
	let cy = (bv * suu - bu * suv) / det;
	cx += mx;
	cy += my;
	let r = 0;
	for (let i = from; i <= to; i++) r += Math.hypot(points[i].x - cx, points[i].y - cy);
	r /= count;
	if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;

	// Geometric refinement (minimizes the sum of squared radial distances).
	for (let iteration = 0; iteration < 5; iteration++) {
		let a11 = 0;
		let a12 = 0;
		let a13 = 0;
		let a22 = 0;
		let a23 = 0;
		let a33 = 0;
		let g1 = 0;
		let g2 = 0;
		let g3 = 0;
		for (let i = from; i <= to; i++) {
			const dx = cx - points[i].x;
			const dy = cy - points[i].y;
			const d = Math.max(1e-9, Math.hypot(dx, dy));
			const j1 = dx / d;
			const j2 = dy / d;
			const residual = d - r;
			a11 += j1 * j1;
			a12 += j1 * j2;
			a13 -= j1;
			a22 += j2 * j2;
			a23 -= j2;
			a33 += 1;
			g1 += j1 * residual;
			g2 += j2 * residual;
			g3 -= residual;
		}
		const solution = solve3(a11, a12, a13, a22, a23, a33, -g1, -g2, -g3);
		if (!solution) break;
		cx += solution[0];
		cy += solution[1];
		r += solution[2];
		if (Math.hypot(solution[0], solution[1], solution[2]) < 1e-6) break;
	}
	if (!(r > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
	return { center: { x: cx, y: cy }, radius: r };
}

function solve3(
	a11: number,
	a12: number,
	a13: number,
	a22: number,
	a23: number,
	a33: number,
	b1: number,
	b2: number,
	b3: number
): [number, number, number] | null {
	const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
	if (Math.abs(det) < 1e-12) return null;
	const x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det;
	const y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
	const z = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det;
	return [x, y, z];
}

/** Maximum distance of points[from..to] from the segment points[from]–points[to]. */
function lineDeviation(points: Vec2[], from: number, to: number): number {
	const a = points[from];
	const b = points[to];
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l = Math.hypot(dx, dy);
	let max = 0;
	for (let i = from + 1; i < to; i++) {
		const p = points[i];
		let d: number;
		if (l < 1e-9) d = len(a, p);
		else {
			const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (l * l);
			if (t < 0) d = len(a, p);
			else if (t > 1) d = len(b, p);
			else d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l;
		}
		if (d > max) max = d;
	}
	return max;
}

/** Signed angle swept from a to b around c, accumulated along the points. Returns null if direction reverses. */
function arcSweep(points: Vec2[], from: number, to: number, center: Vec2): number | null {
	let total = 0;
	let previous = Math.atan2(points[from].y - center.y, points[from].x - center.x);
	let positive = 0;
	let negative = 0;
	for (let i = from + 1; i <= to; i++) {
		const angle = Math.atan2(points[i].y - center.y, points[i].x - center.x);
		let delta = angle - previous;
		if (delta > Math.PI) delta -= 2 * Math.PI;
		if (delta < -Math.PI) delta += 2 * Math.PI;
		if (delta > 0) positive += delta;
		else negative -= delta;
		total += delta;
		previous = angle;
	}
	// Allow small noise-induced back-steps but reject arcs that actually reverse.
	if (Math.min(positive, negative) > Math.max(0.15 * Math.abs(total), 0.05)) return null;
	return total;
}

interface ArcCandidate {
	center: Vec2;
	radius: number;
	sweep: number;
}

function tryArc(points: Vec2[], from: number, to: number, options: FitOptions): ArcCandidate | null {
	if (!options.useArcs || to - from < 4) return null;
	const circle = fitCircle(points, from, to);
	if (!circle) return null;
	if (circle.radius < options.minRadius || circle.radius > options.maxRadius) return null;
	for (let i = from; i <= to; i++) {
		if (Math.abs(len(points[i], circle.center) - circle.radius) > options.tolerance) return null;
	}
	const sweep = arcSweep(points, from, to, circle.center);
	if (sweep === null || Math.abs(sweep) > 2 * Math.PI - 0.2) return null;
	// Arcs must bend noticeably; nearly straight runs are lines.
	const sagitta = circle.radius * (1 - Math.cos(Math.min(Math.PI, Math.abs(sweep)) / 2));
	if (sagitta < options.tolerance * 0.75) return null;
	return { center: circle.center, radius: circle.radius, sweep };
}

/** Arc length between point indices. */
function cumulativeLengths(points: Vec2[]): number[] {
	const out = [0];
	for (let i = 1; i < points.length; i++) out.push(out[i - 1] + len(points[i - 1], points[i]));
	return out;
}

/** Fits a cubic spline through a run of points, adding fit points until it stays within tolerance. */
export function fitSplineRun(
	points: Vec2[],
	from: number,
	to: number,
	tolerance: number
): { points: Vec2[]; handles: Array<{ h1: Vec2; h2: Vec2 }> } {
	const tangentAt = (index: number): Vec2 => {
		const a = points[Math.max(from, index - 2)];
		const b = points[Math.min(to, index + 2)];
		const l = len(a, b);
		return l < 1e-9 ? { x: 1, y: 0 } : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
	};
	const build = (indices: number[]) => {
		const fit = indices.map(i => points[i]);
		const handles = indices.map((index, k) => {
			const t = tangentAt(index);
			const previous = k > 0 ? len(points[indices[k - 1]], points[index]) / 3 : 0;
			const next = k < indices.length - 1 ? len(points[index], points[indices[k + 1]]) / 3 : 0;
			const p = points[index];
			const backward = previous || next;
			const forward = next || previous;
			return {
				h1: { x: p.x - t.x * backward, y: p.y - t.y * backward },
				h2: { x: p.x + t.x * forward, y: p.y + t.y * forward },
			};
		});
		return { points: fit, handles };
	};
	const bezierPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
		const mt = 1 - t;
		const a = mt * mt * mt;
		const b = 3 * mt * mt * t;
		const c = 3 * mt * t * t;
		const d = t * t * t;
		return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
	};
	const lengths = cumulativeLengths(points);

	const indices = [from, to];
	if (to - from >= 6) indices.splice(1, 0, Math.round((from + to) / 2));
	for (let iteration = 0; iteration < 64; iteration++) {
		const { handles } = build(indices);
		let worst = -1;
		let worstError = tolerance;
		for (let k = 0; k < indices.length - 1; k++) {
			const i0 = indices[k];
			const i1 = indices[k + 1];
			if (i1 - i0 < 2) continue;
			const p0 = points[i0];
			const p3 = points[i1];
			const c1 = handles[k].h2;
			const c2 = handles[k + 1].h1;
			const samples: Vec2[] = [];
			for (let s = 0; s <= 16; s++) samples.push(bezierPoint(p0, c1, c2, p3, s / 16));
			const span = lengths[i1] - lengths[i0];
			for (let i = i0 + 1; i < i1; i++) {
				const t = span > 1e-9 ? (lengths[i] - lengths[i0]) / span : 0.5;
				const guess = Math.round(t * 16);
				let best = Infinity;
				for (let s = Math.max(0, guess - 3); s <= Math.min(16, guess + 3); s++) {
					best = Math.min(best, len(samples[s], points[i]));
				}
				if (best > worstError) {
					worstError = best;
					worst = i;
				}
			}
		}
		if (worst < 0) break;
		const position = indices.findIndex(i => i > worst);
		indices.splice(position, 0, worst);
	}
	return build(indices);
}

/** Incremental sums for an algebraic circle fit relative to an origin point. */
class CircleSums {
	n = 0;
	sx = 0;
	sy = 0;
	sxx = 0;
	syy = 0;
	sxy = 0;
	sxxx = 0;
	syyy = 0;
	sxyy = 0;
	sxxy = 0;
	private readonly ox: number;
	private readonly oy: number;

	constructor(origin: Vec2) {
		this.ox = origin.x;
		this.oy = origin.y;
	}

	add(p: Vec2): void {
		const x = p.x - this.ox;
		const y = p.y - this.oy;
		this.n++;
		this.sx += x;
		this.sy += y;
		this.sxx += x * x;
		this.syy += y * y;
		this.sxy += x * y;
		this.sxxx += x * x * x;
		this.syyy += y * y * y;
		this.sxyy += x * y * y;
		this.sxxy += x * x * y;
	}

	circle(): CircleFit | null {
		const { n } = this;
		if (n < 3) return null;
		const mx = this.sx / n;
		const my = this.sy / n;
		const suu = this.sxx - n * mx * mx;
		const svv = this.syy - n * my * my;
		const suv = this.sxy - n * mx * my;
		const suuu = this.sxxx - 3 * mx * this.sxx + 3 * mx * mx * this.sx - n * mx * mx * mx;
		const svvv = this.syyy - 3 * my * this.syy + 3 * my * my * this.sy - n * my * my * my;
		const suvv =
			this.sxyy - 2 * my * this.sxy + my * my * this.sx - mx * this.syy + 2 * mx * my * this.sy - n * mx * my * my;
		const svuu =
			this.sxxy - 2 * mx * this.sxy + mx * mx * this.sy - my * this.sxx + 2 * mx * my * this.sx - n * my * mx * mx;
		const det = suu * svv - suv * suv;
		if (Math.abs(det) < 1e-9) return null;
		const bu = 0.5 * (suuu + suvv);
		const bv = 0.5 * (svvv + svuu);
		const cu = (bu * svv - bv * suv) / det;
		const cv = (bv * suu - bu * suv) / det;
		const radius = Math.sqrt(cu * cu + cv * cv + (suu + svv) / n);
		if (!Number.isFinite(radius)) return null;
		return { center: { x: cu + mx + this.ox, y: cv + my + this.oy }, radius };
	}
}

function circleDeviation(points: Vec2[], from: number, to: number, circle: CircleFit, limit: number): number {
	let max = 0;
	for (let i = from; i <= to; i++) {
		const d = Math.abs(len(points[i], circle.center) - circle.radius);
		if (d > max) {
			max = d;
			if (max > limit) return max;
		}
	}
	return max;
}

function lineError(points: Vec2[], from: number, to: number): number {
	const a = points[from];
	const b = points[to];
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	if (l2 < 1e-12) return 0;
	let sum = 0;
	for (let i = from + 1; i < to; i++) {
		const c = (points[i].x - a.x) * dy - (points[i].y - a.y) * dx;
		sum += (c * c) / l2;
	}
	return sum;
}

function circleError(points: Vec2[], from: number, to: number, circle: CircleFit): number {
	let sum = 0;
	for (let i = from + 1; i < to; i++) sum += (len(points[i], circle.center) - circle.radius) ** 2;
	return sum;
}

/**
 * Splits [from, to] into lines and arcs using dynamic programming: the fewest primitives win, ties are broken by
 * the fitting error. Primitives must be at least `minSegment` long; runs where none fit become splines.
 */
function fitRun(points: Vec2[], from: number, to: number, options: FitOptions, lengths: number[]): FittedPiece[] {
	const count = to - from + 1;
	const tol = options.tolerance;
	const errorWeight = 0.05 / (tol * tol);
	const splineBase = 1.5;
	const splinePerLength = 1 / Math.max(1, options.minSegment);
	type StateKind = 'other' | 'line';
	type Choice = { from: number; prevState: StateKind; piece: 'line' | 'arc' | 'spline'; circle?: CircleFit };
	const bestOther = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
	const bestLine = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
	const choiceOther: Array<Choice | null> = new Array(count).fill(null);
	const choiceLine: Array<Choice | null> = new Array(count).fill(null);
	bestOther[0] = 0;

	// Running minimum of best(k) - splinePerLength * length(k) for O(1) spline transitions.
	let splineMin = Number.POSITIVE_INFINITY;
	let splineFrom = 0;
	let splinePrevState: StateKind = 'other';

	for (let i = 0; i < count; i++) {
		if (i > 0) {
			const viaSpline = splineMin + splineBase + splinePerLength * (lengths[from + i] - lengths[from]);
			if (viaSpline < bestOther[i]) {
				bestOther[i] = viaSpline;
				choiceOther[i] = { from: splineFrom, prevState: splinePrevState, piece: 'spline' };
			}
		}

		const bestAtI = Math.min(bestOther[i], bestLine[i]);
		if (!Number.isFinite(bestAtI)) continue;
		const bestStateAtI: StateKind = bestOther[i] <= bestLine[i] ? 'other' : 'line';

		if (Number.isFinite(bestOther[i]) && choiceOther[i]?.piece !== 'spline') {
			const splineKey = bestOther[i] - splinePerLength * (lengths[from + i] - lengths[from]);
			if (splineKey < splineMin) {
				splineMin = splineKey;
				splineFrom = i;
				splinePrevState = 'other';
			}
		}

		const start = from + i;
		const sums = new CircleSums(points[start]);
		sums.add(points[start]);
		let lineAlive = true;
		let arcFailures = 0;
		const prevIsSpline = choiceOther[i]?.piece === 'spline';

		for (let j = i + 1; j < count; j++) {
			const end = from + j;
			sums.add(points[end]);
			const dev = lineAlive ? lineDeviation(points, start, end) : Infinity;
			if (lineAlive && dev > tol) lineAlive = false;
			let circle: CircleFit | null = null;
			if (options.useArcs && end - start >= 4) {
				const rough = sums.circle();
				if (rough && circleDeviation(points, start, end, rough, tol * 1.5) <= tol * 1.5) {
					circle = rough;
					arcFailures = 0;
				} else {
					arcFailures++;
				}
			}
			if (!lineAlive && arcFailures > 6) break;
			const segLen = lengths[end] - lengths[start];
			if (segLen < options.minSegment) continue;

			// Lines cannot chain directly after another line or a spline inside a corner-free run.
			if (lineAlive && !prevIsSpline && Number.isFinite(bestOther[i])) {
				const cost = bestOther[i] + 1 + (errorWeight * lineError(points, start, end)) / (end - start);
				if (cost < bestLine[j]) {
					bestLine[j] = cost;
					choiceLine[j] = { from: i, prevState: 'other', piece: 'line' };
				}
			}
			if (!lineAlive && circle) {
				const arc = tryArc(points, start, end, options);
				if (arc) {
					const exact = { center: arc.center, radius: arc.radius };
					const cost = bestAtI + 1.02 + (errorWeight * circleError(points, start, end, exact)) / (end - start);
					if (cost < bestOther[j]) {
						bestOther[j] = cost;
						choiceOther[j] = { from: i, prevState: bestStateAtI, piece: 'arc', circle: exact };
					}
				}
			}
		}
	}

	const reversed: FittedPiece[] = [];
	let j = count - 1;
	let state: StateKind = bestOther[j] <= bestLine[j] ? 'other' : 'line';
	while (j > 0) {
		const c = state === 'line' ? choiceLine[j] : choiceOther[j];
		if (!c) break;
		const start = from + c.from;
		const end = from + j;
		if (c.piece === 'line') reversed.push({ kind: 'line', start, end });
		else if (c.piece === 'arc' && c.circle) {
			reversed.push({ kind: 'arc', start, end, center: c.circle.center, radius: c.circle.radius });
		} else reversed.push(splinePiece(points, start, end, options));
		j = c.from;
		state = c.prevState;
	}
	return mergeShortSplines(points, reversed.reverse(), options);
}

function splinePiece(points: Vec2[], start: number, end: number, options: FitOptions): FittedPiece {
	if (end - start < 2 || lineDeviation(points, start, end) <= options.tolerance) {
		return { kind: 'line', start, end };
	}
	const fit = fitSplineRun(points, start, end, options.tolerance);
	return { kind: 'spline', start, end, points: fit.points, handles: fit.handles };
}

/** Short spline or line gaps between two primitives are absorbed by moving the shared vertex. */
function mergeShortSplines(points: Vec2[], pieces: FittedPiece[], options: FitOptions): FittedPiece[] {
	const lengths = cumulativeLengths(points);
	const out: FittedPiece[] = [];
	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i];
		const pieceLength = lengths[piece.end] - lengths[piece.start];
		const previous = out[out.length - 1];
		const next = pieces[i + 1];
		if (
			piece.kind !== 'arc' &&
			pieceLength < options.minSegment * 0.5 &&
			previous &&
			next &&
			previous.kind !== 'spline' &&
			next.kind !== 'spline'
		) {
			const middle = Math.round((piece.start + piece.end) / 2);
			previous.end = middle;
			next.start = middle;
			continue;
		}
		out.push(piece);
	}
	return out;
}

export interface PolylineFitInput {
	points: Vec2[];
	closed: boolean;
	/** Keep the first and last points in place (they are shared graph nodes). */
	pinEnds?: boolean;
}

/** Fits a traced polyline with lines, arcs and splines. Returns null for degenerate input. */
export function fitPolyline(input: PolylineFitInput, options: FitOptions): FittedPolyline | null {
	const { closed } = input;
	const spacing = 1;
	let points = resample(input.points, spacing, closed);
	if (points.length < (closed ? 4 : 2)) return null;

	// Corners are detected on lightly smoothed data and pinned so smoothing does not round them.
	const window = Math.max(2, Math.round(Math.max(options.minSegment * 0.35, options.tolerance * 2)));
	const preview = smooth(points, Math.max(0.6, options.smoothing * 0.5), closed);
	let corners = findCorners(preview, closed, options.cornerAngle, window);
	points = smooth(points, options.smoothing, closed, new Set(corners));

	const hadCorners = corners.length > 0;
	if (closed) {
		// Start at a corner when there is one, so that closed paths do not get an artificial junction.
		const startIndex = corners.length ? corners[0] : bestClosedStart(points, options);
		points = [...points.slice(startIndex), ...points.slice(0, startIndex)];
		corners = corners.map(c => (c - startIndex + points.length) % points.length).sort((a, b) => a - b);
		points.push({ ...points[0] });
		if (!corners.length || corners[0] !== 0) corners.unshift(0);
	}

	const lengths = cumulativeLengths(points);
	const breaks = closed
		? [...corners, points.length - 1]
		: [0, ...corners.filter(c => c > 0 && c < points.length - 1), points.length - 1];
	const pieces: FittedPiece[] = [];
	const cornerFlags: boolean[] = [];
	for (let k = 0; k < breaks.length - 1; k++) {
		const from = breaks[k];
		const to = breaks[k + 1];
		if (to <= from) continue;
		const run = fitRun(points, from, to, options, lengths);
		run.forEach((piece, index) => {
			pieces.push(piece);
			cornerFlags.push(index === 0 && (k > 0 || (closed && hadCorners)));
		});
	}
	return { points, pieces, corners: cornerFlags, closed };
}

/** For corner-free closed loops, start where the curvature changes most, which is usually a primitive boundary. */
function bestClosedStart(points: Vec2[], options: FitOptions): number {
	const k = Math.max(2, Math.round(options.minSegment * 0.25));
	const angles = turningAngles(points, k, true);
	let best = 0;
	let bestChange = -1;
	for (let i = 0; i < points.length; i++) {
		const change = Math.abs(angles[(i + 1) % points.length] - angles[(i - 1 + points.length) % points.length]);
		if (change > bestChange) {
			bestChange = change;
			best = i;
		}
	}
	return best;
}

/** Checks whether a closed polyline is a full circle within tolerance. */
export function fitClosedCircle(points: Vec2[], options: FitOptions): CircleFit | null {
	if (!options.useCircles || points.length < 8) return null;
	const circle = fitCircle(points);
	if (!circle || circle.radius < options.minRadius || circle.radius > options.maxRadius) return null;
	for (const p of points) {
		if (Math.abs(len(p, circle.center) - circle.radius) > options.tolerance) return null;
	}
	const closedPoints = [...points, points[0]];
	const sweep = arcSweep(closedPoints, 0, closedPoints.length - 1, circle.center);
	if (sweep === null || Math.abs(Math.abs(sweep) - 2 * Math.PI) > 0.3) return null;
	return circle;
}

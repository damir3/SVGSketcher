export interface Vec2 {
	x: number;
	y: number;
}

export const ORIGIN: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

export function vec(x: number, y: number): Vec2 {
	return { x, y };
}

export function mid(a: Vec2, b: Vec2): Vec2 {
	return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

export function mix(a: Vec2, b: Vec2, t: number): Vec2 {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function abs(a: Vec2, b: Vec2): Vec2 {
	return { x: Math.abs(a.x - b.x), y: Math.abs(a.y - b.y) };
}

export function mul(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x * b.x, y: a.y * b.y };
}

export function dist(a: Vec2, b: Vec2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.hypot(dx, dy);
}

export function distancesFrom(origin: Vec2, a: Vec2, b: Vec2): Vec2 {
	return { x: dist(origin, a), y: dist(origin, b) };
}

export function distSq(a: Vec2, b: Vec2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return dx * dx + dy * dy;
}

export function dot(a: Vec2, b: Vec2): number {
	return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
	return a.x * b.y - a.y * b.x;
}

export function add(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x + b.x, y: a.y + b.y };
}

export function addScaled(a: Vec2, b: Vec2, s: number): Vec2 {
	return { x: a.x + b.x * s, y: a.y + b.y * s };
}

/** Reflects p across the line through axisPoint with the given unit normal. */
export function reflectPoint(p: Vec2, axisPoint: Vec2, unitNormal: Vec2): Vec2 {
	const signedDistance = dot(sub(p, axisPoint), unitNormal);
	return addScaled(p, unitNormal, -2 * signedDistance);
}

export function sum(vectors: Iterable<Vec2>): Vec2 {
	let x = 0;
	let y = 0;
	for (const v of vectors) {
		x += v.x;
		y += v.y;
	}
	return { x, y };
}

export function centroid(vectors: Iterable<Vec2>): Vec2 {
	const pts = Array.isArray(vectors) ? vectors : [...vectors];
	if (pts.length === 0) return { x: 0, y: 0 };
	return scale(sum(pts), 1.0 / pts.length);
}

export function sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function addScalar(a: Vec2, f: number): Vec2 {
	return { x: a.x + f, y: a.y + f };
}

export function subScalar(a: Vec2, f: number): Vec2 {
	return { x: a.x - f, y: a.y - f };
}

export function scale(v: Vec2, s: number): Vec2 {
	return { x: v.x * s, y: v.y * s };
}

export function normalize(v: Vec2): Vec2 {
	const len = Math.hypot(v.x, v.y);
	if (len < 1e-12) return { x: 1, y: 0 };
	return scale(v, 1 / len);
}

export function normalizeOrNull(v: Vec2, minLength = 0): Vec2 | null {
	const len = Math.hypot(v.x, v.y);
	if (len <= minLength) return null;
	return scale(v, 1 / len);
}

export function angle(a: Vec2, b: Vec2): number {
	return Math.atan2(cross(a, b), dot(a, b));
}

/** Returns the signed direction of a vector in radians, relative to the positive X axis. */
export function directionAngle(v: Vec2): number {
	return Math.atan2(v.y, v.x);
}

/** Returns the signed direction of a vector in degrees, relative to the positive X axis. */
export function directionAngleDeg(v: Vec2): number {
	return (directionAngle(v) * 180) / Math.PI;
}

/** Returns the direction from one point to another in radians, relative to the positive X axis. */
export function angleFromTo(from: Vec2, to: Vec2): number {
	return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Returns the direction from one point to another in degrees, relative to the positive X axis. */
export function angleFromToDeg(from: Vec2, to: Vec2): number {
	return (angleFromTo(from, to) * 180) / Math.PI;
}

/** Returns the unsigned angle to the X axis in radians, from 0 to π/2. */
export function angleToXAxis(dir: Vec2): number {
	return Math.atan2(Math.abs(dir.y), Math.abs(dir.x));
}

/** Returns the unsigned angle to the X axis in degrees, from 0 to 90. */
export function angleToXAxisDeg(dir: Vec2): number {
	return (angleToXAxis(dir) * 180) / Math.PI;
}

export function projectPointOntoSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
	const ab = sub(b, a);
	const l2 = dot(ab, ab);
	if (l2 < 1e-12) {
		return { point: a, t: 0, dist: dist(p, a) };
	}
	const ap = sub(p, a);
	const t = Math.max(0, Math.min(1, dot(ap, ab) / l2));
	const projection = addScaled(a, ab, t);
	return { point: projection, t, dist: dist(p, projection) };
}

export function projectPointOntoLine(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
	const ab = sub(b, a);
	const l2 = dot(ab, ab);
	if (l2 < 1e-12) {
		return { point: a, t: 0, dist: dist(p, a) };
	}
	const ap = sub(p, a);
	const t = dot(ap, ab) / l2;
	const projection = addScaled(a, ab, t);
	return { point: projection, t, dist: dist(p, projection) };
}

export function getCircumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
	const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
	if (Math.abs(d) < 1e-6) return null;

	const p1Sq = dot(p1, p1);
	const p2Sq = dot(p2, p2);
	const p3Sq = dot(p3, p3);

	const xc = (p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / d;
	const yc = (p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / d;

	const r = Math.hypot(p1.x - xc, p1.y - yc);
	if (!isFinite(r) || r < 1e-3 || r > 1e6) return null;

	return { center: vec(xc, yc), radius: r };
}

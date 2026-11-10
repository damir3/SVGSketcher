/** Coordinates accepted at data boundaries and as read-only vector operands. */
export type XY = Readonly<{ x: number; y: number }>;

/** A 2D vector. Mutating methods return this vector for chaining. */
export class Vec2 {
	x: number;
	y: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	static from(v: XY): Vec2 {
		return new Vec2(v.x, v.y);
	}

	static fromPolar(radius: number, angle: number): Vec2 {
		return new Vec2(radius * Math.cos(angle), radius * Math.sin(angle));
	}

	static sum(vectors: Iterable<XY>): Vec2 {
		const result = new Vec2();
		for (const v of vectors) result.add(v);
		return result;
	}

	static centroid(vectors: Iterable<XY>): Vec2 {
		const result = new Vec2();
		let count = 0;
		for (const v of vectors) {
			result.add(v);
			count++;
		}
		return count ? result.divideScalar(count) : result;
	}

	set(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	copy(v: XY): this {
		return this.set(v.x, v.y);
	}

	clone(): Vec2 {
		return new Vec2(this.x, this.y);
	}

	add(v: XY): this {
		return this.addVectors(this, v);
	}

	addVectors(a: XY, b: XY): this {
		return this.set(a.x + b.x, a.y + b.y);
	}

	addScaledVector(v: XY, scale: number): this {
		return this.set(this.x + v.x * scale, this.y + v.y * scale);
	}

	addScalar(scalar: number): this {
		return this.set(this.x + scalar, this.y + scalar);
	}

	sub(v: XY): this {
		return this.subVectors(this, v);
	}

	subVectors(a: XY, b: XY): this {
		return this.set(a.x - b.x, a.y - b.y);
	}

	subScalar(scalar: number): this {
		return this.set(this.x - scalar, this.y - scalar);
	}

	multiply(v: XY): this {
		return this.set(this.x * v.x, this.y * v.y);
	}

	multiplyScalar(scalar: number): this {
		return this.set(this.x * scalar, this.y * scalar);
	}

	divideScalar(scalar: number): this {
		return this.multiplyScalar(1 / scalar);
	}

	negate(): this {
		return this.set(-this.x, -this.y);
	}

	/** Rotates the vector 90° counterclockwise. */
	perpendicular(): this {
		return this.set(-this.y, this.x);
	}

	dot(v: XY): number {
		return this.x * v.x + this.y * v.y;
	}

	cross(v: XY): number {
		return this.x * v.y - this.y * v.x;
	}

	lengthSq(): number {
		return this.dot(this);
	}

	length(): number {
		return Math.hypot(this.x, this.y);
	}

	normalize(): this {
		return this.divideScalar(this.length() || 1);
	}

	/** Uses the positive X direction when the sketch has no stable direction. */
	normalizeOrUnitX(): this {
		const length = this.length();
		return length < 1e-12 ? this.set(1, 0) : this.divideScalar(length);
	}

	normalizeOrNull(minLength = 0): this | null {
		const length = this.length();
		return length <= minLength ? null : this.divideScalar(length);
	}

	angle(): number {
		return Math.atan2(-this.y, -this.x) + Math.PI;
	}

	signedAngle(): number {
		return Math.atan2(this.y, this.x);
	}

	signedAngleDeg(): number {
		return (this.signedAngle() * 180) / Math.PI;
	}

	signedAngleTo(v: XY): number {
		return Math.atan2(this.cross(v), this.dot(v));
	}

	angleToPoint(v: XY): number {
		return Math.atan2(v.y - this.y, v.x - this.x);
	}

	angleToPointDeg(v: XY): number {
		return (this.angleToPoint(v) * 180) / Math.PI;
	}

	/** Unsigned angle to the X axis, in degrees from 0 to 90. */
	angleToXAxisDeg(): number {
		return (Math.atan2(Math.abs(this.y), Math.abs(this.x)) * 180) / Math.PI;
	}

	distanceTo(v: XY): number {
		return Math.hypot(v.x - this.x, v.y - this.y);
	}

	distanceToSquared(v: XY): number {
		const dx = v.x - this.x;
		const dy = v.y - this.y;
		return dx * dx + dy * dy;
	}

	distancesTo(a: XY, b: XY): Vec2 {
		return new Vec2(this.distanceTo(a), this.distanceTo(b));
	}

	lerp(v: XY, t: number): this {
		return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
	}

	midpoint(a: XY, b: XY): this {
		return this.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
	}

	/** Rotates this vector about a point by an angle in radians. */
	rotateAround(center: XY, angle: number): this {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const x = this.x - center.x;
		const y = this.y - center.y;
		return this.set(center.x + x * cos - y * sin, center.y + x * sin + y * cos);
	}

	/** Reflects this point across the line through axisPoint with the given unit normal. */
	reflectAcrossLine(axisPoint: XY, unitNormal: XY): this {
		const signedDistance = new Vec2().subVectors(this, axisPoint).dot(unitNormal);
		return this.addScaledVector(unitNormal, -2 * signedDistance);
	}

	equals(v: XY): boolean {
		return this.x === v.x && this.y === v.y;
	}
}

export const ORIGIN: Readonly<Vec2> = Object.freeze(new Vec2());

export function projectPointOntoSegment(p: XY, a: XY, b: XY): { point: Vec2; t: number; dist: number } {
	return projectPoint(p, a, b, true);
}

export function projectPointOntoLine(p: XY, a: XY, b: XY): { point: Vec2; t: number; dist: number } {
	return projectPoint(p, a, b, false);
}

function projectPoint(p: XY, a: XY, b: XY, clampToSegment: boolean): { point: Vec2; t: number; dist: number } {
	const ab = new Vec2().subVectors(b, a);
	const lengthSq = ab.lengthSq();
	const point = Vec2.from(a);
	if (lengthSq < 1e-12) return { point, t: 0, dist: point.distanceTo(p) };

	const lineT = new Vec2().subVectors(p, a).dot(ab) / lengthSq;
	const t = clampToSegment ? Math.max(0, Math.min(1, lineT)) : lineT;
	point.addScaledVector(ab, t);
	return { point, t, dist: point.distanceTo(p) };
}

export function getCircumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
	const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
	if (Math.abs(d) < 1e-6) return null;

	const p1Sq = p1.lengthSq();
	const p2Sq = p2.lengthSq();
	const p3Sq = p3.lengthSq();

	const center = new Vec2(
		(p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / d,
		(p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / d
	);
	const radius = center.distanceTo(p1);
	if (!isFinite(radius) || radius < 1e-3 || radius > 1e6) return null;

	return { center, radius };
}

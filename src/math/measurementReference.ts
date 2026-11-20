import type { ReferenceMeasurement } from '../kernel/inspectionTypes';
import { Vec2, ORIGIN } from './vector';

/** Independent arithmetic retained from the original constraint methods. */
export function measureReference({ kind, data: p }: ReferenceMeasurement): number {
	if (kind === 0) return p[0];
	if (kind === 1) {
		const a = new Vec2(p[0], p[1]),
			b = new Vec2(p[2], p[3]);
		return p[4] === 1 ? Math.abs(b.x - a.x) : p[4] === 2 ? Math.abs(b.y - a.y) : a.distanceTo(b);
	}
	if (kind === 2) return Math.abs(p[1] - p[0]);
	if (kind === 3) {
		const point = new Vec2(p[0], p[1]);
		if (p[9]) point.lerp(new Vec2(p[2], p[3]), 0.5);
		const a = new Vec2(p[4], p[5]),
			dir = new Vec2(p[6], p[7]).sub(a);
		return Math.abs(point.sub(a).cross(dir)) / Math.max(dir.length(), p[8]);
	}
	const a = new Vec2(p[2], p[3]).sub(new Vec2(p[0], p[1])).multiplyScalar(p[8]);
	const b = new Vec2(p[6], p[7]).sub(new Vec2(p[4], p[5])).multiplyScalar(p[9]);
	if (kind === 4) {
		const angle = Math.atan2(a.cross(b), a.dot(b));
		return p[10]
			? (((((angle * p[10]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 180) / Math.PI
			: (Math.abs(angle) * 180) / Math.PI;
	}
	const l1 = a.length(),
		l2 = b.length();
	if (!Number.isFinite(l1) || !Number.isFinite(l2) || l1 === 0 || l2 === 0) return 0;
	const rotated = a.divideScalar(l1).rotateAround(ORIGIN, (p[10] * p[11] * Math.PI) / 180);
	const actual = b.divideScalar(l2);
	return Number(Math.abs(Math.atan2(rotated.cross(actual), rotated.dot(actual))) <= 1e-3);
}

import type { CopyKernel } from '../kernel/copyTypes';
import { Vec2 } from './vector';
export const copyReference: CopyKernel = (points, operations) =>
	operations.map(op => {
		let valid = true,
			angle = 0,
			offset = new Vec2(),
			normal = new Vec2();
		let map = (point: { x: number; y: number }) => Vec2.from(point),
			near = (_point: { x: number; y: number }) => false;
		if (op.type === 'mirror') {
			const dir = new Vec2().subVectors(op.b, op.a),
				length = dir.length();
			valid = !(length < 1e-6);
			if (valid) {
				normal = dir.clone().perpendicular().divideScalar(length);
				map = p => Vec2.from(p).reflectAcrossLine(op.a, normal);
				near = p => Math.abs(new Vec2().subVectors(p, op.a).dot(normal)) < 1e-3;
			}
		} else if (op.type === 'circular' || op.type === 'rotation') {
			if (op.type === 'rotation') angle = op.angle;
			else {
				const n = Math.max(2, Math.round(op.quantity)),
					step = op.angle / (n - 1);
				angle =
					op.distribution === 'full'
						? (op.index * 360) / n
						: op.distribution === 'partial'
							? op.index * step
							: op.index % 2 === 1
								? ((op.index + 1) / 2) * step
								: -(op.index / 2) * step;
				near = p => Vec2.from(op.center).distanceTo(p) < 1e-3;
			}
			map = p => Vec2.from(p).rotateAround(op.center, (angle * Math.PI) / 180);
		} else if (op.type === 'rectangular') {
			const along = (i: number, d: number, mode: string) =>
				i === 0 ? 0 : mode === 'one_direction' ? i * d : i % 2 === 1 ? Math.ceil(i / 2) * d : -(i / 2) * d;
			offset = Vec2.from(op.u1)
				.multiplyScalar(along(op.i, op.distance1, op.direction1))
				.addScaledVector(op.u2, along(op.j, op.distance2, op.direction2));
			map = p => Vec2.from(p).add(offset);
		} else if (op.type === 'translation') {
			offset = Vec2.from(op.offset);
			map = p => Vec2.from(p).add(offset);
		} else {
			const unit = (line: typeof op.line1, fallback: Vec2) => {
				if (!line) return fallback;
				const v = new Vec2().subVectors(line[1], line[0]),
					l = v.length();
				return l > 1e-6 ? v.multiplyScalar(1 / l) : fallback;
			};
			offset = unit(op.line1, new Vec2(1, 0));
			normal = unit(op.line2, offset.clone().perpendicular());
		}
		return { valid, angle, offset, normal, points: points.map(map), near: points.map(near) };
	});

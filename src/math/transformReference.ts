import { ORIGIN, Vec2 } from './vector';
import type { TransformInput, TransformResult } from '../kernel/transformTypes';
/** Original similarity-transform arithmetic, independent of the native implementation. */
export function transformReference(input: TransformInput): TransformResult {
	const center = Vec2.from(input.center),
		translation = Vec2.from(input.translation);
	const angle = ((input.angleDegrees % 360) * Math.PI) / 180;
	const rotate = (vector: { x: number; y: number }) => Vec2.from(vector).rotateAround(ORIGIN, angle);
	return {
		points: input.points.map(point =>
			center
				.clone()
				.add(translation)
				.addScaledVector(new Vec2().subVectors(point, center).rotateAround(ORIGIN, angle), input.scale)
		),
		vectors: input.vectors.map(rotate),
		sizes: input.sizes.map(size => size * input.scale),
	};
}

import type { SketchDocument } from './sketch';
import type { GeoCurve } from '../math/intersection';
import { Vec2, type XY } from '../math/vector';
import { transformGeometry } from '../math/transform';
import type { TransformValues } from './transform';

/** Call-local snapshot: rendering looks up the results of one batch, including spline control points. */
export function prepareTransformPreview(
	sketch: SketchDocument,
	ids: ReadonlySet<string>,
	center: Vec2,
	values: TransformValues
) {
	const points: XY[] = [],
		indices = new Map<string, number>(),
		geometries = new Map<string, GeoCurve | null>();
	const key = (x: number, y: number) => `${Object.is(x, -0) ? '-0' : x},${Object.is(y, -0) ? '-0' : y}`;
	const add = (point: XY) => {
		const k = key(point.x, point.y);
		if (!indices.has(k)) {
			indices.set(k, points.length);
			points.push(point);
		}
	};
	add(center);
	for (const id of ids) {
		const primitive = sketch.getPrimitive(id);
		if (!primitive) continue;
		for (const pointId of primitive.getPointIds(sketch)) {
			const point = sketch.points.get(pointId);
			if (point) add(point);
		}
		if (primitive.type === 'spline') {
			const curve = primitive.toGeoCurve(sketch);
			geometries.set(id, curve);
			if (curve?.type === 'spline') {
				curve.points.forEach(add);
				for (const segment of curve.bezierSegments) segment.forEach(add);
			}
		}
	}
	const result = transformGeometry({
		center,
		translation: { x: values.x, y: values.y },
		angleDegrees: values.angle,
		scale: values.scale,
		points,
		vectors: [],
		sizes: [],
	});
	return {
		geometries,
		point(x: number, y: number): Vec2 {
			const index = indices.get(key(x, y));
			if (index === undefined) throw new Error('Missing point in transform preview snapshot');
			return Vec2.from(result.points[index]);
		},
	};
}

import type { SketchDocument } from './sketch';
import type { CopyOperation, CopyResult } from '../kernel/copyTypes';
import type { GeoCurve } from '../math/intersection';
import { copyGeometry } from '../math/copyGeometry';
import { Vec2, type XY } from '../math/vector';
export interface PreparedCopy {
	result: CopyResult;
	geometries: ReadonlyMap<string, GeoCurve | null>;
	point(id: string, p: XY): Vec2;
	near(id: string, p: XY): boolean;
	transformPoint(x: number, y: number): Vec2;
}
/** Fresh snapshot per action/frame; Bezier controls are only needed by the preview renderer. */
export function prepareCopies(
	sketch: SketchDocument,
	ids: Iterable<string>,
	operations: readonly CopyOperation[],
	preview = false
): PreparedCopy[] {
	const points: XY[] = [],
		indices = new Map<string, number>(),
		byId = new Map<string, number>(),
		geometries = new Map<string, GeoCurve | null>();
	const key = (x: number, y: number) => `${Object.is(x, -0) ? '-0' : x},${Object.is(y, -0) ? '-0' : y}`;
	const add = (p: XY) => {
		const k = key(p.x, p.y);
		let index = indices.get(k);
		if (index === undefined) {
			index = points.length;
			indices.set(k, index);
			points.push({ x: p.x, y: p.y });
		}
		return index;
	};
	for (const id of ids) {
		const primitive = sketch.getPrimitive(id);
		if (!primitive) continue;
		for (const pid of primitive.getPointIds(sketch)) {
			const p = sketch.points.get(pid);
			if (p) byId.set(pid, add(p));
		}
		if (preview && primitive.type === 'spline') {
			const curve = primitive.toGeoCurve(sketch);
			geometries.set(id, curve);
			if (curve?.type === 'spline') {
				curve.points.forEach(add);
				for (const seg of curve.bezierSegments) seg.forEach(add);
			}
		}
	}
	return copyGeometry(points, operations).map((result, i) => {
		const current = (id: string, p: XY) => {
			const index = byId.get(id);
			return index !== undefined && points[index].x === p.x && points[index].y === p.y
				? { point: result.points[index], near: result.near[index] }
				: (() => {
						const next = copyGeometry([p], [operations[i]])[0];
						return { point: next.points[0], near: next.near[0] };
					})();
		};
		return {
			result,
			geometries,
			point: (id, p) => Vec2.from(current(id, p).point),
			near: (id, p) => current(id, p).near,
			transformPoint(x, y) {
				const index = indices.get(key(x, y));
				if (index === undefined) throw Error('Missing point in copy preview');
				return Vec2.from(result.points[index]);
			},
		};
	});
}

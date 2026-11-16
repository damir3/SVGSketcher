// Frozen pre-native offset spline resizing; preserve split order and seam arithmetic.
import type { KernelOffsetPrimitive } from '../kernel/offsetTypes';
import { Vec2 } from './vector';
import { splitBezier } from './splineReference';

/** Refine compact cubics exactly when an existing document has more fit-point IDs. */
export function resizeOffsetSpline(prim: KernelOffsetPrimitive, count: number, d: number): void {
	if (!prim.fitPoints || !prim.fitNormals || !prim.handles || prim.fitPoints.length >= count) return;
	const points = prim.fitPoints.map(Vec2.from),
		normals = prim.fitNormals.map(Vec2.from),
		handles = prim.handles.map(h => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }));
	while (points.length < count) {
		let index = 0,
			best = -1;
		for (let i = 0; i + 1 < points.length; i++) {
			const length =
				points[i].distanceTo(handles[i].h2) +
				handles[i].h2.distanceTo(handles[i + 1].h1) +
				handles[i + 1].h1.distanceTo(points[i + 1]);
			if (length > best) {
				best = length;
				index = i;
			}
		}
		const { left, right } = splitBezier(
			[points[index], handles[index].h2, handles[index + 1].h1, points[index + 1]],
			0.5
		);
		handles[index].h2 = left[1];
		handles[index + 1].h1 = right[2];
		points.splice(index + 1, 0, left[3]);
		normals.splice(
			index + 1,
			0,
			normals[index]
				.clone()
				.lerp(normals[index + 1], 0.5)
				.normalizeOrUnitX()
		);
		handles.splice(index + 1, 0, { h1: left[2], h2: right[1] });
	}
	if (prim.isSplineClosed) {
		const seam = { h1: handles.at(-1)!.h1.clone(), h2: handles[0].h2.clone() };
		handles[0] = seam;
		handles[handles.length - 1] = { h1: seam.h1.clone(), h2: seam.h2.clone() };
	}
	prim.fitPoints = points;
	prim.fitNormals = normals;
	prim.fitBases = points.map((p, i) => p.clone().addScaledVector(normals[i], -d));
	prim.handles = handles;
}

import { getGeometryKernel } from '../kernel';
import type { KernelOffsetPrimitive } from '../kernel/offsetTypes';
import { Vec2 } from './vector';

/** Refine compact cubics exactly when an existing document has more fit-point IDs. */
export function resizeOffsetSpline(prim: KernelOffsetPrimitive, count: number, d: number): void {
	if (!prim.fitPoints || !prim.fitNormals || !prim.handles || prim.fitPoints.length >= count) return;
	const resize = getGeometryKernel().offset?.resizeSpline;
	if (!resize) throw new Error('Offset spline resizing requires the Rust/WASM kernel');
	const result = resize(
		{ points: prim.fitPoints, normals: prim.fitNormals, handles: prim.handles, closed: !!prim.isSplineClosed },
		count,
		d
	);
	prim.fitPoints = result.points.map(Vec2.from);
	prim.fitNormals = result.normals.map(Vec2.from);
	prim.fitBases = result.bases.map(Vec2.from);
	prim.handles = result.handles.map(h => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }));
}

import { getGeometryKernel } from '../kernel';
import type { CopyKernel } from '../kernel/copyTypes';
import { Vec2 } from './vector';
export const copyGeometry: CopyKernel = (points, operations) => {
	const kernel = getGeometryKernel().copies;
	if (!kernel) throw new Error('Copy geometry requires the Rust/WASM kernel');
	return kernel(points, operations);
};
/** Editor direction preparation; the solver's independent TS formula helpers remain unchanged. */
export function patternDirections(
	values: ReadonlyMap<string, number>,
	line1?: { p1Id: string; p2Id: string } | null,
	line2?: { p1Id: string; p2Id: string } | null
) {
	const line = (v: typeof line1): readonly [Vec2, Vec2] | null =>
		v
			? [
					new Vec2(values.get(v.p1Id + '.x') ?? 0, values.get(v.p1Id + '.y') ?? 0),
					new Vec2(values.get(v.p2Id + '.x') ?? 0, values.get(v.p2Id + '.y') ?? 0),
				]
			: null;
	const result = copyGeometry([], [{ type: 'directions', line1: line(line1), line2: line(line2) }])[0];
	return { u1: Vec2.from(result.offset), u2: Vec2.from(result.normal) };
}

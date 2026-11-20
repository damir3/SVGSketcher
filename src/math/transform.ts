import { getGeometryKernel } from '../kernel';
import type { TransformInput, TransformResult } from '../kernel/transformTypes';
import { transformReference } from './transformReference';

export function transformGeometry(input: TransformInput): TransformResult {
	const kernel = getGeometryKernel().transform;
	const finitePoint = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);
	if (
		kernel &&
		finitePoint(input.center) &&
		finitePoint(input.translation) &&
		input.points.every(finitePoint) &&
		input.vectors.every(finitePoint) &&
		Number.isFinite(input.angleDegrees) &&
		Number.isFinite(input.scale) &&
		input.sizes.every(Number.isFinite)
	)
		return kernel(input);
	return transformReference(input);
}

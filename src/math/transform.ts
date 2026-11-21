import { getGeometryKernel } from '../kernel';
import type { TransformInput, TransformResult } from '../kernel/transformTypes';

export function transformGeometry(input: TransformInput): TransformResult {
	const kernel = getGeometryKernel().transform;
	if (!kernel) throw new Error('Transform geometry requires the Rust/WASM kernel');
	return kernel(input);
}

import { GEOMETRY_KERNEL_API_VERSION, type GeometryKernel } from './types';

let kernel: GeometryKernel | undefined;

export function getGeometryKernel(): GeometryKernel {
	if (!kernel) throw new Error('Geometry kernel is not initialized');
	return kernel;
}

/** Install only after initialization; synchronous geometry callers never observe a partial backend. */
export function setGeometryKernel(next: GeometryKernel): void {
	if (next.apiVersion !== GEOMETRY_KERNEL_API_VERSION) throw new Error('Unsupported geometry kernel API version');
	kernel = next;
}

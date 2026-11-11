import { GEOMETRY_KERNEL_API_VERSION, type GeometryKernel } from './types';
import { typescriptGeometryKernel } from './typescript';

let kernel: GeometryKernel = typescriptGeometryKernel;

export function getGeometryKernel(): GeometryKernel {
	return kernel;
}

/** Install only after initialization; synchronous geometry callers never observe a partial backend. */
export function setGeometryKernel(next: GeometryKernel): void {
	if (next.apiVersion !== GEOMETRY_KERNEL_API_VERSION) throw new Error('Unsupported geometry kernel API version');
	kernel = next;
}

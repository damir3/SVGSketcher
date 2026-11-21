import { getGeometryKernel } from '../kernel';
import type { ReferenceMeasurement } from '../kernel/inspectionTypes';
export function measure(request: ReferenceMeasurement): number {
	const inspect = getGeometryKernel().inspectConstraints;
	if (!inspect) throw new Error('Reference measurement requires the Rust/WASM kernel');
	if (!request.data.every(Number.isFinite)) return NaN;
	return inspect({ nativeConstraints: new Float64Array(), rowCounts: [], measurements: [request] }).measurements[0];
}

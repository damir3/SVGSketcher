import { getGeometryKernel } from '../kernel';
import type { ReferenceMeasurement } from '../kernel/inspectionTypes';
import { measureReference } from './measurementReference';
export function measure(request: ReferenceMeasurement): number {
	const inspect = getGeometryKernel().inspectConstraints;
	if (!inspect || !request.data.every(Number.isFinite)) return measureReference(request);
	return inspect({ nativeConstraints: new Float64Array(), rowCounts: [], measurements: [request] }).measurements[0];
}

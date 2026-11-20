import { getGeometryKernel } from '../kernel';
import type { IConstraint } from './types';
import type { SketchDocument } from '../model/sketch';
import { compileNativeConstraints, describeNativeConstraint } from './nativeConstraints';
import { AngleConstraint } from './constraints/angle';
import { DistanceConstraint } from './constraints/distance';
import { PointToLineDistanceConstraint } from './constraints/pointToLineDistance';
import { RadiusConstraint } from './constraints/radius';
import { OffsetConstraint } from './constraints/offset';

/** Retain callback order/short-circuiting for constraints that cannot be inspected natively. */
export function checkConstraints(constraints: IConstraint[], values: Map<string, number>, geometryFirst = false) {
	const kernel = getGeometryKernel().inspectConstraints;
	if (kernel) {
		const descriptions = new Map(constraints.map(c => [c, describeNativeConstraint(c)] as const));
		const supported = constraints.every(
			c =>
				descriptions.get(c) &&
				(!c.isSatisfied ||
					((c.constructor as Function) === AngleConstraint && c.isSatisfied === AngleConstraint.prototype.isSatisfied))
		);
		if (supported) {
			const compiled = compileNativeConstraints(constraints, values, new Map(), descriptions);
			if (!compiled.fallbackAll.length && compiled.data.every(Number.isFinite))
				return kernel({
					nativeConstraints: compiled.data,
					rowCounts: constraints.map(c => c.getEquationsCount()),
					measurements: [],
				});
		}
	}
	const satisfied = () => constraints.every(c => !c.isSatisfied || c.isSatisfied(values));
	if (geometryFirst && !satisfied()) return { error: NaN, satisfied: false };
	const error = constraints.reduce((sum, c) => sum + c.evaluate(values).reduce((s, r) => s + (r * r) / 2, 0), 0);
	return { error, satisfied: geometryFirst || satisfied() };
}

const measuredClasses = [
	DistanceConstraint,
	PointToLineDistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	OffsetConstraint,
];

/** One call for all standard reference dimensions; no cross-action geometry cache. */
export function updateReferenceValues(
	constraints: IConstraint[],
	values: Map<string, number>,
	sketch: SketchDocument
): void {
	const kernel = getGeometryKernel().inspectConstraints;
	const supported =
		kernel &&
		constraints.every(c =>
			measuredClasses.some(
				type =>
					(c.constructor as Function) === type &&
					c.updateReferenceValue === type.prototype.updateReferenceValue &&
					c.getReferenceMeasurement === type.prototype.getReferenceMeasurement
			)
		);
	if (supported && constraints.length) {
		const measurements = constraints.map(c => c.getReferenceMeasurement!(values, sketch));
		if (measurements.every(m => m.data.every(Number.isFinite))) {
			const result = kernel({ nativeConstraints: new Float64Array(), rowCounts: [], measurements });
			constraints.forEach((c, i) => c.updateReferenceValue!(values, sketch, result.measurements[i]));
			return;
		}
	}
	for (const c of constraints) c.updateReferenceValue?.(values, sketch);
}

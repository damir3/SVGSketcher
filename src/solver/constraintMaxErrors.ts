import { getGeometryKernel } from '../kernel';
import { compileNativeConstraints, describeNativeConstraint } from './nativeConstraints';
import type { IConstraint } from './types';
export interface ConstraintCheck {
	constraint: IConstraint;
	values: Map<string, number>;
}
export function constraintMaxErrors(checks: readonly ConstraintCheck[]): number[] {
	const kernel = getGeometryKernel().constraintErrors;
	if (kernel && checks.every(({ constraint }) => describeNativeConstraint(constraint))) {
		const data: number[] = [],
			rowCounts: number[] = [],
			weights: number[] = [];
		let row = 0,
			supported = true;
		for (const { constraint, values } of checks) {
			const compiled = compileNativeConstraints([constraint], values, new Map());
			if (compiled.fallbackAll.length) {
				supported = false;
				break;
			}
			const part = compiled.data;
			for (let at = 0; at < part.length; ) {
				part[at + 1] += row;
				if (part[at + 2] >= 0) part[at + 2] += row;
				at += 7 + 2 * part[at + 6];
			}
			for (const value of part) data.push(value);
			const count = constraint.getEquationsCount();
			rowCounts.push(count);
			weights.push(constraint.weight);
			row += count;
		}
		if (supported && data.every(Number.isFinite) && weights.every(Number.isFinite))
			return Array.from(kernel({ nativeConstraints: new Float64Array(data), rowCounts, weights }));
	}
	return checks.map(
		({ constraint, values }) =>
			constraint.evaluate(values).reduce((max, r) => Math.max(max, Math.abs(r)), 0) / (Math.abs(constraint.weight) || 1)
	);
}

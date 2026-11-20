import { MEASUREMENT_ARITIES, type InspectionKernel, type ConstraintErrorKernel } from './inspectionTypes';
export type ConstraintErrorBinding = (
	constraints: Float64Array,
	groups: Float64Array,
	weights: Float64Array
) => Float64Array;
export function createWasmConstraintErrors(binding: ConstraintErrorBinding): ConstraintErrorKernel {
	return input => {
		if (
			input.weights.length !== input.rowCounts.length ||
			!input.weights.every(Number.isFinite) ||
			!input.nativeConstraints.every(Number.isFinite) ||
			input.rowCounts.some(n => !Number.isSafeInteger(n) || n < 0)
		)
			throw new Error('Invalid constraint error input');
		const result = binding(input.nativeConstraints, new Float64Array(input.rowCounts), new Float64Array(input.weights));
		if (result.length !== input.weights.length) throw new Error('Invalid WASM constraint error result');
		return result;
	};
}
export type InspectionBinding = (
	constraints: Float64Array,
	groups: Float64Array,
	measurements: Float64Array
) => Float64Array;
export function createWasmInspection(binding: InspectionBinding): InspectionKernel {
	return input => {
		const measurements: number[] = [];
		for (const m of input.measurements) {
			if (m.data.length !== MEASUREMENT_ARITIES[m.kind]) throw new Error('Invalid measurement arity');
			measurements.push(m.kind, ...m.data);
		}
		if (
			!input.nativeConstraints.every(Number.isFinite) ||
			input.rowCounts.some(n => !Number.isSafeInteger(n) || n < 0) ||
			!measurements.every(Number.isFinite)
		)
			throw new Error('Invalid constraint inspection input');
		const out = binding(input.nativeConstraints, new Float64Array(input.rowCounts), new Float64Array(measurements));
		if (out.length !== 2 + input.measurements.length || ![0, 1].includes(out[1]))
			throw new Error('Invalid WASM constraint inspection result');
		if (input.measurements.some((m, i) => m.kind === 5 && ![0, 1].includes(out[2 + i])))
			throw new Error('Invalid WASM angle validity result');
		// Overflow/NaN in evaluated geometry is meaningful: callers must reject it, as in the TS implementation.
		return { error: out[0], satisfied: !!out[1], measurements: out.slice(2) };
	};
}

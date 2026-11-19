import type { DependencyKernel } from './dependencyTypes';
export type DependencyBinding = (
	values: Float64Array,
	constraints: Float64Array,
	rules: Float64Array,
	settings: Float64Array
) => Float64Array;
export function createWasmDependency(binding: DependencyBinding): DependencyKernel {
	return input => {
		const rules: number[] = [];
		let rows = 0;
		for (const rule of input.rules) {
			rules.push(rule.rows, ['solver', 'central', 'offset'].indexOf(rule.mode), rule.columns.length, ...rule.columns);
			rows += rule.rows;
		}
		const settings = new Float64Array([
			input.hardRows,
			rows,
			Number(input.candidateHasFreeParameters),
			Number(input.checkGeometricOffsets),
		]);
		if (
			!input.values.every(Number.isFinite) ||
			!input.nativeConstraints.every(Number.isFinite) ||
			!rules.every(Number.isFinite) ||
			!settings.every(Number.isFinite)
		)
			throw new Error('Non-finite dependency analysis input');
		const out = binding(input.values, input.nativeConstraints, new Float64Array(rules), settings);
		if (out.length !== 1 || ![0, 1].includes(out[0])) throw new Error('Invalid WASM dependency result');
		return !!out[0];
	};
}

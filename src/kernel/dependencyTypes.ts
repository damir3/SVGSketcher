/** Differentiation policy for one original constraint, including composite native records. */
export interface DependencyRule {
	rows: number;
	mode: 'solver' | 'central' | 'offset';
	/** Relevant free columns in parameter-manager order. */
	columns: readonly number[];
}
export interface DependencyInput {
	values: Float64Array;
	nativeConstraints: Float64Array;
	rules: readonly DependencyRule[];
	hardRows: number;
	candidateHasFreeParameters: boolean;
	checkGeometricOffsets: boolean;
}
export type DependencyKernel = (input: DependencyInput) => boolean;

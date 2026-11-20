/** Packed measurement tags: scalar, distance, radius gap, point/line, angle, angle validity. */
export interface ReferenceMeasurement {
	kind: 0 | 1 | 2 | 3 | 4 | 5;
	data: readonly number[];
}
export const MEASUREMENT_ARITIES = [1, 5, 2, 10, 11, 12] as const;
export interface InspectionInput {
	/** Existing native constraint records with all references stored as constants (free index -1). */
	nativeConstraints: Float64Array;
	/** Original constraint boundaries, including zero-equation constraints. */
	rowCounts: readonly number[];
	measurements: readonly ReferenceMeasurement[];
}
export interface InspectionResult {
	error: number;
	satisfied: boolean;
	measurements: Float64Array;
}
export type InspectionKernel = (input: InspectionInput) => InspectionResult;
export interface ConstraintErrorInput {
	nativeConstraints: Float64Array;
	rowCounts: readonly number[];
	weights: readonly number[];
}
/** Per-original-constraint maximum absolute residual, divided by abs(weight) or 1 for zero weight. */
export type ConstraintErrorKernel = (input: ConstraintErrorInput) => Float64Array;

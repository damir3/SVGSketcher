/** Batched requests made by the numerical loop. No callback crosses WASM per individual constraint. */
export const SolverEvaluation = {
	Residuals: 0,
	Linearization: 1,
	HardResiduals: 2,
	HardJacobian: 3,
	Commit: 4,
} as const;
export type SolverEvaluationMode = (typeof SolverEvaluation)[keyof typeof SolverEvaluation];

export interface KernelSolverOptions {
	maxIterations: number;
	tolerance: number;
	gradRelTolerance?: number;
	initialLambda: number;
	lambdaFactor: number;
	minLambda: number;
	maxLambda: number;
}

export interface KernelSolveProblem {
	values: Float64Array;
	stiffness: Float64Array;
	lowerBounds: Float64Array;
	equationsCount: number;
	hardEquationsCount: number;
	skipDoF: boolean;
	options: KernelSolverOptions;
	/** Native constraint records; omitted for an entirely callback-driven system. */
	nativeConstraints?: Float64Array;
}

export interface KernelSolveResult {
	status: 'CONVERGED' | 'UNDER_CONSTRAINED' | 'OVER_CONSTRAINED';
	iterations: number;
	initialError: number;
	finalError: number;
	degreesOfFreedom: number;
	values: Float64Array;
	constrainedIndices: number[];
}

/** Linearization packs residuals first, followed by the dense row-major Jacobian. */
export type KernelSolverEvaluator = (values: Float64Array, mode: SolverEvaluationMode) => Float64Array;
export type KernelSolve = (problem: KernelSolveProblem, evaluate: KernelSolverEvaluator) => KernelSolveResult;

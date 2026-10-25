export type ConstraintType =
	| 'fixed'
	| 'coincident'
	| 'point_on_line'
	| 'point_on_circle'
	| 'horizontal'
	| 'vertical'
	| 'distance'
	| 'radius'
	| 'equal_length'
	| 'equal_radius'
	| 'parallel'
	| 'collinear'
	| 'perpendicular'
	| 'concentric'
	| 'tangent_line_circle'
	| 'tangent_circle_circle'
	| 'midpoint'
	| 'drag_point'
	| 'angle'
	| 'arc_endpoints'
	| 'ellipse_axis'
	| 'elliptical_arc_endpoints'
	| 'point_to_line_distance'
	| 'symmetry'
	| 'circular_pattern'
	| 'rectangular_pattern';

export interface ParamRef {
	id: string;
	get(): number;
	set(val: number): void;
	isFixed?: boolean;
	/** Optional lower bound enforced inside the solver iterations (e.g. radius >= 1) */
	min?: number;
}

/** Per-call options for NumericalSolver.solve */
export interface SolveCallOptions {
	/** Parameters treated as fixed for this solve call only */
	lockedParams?: Set<string>;
	/**
	 * Relative "stiffness" of parameters in the LM damping term. Values > 1 make the
	 * solver prefer changing other parameters first (parameter changes last).
	 */
	paramStiffness?: Map<string, number>;
	/** Skip the (expensive) degrees-of-freedom rank computation */
	skipDoF?: boolean;
}

export interface JacobianEntry {
	row: number; // equation index
	col: number; // parameter index
	val: number; // partial derivative dF_row / dX_col
}

export interface IConstraint {
	readonly id: string;
	readonly type: ConstraintType;
	name: string;
	weight: number;
	isSoft?: boolean;
	isDimensional?: boolean;
	value?: number;
	entityIds: string[];

	getEquationsCount(): number;
	evaluate(paramMap: Map<string, number>): number[];
	jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[];
	render?(context: any): void;
}

export interface SolverOptions {
	maxIterations?: number;
	tolerance?: number;
	initialLambda?: number;
	lambdaFactor?: number;
	minLambda?: number;
	maxLambda?: number;
}

export type SolverStatus = 'CONVERGED' | 'UNDER_CONSTRAINED' | 'OVER_CONSTRAINED' | 'MAX_ITERATIONS';

export interface SolverResult {
	status: SolverStatus;
	iterations: number;
	initialError: number;
	finalError: number;
	degreesOfFreedom: number;
	freeParametersCount: number;
	equationsCount: number;
}

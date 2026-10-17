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
  | 'perpendicular'
  | 'concentric'
  | 'tangent_line_circle'
  | 'midpoint'
  | 'drag_point'
  | 'angle'
  | 'arc_endpoints'
  | 'ellipse_axis'
  | 'elliptical_arc_endpoints';

export interface ParamRef {
  id: string;
  get(): number;
  set(val: number): void;
  isFixed?: boolean;
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

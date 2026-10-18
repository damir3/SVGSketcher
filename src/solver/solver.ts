import { Matrix, solveLinearSystem, computeRank } from '../math/matrix';
import type { IConstraint, ParamRef, SolveCallOptions, SolverOptions, SolverResult, SolverStatus } from './types';

export class ParamManager {
  private params = new Map<string, ParamRef>();
  private freeParams: ParamRef[] = [];
  private paramIndices = new Map<string, number>();

  register(param: ParamRef): void {
    this.params.set(param.id, param);
  }

  unregister(paramId: string): void {
    this.params.delete(paramId);
  }

  clear(): void {
    this.params.clear();
    this.freeParams = [];
    this.paramIndices.clear();
  }

  prepare(lockedParams?: Set<string>): void {
    this.freeParams = [];
    this.paramIndices.clear();

    for (const [id, param] of this.params.entries()) {
      if (!param.isFixed && !lockedParams?.has(id)) {
        this.paramIndices.set(id, this.freeParams.length);
        this.freeParams.push(param);
      }
    }
  }

  getFreeParams(): readonly ParamRef[] {
    return this.freeParams;
  }

  /** Restores parameter values previously captured via getCurrentValues() */
  restoreValues(values: Map<string, number>): void {
    for (const [id, val] of values.entries()) {
      this.params.get(id)?.set(val);
    }
  }

  getFreeCount(): number {
    return this.freeParams.length;
  }

  getIndices(): Map<string, number> {
    return this.paramIndices;
  }

  getCurrentValues(): Map<string, number> {
    const map = new Map<string, number>();
    for (const [id, param] of this.params.entries()) {
      map.set(id, param.get());
    }
    return map;
  }

  getStateVector(): Float64Array {
    const x = new Float64Array(this.freeParams.length);
    for (let i = 0; i < this.freeParams.length; i++) {
      x[i] = this.freeParams[i].get();
    }
    return x;
  }

  applyStateVector(x: Float64Array): void {
    for (let i = 0; i < this.freeParams.length; i++) {
      this.freeParams[i].set(x[i]);
    }
  }

  applyToMap(paramMap: Map<string, number>, x: Float64Array): void {
    for (let i = 0; i < this.freeParams.length; i++) {
      paramMap.set(this.freeParams[i].id, x[i]);
    }
  }
}

export class NumericalSolver {
  private options: Required<SolverOptions>;

  constructor(options?: SolverOptions) {
    this.options = {
      maxIterations: options?.maxIterations ?? 40,
      tolerance: options?.tolerance ?? 1e-6,
      initialLambda: options?.initialLambda ?? 1e-3,
      lambdaFactor: options?.lambdaFactor ?? 4,
      minLambda: options?.minLambda ?? 1e-9,
      maxLambda: options?.maxLambda ?? 1e7,
    };
  }

  solve(paramMgr: ParamManager, constraints: IConstraint[], callOptions: SolveCallOptions = {}): SolverResult {
    paramMgr.prepare(callOptions.lockedParams);
    const n = paramMgr.getFreeCount();
    const paramIndices = paramMgr.getIndices();
    const freeParams = paramMgr.getFreeParams();

    // Per-parameter damping scale and lower bounds
    const stiffness = new Float64Array(n);
    const lowerBounds = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      stiffness[i] = callOptions.paramStiffness?.get(freeParams[i].id) ?? 1;
      lowerBounds[i] = freeParams[i].min ?? -Infinity;
    }
    const dofOf = (map: Map<string, number>): number =>
      callOptions.skipDoF ? 0 : this.computeDoF(paramMgr, constraints, map);

    // Calculate total equations
    let totalEquations = 0;
    for (const c of constraints) {
      totalEquations += c.getEquationsCount();
    }

    if (n === 0 || totalEquations === 0) {
      return {
        status: 'CONVERGED',
        iterations: 0,
        initialError: 0,
        finalError: 0,
        degreesOfFreedom: Math.max(0, n),
        freeParametersCount: n,
        equationsCount: totalEquations,
      };
    }

    const paramMap = paramMgr.getCurrentValues();

    let x = paramMgr.getStateVector();
    let currentError = this.evaluateError(constraints, paramMap);
    const initialError = currentError;

    if (currentError < this.options.tolerance * this.options.tolerance) {
      const dof = dofOf(paramMap);
      return {
        status: dof === 0 ? 'CONVERGED' : 'UNDER_CONSTRAINED',
        iterations: 0,
        initialError,
        finalError: currentError,
        degreesOfFreedom: dof,
        freeParametersCount: n,
        equationsCount: totalEquations,
      };
    }

    let lambda = this.options.initialLambda;
    let iteration = 0;

    for (iteration = 0; iteration < this.options.maxIterations; iteration++) {
      // Build Residuals vector F and Jacobian matrix J
      const F = new Float64Array(totalEquations);
      const J = Matrix.zeros(totalEquations, n);

      let eqOffset = 0;
      for (const c of constraints) {
        const residuals = c.evaluate(paramMap);
        for (let i = 0; i < residuals.length; i++) {
          F[eqOffset + i] = residuals[i];
        }

        const entries = c.jacobian(paramIndices, eqOffset, paramMap);
        for (const entry of entries) {
          J.set(entry.row, entry.col, entry.val);
        }

        eqOffset += c.getEquationsCount();
      }

      // Normal equations: A = J^T * J, g = J^T * F
      const JT = J.transpose();
      const A = JT.multiply(J);
      const g = JT.multiplyVector(F);

      // Gradient norm check
      let gradNormSq = 0;
      for (let i = 0; i < n; i++) gradNormSq += g[i] * g[i];
      if (Math.sqrt(gradNormSq) < this.options.tolerance) {
        break;
      }

      // Add Levenberg-Marquardt damping: (A + lambda * diag(A + I)) * delta = -g
      // Stiffer parameters get proportionally more damping, so the solver prefers
      // moving the other parameters first.
      const H = A.clone();
      for (let i = 0; i < n; i++) {
        const diagVal = Math.max(Math.abs(A.get(i, i)), 1.0);
        H.addAt(i, i, lambda * diagVal * stiffness[i]);
      }

      const negG = new Float64Array(n);
      for (let i = 0; i < n; i++) negG[i] = -g[i];

      const deltaX = solveLinearSystem(H, negG);
      if (!deltaX) {
        // Singular system, increase damping
        lambda = Math.min(lambda * this.options.lambdaFactor * 2, this.options.maxLambda);
        continue;
      }

      // Candidate step
      const candidateX = new Float64Array(n);
      let stepNormSq = 0;
      for (let i = 0; i < n; i++) {
        // Projected step: respect parameter lower bounds
        candidateX[i] = Math.max(lowerBounds[i], x[i] + deltaX[i]);
        const d = candidateX[i] - x[i];
        stepNormSq += d * d;
      }

      paramMgr.applyToMap(paramMap, candidateX);
      const candidateError = this.evaluateError(constraints, paramMap);

      if (candidateError < currentError) {
        // Step accepted
        x = candidateX;
        currentError = candidateError;
        paramMgr.applyStateVector(x);
        lambda = Math.max(lambda / this.options.lambdaFactor, this.options.minLambda);

        if (Math.sqrt(stepNormSq) < this.options.tolerance || currentError < this.options.tolerance * this.options.tolerance) {
          iteration++;
          break;
        }
      } else {
        // Step rejected, revert paramMap
        paramMgr.applyToMap(paramMap, x);
        lambda = Math.min(lambda * this.options.lambdaFactor, this.options.maxLambda);
      }
    }

    const hardConstraints = constraints.filter(c => !c.isSoft);
    const hardError = this.evaluateError(hardConstraints, paramMap);
    const degreesOfFreedom = dofOf(paramMap);
    let status: SolverStatus;

    if (hardError > 1e-2) {
      status = 'OVER_CONSTRAINED';
    } else if (degreesOfFreedom > 0) {
      status = 'UNDER_CONSTRAINED';
    } else {
      status = 'CONVERGED';
    }

    return {
      status,
      iterations: iteration,
      initialError,
      finalError: currentError,
      degreesOfFreedom,
      freeParametersCount: n,
      equationsCount: totalEquations,
    };
  }

  private evaluateError(constraints: IConstraint[], paramMap: Map<string, number>): number {
    let sumSq = 0;
    for (const c of constraints) {
      const res = c.evaluate(paramMap);
      for (let i = 0; i < res.length; i++) {
        sumSq += res[i] * res[i];
      }
    }
    return sumSq * 0.5;
  }

  private computeDoF(paramMgr: ParamManager, constraints: IConstraint[], paramMap: Map<string, number>): number {
    const hardConstraints = constraints.filter(c => !c.isSoft);
    let totalEquations = 0;
    for (const c of hardConstraints) {
      totalEquations += c.getEquationsCount();
    }

    const n = paramMgr.getFreeCount();
    if (totalEquations === 0) return n;

    const paramIndices = paramMgr.getIndices();
    const J = Matrix.zeros(totalEquations, n);

    let eqOffset = 0;
    for (const c of hardConstraints) {
      const entries = c.jacobian(paramIndices, eqOffset, paramMap);
      for (const entry of entries) {
        J.set(entry.row, entry.col, entry.val);
      }
      eqOffset += c.getEquationsCount();
    }

    const rank = computeRank(J);
    return Math.max(0, n - rank);
  }
}

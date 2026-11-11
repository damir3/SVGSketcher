import {
	analyzeNullspaceSparse,
	finalizeSparseRows,
	normalEquationsFromSparseRows,
	solveSparseLinearSystem,
} from '../math/matrix';
import type { IConstraint, ParamRef, SolveCallOptions, SolverOptions, SolverResult, SolverStatus } from './types';
import { getGeometryKernel } from '../kernel';
import { solveWithKernel } from './kernelAdapter';

export class ParamManager {
	private params = new Map<string, ParamRef>();
	private freeParams: ParamRef[] = [];
	private paramIndices = new Map<string, number>();

	constructor() {
		this.registerBuiltInParams();
	}

	private registerBuiltInParams(): void {
		const nop = () => {};
		this.params.set('origin.x', { id: 'origin.x', get: () => 0, set: nop, isFixed: true });
		this.params.set('origin.y', { id: 'origin.y', get: () => 0, set: nop, isFixed: true });
		this.params.set('axis_x.x', { id: 'axis_x.x', get: () => 1, set: nop, isFixed: true });
		this.params.set('axis_x.y', { id: 'axis_x.y', get: () => 0, set: nop, isFixed: true });
		this.params.set('axis_y.x', { id: 'axis_y.x', get: () => 0, set: nop, isFixed: true });
		this.params.set('axis_y.y', { id: 'axis_y.y', get: () => 1, set: nop, isFixed: true });
	}

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
		this.registerBuiltInParams();
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
			gradRelTolerance: options?.gradRelTolerance ?? 0,
			initialLambda: options?.initialLambda ?? 1e-3,
			lambdaFactor: options?.lambdaFactor ?? 4,
			minLambda: options?.minLambda ?? 1e-9,
			maxLambda: options?.maxLambda ?? 1e7,
		};
	}

	get maxIterations(): number {
		return this.options.maxIterations;
	}

	solve(paramMgr: ParamManager, constraints: IConstraint[], callOptions: SolveCallOptions = {}): SolverResult {
		const kernel = getGeometryKernel();
		if (kernel.solveSystem) {
			return solveWithKernel(paramMgr, constraints, callOptions, this.options, (problem, evaluate) =>
				kernel.solveSystem!(problem, evaluate)
			);
		}
		return this.solveTypescript(paramMgr, constraints, callOptions);
	}

	private solveTypescript(
		paramMgr: ParamManager,
		constraints: IConstraint[],
		callOptions: SolveCallOptions
	): SolverResult {
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
		const hardConstraints = constraints.filter(c => !c.isSoft);
		const constraintState = (map?: Map<string, number>) =>
			callOptions.skipDoF
				? { degreesOfFreedom: 0, constrainedParams: new Set<string>() }
				: this.computeConstraintState(paramMgr, hardConstraints, map ?? paramMgr.getCurrentValues());

		// Calculate total equations
		let totalEquations = 0;
		for (const c of constraints) {
			totalEquations += c.getEquationsCount();
		}

		if (n === 0 || totalEquations === 0) {
			return {
				status: n === 0 ? 'CONVERGED' : 'UNDER_CONSTRAINED',
				iterations: 0,
				initialError: 0,
				finalError: 0,
				...constraintState(),
				degreesOfFreedom: n,
				freeParametersCount: n,
				equationsCount: totalEquations,
			};
		}

		const paramMap = paramMgr.getCurrentValues();

		let x = paramMgr.getStateVector();
		let currentError = this.evaluateError(constraints, paramMap);
		const initialError = currentError;

		if (currentError < this.options.tolerance * this.options.tolerance) {
			const state = constraintState(paramMap);
			return {
				status: state.degreesOfFreedom === 0 ? 'CONVERGED' : 'UNDER_CONSTRAINED',
				iterations: 0,
				initialError,
				finalError: currentError,
				...state,
				freeParametersCount: n,
				equationsCount: totalEquations,
			};
		}

		let lambda = this.options.initialLambda;
		let iteration = 0;
		const F = new Float64Array(totalEquations);
		const jCols: number[][] = Array.from({ length: totalEquations }, () => []);
		const jVals: number[][] = Array.from({ length: totalEquations }, () => []);
		let cachedLinearization: { aCols: number[][]; aVals: number[][]; g: Float64Array } | null = null;

		for (iteration = 0; iteration < this.options.maxIterations; iteration++) {
			if (!cachedLinearization) {
				for (let r = 0; r < totalEquations; r++) {
					jCols[r].length = 0;
					jVals[r].length = 0;
				}
				let eqOffset = 0;
				for (const c of constraints) {
					const residuals = c.evaluate(paramMap);
					for (let i = 0; i < residuals.length; i++) {
						F[eqOffset + i] = residuals[i];
					}

					const entries = c.jacobian(paramIndices, eqOffset, paramMap);
					for (const entry of entries) {
						jCols[entry.row].push(entry.col);
						jVals[entry.row].push(entry.val);
					}

					eqOffset += c.getEquationsCount();
				}
				finalizeSparseRows(jCols, jVals);
				cachedLinearization = normalEquationsFromSparseRows(jCols, jVals, n, F);
			}

			const { aCols, aVals, g } = cachedLinearization;

			// Gradient norm check
			let gradNormSq = 0;
			for (let i = 0; i < n; i++) gradNormSq += g[i] * g[i];
			const gradNorm = Math.sqrt(gradNormSq);
			if (gradNorm === 0 || (this.options.gradRelTolerance <= 0 && gradNorm < this.options.tolerance)) {
				break;
			}
			const smallGrad = gradNorm < this.options.tolerance;

			// Add Levenberg-Marquardt damping: (A + lambda * diag(A + I)) * delta = -g
			// Stiffer parameters get proportionally more damping, so the solver prefers
			// moving the other parameters first.
			const hCols: number[][] = new Array(n);
			const hVals: number[][] = new Array(n);
			for (let i = 0; i < n; i++) {
				const rCols = aCols[i].slice();
				const rVals = aVals[i].slice();
				let foundDiag = false;
				let insertPos = rCols.length;
				for (let k = 0; k < rCols.length; k++) {
					if (rCols[k] === i) {
						const diagVal = Math.max(Math.abs(rVals[k]), 1.0);
						rVals[k] += lambda * diagVal * stiffness[i];
						foundDiag = true;
						break;
					}
					if (rCols[k] > i) {
						insertPos = k;
						break;
					}
				}
				if (!foundDiag) {
					const dampVal = lambda * stiffness[i];
					if (dampVal !== 0) {
						rCols.splice(insertPos, 0, i);
						rVals.splice(insertPos, 0, dampVal);
					}
				}
				hCols[i] = rCols;
				hVals[i] = rVals;
			}

			const negG = new Float64Array(n);
			for (let i = 0; i < n; i++) negG[i] = -g[i];

			const deltaX = solveSparseLinearSystem(hCols, hVals, negG);
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
				const relDecrease = (currentError - candidateError) / currentError;
				const dampedSmall = smallGrad && (lambda < this.options.initialLambda || lambda <= this.options.minLambda);
				x = candidateX;
				currentError = candidateError;
				cachedLinearization = null;
				paramMgr.applyStateVector(x);
				lambda = Math.max(lambda / this.options.lambdaFactor, this.options.minLambda);

				if (
					Math.sqrt(stepNormSq) < this.options.tolerance ||
					currentError < this.options.tolerance * this.options.tolerance ||
					(dampedSmall && relDecrease < this.options.gradRelTolerance)
				) {
					iteration++;
					break;
				}
			} else {
				// Step rejected, revert paramMap
				paramMgr.applyToMap(paramMap, x);
				if (smallGrad && (Math.sqrt(stepNormSq) < this.options.tolerance || lambda >= 1)) {
					break;
				}
				lambda = Math.min(lambda * this.options.lambdaFactor, this.options.maxLambda);
			}
		}

		const hardError = this.evaluateError(hardConstraints, paramMap);
		const state = constraintState(paramMap);
		let status: SolverStatus;

		if (hardError > 1e-2) {
			status = 'OVER_CONSTRAINED';
		} else if (state.degreesOfFreedom > 0) {
			status = 'UNDER_CONSTRAINED';
		} else {
			status = 'CONVERGED';
		}

		return {
			status,
			iterations: iteration,
			initialError,
			finalError: currentError,
			...state,
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

	private computeConstraintState(
		paramMgr: ParamManager,
		hardConstraints: IConstraint[],
		paramMap: Map<string, number>
	): Pick<SolverResult, 'degreesOfFreedom' | 'constrainedParams'> {
		let totalEquations = 0;
		for (const c of hardConstraints) {
			totalEquations += c.getEquationsCount();
		}

		const n = paramMgr.getFreeCount();
		const paramIndices = paramMgr.getIndices();
		const constrainedParams = new Set<string>();
		for (const id of paramMap.keys()) {
			if (!paramIndices.has(id)) constrainedParams.add(id);
		}
		if (n === 0 || totalEquations === 0) return { degreesOfFreedom: n, constrainedParams };

		const jCols: number[][] = Array.from({ length: totalEquations }, () => []);
		const jVals: number[][] = Array.from({ length: totalEquations }, () => []);

		let eqOffset = 0;
		for (const c of hardConstraints) {
			const entries = c.jacobian(paramIndices, eqOffset, paramMap);
			for (const entry of entries) {
				jCols[entry.row].push(entry.col);
				jVals[entry.row].push(entry.val);
			}
			eqOffset += c.getEquationsCount();
		}
		finalizeSparseRows(jCols, jVals);

		const { rank, fixedColumns } = analyzeNullspaceSparse(jCols, jVals, n);
		const freeParams = paramMgr.getFreeParams();
		for (const col of fixedColumns) constrainedParams.add(freeParams[col].id);
		return { degreesOfFreedom: n - rank, constrainedParams };
	}
}

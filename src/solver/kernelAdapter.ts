import { SolverEvaluation, type KernelSolve, type KernelSolverOptions } from '../kernel/solverTypes';
import type { ParamManager } from './solver';
import type { IConstraint, SolveCallOptions, SolverResult } from './types';
import { compileNativeConstraints } from './nativeConstraints';

/** Compile supported formulas once; retain JS evaluation only for remaining constraints. */
export function solveWithKernel(
	manager: ParamManager,
	constraints: IConstraint[],
	callOptions: SolveCallOptions,
	options: KernelSolverOptions,
	solve: KernelSolve
): SolverResult {
	manager.prepare(callOptions.lockedParams);
	const free = manager.getFreeParams();
	const indices = manager.getIndices();
	const n = free.length;
	const hard = constraints.filter(c => !c.isSoft);
	const count = (items: IConstraint[]) => items.reduce((sum, c) => sum + c.getEquationsCount(), 0);
	const equationsCount = count(constraints),
		hardEquationsCount = count(hard);
	const values = manager.getCurrentValues();
	const compiled = compileNativeConstraints(constraints, values, indices);
	const result = solve(
		{
			values: manager.getStateVector(),
			stiffness: Float64Array.from(free, p => callOptions.paramStiffness?.get(p.id) ?? 1),
			lowerBounds: Float64Array.from(free, p => p.min ?? -Infinity),
			equationsCount,
			hardEquationsCount,
			skipDoF: !!callOptions.skipDoF,
			options,
			nativeConstraints: compiled.data,
		},
		(state, mode) => {
			manager.applyToMap(values, state);
			if (mode === SolverEvaluation.Commit) {
				manager.applyStateVector(state);
				return new Float64Array();
			}
			const hardOnly = mode === SolverEvaluation.HardResiduals || mode === SolverEvaluation.HardJacobian;
			const items = hardOnly ? compiled.fallbackHard : compiled.fallbackAll;
			const m = hardOnly ? hardEquationsCount : equationsCount;
			const residuals = mode !== SolverEvaluation.HardJacobian;
			const jacobian = mode === SolverEvaluation.Linearization || mode === SolverEvaluation.HardJacobian;
			const output = new Float64Array((residuals ? m : 0) + (jacobian ? m * n : 0));
			const jacobianOffset = residuals ? m : 0;
			for (const { constraint, row } of items) {
				if (residuals) output.set(constraint.evaluate(values), row);
				if (jacobian) {
					for (const entry of constraint.jacobian(indices, row, values)) {
						// Repeated references must accumulate, e.g. two lines sharing an endpoint.
						output[jacobianOffset + entry.row * n + entry.col] += entry.val;
					}
				}
			}
			return output;
		}
	);
	const constrainedParams = new Set<string>();
	if (!callOptions.skipDoF) {
		for (const id of values.keys()) if (!indices.has(id)) constrainedParams.add(id);
		for (const index of result.constrainedIndices) constrainedParams.add(free[index].id);
	}
	return {
		status: result.status,
		iterations: result.iterations,
		initialError: result.initialError,
		finalError: result.finalError,
		degreesOfFreedom: result.degreesOfFreedom,
		constrainedParams,
		freeParametersCount: n,
		equationsCount,
	};
}

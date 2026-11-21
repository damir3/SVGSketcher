import type { IConstraint, ParamRef, SolveCallOptions, SolverOptions, SolverResult } from './types';
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
		constraints = constraints.filter(c => !c.isReference);
		const kernel = getGeometryKernel();
		if (!kernel.solveSystem) {
			throw new Error('Numerical solver requires the Rust/WASM kernel');
		}
		return solveWithKernel(paramMgr, constraints, callOptions, this.options, (problem, evaluate) =>
			kernel.solveSystem!(problem, evaluate)
		);
	}
}

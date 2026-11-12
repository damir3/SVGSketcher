import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel/index';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { GEOMETRY_KERNEL_API_VERSION } from '../src/kernel/types';
import { SolverEvaluation, type KernelSolveProblem, type KernelSolverEvaluator } from '../src/kernel/solverTypes';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { ParamManager, NumericalSolver } from '../src/solver/solver';
import { deserializeConstraint, type ConstraintSnapshot } from '../src/solver/constraints/serialization';
import type { SolverOptions, SolverResult } from '../src/solver/types';

interface Fixture {
	name: string;
	coordinateTolerance?: number;
	params: Array<{ id: string; value: number; fixed?: boolean; min?: number }>;
	constraints: ConstraintSnapshot[];
	options: SolverOptions;
	callOptions: { lockedParams?: string[]; paramStiffness?: Array<[string, number]>; skipDoF?: boolean };
	expected: Omit<SolverResult, 'constrainedParams'> & {
		constrainedParams: string[];
		values: Record<string, number>;
		writes: number;
	};
}
const fixtures = [
	'kernelSolver.json',
	'kernelCurvedSolver.json',
	'kernelPatternSolver.json',
	'kernelAxisSolver.json',
].flatMap(file => {
	const data = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as {
		cases: Fixture[];
		coordinateTolerance?: number;
	};
	return data.cases.map(fixture => ({
		...fixture,
		coordinateTolerance: fixture.coordinateTolerance ?? data.coordinateTolerance,
	}));
});

function close(actual: number, expected: number, absoluteTolerance = 1e-10): void {
	assert.ok(Math.abs(actual - expected) <= absoluteTolerance + Math.abs(expected) * 1e-10, `${actual} ≠ ${expected}`);
}

describe('numerical solver results captured before Rust migration', () => {
	for (const fixture of fixtures) {
		it(fixture.name, () => {
			const manager = new ParamManager();
			const values = new Map(fixture.params.map(p => [p.id, p.value]));
			let writes = 0;
			for (const p of fixture.params)
				manager.register({
					id: p.id,
					get: () => values.get(p.id)!,
					set: value => {
						values.set(p.id, value);
						writes++;
					},
					isFixed: p.fixed,
					min: p.min,
				});
			const constraints = fixture.constraints.map(c => {
				const constraint = deserializeConstraint(c);
				assert.ok(constraint);
				return constraint;
			});
			const result = new NumericalSolver(fixture.options).solve(manager, constraints, {
				...fixture.callOptions,
				lockedParams: fixture.callOptions.lockedParams && new Set(fixture.callOptions.lockedParams),
				paramStiffness: fixture.callOptions.paramStiffness && new Map(fixture.callOptions.paramStiffness),
			});
			for (const key of ['status', 'iterations', 'degreesOfFreedom', 'freeParametersCount', 'equationsCount'] as const)
				assert.equal(result[key], fixture.expected[key], key);
			close(result.initialError, fixture.expected.initialError);
			close(result.finalError, fixture.expected.finalError);
			assert.deepEqual([...result.constrainedParams].sort(), fixture.expected.constrainedParams);
			for (const [id, expected] of Object.entries(fixture.expected.values))
				close(values.get(id)!, expected, fixture.coordinateTolerance);
			assert.equal(writes, fixture.expected.writes, 'only accepted iterations apply state through parameter setters');
		});
	}
});

function simpleProblem(): KernelSolveProblem {
	return {
		values: new Float64Array([2, 3]),
		stiffness: new Float64Array([1, 1]),
		lowerBounds: new Float64Array([-Infinity, -Infinity]),
		equationsCount: 2,
		hardEquationsCount: 2,
		skipDoF: false,
		options: {
			maxIterations: 40,
			tolerance: 1e-6,
			initialLambda: 1e-3,
			lambdaFactor: 4,
			minLambda: 1e-9,
			maxLambda: 1e7,
		},
	};
}

const evaluateSimple: KernelSolverEvaluator = (x, mode) => {
	if (mode === SolverEvaluation.Commit) return new Float64Array();
	if (mode === SolverEvaluation.HardJacobian) return new Float64Array([1, 0, 0, 1]);
	const residuals = [x[0] - 10, x[1] - 20];
	return new Float64Array(mode === SolverEvaluation.Linearization ? [...residuals, 1, 0, 0, 1] : residuals);
};

it('validates the numerical solver packed result before exposing it to the model', () => {
	for (const data of [
		[],
		[5, 0, 0, 0, 0, 0, 2, 3],
		[0, 0, NaN, 0, 0, 0, 2, 3],
		[0, 0, 0, 0, 3, 0, 2, 3],
		[0, 0, 0, 0, 0, 1, 2, 3, 2],
		[0, 0, 0, 0, 0, 0, Infinity, 3],
	]) {
		const kernel = createWasmGeometryKernel({
			api_version: () => GEOMETRY_KERNEL_API_VERSION,
			intersect_pairs: () => new Float64Array(),
			spline_geometry: () => new Float64Array(),
			find_regions_packed: () => new Float64Array([0]),
			curve_editing: () => new Float64Array([0]),
			solve_system: () => new Float64Array(data),
		});
		assert.throws(() => kernel.solveSystem!(simpleProblem(), evaluateSimple), /WASM solver/);
	}
});

it('propagates evaluator errors and malformed arrays without poisoning the next WASM solve', {
	skip: !getGeometryKernel().solveSystem,
}, () => {
	const solve = getGeometryKernel().solveSystem!;
	const failure = new Error('constraint evaluation failed');
	assert.throws(
		() =>
			solve(simpleProblem(), () => {
				throw failure;
			}),
		error => error === failure
	);
	assert.throws(() => solve(simpleProblem(), () => new Float64Array()), /buffer length/);
	assert.throws(() => solve({ ...simpleProblem(), stiffness: new Float64Array([1]) }, evaluateSimple), /dimensions/);
	const result = solve(simpleProblem(), evaluateSimple);
	assert.equal(result.status, 'CONVERGED');
	assert.equal(result.iterations, 3);
	assert.deepEqual(result.constrainedIndices, [0, 1]);
	close(result.values[0], 10);
	close(result.values[1], 20);
});

it('dispatches NumericalSolver through Rust and supports geometry calls inside batched evaluations', {
	skip: !getGeometryKernel().solveSystem,
}, () => {
	const previous = getGeometryKernel();
	let solves = 0,
		linearizations = 0,
		commits = 0;
	setGeometryKernel({
		...previous,
		solveSystem(problem, evaluate) {
			solves++;
			return previous.solveSystem!(problem, (state, mode) => {
				if (mode === SolverEvaluation.Linearization) linearizations++;
				if (mode === SolverEvaluation.Commit) commits++;
				const hits = previous.intersectPairs([
					{
						a: { type: 'circle', center: { x: 0, y: 0 }, radius: 1 },
						b: { type: 'circle', center: { x: 2, y: 0 }, radius: 1 },
					},
				]);
				assert.deepEqual(hits, [[{ x: 1, y: 0 }]]);
				return evaluate(state, mode);
			});
		},
	});
	try {
		const manager = new ParamManager();
		const values = new Map([
			['a.x', 2],
			['a.y', 3],
		]);
		for (const id of values.keys())
			manager.register({ id, get: () => values.get(id)!, set: value => values.set(id, value) });
		const fixture = fixtures.find(item => item.name === 'redundant hard equations')!;
		const constraints = fixture.constraints.map(c => deserializeConstraint(c)!);
		const result = new NumericalSolver().solve(manager, constraints);
		assert.equal(solves, 1);
		assert.equal(linearizations, 0, 'native formulas do not request JS linearization');
		assert.equal(commits, 3);
		assert.equal(result.status, 'CONVERGED');
		close(values.get('a.x')!, 10);
		close(values.get('a.y')!, 20);
	} finally {
		setGeometryKernel(previous);
	}
});

it('keeps the TypeScript backend as the independent reference numerical implementation', () => {
	assert.equal(typescriptGeometryKernel.solveSystem, undefined);
});

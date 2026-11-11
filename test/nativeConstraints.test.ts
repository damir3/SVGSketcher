import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel/index';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { SolverEvaluation } from '../src/kernel/solverTypes';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { FixedConstraint, DragPointConstraint, ParallelConstraint } from '../src/solver/constraints';
import { deserializeConstraint, type ConstraintSnapshot } from '../src/solver/constraints/serialization';
import { ParamManager, NumericalSolver } from '../src/solver/solver';

interface Fixture {
	name: string;
	constraint: ConstraintSnapshot;
	params: Record<string, number>;
	freeIds: string[];
	expected: { residuals: number[]; jacobian: number[] };
}
const fixtures = [
	'kernelConstraints.json',
	'kernelCurvedConstraints.json',
	'kernelPatternConstraints.json',
	'kernelAxisConstraints.json',
].flatMap(
	file =>
		(JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as { cases: Fixture[] }).cases
);
const native = getGeometryKernel().backend === 'wasm' ? await import('../public/kernel/sketcher_wasm.js') : null;

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, numeric = false): void {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < actual.length; i++) {
		const tolerance = numeric ? 2e-8 + Math.abs(expected[i]) * 1e-9 : 1e-11 + Math.abs(expected[i]) * 1e-11;
		assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `entry ${i}: ${actual[i]} ≠ ${expected[i]}`);
	}
}

describe('native constraint formulas captured before migration', () => {
	for (const fixture of fixtures)
		it(fixture.name, () => {
			const c = deserializeConstraint(fixture.constraint)!;
			const values = new Map(Object.entries(fixture.params));
			const indices = new Map(fixture.freeIds.map((id, i) => [id, i]));
			const compiled = compileNativeConstraints([c], values, indices);
			assert.equal(compiled.nativeCount, 1);
			assert.equal(compiled.fallbackAll.length, 0);
			const numeric = [
				'point_on_line',
				'parallel',
				'perpendicular',
				'collinear',
				'angle',
				'tangent_line_circle',
				'tangent_circle_circle',
				'ellipse_axis',
				'point_on_ellipse',
				'elliptical_arc_endpoints',
				'point_to_line_distance',
				'symmetry',
				'offset',
			].includes(c.type);
			close(c.evaluate(values), fixture.expected.residuals);
			const m = c.getEquationsCount(),
				n = indices.size;
			const jacobian = new Float64Array(m * n);
			for (const e of c.jacobian(indices, 0, values)) jacobian[e.row * n + e.col] += e.val;
			close(jacobian, fixture.expected.jacobian, numeric);
			if (!native) return;
			const state = Float64Array.from(fixture.freeIds, id => values.get(id)!);
			const hardM = c.isSoft ? 0 : m;
			for (const mode of [0, 1, 2, 3]) {
				const expected =
					mode === 0
						? fixture.expected.residuals
						: mode === 1
							? [...fixture.expected.residuals, ...fixture.expected.jacobian]
							: c.isSoft
								? []
								: mode === 2
									? fixture.expected.residuals
									: fixture.expected.jacobian;
				close(native.evaluate_constraints(state, compiled.data, new Float64Array([m, hardM, mode])), expected, numeric);
			}
		});
});

it('leaves customized methods and numeric relevance metadata on the JS fallback', () => {
	const values = new Map([
		['a.x', 2],
		['a.y', 3],
		['b.x', 5],
		['b.y', 7],
	]);
	const indices = new Map([...values.keys()].map((id, i) => [id, i]));
	const fixed = new FixedConstraint('f', 'a', 10, 20);
	fixed.evaluate = () => [1, 2];
	assert.equal(compileNativeConstraints([fixed], values, indices).nativeCount, 0);
	const parallel = new ParallelConstraint('p', 'a', 'b', 'a', 'b');
	parallel.entityIds = ['a'];
	const compiled = compileNativeConstraints([parallel], values, indices);
	assert.equal(compiled.nativeCount, 0);
	assert.equal(compiled.fallbackHard[0].constraint, parallel);
});

function managerFor(values: Map<string, number>): ParamManager {
	const manager = new ParamManager();
	for (const id of values.keys())
		manager.register({ id, get: () => values.get(id)!, set: value => values.set(id, value) });
	return manager;
}

it('solves a native-only system without executing JS residuals or Jacobians', { skip: !native }, () => {
	const previous = getGeometryKernel();
	const fixed = new FixedConstraint('f', 'a', 10, 20),
		drag = new DragPointConstraint('a', 10, 20);
	let commits = 0;
	setGeometryKernel({
		...previous,
		solveSystem(problem, evaluate) {
			assert.ok(problem.nativeConstraints!.length > 0);
			fixed.evaluate = drag.evaluate = () => {
				throw new Error('native residual called in JS');
			};
			fixed.jacobian = drag.jacobian = () => {
				throw new Error('native Jacobian called in JS');
			};
			return previous.solveSystem!(problem, (state, mode) => {
				assert.equal(mode, SolverEvaluation.Commit);
				commits++;
				return evaluate(state, mode);
			});
		},
	});
	try {
		const values = new Map([
			['a.x', 2],
			['a.y', 3],
		]);
		const result = new NumericalSolver().solve(managerFor(values), [fixed, drag]);
		assert.equal(result.status, 'CONVERGED');
		assert.equal(result.degreesOfFreedom, 0);
		assert.ok(commits > 0);
		close([...values.values()], [10, 20], true);
	} finally {
		setGeometryKernel(previous);
	}
});

it('combines native and custom JS rows in either order without shifting the Jacobian', { skip: !native }, () => {
	for (const reverse of [false, true]) {
		const values = new Map([
			['a.x', 2],
			['a.y', 3],
			['b.x', 5],
			['b.y', 7],
		]);
		const fixed = new FixedConstraint('f', 'a', 10, 20),
			custom = new FixedConstraint('custom', 'b', -5, 8);
		let evaluations = 0;
		const original = custom.evaluate.bind(custom);
		custom.evaluate = map => {
			evaluations++;
			return original(map);
		};
		const constraints = reverse ? [custom, fixed] : [fixed, custom];
		const result = new NumericalSolver().solve(managerFor(values), constraints);
		assert.equal(result.status, 'CONVERGED');
		assert.ok(evaluations > 0);
		close([...values.values()], [10, 20, -5, 8], true);
	}
});

it('evaluates migrated curved and composite constraints without JS evaluation callbacks during a solve', {
	skip: !native,
}, () => {
	const types = new Set([
		'angle',
		'tangent_line_circle',
		'tangent_circle_circle',
		'ellipse_axis',
		'point_on_ellipse',
		'arc_endpoints',
		'elliptical_arc_endpoints',
		'point_to_line_distance',
		'symmetry',
		'circular_pattern',
		'rectangular_pattern',
		'offset',
		'origin_distance',
		'line_to_axis_distance',
	]);
	const previous = getGeometryKernel();
	try {
		for (const fixture of fixtures.filter(f => types.has(f.constraint.type) && f.name.endsWith(' weighted'))) {
			const c = deserializeConstraint(fixture.constraint)!;
			const values = new Map(Object.entries(fixture.params));
			const manager = new ParamManager();
			for (const id of values.keys())
				manager.register({
					id,
					get: () => values.get(id)!,
					set: value => values.set(id, value),
					isFixed: !fixture.freeIds.includes(id),
				});
			let commits = 0;
			setGeometryKernel({
				...previous,
				solveSystem(problem, evaluate) {
					c.evaluate = c.jacobian = () => {
						throw new Error('unexpected JS formula execution');
					};
					return previous.solveSystem!(problem, (state, mode) => {
						assert.equal(mode, SolverEvaluation.Commit, fixture.name);
						commits++;
						return evaluate(state, mode);
					});
				},
			});
			const result = new NumericalSolver({ maxIterations: 3 }).solve(manager, [c]);
			assert.ok(commits > 0, fixture.name);
			assert.ok(result.finalError < result.initialError, fixture.name);
			types.delete(c.type);
		}
		assert.equal(types.size, 0);
	} finally {
		setGeometryKernel(previous);
	}
});

it('keeps offset parents and suppressed pattern copies exactly unchanged', () => {
	for (const [name, protectedIds] of [
		['offset weighted', ['a.x', 'a.y', 'b.x', 'b.y', 'r0.r']],
		['circular partial suppressed', ['d.x', 'd.y', 'e.x', 'e.y', 'r1.r']],
	] as const) {
		const fixture = fixtures.find(f => f.name === name)!;
		const c = deserializeConstraint(fixture.constraint)!;
		const values = new Map(Object.entries(fixture.params));
		const result = new NumericalSolver().solve(managerFor(values), [c]);
		assert.ok(result.finalError < 1e-12, name);
		for (const id of protectedIds) assert.equal(values.get(id), fixture.params[id], `${name}: ${id}`);
	}
});

it('preserves hard rows across soft composite records and JS fallback rows', { skip: !native }, () => {
	const previous = getGeometryKernel();
	const fixture = fixtures.find(f => f.name === 'circular_pattern weighted')!;
	try {
		for (const reverse of [false, true]) {
			let fallbackCalls = 0;
			const run = () => {
				const values = new Map(Object.entries({ ...fixture.params, 'z.x': 1, 'z.y': 2 }));
				const pattern = deserializeConstraint(structuredClone(fixture.constraint))!;
				pattern.isSoft = true;
				pattern.weight = 0.1;
				const custom = new FixedConstraint('custom', 'z', 11, 12);
				const evaluate = custom.evaluate.bind(custom);
				custom.evaluate = state => {
					fallbackCalls++;
					return evaluate(state);
				};
				const fixed = new FixedConstraint('fixed', 'a', 3, 7);
				const constraints = reverse ? [fixed, pattern, custom] : [custom, pattern, fixed];
				return { result: new NumericalSolver().solve(managerFor(values), constraints), values };
			};
			setGeometryKernel(typescriptGeometryKernel);
			const expected = run();
			setGeometryKernel(previous);
			fallbackCalls = 0;
			const actual = run();
			assert.ok(fallbackCalls > 0);
			assert.equal(actual.result.status, expected.result.status);
			assert.equal(actual.result.degreesOfFreedom, expected.result.degreesOfFreedom);
			assert.deepEqual(actual.result.constrainedParams, expected.result.constrainedParams);
			assert.ok(actual.result.finalError < 1e-12);
			close([...actual.values.values()], [...expected.values.values()], true);
		}
	} finally {
		setGeometryKernel(previous);
	}
});

it('falls back atomically when a composite record is invalid or its offset helper is customized', () => {
	const fixture = fixtures.find(f => f.name === 'offset weighted')!;
	const values = new Map(Object.entries(fixture.params));
	const indices = new Map(fixture.freeIds.map((id, i) => [id, i]));
	const c = deserializeConstraint(structuredClone(fixture.constraint))!;
	// Earlier records must not leak into the program when a later spline record fails.
	const pairs = Reflect.get(c, 'pairs');
	pairs[pairs.length - 1].points[0].normal = { x: NaN, y: 1 };
	let compiled = compileNativeConstraints([c], values, indices);
	assert.equal(compiled.data.length, 0);
	assert.equal(compiled.nativeCount, 0);
	assert.equal(compiled.fallbackAll[0].constraint, c);
	const customized = deserializeConstraint(fixture.constraint)!;
	Reflect.set(customized, 'lineResidual', () => 0);
	compiled = compileNativeConstraints([customized], values, indices);
	assert.equal(compiled.data.length, 0);
	assert.equal(compiled.fallbackAll[0].constraint, customized);
});

it('retains tiny unfiltered pattern-point derivatives', { skip: !native }, () => {
	for (const fixture of fixtures.filter(f => f.name.endsWith('tiny unfiltered derivatives'))) {
		const c = deserializeConstraint(fixture.constraint)!;
		const values = new Map(Object.entries(fixture.params));
		const indices = new Map(fixture.freeIds.map((id, i) => [id, i]));
		const compiled = compileNativeConstraints([c], values, indices);
		const m = c.getEquationsCount(),
			n = indices.size;
		const jacobian = native!.evaluate_constraints(
			Float64Array.from(fixture.freeIds, id => values.get(id)!),
			compiled.data,
			new Float64Array([m, m, SolverEvaluation.HardJacobian])
		);
		for (const id of ['d.x', 'd.y']) {
			const row = id.endsWith('.x') ? 0 : 1;
			assert.equal(jacobian[row * n + indices.get(id)!], c.weight);
		}
	}
});

it('rejects malformed native programs before evaluating them', { skip: !native }, () => {
	const data = [4, 0, 0, 1, 2, 0, 1, 0, 3];
	for (const invalid of [
		[0],
		[99, ...data.slice(1)],
		[...data, ...data],
		[...data.slice(0, 7), 1, 3],
		[...data.slice(0, 8), NaN],
		[4, 1, 0, ...data.slice(3)],
	]) {
		assert.throws(
			() => native!.evaluate_constraints(new Float64Array([3]), new Float64Array(invalid), new Float64Array([1, 1, 1])),
			/constraint/i
		);
	}
});

it('rejects invalid axis modes, free side configuration and inconsistent coincidence rows', { skip: !native }, () => {
	const data = [27, 0, 0, 1, 5, 0, 3, 0, 0, 1, 0, -1, 1];
	for (const invalid of [
		[...data.slice(0, 5), 4, ...data.slice(6)],
		[28, ...data.slice(1, 5), 2, ...data.slice(6)],
		[...data.slice(0, 11), 0, 1],
		[...data.slice(0, 5), 3, ...data.slice(6)],
	]) {
		assert.throws(
			() =>
				native!.evaluate_constraints(new Float64Array([3, 4]), new Float64Array(invalid), new Float64Array([1, 1, 1])),
			/constraint/i
		);
	}
});

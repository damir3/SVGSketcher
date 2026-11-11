import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { SolverEvaluation } from '../src/kernel/solverTypes';
import { Vec2 } from '../src/math/vector';
import * as spline from '../src/math/spline';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { deserializeConstraint, type ConstraintSnapshot } from '../src/solver/constraints/serialization';
import { AutomaticSplineHandlesConstraint } from '../src/solver/constraints/automaticSplineHandles';
import { PointOnSplineConstraint } from '../src/solver/constraints/pointOnSpline';
import type { MidpointConstraint } from '../src/solver/constraints/midpoint';
import { ParamManager, NumericalSolver } from '../src/solver/solver';

const read = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
const formulas = read('kernelSplineConstraints.json').cases;
const math = read('kernelSplineMath.json').cases;
const solves = read('kernelSplineSolver.json').cases;
const wasm = getGeometryKernel().backend === 'wasm' ? await import('../public/kernel/sketcher_wasm.js') : null;
const flatten = (value: any): number[] => (Array.isArray(value) ? value.flatMap(flatten) : [value.x, value.y]);
function close(actual: ArrayLike<number>, expected: ArrayLike<number>, absolute = 1e-10, relative = 1e-10): void {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < actual.length; i++)
		assert.ok(
			actual[i] === expected[i] || Math.abs(actual[i] - expected[i]) <= absolute + relative * Math.abs(expected[i]),
			`${i}: ${actual[i]} ≠ ${expected[i]}`
		);
}
function hydrate(kind: string, data: any) {
	if (kind === 'automatic') {
		const c = new AutomaticSplineHandlesConstraint(
			'spline',
			data.fitPointIds,
			data.handles.map((h: any) => ({
				index: h.index,
				midpoint: deserializeConstraint(h.midpoint) as MidpointConstraint,
			}))
		);
		c.weight = data.weight ?? 1;
		c.isSoft = data.isSoft ?? false;
		return c;
	}
	return deserializeConstraint(data as ConstraintSnapshot)!;
}

describe('spline construction and projection captured before native migration', () => {
	for (const f of math)
		it(f.name, () => {
			const points = f.points.map(Vec2.from),
				handles = f.handles?.map((h: any) => h && { h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) });
			const natural = spline.computeNaturalFitHandles(points);
			close(
				natural.flatMap(h => flatten([h.h1, h.h2])),
				f.expected.natural.flatMap((h: any) => flatten([h.h1, h.h2]))
			);
			const fits = spline.fitPointsToBezier(points, handles),
				controls = spline.bsplineToBezier(points, f.knots);
			close(flatten(fits), flatten(f.expected.fit));
			close(flatten(controls), flatten(f.expected.control));
			const packed = new Float64Array(flatten(points));
			const hs = new Float64Array(
				handles?.flatMap((h: any) => (h ? [1, ...flatten([h.h1, h.h2])] : [0, 0, 0, 0, 0])) ?? []
			);
			if (wasm) {
				close(
					wasm.spline_geometry(packed, hs, new Float64Array(f.knots ?? []), new Float64Array([0, 0, 0, 0])),
					f.expected.natural.flatMap((h: any) => flatten([h.h1, h.h2]))
				);
				for (const [mode, segments] of [
					[1, f.expected.fit],
					[2, f.expected.control],
				] as const)
					close(
						wasm.spline_geometry(packed, hs, new Float64Array(f.knots ?? []), new Float64Array([mode, 0, 0, 0])),
						flatten(segments)
					);
			}
			for (const [segments, queries] of [
				[fits, f.expected.fitQueries],
				[controls, f.expected.controlQueries],
			])
				for (const q of queries) {
					const projection = spline.getSplineParamAtPoint(segments, Vec2.from(q.target));
					const expected = [
						q.param,
						q.distance ?? Infinity,
						...flatten(q.point),
						...flatten(q.tangent),
						...flatten(q.sample),
					];
					close(
						[
							projection.param,
							projection.distance,
							...flatten(projection.point),
							...flatten(spline.getSplineTangentAtParam(segments, projection.param)),
							...flatten(spline.getSplinePointAtParam(segments, 0.37)),
						],
						expected
					);
					if (wasm)
						close(
							wasm.spline_geometry(
								new Float64Array(flatten(segments)),
								new Float64Array(),
								new Float64Array(),
								new Float64Array([3, q.target.x, q.target.y, 0.37])
							),
							expected
						);
				}
		});
});

describe('spline residuals and Jacobians captured before native migration', () => {
	for (const f of formulas)
		it(f.name, () => {
			const c = hydrate(f.kind, f.constraint),
				values = new Map<string, number>(Object.entries(f.params));
			const indices = new Map<string, number>(f.freeIds.map((id: string, i: number) => [id, i]));
			const compiled = compileNativeConstraints([c], values, indices);
			assert.equal(compiled.nativeCount, 1);
			assert.equal(compiled.fallbackAll.length, 0);
			close(c.evaluate(values), f.expected.residuals);
			const m = c.getEquationsCount(),
				n = indices.size;
			const jacobian = new Float64Array(m * n);
			for (const e of c.jacobian(indices, 0, values)) jacobian[e.row * n + e.col] += e.val;
			close(jacobian, f.expected.jacobian, 2e-8, 1e-9);
			if (!wasm) return;
			for (const mode of [0, 1, 2, 3]) {
				const expected =
					mode === 0
						? f.expected.residuals
						: mode === 1
							? [...f.expected.residuals, ...f.expected.jacobian]
							: c.isSoft
								? []
								: mode === 2
									? f.expected.residuals
									: f.expected.jacobian;
				close(
					wasm.evaluate_constraints(
						Float64Array.from(f.freeIds, (id: string) => values.get(id)!),
						compiled.data,
						new Float64Array([m, c.isSoft ? 0 : m, mode])
					),
					expected,
					2e-8,
					1e-9
				);
			}
		});
});

describe('spline solves captured before native migration', () => {
	for (const f of solves)
		it(f.name, () => {
			const manager = new ParamManager(),
				values = new Map<string, number>(f.params.map((p: any) => [p.id, p.value]));
			let writes = 0;
			for (const p of f.params)
				manager.register({
					id: p.id,
					get: () => values.get(p.id)!,
					set: value => {
						values.set(p.id, value);
						writes++;
					},
					isFixed: p.isFixed,
				});
			const cs = f.constraints.map((c: any) => hydrate(c.kind, c.kind === 'automatic' ? c : c.snapshot));
			const result = new NumericalSolver().solve(manager, cs, f.callOptions);
			for (const key of ['status', 'iterations', 'degreesOfFreedom', 'freeParametersCount', 'equationsCount'] as const)
				assert.equal(result[key], f.expected[key], key);
			assert.equal(writes, f.expected.writes);
			assert.deepEqual([...result.constrainedParams].sort(), f.expected.constrainedParams);
			close([result.initialError, result.finalError], [f.expected.initialError, f.expected.finalError]);
			close([...values.values()], Object.values(f.expected.values) as number[]);
		});
});

it('solves both spline constraint classes without JS formula callbacks', { skip: !wasm }, () => {
	const previous = getGeometryKernel();
	try {
		for (const name of ['fit point solve 4', 'automatic handles fixed fit', 'automatic and point combined']) {
			const f = solves.find((f: any) => f.name === name);
			const manager = new ParamManager(),
				values = new Map<string, number>(f.params.map((p: any) => [p.id, p.value]));
			for (const p of f.params)
				manager.register({
					id: p.id,
					get: () => values.get(p.id)!,
					set: value => values.set(p.id, value),
					isFixed: p.isFixed,
				});
			const cs = f.constraints.map((c: any) => hydrate(c.kind, c.kind === 'automatic' ? c : c.snapshot));
			let commits = 0;
			setGeometryKernel({
				...previous,
				solveSystem(problem, evaluate) {
					for (const c of cs)
						c.evaluate = c.jacobian = () => {
							throw new Error('unexpected JS spline formula');
						};
					return previous.solveSystem!(problem, (state, mode) => {
						assert.equal(mode, SolverEvaluation.Commit);
						commits++;
						return evaluate(state, mode);
					});
				},
			});
			new NumericalSolver().solve(manager, cs, f.callOptions);
			assert.ok(commits > 0);
		}
	} finally {
		setGeometryKernel(previous);
	}
});

it('compares generated fit and control spline Jacobians against TypeScript', { skip: !wasm }, () => {
	let seed = 0x1431a8;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	for (let sample = 0; sample < 100; sample++) {
		const count = 2 + (sample % 8),
			control = sample % 2 === 0;
		const values = new Map<string, number>([
			['p.x', random() * 40 - 20],
			['p.y', random() * 40 - 20],
		]);
		const ids = Array.from({ length: count }, (_, i) => {
			values.set(`f${i}.x`, random() * 40 - 20);
			values.set(`f${i}.y`, random() * 40 - 20);
			return `f${i}`;
		});
		if (!control && sample % 7 === 0) {
			values.set(`${ids[count - 1]}.x`, values.get('f0.x')!);
			values.set(`${ids[count - 1]}.y`, values.get('f0.y')!);
		}
		let knots: number[] | undefined;
		if (control && count >= 5) {
			const inner = Array.from({ length: count - 4 }, () => 0.05 + random() * 0.9).sort((a, b) => a - b);
			knots = [0, 0, 0, 0, ...inner, 1, 1, 1, 1];
		}
		const c = new PointOnSplineConstraint(
			'point',
			'p',
			'spline',
			control ? 'control' : 'fit',
			ids,
			undefined,
			undefined,
			knots
		);
		c.weight = sample % 3 === 0 ? -0.8 : 0.7;
		const indices = new Map([...values.keys()].reverse().map((id, i) => [id, i]));
		const compiled = compileNativeConstraints([c], values, indices);
		assert.equal(compiled.nativeCount, 1);
		const expected = new Float64Array(1 + indices.size);
		expected[0] = c.evaluate(values)[0];
		for (const e of c.jacobian(indices, 0, values)) expected[1 + e.col] += e.val;
		const actual = wasm!.evaluate_constraints(
			Float64Array.from(indices.keys(), id => values.get(id)!),
			compiled.data,
			new Float64Array([1, 1, 1])
		);
		close(actual, expected, 2e-8, 1e-9);
	}
});

it('keeps customized automatic helpers and unusual knot vectors on the JS path', () => {
	const automatic = formulas.find((f: any) => f.kind === 'automatic' && f.expected.residuals.length > 0);
	const c = hydrate(automatic.kind, automatic.constraint);
	Reflect.set(c, 'naturalHandles', () => []);
	const values = new Map<string, number>(Object.entries(automatic.params));
	const indices = new Map<string, number>(automatic.freeIds.map((id: string, i: number) => [id, i]));
	assert.equal(compileNativeConstraints([c], values, indices).nativeCount, 0);
	const unusual = new PointOnSplineConstraint(
		'p',
		'p',
		'spline',
		'control',
		['a', 'b', 'c', 'd', 'e'],
		undefined,
		undefined,
		[0, 0, 0, 0, 0.5, 1, 1, 1, 2]
	);
	const compiled = compileNativeConstraints([unusual], values, indices);
	assert.equal(compiled.nativeCount, 0);
	assert.equal(compiled.data.length, 0);
});

it('packs long spline records without exceeding the JS argument limit', () => {
	const count = 10000;
	const c = new PointOnSplineConstraint(
		'point',
		'p',
		'spline',
		'fit',
		Array.from({ length: count }, () => 'a')
	);
	const values = new Map([
		['p.x', 1],
		['p.y', 2],
		['a.x', 3],
		['a.y', 4],
	]);
	const indices = new Map([...values.keys()].map((id, i) => [id, i]));
	const compiled = compileNativeConstraints([c], values, indices);
	assert.equal(compiled.nativeCount, 1);
	assert.equal(compiled.data.length, 7 + 2 * (2 + count * 7));
	assert.equal(compiled.fallbackAll.length, 0);
});

it('validates variable spline records and raw geometry buffers before indexing them', { skip: !wasm }, () => {
	for (const kind of ['point', 'automatic']) {
		const f = formulas.find(
			(f: any) => f.kind === kind && f.expected.residuals.length > 0 && Object.keys(f.params).length > 8
		);
		const c = hydrate(f.kind, f.constraint),
			values = new Map<string, number>(Object.entries(f.params));
		const indices = new Map<string, number>(f.freeIds.map((id: string, i: number) => [id, i]));
		const data = [...compileNativeConstraints([c], values, indices).data];
		const badConfiguration = [...data];
		const configuration = kind === 'point' ? 2 + 2 * data[5] : 2 * data[4];
		badConfiguration[7 + 2 * configuration] = 0; // a flag/index must be constant
		for (const invalid of [data.slice(0, -1), [...data.slice(0, 5), 1e300, ...data.slice(6)], badConfiguration])
			assert.throws(
				() =>
					wasm!.evaluate_constraints(
						Float64Array.from(indices.keys(), id => values.get(id)!),
						new Float64Array(invalid),
						new Float64Array([c.getEquationsCount(), c.getEquationsCount(), 1])
					),
				/constraint|spline/i
			);
	}
	assert.throws(
		() =>
			wasm!.spline_geometry(
				new Float64Array([1]),
				new Float64Array(),
				new Float64Array(),
				new Float64Array([0, 0, 0, 0])
			),
		/spline/i
	);
	assert.throws(
		() =>
			wasm!.spline_geometry(
				new Float64Array([1, 2]),
				new Float64Array([2, 0, 0, 0, 0]),
				new Float64Array(),
				new Float64Array([1, 0, 0, 0])
			),
		/spline/i
	);
});

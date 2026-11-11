import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import * as spline from '../src/math/spline';
import * as reference from '../src/math/splineReference';
import { Vec2 } from '../src/math/vector';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmSplineKernel } from '../src/kernel/splineWasm';
import { PointOnSplineConstraint } from '../src/solver/constraints/pointOnSpline';
import { FixedConstraint } from '../src/solver/constraints/fixed';
import { NumericalSolver, ParamManager } from '../src/solver/solver';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelSplineEditing.json', import.meta.url), 'utf8'));
const wasm = getGeometryKernel().backend === 'wasm' ? await import('../public/kernel/sketcher_wasm.js') : null;
const hydrate = (segments: Array<Array<{ x: number; y: number }>>) =>
	segments.map(b => b.map(Vec2.from) as spline.BezierSegment);
function compare(actual: any, expected: any): void {
	if (typeof expected === 'number')
		assert.ok(Math.abs(actual - expected) <= 1e-10 + Math.abs(expected) * 1e-10, `${actual} ≠ ${expected}`);
	else if (Array.isArray(expected)) {
		assert.equal(actual.length, expected.length);
		expected.forEach((v, i) => compare(actual[i], v));
	} else for (const key of Object.keys(expected)) compare(actual[key], expected[key]);
}

it('keeps a byte-identical independent reference of the pre-routing spline implementation', () => {
	assert.equal(
		createHash('sha256')
			.update(readFileSync(new URL('../src/math/splineReference.ts', import.meta.url)))
			.digest('hex'),
		fixture.sourceSha256
	);
});

describe('spline editing captured before routing through the kernel', () => {
	for (const f of fixture.cases)
		it(f.name, () => {
			const segments = hydrate(f.segments),
				[a, b] = f.parameters;
			const input = JSON.stringify(segments);
			const actual =
				f.op === 'split'
					? spline.splitBezier(segments[0], a)
					: f.op === 'splitSpline'
						? spline.splitSplineAtParam(segments, a)
						: f.op === 'interval'
							? spline.extractSplineInterval(segments, a, b)
							: spline.trimBezier(segments[0], a, b);
			compare(actual, f.expected);
			assert.equal(JSON.stringify(segments), input);
		});
});

it('preserves Vec2 results, endpoint sharing and the original empty-curve behavior', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4), new Vec2(20, 0)];
	const fits = spline.fitPointsToBezier(points),
		controls = spline.bsplineToBezier(points);
	assert.ok(fits.every(b => b.every(p => p instanceof Vec2)));
	assert.notEqual(fits[0][3], fits[1][0]);
	assert.equal(controls[0][3], controls[1][0]);
	const split = spline.splitBezier(fits[0], 0.37);
	assert.equal(split.left[0], fits[0][0]);
	assert.equal(split.right[3], fits[0][3]);
	assert.equal(split.left[3], split.right[0]);
	assert.equal(spline.trimBezier(fits[0], 0, 1), fits[0]);
	assert.equal(spline.extractSplineInterval(fits, 0, 1), fits);
	const target = new Vec2(3, 4);
	assert.equal(spline.getSplineParamAtPoint([], target).point, target);
	assert.deepEqual(spline.getSplinePointAtParam([], NaN), new Vec2());
	assert.deepEqual(spline.getSplineTangentAtParam([], Infinity), new Vec2(1, 0));
	assert.throws(() => spline.splitSplineAtParam([], 0.5));
});

it('matches evaluation, derivatives and clamped parameters without mutating inputs', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4)];
	const segments = reference.fitPointsToBezier(points);
	const original = JSON.stringify(segments);
	for (const t of [-1, 0, 0.23, 0.9, 1, 2]) {
		compare(spline.evaluateBezier(segments[1], t), reference.evaluateBezier(segments[1], t));
		compare(spline.evaluateBezierDerivative(segments[1], t), reference.evaluateBezierDerivative(segments[1], t));
		compare(spline.getSplinePointAtParam(segments, t), reference.getSplinePointAtParam(segments, t));
		compare(spline.getSplineTangentAtParam(segments, t), reference.getSplineTangentAtParam(segments, t));
	}
	assert.equal(JSON.stringify(segments), original);
});

it('retains reference behavior for unusual knots and non-finite legacy arguments', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4), new Vec2(20, 0)];
	const knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 2];
	compare(spline.bsplineToBezier(points, knots), reference.bsplineToBezier(points, knots));
	const segments = spline.fitPointsToBezier(points);
	compare(spline.getSplinePointAtParam(segments, Infinity), reference.getSplinePointAtParam(segments, Infinity));
	assert.throws(() => spline.getSplinePointAtParam(segments, NaN));
	const invalid = spline.computeNaturalFitHandles([new Vec2(NaN, 0), new Vec2(1, 2)]);
	assert.ok(Number.isNaN(invalid[0].h1.x));
});

it('routes public helpers through direct WASM modes while retaining reference constraint formulas', {
	skip: !wasm,
}, () => {
	const previous = getGeometryKernel(),
		modes: number[] = [];
	try {
		setGeometryKernel({
			...previous,
			spline: createWasmSplineKernel((...args) => {
				modes.push(args[3][0]);
				return wasm!.spline_geometry(...args);
			}),
		});
		const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4)];
		spline.computeNaturalFitHandles(points);
		const segments = spline.fitPointsToBezier(points);
		spline.bsplineToBezier(points);
		spline.getSplinePointAtParam(segments, 0.2);
		spline.getSplineTangentAtParam(segments, 0.2);
		spline.getSplineParamAtPoint(segments, new Vec2(4, 7));
		spline.evaluateBezier(segments[0], 0.3);
		spline.evaluateBezierDerivative(segments[0], 0.3);
		spline.splitBezier(segments[0], 0.3);
		assert.deepEqual(modes, [0, 1, 2, 4, 5, 9, 6, 7, 8]);
		const c = new PointOnSplineConstraint('p', 'p', 's', 'fit', ['a', 'b']);
		c.evaluate(
			new Map([
				['p.x', 2],
				['p.y', 3],
				['a.x', 0],
				['a.y', 0],
				['b.x', 5],
				['b.y', 2],
			])
		);
		assert.equal(modes.length, 9, 'JS fallback formulas retain independent reference math');
	} finally {
		setGeometryKernel(previous);
	}
});

it('rejects malformed WASM spline results instead of exposing corrupt geometry', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8)];
	const segment = reference.fitPointsToBezier(points)[0];
	for (const output of [[], [0], [NaN, 0], [1, 2, 3], Array(8).fill(Infinity)]) {
		const kernel = createWasmSplineKernel(() => new Float64Array(output));
		assert.throws(() => kernel.naturalHandles(points), /WASM spline/);
		assert.throws(() => kernel.pointAt([segment], 0.4), /WASM spline/);
		assert.throws(() => kernel.fitToBezier(points), /WASM spline/);
	}
	for (const output of [
		[1.1, 2, 3, 4],
		[0.5, -1, 3, 4],
	])
		assert.throws(
			() => createWasmSplineKernel(() => new Float64Array(output)).project([segment], points[0]),
			/WASM spline/
		);
});

it('retains sparse solver linearization reuse when successive candidate steps are rejected', () => {
	const manager = new ParamManager();
	let writes = 0,
		jacobians = 0;
	for (const id of ['a.x', 'a.y'])
		manager.register({
			id,
			get: () => 0,
			set: () => {
				writes++;
			},
		});
	const c = new FixedConstraint('custom', 'a', 1, 1);
	// A constant error rejects every trial while its supplied Jacobian keeps a nonzero gradient.
	c.evaluate = () => [1, 1];
	const jacobian = c.jacobian.bind(c);
	c.jacobian = (...args) => {
		jacobians++;
		return jacobian(...args);
	};
	const result = new NumericalSolver({ maxIterations: 5 }).solve(manager, [c], { skipDoF: true });
	assert.equal(result.iterations, 5);
	assert.equal(writes, 0);
	assert.equal(jacobians, 1, 'a rejected step must retain the cached linearization');
});

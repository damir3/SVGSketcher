import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as spline from '../src/math/spline';
import { Vec2 } from '../src/math/vector';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmSplineKernel } from '../src/kernel/splineWasm';
import { FixedConstraint } from '../src/solver/constraints/fixed';
import { NumericalSolver, ParamManager } from '../src/solver/solver';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelSplineEditing.json', import.meta.url), 'utf8'));
const wasm = await import('../public/kernel/sketcher_wasm.js');
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

it('evaluates points, derivatives and clamped parameters without mutating inputs', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4)];
	const segments = spline.fitPointsToBezier(points);
	const original = JSON.stringify(segments);
	compare(spline.getSplinePointAtParam(segments, -1), spline.getSplinePointAtParam(segments, 0));
	compare(spline.getSplinePointAtParam(segments, 2), spline.getSplinePointAtParam(segments, 1));
	compare(spline.getSplinePointAtParam(segments, 0), points[0]);
	compare(spline.getSplinePointAtParam(segments, 1), points[points.length - 1]);
	for (const t of [0, 0.23, 0.9, 1]) {
		const p = spline.evaluateBezier(segments[1], t);
		const d = spline.evaluateBezierDerivative(segments[1], t);
		assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
		assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
	}
	assert.equal(JSON.stringify(segments), original);
});

it('rejects non-clamped knot vectors and non-finite spline inputs', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8), new Vec2(8, 10), new Vec2(13, 4), new Vec2(20, 0)];
	const knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 2];
	assert.throws(() => spline.bsplineToBezier(points, knots), /knot/i);
	const segments = spline.fitPointsToBezier(points);
	assert.throws(() => spline.getSplinePointAtParam(segments, Infinity), /Non-finite/);
	assert.throws(() => spline.getSplinePointAtParam(segments, NaN), /Non-finite/);
	assert.throws(() => spline.computeNaturalFitHandles([new Vec2(NaN, 0), new Vec2(1, 2)]), /Non-finite/);
});

it('routes public helpers through direct WASM modes', () => {
	const previous = getGeometryKernel(),
		modes: number[] = [];
	try {
		setGeometryKernel({
			...previous,
			spline: createWasmSplineKernel((...args) => {
				modes.push(args[3][0]);
				return wasm.spline_geometry(...args);
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
	} finally {
		setGeometryKernel(previous);
	}
});

it('rejects malformed WASM spline results instead of exposing corrupt geometry', () => {
	const points = [new Vec2(0, 0), new Vec2(3, 8)];
	const segment = spline.fitPointsToBezier(points)[0];
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

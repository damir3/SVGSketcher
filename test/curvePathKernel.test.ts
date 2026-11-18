import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmCurveKernel } from '../src/kernel/curveWasm';
import { createCurvePath, pointsAtCurveParameters, parametersAtCurvePoints } from '../src/math/curvePath';
import { getPointAtParam, getParamAtPoint } from '../src/math/intersection';
import { generateTextSvgPathData } from '../src/math/textPath';
import { createPathEvaluator as oldPath } from '../src/math/textPathReference';
import { generateTextSvgPathData as oldText } from '../src/math/textPlacementReference';
import { hydrateQueryCurve } from '../src/kernel/queryReference';
import { getFontSync } from '../src/canvas/fonts';
import { Vec2 } from '../src/math/vector';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelCurvePaths.json', import.meta.url), 'utf8'));
function compare(actual: any, expected: any, path = '') {
	if (typeof expected === 'number') {
		if (!Number.isFinite(expected)) {
			assert.equal(actual, expected, path);
			return;
		}
		assert.ok(
			typeof actual === 'number' && Math.abs(actual - expected) <= 1e-8 + Math.abs(expected) * 1e-10,
			`${path}: ${actual} != ${expected}`
		);
		return;
	}
	if (expected == null || typeof expected !== 'object') {
		assert.equal(actual, expected, path);
		return;
	}
	assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
	for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
}
const plain = (v: any) => JSON.parse(JSON.stringify(v));

test('curve fixtures identify frozen distance and parameter implementations', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(`../${file}`, import.meta.url)))
				.digest('hex'),
			hash
		);
});
for (const f of fixture.cases)
	test(`batched length, frames and parameters: ${f.curve.id}`, () => {
		const c = hydrateQueryCurve(f.curve),
			path = createCurvePath(c);
		compare(path.length, f.length);
		compare(plain(path.getSamplesAtDistances(f.distances)), f.frames);
		f.distances.forEach((d, i) => compare(plain(path.getSampleAtDistance(d)), f.frames[i]));
		compare(plain(pointsAtCurveParameters(c, f.parameters)), f.positions);
		compare(parametersAtCurvePoints(c, f.points), f.params);
		f.parameters.forEach((t, i) => compare(plain(getPointAtParam(c, t)), f.positions[i]));
		f.points.forEach((p, i) => compare(getParamAtPoint(c, Vec2.from(p)), f.params[i]));
		assert.deepEqual(path.getSamplesAtDistances([]), []);
	});

test('distance sampling preserves independent frames at cubic joins and ellipse arc ends', () => {
	for (const f of fixture.cases) {
		const c = hydrateQueryCurve(f.curve),
			legacy = oldPath(c),
			active = createCurvePath(c);
		const distances = Array.from({ length: 201 }, (_, i) => (i / 50 - 1) * legacy.length);
		compare(plain(active.getSamplesAtDistances(distances)), plain(distances.map(s => legacy.getSampleAtDistance(s))));
	}
	const line = fixture.cases[0].curve;
	const frames = createCurvePath(line).getSamplesAtDistances([0, 0]);
	frames[0].point.x += 10;
	assert.notEqual(frames[0].point.x, frames[1].point.x);
});

test('text SVG stays equal to the pre-native layout for all curve types and layout switches', () => {
	const font = getFontSync('Arial', false, false);
	assert.ok(font);
	for (const f of fixture.cases) {
		const c = hydrateQueryCurve(f.curve);
		for (const alignment of ['left', 'center', 'right'] as const)
			for (const fitToPath of [false, true])
				for (const placement of ['above', 'below'] as const)
					for (const flipHorizontal of [false, true])
						for (const flipVertical of [false, true]) {
							const options = {
								mode: 'text_on_path' as const,
								text: 'Ab 09\nxy',
								height: 4,
								characterSpacing: 12,
								alignment,
								fitToPath,
								placement,
								flipHorizontal,
								flipVertical,
								coordSystem: 'svg' as const,
							};
							const actual = generateTextSvgPathData(options, font, c),
								expected = oldText(options, font, c);
							// SVG uses two decimal places; allow only rounding at a 0.005 boundary.
							const aa = actual.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [],
								bb = expected.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [];
							assert.equal(aa.length, bb.length, c.id);
							aa.forEach((v, i) =>
								Number.isNaN(Number(v))
									? assert.equal(v, bb[i])
									: assert.ok(Math.abs(Number(v) - Number(bb[i])) <= 0.010000001, `${c.id}: ${v} != ${bb[i]}`)
							);
						}
	}
});

test('WASM lays out complete text in one call and keeps reusable standalone path tables', {
	skip: !getGeometryKernel().curves,
}, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let textCalls = 0;
	const modes: number[] = [],
		f = fixture.cases.find(f => f.curve.id === 'spline'),
		c = hydrateQueryCurve(f.curve),
		font = getFontSync('Arial', false, false)!;
	const options = {
		mode: 'text_on_path' as const,
		text: 'Geometry '.repeat(30),
		height: 3,
		characterSpacing: 0,
		alignment: 'center' as const,
		fitToPath: true,
		placement: 'above' as const,
		flipHorizontal: true,
		flipVertical: false,
	};
	const expected = oldText(options, font, c);
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				text_geometry(...args) {
					textCalls++;
					return bindings.text_geometry(...args);
				},
				curve_path(data, table, values, mode) {
					modes.push(mode);
					return bindings.curve_path(data, table, values, mode);
				},
				spline_geometry() {
					throw new Error('unexpected per-point spline boundary call');
				},
			})
		);
		const before = plain(c);
		const actual = generateTextSvgPathData(options, font, c);
		assert.deepEqual(modes, []);
		assert.equal(textCalls, 1);
		assert.deepEqual(plain(c), before);
		assert.equal(actual, expected);
		modes.length = 0;
		const path = createCurvePath(c);
		path.getSamplesAtDistances([0, 1, 2]);
		path.getSamplesAtDistances([3, 4]);
		assert.deepEqual(modes, [0, 1, 1]);
		const points = pointsAtCurveParameters(c, [0, 0.25, 0.5, 1]);
		parametersAtCurvePoints(c, points);
		assert.deepEqual(modes, [0, 1, 1, 2, 3]);
	} finally {
		setGeometryKernel(previous);
	}
});

test('curve adapter validates prepared tables and sample result lengths', () => {
	const curve = fixture.cases[0].curve;
	for (const values of [[], [1, 0, 0, 0], [NaN, 0, 0, -1], [1, 0, 0, -1, 0, 0, 0], [-1, 0, 0, -1]])
		assert.throws(() => createWasmCurveKernel(() => new Float64Array(values)).preparePath(curve), /WASM curve/);
	const kernel = createWasmCurveKernel((_data, _table, _values, mode) =>
		mode === 0 ? new Float64Array([1, 0, 0, -1]) : new Float64Array([NaN])
	);
	const path = kernel.preparePath(curve);
	assert.throws(() => path.samples([0]), /WASM curve/);
	assert.throws(() => kernel.pointsAtParameters(curve, [0]), /WASM curve/);
	assert.throws(() => kernel.parametersAtPoints(curve, [{ x: 0, y: 0 }]), /WASM curve/);
});

test('native path decoder rejects malformed curve data, tables and values', {
	skip: !getGeometryKernel().curves,
}, async () => {
	const { curve_path: call } = await import('../public/kernel/sketcher_wasm.js');
	const line = new Float64Array([0, 0, 0, 4, 0, 0, 10, 0]),
		empty = new Float64Array();
	for (const data of [[], [0], [5, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0]])
		assert.throws(() => call(new Float64Array(data), empty, empty, 0));
	for (const table of [[], [1, 0, 0, 0], [1, 0, NaN, -1], [1, 0, 0, -1, 0, 0, 0]])
		assert.throws(() => call(line, new Float64Array(table), new Float64Array([0]), 1), /curve path/);
	assert.throws(() => call(line, empty, new Float64Array([1]), 3), /curve parameter/);
	assert.throws(() => call(line, empty, new Float64Array([NaN]), 2), /curve path/);
});

test('prepared paths remain snapshots and support large repeated batches', () => {
	const curve = structuredClone(fixture.cases[0].curve),
		path = createCurvePath(curve),
		before = plain(path.getSampleAtDistance(2));
	curve.p1.x += 100;
	curve.p2.y -= 100;
	compare(plain(path.getSampleAtDistance(2)), before);
	const distances = Array.from({ length: 20000 }, (_, i) => i * 0.001),
		frames = path.getSamplesAtDistances(distances);
	assert.equal(frames.length, distances.length);
	compare(plain(frames[2000]), before);
});

test('tiny and degenerate elliptical arcs preserve separate distance and SVG-parameter conventions', () => {
	for (const clockwise of [false, true])
		for (const [rx, ry] of [
			[1e-8, 2e-8],
			[0, 2],
			[2, 0],
			[0, 0],
		]) {
			const c = hydrateQueryCurve({
				id: 'tiny-ea',
				type: 'elliptical_arc',
				center: { x: 0, y: 0 },
				majorAxisPoint: { x: rx, y: 0 },
				minorAxisPoint: { x: 0, y: ry },
				start: { x: rx, y: 0 },
				end: { x: 0, y: ry },
				clockwise,
			});
			const before = oldPath(c),
				after = createCurvePath(c),
				distances = [-1, 0, before.length / 2, before.length, 1];
			compare(after.length, before.length);
			compare(
				after.getSamplesAtDistances(distances),
				distances.map(d => before.getSampleAtDistance(d))
			);
		}
});

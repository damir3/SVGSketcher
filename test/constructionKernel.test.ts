import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel } from '../src/kernel';
import { CONSTRUCTION_MODES, type ConstructionMode } from '../src/kernel/constructionTypes';
import { createWasmConstruction } from '../src/kernel/constructionWasm';
import { typescriptConstruction } from '../src/math/constructionReference';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelConstruction.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().construction;
function compare(actual: number[] | null, expected: number[] | null, name: string) {
	assert.equal(actual === null, expected === null, name);
	if (!actual || !expected) return;
	assert.equal(actual.length, expected.length, name);
	actual.forEach((v, i) =>
		assert.ok(
			Math.abs(v - expected[i]) <= 1e-9 + Math.abs(expected[i]) * 1e-10,
			`${name}[${i}]: ${v} != ${expected[i]}`
		)
	);
}
for (const f of fixture.cases)
	test(`construction preserves pre-routing tool results: ${f.name}`, () => {
		compare(typescriptConstruction(f.mode, f.data), f.expected, f.name + ' TS');
		if (native) compare(native(f.mode, f.data), f.expected, f.name + ' Rust');
	});
test('construction adapter rejects malformed output and propagates native errors', () => {
	for (const data of [[1, 1, 2], [1, 1, 2, NaN], [0, 1], [2], [1, 1, 2, 3, 4]])
		assert.throws(() => createWasmConstruction(() => new Float64Array(data))('circumcircle', [0, 0, 10, 0, 0, 10]));
	assert.throws(() =>
		createWasmConstruction(() => new Float64Array([1, 0, 0, 1, 2, 3]))(
			'arc_three_point',
			[0, 0, 1, 0, 0, 1, 0, 0, 0, 0, -1]
		)
	);
	assert.throws(
		() =>
			createWasmConstruction(() => {
				throw new Error('native failure');
			})('circumcircle', [0, 0, 1, 0, 0, 1]),
		/native failure/
	);
});
test('native construction decoder rejects malformed records and flags', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js');
	for (const [mode, data] of [
		[99, []],
		[0, []],
		[0, [NaN, 0, 1, 0, 0, 1]],
		[7, [0, 0, 1, 0, 0, 1, 2, 1, 0, 0, -1]],
		[10, [0, 0, 1, 0, 1, 3]],
		[16, [0, 0, 1, 1e20, 0, 1]],
	])
		assert.throws(() => bindings.construct_geometry(mode as number, new Float64Array(data as number[])));
});
test('all construction modes have an independent captured case', () => {
	for (const mode of CONSTRUCTION_MODES)
		assert.ok(fixture.cases.some((f: { mode: ConstructionMode }) => f.mode === mode));
});

test('polygon vertices and tangent construction use one native query each without geometry callbacks', {
	skip: !native,
}, async () => {
	const { setGeometryKernel } = await import('../src/kernel');
	const { createWasmGeometryKernel } = await import('../src/kernel/wasm');
	const bindings = await import('../public/kernel/sketcher_wasm.js');
	const construction = await import('../src/math/construction');
	const previous = getGeometryKernel();
	const modes: number[] = [];
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				construct_geometry(mode, data) {
					modes.push(mode);
					return bindings.construct_geometry(mode, data);
				},
				curve_path() {
					throw new Error('unexpected curve callback');
				},
				spline_geometry() {
					throw new Error('unexpected spline callback');
				},
			})
		);
		const center = { x: 5, y: 7 };
		assert.equal(construction.polygonVertices(center, 10, 100, 0, true).length, 100);
		assert.deepEqual(center, { x: 5, y: 7 });
		assert.deepEqual(modes, [16]);
		assert.ok(
			construction.circleThreeTangent([
				{ p: { x: 0, y: 0 }, n: { x: 1, y: 0 } },
				{ p: { x: 0, y: 0 }, n: { x: 0, y: 1 } },
				{ p: { x: 3, y: 0 }, n: { x: 0.8, y: 0.6 } },
			])
		);
		assert.deepEqual(modes, [16, 6]);
	} finally {
		setGeometryKernel(previous);
	}
});
test('the independent construction fallback preserves caller inputs', () => {
	// The numeric reference is also used when a custom kernel omits construction.
	for (const f of fixture.cases) {
		const before = structuredClone(f.data);
		typescriptConstruction(f.mode, f.data);
		assert.deepEqual(f.data, before);
	}
});

test('construction fixtures identify the independent reference source', () => {
	assert.equal(
		createHash('sha256')
			.update(readFileSync(new URL('../src/math/constructionReference.ts', import.meta.url)))
			.digest('hex'),
		fixture.referenceHash
	);
});

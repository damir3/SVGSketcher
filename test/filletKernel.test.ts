import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { createWasmFilletKernel } from '../src/kernel/filletWasm';
import * as fillet from '../src/math/fillet';
import * as reference from '../src/math/filletReference';
import type { GeoCurve } from '../src/math/intersection';
import { Vec2 } from '../src/math/vector';

type Options = Parameters<typeof fillet.calculateFilletGeometry>[3];
const fixture = JSON.parse(
	readFileSync(new URL('./fixtures/kernelFillet.json', import.meta.url), 'utf8'),
	(_key, v) => {
		if (v === 'Infinity') return Infinity;
		return v && typeof v === 'object' && 'x' in v && 'y' in v ? Vec2.from(v) : v;
	}
) as {
	sourceHashes: Record<string, string>;
	cases: {
		name: string;
		c1: GeoCurve;
		c2: GeoCurve;
		options: Options;
		radius?: number;
		max?: number;
		min?: number;
		result: unknown;
	}[];
	evaluations: { name: string; curve: GeoCurve; t: number; result: unknown }[];
	projections: { name: string; curve: GeoCurve; point: Vec2; result: unknown }[];
};
function compare(a: unknown, b: unknown, path = '') {
	if (typeof a === 'number' && typeof b === 'number') {
		assert.ok(a === b || (Number.isFinite(a) && Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9), `${path}: ${a} != ${b}`);
		return;
	}
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		assert.deepEqual(a, b, path);
		return;
	}
	const keys = (o: object) =>
		Object.keys(o)
			.filter(k => o[k] !== undefined)
			.sort();
	assert.deepEqual(keys(a), keys(b), path);
	for (const key of keys(b)) compare(a[key], b[key], `${path}.${key}`);
}
test('fillet snapshots retain the recorded TypeScript calculations', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes)) {
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(`../${file}`, import.meta.url)))
				.digest('hex'),
			hash
		);
	}
	for (const c of fixture.cases)
		compare(
			c.radius === undefined
				? reference.findMaxFilletRadius(c.c1, c.c2, c.options, c.max, c.min)
				: reference.calculateFilletGeometry(c.c1, c.c2, c.radius, c.options),
			c.result,
			c.name
		);
});
for (const c of fixture.cases)
	test(`fillet parity: ${c.name}`, () => {
		const before = JSON.stringify([c.c1, c.c2, c.options]);
		const result =
			c.radius === undefined
				? fillet.findMaxFilletRadius(c.c1, c.c2, c.options, c.max, c.min)
				: fillet.calculateFilletGeometry(c.c1, c.c2, c.radius, c.options);
		compare(result, c.result, c.name);
		if (result && typeof result === 'object') {
			assert.ok(result.center instanceof Vec2 && result.t1 instanceof Vec2 && result.midArc instanceof Vec2);
			assert.equal(result.endPointId1, c.options.endPointId1);
			if (c.options.cornerVertex) assert.equal(result.cornerVertex, c.options.cornerVertex);
		}
		assert.equal(JSON.stringify([c.c1, c.c2, c.options]), before);
	});
for (const c of fixture.evaluations)
	test(`extended evaluation: ${c.name} t=${c.t}`, () => compare(fillet.evaluateCurveExtended(c.curve, c.t), c.result));
for (const c of fixture.projections)
	test(`extended projection: ${c.name} (${c.point.x},${c.point.y})`, () =>
		compare(fillet.projectOntoCurveExtended(c.curve, c.point), c.result));

test('fillet query and maximum-radius search each use one native call', () => {
	const previous = getGeometryKernel(),
		c = fixture.cases.find(c => c.name === 'control bowl r=15')!;
	const result = reference.calculateFilletGeometry(c.c1, c.c2, 15, c.options)!;
	const packed = [
		1,
		result.center.x,
		result.center.y,
		result.radius,
		result.t1.x,
		result.t1.y,
		result.t2.x,
		result.t2.y,
		Number(result.clockwise),
		result.cornerVertex.x,
		result.cornerVertex.y,
		result.midArc.x,
		result.midArc.y,
		result.bisectorDir.x,
		result.bisectorDir.y,
		result.param1,
		result.param2,
	];
	const modes: number[] = [];
	const api = createWasmFilletKernel((_curves, s) => {
		modes.push(s[0]);
		return new Float64Array(s[0] === 3 ? [1, 37.4] : packed);
	});
	try {
		setGeometryKernel({ ...previous, fillet: api, spline: undefined });
		compare(fillet.calculateFilletGeometry(c.c1, c.c2, 15, c.options), result);
		assert.equal(fillet.findMaxFilletRadius(c.c1, c.c2, c.options), 37.4);
		assert.deepEqual(modes, [2, 3]);
	} finally {
		setGeometryKernel(previous);
	}
});
test('TypeScript fallback preserves sentinel and borrowed-point behavior', () => {
	const previous = getGeometryKernel();
	try {
		setGeometryKernel(typescriptGeometryKernel);
		const corner = new Vec2(2, 3),
			curve: GeoCurve = { type: 'segment', id: 'zero', p1: corner, p2: corner.clone() };
		assert.equal(fillet.projectOntoCurveExtended(curve, new Vec2()).point, corner);
		for (const c of fixture.cases)
			compare(
				c.radius === undefined
					? fillet.findMaxFilletRadius(c.c1, c.c2, c.options, c.max, c.min)
					: fillet.calculateFilletGeometry(c.c1, c.c2, c.radius, c.options),
				c.result
			);
	} finally {
		setGeometryKernel(previous);
	}
});
test('WASM adapter rejects malformed fillet results', () => {
	const c = fixture.cases[0],
		line = c.c1;
	for (const output of [
		[],
		[1],
		[2],
		[0, 0],
		[1, ...Array(16).fill(0)],
		[1, ...Array(16).fill(NaN)],
		[1, ...Array(17).fill(1)],
	]) {
		const api = createWasmFilletKernel(() => new Float64Array(output));
		assert.throws(() => api.calculate(c.c1, c.c2, 10, c.options), /WASM fillet result/);
	}
	for (const output of [[], [1], [0, 2], [1, 0], [1, -1], [1, 101], [1, NaN], [1, Infinity], [1, 5, 5]]) {
		const api = createWasmFilletKernel(() => new Float64Array(output));
		assert.throws(() => api.maxRadius(c.c1, c.c2, c.options, 100, 0.1), /WASM fillet result/);
	}
	for (const output of [[], [0, 0, 0, -1], [0, 0, 0, Infinity], [0, 0, 0, NaN], [0, 0, 0, 1, 1]]) {
		const api = createWasmFilletKernel(() => new Float64Array(output));
		assert.throws(() => api.project(line, { x: 0, y: 0 }), /WASM fillet result/);
	}
	const api = createWasmFilletKernel(() => new Float64Array([0, 0, 1, 0, Infinity, 1]));
	assert.throws(() => api.evaluate(line, 0), /WASM fillet result/);
});

test('WASM fillets match the reference after deterministic rotations, translations and scaling', {
	skip: getGeometryKernel().backend !== 'wasm',
}, () => {
	let seed = 0x56463210;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const sources = fixture.cases.filter(c => c.radius === 15 && c.name !== 'empty spline r=15');
	for (let i = 0; i < 120; i++) {
		const source = sources[i % sources.length],
			theta = random() * Math.PI * 2,
			s = 0.4 + random() * 2,
			x = random() * 400 - 200,
			y = random() * 400 - 200;
		const transform = (v: unknown): any => {
			if (v instanceof Vec2)
				return new Vec2(
					x + s * (v.x * Math.cos(theta) - v.y * Math.sin(theta)),
					y + s * (v.x * Math.sin(theta) + v.y * Math.cos(theta))
				);
			if (Array.isArray(v)) return v.map(transform);
			if (v && typeof v === 'object')
				return Object.fromEntries(
					Object.entries(v).map(([k, value]) => [
						k,
						k === 'radius' && typeof value === 'number' ? value * s : transform(value),
					])
				);
			return v;
		};
		const c1 = transform(source.c1) as GeoCurve,
			c2 = transform(source.c2) as GeoCurve,
			options = transform(source.options) as Options,
			radius = 15 * s;
		const expected = reference.calculateFilletGeometry(c1, c2, radius, options);
		compare(fillet.calculateFilletGeometry(c1, c2, radius, options), expected, `${source.name} transform ${i}`);
	}
});

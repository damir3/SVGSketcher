import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { createWasmChamferKernel } from '../src/kernel/chamferWasm';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateChamferGeometry,
	findChamferCandidateForPoint,
	type ChamferCandidate,
	type ChamferMode,
} from '../src/math/chamfer';
import * as reference from '../src/math/chamferReference';
import type { ChamferFrame } from '../src/kernel/chamferTypes';
import { Vec2 } from '../src/math/vector';
const fixture = JSON.parse(
	readFileSync(new URL('./fixtures/kernelChamfer.json', import.meta.url), 'utf8'),
	(_key, v) => (v && typeof v === 'object' && 'x' in v && 'y' in v ? Vec2.from(v) : v)
) as {
	sourceHashes: Record<string, string>;
	corners: { name: string; vertex: Vec2; other1: Vec2; other2: Vec2; result: ChamferFrame | null }[];
	queries: {
		name: string;
		corner: number;
		mode: ChamferMode;
		d1: number;
		d2: number;
		angle: number;
		flip: boolean;
		result: unknown;
	}[];
};
function candidate(index: number): ChamferCandidate {
	const c = fixture.corners[index],
		f = c.result!;
	return {
		id: c.name,
		vertexPointId: 'vertex',
		vertexPos: c.vertex,
		dir1: Vec2.from(f.dir1),
		dir2: Vec2.from(f.dir2),
		len1: f.len1,
		len2: f.len2,
		cornerAngleRad: f.cornerAngleRad,
		line1: { id: 'l1', cornerPointId: 'vertex', otherPointId: 'a' },
		line2: { id: 'l2', cornerPointId: 'vertex', otherPointId: 'b' },
	};
}
function compare(a: unknown, b: unknown, path = '') {
	if (typeof a === 'number' && typeof b === 'number') {
		assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-10 + Math.abs(b) * 1e-10, `${path}: ${a} != ${b}`);
		return;
	}
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		assert.deepEqual(a, b, path);
		return;
	}
	const keys = (v: object) =>
		Object.keys(v)
			.filter(k => v[k] !== undefined)
			.sort();
	assert.deepEqual(keys(a), keys(b), path);
	for (const key of keys(b)) compare(a[key], b[key], `${path}.${key}`);
}
test('chamfer reference matches the pre-routing snapshots', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(`../${file}`, import.meta.url)))
				.digest('hex'),
			hash
		);
	for (const c of fixture.corners)
		compare(reference.calculateChamferCorner(c.vertex, c.other1, c.other2), c.result, c.name);
	for (const q of fixture.queries)
		compare(
			reference.calculateChamferGeometry(candidate(q.corner), q.mode, q.d1, q.d2, q.angle, q.flip),
			q.result,
			q.name
		);
});
for (const [index, c] of fixture.corners.entries())
	test(`native corner preparation: ${c.name}`, () => {
		const sketch = new SketchDocument();
		let id = '';
		sketch.withDeferredSolve(() => {
			const vertex = sketch.addPoint(c.vertex);
			id = vertex.id;
			sketch.addLine(id, sketch.addPoint(c.other1).id);
			sketch.addLine(id, sketch.addPoint(c.other2).id);
		});
		const before = sketch.takeSnapshot(),
			r = findChamferCandidateForPoint(sketch, id);
		const frame = r
			? { dir1: r.dir1, dir2: r.dir2, len1: r.len1, len2: r.len2, cornerAngleRad: r.cornerAngleRad }
			: null;
		compare(frame, c.result, `corner ${index}`);
		if (r) {
			assert.ok(r.vertexPos instanceof Vec2 && r.dir1 instanceof Vec2);
			assert.notEqual(r.vertexPos, sketch.points.get(id));
		}
		assert.deepEqual(sketch.takeSnapshot(), before);
	});
for (const q of fixture.queries)
	test(`chamfer parity: ${q.name}`, () => {
		const c = candidate(q.corner),
			before = JSON.stringify(c),
			r = calculateChamferGeometry(c, q.mode, q.d1, q.d2, q.angle, q.flip);
		compare(r, q.result, q.name);
		assert.ok(r.t1 instanceof Vec2 && r.midPoint instanceof Vec2 && r.bisectorDir instanceof Vec2);
		assert.equal(JSON.stringify(c), before);
	});
test('chamfer reference fallback works without a native feature', () => {
	const previous = getGeometryKernel();
	try {
		setGeometryKernel(typescriptGeometryKernel);
		const c = candidate(0);
		compare(
			calculateChamferGeometry(c, 'distance_angle', 10, 0, 30, true),
			reference.calculateChamferGeometry(c, 'distance_angle', 10, 0, 30, true)
		);
	} finally {
		setGeometryKernel(previous);
	}
});
test('each chamfer calculation crosses the numeric binding once', () => {
	const c = candidate(0),
		r = reference.calculateChamferGeometry(c, 'two_distance', 12, 7, 45, false),
		calls: number[] = [];
	const api = createWasmChamferKernel((_data, settings) => {
		calls.push(settings[0]);
		return new Float64Array(
			settings[0] === 0
				? [1, 1, 0, 0, 1, 100, 80, Math.PI / 2]
				: [
						r.t1.x,
						r.t1.y,
						r.t2.x,
						r.t2.y,
						r.dist1,
						r.dist2,
						r.angleDeg,
						r.chamferLength,
						r.midPoint.x,
						r.midPoint.y,
						r.bisectorDir.x,
						r.bisectorDir.y,
						r.maxDist1,
						r.maxDist2,
						0,
					]
		);
	});
	compare(api.corner(new Vec2(), new Vec2(100, 0), new Vec2(0, 80)), fixture.corners[0].result);
	compare(api.calculate(c, 'two_distance', 12, 7, 45, false), r);
	assert.deepEqual(calls, [0, 1]);
});
test('WASM chamfer result validation rejects malformed layouts and error codes', () => {
	const c = candidate(0);
	for (const output of [
		[],
		[1],
		[0, 0],
		[2, 1, 0, 0, 1, 100, 80, 1],
		[1, 1, 0, 0, 1, 0, 80, 1],
		[1, NaN, 0, 0, 1, 100, 80, 1],
		[1, 1, 0, 0, 1, 100, 80, Math.PI],
	]) {
		const api = createWasmChamferKernel(() => new Float64Array(output));
		assert.throws(() => api.corner(c.vertexPos, c.dir1, c.dir2), /WASM chamfer result/);
	}
	const valid = [10, 0, 0, 10, 10, 10, 45, Math.sqrt(200), 5, 5, Math.SQRT1_2, Math.SQRT1_2, 99.9, 79.9, 0];
	for (const [index, value] of [
		[0, NaN],
		[2, Infinity],
		[4, -1],
		[6, 181],
		[7, -1],
		[12, 0],
		[14, -1],
		[14, 4],
		[14, 0.5],
	]) {
		const data = [...valid];
		data[index] = value;
		const api = createWasmChamferKernel(() => new Float64Array(data));
		assert.throws(() => api.calculate(c, 'equal_distance', 10, 10, 45, false), /WASM chamfer result/);
	}
	for (const data of [[], valid.slice(1), [...valid, 0]])
		assert.throws(
			() => createWasmChamferKernel(() => new Float64Array(data)).calculate(c, 'equal_distance', 10, 10, 45, false),
			/WASM chamfer result/
		);
});
test('WASM chamfers agree with TypeScript for deterministic rotated and translated corners', {
	skip: getGeometryKernel().backend !== 'wasm',
}, () => {
	const api = getGeometryKernel().chamfer!;
	let seed = 0xc4a6f;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	for (let i = 0; i < 200; i++) {
		const v = new Vec2(random() * 2000 - 1000, random() * 2000 - 1000),
			angle = random() * Math.PI * 2,
			theta = 0.03 + random() * (Math.PI - 0.06),
			l1 = 0.2 + random() * 500,
			l2 = 0.2 + random() * 500;
		const a = v.clone().add(new Vec2(Math.cos(angle) * l1, Math.sin(angle) * l1)),
			b = v.clone().add(new Vec2(Math.cos(angle + theta) * l2, Math.sin(angle + theta) * l2));
		const expected = reference.calculateChamferCorner(v, a, b)!,
			actual = api.corner(v, a, b)!;
		compare(actual, expected, `frame ${i}`);
		const c = { ...candidate(0), vertexPos: v, ...expected };
		const mode = (['equal_distance', 'two_distance', 'distance_angle'] as const)[i % 3],
			d1 = random() * l1 * 1.1,
			d2 = random() * l2 * 1.1,
			degrees = random() * 190 - 5,
			flip = !!(i % 2);
		compare(
			api.calculate({ ...actual, vertexPos: v }, mode, d1, d2, degrees, flip),
			reference.calculateChamferGeometry(c, mode, d1, d2, degrees, flip),
			`query ${i}`
		);
	}
});

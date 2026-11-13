import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { createWasmOffsetKernel } from '../src/kernel/offsetWasm';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateOffsetGeometry,
	toggleOrExtendChain,
	type OffsetChain,
	type OffsetDirection,
	type OffsetSideGeometry,
} from '../src/math/offset';
import * as reference from '../src/math/offsetReference';
import { Vec2 } from '../src/math/vector';
import { mixedOffsetScene, offsetContourGroups } from './helpers/mixedOffsetScene';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelOffset.json', import.meta.url), 'utf8')) as {
	sourceHashes: Record<string, string>;
	scenes: {
		name: string;
		snapshot: ReturnType<SketchDocument['takeSnapshot']>;
		chain: OffsetChain;
		gizmoAnchor: Vec2;
		gizmoNormal: Vec2;
		sideResults: OffsetSideGeometry[];
		queries: {
			direction: OffsetDirection;
			d1: number;
			d2: number;
			flip: boolean;
			result: { sides: number[]; isValid: boolean; errorMessage?: string };
		}[];
	}[];
};
function compare(a: unknown, b: unknown, path = '') {
	if (typeof a === 'number' && typeof b === 'number') {
		assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-8 + Math.abs(b) * 1e-10, `${path}: ${a} != ${b}`);
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
	for (const k of keys(b)) compare(a[k], b[k], `${path}.${k}`);
}
function expected(scene: (typeof fixture.scenes)[number], q: (typeof scene.queries)[number]) {
	return {
		...q.result,
		sides: q.result.sides.map(i => scene.sideResults[i]),
		gizmoAnchor: scene.gizmoAnchor,
		gizmoNormal: scene.gizmoNormal,
	};
}
test('offset numerical reference matches the pre-routing snapshots', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(`../${file}`, import.meta.url)))
				.digest('hex'),
			hash
		);
	const previous = getGeometryKernel();
	try {
		setGeometryKernel(typescriptGeometryKernel);
		for (const scene of fixture.scenes) {
			const sketch = new SketchDocument();
			sketch.restoreSnapshot(scene.snapshot);
			for (const q of scene.queries)
				compare(
					reference.calculateOffsetGeometry(sketch, scene.chain, q.direction, q.d1, q.d2, q.flip),
					expected(scene, q),
					`${scene.name} ${q.direction} d=${q.d1} flip=${q.flip}`
				);
		}
	} finally {
		setGeometryKernel(previous);
	}
});
for (const scene of fixture.scenes)
	test(`offset parity: ${scene.name}`, () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		sketch.clearHistory();
		const before = sketch.takeSnapshot(),
			chainBefore = JSON.stringify(scene.chain);
		for (const q of scene.queries) {
			const result = calculateOffsetGeometry(sketch, scene.chain, q.direction, q.d1, q.d2, q.flip);
			let target = expected(scene, q);
			if (
				scene.chain?.items.some(
					item => item.type === 'spline' || item.type === 'elliptical_arc' || item.type === 'ellipse'
				)
			) {
				const previous = getGeometryKernel();
				try {
					setGeometryKernel(typescriptGeometryKernel);
					target = calculateOffsetGeometry(sketch, scene.chain, q.direction, q.d1, q.d2, q.flip);
				} finally {
					setGeometryKernel(previous);
				}
			}
			compare(result, target, `${scene.name} ${q.direction} d=${q.d1} flip=${q.flip}`);
			assert.ok(result.gizmoAnchor instanceof Vec2 && result.gizmoNormal instanceof Vec2);
			for (const side of result.sides)
				for (const p of side.primitives) {
					for (const key of [
						'p1',
						'p2',
						'center',
						'start',
						'end',
						'circleCenter',
						'startTangent',
						'endTangent',
					] as const)
						if (p[key]) assert.ok(p[key] instanceof Vec2);
					for (const point of p.fitPoints ?? []) assert.ok(point instanceof Vec2);
				}
		}
		assert.deepEqual(sketch.takeSnapshot(), before);
		assert.equal(JSON.stringify(scene.chain), chainBefore);
		assert.equal(sketch.canUndo(), false);
	});
const circleData = [0, 22, -20, 1, 0, 2, 0, 1, 3, 1, 0, 0, 2, 3, 10, -20, 15, 0, -1, 5, 1, 0, 0, 2, 3, 10, -20, 7];
test('both offset sides are calculated in one numeric binding call', () => {
	const scene = fixture.scenes.find(s => s.name === 'circle')!,
		sketch = new SketchDocument();
	sketch.restoreSnapshot(scene.snapshot);
	let count = 0;
	const api = createWasmOffsetKernel((_curves, items, settings) => {
		count++;
		assert.deepEqual(Array.from(items), [0, 3, 0, 0]);
		assert.deepEqual(Array.from(settings), [1, 0, 1, 3, 5, 0]);
		return new Float64Array(circleData);
	});
	const previous = getGeometryKernel();
	try {
		setGeometryKernel({ ...previous, offset: api });
		const q = scene.queries.find(q => q.direction === 'two_sides' && q.d1 === 3 && !q.flip)!;
		compare(calculateOffsetGeometry(sketch, scene.chain, q.direction, q.d1, q.d2, q.flip), expected(scene, q));
		assert.equal(count, 1);
	} finally {
		setGeometryKernel(previous);
	}
});
test('WASM offset adapter rejects malformed records and unknown sources', () => {
	const items = [
		{
			sourceId: 'circle',
			kind: 'circle' as const,
			curve: { id: 'circle', type: 'circle' as const, center: { x: 10, y: -20 }, radius: 12 },
		},
	];
	const query = (data: number[]) =>
		createWasmOffsetKernel(() => new Float64Array(data)).calculate(items, true, 0, 'two_sides', 3, 5, false);
	for (const data of [[], [0], circleData.slice(1), [...circleData, 0]])
		assert.throws(() => query(data), /WASM offset result/);
	for (const [i, v] of [
		[0, 5],
		[1, NaN],
		[4, Infinity],
		[5, 3],
		[6, 3],
		[7, 0],
		[8, -1],
		[9, 2],
		[10, 1],
		[11, 1],
		[12, 4],
		[13, 99],
		[16, 0],
		[17, 4],
	]) {
		const data = [...circleData];
		data[i] = v;
		assert.throws(() => query(data), /WASM offset result/);
	}
	const splineItems = [
		{
			sourceId: 'spline',
			kind: 'spline' as const,
			curve: { id: 'spline', type: 'spline' as const, bezierSegments: [] },
		},
	];
	for (const payload of [
		[1e9, 0, 0, 0, 0],
		[2, 0.5, 0, 0, 0, 0, 0, 1, 1],
		[2, 0, 1, 0, 0, 0, 0, 1, 1],
	]) {
		const data = [0, 0, 0, 0, 1, 1, 0, 1, 3, 1, 0, 0, 3, payload.length, ...payload];
		assert.throws(
			() =>
				createWasmOffsetKernel(() => new Float64Array(data)).calculate(splineItems, false, 0, 'one_side', 3, 0, false),
			/WASM offset result/
		);
	}
});

test('chain endpoint overrides are resolved before the original primitive endpoints', () => {
	const sketch = new SketchDocument();
	const original = sketch.addPoint({ x: 0, y: 0 }),
		end = sketch.addPoint({ x: 10, y: 0 }),
		replacement = sketch.addPoint({ x: 0, y: 0 }),
		line = sketch.addLine(original.id, end.id);
	sketch.points.delete(original.id);
	const chain: OffsetChain = {
		items: [{ id: line.id, type: 'line', startPointId: replacement.id, endPointId: end.id }],
		isClosed: false,
	};
	compare(
		calculateOffsetGeometry(sketch, chain, 'two_sides', 2, 3, false),
		reference.calculateOffsetGeometry(sketch, chain, 'two_sides', 2, 3, false)
	);
});

test('mixed spline/arc/ellipse offset junctions match the TypeScript fallback in either traversal direction', () => {
	const scene = JSON.parse(
		readFileSync(new URL('./fixtures/offset-test.svg', import.meta.url), 'utf8').match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]
	);
	const previous = getGeometryKernel();
	for (const selected of ['Spline-1', 'Line-10', 'Spline-3', 'Arc-2', 'Line-1']) {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		const chain = toggleOrExtendChain(
			sketch,
			null,
			selected,
			selected.startsWith('Line') ? 'line' : selected.startsWith('Arc') ? 'arc' : 'spline',
			true
		)!;
		for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
			for (const flip of [false, true])
				for (const distance of [0, 3, 6.5, 10, 15.5, 20]) {
					const actual = calculateOffsetGeometry(sketch, chain, direction, distance, 5, flip);
					try {
						setGeometryKernel(typescriptGeometryKernel);
						compare(
							actual,
							calculateOffsetGeometry(sketch, chain, direction, distance, 5, flip),
							`${selected}, ${direction}, flip=${flip}, d=${distance}`
						);
					} finally {
						setGeometryKernel(previous);
					}
				}
	}
});

test('offset adapter accepts ordered surviving sources and rejects duplicated or unordered sources', () => {
	const items = Array.from({ length: 3 }, (_, i) => ({
		sourceId: `line-${i}`,
		kind: 'line' as const,
		curve: { id: `line-${i}`, type: 'segment' as const, p1: { x: 10 * i, y: 0 }, p2: { x: 10 * i + 5, y: 0 } },
	}));
	const data = [0, 0, 0, 1, 0, 1, 0, 1, 2, 2, 0, 0, 0, 4, 0, 2, 5, 2, 2, 0, 0, 4, 20, 2, 25, 2];
	const query = (buffer: number[]) =>
		createWasmOffsetKernel(() => new Float64Array(buffer)).calculate(items, false, 0, 'one_side', 2, 0, false);
	assert.deepEqual(
		query(data).sides[0].primitives.map(p => p.sourceId),
		['line-0', 'line-2']
	);
	for (const [index, value] of [
		[10, -1],
		[10, 3],
		[10, 0.5],
		[18, 0],
		[18, 3],
		[18, 1.5],
	]) {
		const malformed = [...data];
		malformed[index] = value;
		assert.throws(() => query(malformed), /WASM offset result/);
	}
	const reversed = [...data];
	reversed[10] = 2;
	reversed[18] = 0;
	assert.throws(() => query(reversed), /WASM offset result/);
});

test('closed spline offsets preserve both eroded components and match the TypeScript fallback', () => {
	const scene = JSON.parse(
		readFileSync(new URL('./fixtures/spline-internal-offset.svg', import.meta.url), 'utf8').match(
			/<!\[CDATA\[([\s\S]*?)\]\]>/
		)![1]
	);
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(scene.snapshot);
	const original = sketch.takeSnapshot(),
		previous = getGeometryKernel();
	for (const reversed of [false, true]) {
		const chain = toggleOrExtendChain(sketch, null, 'Spline-1', 'spline', true)!;
		chain.items[0].reversed = reversed;
		for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
			for (const flip of [false, true])
				for (const distance of [-15, -10, -8, -7.7501, -5, 0, 5, 7.7501, 8, 10, 15]) {
					const actual = calculateOffsetGeometry(sketch, chain, direction, distance, 10, flip);
					assert.ok(actual.isValid);
					for (const side of actual.sides) {
						const expectedCount = side.side < 0 && side.distance >= 7.7501 ? 2 : 1;
						assert.equal(side.primitives.length, expectedCount, `${direction}, d=${distance}, flip=${flip}`);
						assert.ok(side.primitives.every(p => p.sourceId === 'Spline-1' && p.isSplineClosed));
					}
					try {
						setGeometryKernel(typescriptGeometryKernel);
						compare(actual, calculateOffsetGeometry(sketch, chain, direction, distance, 10, flip));
					} finally {
						setGeometryKernel(previous);
					}
				}
	}
	assert.deepEqual(sketch.takeSnapshot(), original);
});

test('offset adapter permits repeated sources only for independent closed spline components', () => {
	const item = {
		sourceId: 'spline',
		kind: 'spline' as const,
		curve: {
			id: 'spline',
			type: 'spline' as const,
			isClosed: true,
			bezierSegments: [
				[
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 0, y: 1 },
					{ x: 0, y: 0 },
				],
			] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }][],
		},
	};
	const record = [0, 0, 3, 13, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0];
	const second = [...record];
	second[1] = 1;
	const buffer = [0, 0, 0, 1, 0, 1, 0, -1, 10, 2, ...record, ...second];
	const kernel = (data: number[]) => createWasmOffsetKernel(() => new Float64Array(data));
	assert.equal(kernel(buffer).calculate([item], true, 0, 'one_side', -10, 0, false).sides[0].primitives.length, 2);
	assert.throws(() => kernel(buffer).calculate([item], false, 0, 'one_side', -10, 0, false), /WASM offset result/);
	const open = [...buffer];
	open[15] = 0;
	assert.throws(() => kernel(open).calculate([item], true, 0, 'one_side', -10, 0, false), /WASM offset result/);
});

for (const kind of ['lines', 'arcs', 'mixed', 'arc-neck'] as const)
	test(`mixed closed offsets retain every component and match native arithmetic: ${kind}`, () => {
		const previous = getGeometryKernel();
		for (const reversed of [false, true])
			for (const rotation of [0, 3, 8]) {
				const { sketch, chain } = mixedOffsetScene(kind, reversed, rotation);
				const before = sketch.takeSnapshot();
				for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
					for (const flip of [false, true])
						for (const distance of [-4, -0.1, 0, 0.1, 4]) {
							const actual = calculateOffsetGeometry(sketch, chain, direction, distance, 4, flip);
							assert.ok(actual.isValid);
							for (const side of actual.sides) {
								const groups = offsetContourGroups(side.primitives);
								assert.equal(
									groups.length,
									side.side < 0 && side.distance === 4 ? 2 : 1,
									`${kind}, reversed=${reversed}, rotation=${rotation}, ${direction}, d=${distance}, flip=${flip}`
								);
								for (const p of side.primitives)
									if (p.type === 'arc') {
										assert.ok(Math.abs(p.start!.distanceTo(p.center!) - p.radius!) < 1e-7);
										assert.ok(Math.abs(p.end!.distanceTo(p.center!) - p.radius!) < 1e-7);
									}
							}
							try {
								setGeometryKernel(typescriptGeometryKernel);
								compare(actual, calculateOffsetGeometry(sketch, chain, direction, distance, 4, flip));
							} finally {
								setGeometryKernel(previous);
							}
						}
				assert.deepEqual(sketch.takeSnapshot(), before);
			}
	});

test('closed offsets preserve three disconnected components', () => {
	const sketch = new SketchDocument();
	const vertices = [
		[-50, -15],
		[-30, -15],
		[-30, -3],
		[-10, -3],
		[-10, -15],
		[10, -15],
		[10, -3],
		[30, -3],
		[30, -15],
		[50, -15],
		[50, 15],
		[30, 15],
		[30, 3],
		[10, 3],
		[10, 15],
		[-10, 15],
		[-10, 3],
		[-30, 3],
		[-30, 15],
		[-50, 15],
	];
	const chain: OffsetChain = { items: [], isClosed: true };
	sketch.withDeferredSolve(() => {
		const points = vertices.map(([x, y]) => sketch.addPoint(new Vec2(x, y)));
		for (let i = 0; i < points.length; i++) {
			const a = points[i],
				b = points[(i + 1) % points.length],
				line = sketch.addLine(a.id, b.id);
			chain.items.push({ id: line.id, type: 'line', startPointId: a.id, endPointId: b.id });
		}
	});
	const result = calculateOffsetGeometry(sketch, chain, 'one_side', -4, 0, false);
	const groups = offsetContourGroups(result.sides[0].primitives);
	assert.equal(groups.length, 3);
	assert.deepEqual(
		groups.map(g => g[0].contourIndex ?? 0),
		[0, 1, 2]
	);
	assert.deepEqual(
		groups.map(g => [Math.min(...g.map(p => p.p1!.x)), Math.max(...g.map(p => p.p1!.x))]),
		[
			[-46, -34],
			[-6, 6],
			[34, 46],
		]
	);
});

test('offset adapter rejects malformed component numbers, order, sources and closure', () => {
	const items = Array.from({ length: 3 }, (_, i) => ({
		sourceId: `line-${i}`,
		kind: 'line' as const,
		curve: { id: `line-${i}`, type: 'segment' as const, p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } },
	}));
	const records = (contour: number, x: number) =>
		[
			[x, 0, x + 1, 0],
			[x + 1, 0, x, 1],
			[x, 1, x, 0],
		].flatMap((points, source) => [source, contour, 0, 4, ...points]);
	const data = [0, 0, 0, 1, 0, 1, 0, -1, 4, 6, ...records(0, 0), ...records(1, 10)];
	const query = (buffer: number[]) =>
		createWasmOffsetKernel(() => new Float64Array(buffer)).calculate(items, true, 0, 'one_side', -4, 0, false);
	assert.equal(query(data).sides[0].primitives.length, 6);
	for (const [index, value] of [
		[11, -1],
		[11, 1],
		[11, 0.5],
		[35, 2],
		[43, 0],
		[42, 0],
		[18, 0],
		[14, 0.25],
	]) {
		const bad = [...data];
		bad[index] = value;
		assert.throws(() => query(bad), /WASM offset result/, `index ${index} = ${value}`);
	}
});

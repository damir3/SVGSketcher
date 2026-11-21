import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmOffsetKernel } from '../src/kernel/offsetWasm';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateOffsetGeometry,
	toggleOrExtendChain,
	type OffsetChain,
	type OffsetDirection,
	type OffsetSideGeometry,
} from '../src/math/offset';
import { Vec2 } from '../src/math/vector';
import { mixedOffsetScene, offsetContourGroups, roundedOffsetScene } from './helpers/mixedOffsetScene';
import { collapseKinds, collapseOffsetScene } from './helpers/collapseOffsetScene';

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
for (const scene of fixture.scenes)
	test(`offset parity: ${scene.name}`, () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		sketch.clearHistory();
		const before = sketch.takeSnapshot(),
			chainBefore = JSON.stringify(scene.chain);
		const upgradedBehavior =
			scene.chain?.isClosed ||
			scene.chain?.items.some(
				item => item.type === 'spline' || item.type === 'elliptical_arc' || item.type === 'ellipse'
			);
		for (const q of scene.queries) {
			const result = calculateOffsetGeometry(sketch, scene.chain, q.direction, q.d1, q.d2, q.flip);
			const target = expected(scene, q);
			if (!upgradedBehavior) {
				compare(result, target, `${scene.name} ${q.direction} d=${q.d1} flip=${q.flip}`);
			} else {
				compare(result.gizmoAnchor, target.gizmoAnchor, `${scene.name} gizmoAnchor`);
				compare(result.gizmoNormal, target.gizmoNormal, `${scene.name} gizmoNormal`);
				assert.equal(result.sides.length, target.sides.length, `${scene.name} side count`);
				for (let i = 0; i < result.sides.length; i++) {
					assert.ok(result.sides[i].side === 1 || result.sides[i].side === -1);
					if (result.sides[i].isValid) assert.ok(result.sides[i].distance >= 0);
				}
			}
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
	const result = calculateOffsetGeometry(sketch, chain, 'two_sides', 2, 3, false);
	assert.equal(result.isValid, true);
	assert.equal(result.sides.length, 2);
	compare(result.sides[0].primitives[0].p1, { x: 0, y: 2 });
	compare(result.sides[0].primitives[0].p2, { x: 10, y: 2 });
	compare(result.sides[1].primitives[0].p1, { x: 0, y: -3 });
	compare(result.sides[1].primitives[0].p2, { x: 10, y: -3 });
});

test('mixed spline/arc/ellipse offset junctions produce valid contours in either traversal direction', () => {
	const scene = JSON.parse(
		readFileSync(new URL('./fixtures/offset-test.svg', import.meta.url), 'utf8').match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]
	);
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
		for (const direction of ['one_side', 'two_sides', 'symmetric'] as const) {
			const distances = direction === 'one_side' ? [0, 3, 6.5, 10, 15.5, 20] : [3, 15.5];
			for (const flip of [false, true])
				for (const distance of distances) {
					if (distance === 0 && (direction !== 'two_sides' || flip)) continue;
					const actual = calculateOffsetGeometry(sketch, chain, direction, distance, 5, flip);
					assert.ok(actual.isValid, `${selected}, ${direction}, flip=${flip}, d=${distance}`);
					for (const side of actual.sides) {
						for (const p of side.primitives)
							if (p.type === 'arc') {
								assert.ok(Math.abs(p.start!.distanceTo(p.center!) - p.radius!) < 1e-7);
								assert.ok(Math.abs(p.end!.distanceTo(p.center!) - p.radius!) < 1e-7);
							}
					}
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

test('closed spline offsets preserve both eroded components', () => {
	const scene = JSON.parse(
		readFileSync(new URL('./fixtures/spline-internal-offset.svg', import.meta.url), 'utf8').match(
			/<!\[CDATA\[([\s\S]*?)\]\]>/
		)![1]
	);
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(scene.snapshot);
	const original = sketch.takeSnapshot();
	for (const reversed of [false, true]) {
		const chain = toggleOrExtendChain(sketch, null, 'Spline-1', 'spline', true)!;
		chain.items[0].reversed = reversed;
		for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
			for (const flip of [false, true]) {
				const distances =
					direction === 'one_side'
						? flip
							? [-8, 0, 8]
							: [-15, -10, -8, -7.7501, -5, 0, 5, 7.7501, 8, 10, 15]
						: [-8, 8];
				for (const distance of distances) {
					const actual = calculateOffsetGeometry(sketch, chain, direction, distance, 10, flip);
					assert.ok(actual.isValid);
					for (const side of actual.sides) {
						const expectedCount = side.side < 0 && side.distance >= 7.7501 ? 2 : 1;
						assert.equal(side.primitives.length, expectedCount, `${direction}, d=${distance}, flip=${flip}`);
						assert.ok(side.primitives.every(p => p.sourceId === 'Spline-1' && p.isSplineClosed));
					}
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
	test(`mixed closed offsets retain every component: ${kind}`, () => {
		for (const reversed of [false, true])
			for (const rotation of [0, 3, 8]) {
				const { sketch, chain } = mixedOffsetScene(kind, reversed, rotation);
				const before = sketch.takeSnapshot();
				for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
					for (const flip of [false, true]) {
						const distances = direction === 'one_side' ? (flip ? [-4, 4] : [-4, -0.1, 0, 0.1, 4]) : [-4, 4];
						for (const distance of distances) {
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

for (const kind of collapseKinds)
	test(`fully eroded closed offset is empty: ${kind}`, () => {
		const { sketch, chain, small, empty } = collapseOffsetScene(kind),
			before = sketch.takeSnapshot();
		for (const distance of [small, empty, empty * 1.1, empty * 5])
			for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
				for (const flip of [false, true]) {
					const actual = calculateOffsetGeometry(sketch, chain, direction, -distance, distance, flip);
					assert.ok(actual.isValid, `${kind} ${distance} ${direction} flip=${flip}`);
					for (const side of actual.sides) {
						assert.equal(side.primitives.length === 0, side.side < 0 && side.distance >= empty);
						assert.ok(side.distance >= 0);
					}
				}
		assert.deepEqual(sketch.takeSnapshot(), before);
	});

test('offset adapter accepts empty inward sides only on a closed chain', () => {
	const item = {
		sourceId: 'circle',
		kind: 'circle' as const,
		curve: { id: 'circle', type: 'circle' as const, center: { x: 0, y: 0 }, radius: 5 },
	};
	const data = [0, 5, 0, 1, 0, 1, 0, -1, 5, 0];
	const query = (buffer: number[], closed = true) =>
		createWasmOffsetKernel(() => new Float64Array(buffer)).calculate([item], closed, 0, 'one_side', -5, 0, false);
	assert.deepEqual(query(data).sides[0].primitives, []);
	assert.ok(query(data).isValid);
	assert.throws(() => query(data, false), /WASM offset result/);
	for (const [i, value] of [
		[7, 1],
		[8, -5],
		[8, 0],
		[6, 2],
	]) {
		const bad = [...data];
		bad[i] = value;
		assert.throws(() => query(bad), /WASM offset result/);
	}
});

for (const reversed of [false, true])
	for (const rotation of [0, 1, 4])
		test(`consumed circular fillets leave the expected rectangle: reversed=${reversed}, seam=${rotation}`, () => {
			const { sketch, chain } = roundedOffsetScene(reversed, rotation);
			for (const distance of [1, 1.001, 2, 4.9]) {
				const actual = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
				assert.ok(actual.isValid);
				assert.equal(actual.sides[0].primitives.length, 4);
				const expected = [
					[distance, distance],
					[20 - distance, distance],
					[20 - distance, 10 - distance],
					[distance, 10 - distance],
				];
				for (const p of actual.sides[0].primitives) {
					assert.equal(p.type, 'line');
					assert.ok(expected.some(([x, y]) => Math.hypot(p.p1!.x - x, p.p1!.y - y) < 1e-8));
				}
			}
		});

for (const kind of ['mixed', 'arc-neck'] as const)
	for (const reversed of [false, true])
		test(`mixed offsets survive consumed end arcs: ${kind}, reversed=${reversed}`, () => {
			const { sketch, chain } = mixedOffsetScene(kind, reversed, 5);
			for (const distance of [15, 15.001, 15.1, 15.2]) {
				const actual = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
				assert.ok(actual.isValid, `d=${distance}`);
				assert.equal(offsetContourGroups(actual.sides[0].primitives).length, kind === 'mixed' ? 2 : 1);
				assert.ok(actual.sides[0].primitives.every(p => p.type !== 'arc'));
			}
		});

test('offsets retain small analytic radii down to the solver bound', () => {
	const { sketch, chain } = collapseOffsetScene('circle');
	const rounded = roundedOffsetScene(),
		arcChain: OffsetChain = { isClosed: false, items: rounded.chain.items.filter(i => i.type === 'arc') };
	for (const radius of [0.1, 0.05, 0.01]) {
		for (const [doc, selected, d] of [
			[sketch, chain, 5 - radius],
			[rounded.sketch, arcChain, 1 - radius],
		] as const) {
			const actual = calculateOffsetGeometry(doc, selected, 'one_side', d, 0, doc === sketch);
			assert.ok(actual.isValid);
			const p = actual.sides[0].primitives[0];
			assert.ok(Math.abs((p.radius ?? p.circleRadius!) - radius) < 1e-12);
		}
	}
	assert.equal(calculateOffsetGeometry(rounded.sketch, arcChain, 'one_side', 0.995, 0, false).isValid, false);
});

for (const reversed of [false, true])
	test(`a consumed arc retains a curved neighboring join: reversed=${reversed}`, () => {
		const { sketch, chain } = roundedOffsetScene(reversed, 2, 'arc');
		for (const distance of [1, 1.1, 2]) {
			const actual = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
			assert.ok(actual.isValid);
			assert.ok(actual.sides[0].primitives.some(p => p.sourceId === 'Arc-2' && p.type === 'spline'));
		}
	});

test('partial arc consumption preserves the opposite side in all offset modes', () => {
	const { sketch, chain } = mixedOffsetScene('mixed');
	for (const [direction, d1, d2, flip] of [
		['one_side', -15, 0, false],
		['one_side', 15, 0, true],
		['two_sides', 0.1, 15, false],
		['two_sides', 15, 0.1, true],
		['symmetric', 15, 0, false],
		['symmetric', 15, 0, true],
	] as const) {
		const result = calculateOffsetGeometry(sketch, chain, direction, d1, d2, flip);
		assert.ok(result.isValid);
		const inner = result.sides.find(s => s.side < 0)!;
		assert.equal(offsetContourGroups(inner.primitives).length, 2);
	}
});

for (const reversed of [false, true])
	test(`adjacent consumed arcs keep their common circular contact: reversed=${reversed}`, () => {
		const { sketch, chain } = roundedOffsetScene(reversed, 0, 'consumed-arc');
		for (const distance of [1, 1.1, 2]) {
			const result = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
			assert.ok(result.isValid);
			assert.equal(offsetContourGroups(result.sides[0].primitives).length, 1);
			if (distance < 2)
				assert.ok(result.sides[0].primitives.some(p => p.type === 'spline' && sketch.arcs.has(p.sourceId)));
		}
	});

test('six-lobed flower inward offset bridges diverging cusp corners with rolling-ball arcs', () => {
	const sketch = new SketchDocument();
	const ringRadius = 50;
	const lobeRadius = 2 * ringRadius * Math.sin(Math.PI / 12);
	const cuspIds: string[] = [];
	const cusps: Vec2[] = [];
	for (let i = 0; i < 6; i++) {
		const centerAngle = Math.PI / 2 - (i * Math.PI) / 3;
		const cuspAngle = centerAngle + Math.PI / 6;
		const cusp = new Vec2(ringRadius * Math.cos(cuspAngle), ringRadius * Math.sin(cuspAngle));
		cusps.push(cusp);
		cuspIds.push(sketch.addPoint(cusp).id);
	}
	const arcIds: string[] = [];
	sketch.withDeferredSolve(() => {
		for (let i = 0; i < 6; i++) {
			const centerAngle = Math.PI / 2 - (i * Math.PI) / 3;
			const centerId = sketch.addPoint(
				new Vec2(ringRadius * Math.cos(centerAngle), ringRadius * Math.sin(centerAngle))
			).id;
			arcIds.push(sketch.addArc(centerId, cuspIds[i], cuspIds[(i + 1) % 6], lobeRadius, true).id);
		}
	});
	const chain = toggleOrExtendChain(sketch, null, arcIds[0], 'arc', true)!;
	assert.equal(chain.items.length, 6);
	assert.equal(chain.isClosed, true);

	const outward = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 0, false);
	assert.ok(outward.isValid);
	assert.equal(outward.sides[0].primitives.length, 6);
	assert.ok(outward.sides[0].primitives.every(p => p.type === 'arc' && Math.abs(p.radius! - (lobeRadius + 10)) < 1e-8));

	for (const distance of [5, 10, 15, 20]) {
		const inward = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
		assert.ok(inward.isValid);
		assert.equal(offsetContourGroups(inward.sides[0].primitives).length, 1);
		assert.equal(inward.sides[0].primitives.length, 6);
		// Every rolling-ball corner touches radius (50 - distance) directly inward from its cusp.
		for (const prim of inward.sides[0].primitives) {
			assert.equal(prim.type, 'spline');
			const maxDist = Math.max(...prim.fitPoints!.map(pt => pt.length()));
			assert.ok(maxDist <= ringRadius + lobeRadius - distance + 0.06);
		}
		const radialMin = Math.min(
			...inward.sides[0].primitives.flatMap(p =>
				(p.fitPoints ?? []).flatMap((pt, idx) => {
					if (idx + 1 >= p.fitPoints!.length) return [pt.length()];
					const p0 = pt,
						p1 = p.handles![idx].h2,
						p2 = p.handles![idx + 1].h1,
						p3 = p.fitPoints![idx + 1];
					return Array.from({ length: 16 }, (_, step) => {
						const t = step / 16;
						const mt = 1 - t;
						return Math.hypot(
							mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
							mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
						);
					});
				})
			)
		);
		assert.ok(Math.abs(radialMin - (ringRadius - distance)) < 0.15);
	}

	for (const distance of [0.5, 26]) {
		const inward = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
		assert.ok(inward.isValid);
		assert.equal(offsetContourGroups(inward.sides[0].primitives).length, 1);
		for (const p of inward.sides[0].primitives) assert.equal(p.type, 'spline');
	}
});

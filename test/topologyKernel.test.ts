import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmTopologyKernel } from '../src/kernel/topologyWasm';
import type { TopologyInput } from '../src/kernel/topologyTypes';
import { SketchDocument } from '../src/model/sketch';
import { CoincidentConstraint } from '../src/solver/constraints';
import * as reference from '../src/math/offsetTopologyReference';
import {
	getCoincidentPointGroup,
	calculateOffsetGeometry,
	getConnectedPrimitivesAtVertex,
	toggleOrExtendChain,
	getValidChainContinuations,
	deselectChainSegment,
	type OffsetChain,
} from '../src/math/offset';
import { createOffsetTopology } from '../src/math/offsetTopology';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelTopology.json', import.meta.url), 'utf8'));
const native = !!getGeometryKernel().topology;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('topology fixture identifies the independent pre-native traversal source', () => {
	assert.equal(
		createHash('sha256')
			.update(readFileSync(new URL('../src/math/offsetTopologyReference.ts', import.meta.url)))
			.digest('hex'),
		fixture.sourceSha256
	);
});
for (const scene of fixture.cases)
	test(`topology retains ordered groups, neighbors and chain actions: ${scene.name}`, () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		const before = plain(sketch.takeSnapshot());
		const prepared = createOffsetTopology(
			sketch,
			scene.queries.map(q => q.root)
		);
		for (const q of scene.queries) {
			assert.deepEqual([...getCoincidentPointGroup(sketch, q.root)], q.group, `group ${q.root}`);
			assert.deepEqual(getConnectedPrimitivesAtVertex(sketch, q.root), q.connections, `neighbors ${q.root}`);
			assert.deepEqual(getConnectedPrimitivesAtVertex(sketch, q.root, scene.primitives[0]?.id), q.excluded);
			assert.deepEqual([...prepared.group(q.root)].sort(), [...q.group].sort(), `prepared group ${q.root}`);
			assert.deepEqual(prepared.connected(q.root), q.connections);
		}
		for (const click of scene.clicks) {
			const chain = toggleOrExtendChain(sketch, null, click.id, click.type, click.chainSelection);
			assert.deepEqual(plain(chain), click.chain);
			assert.deepEqual([...getValidChainContinuations(sketch, chain)], click.continuations);
			assert.deepEqual(
				plain(chain && deselectChainSegment(sketch, chain, click.id, click.chainSelection)),
				click.deselected
			);
		}
		let chain: OffsetChain | null = null;
		for (const click of scene.sequence) {
			chain = toggleOrExtendChain(sketch, chain, click.id, click.type, click.chainSelection);
			assert.deepEqual(plain(chain), click.chain);
			assert.deepEqual([...getValidChainContinuations(sketch, chain)], click.continuations);
		}
		assert.deepEqual(plain(sketch.takeSnapshot()), before, 'topology queries must not mutate the document');
	});

test('chain traversal packs once per action without per-vertex WASM callbacks', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js');
	const sketch = new SketchDocument();
	const scene = fixture.cases.find(c => c.name === 'open/forward');
	sketch.restoreSnapshot(scene.snapshot);
	const previous = getGeometryKernel(),
		modes: number[] = [];
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				topology_queries(...args) {
					modes.push(args[3][0]);
					return bindings.topology_queries(...args);
				},
			})
		);
		getCoincidentPointGroup(sketch, scene.queries[0].root);
		assert.deepEqual(modes.splice(0), [0]);
		getConnectedPrimitivesAtVertex(sketch, scene.queries[0].root);
		assert.deepEqual(modes.splice(0), [1]);
		const chain = toggleOrExtendChain(sketch, null, scene.primitives[0].id, 'line', true)!;
		assert.ok(chain.items.length > 1);
		assert.deepEqual(modes.splice(0), [1]);
		deselectChainSegment(sketch, chain, chain.items[0].id, true);
		assert.deepEqual(modes.splice(0), [1]);
		const single = toggleOrExtendChain(sketch, null, scene.primitives[0].id, 'line', false);
		assert.deepEqual(modes.splice(0), []);
		getValidChainContinuations(sketch, single);
		assert.deepEqual(modes.splice(0), [1]);
	} finally {
		setGeometryKernel(previous);
	}
});

test('topology snapshots refresh after coordinate, constraint and history changes', { skip: !native }, () => {
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture.cases.find(c => c.name === 'open/forward').snapshot);
	sketch.clearHistory();
	const a = [...sketch.points.values()][0],
		b = [...sketch.points.values()][1];
	assert.ok(!getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.beginTransaction();
	b.x = a.x;
	b.y = a.y;
	sketch.commitTransaction();
	assert.ok(getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.undo();
	assert.ok(!getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.redo();
	assert.ok(getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.undo();
	sketch.beginTransaction();
	sketch.constraints.set('test-coincident', new CoincidentConstraint('test-coincident', a.id, b.id));
	sketch.commitTransaction();
	assert.ok(getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.undo();
	assert.ok(!getCoincidentPointGroup(sketch, a.id).has(b.id));
	sketch.redo();
	assert.ok(getCoincidentPointGroup(sketch, a.id).has(b.id));
});

test('spatial components match the independent traversal on seeded mixed coincidence graphs', { skip: !native }, () => {
	let seed = 0x8a3294;
	const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
	for (let scene = 0; scene < 32; scene++) {
		const sketch = new SketchDocument();
		sketch.beginTransaction();
		const points = Array.from({ length: 12 }, (_, i) => {
			const angle = random() * Math.PI * 2,
				radius = random() * 0.002;
			return sketch.addPoint({ x: (i % 3) + Math.cos(angle) * radius, y: Math.sin(angle) * radius }, true);
		});
		for (let i = 1; i < points.length; i++) sketch.addLine(points[i - 1].id, points[i].id);
		for (const [a, b] of [
			[points[0].id, 'ghost-a'],
			['ghost-a', points[7].id],
			['axis_x', 'ghost-b'],
			['ghost-b', points[4].id],
		]) {
			const id = `link-${sketch.constraints.size}`;
			sketch.constraints.set(id, new CoincidentConstraint(id, a, b));
		}
		sketch.commitTransaction();
		const roots = [...points.map(p => p.id), 'origin', 'axis_x', 'axis_y', 'ghost-a', 'ghost-b', 'unknown'];
		const topology = createOffsetTopology(sketch, roots);
		for (const root of roots) {
			const expected = reference.getCoincidentPointGroup(sketch, root);
			assert.deepEqual([...getCoincidentPointGroup(sketch, root)], [...expected]);
			assert.deepEqual([...topology.group(root)].sort(), [...expected].sort());
			assert.deepEqual(topology.connected(root), reference.getConnectedPrimitivesAtVertex(sketch, root));
		}
	}
});

test('offset spline direction checks share one topology snapshot', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	const sketch = new SketchDocument();
	sketch.beginTransaction();
	const points = [0, 1, 2, 3, 4].map(i => sketch.addPoint({ x: i * 10, y: i % 2 }, true));
	const a = sketch.addControlSpline(points.slice(0, 3).map(p => p.id));
	const b = sketch.addControlSpline(points.slice(2).map(p => p.id));
	sketch.commitTransaction();
	let calls = 0;
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				topology_queries(...args) {
					calls++;
					return bindings.topology_queries(...args);
				},
			})
		);
		const chain: OffsetChain = {
			items: [a, b].map(s => ({
				id: s.id,
				type: 'spline',
				startPointId: s.pointIds[0],
				endPointId: s.pointIds.at(-1),
			})),
			isClosed: false,
		};
		assert.ok(calculateOffsetGeometry(sketch, chain, 'one_side', 1, 1, false).isValid);
		assert.equal(calls, 1);
	} finally {
		setGeometryKernel(previous);
	}
});

test('topology keeps legacy invalid-coordinate behavior and reports native failures', { skip: !native }, () => {
	const previous = getGeometryKernel(),
		sketch = new SketchDocument();
	const point = sketch.addPoint({ x: 10, y: 10 }, true);
	point.x = NaN;
	try {
		setGeometryKernel({
			...previous,
			topology: {
				group() {
					throw new Error('native topology failure');
				},
				prepare() {
					throw new Error('native topology failure');
				},
			},
		});
		assert.deepEqual([...getCoincidentPointGroup(sketch, point.id)], [point.id]);
		assert.deepEqual(getConnectedPrimitivesAtVertex(sketch, point.id), []);
		point.x = 10;
		assert.throws(() => getCoincidentPointGroup(sketch, point.id), /native topology failure/);
		assert.throws(() => getConnectedPrimitivesAtVertex(sketch, point.id), /native topology failure/);
	} finally {
		setGeometryKernel(previous);
	}
});

const input: TopologyInput = {
	points: [
		{ position: { x: 10, y: 0 }, listed: true },
		{ position: { x: 20, y: 0 }, listed: true },
	],
	links: [],
	endpoints: [[0, 1]],
	origin: -1,
};
test('topology adapters reject malformed indices, members, labels and connection records', () => {
	for (const result of [[], [0], [1, 2], [1, 1], [2, 0, 0], [1, 0, 0], [NaN]])
		assert.throws(
			() => createWasmTopologyKernel(() => new Float64Array(result)).group(input, 0, 0.001),
			/WASM topology/
		);
	const valid = [2, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0];
	assert.equal(createWasmTopologyKernel(() => new Float64Array(valid)).prepare(input, 0.001).groups.length, 2);
	for (const result of [
		[],
		[0],
		[...valid, 0],
		valid.map((v, i) => (i === 1 ? 2 : v)),
		valid.map((v, i) => (i === 7 ? 1 : v)),
		valid.map((v, i) => (i === 3 ? 0 : v)),
		valid.map((v, i) => (i === 4 ? Infinity : v)),
	])
		assert.throws(
			() => createWasmTopologyKernel(() => new Float64Array(result)).prepare(input, 0.001),
			/WASM topology/
		);
	assert.throws(
		() =>
			createWasmTopologyKernel(() => {
				throw new Error('native topology failure');
			}).prepare(input, 0.001),
		/native topology failure/
	);
});

test('compiled topology boundary rejects malformed buffers and settings', { skip: !native }, async () => {
	const { topology_queries: query } = await import('../public/kernel/sketcher_wasm.js');
	const points = new Float64Array([1, 1, 10, 0]),
		empty = new Float64Array();
	for (const settings of [
		[1, 0.001, -1, -1, 0],
		[1, 0, -1, -1],
		[2, 0.001, -1, -1],
		[1, 0.001, 1, -1],
		[0, 0.001, -1, 0.5],
		[1, NaN, -1, -1],
	])
		assert.throws(() => query(points, empty, empty, new Float64Array(settings)), /topology/);
	const settings = new Float64Array([1, 0.001, -1, -1]);
	for (const bad of [[0], [0, 1, 0, 0], [1, 2, 0, 0], [1, 1, Infinity, 0]])
		assert.throws(() => query(new Float64Array(bad), empty, empty, settings), /topology/);
	assert.throws(() => query(points, new Float64Array([0, 1]), empty, settings), /topology/);
	assert.throws(() => query(points, empty, new Float64Array([0]), settings), /topology/);
});

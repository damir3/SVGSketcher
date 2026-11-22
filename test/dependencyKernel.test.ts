import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel } from '../src/kernel';
import { createWasmDependency } from '../src/kernel/dependencyWasm';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelDependency.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().dependency;
const hydrate = (input: any) => ({
	...input,
	values: new Float64Array(input.values),
	nativeConstraints: new Float64Array(input.nativeConstraints),
});
const plain = (input: unknown) =>
	JSON.parse(JSON.stringify(input, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as any) : v)));

for (const f of fixture.cases)
	test(`native dependency preserves sparse rank decision: ${f.name}`, { skip: !native }, () => {
		const input = hydrate(f.input),
			before = plain(input);
		assert.equal(native!(input), f.expected);
		assert.deepEqual(plain(input), before);
	});
test('dependency adapter rejects malformed outputs and propagates native errors', () => {
	const input = hydrate(fixture.cases[0].input);
	for (const output of [[], [2], [NaN], [1, 0]])
		assert.throws(() => createWasmDependency(() => new Float64Array(output))(input));
	assert.throws(
		() =>
			createWasmDependency(() => {
				throw new Error('native failure');
			})(input),
		/native failure/
	);
});
test('native dependency decoder rejects malformed policies and incomplete programs', { skip: !native }, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (values: number[], data: number[], policies: number[], settings: number[]) =>
		wasm.constraint_dependency(
			new Float64Array(values),
			new Float64Array(data),
			new Float64Array(policies),
			new Float64Array(settings)
		);
	for (const args of [
		[[], [], [], []],
		[[0], [], [], [0, 1e20, 0, 0]],
		[[NaN], [], [], [0, 0, 0, 0]],
		[[0], [], [1, 0, 1], [0, 1, 1, 0]],
		[[0], [], [], [0, 1, 1, 0]],
		[[0], [], [0, 0, 0], [0, 0, 1, 0]],
		[[0], [], [], [0, 0, 2, 0]],
	] as [number[], number[], number[], number[]][])
		assert.throws(() => call(...args));
});

test('document dependency analysis detects dependent dimensions and restores locks without editing geometry', async () => {
	const { SketchDocument } = await import('../src/model/sketch');
	const { SketchPoint } = await import('../src/model/primitives/point');
	const { SketchCircle } = await import('../src/model/primitives/circle');
	const { DistanceConstraint, HorizontalConstraint, PointOnCircleConstraint, RadiusConstraint } = await import(
		'../src/solver/constraints'
	);
	const { isDependentDimension: actual } = await import('../src/solver/constraintDependency');
	for (const dependent of [false, true]) {
		const sketch = new SketchDocument();
		sketch.points.set('a', new SketchPoint('a', 0, 0, true));
		sketch.points.set('b', new SketchPoint('b', 10, 0));
		sketch.constraints.set('h', new HorizontalConstraint('h', 'a', 'b'));
		if (dependent) sketch.constraints.set('d', new DistanceConstraint('d', 'a', 'b', 10));
		sketch.rebuildParamManager();
		sketch.paramManager.prepare(new Set(['b.x']));
		const candidate = new DistanceConstraint('candidate', 'a', 'b', 50);
		const before = sketch.takeSnapshot(),
			free = [...sketch.paramManager.getIndices()],
			state = [...sketch.paramManager.getCurrentValues()];
		assert.equal(actual(sketch.paramManager, sketch.constraints.values(), candidate, sketch), dependent);
		assert.deepEqual([...sketch.paramManager.getIndices()], free);
		assert.deepEqual([...sketch.paramManager.getCurrentValues()], state);
		assert.deepEqual(sketch.takeSnapshot(), before);
		assert.equal(candidate.targetDistance, 50);
	}
	const sketch = new SketchDocument();
	sketch.points.set('center', new SketchPoint('center', 0, 0, true));
	sketch.points.set('edge', new SketchPoint('edge', 10, 0, true));
	sketch.circles.set('circle', new SketchCircle({ id: 'circle', centerId: 'center', radius: 10 }));
	sketch.constraints.set('on', new PointOnCircleConstraint('on', 'edge', 'center', 'circle'));
	sketch.rebuildParamManager();
	const candidate = new RadiusConstraint('candidate', 'circle', 50);
	assert.equal(actual(sketch.paramManager, sketch.constraints.values(), candidate, sketch), true);
	assert.equal(candidate.targetRadius, 50);
	const expectedByFixture: Record<string, Record<string, boolean>> = {
		'offset-pattern-line11': {
			'Line-1': true,
			'Line-2': true,
			'Line-3': true,
			'Line-4': true,
			'Line-5': true,
			'Line-6': true,
			'Line-7': true,
			'Line-8': true,
			'Line-9': true,
			'Line-10': true,
			'Line-11': true,
			'Line-12': true,
		},
		'offset-rectangle-reference-distance': {
			'Line-1': false,
			'Line-2': false,
			'Line-3': false,
			'Line-4': false,
			'Line-5': true,
			'Line-6': true,
			'Line-7': true,
			'Line-8': true,
		},
		'triangle-reference-angle': {
			'Line-7': false,
			'Line-8': false,
			'Line-9': false,
		},
	};
	for (const [file, expectedMap] of Object.entries(expectedByFixture)) {
		const doc = new SketchDocument();
		doc.restoreSnapshot(JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`, import.meta.url), 'utf8')));
		const snapshot = doc.takeSnapshot();
		const observed: Record<string, boolean> = {};
		for (const line of doc.lines.values()) {
			if (line.isConstruction || line.isSplineHandle) continue;
			const dim = new DistanceConstraint('candidate', line.p1Id, line.p2Id, 50);
			observed[line.id] = actual(doc.paramManager, doc.constraints.values(), dim, doc);
		}
		assert.deepEqual(observed, expectedMap, file);
		assert.deepEqual(doc.takeSnapshot(), snapshot);
	}
});

test('built-in dependency analysis uses one WASM call and no JS Jacobian callbacks', { skip: !native }, async () => {
	const { getGeometryKernel, setGeometryKernel } = await import('../src/kernel');
	const { SketchDocument } = await import('../src/model/sketch');
	const { SketchPoint } = await import('../src/model/primitives/point');
	const { DistanceConstraint, HorizontalConstraint } = await import('../src/solver/constraints');
	const { isDependentDimension } = await import('../src/solver/constraintDependency');
	const sketch = new SketchDocument();
	sketch.points.set('a', new SketchPoint('a', 0, 0, true));
	sketch.points.set('b', new SketchPoint('b', 10, 0));
	sketch.rebuildParamManager();
	const cs = [new HorizontalConstraint('h', 'a', 'b'), new DistanceConstraint('d', 'a', 'b', 10)];
	const measurement = new DistanceConstraint('candidate', 'a', 'b', 50);
	const previous = getGeometryKernel();
	let calls = 0;
	try {
		setGeometryKernel({
			...previous,
			dependency(input) {
				calls++;
				for (const c of cs)
					c.evaluate = c.jacobian = () => {
						throw new Error('unexpected JS equation callback');
					};
				return native!(input);
			},
		});
		assert.equal(isDependentDimension(sketch.paramManager, cs, measurement, sketch), true);
		assert.equal(calls, 1);
	} finally {
		for (const c of cs) {
			delete (c as any).evaluate;
			delete (c as any).jacobian;
		}
		setGeometryKernel(previous);
	}
});

test('native failure restores parameter locks', async () => {
	const { setGeometryKernel } = await import('../src/kernel');
	const previous = getGeometryKernel();
	const { SketchDocument } = await import('../src/model/sketch');
	const { SketchPoint } = await import('../src/model/primitives/point');
	const { DistanceConstraint } = await import('../src/solver/constraints');
	const { isDependentDimension } = await import('../src/solver/constraintDependency');
	const sketch = new SketchDocument();
	sketch.points.set('a', new SketchPoint('a', 0, 0, true));
	sketch.points.set('b', new SketchPoint('b', 10, 0));
	sketch.rebuildParamManager();
	sketch.paramManager.prepare(new Set(['b.x']));
	const locked = [...sketch.paramManager.getIndices()];
	const constraint = new DistanceConstraint('d', 'a', 'b', 10),
		candidate = new DistanceConstraint('candidate', 'a', 'b', 50);
	try {
		setGeometryKernel({
			...previous,
			dependency() {
				throw new Error('native failure');
			},
		});
		assert.throws(() => isDependentDimension(sketch.paramManager, [constraint], candidate, sketch), /native failure/);
		assert.deepEqual([...sketch.paramManager.getIndices()], locked);
	} finally {
		setGeometryKernel(previous);
	}
});

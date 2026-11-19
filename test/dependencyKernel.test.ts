import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel } from '../src/kernel';
import { createWasmDependency } from '../src/kernel/dependencyWasm';
import { dependencyCases } from './helpers/dependencyCases';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelDependency.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().dependency;
const hydrate = (input: any) => ({
	...input,
	values: new Float64Array(input.values),
	nativeConstraints: new Float64Array(input.nativeConstraints),
});
const plain = (input: unknown) =>
	JSON.parse(JSON.stringify(input, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as any) : v)));

test('dependency fixtures identify the independent pre-migration arithmetic', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL('../' + file, import.meta.url)))
				.digest('hex'),
			hash
		);
});
for (const f of fixture.cases)
	test(`native dependency preserves sparse rank decision: ${f.name}`, { skip: !native }, () => {
		const input = hydrate(f.input),
			before = plain(input);
		assert.equal(native!(input), f.expected);
		assert.deepEqual(plain(input), before);
	});
test('independent TS formulas retain the captured dependency decisions', () => {
	const cases = dependencyCases();
	assert.equal(cases.length, fixture.cases.length);
	cases.forEach((f, i) => {
		assert.equal(f.name, fixture.cases[i].name);
		assert.deepEqual(plain(f.input), fixture.cases[i].input, 'native descriptor packing retains captured data');
		assert.equal(f.expected, fixture.cases[i].expected);
		assert.deepEqual(f.solverRanks, fixture.cases[i].solverRanks);
		assert.deepEqual(f.geometricRanks, fixture.cases[i].geometricRanks);
	});
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

test('document dependency analysis matches the frozen path and restores locks without editing geometry', async () => {
	const { SketchDocument } = await import('../src/model/sketch');
	const { SketchPoint } = await import('../src/model/primitives/point');
	const { SketchCircle } = await import('../src/model/primitives/circle');
	const { DistanceConstraint, HorizontalConstraint, PointOnCircleConstraint, RadiusConstraint } = await import(
		'../src/solver/constraints'
	);
	const { isDependentDimension: reference } = await import('../src/solver/constraintDependencyReference');
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
		assert.equal(reference(sketch.paramManager, sketch.constraints.values(), candidate, sketch), dependent);
		assert.equal(actual(sketch.paramManager, sketch.constraints.values(), candidate, sketch), dependent);
		assert.deepEqual([...sketch.paramManager.getIndices()], free);
		assert.deepEqual([...sketch.paramManager.getCurrentValues()], state);
		assert.deepEqual(sketch.takeSnapshot(), before);
		assert.equal(candidate.targetDistance, 50);
	}
	const sketch = new SketchDocument();
	sketch.points.set('center', new SketchPoint('center', 0, 0, true));
	sketch.points.set('edge', new SketchPoint('edge', 10, 0, true));
	sketch.circles.set('circle', new SketchCircle('circle', 'center', 10));
	sketch.constraints.set('on', new PointOnCircleConstraint('on', 'edge', 'center', 'circle'));
	sketch.rebuildParamManager();
	const candidate = new RadiusConstraint('candidate', 'circle', 50);
	assert.equal(actual(sketch.paramManager, sketch.constraints.values(), candidate, sketch), true);
	assert.equal(candidate.targetRadius, 50);
	for (const file of ['offset-pattern-line11', 'offset-rectangle-reference-distance', 'triangle-reference-angle']) {
		const doc = new SketchDocument();
		doc.restoreSnapshot(JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`, import.meta.url), 'utf8')));
		const snapshot = doc.takeSnapshot();
		let count = 0;
		for (const line of doc.lines.values()) {
			if (line.isConstruction || line.isSplineHandle) continue;
			const dim = new DistanceConstraint('candidate', line.p1Id, line.p2Id, 50);
			const expected = reference(doc.paramManager, doc.constraints.values(), dim, doc);
			assert.equal(actual(doc.paramManager, doc.constraints.values(), dim, doc), expected, `${file}/${line.id}`);
			count++;
		}
		assert.ok(count);
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

test('custom constraint overrides retain the original path and native failure restores parameter locks', async () => {
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
	let evaluations = 0;
	const evaluate = constraint.evaluate;
	constraint.evaluate = function (values) {
		evaluations++;
		return evaluate.call(this, values);
	};
	try {
		setGeometryKernel({
			...previous,
			dependency() {
				throw new Error('native failure');
			},
		});
		assert.equal(isDependentDimension(sketch.paramManager, [constraint], candidate, sketch), true);
		assert.equal(evaluations, 1);
		assert.deepEqual([...sketch.paramManager.getIndices()], locked);
		delete (constraint as any).evaluate;
		assert.throws(() => isDependentDimension(sketch.paramManager, [constraint], candidate, sketch), /native failure/);
		assert.deepEqual([...sketch.paramManager.getIndices()], locked);
	} finally {
		setGeometryKernel(previous);
	}
});

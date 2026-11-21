import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmInspection } from '../src/kernel/inspectionWasm';
import { deserializeConstraint } from '../src/solver/constraints/serialization';
import { AngleConstraint, DistanceConstraint, HorizontalConstraint } from '../src/solver/constraints';
import { checkConstraints, updateReferenceValues } from '../src/solver/constraintInspection';
import { SketchDocument } from '../src/model/sketch';
import type { ReferenceMeasurement } from '../src/kernel/inspectionTypes';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelInspection.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().inspectConstraints;
function near(actual: number, expected: number, name = '') {
	assert.ok(
		Object.is(actual, expected) || Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)),
		`${name}: ${actual} != ${expected}`
	);
}
for (const f of fixture.inspections)
	test(`native residual inspection: ${f.name}`, { skip: !native }, () => {
		const data = new Float64Array(f.input.nativeConstraints),
			before = data.slice();
		const result = native!({ nativeConstraints: data, rowCounts: f.input.rowCounts, measurements: [] });
		near(result.error, f.error, f.name);
		assert.equal(result.satisfied, f.satisfied);
		assert.deepEqual(data, before);
	});

for (const f of fixture.measurements)
	test(`reference measurement: ${f.name}`, () => {
		const c = Object.assign(deserializeConstraint(f.constraint)!, f.constraint);
		const values = new Map<string, number>(Object.entries(f.params));
		const before = [...values];
		const sketch =
			f.arc === undefined
				? undefined
				: ({ arcs: new Map([[(c as AngleConstraint).line1Id, { clockwise: f.arc }]]) } as unknown as SketchDocument);
		c.updateReferenceValue!(values, sketch);
		for (const [key, expected] of Object.entries(f.expected)) {
			const actual = Reflect.get(c, key);
			if (typeof expected === 'number') near(actual, expected, key);
			else assert.deepEqual(actual, expected);
		}
		assert.equal(c.expression, undefined);
		assert.deepEqual([...values], before);
	});

test('reference dimensions use one batch and preserve custom update methods', { skip: !native }, () => {
	const previous = getGeometryKernel(),
		sketch = new SketchDocument();
	const values = new Map([
		['a.x', 0],
		['a.y', 0],
		['b.x', 3],
		['b.y', 4],
	]);
	const cs = Array.from({ length: 100 }, (_, i) =>
		Object.assign(new DistanceConstraint('d' + i, 'a', 'b', 99), { isReference: true })
	);
	let calls = 0;
	try {
		setGeometryKernel({
			...previous,
			inspectConstraints(input) {
				calls++;
				return native!(input);
			},
		});
		updateReferenceValues(cs, values, sketch);
		assert.equal(calls, 1);
		for (const c of cs) assert.equal(c.value, 5);
		let custom = 0;
		cs[0].updateReferenceValue = () => {
			custom++;
		};
		updateReferenceValues([cs[0]], values, sketch);
		assert.equal(custom, 1);
		assert.equal(calls, 1);
		values.set('b.x', 6);
		values.set('b.y', 8);
		updateReferenceValues(cs.slice(1), values, sketch);
		assert.equal(cs[1].value, 10);
		assert.equal(calls, 2);
	} finally {
		setGeometryKernel(previous);
	}
});

test('native inspection never calls JS equations and retains direction checks at tiny scales', {
	skip: !native,
}, () => {
	const previous = getGeometryKernel();
	const c = new HorizontalConstraint('h', 'a', 'b');
	const values = new Map([
		['a.x', 0],
		['a.y', 0],
		['b.x', 10],
		['b.y', 2],
	]);
	let calls = 0;
	try {
		setGeometryKernel({
			...previous,
			inspectConstraints(input) {
				calls++;
				c.evaluate = () => {
					throw Error('unexpected JS residual');
				};
				c.jacobian = () => {
					throw Error('unexpected JS Jacobian');
				};
				return native!(input);
			},
		});
		assert.deepEqual(checkConstraints([c], values), { error: 2, satisfied: true, measurements: new Float64Array() });
		assert.equal(calls, 1);
	} finally {
		delete (c as any).evaluate;
		delete (c as any).jacobian;
		setGeometryKernel(previous);
	}
	for (const scale of [1e-12, 1, 1e12]) {
		const angle = new AngleConstraint('angle', 'a', 'b', 'a1', 'a2', 'b1', 'b2', 90);
		const params = new Map([
			['a1.x', 0],
			['a1.y', 0],
			['a2.x', scale],
			['a2.y', 0],
			['b1.x', 0],
			['b1.y', 0],
			['b2.x', scale],
			['b2.y', 0],
		]);
		assert.equal(checkConstraints([angle], params).satisfied, false);
		params.set('b2.x', 0);
		params.set('b2.y', scale);
		assert.equal(checkConstraints([angle], params).satisfied, true);
		params.set('b2.y', 0);
		assert.equal(checkConstraints([angle], params).satisfied, false);
	}
});

test('custom equations retain callback order and native errors propagate', () => {
	const c = new DistanceConstraint('d', 'a', 'b', 10),
		values = new Map<string, number>();
	const calls: string[] = [];
	c.evaluate = () => {
		calls.push('error');
		return [2, 4];
	};
	Object.assign(c, {
		isSatisfied: () => {
			calls.push('geometry');
			return false;
		},
	});
	assert.deepEqual(checkConstraints([c], values), { error: 10, satisfied: false });
	assert.deepEqual(calls, ['error', 'geometry']);
	calls.length = 0;
	assert.equal(checkConstraints([c], values, true).satisfied, false);
	assert.deepEqual(calls, ['geometry']);
	if (!native) return;
	const previous = getGeometryKernel();
	try {
		setGeometryKernel({
			...previous,
			inspectConstraints() {
				throw Error('native failure');
			},
		});
		assert.throws(() => checkConstraints([new HorizontalConstraint('h', 'a', 'b')], values), /native failure/);
		const reference = Object.assign(new DistanceConstraint('r', 'a', 'b', 99), { isReference: true });
		assert.throws(() => updateReferenceValues([reference], values, new SketchDocument()), /native failure/);
		assert.equal(reference.targetDistance, 99);
	} finally {
		setGeometryKernel(previous);
	}
});

test('inspection validates packed programs and measurement buffers', { skip: !native }, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (data: number[], groups: number[], measurements: number[]) =>
		wasm.inspect_constraints(new Float64Array(data), new Float64Array(groups), new Float64Array(measurements));
	for (const [data, groups, measurements] of [
		[[], [1e20], []],
		[[], [-1], []],
		[[], [0.5], []],
		[[], [NaN], []],
		[[], [1], []],
		[[], [], [6]],
		[[], [], [1, 0, 0]],
		[[], [], [0, NaN]],
		[[], [], [1, 0, 0, 1, 1, 3]],
		[[], [], [3, 0, 0, 0, 0, 0, 0, 1, 1, 0]],
		[[], [], [4, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 2]],
		[[0, 0, 0, 1, 0, 0, 2, -1, 0, -1, 0], [1, 1], []],
		[[0, 0, 0, 1, 0, 0, 2, 0, 0, -1, 0], [2], []],
	] as number[][][])
		assert.throws(() => call(data, groups, measurements));
	const input = {
		nativeConstraints: new Float64Array(),
		rowCounts: [],
		measurements: [{ kind: 0, data: [5] } as ReferenceMeasurement],
	};
	for (const output of [[], [0, 0], [0, 2, 5], [0, 1, 5, 6]])
		assert.throws(() => createWasmInspection(() => new Float64Array(output))(input));
	assert.throws(() =>
		createWasmInspection(() => new Float64Array([0, 1, NaN]))({
			...input,
			measurements: [{ kind: 5, data: [0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 90] }],
		})
	);
	assert.deepEqual(Array.from(call([], [], [0, 5])), [0, 1, 5]);
});

test('measurement overflow keeps rejection semantics and nonfinite legacy values retain TS compatibility', () => {
	const c = Object.assign(new DistanceConstraint('r', 'a', 'b', 99), { isReference: true });
	const values = new Map([
		['a.x', -1e308],
		['a.y', 0],
		['b.x', 1e308],
		['b.y', 0],
	]);
	c.updateReferenceValue(values);
	assert.equal(c.value, Infinity);
	values.set('b.x', NaN);
	c.updateReferenceValue(values);
	assert.ok(Number.isNaN(c.value));
});

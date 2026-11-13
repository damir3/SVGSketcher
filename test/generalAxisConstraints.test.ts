import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import {
	DistanceConstraint,
	PointToLineDistanceConstraint,
	CollinearConstraint,
	CoincidentConstraint,
	PointOnLineConstraint,
} from '../src/solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import { compileNativeConstraints } from '../src/solver/nativeConstraints';
import { getGeometryKernel } from '../src/kernel';
import { remapLineConstraints } from '../src/model/constraintLinks';

for (const orientation of ['horizontal', 'vertical'] as const) {
	test(`signed ${orientation} distance retains direction after crossing its anchor`, () => {
		const sketch = new SketchDocument();
		const anchor = sketch.addPoint({ x: 10, y: 20 }, true);
		const point = sketch.addPoint({ x: 60, y: 70 });
		const c = new DistanceConstraint('signed', anchor.id, point.id, 30, 1, undefined, orientation, undefined, -1);
		sketch.addConstraint(c);
		const coordinate = orientation === 'horizontal' ? 'x' : 'y';
		assert.ok(Math.abs(point[coordinate] - anchor[coordinate] + 30) < 1e-5);
		point[coordinate] = anchor[coordinate] + 50;
		sketch.solve();
		assert.ok(Math.abs(point[coordinate] - anchor[coordinate] + 30) < 1e-5);
		assert.equal((deserializeConstraint(serializeConstraint(c)) as DistanceConstraint).side, -1);
		const unsigned = new DistanceConstraint('unsigned', anchor.id, point.id, 30, 1, undefined, orientation);
		const values = new Map([
			[`${anchor.id}.${coordinate}`, 0],
			[`${point.id}.${coordinate}`, 30],
		]);
		assert.equal(unsigned.evaluate(values)[0], 0);
		values.set(`${point.id}.${coordinate}`, -30);
		assert.equal(unsigned.evaluate(values)[0], 0);
	});
}

test('line distance keeps both endpoints on the chosen side of an arbitrary reference line', async () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 0, y: 0 }, true);
	const b = sketch.addPoint({ x: 100, y: 100 }, true);
	const p = sketch.addPoint({ x: 30, y: 60 });
	const q = sketch.addPoint({ x: 90, y: 150 });
	const reference = sketch.addLine(a.id, b.id);
	const line = sketch.addLine(p.id, q.id);
	const c = new PointToLineDistanceConstraint(
		'distance',
		p.id,
		reference.id,
		a.id,
		b.id,
		20,
		-1,
		1,
		undefined,
		undefined,
		q.id,
		line.id
	);
	sketch.addConstraint(c);
	for (const point of [p, q]) assert.ok(Math.abs((point.y - point.x) / Math.SQRT2 - 20) < 1e-4);
	assert.equal(c.getEquationsCount(), 2);
	assert.equal(sketch.constraints.size, 1);
	assert.ok(sketch.getConstraintsForEntity('point', q.id).includes(c));
	assert.ok(sketch.getEntitiesForConstraint(c).some(e => e.id === line.id && e.type === 'line'));
	const replacement = sketch.addPoint(new Vec2(q.x, q.y));
	remapLineConstraints(sketch, line, q.id, replacement.id);
	const remapped = sketch.constraints.get(c.id) as PointToLineDistanceConstraint;
	assert.equal(remapped.secondPointId, replacement.id);

	const values = new Map(
		[...sketch.points.values()].flatMap(
			point =>
				[
					[`${point.id}.x`, point.x],
					[`${point.id}.y`, point.y],
				] as [string, number][]
		)
	);
	const indices = new Map([...values.keys()].map((id, i) => [id, i]));
	const compiled = compileNativeConstraints([remapped], values, indices);
	assert.equal(compiled.nativeCount, 1);
	if (getGeometryKernel().backend === 'wasm') {
		const native = await import('../public/kernel/sketcher_wasm.js');
		const actual = native.evaluate_constraints(
			Float64Array.from(values.values()),
			compiled.data,
			new Float64Array([2, 2, 1])
		);
		const expected = [...remapped.evaluate(values), ...new Array(2 * indices.size).fill(0)];
		for (const entry of remapped.jacobian(indices, 0, values))
			expected[2 + entry.row * indices.size + entry.col] += entry.val;
		actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7));
	}
});

test('general origin and axis constraints preserve their type and state on save and restore', () => {
	const constraints = [
		new DistanceConstraint('distance', 'origin', 'p', 25, 0.7, -12, 'horizontal', 1.4, -1),
		new CoincidentConstraint('coincident', 'origin', 'p', 0.7),
		new PointOnLineConstraint('point-on-axis', 'p', 'origin', 'axis_x', 0.7),
		new PointToLineDistanceConstraint(
			'line-distance',
			'p',
			'axis_x',
			'origin',
			'axis_x',
			25,
			-1,
			0.7,
			-12,
			1.4,
			'q',
			'line'
		),
		new CollinearConstraint('collinear', 'origin', 'axis_y', 'p', 'q', 0.7),
	];
	const values = new Map([
		['p.x', -25],
		['p.y', 25],
		['q.x', -25],
		['q.y', 40],
	]);
	for (const constraint of constraints) {
		constraint.isSoft = true;
		constraint.expression = 'width';
		const snapshot = serializeConstraint(constraint);
		const restored = deserializeConstraint(snapshot)!;
		assert.ok(restored instanceof constraint.constructor);
		assert.deepEqual(serializeConstraint(restored), snapshot);
		assert.deepEqual(restored.evaluate(values), constraint.evaluate(values));
		assert.equal(restored.getEquationsCount(), constraint.getEquationsCount());
		if (restored instanceof DistanceConstraint || restored instanceof PointToLineDistanceConstraint) {
			assert.equal(restored.offset, -12);
			assert.equal(restored.labelPosition, 1.4);
			assert.equal(restored.side, -1);
		}
	}
});

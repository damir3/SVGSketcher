import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deserializeConstraint } from '../src/solver/constraints/serialization';

// Compare the analytic formula to an independent symmetric derivative, including
// unsatisfied angles, shared vertices, reversed rays, axes, and locked parameters.
for (const file of ['kernelCurvedConstraints.json', 'kernelAxisConstraints.json']) {
	const { cases } = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
	for (const fixture of cases.filter((c: any) => c.constraint.type === 'angle')) {
		test(`analytic angle derivative: ${fixture.name}`, () => {
			const c = deserializeConstraint(fixture.constraint)!;
			const values = new Map<string, number>(Object.entries(fixture.params));
			const indices = new Map<string, number>(fixture.freeIds.map((id: string, i: number) => [id, i]));
			const derivative = new Float64Array(indices.size);
			for (const e of c.jacobian(indices, 0, values)) derivative[e.col] += e.val;
			for (const [id, col] of indices) {
				const value = values.get(id)!;
				const step = Math.max(1, Math.abs(value)) * 1e-5;
				values.set(id, value + step);
				const plus = c.evaluate(values)[0];
				values.set(id, value - step);
				const minus = c.evaluate(values)[0];
				values.set(id, value);
				const numeric = (plus - minus) / (2 * step);
				assert.ok(Math.abs(derivative[col] - numeric) < 1e-8, `${id}: ${derivative[col]} vs ${numeric}`);
			}
		});
	}
}

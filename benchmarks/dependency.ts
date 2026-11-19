import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { getGeometryKernel } from '../src/kernel';
import { SketchDocument } from '../src/model/sketch';
import { SketchPoint } from '../src/model/primitives/point';
import { DistanceConstraint, HorizontalConstraint } from '../src/solver/constraints';
import { isDependentDimension } from '../src/solver/constraintDependency';
import { isDependentDimension as reference } from '../src/solver/constraintDependencyReference';
if (!getGeometryKernel().dependency) throw new Error('Run with --import ./test/helpers/wasmKernel.ts');
for (const shape of ['full', 'partial'])
	for (const n of [20, 100, 300, 1000]) {
		const sketch = new SketchDocument();
		for (let i = 1; i <= n; i++) {
			const id = `p${i}`,
				previous = i === 1 ? 'origin' : `p${i - 1}`;
			sketch.points.set(id, new SketchPoint(id, i * 10, 0));
			sketch.constraints.set(`h${i}`, new HorizontalConstraint(`h${i}`, previous, id));
			if (shape === 'full') sketch.constraints.set(`d${i}`, new DistanceConstraint(`d${i}`, previous, id, 10));
		}
		sketch.rebuildParamManager();
		const candidate = new DistanceConstraint(
			'candidate',
			'origin',
			`p${n}`,
			n * 10,
			1,
			undefined,
			shape === 'full' ? 'aligned' : 'vertical'
		);
		const check = (fn: typeof reference) => fn(sketch.paramManager, sketch.constraints.values(), candidate, sketch);
		assert.equal(check(reference), true);
		assert.equal(check(isDependentDimension), true);
		for (let i = 0; i < 15; i++) {
			check(reference);
			check(isDependentDimension);
		}
		const measure = (fn: typeof reference) => {
			const samples: number[] = [];
			for (let i = 0; i < 11; i++) {
				const start = performance.now();
				assert.equal(check(fn), true);
				samples.push(performance.now() - start);
			}
			return samples.sort((a, b) => a - b)[5];
		};
		const ts = measure(reference),
			rust = measure(isDependentDimension);
		console.log(
			`${shape}, ${n} segments: TS ${ts.toFixed(2)} ms, Rust ${rust.toFixed(2)} ms, ${(ts / rust).toFixed(2)}x`
		);
	}

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { getGeometryKernel } from '../src/kernel';
import { SketchDocument } from '../src/model/sketch';
import { SketchPoint } from '../src/model/primitives/point';
import { DistanceConstraint, HorizontalConstraint } from '../src/solver/constraints';
import { isDependentDimension } from '../src/solver/constraintDependency';
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
		const run = () => isDependentDimension(sketch.paramManager, sketch.constraints.values(), candidate, sketch);
		assert.equal(run(), true);
		for (let i = 0; i < 15; i++) run();
		const samples: number[] = [];
		for (let i = 0; i < 11; i++) {
			const start = performance.now();
			assert.equal(run(), true);
			samples.push(performance.now() - start);
		}
		const rust = samples.sort((a, b) => a - b)[5];
		console.log(`${shape}, ${n} segments: Rust ${rust.toFixed(2)} ms`);
	}

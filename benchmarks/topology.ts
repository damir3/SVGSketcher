import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { toggleOrExtendChain } from '../src/math/offset';
import { toggleOrExtendChain as reference } from '../src/math/offsetTopologyReference';
import { getGeometryKernel } from '../src/kernel';
import { summarize } from './stats';

if (!getGeometryKernel().topology) throw new Error('Run with the test/helpers/wasmKernel.ts preload');
for (const count of [200, 1000]) {
	const sketch = new SketchDocument();
	let first = '';
	sketch.beginTransaction();
	sketch.withDeferredSolve(() => {
		let previous = sketch.addPoint({ x: 10, y: 10 }, true);
		for (let i = 1; i <= count; i++) {
			const next = sketch.addPoint({ x: 10 + i * 2, y: 10 + (i % 2) }, true);
			const line = sketch.addLine(previous.id, next.id);
			if (!first) first = line.id;
			previous = next;
		}
	});
	sketch.commitTransaction();
	const expected = reference(sketch, null, first, 'line', true);
	assert.deepEqual(toggleOrExtendChain(sketch, null, first, 'line', true), expected);
	for (const [name, query] of [
		['typescript', reference],
		['rust', toggleOrExtendChain],
	] as const) {
		const samples: number[] = [];
		for (let i = -2; i < 5; i++) {
			const start = performance.now();
			const result = query(sketch, null, first, 'line', true);
			const elapsed = performance.now() - start;
			assert.equal(result?.items.length, count);
			if (i >= 0) samples.push(elapsed);
		}
		console.log(JSON.stringify({ primitives: count, backend: name, milliseconds: summarize(samples) }));
	}
}

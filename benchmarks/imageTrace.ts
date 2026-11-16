// Run after build:kernel with: node --import tsx --import ./test/helpers/wasmKernel.ts benchmarks/imageTrace.ts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { traceScene } from '../test/helpers/imageTraceScenes';
import { traceImage } from '../src/model/imageTrace/trace';
import { DEFAULT_TRACE_SETTINGS, type ImageTraceSettings } from '../src/model/imageTrace/types';
const cases: [string, number, Partial<ImageTraceSettings>][] = [
	['ellipse', 512, {}],
	['wave', 512, { mode: 'centerline' }],
	['ring', 1000, {}],
	['junction', 1000, { mode: 'centerline', centerlineAlgorithm: 'guo-hall' }],
];
for (const [shape, size, changes] of cases) {
	const image = traceScene(shape, size, size),
		settings = { ...DEFAULT_TRACE_SETTINGS, ...changes };
	const expected = traceImage(image, settings).stats;
	const runs: number[] = [];
	for (let i = 0; i < 3; i++) {
		const start = performance.now();
		const result = traceImage(image, settings);
		runs.push(performance.now() - start);
		assert.deepEqual(result.stats, expected);
	}
	console.log(JSON.stringify({ shape, size, medianMs: runs.sort((a, b) => a - b)[1], stats: expected }));
}

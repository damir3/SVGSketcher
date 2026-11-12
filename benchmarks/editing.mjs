import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createBenchmarkScene } from './scenes.ts';
import { summarize } from './stats.ts';
import { SketchDocument } from '../src/model/sketch.ts';
import { getAllGeoCurves, getPointAtParam, getCurveIntersections, getTrimCandidate } from '../src/math/intersection.ts';
import { findExtendCandidate } from '../src/math/extend.ts';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel/index.ts';
import { typescriptGeometryKernel } from '../src/kernel/typescript.ts';
import { createWasmGeometryKernel } from '../src/kernel/wasm.ts';

const option = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i < 0 ? fallback : process.argv[i + 1];
};
const samples = Number(option('--samples', 30)),
	warmup = Number(option('--warmup', 5));
if (
	!Number.isInteger(samples) ||
	samples < 5 ||
	samples > 300 ||
	!Number.isInteger(warmup) ||
	warmup < 1 ||
	warmup > 30
)
	throw new Error('Invalid sample/warmup count');
const output = resolve(option('--output', 'benchmarks/generated'));
await mkdir(output, { recursive: true });
const bindings = await import('../public/kernel/sketcher_wasm.js');
await bindings.default({
	module_or_path: await readFile(new URL('../public/kernel/sketcher_wasm_bg.wasm', import.meta.url)),
});
const wasm = createWasmGeometryKernel(bindings),
	previous = getGeometryKernel();
const report = {
	schemaVersion: 1,
	apiVersion: wasm.apiVersion,
	createdAt: new Date().toISOString(),
	runtime: process.version,
	platform: `${process.platform}/${process.arch}`,
	samples,
	warmup,
	scope:
		'Node editing queries from prepared curves, including kernel packing/result validation and candidate reconstruction; excludes curve collection, document mutation, solver and rendering',
	results: [],
};
const compact = (hits, trim, extend) => ({
	intersections: hits.map(h => ({ point: h.point, param: h.param, id: h.cuttingCurveId, type: h.cuttingCurveType })),
	trim: {
		interval: trim.interval,
		start: trim.cutStartWorld,
		end: trim.cutEndWorld,
		startId: trim.startCuttingCurveId,
		endId: trim.endCuttingCurveId,
		whole: trim.isWholeEntity,
	},
	extend: extend
		? {
				edge: extend.edge,
				from: extend.fromPoint,
				to: extend.toPoint,
				id: extend.intersectedCurveId,
				full: extend.becomesFullLoop,
			}
		: null,
});
const compare = (a, b) => {
	if (typeof a === 'number' && typeof b === 'number') {
		assert.ok(Math.abs(a - b) < 1e-8 + Math.abs(b) * 1e-10);
		return;
	}
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		assert.deepEqual(a, b);
		return;
	}
	assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
	for (const key of Object.keys(a)) compare(a[key], b[key]);
};
try {
	let order = 0;
	for (const family of ['rectangles', 'splines'])
		for (const size of ['small', 'medium', 'large']) {
			setGeometryKernel(typescriptGeometryKernel);
			const scene = createBenchmarkScene(family, size),
				sketch = new SketchDocument();
			sketch.restoreSnapshot(scene.snapshot);
			const curves = getAllGeoCurves(sketch),
				target = curves.find(c => c.type === (family === 'rectangles' ? 'segment' : 'spline'));
			const cursors = Array.from({ length: samples + warmup }, (_, i) =>
				getPointAtParam(target, (i + 1) / (samples + warmup + 1))
			);
			const kernels = order++ % 2 ? [wasm, typescriptGeometryKernel] : [typescriptGeometryKernel, wasm];
			let reference;
			for (const kernel of kernels) {
				setGeometryKernel(kernel);
				const raw = { intersections: [], trim: [], extend: [] },
					results = [];
				for (let i = 0; i < cursors.length; i++) {
					const start = performance.now(),
						hits = getCurveIntersections(target, curves),
						cut = performance.now();
					const trim = getTrimCandidate(target, curves, cursors[i]),
						trimmed = performance.now();
					const extend = findExtendCandidate(sketch, target, curves, cursors[i]),
						extended = performance.now();
					if (i < warmup) continue;
					raw.intersections.push(cut - start);
					raw.trim.push(trimmed - cut);
					raw.extend.push(extended - trimmed);
					results.push(JSON.parse(JSON.stringify(compact(hits, trim, extend))));
				}
				if (reference) compare(results, reference);
				else reference = results;
				const timings = Object.fromEntries(Object.entries(raw).map(([key, values]) => [key, summarize(values)]));
				report.results.push({
					scene: scene.id,
					backend: kernel.backend,
					curveCount: curves.length,
					timings,
					raw,
					finalCandidate: results.at(-1),
				});
				console.log(
					`${scene.id} ${kernel.backend}: trim p95 ${timings.trim.p95.toFixed(3)} ms, extend p95 ${timings.extend.p95.toFixed(3)} ms`
				);
			}
		}
	await writeFile(resolve(output, 'editing-report.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
	setGeometryKernel(previous);
}

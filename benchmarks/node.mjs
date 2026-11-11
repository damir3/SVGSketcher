import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SketchDocument } from '../src/model/sketch.ts';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel/index.ts';
import { typescriptGeometryKernel } from '../src/kernel/typescript.ts';
import { createWasmGeometryKernel } from '../src/kernel/wasm.ts';
import { findSketchRegions } from '../src/math/regions.ts';
import { createBenchmarkScene, dragTarget, sceneCounts, SCENE_SIZES, SCENE_VERSION } from './scenes.ts';
import { summarize } from './stats.ts';

const scenesOnly = process.argv.includes('--scenes');
const option = (name, fallback) => {
	const index = process.argv.indexOf(name);
	if (index < 0) return fallback;
	if (!process.argv[index + 1]) throw new Error(`Missing value for ${name}`);
	return process.argv[index + 1];
};
const integer = (name, fallback, minimum) => {
	const value = Number(option(name, fallback));
	if (!Number.isInteger(value) || value < minimum || value > 300) throw new Error(`Invalid ${name}`);
	return value;
};
const samples = integer('--samples', '30', 5),
	warmup = integer('--warmup', '5', 1);
const output = resolve(option('--output', 'benchmarks/generated'));
await mkdir(output, { recursive: true });
const previous = getGeometryKernel();
try {
	let kernels = [typescriptGeometryKernel];
	if (!scenesOnly) {
		const bindings = await import('../public/kernel/sketcher_wasm.js');
		await bindings.default({
			module_or_path: await readFile(new URL('../public/kernel/sketcher_wasm_bg.wasm', import.meta.url)),
		});
		kernels.push(createWasmGeometryKernel(bindings));
	}
	const report = {
		schemaVersion: 1,
		sceneVersion: SCENE_VERSION,
		apiVersion: kernels[0].apiVersion,
		createdAt: new Date().toISOString(),
		runtime: process.version,
		platform: `${process.platform}/${process.arch}`,
		samples,
		warmup,
		scope: 'Node: dragPoint including solver integration; region computation; no DOM/rendering',
		results: [],
	};
	for (const family of ['rectangles', 'splines'])
		for (const size of Object.keys(SCENE_SIZES)) {
			const scene = createBenchmarkScene(family, size);
			setGeometryKernel(typescriptGeometryKernel);
			const example = new SketchDocument();
			example.restoreSnapshot(scene.snapshot);
			await writeFile(resolve(output, `${scene.id}.json`), JSON.stringify(scene, null, 2) + '\n');
			await writeFile(resolve(output, `${scene.id}.svg`), example.exportSVG(undefined, 1, { regions: false }));
			if (scenesOnly) {
				console.log(`Exported ${scene.id}`);
				continue;
			}
			for (const kernel of kernels) {
				setGeometryKernel(kernel);
				const sketch = new SketchDocument();
				sketch.restoreSnapshot(scene.snapshot);
				const raw = { solve: [], regions: [] };
				let maxError = 0,
					maxTargetDistance = 0,
					regionCount;
				for (let i = -warmup; i < samples; i++) {
					const target = dragTarget(scene, i, samples),
						start = performance.now();
					sketch.dragPoint(scene.dragPointId, target.x, target.y);
					const solved = performance.now();
					const regions = findSketchRegions(sketch),
						ended = performance.now();
					if (i < 0) continue;
					raw.solve.push(solved - start);
					raw.regions.push(ended - solved);
					const error = sketch.lastSolverResult?.finalError ?? NaN;
					if (!Number.isFinite(error)) throw new Error(`Non-finite solver error: ${scene.id}`);
					maxError = Math.max(maxError, error);
					const point = sketch.points.get(scene.dragPointId);
					maxTargetDistance = Math.max(maxTargetDistance, Math.hypot(point.x - target.x, point.y - target.y));
					regionCount = regions.length;
				}
				const result = {
					scene: scene.id,
					backend: kernel.backend,
					counts: sceneCounts(sketch),
					regionCount,
					quality: {
						maxError,
						maxTargetDistance,
						status: sketch.lastSolverResult.status,
						degreesOfFreedom: sketch.lastSolverResult.degreesOfFreedom,
					},
					timings: Object.fromEntries(Object.entries(raw).map(([key, values]) => [key, summarize(values)])),
					raw,
				};
				report.results.push(result);
				console.log(
					`${scene.id} ${kernel.backend}: solve p95 ${result.timings.solve.p95.toFixed(2)} ms; regions p95 ${result.timings.regions.p95.toFixed(2)} ms`
				);
			}
		}
	if (!scenesOnly) await writeFile(resolve(output, 'node-report.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
	setGeometryKernel(previous);
}

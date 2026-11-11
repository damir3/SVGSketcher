import './style.css';
import { SVGRenderer } from '../src/canvas/renderer';
import { Viewport } from '../src/canvas/viewport';
import { AABB } from '../src/math/aabb';
import { SketchDocument } from '../src/model/sketch';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import type { GeometryKernel } from '../src/kernel/types';
import {
	createBenchmarkScene,
	dragTarget,
	sceneCounts,
	SCENE_SIZES,
	SCENE_VERSION,
	type BenchmarkScene,
	type SceneFamily,
	type SceneSize,
} from './scenes';
import { summarize } from './stats';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const run = element<HTMLButtonElement>('run'),
	stop = element<HTMLButtonElement>('stop');
const save = element<HTMLButtonElement>('save'),
	sceneDownload = element<HTMLButtonElement>('scene-download');
const status = element('status'),
	select = element<HTMLSelectElement>('scene');
const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
let cancelled = false,
	currentSketch: SketchDocument | undefined;
const specs = (['rectangles', 'splines'] as SceneFamily[]).flatMap(family =>
	(Object.keys(SCENE_SIZES) as SceneSize[]).map(size => ({ family, size, id: `${family}-${size}` }))
);
for (const spec of specs) select.add(new Option(spec.id, spec.id));

function download(name: string, content: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
save.onclick = () =>
	download('sketcher-browser-benchmark.json', element<HTMLTextAreaElement>('report').value, 'application/json');
sceneDownload.onclick = () => {
	if (currentSketch)
		download('benchmark-scene.svg', currentSketch.exportSVG(undefined, 1, { regions: false }), 'image/svg+xml');
};
stop.onclick = () => {
	cancelled = true;
};

async function measure(
	scene: BenchmarkScene,
	kernel: GeometryKernel,
	regions: boolean,
	samples: number,
	warmup: number
) {
	setGeometryKernel(kernel);
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(scene.snapshot);
	currentSketch = sketch;
	svg.replaceChildren();
	const renderer = new SVGRenderer(svg),
		viewport = new Viewport(1100, 650);
	viewport.fitToBounds(new AABB(scene.bounds.min).addPoint(scene.bounds.max), 50);
	renderer.deferRegionSolve = !regions;
	renderer.setRegionsVisible(regions);
	let regionMs = 0;
	renderer.onRegionSolve = elapsed => {
		regionMs += elapsed;
	};
	const raw = {
		solve: [] as number[],
		regions: [] as number[],
		render: [] as number[],
		layout: [] as number[],
		pipeline: [] as number[],
		frame: [] as number[],
	};
	let maxError = 0,
		maxTargetDistance = 0;
	const visibility = new Set<string>();
	for (let i = -warmup; i < samples; i++) {
		if (cancelled) return undefined;
		const frameStart = await nextFrame();
		visibility.add(document.visibilityState);
		const start = performance.now(),
			target = dragTarget(scene, i, samples);
		sketch.dragPoint(scene.dragPointId, target.x, target.y);
		const solved = performance.now();
		regionMs = 0;
		renderer.render(sketch, viewport, { showGrid: true, showConstraints: true });
		const rendered = performance.now();
		// Reading SVG bounds forces pending style/layout work before stopping the CPU timer.
		svg.getBoundingClientRect();
		const laidOut = performance.now();
		const frameEnd = await nextFrame();
		visibility.add(document.visibilityState);
		if (i < 0) continue;
		raw.solve.push(solved - start);
		raw.regions.push(regionMs);
		raw.render.push(Math.max(0, rendered - solved - regionMs));
		raw.layout.push(laidOut - rendered);
		raw.pipeline.push(laidOut - start);
		raw.frame.push(frameEnd - frameStart);
		const error = sketch.lastSolverResult?.finalError ?? NaN;
		if (!Number.isFinite(error)) throw new Error(`Non-finite solver error in ${scene.id}`);
		maxError = Math.max(maxError, error);
		const point = sketch.points.get(scene.dragPointId)!;
		maxTargetDistance = Math.max(maxTargetDistance, Math.hypot(point.x - target.x, point.y - target.y));
	}
	return {
		scene: scene.id,
		backend: kernel.backend,
		regions,
		counts: sceneCounts(sketch),
		quality: {
			maxError,
			maxTargetDistance,
			status: sketch.lastSolverResult?.status,
			degreesOfFreedom: sketch.lastSolverResult?.degreesOfFreedom,
		},
		visibility: [...visibility],
		timings: Object.fromEntries(Object.entries(raw).map(([key, values]) => [key, summarize(values)])),
		raw,
	};
}

function appendRow(result: NonNullable<Awaited<ReturnType<typeof measure>>>) {
	const row = document.createElement('tr');
	const pair = (key: string) => `${result.timings[key].p50.toFixed(2)} / ${result.timings[key].p95.toFixed(2)}`;
	for (const value of [
		result.scene,
		result.backend,
		result.regions ? 'on' : 'off',
		result.counts.freeParameters,
		pair('solve'),
		pair('regions'),
		pair('render'),
		pair('layout'),
		pair('pipeline'),
		result.timings.frame.p95.toFixed(2),
	]) {
		const cell = document.createElement('td');
		cell.textContent = String(value);
		row.append(cell);
	}
	element('results').append(row);
}

async function initialize() {
	// Explicitly load the release artifact: a failed WASM load must never silently benchmark TS twice.
	const moduleUrl = new URL('kernel/sketcher_wasm.js', document.baseURI).href;
	const bindings = await import(/* @vite-ignore */ moduleUrl);
	await bindings.default();
	const wasm = createWasmGeometryKernel(bindings);
	status.textContent = `Ready. Kernel API ${wasm.apiVersion}. Keep this tab visible during measurement.`;
	run.disabled = false;
	element<HTMLFormElement>('controls').onsubmit = async event => {
		event.preventDefault();
		const samples = Number(element<HTMLInputElement>('samples').value),
			warmup = Number(element<HTMLInputElement>('warmup').value);
		if (
			!Number.isInteger(samples) ||
			samples < 5 ||
			samples > 300 ||
			!Number.isInteger(warmup) ||
			warmup < 1 ||
			warmup > 30
		)
			return;
		const previous = getGeometryKernel();
		cancelled = false;
		run.disabled = true;
		stop.disabled = false;
		save.disabled = true;
		element('results').replaceChildren();
		const report = {
			schemaVersion: 1,
			sceneVersion: SCENE_VERSION,
			apiVersion: wasm.apiVersion,
			createdAt: new Date().toISOString(),
			runtime: navigator.userAgent,
			hardwareConcurrency: navigator.hardwareConcurrency,
			viewport: { width: 1100, height: 650, devicePixelRatio },
			samples,
			warmup,
			build: 'Vite production; Rust release opt-level=3',
			results: [] as NonNullable<Awaited<ReturnType<typeof measure>>>[],
			completed: false,
			error: '',
		};
		try {
			const selected = specs.filter(spec => select.value === 'all' || spec.id === select.value);
			for (const [index, spec] of selected.entries()) {
				const scene = createBenchmarkScene(spec.family, spec.size);
				// Alternate backend order between scenes to reduce systematic warm-up/order bias.
				const kernels = index % 2 ? [wasm, typescriptGeometryKernel] : [typescriptGeometryKernel, wasm];
				for (const regions of [false, true])
					for (const kernel of kernels) {
						if (cancelled) break;
						status.textContent = `Running ${spec.id}, ${kernel.backend}, regions ${regions ? 'on' : 'off'}…`;
						const result = await measure(scene, kernel, regions, samples, warmup);
						if (result) {
							report.results.push(result);
							appendRow(result);
						}
					}
				if (cancelled) break;
			}
			report.completed = !cancelled;
			status.textContent = `${cancelled ? 'Stopped' : 'Completed'}: ${report.results.length} cases. JSON report is ready.`;
		} catch (error) {
			report.error = String(error);
			status.textContent = `Failed: ${error}`;
		} finally {
			setGeometryKernel(previous);
			run.disabled = false;
			stop.disabled = true;
			save.disabled = false;
			sceneDownload.disabled = !currentSketch;
			element<HTMLTextAreaElement>('report').value = JSON.stringify(report, null, 2);
		}
	};
}
initialize().catch(error => {
	status.textContent = `Cannot load release WASM: ${error}. Run npm run bench:build first.`;
});

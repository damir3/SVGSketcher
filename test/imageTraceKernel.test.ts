import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmImageTrace } from '../src/kernel/imageTraceWasm';
import { traceImage } from '../src/model/imageTrace/trace';
import { convertTraceToSplines } from '../src/model/imageTrace/splines';
import { createTraceWorkerHandler } from '../src/model/imageTrace/workerRuntime';
import { traceScene, noisyTraceCases } from './helpers/imageTraceScenes';
import { buildTraceGeometry } from '../src/model/imageTrace/build';
import { SketchDocument } from '../src/model/sketch';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelImageTrace.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().backend === 'wasm';
function compare(a: any, b: any, path = '') {
	if (typeof b === 'number') {
		assert.ok(Math.abs(a - b) <= 1e-7 + Math.abs(b) * 1e-10, `${path}: ${a} != ${b}`);
		return;
	}
	if (b == null || typeof b !== 'object') {
		assert.equal(a, b, path);
		return;
	}
	assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
	for (const k of Object.keys(b)) compare(a[k], b[k], `${path}.${k}`);
}
for (const c of fixture.cases)
	test(`raster tracing matches the pre-native result: ${c.name}`, { skip: !native }, () => {
		const input = { ...traceScene(c.shape), yScale: c.yScale, pixelSize: c.pixelSize },
			before = input.gray.slice();
		const { elapsedMs, ...result } = traceImage(input, c.settings);
		compare(result, c.expected);
		assert.ok(elapsedMs >= 0);
		assert.deepEqual(input.gray, before);
	});
test('WASM traces and fits the entire raster with one boundary call', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0;
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				trace_image(gray, settings) {
					calls++;
					return bindings.trace_image(gray, settings);
				},
				spline_geometry() {
					throw new Error('per-cubic callback');
				},
			})
		);
		const c = fixture.cases.find(c => c.name === 'wave/settings-0');
		const { elapsedMs, ...result } = traceImage(
			{ ...traceScene(c.shape), yScale: c.yScale, pixelSize: c.pixelSize },
			c.settings
		);
		compare(result, c.expected);
		assert.equal(calls, 1);
	} finally {
		setGeometryKernel(previous);
	}
});
test('worker initializes the native tracer once and reports failed loads', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js');
	let loads = 0,
		calls = 0;
	const handle = createTraceWorkerHandler(async url => {
		assert.equal(url, 'kernel-url');
		loads++;
		return createWasmImageTrace((gray, settings) => {
			calls++;
			return bindings.trace_image(gray, settings);
		});
	});
	for (const [id, c] of fixture.cases.slice(0, 4).entries()) {
		const response = await handle({
			id,
			kernelUrl: 'kernel-url',
			input: { ...traceScene(c.shape), yScale: c.yScale, pixelSize: c.pixelSize },
			settings: c.settings,
		});
		assert.equal(response.id, id);
		assert.equal(response.ok, true, response.error);
		const { elapsedMs, ...result } = response.result!;
		compare(result, c.expected);
	}
	assert.equal(loads, 1);
	assert.equal(calls, 4);
	const failure = createTraceWorkerHandler(async () => {
		throw new Error('kernel load failed');
	});
	const response = await failure({
		id: 42,
		kernelUrl: 'bad',
		input: traceScene('disk'),
		settings: fixture.cases[0].settings,
	});
	assert.deepEqual(response, { id: 42, ok: false, error: 'kernel load failed' });
});
test('trace decoder rejects malformed results and native rejects invalid rasters', async () => {
	const input = traceScene('blank'),
		settings = fixture.cases[0].settings;
	for (const data of [
		[],
		[NaN],
		[128, 2 ** 32],
		[128, 0, 1, 2, 0],
		[128, 0, 1, 1, 1, 0, 0, 0, 0],
		[128, 0, 0, 0, 0, 1],
	])
		assert.throws(() => createWasmImageTrace(() => new Float64Array(data))(input, settings), /WASM image trace/);
	if (!native) return;
	const { trace_image } = await import('../public/kernel/sketcher_wasm.js');
	const tracer = createWasmImageTrace(trace_image);
	for (const bad of [
		{ ...input, width: 0 },
		{ ...input, width: 4097 },
		{ ...input, gray: new Float32Array([NaN]) },
		{ ...input, yScale: Infinity },
		{ ...input, pixelSize: 0 },
	])
		assert.throws(() => tracer(bad, settings), /image trace/);
	for (const bad of [
		{ ...settings, blur: Infinity },
		{ ...settings, smoothing: -1 },
		{ ...settings, tolerance: NaN },
	])
		assert.throws(() => tracer(input, bad), /image trace/);
	assert.throws(() => trace_image(input.gray, new Float64Array()), /image trace/);
});
test('native traced geometry preserves connectivity and history when committed', { skip: !native }, () => {
	const c = fixture.cases.find(c => c.name === 'junction/guo-hall');
	const result = traceImage(traceScene(c.shape), c.settings);
	const sketch = new SketchDocument();
	const image = sketch.addImage({ fileName: 'junction.png', width: 80, height: 64, x: 0, y: 0, angle: 0, opacity: 1 });
	sketch.clearHistory();
	sketch.beginTransaction();
	buildTraceGeometry(sketch, result, image, c.settings);
	sketch.commitTransaction(false);
	const after = sketch.takeSnapshot();
	assert.ok(after.lines.length + after.splines.length + after.arcs.length > 0);
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.lines.size + sketch.splines.size + sketch.arcs.size, 0);
	assert.equal(sketch.redo(), true);
	assert.deepEqual(sketch.takeSnapshot(), after);
});

test('production worker loads generated WASM and traces repeated requests', { skip: !native }, async () => {
	const { Worker } = await import('node:worker_threads');
	const worker = new Worker(new URL('./helpers/imageTraceWorker.mjs', import.meta.url), { execArgv: [] });
	try {
		for (const [id, name] of ['ellipse/settings-0', 'junction/zhang-suen', 'ring/pixel-edges'].entries()) {
			const c = fixture.cases.find(c => c.name === name);
			const response: any = await new Promise((resolve, reject) => {
				worker.once('message', resolve);
				worker.once('error', reject);
				worker.postMessage({
					id,
					kernelUrl: new URL('../public/kernel/sketcher_wasm.js', import.meta.url).href,
					input: { ...traceScene(c.shape), yScale: c.yScale, pixelSize: c.pixelSize },
					settings: c.settings,
				});
			});
			assert.equal(response.id, id);
			assert.equal(response.ok, true, response.error);
			const { elapsedMs, ...result } = response.result;
			compare(result, c.expected);
		}
	} finally {
		await worker.terminate();
	}
});

test('native tracing matches captured noisy and stretched rasters', { skip: !native }, () => {
	const cases = noisyTraceCases();
	assert.equal(cases.length, fixture.noisyCases.length);
	for (const [i, { input, settings }] of cases.entries()) {
		const { elapsedMs, ...actual } = traceImage(input, settings);
		compare(actual, fixture.noisyCases[i], `seeded ${i}`);
	}
});

test('native worker rejects missing kernel URLs instead of running a TS pipeline', async () => {
	let calls = 0;
	const handle = createTraceWorkerHandler(async () => {
		calls++;
		throw new Error('unexpected load');
	});
	const response = await handle({ id: 7, input: traceScene('blank'), settings: fixture.cases[0].settings } as any);
	assert.equal(response.ok, false);
	assert.match(response.error!, /requires the Rust\/WASM kernel URL/);
	assert.equal(calls, 0);
});

test('native trace loader reuses initialization and rejects incompatible modules', async () => {
	const { loadImageTraceKernel } = await import('../src/kernel/imageTraceLoader');
	const incompatible = 'data:text/javascript,export default async function(){};export function api_version(){return 0}';
	const first = loadImageTraceKernel(incompatible);
	assert.equal(loadImageTraceKernel(incompatible), first);
	await assert.rejects(first, /Unsupported WASM image trace kernel/);
});

test('Convert to Paths accepts thin closed contours with two anchors and preserves them through history', {
	skip: !native,
}, () => {
	// Minimal reproduction of the narrow strokes in 222.jpg: the outline fitter produces two anchors.
	const width = 96,
		height = 32,
		gray = new Float32Array(width * height).fill(255);
	for (let y = 14; y < 16; y++) for (let x = 12; x < 84; x++) gray[y * width + x] = 0;
	const settings = { ...fixture.cases[0].settings, useSplines: false };
	const result = convertTraceToSplines(traceImage({ gray, width, height, pixelSize: 1, yScale: 1 }, settings));
	assert.equal(result.closedSplines.length, 1);
	assert.equal(result.closedSplines[0].points.length, 2);
	assert.equal(result.closedSplines[0].handles.length, 2);
	assert.deepEqual(result.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
	const sketch = new SketchDocument();
	const image = sketch.addImage({ fileName: 'thin-stroke.png', width, height, x: 0, y: 0, angle: 0, opacity: 1 });
	sketch.clearHistory();
	const built = buildTraceGeometry(sketch, structuredClone(result), image, settings);
	assert.equal(built.entities.length, 1);
	const spline = sketch.splines.get(built.entities[0].id)!;
	assert.equal(spline.isClosed, true);
	assert.equal(spline.toGeoCurve(sketch)!.bezierSegments.length, 2);
	const after = sketch.takeSnapshot();
	assert.equal(sketch.undo(), true);
	assert.equal(sketch.splines.size, 0);
	assert.equal(sketch.redo(), true);
	assert.deepEqual(sketch.takeSnapshot(), after);
});

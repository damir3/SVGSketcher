import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ImageTraceRunner } from '../src/model/imageTrace/client';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { DEFAULT_TRACE_SETTINGS, type TraceResult } from '../src/model/imageTrace/types';
import { SketchDocument } from '../src/model/sketch';
import { renderTracePreviewVisual } from '../src/canvas/previewHelpers';
import { Viewport } from '../src/canvas/viewport';
import { traceScene } from './helpers/imageTraceScenes';

test('trace runner always supplies the native kernel URL, coalesces queued jobs and ignores stale responses', async () => {
	const originalWorker = globalThis.Worker,
		originalDocument = globalThis.document,
		kernel = getGeometryKernel();
	const messages: any[] = [];
	let instance: any;
	class FakeWorker {
		onmessage: any;
		onerror: any;
		terminated = false;
		constructor() {
			instance = this;
		}
		postMessage(message: any) {
			messages.push(message);
		}
		terminate() {
			this.terminated = true;
		}
	}
	Object.assign(globalThis, { Worker: FakeWorker, document: { baseURI: 'https://sketch.example/project/' } });
	const runner = new ImageTraceRunner();
	try {
		setGeometryKernel({ ...kernel, backend: 'wasm' });
		const input = traceScene('blank');
		const first = runner.trace(input, DEFAULT_TRACE_SETTINGS);
		const superseded = runner.trace(input, DEFAULT_TRACE_SETTINGS);
		const last = runner.trace(input, { ...DEFAULT_TRACE_SETTINGS, blur: 1 });
		assert.equal(await superseded, null);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].kernelUrl, 'https://sketch.example/kernel/sketcher_wasm.js');
		instance.onmessage({ data: { id: -1, ok: true, result: {} } });
		assert.equal(messages.length, 1);
		const result = { stats: { lines: 0, arcs: 0, circles: 0, splines: 0 } };
		instance.onmessage({ data: { id: messages[0].id, ok: true, result } });
		assert.equal(await first, result);
		assert.equal(messages.length, 2);
		assert.equal(messages[1].settings.blur, 1);
		instance.onmessage({ data: { id: messages[1].id, ok: true, result } });
		assert.equal(await last, result);
		setGeometryKernel({ ...kernel, backend: 'typescript' });
		const cancelled = runner.trace(input, DEFAULT_TRACE_SETTINGS);
		assert.equal(messages[2].kernelUrl, 'https://sketch.example/kernel/sketcher_wasm.js');
		runner.dispose();
		assert.equal(await cancelled, null);
		assert.equal(instance.terminated, true);
	} finally {
		runner.dispose();
		setGeometryKernel(kernel);
		Object.assign(globalThis, { Worker: originalWorker, document: originalDocument });
	}
});

test('trace runner uses the native tracer without a worker and propagates native failures', async () => {
	const originalWorker = globalThis.Worker,
		previous = getGeometryKernel();
	let calls = 0;
	const result = { stats: { lines: 0, arcs: 0, circles: 0, splines: 0 } } as any;
	const runner = new ImageTraceRunner();
	Object.assign(globalThis, { Worker: undefined });
	try {
		setGeometryKernel({
			...previous,
			backend: 'typescript',
			traceImage() {
				calls++;
				return result;
			},
		});
		assert.equal(await runner.trace(traceScene('blank'), DEFAULT_TRACE_SETTINGS), result);
		assert.equal(calls, 1);
		setGeometryKernel({
			...previous,
			traceImage() {
				throw new Error('native trace failure');
			},
		});
		await assert.rejects(runner.trace(traceScene('blank'), DEFAULT_TRACE_SETTINGS), /native trace failure/);
	} finally {
		runner.dispose();
		setGeometryKernel(previous);
		Object.assign(globalThis, { Worker: originalWorker });
	}
});

test('Convert to Paths disables filters and draws and adds splines from the cached trace', async () => {
	register('./helpers/rawSvgLoader.mjs', import.meta.url);
	const { ImageTraceModal } = await import('../src/ui/image-trace-modal');
	const result: TraceResult = {
		width: 16,
		height: 16,
		yScale: 1,
		threshold: 128,
		elapsedMs: 0,
		vertices: [],
		paths: [],
		closedSplines: [],
		circles: [{ center: { x: 8, y: 8 }, radius: 4 }],
		stats: { lines: 0, arcs: 0, circles: 1, splines: 0 },
	};
	const controls = new Map<string, ElementStub>();
	class ElementStub extends EventTarget {
		checked = false;
		disabled = false;
		textContent = '';
		style = {};
		attributes = new Map<string, string>();
		children: ElementStub[] = [];
		classList = { add() {}, remove() {}, toggle() {} };
		constructor(public tagName = '') {
			super();
		}
		setAttribute(name: string, value: string) {
			this.attributes.set(name, value);
		}
		querySelector(selector: string) {
			if (!controls.has(selector)) controls.set(selector, new ElementStub());
			return controls.get(selector)!;
		}
		querySelectorAll() {
			return [];
		}
		appendChild(child: ElementStub) {
			this.children.push(child);
		}
		getContext() {
			return {
				fillRect() {},
				drawImage() {},
				getImageData: () => ({ data: new Uint8Array(16 * 16 * 4) }),
			};
		}
	}
	const { document, window, Image, Worker } = globalThis;
	let requests = 0;
	Object.assign(globalThis, {
		document: {
			baseURI: 'https://sketch.example/',
			body: new ElementStub(),
			createElement: () => new ElementStub(),
			createElementNS: (_ns: string, tag: string) => new ElementStub(tag),
			getElementById: () => null,
		},
		window: new EventTarget(),
		Image: class {
			naturalWidth = 16;
			naturalHeight = 16;
			onload?: () => void;
			set src(_url: string) {
				queueMicrotask(() => this.onload?.());
			}
		},
		Worker: class {
			onmessage?: (event: { data: { id: number; ok: true; result: TraceResult } }) => void;
			postMessage({ id, settings }: { id: number; settings: typeof DEFAULT_TRACE_SETTINGS }) {
				requests++;
				assert.equal(settings.useSplines, false);
				queueMicrotask(() => this.onmessage?.({ data: { id, ok: true, result } }));
			}
			terminate() {}
		},
	});
	const sketch = new SketchDocument();
	const image = sketch.addImage({
		fileName: 'circle.png',
		objectUrl: 'blob:trace-modal-test',
		width: 16,
		height: 16,
		x: 0,
		y: 0,
		angle: 0,
		opacity: 1,
	});
	const previews: Array<TraceResult | null> = [];
	const postprocess = getGeometryKernel().tracePostprocess!;
	const modal = new ImageTraceModal(sketch, {
		onPreviewChange: preview => previews.push(preview?.result ?? null),
		onConverted: () => {},
	});
	try {
		modal.open(image.id);
		await delay(0);
		assert.equal(requests, 1);
		assert.equal(previews[0], result);
		const checkbox = controls.get('#trace-use-splines')!;
		const convert = controls.get('#btn-trace-apply')!;
		const filters = ['#trace-use-lines', '#trace-use-arcs', '#trace-use-circles', '#trace-include-splines'].map(
			selector => controls.get(selector)!
		);
		// Disabling a primitive in the normal mode should not remove it from the spline conversion.
		filters[2].checked = false;
		filters[2].dispatchEvent(new Event('change'));
		assert.equal(convert.disabled, true);
		for (const checked of [true, false, true]) {
			checkbox.checked = checked;
			checkbox.dispatchEvent(new Event('change'));
			assert.equal(convert.disabled, !checked);
			assert.ok(filters.every(filter => filter.disabled === checked));
			assert.equal(filters[2].checked, false);
			assert.deepEqual(previews.at(-1)?.stats, { lines: 0, arcs: 0, circles: 0, splines: checked ? 1 : 0 });
		}
		await delay(90);
		assert.equal(requests, 1);
		assert.equal(previews.at(-1), previews[2]);
		assert.equal(controls.get('#trace-stats-summary')?.textContent, '1 spline (1 total)');
		const preview = new ElementStub();
		renderTracePreviewVisual(
			preview as unknown as SVGElement,
			new Viewport(),
			previews.at(-1)!,
			image,
			false,
			postprocess
		);
		assert.deepEqual(
			preview.children[0].children.map(element => element.tagName),
			['path']
		);
		assert.match(preview.children[0].children[0].attributes.get('d')!, /^M .+ C .+ Z$/);
		convert.dispatchEvent(new Event('click'));
		assert.equal(modal.openState, false);
		assert.equal(sketch.circles.size, 0);
		assert.equal(sketch.arcs.size, 0);
		assert.equal([...sketch.lines.values()].filter(line => !line.isSplineHandle).length, 0);
		assert.equal(sketch.splines.size, 1);
		assert.equal([...sketch.splines.values()][0].isClosed, true);
	} finally {
		modal.close();
		Object.assign(globalThis, { document, window, Image, Worker });
	}
});

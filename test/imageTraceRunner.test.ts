import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageTraceRunner } from '../src/model/imageTrace/client';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { DEFAULT_TRACE_SETTINGS } from '../src/model/imageTrace/types';
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

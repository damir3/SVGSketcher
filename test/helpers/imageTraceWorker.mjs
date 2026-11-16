// Run the production Web Worker entry under Node, including its asynchronous WASM loader.
import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (request, options) => {
	const url = request instanceof Request ? request.url : String(request);
	if (url.startsWith('file:')) return new Response(await readFile(new URL(url)), { headers: { 'Content-Type': 'application/wasm' } });
	return fetchOriginal(request, options);
};
globalThis.postMessage = message => parentPort.postMessage(message);
await import('../../src/model/imageTrace/worker.ts');
parentPort.on('message', data => globalThis.onmessage({ data }));

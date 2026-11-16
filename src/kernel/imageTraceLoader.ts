import { createWasmImageTrace, type ImageTraceBinding, type ImageTraceKernel } from './imageTraceWasm';
import { GEOMETRY_KERNEL_API_VERSION } from './types';

type TraceBindings = { default(): Promise<unknown>; api_version(): number; trace_image: ImageTraceBinding };
const kernels = new Map<string, Promise<ImageTraceKernel>>();

/** Load a native tracer independently of the backend selected for other geometry operations. */
export function loadImageTraceKernel(url: string): Promise<ImageTraceKernel> {
	let pending = kernels.get(url);
	if (!pending) {
		pending = (async () => {
			const bindings = (await import(/* @vite-ignore */ url)) as TraceBindings;
			await bindings.default();
			if (bindings.api_version() !== GEOMETRY_KERNEL_API_VERSION || typeof bindings.trace_image !== 'function')
				throw new Error('Unsupported WASM image trace kernel');
			return createWasmImageTrace((gray, settings) => bindings.trace_image(gray, settings));
		})();
		kernels.set(url, pending);
	}
	return pending;
}

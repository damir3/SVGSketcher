import { createWasmImageTrace, type ImageTraceBinding, type ImageTraceKernel } from './imageTraceWasm';
import { createWasmTracePostprocess, type TracePostprocessBinding } from './tracePostprocessWasm';
import type { TracePostprocessKernel } from './tracePostprocessTypes';
import { GEOMETRY_KERNEL_API_VERSION } from './types';

type TraceBindings = {
	default(): Promise<unknown>;
	api_version(): number;
	trace_image: ImageTraceBinding;
	trace_postprocess: TracePostprocessBinding;
};
const modules = new Map<string, Promise<TraceBindings>>();
const kernels = new Map<string, Promise<ImageTraceKernel>>();

function loadTraceBindings(url: string): Promise<TraceBindings> {
	let pending = modules.get(url);
	if (!pending) {
		pending = (async () => {
			const bindings = (await import(/* @vite-ignore */ url)) as TraceBindings;
			await bindings.default();
			if (bindings.api_version() !== GEOMETRY_KERNEL_API_VERSION)
				throw new Error('Unsupported WASM image trace kernel');
			return bindings;
		})();
		modules.set(url, pending);
	}
	return pending;
}

/** Load a native tracer independently of the backend selected for other geometry operations. */
export function loadImageTraceKernel(url: string): Promise<ImageTraceKernel> {
	let pending = kernels.get(url);
	if (!pending) {
		pending = loadTraceBindings(url).then(bindings => {
			if (typeof bindings.trace_image !== 'function') throw new Error('Unsupported WASM image trace kernel');
			return createWasmImageTrace(bindings.trace_image);
		});
		kernels.set(url, pending);
	}
	return pending;
}

export async function loadTracePostprocessKernel(url: string): Promise<TracePostprocessKernel> {
	const bindings = await loadTraceBindings(url);
	if (typeof bindings.trace_postprocess !== 'function')
		throw new Error('WASM kernel has no image trace postprocessing');
	return createWasmTracePostprocess(bindings.trace_postprocess);
}

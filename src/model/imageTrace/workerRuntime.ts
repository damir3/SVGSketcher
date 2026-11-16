import { loadImageTraceKernel } from '../../kernel/imageTraceLoader';
import type { ImageTraceKernel } from '../../kernel/imageTraceWasm';
import type { TraceWorkerRequest, TraceWorkerResponse } from './worker';

/** The worker has its own WASM instance; a failed native load is reported to the caller. */
export function createTraceWorkerHandler(load: (url: string) => Promise<ImageTraceKernel> = loadImageTraceKernel) {
	const kernels = new Map<string, Promise<ImageTraceKernel>>();
	return async ({ id, input, settings, kernelUrl }: TraceWorkerRequest): Promise<TraceWorkerResponse> => {
		try {
			if (!kernelUrl) throw new Error('Image tracing requires the Rust/WASM kernel URL');
			let pending = kernels.get(kernelUrl);
			if (!pending) {
				pending = load(kernelUrl);
				kernels.set(kernelUrl, pending);
			}
			const trace = await pending;
			return { id, ok: true, result: trace(input, settings) };
		} catch (err) {
			return { id, ok: false, error: err instanceof Error ? err.message : 'Failed to trace image' };
		}
	};
}

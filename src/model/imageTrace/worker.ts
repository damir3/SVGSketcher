import type { TraceInput } from './trace';
import { createTraceWorkerHandler } from './workerRuntime';
import type { ImageTraceSettings, TraceResult } from './types';

export interface TraceWorkerRequest {
	/** Absolute URL of the required Rust/WASM tracing module. */
	kernelUrl: string;
	id: number;
	input: TraceInput;
	settings: ImageTraceSettings;
}

export interface TraceWorkerResponse {
	id: number;
	ok: boolean;
	result?: TraceResult;
	error?: string;
}

const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent<TraceWorkerRequest>) => void) | null;
	postMessage: (message: TraceWorkerResponse) => void;
};

const handle = createTraceWorkerHandler();
scope.onmessage = async (event: MessageEvent<TraceWorkerRequest>) => {
	scope.postMessage(await handle(event.data));
};

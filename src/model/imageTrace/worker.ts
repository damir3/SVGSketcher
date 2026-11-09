import { traceImage, type TraceInput } from './trace';
import type { ImageTraceSettings, TraceResult } from './types';

export interface TraceWorkerRequest {
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

scope.onmessage = (event: MessageEvent<TraceWorkerRequest>) => {
	const { id, input, settings } = event.data;
	try {
		const result = traceImage(input, settings);
		scope.postMessage({ id, ok: true, result });
	} catch (err) {
		scope.postMessage({
			id,
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to trace image',
		});
	}
};

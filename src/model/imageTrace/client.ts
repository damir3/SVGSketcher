import type { SketchImage } from '../image';
import { traceImage, type TraceInput } from './trace';
import type { ImageTraceSettings, TraceResult } from './types';
import type { TraceWorkerRequest, TraceWorkerResponse } from './worker';

interface CachedRaster {
	objectUrl: string;
	width: number;
	height: number;
	gray: Float32Array;
}

const imageElementCache = new Map<string, Promise<HTMLImageElement>>();
let cachedRaster: CachedRaster | null = null;

function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
	const existing = imageElementCache.get(objectUrl);
	if (existing) return existing;
	const promise = new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => {
			imageElementCache.delete(objectUrl);
			reject(new Error('Could not decode image'));
		};
		img.src = objectUrl;
	});
	imageElementCache.set(objectUrl, promise);
	return promise;
}

/**
 * Decodes and downscales a SketchImage into an 8-bit grayscale Float32Array suitable for tracing.
 * Transparent pixels are composited over white so dark/opaque regions become foreground.
 */
export async function decodeImageForTrace(image: SketchImage, maxResolution: number): Promise<TraceInput> {
	if (!image.objectUrl) {
		throw new Error('Image has no local file reference');
	}
	const decoded = await loadImageElement(image.objectUrl);
	const naturalWidth = decoded.naturalWidth || image.naturalWidth || Math.round(image.width) || 100;
	const naturalHeight = decoded.naturalHeight || image.naturalHeight || Math.round(image.height) || 100;
	const longest = Math.max(naturalWidth, naturalHeight, 1);
	const limit = Math.max(64, Math.min(4096, Math.round(maxResolution)));
	const scale = longest > limit ? limit / longest : 1;
	const width = Math.max(4, Math.round(naturalWidth * scale));
	const height = Math.max(4, Math.round(naturalHeight * scale));

	let gray: Float32Array;
	if (
		cachedRaster &&
		cachedRaster.objectUrl === image.objectUrl &&
		cachedRaster.width === width &&
		cachedRaster.height === height
	) {
		gray = cachedRaster.gray;
	} else {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('2D canvas context is not available');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(decoded, 0, 0, width, height);
		const { data } = ctx.getImageData(0, 0, width, height);
		gray = new Float32Array(width * height);
		for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
			const a = data[p + 3] / 255;
			const r = data[p] * a + 255 * (1 - a);
			const g = data[p + 1] * a + 255 * (1 - a);
			const b = data[p + 2] * a + 255 * (1 - a);
			gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
		}
		cachedRaster = { objectUrl: image.objectUrl, width, height, gray };
	}

	const pixelSize = image.width / width;
	const pixelHeight = image.height / height;
	const yScale = pixelSize > 1e-12 ? pixelHeight / pixelSize : 1;

	return { gray, width, height, yScale, pixelSize };
}

interface PendingJob {
	id: number;
	input: TraceInput;
	settings: ImageTraceSettings;
	resolve: (result: TraceResult | null) => void;
	reject: (error: Error) => void;
}

/**
 * Runs image tracing in a Web Worker (or synchronously as fallback) while coalescing rapid updates
 * so only the most recent slider state is queued behind an active worker job.
 */
export class ImageTraceRunner {
	private worker: Worker | null = null;
	private nextId = 1;
	private activeJob: PendingJob | null = null;
	private queuedJob: PendingJob | null = null;
	private workerFailed = false;

	private ensureWorker(): Worker | null {
		if (this.workerFailed || typeof Worker === 'undefined') return null;
		if (!this.worker) {
			try {
				this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
				this.worker.onmessage = (event: MessageEvent<TraceWorkerResponse>) => {
					this.handleResponse(event.data);
				};
				this.worker.onerror = () => {
					this.workerFailed = true;
					this.worker?.terminate();
					this.worker = null;
					const job = this.activeJob;
					this.activeJob = null;
					if (job) {
						try {
							job.resolve(traceImage(job.input, job.settings));
						} catch (err) {
							job.reject(err instanceof Error ? err : new Error('Failed to trace image'));
						}
					}
					this.flushQueue();
				};
			} catch {
				this.workerFailed = true;
				this.worker = null;
			}
		}
		return this.worker;
	}

	trace(input: TraceInput, settings: ImageTraceSettings): Promise<TraceResult | null> {
		const worker = this.ensureWorker();
		if (!worker) {
			return Promise.resolve(traceImage(input, settings));
		}
		return new Promise<TraceResult | null>((resolve, reject) => {
			const job: PendingJob = {
				id: this.nextId++,
				input,
				settings,
				resolve,
				reject,
			};
			if (this.activeJob) {
				if (this.queuedJob) {
					this.queuedJob.resolve(null);
				}
				this.queuedJob = job;
			} else {
				this.startJob(worker, job);
			}
		});
	}

	private startJob(worker: Worker, job: PendingJob): void {
		this.activeJob = job;
		const message: TraceWorkerRequest = {
			id: job.id,
			input: job.input,
			settings: job.settings,
		};
		worker.postMessage(message);
	}

	private handleResponse(response: TraceWorkerResponse): void {
		const active = this.activeJob;
		if (!active || active.id !== response.id) return;
		this.activeJob = null;
		if (response.ok && response.result) {
			active.resolve(response.result);
		} else {
			active.reject(new Error(response.error ?? 'Failed to trace image'));
		}
		this.flushQueue();
	}

	private flushQueue(): void {
		if (!this.queuedJob) return;
		const next = this.queuedJob;
		this.queuedJob = null;
		const worker = this.ensureWorker();
		if (worker) {
			this.startJob(worker, next);
		} else {
			try {
				next.resolve(traceImage(next.input, next.settings));
			} catch (err) {
				next.reject(err instanceof Error ? err : new Error('Failed to trace image'));
			}
		}
	}

	dispose(): void {
		if (this.queuedJob) {
			this.queuedJob.resolve(null);
			this.queuedJob = null;
		}
		if (this.activeJob) {
			this.activeJob.resolve(null);
			this.activeJob = null;
		}
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}
}

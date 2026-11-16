import type { TraceInput } from '../../src/model/imageTrace/trace';
import { cloneTraceSettings, DEFAULT_TRACE_SETTINGS, type ImageTraceSettings } from '../../src/model/imageTrace/types';
export const traceShapes = [
	'disk',
	'ring',
	'rectangle',
	'ellipse',
	'junction',
	'wave',
	'border',
	'islands',
	'blank',
	'full',
] as const;
export function traceScene(shape: string, width = 80, height = 64): TraceInput {
	const inside = (x: number, y: number) => {
		x /= width;
		y /= height;
		const r = Math.hypot(x - 0.5, y - 0.5);
		switch (shape) {
			case 'disk':
				return r < 0.32;
			case 'ring':
				return r < 0.38 && r > 0.2;
			case 'rectangle':
				return x > 0.15 && x < 0.85 && y > 0.2 && y < 0.8;
			case 'ellipse':
				return ((x - 0.5) / 0.4) ** 2 + ((y - 0.5) / 0.25) ** 2 < 1;
			case 'junction':
				return (Math.abs(x - 0.5) < 0.045 && y > 0.15 && y < 0.9) || (y > 0.2 && y < 0.29 && x > 0.15 && x < 0.85);
			case 'wave':
				return x > 0.1 && x < 0.9 && Math.abs(y - 0.5 - Math.sin(x * 10) * 0.18) < 0.045;
			case 'border':
				return x < 0.35 && y > 0.1 && y < 0.7;
			case 'islands':
				return (
					Math.hypot(x - 0.25, y - 0.3) < 0.13 ||
					Math.hypot(x - 0.75, y - 0.7) < 0.17 ||
					(x > 0.47 && x < 0.51 && y > 0.1 && y < 0.14)
				);
			case 'full':
				return true;
			case 'blank':
				return false;
			default:
				throw new Error(`Unknown trace scene ${shape}`);
		}
	};
	const gray = new Float32Array(width * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let dark = 0;
			for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) if (inside(x + sx, y + sy)) dark++;
			gray[y * width + x] = 255 - (dark * 255) / 4;
		}
	return { gray, width, height, yScale: 1, pixelSize: 1 };
}
export function traceCases() {
	const cases: { name: string; shape: string; settings: ImageTraceSettings; yScale: number; pixelSize: number }[] = [];
	const defaults = cloneTraceSettings(DEFAULT_TRACE_SETTINGS);
	for (const shape of traceShapes)
		for (const algorithm of ['marching-squares', 'pixel-edges', 'zhang-suen', 'guo-hall']) {
			const settings = { ...defaults };
			if (algorithm === 'zhang-suen' || algorithm === 'guo-hall') {
				settings.mode = 'centerline';
				settings.centerlineAlgorithm = algorithm;
			} else settings.outlineAlgorithm = algorithm as ImageTraceSettings['outlineAlgorithm'];
			cases.push({ name: `${shape}/${algorithm}`, shape, settings, yScale: 1, pixelSize: 1 });
		}
	for (const [i, change] of [
		{ useSplines: true },
		{ useLines: false },
		{ useArcs: false },
		{ useCircles: false },
		{ includeSplines: false },
		{ autoThreshold: false, threshold: 192, invert: true, blur: 0.75 },
		{ smoothing: 0, autoMinSegment: false, minSegment: 4, tolerance: 0.5 },
		{ blur: 1.25, smoothing: 2, cornerAngle: 65, despeckle: 2 },
	].entries())
		for (const shape of ['ellipse', 'rectangle', 'wave'])
			cases.push({
				name: `${shape}/settings-${i}`,
				shape,
				settings: { ...defaults, ...change },
				yScale: i % 2 ? 1.3 : 0.75,
				pixelSize: i === 6 ? 0.05 : 1,
			});
	return cases;
}

export function noisyTraceCases() {
	let seed = 79231;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const cases = traceCases();
	return Array.from({ length: 24 }, (_, i) => {
		const c = cases[i % cases.length];
		const input = traceScene(c.shape, 48 + (i % 7), 40 + (i % 5));
		input.yScale = 0.6 + random() * 1.2;
		input.pixelSize = 0.2 + random();
		for (let p = 0; p < input.gray.length; p++)
			input.gray[p] = Math.min(255, Math.max(0, input.gray[p] + (random() - 0.5) * 24));
		const settings = {
			...c.settings,
			blur: i % 3 === 0 ? 0.5 : 0,
			smoothing: (i % 4) / 2,
			autoThreshold: i % 2 === 0,
			threshold: 96 + i * 3,
		};
		return { input, settings };
	});
}

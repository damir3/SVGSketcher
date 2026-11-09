/** Raster helpers used by the image tracer. Masks store 1 for foreground and 0 for background. */

export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
	if (sigma <= 0.05) return src.slice();
	const radius = Math.max(1, Math.ceil(sigma * 3));
	const kernel = new Float32Array(radius * 2 + 1);
	let total = 0;
	for (let i = -radius; i <= radius; i++) {
		const value = Math.exp(-(i * i) / (2 * sigma * sigma));
		kernel[i + radius] = value;
		total += value;
	}
	for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

	const temp = new Float32Array(src.length);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			let sum = 0;
			for (let k = -radius; k <= radius; k++) {
				const xx = Math.min(width - 1, Math.max(0, x + k));
				sum += src[row + xx] * kernel[k + radius];
			}
			temp[row + x] = sum;
		}
	}
	const out = new Float32Array(src.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let sum = 0;
			for (let k = -radius; k <= radius; k++) {
				const yy = Math.min(height - 1, Math.max(0, y + k));
				sum += temp[yy * width + x] * kernel[k + radius];
			}
			out[y * width + x] = sum;
		}
	}
	return out;
}

/** Otsu's threshold for an 8-bit grayscale image. */
export function otsuThreshold(gray: ArrayLike<number>): number {
	const histogram = new Float64Array(256);
	for (let i = 0; i < gray.length; i++) {
		histogram[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
	}
	const total = gray.length;
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

	let sumBackground = 0;
	let weightBackground = 0;
	let best = 128;
	let bestVariance = -1;
	for (let t = 0; t < 256; t++) {
		weightBackground += histogram[t];
		if (weightBackground === 0) continue;
		const weightForeground = total - weightBackground;
		if (weightForeground === 0) break;
		sumBackground += t * histogram[t];
		const meanBackground = sumBackground / weightBackground;
		const meanForeground = (sumAll - sumBackground) / weightForeground;
		const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
		if (variance > bestVariance) {
			bestVariance = variance;
			best = t;
		}
	}
	// Pixels equal to the threshold count as foreground, so shift past the background class.
	return best + 1;
}

export function binarize(gray: ArrayLike<number>, threshold: number, invert: boolean): Uint8Array {
	const mask = new Uint8Array(gray.length);
	for (let i = 0; i < gray.length; i++) {
		const dark = gray[i] < threshold;
		mask[i] = dark !== invert ? 1 : 0;
	}
	return mask;
}

/**
 * Labels connected components of pixels whose mask value equals `value`.
 * Returns the label image (0 = not part of a component) and the size and border contact of each label.
 */
function labelComponents(
	mask: Uint8Array,
	width: number,
	height: number,
	value: number,
	eightConnected: boolean
): { labels: Int32Array; sizes: number[]; touchesBorder: boolean[] } {
	const labels = new Int32Array(mask.length);
	const sizes: number[] = [0];
	const touchesBorder: boolean[] = [false];
	const stack: number[] = [];
	let next = 1;
	for (let start = 0; start < mask.length; start++) {
		if (mask[start] !== value || labels[start]) continue;
		const label = next++;
		let size = 0;
		let border = false;
		labels[start] = label;
		stack.push(start);
		while (stack.length) {
			const index = stack.pop()!;
			size++;
			const x = index % width;
			const y = (index - x) / width;
			if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy >= height) continue;
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					if (!eightConnected && dx && dy) continue;
					const xx = x + dx;
					if (xx < 0 || xx >= width) continue;
					const neighbor = yy * width + xx;
					if (mask[neighbor] !== value || labels[neighbor]) continue;
					labels[neighbor] = label;
					stack.push(neighbor);
				}
			}
		}
		sizes.push(size);
		touchesBorder.push(border);
	}
	return { labels, sizes, touchesBorder };
}

/** Removes small foreground specks and fills small enclosed background holes. */
export function despeckle(mask: Uint8Array, width: number, height: number, minArea: number): Uint8Array {
	const out = mask.slice();
	if (minArea <= 1) return out;
	const foreground = labelComponents(out, width, height, 1, true);
	for (let i = 0; i < out.length; i++) {
		const label = foreground.labels[i];
		if (label && foreground.sizes[label] < minArea) out[i] = 0;
	}
	const background = labelComponents(out, width, height, 0, false);
	for (let i = 0; i < out.length; i++) {
		const label = background.labels[i];
		if (label && !background.touchesBorder[label] && background.sizes[label] < minArea) out[i] = 1;
	}
	return out;
}

/** Chamfer (3-4) distance from each foreground pixel to the nearest background pixel, in pixels. */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
	const inf = 1e9;
	const d = new Float32Array(mask.length);
	for (let i = 0; i < mask.length; i++) d[i] = mask[i] ? inf : 0;
	const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (!d[i]) continue;
			d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
		}
	}
	for (let y = height - 1; y >= 0; y--) {
		for (let x = width - 1; x >= 0; x--) {
			const i = y * width + x;
			if (!d[i]) continue;
			d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
		}
	}
	for (let i = 0; i < d.length; i++) d[i] /= 3;
	return d;
}

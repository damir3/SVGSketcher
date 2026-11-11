export function summarize(values: readonly number[]) {
	if (!values.length || values.some(v => !Number.isFinite(v) || v < 0))
		throw new Error('Expected nonempty finite timings');
	const sorted = [...values].sort((a, b) => a - b);
	const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
	return {
		count: sorted.length,
		min: sorted[0],
		p50: percentile(0.5),
		p95: percentile(0.95),
		max: sorted.at(-1)!,
		mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
	};
}

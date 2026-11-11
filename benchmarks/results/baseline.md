# Local performance baseline

Measured 2026-11-11T09:42:40.065Z, production Vite bundle, Rust release opt-level 3, kernel API 10. Runtime: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Host: darwin/arm64; browser hardware concurrency 10; fixed SVG viewport 1100 × 650; device pixel ratio 2. All 24 cases recorded visible document state, with five warm-up frames and 30 measured frames each. No tests or builds ran during the browser measurement.

[Browser raw samples](browser-baseline.json), [Node raw samples](node-baseline.json), [source and artifact hashes](provenance.json). Values are milliseconds from one run, not a portable guarantee; small differences require repeated runs. Both backends already contain the sparse solver optimizations.

## Browser p95

| Scene | Solve off TS / WASM | Pipeline off TS / WASM | Pipeline on TS / WASM | Regions on TS / WASM |
| --- | --- | --- | --- | --- |
| rectangles-small | 1.30 / 0.60 | 5.60 / 4.50 | 6.80 / 6.90 | 3.00 / 3.30 |
| rectangles-medium | 2.30 / 1.00 | 8.10 / 7.30 | 14.00 / 13.60 | 6.90 / 7.40 |
| rectangles-large | 5.00 / 1.90 | 16.60 / 13.30 | 38.10 / 37.50 | 19.70 / 22.30 |
| splines-small | 4.70 / 1.70 | 7.20 / 5.50 | 9.90 / 8.50 | 5.20 / 5.70 |
| splines-medium | 9.40 / 3.20 | 12.60 / 7.20 | 24.00 / 19.00 | 14.90 / 14.30 |
| splines-large | 28.70 / 9.60 | 35.40 / 15.90 | 104.40 / 67.80 | 71.00 / 54.00 |

“On/off” refers to region computation and fill visibility. Render, forced layout, frame intervals, p50, raw samples and model counts are retained in JSON. Percentiles of individual stages do not add up to the percentile of the whole pipeline.

For the 64-spline scene, WASM reduced solver integration p95 from 28.70 to 9.60 ms with regions off; the full CPU pipeline fell from 35.40 to 15.90 ms. With fills on, the WASM pipeline was 67.80 ms p95, including region computation at 54.00 ms p95. For 64 rectangles, the WASM solver was faster but pipeline p95 with fills was close (37.50 versus 38.10 ms). These measurements point to region computation as the next optimization target; moving more scalar operations to WASM alone will not remove that cost. The region finder still traverses all curve pairs and builds topology in TypeScript. A spatial broad phase and larger geometry batches are candidates to measure next.

## Correctness signals

Backend pairs have identical model counts, solver statuses and degrees of freedom. Maximum solver objective was about 7.52e-9 for rectangles and 4.334e-5 for splines, agreeing between backends within 1e-10. The maximum target-to-point distances were 0.02454 and 1.86204 model units respectively: dragging is soft, and the spline distance dimension intentionally prevents reaching every target. Small-scene regression tests separately compare coordinates and region counts across backends. These signals supplement the full parity suite; they do not establish exact equivalence for arbitrary documents.

## Node p95

Node measurements exclude SVG and layout and ran separately before the browser run.

| Scene | Solve TS / WASM | Regions TS / WASM |
| --- | --- | --- |
| rectangles-small | 1.42 / 0.42 | 8.06 / 4.29 |
| rectangles-medium | 2.63 / 1.01 | 15.68 / 15.29 |
| rectangles-large | 6.94 / 2.73 | 43.25 / 45.08 |
| splines-small | 1.97 / 0.70 | 6.66 / 6.58 |
| splines-medium | 6.45 / 2.52 | 17.79 / 22.33 |
| splines-large | 22.65 / 10.41 | 70.63 / 83.98 |

The Node/browser region timings differ substantially, and WASM is slower for several Node region cases. The selected backend includes packing and boundary costs; compare within one runtime and workload. Pipeline timings exclude event delivery and GPU paint, so these results are not input-to-photon latency or an FPS guarantee. See the [measurement guide](../README.md) for reproduction and limitations.

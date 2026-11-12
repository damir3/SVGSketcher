# Native Rust region construction

Measured before 2026-11-12T04:53:06.192Z and after 2026-11-12T05:00:11.170Z. The before version already includes the conservative bounds filter. Before uses TypeScript region construction plus Rust primitive/spline calculations (API 10); after uses one Rust region call (API 11). Both retain the current solver fixes from `786867e`. The benchmark harness, six scenes, drag targets, production build settings and release opt-level 3 are unchanged.

Runtime: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36; host darwin/arm64, hardware concurrency 10, SVG 1100 × 650, device pixel ratio 2. Both browser runs completed all 24 cases with five warm-up and 30 measured frames each, all recording visible state, without concurrent builds/tests/Node work. [Source and artifact hashes](native-regions-provenance.json).

## Browser p95 with fills enabled

Milliseconds, before → after.

| Scene | Backend | Region computation | Whole CPU pipeline |
| --- | --- | --- | --- |
| rectangles-small | typescript | 3.50 → 3.10 | 8.00 → 7.50 |
| rectangles-small | wasm | 3.40 → 1.20 | 7.70 → 5.70 |
| rectangles-medium | wasm | 6.30 → 2.20 | 13.30 → 9.70 |
| rectangles-medium | typescript | 6.20 → 6.40 | 13.80 → 14.60 |
| rectangles-large | typescript | 16.10 → 16.60 | 35.20 → 38.00 |
| rectangles-large | wasm | 15.80 → 5.50 | 30.80 → 26.40 |
| splines-small | wasm | 5.50 → 2.10 | 8.50 → 6.50 |
| splines-small | typescript | 3.90 → 4.00 | 9.00 → 9.50 |
| splines-medium | typescript | 9.00 → 8.40 | 19.10 → 20.20 |
| splines-medium | wasm | 10.90 → 3.20 | 16.30 → 9.60 |
| splines-large | wasm | 27.60 → 5.90 | 42.90 → 22.30 |
| splines-large | typescript | 24.00 → 25.20 | 59.30 → 63.20 |

For 64 splines in WASM, region computation p95 fell from 27.60 to 5.90 ms (79% lower); whole CPU pipeline p95 fell from 42.90 to 22.30 ms (48% lower). For 64 rectangles, region computation p95 fell from 15.80 to 5.50 ms. Native computation removes per-point JS/WASM sampling calls and moves cuts, topology, hole classification and boundary geometry into one native operation. SVG text formatting and Vec2 reconstruction stay in JS and are included in region timings. Browser timing also includes curve collection and geometry-key preparation in the renderer.

[Browser before](native-regions-before-browser.json), [browser after](native-regions-after-browser.json) preserve raw samples, p50/p95 for solve/regions/render/layout/pipeline/frame, fills on/off, visibility, model counts and solver quality. Model counts and solver quality fields agree exactly in every before/after case. The TypeScript control shows ordinary run-to-run variation and no consistent gain, as expected from leaving its computation unchanged.

This is one sequential before/after pair of local runs, not a portable performance guarantee. JIT, garbage collection, thermal state and run order can affect timing. Pipeline time excludes pointer-event dispatch and GPU paint; it is not an FPS or input-to-photon measurement. In particular, the 64-spline whole pipeline still exceeds a 16.7 ms budget in this run.

## Node p95

Measured separately, including scene/solver integration and region computation but no DOM/layout. [Node before](native-regions-before-node.json), [Node after](native-regions-after-node.json).

| Scene | Backend | Region computation before → after |
| --- | --- | --- |
| rectangles-small | typescript | 5.17 → 4.24 |
| rectangles-small | wasm | 3.20 → 2.12 |
| rectangles-medium | typescript | 9.01 → 9.66 |
| rectangles-medium | wasm | 11.66 → 1.79 |
| rectangles-large | typescript | 31.20 → 33.90 |
| rectangles-large | wasm | 30.47 → 4.30 |
| splines-small | typescript | 5.14 → 4.73 |
| splines-small | wasm | 7.57 → 0.73 |
| splines-medium | typescript | 16.93 → 14.73 |
| splines-medium | wasm | 21.26 → 2.16 |
| splines-large | typescript | 46.13 → 46.96 |
| splines-large | wasm | 55.96 → 6.42 |

Region counts, model counts and solver quality fields agree exactly for all Node cases. Compare within one runtime: the same workload has different JS/WASM boundary and allocation costs in Node and the browser.

## Compatibility and validation

- 120 captured pre-native arrangements identify the frozen TypeScript reference source with SHA-256. They cover all supported curves, intersections, empty arrangements, closed splines, imported problem contours, bridges, nested holes and negative-half quantization. Tests compare face/vertex order, hole structure, areas, SVG command structure and coordinates. Coordinates allow 1e-7 absolute plus 1e-10 relative error; formatted SVG coordinates allow one 1e-5 formatting unit.
- Twenty-four dragged states across all six benchmark scenes compare native results to the frozen reference. Native binding instrumentation verifies exactly one region call and no JS intersection or spline callbacks during construction from prepared curves.
- Full checks passed: 1321 actual-WASM tests, 1303 default tests with 18 native-only skips, 42 native Rust tests, TypeScript/format checks, cargo fmt, Clippy with warnings denied, and production editor/benchmark builds.
- Numeric input/output records are validated, including tags, lengths, finite values, radii, SVG command boundaries, arc flags and closure. The TypeScript fallback remains available; old WASM API 10 is rejected by the API 11 adapter. Rebuild kernel assets when updating.

Reproduce using the [benchmark guide](../README.md). Region graphs still scan O(n²) curve bounds; spatial indexing and incremental reuse are future work. Rendering, layout, curve collection and solver work also remain in the measured pipeline.

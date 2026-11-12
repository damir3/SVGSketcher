# Region broad-phase comparison

Measured before 2026-11-12T03:24:31.495Z and after 2026-11-12T03:25:50.924Z. Both builds use solver commit `786867e`, kernel API 10, the same release WASM binary, production Vite builds and the unchanged benchmark harness/scenes. Before was built in an isolated temporary source copy; the current checkout retained the optimization throughout. This comparison is separate from the older migration baseline.

Runtime: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36; host darwin/arm64; hardware concurrency 10; SVG viewport 1100 × 650; device pixel ratio 2. Each browser run completed all 24 cases, with five warm-up frames and 30 measured frames, all reporting visible document state. Builds, tests and Node runs were stopped during browser measurement. Source/artifact hashes and validation details are in [provenance](region-broad-phase-provenance.json).

## Browser p95 with region fills enabled

Milliseconds, before → after.

| Scene | Backend | Regions p95 | Whole CPU pipeline p95 |
| --- | --- | --- | --- |
| rectangles-small | typescript | 3.60 → 3.60 | 8.60 → 8.40 |
| rectangles-small | wasm | 3.50 → 2.80 | 7.90 → 7.40 |
| rectangles-medium | wasm | 8.50 → 6.60 | 14.90 → 13.00 |
| rectangles-medium | typescript | 8.40 → 6.30 | 17.50 → 14.80 |
| rectangles-large | typescript | 28.20 → 17.20 | 49.20 → 39.00 |
| rectangles-large | wasm | 30.30 → 17.60 | 46.70 → 33.80 |
| splines-small | wasm | 5.60 → 5.10 | 8.80 → 8.50 |
| splines-small | typescript | 5.20 → 4.00 | 11.20 → 9.80 |
| splines-medium | typescript | 19.50 → 8.70 | 32.20 → 20.30 |
| splines-medium | wasm | 14.50 → 11.10 | 19.80 → 16.50 |
| splines-large | wasm | 58.50 → 31.40 | 75.00 → 48.40 |
| splines-large | typescript | 96.30 → 25.40 | 137.50 → 68.40 |

For 64 splines in WASM, region p95 fell from 58.50 to 31.40 ms (46% lower), and pipeline p95 from 75.00 to 48.40 ms (35% lower). For 64 rectangles in WASM, region p95 fell from 30.30 to 17.60 ms. These are local measurements from one before/after pair of runs, executed in that order; JIT, garbage collection, timer resolution, thermal state and order can affect the difference. Small changes should be checked with repeated runs. These figures exclude pointer-event dispatch and GPU paint and are not an FPS or input-to-photon guarantee.

[Browser before](regions-before-browser.json) and [browser after](regions-after-browser.json) retain p50, p95, raw samples, region fills on/off, render/layout/frame measurements, counts and solver quality. All corresponding solver quality fields (objective, target distance, status, DoF) and model counts are exactly equal between before and after.

## Pair rejection

Counts from the initial deterministic snapshots, before dragging:

| Scene | All curve pairs | Retained exact pairs |
| --- | --- | --- |
| rectangles-small | 780 | 32 |
| rectangles-medium | 7140 | 96 |
| rectangles-large | 51040 | 256 |
| splines-small | 120 | 0 |
| splines-medium | 1128 | 0 |
| splines-large | 8128 | 0 |

Disjoint spline bounds reject entire composite pairs before expansion into cubics and before kernel packing. Bounds are recomputed each region pass, and the inexpensive bounds scan is still O(n²). The exact intersection formulas, row/column traversal order and region topology algorithm are unchanged. Remaining time includes tessellation, graph traversal, nested-contour classification and SVG path generation. Spatial indexing and incremental caching are separate future work.

## Node p95

Measured separately; no SVG/layout. [Node before](regions-before-node.json), [Node after](regions-after-node.json). Region counts, solver quality and model counts are unchanged in every case.

| Scene | Backend | Regions p95 before → after |
| --- | --- | --- |
| rectangles-small | typescript | 5.45 → 5.84 |
| rectangles-small | wasm | 3.21 → 3.85 |
| rectangles-medium | typescript | 11.19 → 12.38 |
| rectangles-medium | wasm | 11.09 → 10.52 |
| rectangles-large | typescript | 39.70 → 33.04 |
| rectangles-large | wasm | 42.35 → 33.74 |
| splines-small | typescript | 6.71 → 5.49 |
| splines-small | wasm | 7.19 → 9.91 |
| splines-medium | typescript | 21.27 → 17.55 |
| splines-medium | wasm | 28.27 → 24.55 |
| splines-large | typescript | 80.91 → 47.77 |
| splines-large | wasm | 100.08 → 61.22 |

Some small Node scenes regressed in this run, including the eight-spline WASM case. The implementation reduces exact pair counts, not every observed timing; repeat small-scene measurements before treating those differences as stable.

## Correctness and conservative fallbacks

- Five regression tests cover retained near contacts, segment parameter extension, spline interior extrema, invalid/unbounded inputs, integration with nested holes/tangent faces and 5040 deterministic mixed-curve pairs across four coordinate scales/translations in both operand orders. Every rejected pair has zero exact hits; both TypeScript and WASM run this suite.
- A separate differential check loaded the original region implementation from the before commit and compared complete results on 48 dragged scene states (six scenes × four targets × two backends). Paths, holes, areas and sampled vertices match exactly.
- Full checks passed: TypeScript/typecheck/format, 1180 default tests with 16 WASM-only skips, all 1196 actual-WASM tests, and production editor/benchmark builds.
- Bounds use cubic control hulls and full conics for arcs, with padding for existing contact/parameter/near-root tolerances and world-coordinate rounding. Segment/ellipse pairs retain the exact path because the legacy discriminant tolerance is in coefficient units; tiny ellipses can accept contacts far outside a fixed geometric margin. Missing/invalid bounds retain the exact path as well.

Reproduce the normal workloads using the [benchmark guide](../README.md). To compare against this before version, build the benchmark at the recorded before commit in a separate checkout with the same generated release WASM, then run both versions with the same sample/warm-up settings and an active tab. Do not compare against the older migration baseline as though the solver were unchanged.

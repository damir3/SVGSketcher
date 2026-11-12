# Geometry performance benchmarks

This suite compares the TypeScript reference and the release Rust/WASM backend on identical snapshots and absolute drag targets. It includes the sparse matrix and rejected-step caching optimizations in both solvers. It does **not** measure their speedup against the older dense implementation.

## Run

From the repository root, with Node dependencies and the Rust/WASM toolchain installed as described in [rust-kernel.md](../docs/rust-kernel.md):

```sh
npm run bench:build
npm run bench:serve
```

Open http://127.0.0.1:4191, keep the tab active, and click **Run comparison**. The default run executes 24 cases: six scenes, two backends, and region fills on/off. Each case restores a fresh snapshot, warms up for five frames, and measures 30 frames. Download the JSON report to retain every sample, p50/p95, solver errors, degrees of freedom, visibility state, and runtime information. A failed WASM load stops the benchmark instead of silently selecting TypeScript.

Node measurements and SVG examples:

```sh
npm run bench:node
npm run bench:node -- --samples 60 --warmup 10 --output /tmp/sketcher-bench
npm run bench:scenes
```

The Node command measures model/solver integration and region computation without a DOM. It writes `node-report.json`, six snapshot JSON files and six editable SVGs under `benchmarks/generated/` by default. `bench:scenes` exports examples without requiring compiled WASM. Open the SVGs in the normal editor for manual dragging; their metadata retains constraints and automatic spline handles. Scene snapshots are deterministic; exported SVG metadata includes its export timestamp.

## Workloads

| Family | Units: small / medium / large | Free parameters | Contents |
| --- | --- | --- | --- |
| rectangles | 8 / 24 / 64 | 64 / 192 / 512 | Independent rectangles with horizontal, vertical and distance constraints; fixed-center dimensioned circles |
| splines | 8 / 24 / 64 | 194 / 578 / 1538 | Six fit points per spline, automatic handles, dimensioned circles; one movable fit point with a distance constraint to its fixed neighbor |

The first rectangle's corner or the first spline's movable fit point follows an elliptical target path. The drag constraint is soft, as in the editor: the resulting point need not reach the target when hard dimensions prevent it. The constrained spline scenario requires numerical solution rather than only recomputing natural handles. Static geometry remains in the document to expose the cost of rebuilding, solving and rendering a larger sketch.

## Timing boundaries

- **Solve** wraps `SketchDocument.dragPoint`, including model work, constraint preparation, packing, callbacks, accepted-state updates and solver diagnostics. It is not a native-only microbenchmark.
- **Regions** in the browser uses the real renderer's `onRegionSolve` callback, including curve collection, geometry-key construction and region topology. Regions off uses a fresh empty cache, hides fills and defers region computation. Node calls `findSketchRegions` directly after each drag.
- **Render** measures the real `SVGRenderer.render` minus the separately timed region computation. Grid, geometry, dimensions and constraint badges are enabled in both backends.
- **Layout** forces pending style/layout by reading the SVG bounding rectangle.
- **Pipeline** covers solve, render and forced layout on the main thread. It excludes pointer-event delivery, the editor's interaction dispatch, asynchronous paint and GPU work.
- **Frame** spans the animation-frame callback before the pipeline to the next callback. It includes scheduling and display cadence; it is not the same metric as CPU pipeline time or input-to-photon latency.

All times are milliseconds; percentiles use nearest rank. Initialization, snapshot restoration and warm-up are excluded. Browser backend order alternates between scenes, and both backends receive the same targets. Runs are sequential; avoid simultaneous tests/builds and keep the measured tab active. Discard reports containing hidden visibility states. Timer resolution, JIT, garbage collection, thermal state and other applications affect results. Repeat the whole run before drawing conclusions from small differences.

The [saved baseline](results/baseline.md) records one local run, not a portable performance guarantee. Correctness tests validate scene determinism, backend isolation, drag parity and region counts without asserting timing thresholds.

The [region broad-phase comparison](results/region-broad-phase.md) measures the same workloads before and after rejecting separated curve bounds, against the current solver version. It includes fresh Node and browser reports for both versions.

The subsequent [native region comparison](results/native-regions.md) measures the transfer of complete region construction to Rust (kernel API 11), against the already filtered TypeScript implementation. Rebuild WASM assets when updating to this API.

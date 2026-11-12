# Trim/extend query measurements

Measured 2026-11-12T06:06:49.554Z; v20.18.0 on darwin/arm64; Rust release opt-level 3; kernel API 12. Both backends use the same six deterministic scene snapshots, prepared curves and cursor positions, with 5 warm-up and 30 measured samples per case. Backend order alternates by scene. No tests or builds ran concurrently. [Raw samples and candidates](editing-node.json), [source/binary hashes](editing-provenance.json).

## Node query p95

Milliseconds. These include query preparation, packing, native result validation and public candidate reconstruction. Curve collection, document mutations, constraint solving, SVG, layout, event delivery and GPU work are excluded. This is not a whole-editor latency or FPS comparison.

| Scene | Backend | Curves | Intersections | Trim | Extend |
| --- | --- | --- | --- | --- | --- |
| rectangles-small | typescript | 40 | 0.064 | 0.046 | 0.052 |
| rectangles-small | wasm | 40 | 0.029 | 0.043 | 0.064 |
| rectangles-medium | wasm | 120 | 0.020 | 0.019 | 0.018 |
| rectangles-medium | typescript | 120 | 0.052 | 0.067 | 0.066 |
| rectangles-large | typescript | 320 | 0.109 | 0.087 | 0.103 |
| rectangles-large | wasm | 320 | 0.047 | 0.040 | 0.041 |
| splines-small | wasm | 16 | 0.078 | 0.083 | 0.027 |
| splines-small | typescript | 16 | 0.438 | 0.269 | 0.130 |
| splines-medium | typescript | 48 | 0.305 | 0.392 | 0.097 |
| splines-medium | wasm | 48 | 0.141 | 0.152 | 0.036 |
| splines-large | wasm | 128 | 0.360 | 0.362 | 0.068 |
| splines-large | typescript | 128 | 0.848 | 0.851 | 0.308 |

For 64 splines, trim query p95 was 0.851 ms in TypeScript and 0.362 ms in WASM; extend query p95 was 0.308 versus 0.068 ms. This is one warm local run. Many samples are sub-millisecond, so JIT, allocation, garbage collection and timer noise materially affect the result; small differences require repeated runs. The TypeScript measurements use tsx rather than a production browser bundle and must not be compared directly with previous browser pipeline reports.

Candidate outputs are compared across backends at every measured cursor position, including sorted cuts, endpoints, intervals, source IDs, selected edge and full-loop decisions. This supplements 256 captured pre-routing scenes with four probes each, off-curve cursor parity, input/output validation, one-call routing checks and constraint/undo/redo tests. There are no timing assertions in correctness tests.

## Reproduce

Build the kernel using the [setup guide](../../docs/rust-kernel.md), then run:

```sh
npm run bench:editing
npm run bench:editing -- --samples 100 --warmup 10 --output /tmp/sketcher-editing
```

The default output is ignored `benchmarks/generated/editing-report.json`. Both backends are mandatory; a failed WASM load stops the benchmark. Document mutation and undo remain in TypeScript, while Rust performs candidate calculations. Generated API 11 binaries must be rebuilt for API 12.

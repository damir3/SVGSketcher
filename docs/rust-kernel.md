# Rust geometry kernel

The editor routes intersections between segments, circles, ellipses and cubic Bezier segments through a versioned `GeometryKernel` boundary. Circular and elliptical arcs use the same kernel calculations, with the existing arc-span filtering and point deduplication in the TypeScript adapter. Composite splines are expanded into cubic pairs in their original traversal order; their intersection calculations run in the active kernel.

In WASM mode, the numerical constraint-solving loop also runs in Rust: sparse Jacobian rows and normal equations, sparse LU decomposition with partial pivoting, Levenberg–Marquardt damping, projected lower bounds and sparse nullspace analysis. Rust also evaluates residuals and Jacobians for 32 built-in constraint classes: fixed, drag point, coincident, concentric, horizontal, vertical, radius, equal radius, distance, equal length, midpoint, point on circle, point on line, parallel, perpendicular, collinear, angle, tangent line/circle, tangent circle/circle, ellipse axis, point on ellipse, circular arc endpoints, elliptical arc endpoints, point-to-line distance, symmetry, circular pattern, rectangular pattern, offset, origin distance, line-to-axis distance, point on spline and solve-time automatic spline handles. Customized constraints and unusual nonclamped B-spline knot vectors retain batched TypeScript evaluation. The spline constraints construct and project curves entirely in Rust. Standalone construction, evaluation, projection and cubic splitting used by rendering, snapping and editing now use the selected kernel too. Parameter ownership, document operations, SVG formatting and viewport transforms remain in TypeScript. The original spline arithmetic is retained in `src/math/splineReference.ts` as an independent reference.

`getCurveIntersections` and region detection batch primitive pairs to reduce JS/WASM calls. A query containing composite splines submits all cubic combinations in the same batch, then filters spans and deduplicates the combined results. Region detection batches a row at a time to avoid allocating all O(n²) entity pairs at once. Kernel data consists only of world-space coordinates and curve tags; it has no DOM, viewport or inspector dependencies.

## Build and run

Install Rust 1.88 or later using your usual toolchain setup, then install the target and the CLI matching the pinned Rust dependency:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm run build:kernel
npm run dev
```

For a production WASM build:

```sh
npm run build:wasm
npm run preview
```

`npm run dev` and `npm run build` load WASM by default. Build the kernel first, or use `build:wasm` to rebuild everything together. `VITE_GEOMETRY_KERNEL=typescript npm run dev` explicitly selects the reference backend. WASM initialization completes before the editor starts. A loading, initialization or API-version failure leaves the TypeScript backend active and logs the cause to the browser console.

`WASM_BINDGEN=/path/to/wasm-bindgen` can select a CLI outside `PATH`. Generated bindings and the binary go into ignored `public/kernel/`; Vite copies them into the production build. Commit `Cargo.lock`, not the generated files. A deployment that builds only the browser bundle must also generate the kernel assets to use the default WASM backend.

## Verification

```sh
npm test
npm run test:rust
npm run build:kernel
npm run test:wasm
npm run typecheck
npm run build:wasm
```

`test:wasm` requires generated bindings and preloads the actual compiled Rust backend in every test worker. It runs the full existing editor test suite, including region, trim/extend, history and serialization coverage, rather than just isolated WASM smoke tests. Missing or invalid WASM fails the test command.

`kernelSolver.json` adds 21 solver scenarios captured before migration: empty and already-solved systems, hard/soft/conflicting constraints, temporary locks, lower radius bounds, parameter stiffness, skipped DoF, iteration limits, singular normal equations and repeated Jacobian entries at shared endpoints. The harness compares parameter values, solver status, errors, degrees of freedom, constrained parameter IDs, iteration counts and parameter-setter writes. WASM-only tests check exception propagation, malformed evaluator data, dispatch through Rust and re-entrant geometry calls during an evaluation.

`kernelConstraints.json` adds 48 residual/Jacobian snapshots captured from TypeScript before native formula dispatch. They cover the first 16 migrated types, weights, soft constraints, reordered and locked parameters, missing values, degenerate geometry and aliased references. `kernelCurvedConstraints.json` adds 50 snapshots for the next eight types, including angle direction/axis variants, internal/external/shared-point tangency, collapsed axes, arc endpoints and missing radii. Both backends are checked against these snapshots. Additional WASM tests verify that fully native systems, including every newly migrated type, request only commit callbacks, mixed native/custom rows retain their positions, and malformed native programs are rejected.

`kernelCurvedSolver.json` contains 14 additional solver scenarios captured from TypeScript before the curved formulas moved to Rust, with source hashes. These compare status, iteration count, setter writes, DoF, constrained parameters and errors using the original strict checks. Coordinates use an absolute tolerance of 1e-8 plus the original relative tolerance: finite differences with a 1e-5 step amplify the rounding differences between JavaScript `Math.hypot` and Rust `hypot` in under-constrained systems. The original 21 solver scenarios retain their coordinate tolerance of 1e-10. The default solver convergence tolerance remains 1e-6.

`kernelPatternConstraints.json` adds 60 formula snapshots for symmetry, circular/rectangular arrays and offsets. They cover all distribution modes, suppression, empty arrays, radius pairs, oblique and collapsed axes, shared parameters, missing geometry, tiny unfiltered coefficients and mixed line/circle/spline offset chains. `kernelPatternSolver.json` adds 20 pre-port solver scenarios with source hashes. Coordinates retain a 1e-8 absolute tolerance except four line-offset cases at 1e-7: their 1e-6 difference step amplifies rounding in under-constrained motion along the line. Status, iteration counts, setter writes, DoF and errors keep the original strict checks. Separate tests assert that offset parents and suppressed copies remain exactly unchanged, that composite compilation falls back atomically, and that all migrated types solve without JS formula callbacks.

`kernelAxisConstraints.json` adds 56 snapshots for origin/axis constraints: radial, horizontal, vertical, coincidence, collinearity, positive/negative sides and targets, zero targets, missing coordinates, shared endpoints, locked parameters, soft weights and derivative cutoffs. `kernelAxisSolver.json` adds 20 pre-port solver scenarios, including conflicts, singular radial equations at the origin, soft/hard orderings, drag and temporary locks. All solver checks retain the original 1e-10 absolute/relative tolerance, including coordinates. Both files record source hashes. WASM-only tests also reject invalid axis modes, nonconstant side references and incorrect coincidence row counts.

`kernelSplineMath.json`, `kernelSplineConstraints.json` and `kernelSplineSolver.json` contain 23 construction/projection datasets, 57 residual/Jacobian cases and 14 solver scenarios captured from unchanged TypeScript sources, with hashes. They cover fit/control curves, open/closed/retraced/collapsed geometry, explicit and partial handles, nonuniform/repeated knots, missing coordinates, fit/child aliases, locks and soft weights. Solver status, iterations, errors, DoF, setter writes and coordinates retain the original 1e-10 absolute/relative tolerance. Actual compiled WASM also runs 100 seeded fit/control Jacobian comparisons, validates malformed variable-size records and confirms that both spline constraint classes request only commit callbacks during a solve.

`test/fixtures/kernelIntersections.json` contains 43 golden cases captured from the pre-migration implementation at the recorded commit. They cover endpoint clamping, degenerate and overlapping segments, solver-roundoff tangencies at different lengths, circle contacts and arc directions. `kernelEllipses.json` adds 38 pre-migration cases for rotated and translated ellipses, four crossings, tangencies, degenerate axes and circular/elliptical arc combinations. `kernelSplines.json` adds 34 cases for single/multiple/closed/empty splines, cubic/cubic crossings, endpoint and near-endpoint contacts, finite segments, tangencies and both arc directions. The latter fixture files identify their captured implementation with a source-file SHA-256. Both backends run against these independent expected values, individually and in a mixed batch. The WASM suite also compares 1500 segment/circle pairs, 1200 ellipse pairs and 600 cubic pairs against TypeScript. The default TypeScript suite skips those three WASM-specific parity tests.

## Boundary and next steps

- `crates/sketcher-core` contains native-testable geometry without JavaScript dependencies.
- `crates/sketcher-wasm` validates and decodes packed pairs and exports API version 10 through `wasm-bindgen`. Older binaries are rejected before use; rebuild the kernel after updating the source.
- `src/kernel` contains the shared contract, TypeScript backend, WASM adapter and browser initialization.
- Each input curve occupies nine `f64` slots: segment `[0, x1, y1, x2, y2, 0, 0, 0, 0]`, circle `[1, cx, cy, radius, 0, 0, 0, 0, 0]`, ellipse `[2, cx, cy, majorX, majorY, minorX, minorY, 0, 0]`, cubic `[3, x0, y0, x1, y1, x2, y2, x3, y3]`. Every input pair produces `[count, x, y, ...]`, including a count of zero for an empty result. Inputs must contain finite coordinates and nonnegative radii.
- Candidate ordering and existing tolerances are preserved. Arc filtering precedes deduplication so a discarded candidate cannot hide a valid arc contact.

The sampled ellipse/conic root finder retains its existing 128 intervals, 28 bisection steps, tolerances and candidate ordering. This migration does not redesign tangency detection or coincident-ellipse handling. Candidates are filtered by arc span before deduplication, so the packed result allows up to 128 raw candidates for ellipse pairs, including degenerate coincidence cases.

Cubic/conic and cubic/segment calculations retain 16 sampling intervals, 28 bisection steps and the additional near-root check at the final sample. Cubic/cubic calculations retain bounding-box subdivision, depth 15, four Newton refinement steps, the cap of 16 candidate contacts and per-pair deduplication at 1e-3. Composite spline results are subsequently deduplicated at 1e-4 after arc-span filtering. The packed protocol allows up to 17 candidates for a pair containing a cubic.

## Numerical solver boundary

`NumericalSolver.solve` dispatches to the selected kernel's optional `solveSystem`; if absent, it runs the TypeScript solver. Both implementations use sparse rows, duplicate-entry merging, sparse normal equations/LU/nullspace analysis and cached linearization across rejected LM steps. The release profile uses `opt-level = 3`. Fully native systems assemble sparse Jacobians directly through `Program.evaluate_sparse`; mixed JS/native systems retain the dense numeric callback buffer before sparse assembly. `src/solver/kernelAdapter.ts` prepares free parameter indices, hard constraints, stiffness and lower bounds, and converts the result to existing parameter IDs and statuses. `src/solver/nativeConstraints.ts` compiles supported constraints once per solve. Custom subclasses or overridden formula methods retain TypeScript evaluation. The staged radius policy, spline-handle preparation and drag constraints in `SketchDocument.solve` retain their existing behavior.

`solve_system` receives the current free values, stiffness, lower bounds, settings `[equations, hardEquations, skipDoF, maxIterations, tolerance, initialLambda, lambdaFactor, minLambda, maxLambda]`, and packed native constraints. Each native record is `[kind, allRow, hardRowOrMinusOne, weight, a, b, refCount, ...[freeIndexOrMinusOne, constantValue]]`. A negative parameter index denotes a fixed or missing parameter. Rust validates tags, arities, variants, finite constants, parameter indices and non-overlapping equation rows before solving.

The curved constraints add the following tags. Each point below occupies two references (x, y); angle orientation factors are constant references with index -1.

| Kind | References | a | b |
| --- | --- | --- | --- |
| 14: angle | line endpoints (four points), s1, s2, sign | target degrees | axis scaling: 0 neither, 1 first, 2 second |
| 15: line/circle tangency | center, line endpoints, radius | initial side | unused |
| 16: circle/circle tangency | centers, radii | target: 0 sum, 1 first minus second, 2 second minus first | unused |
| 17: point on ellipse | center, major-axis point, minor-axis point, point | unused | unused |
| 18: elliptical arc endpoints | center, major-axis point, minor-axis point, start, end | unused | unused |
| 19: circular arc endpoints | center, start, end, radius | unused | unused |
| 20: point-to-line distance | point, line endpoints | target distance | side |

Shared-point circle tangency reuses kind 10 (point on line through the centers). Ellipse axis perpendicularity reuses kind 12 with an aliased center reference. These preserve the original numerical Jacobians, including perturbing every reference to a shared parameter together. Circular arc endpoints retain their analytic Jacobians.

`src/solver/nativePatterns.ts` expands composite constraints into multiple records in their original equation order. Suppressed copies produce no records; pattern radius pairs reuse kind 5 with pattern radius first. Each record carries both its full-system row and its hard-system row, so empty, soft and mixed JS/native constraints preserve their offsets. If any record cannot be compiled, the entire constraint retains JS evaluation. Native record buffers are appended without spreading them into JavaScript function arguments, including a single variable-size spline record. A 10,000-point packing test checks this limit without attempting a dense solve of that size.

| Kind | References | a | b |
| --- | --- | --- | --- |
| 21: symmetry | point 1, point 2, line endpoints | 0 line, 1 origin | unused |
| 22: circular pattern point | center, source, copy, constant copy index, constant quantity | total degrees | 0 full, 1 partial, 2 symmetric |
| 23: rectangular pattern point | source, copy, line 1 endpoints, line 2 endpoints, constant i, j, direction 1, direction 2, line 1 present, line 2 present | distance 1 | distance 2 |
| 24: offset line endpoint | child endpoint, original line endpoints | distance | side |
| 25: offset circle | child center, original center, child radius, original radius | distance | side |
| 26: offset spline point | child point, constant base point, constant normal, constant side | distance | unused |

Rectangular direction flags are 0 for one direction and 1 for symmetric; presence flags are 0/1. Rust retains the circular quantity rounding, signed copy distributions, rectangular fallback directions at length <= 1e-6, analytic pattern derivatives and the original unfiltered point coefficients. Offset line residuals retain the left-hand sign, 1e-9 length floor and 1e-6 forward differences. All offset Jacobians intentionally drive only child parameters, including the original alias behavior, so master geometry remains unchanged unless another constraint moves it. Spline offsets use stored base positions and normals; this does not migrate spline construction or projection.

Origin and axis constraints use two additional records:

| Kind | References | a | b |
| --- | --- | --- | --- |
| 27: origin distance | point x, point y, constant side | target distance (unused for coincidence) | 0 radial, 1 horizontal, 2 vertical, 3 coincidence |
| 28: line-to-axis distance | selected coordinate of endpoint 1, selected coordinate of endpoint 2, constant side | target distance (unused for collinearity) | 0 distance, 1 collinear |

Kind 27 produces two equations for coincidence and one otherwise; kind 28 always produces two, even for shared endpoints. The compiler selects y coordinates for distance to the X-axis and x coordinates for distance to the Y-axis. These refer to the world origin and axes, independently of similarly named map parameters. The analytic Jacobians retain the 1e-7 radial length floor, division-then-weight operation order and 1e-12 coefficient cutoff. Zero-distance horizontal/vertical equations and coincidence ignore the side; collinear equations ignore both side and distance. Unspecified point orientation retains radial behavior.

Spline records are variable-size and validated before indexing:

| Kind | References | a | b | Equations |
| --- | --- | --- | --- | --- |
| 29: point on spline | target x/y, N curve points; fit tail: N blocks `[constant enabled, h1x, h1y, h2x, h2y]`; control tail: zero or N+4 constant knots | 0 fit, 1 control | N | 1 |
| 30: automatic handles | N fit points, H blocks `[constant fit index, child1x, child1y, child2x, child2y]` | N | H | 4H |

`src/solver/nativeSplines.ts` compiles these records; `crates/sketcher-core/src/constraints/splines.rs` evaluates them. Cubic B-splines preserve linear/quadratic degree elevation and Boehm knot insertion. Fit curves preserve the natural handle formula, 1e-4 closed-seam test, 1e-6 direction threshold, curvature clamp and explicit-handle overrides. Valid clamped nondecreasing explicit knot vectors run natively; other full-length vectors retain JS evaluation. Short knot vectors retain uniform-knot behavior, and knots on curves with fewer than five points remain unused.

Projection retains 12 sample steps per segment, 10 refinement iterations with constants 0.382/0.618, strict comparisons, normalized segment indexing and the 1e-7 tangent-length floor. Its scaled two-coordinate norm matches the captured TS behavior on retraced curves, where one rounding bit can select a different equally close branch. The point-on-spline residual remains signed distance along the projected normal, including the reference behavior beyond endpoints. Its Jacobian uses the existing 1e-5 forward differences and relevance metadata.

Automatic handles retain direct child coefficients plus numerical fit-point derivatives in fit-point insertion order, including the original double contribution when a fit parameter aliases a child. This class ignores its weight in both implementations and remains a solve-time constraint, without changing document serialization. Customized private natural-handle helpers retain JS evaluation.

The `spline_geometry(points, handles, knots, settings)` WASM export serves the editor and independent verification. Settings are `[mode, targetX, targetY, parameter]`; mode 0 returns natural handle coordinates (four slots per point), mode 1 fit cubics, mode 2 control cubics (eight slots per cubic). Mode 3 retains the combined verification query `[parameter, distance, projectedX, projectedY, tangentX, tangentY, sampleX, sampleY]`. Modes 4/5 evaluate normalized position/tangent and return two coordinates. Modes 6/7 evaluate a single cubic/derivative at an unclamped parameter; mode 8 splits one cubic into two (16 coordinates). Mode 9 projects and returns only `[parameter, distance, projectedX, projectedY]`. Scalar evaluation and tangent calls do not run the projection search.

`GeometryKernel.spline` exposes these operations as typed points, cubics, handle pairs and projections. `src/kernel/splineWasm.ts` validates output counts, finite coordinates and projection bounds before returning geometry. Unusual knot vectors and non-finite legacy arguments retain reference behavior. The public `src/math/spline.ts` API still returns `Vec2` instances and preserves shared split endpoints, B-spline joins, empty-curve projection identity and unmodified input data. Its higher-level split/trim/interval functions compose native cubic splits; SVG string generation and viewport transforms remain in TS. The default TS path calls the reference functions directly without repacking vectors. JS constraint formulas import the reference module directly so that they remain independent of the active geometry backend.

`kernelSplineEditing.json` adds 160 pre-routing split, trim and interval snapshots, including clamped and extrapolated parameters. The routing tests verify reference-file identity, vector semantics, every native operation mode and corrupt-result rejection. The existing spline, snapping, region, history and serialization tests now exercise the public routed API with WASM as well as the optimized sparse solver.

Systems entirely covered by native formulas need only accepted-state commit callbacks. For mixed systems, Rust requests one callback per phase that has uncovered rows; TypeScript fills only those rows in the full-sized buffer, then Rust fills native rows:

| Mode | Response |
| --- | --- |
| 0 | All residuals |
| 1 | All residuals followed by a dense row-major Jacobian |
| 2 | Hard-constraint residuals |
| 3 | Hard-constraint Jacobian |
| 4 | Commit the accepted parameter state; return an empty array |

Evaluation inputs and outputs are copied numeric buffers. Rust retains the authoritative trial state during a solve, so callback re-entry or WASM memory growth cannot invalidate a JavaScript view. The result is `[status, iterations, initialError, finalError, DoF, fixedCount, ...values, ...fixedIndices]`, with status tags 0 (converged), 1 (under-constrained), 2 (over-constrained). API compatibility and result shapes are checked before the result is exposed to the model. Exceptions propagate instead of silently running a second solver after partial commits.

Native Jacobians retain the original analytic derivatives, forward/central finite differences, step sizes, derivative cutoffs and accumulation of shared parameter references. The `evaluate_constraints` export evaluates native rows independently for parity tests; its settings are `[equations, hardEquations, mode]` using the same modes above.

The [performance suite](../benchmarks/README.md) now provides six deterministic large scenes, Node solver/region measurements and a browser model-to-SVG drag comparison with region fills on/off. Reports include raw samples, p50/p95, solver errors and degrees of freedom; the pipeline measurement includes packing and callbacks. Both backends include the sparse solver optimizations, so this comparison does not measure their gain over the old dense implementation.

Next, reduce costs identified in these measurements and migrate higher-level editing computations where they justify native batching. Document state should move to Rust only after mutation operations have an explicit command/patch contract. Small scalar operations can cost more at the boundary even when larger projections benefit from native loops.

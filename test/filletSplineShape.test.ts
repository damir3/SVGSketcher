import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { calculateFilletGeometry, commitFilletToSketch, type FilletCandidate } from '../src/math/fillet';
import { extractSplineInterval, evaluateBezier, type BezierSegment } from '../src/math/splineReference';

const source = JSON.parse(
	readFileSync(new URL('./fixtures/fillet-spline-shape.json', import.meta.url), 'utf8')
) as ReturnType<SketchDocument['takeSnapshot']>;

for (const reverse of [false, true])
	for (const splineFirst of [false, true])
		for (const radius of [3, 10, 20])
			test(`fillet preserves uncut spline spans and join handles: ${reverse ? 'end' : 'start'}, spline ${splineFirst ? 'first' : 'second'}, R=${radius}`, () => {
				const snapshot = structuredClone(source);
				if (reverse) {
					snapshot.splines[0].pointIds.reverse();
					snapshot.splines[0].tangentLineIds!.reverse();
					for (const line of snapshot.lines) if (line.isSplineHandle) [line.p1Id, line.p2Id] = [line.p2Id, line.p1Id];
				}
				const sketch = new SketchDocument();
				sketch.restoreSnapshot(snapshot);
				sketch.clearHistory();
				const before = sketch.takeSnapshot();
				const spline = sketch.splines.get('Spline-1')!.toGeoCurve(sketch)!;
				const line = sketch.lines.get('Line-43')!.toGeoCurve(sketch)!;
				const options = {
					cornerVertex: sketch.points.get('Point-97')!.clone(),
					endPointId1: 'Point-97',
					endPointId2: 'Point-97',
				};
				const result = calculateFilletGeometry(
					splineFirst ? spline : line,
					splineFirst ? line : spline,
					radius,
					options
				);
				assert.ok(result);
				const param = splineFirst ? result.param1 : result.param2;
				assert.ok(reverse ? param > 0.5 && param < 1 : param > 0 && param < 0.5);
				const expected = extractSplineInterval(spline.bezierSegments, reverse ? 0 : param, reverse ? param : 1);
				const candidate: FilletCandidate = {
					id: 'shape',
					vertexPointId: 'Point-97',
					...options,
					primitive1: { type: splineFirst ? 'spline' : 'line', id: splineFirst ? spline.id : line.id },
					primitive2: { type: splineFirst ? 'line' : 'spline', id: splineFirst ? line.id : spline.id },
					result,
				};
				function checkShape() {
					const id = (splineFirst ? candidate.primitive1 : candidate.primitive2).id;
					const remaining = sketch.splines.get(id)!.toGeoCurve(sketch)!;
					assert.equal(remaining.splineType, 'fit');
					assert.equal(remaining.bezierSegments.length, expected.length);
					for (let i = 0; i < expected.length; i++) {
						const actual = remaining.bezierSegments[i] as BezierSegment;
						const cutSpan = reverse ? i === expected.length - 1 : i === 0;
						// Tangency solving may adjust the new cut endpoint and its handle.
						// The interior join and every untouched span must remain exact.
						const checkEntireSpan = !cutSpan || (radius === 10 && !splineFirst);
						for (let j = 0; j < 4; j++) {
							if (!checkEntireSpan && (reverse ? j >= 2 : j <= 1)) continue;
							assert.ok(
								actual[j].distanceTo(expected[i][j]) < 1e-7,
								`segment ${i} control ${j} moved by ${actual[j].distanceTo(expected[i][j])}`
							);
						}
						if (!checkEntireSpan) continue;
						for (let k = 0; k <= 20; k++)
							assert.ok(
								evaluateBezier(actual, k / 20).distanceTo(evaluateBezier(expected[i], k / 20)) < 1e-7,
								`segment ${i} changed shape`
							);
					}
				}
				sketch.beginTransaction();
				sketch.withDeferredSolve(() => {
					assert.ok(commitFilletToSketch(sketch, candidate, true));
					checkShape();
				});
				sketch.commitTransaction();
				checkShape();
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				assert.equal(sketch.undo(), true);
				assert.deepEqual(sketch.takeSnapshot(), before);
				assert.equal(sketch.redo(), true);
				checkShape();
			});

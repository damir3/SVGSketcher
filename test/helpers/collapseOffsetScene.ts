import { SketchDocument } from '../../src/model/sketch';
import type { OffsetChain } from '../../src/math/offset';
import { Vec2 } from '../../src/math/vector';
import { mixedOffsetScene, openSplineLoopScene } from './mixedOffsetScene';

export const collapseKinds = [
	'circle',
	'ellipse',
	'rectangle',
	'triangle',
	'closed-spline',
	'annular-sector',
	'mixed',
	'split-spline',
] as const;
export type CollapseKind = (typeof collapseKinds)[number];
export function collapseOffsetScene(kind: CollapseKind) {
	if (kind === 'mixed') return { ...mixedOffsetScene('mixed'), small: 4, empty: 100 };
	if (kind === 'split-spline') return { ...openSplineLoopScene(), small: 10, empty: 100 };
	const sketch = new SketchDocument();
	let chain!: OffsetChain,
		empty = 5;
	sketch.withDeferredSolve(() => {
		if (kind === 'circle' || kind === 'ellipse') {
			const c = sketch.addPoint(new Vec2(0, 0));
			const shape =
				kind === 'circle'
					? sketch.addCircle(c.id, 5)
					: sketch.addEllipse(c.id, sketch.addPoint(new Vec2(10, 0)).id, sketch.addPoint(new Vec2(0, 5)).id);
			chain = { items: [{ id: shape.id, type: kind }], isClosed: true };
		} else if (kind === 'closed-spline') {
			const coords = [new Vec2(5, 0), new Vec2(0, 5), new Vec2(-5, 0), new Vec2(0, -5)],
				points = coords.map(p => sketch.addPoint(p));
			const handles = coords.map(p => {
				const t = p.clone().perpendicular().multiplyScalar(0.5522847498307936);
				return { h1: p.clone().sub(t), h2: p.clone().add(t) };
			});
			const spline = sketch.addFitSpline([...points.map(p => p.id), points[0].id], undefined, false, undefined, true, [
				...handles,
				handles[0],
			]);
			chain = {
				items: [{ id: spline.id, type: 'spline', startPointId: points[0].id, endPointId: points[0].id }],
				isClosed: true,
			};
		} else if (kind === 'annular-sector') {
			const c = sketch.addPoint(new Vec2(0, 0)),
				points = [
					[12, 0],
					[-12, 0],
					[-10, 0],
					[10, 0],
				].map(([x, y]) => sketch.addPoint(new Vec2(x, y)));
			const outer = sketch.addArc(c.id, points[0].id, points[1].id, 12, false),
				inner = sketch.addArc(c.id, points[2].id, points[3].id, 10, true);
			const a = sketch.addLine(points[1].id, points[2].id),
				b = sketch.addLine(points[3].id, points[0].id);
			chain = {
				isClosed: true,
				items: [
					{ id: outer.id, type: 'arc', startPointId: points[0].id, endPointId: points[1].id },
					{ id: a.id, type: 'line', startPointId: points[1].id, endPointId: points[2].id },
					{ id: inner.id, type: 'arc', startPointId: points[2].id, endPointId: points[3].id },
					{ id: b.id, type: 'line', startPointId: points[3].id, endPointId: points[0].id },
				],
			};
			empty = 1;
		} else {
			const coords =
				kind === 'triangle'
					? [
							[0, 0],
							[10, 0],
							[5, 5 * Math.sqrt(3)],
						]
					: [
							[0, 0],
							[10, 0],
							[10, 8],
							[0, 8],
						];
			const points = coords.map(([x, y]) => sketch.addPoint(new Vec2(x, y)));
			chain = {
				isClosed: true,
				items: points.map((p, i) => {
					const q = points[(i + 1) % points.length],
						line = sketch.addLine(p.id, q.id);
					return { id: line.id, type: 'line', startPointId: p.id, endPointId: q.id };
				}),
			};
			empty = kind === 'triangle' ? (5 * Math.sqrt(3)) / 3 : 4;
		}
	});
	sketch.clearHistory();
	return { sketch, chain, small: empty * 0.8, empty };
}

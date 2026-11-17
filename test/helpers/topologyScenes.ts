import { SketchDocument } from '../../src/model/sketch';
import { CoincidentConstraint } from '../../src/solver/constraints';
import type { ChainItem } from '../../src/math/offset';

export function createTopologyScenes() {
	return ['open', 'loop', 'branch', 'constraints', 'builtins', 'tolerance', 'mixed', 'extreme'].flatMap(kind =>
		[false, true].map(reverse => {
			const sketch = new SketchDocument();
			const p = (x: number, y: number) => sketch.addPoint({ x, y }, true);
			const link = (a: string, b: string) => {
				const id = `coincident-${sketch.constraints.size}`;
				sketch.constraints.set(id, new CoincidentConstraint(id, a, b));
			};
			sketch.withDeferredSolve(() => {
				const points = [p(10, 10), p(20, 10), p(30, 10), p(40, 10), p(20, 20)];
				const line = (a: number, b: number) => sketch.addLine(points[reverse ? b : a].id, points[reverse ? a : b].id);
				line(0, 1);
				line(1, 2);
				line(2, 3);
				if (kind === 'loop') line(3, 0);
				if (kind === 'branch') line(1, 4);
				if (kind === 'open') {
					const duplicate = p(20.0005, 10);
					sketch.lines.values().next().value!.p2Id = duplicate.id;
					const handle = sketch.addLine(points[1].id, points[4].id);
					handle.isSplineHandle = true;
					sketch.addLine(points[1].id, points[4].id, true);
				}
				if (kind === 'constraints') {
					link(points[0].id, 'missing-a');
					link('missing-a', points[3].id);
					link(points[1].id, 'missing-b');
					link('missing-b', points[4].id);
					link(points[2].id, points[2].id);
				}
				if (kind === 'builtins') {
					const a = p(0.0008, 0),
						b = p(0.0016, 0),
						x = p(1, 0),
						y = p(0, 1);
					sketch.addLine('origin', a.id);
					sketch.addLine(b.id, x.id);
					sketch.addLine('axis_x', y.id);
					link('axis_x', points[4].id);
					link('origin', 'missing-origin');
				}
				if (kind === 'tolerance') {
					for (const [x, y] of [
						[0, 0],
						[0.0006, 0.0008],
						[0.001, 0],
						[0.001000000001, 0],
						[-0.001, 0],
						[-0.0016, 0],
						[0.003, 0],
					])
						p(x, y);
				}
				if (kind === 'mixed') {
					const center = p(40, 20),
						end = p(50, 20);
					sketch.addArc(center.id, points[3].id, end.id, 10, false);
					sketch.addControlSpline([end.id, points[4].id, points[0].id]);
					sketch.addCircle(center.id, 3);
				}
				if (kind === 'extreme') {
					const a = p(1e200, -1e200),
						b = p(1e200, -1e200),
						c = p(-1e200, 1e200);
					sketch.addLine(a.id, points[0].id);
					sketch.addLine(b.id, c.id);
				}
			});
			const primitives: { id: string; type: ChainItem['type'] }[] = [
				...[...sketch.lines.values()].map(l => ({ id: l.id, type: 'line' as const })),
				...[...sketch.arcs.values()].map(l => ({ id: l.id, type: 'arc' as const })),
				...[...sketch.circles.values()].map(l => ({ id: l.id, type: 'circle' as const })),
				...[...sketch.splines.values()].map(l => ({ id: l.id, type: 'spline' as const })),
			];
			return { name: `${kind}/${reverse ? 'reverse' : 'forward'}`, sketch, primitives };
		})
	);
}

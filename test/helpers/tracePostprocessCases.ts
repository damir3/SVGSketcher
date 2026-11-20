import { Vec2 } from '../../src/math/vector';
import type {
	TraceRelationInput,
	TraceRelations,
	TracePostprocessKernel,
} from '../../src/kernel/tracePostprocessTypes';
import { inferTraceConstraints } from '../../src/model/imageTrace/postprocess';
import type { SketchDocument } from '../../src/model/sketch';

export function applyTraceRelations(input: TraceRelationInput, kernel: TracePostprocessKernel): TraceRelations {
	const out: TraceRelations = {
		axes: [],
		parallel: [],
		perpendicular: [],
		equalLength: [],
		equalRadius: [],
		concentric: [],
	};
	const points = new Map<string, Vec2>(),
		lines = new Map();
	input.lines.forEach((line, i) => {
		lines.set('L' + i, { p1Id: `A${i}`, p2Id: `B${i}` });
		if (line) {
			points.set('A' + i, Vec2.from(line[0]));
			points.set('B' + i, Vec2.from(line[1]));
		}
	});
	input.radial.forEach((r, i) => {
		if (r.center) points.set('C' + i, Vec2.from(r.center));
	});
	let id = 0;
	const c = () => ({ id: String(id++), entityIds: [] });
	const pair = (a: string, b: string) => [Number(a.slice(1)), Number(b.slice(1))] as const;
	const rejected = (pairs: readonly (readonly [number, number])[] | undefined, a: number, b: number) =>
		pairs?.some(p => p[0] === a && p[1] === b);
	const sketch = {
		points,
		lines,
		addHorizontalConstraint(a: string) {
			out.axes.push({ line: Number(a.slice(1)), vertical: false });
			return c();
		},
		addVerticalConstraint(a: string) {
			out.axes.push({ line: Number(a.slice(1)), vertical: true });
			return c();
		},
		addParallelConstraint(a: string, b: string) {
			out.parallel.push(pair(a, b));
			return c();
		},
		addPerpendicularConstraint(a: string, b: string) {
			const p = pair(a, b);
			if (rejected(input.rejectedPerpendicular, ...p)) return null;
			out.perpendicular.push(p);
			return c();
		},
		addEqualLengthConstraint(a: string, b: string) {
			out.equalLength.push(pair(a, b));
			return c();
		},
		addEqualRadiusConstraint(a: string, b: string) {
			out.equalRadius.push(pair(a, b));
			return c();
		},
		addConcentricConstraint(a: string, b: string) {
			const p = pair(a, b);
			if (rejected(input.rejectedConcentric, ...p)) return null;
			out.concentric.push(p);
			return c();
		},
	} as unknown as SketchDocument;
	inferTraceConstraints(
		sketch,
		{
			angleTolerance: input.angleTolerance,
			tolerance: input.tolerance,
			constraints: {
				horizontalVertical: input.horizontalVertical,
				parallelPerpendicular: input.parallelPerpendicular,
				equal: input.equal,
				concentric: input.concentric,
			},
		} as any,
		input.scale,
		input.lines.map((_, i) => 'L' + i),
		input.radial.map((r, i) => ({ id: 'R' + i, centerId: 'C' + i, radius: r.radius })),
		[],
		kernel
	);
	return out;
}

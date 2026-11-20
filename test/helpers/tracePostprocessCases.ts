import { Vec2 } from '../../src/math/vector';
import { createTraceTransform, inferAxisAndRelations } from '../../src/model/imageTrace/buildReference';
import type { TraceRelationInput, TraceRelations, TracePlacementInput } from '../../src/kernel/tracePostprocessTypes';
import type { SketchDocument } from '../../src/model/sketch';
export function referencePlacement(input: TracePlacementInput) {
	const transform = createTraceTransform(input, input.placement),
		points = input.points.map(transform.toWorld);
	return {
		scale: transform.scale,
		points,
		radii: input.radii.map(r => r * transform.scale),
		clockwise: input.arcs.map(
			([a, m, b]) => new Vec2().subVectors(points[m], points[a]).cross(new Vec2().subVectors(points[b], points[m])) < 0
		),
	};
}
export function referenceRelations(input: TraceRelationInput, infer = inferAxisAndRelations): TraceRelations {
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
	infer(
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
		[]
	);
	return out;
}
export function tracePostprocessCases() {
	const placements = [];
	for (const angle of [0, 90, -27.5, 725])
		for (const yScale of [0.75, 1, 1.3])
			for (const size of [
				[100, 60],
				[60, 100],
			]) {
				const input = {
					width: 80,
					height: 40,
					yScale,
					placement: { x: 13, y: -27, width: size[0], height: size[1], angle },
					points: [
						{ x: 0, y: 0 },
						{ x: 40, y: 20 },
						{ x: 80, y: 40 },
						{ x: 10, y: 35 },
						{ x: 1e90, y: -2e90 },
					],
					radii: [1, 17.5],
					arcs: [
						[0, 1, 3],
						[1, 2, 3],
					] as const,
				};
				placements.push({ input, expected: referencePlacement(input) });
			}
	const relations = [];
	let seed = 831235;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	for (let scene = 0; scene < 48; scene++)
		for (const flags of [0, 1, 2, 4, 8, 15]) {
			const angles = [0, 0.4, 179.6, 179.8, 10, 99.6, 100.4, 35, 125, 35.2];
			const lines = angles.map((angle, i) => {
				const length = 10 + Math.floor(random() * 4) * 0.06;
				return [
					{ x: i, y: -i },
					{ x: i + Math.cos((angle * Math.PI) / 180) * length, y: -i + Math.sin((angle * Math.PI) / 180) * length },
				] as const;
			});
			const input: TraceRelationInput = {
				lines: scene % 3 === 0 ? [...lines, null] : lines,
				radial: Array.from({ length: 8 }, (_, i) => ({
					center: i === 7 ? null : { x: Math.floor(i / 3) * 20 + (i % 3) * 0.04, y: i % 3 === 0 ? 0 : 0.03 },
					radius: 3 + Math.floor(random() * 3) * 0.02,
				})),
				angleTolerance: [0, 0.5, 1, 3][scene % 4],
				tolerance: [0, 0.01, 0.1, 1][scene % 4],
				scale: [0.1, 1, 10][scene % 3],
				horizontalVertical: !!(flags & 1),
				parallelPerpendicular: !!(flags & 2),
				equal: !!(flags & 4),
				concentric: !!(flags & 8),
			};
			const expected = referenceRelations(input);
			relations.push({ input, expected });
			if (flags === 15 && (expected.perpendicular.length || expected.concentric.length)) {
				const rejected = {
					...input,
					rejectedPerpendicular: expected.perpendicular.slice(0, 1),
					rejectedConcentric: expected.concentric.slice(0, 1),
				};
				relations.push({ input: rejected, expected: referenceRelations(rejected) });
			}
		}
	const displacements = [];
	for (const threshold of [0, 0.001, 1, 1e20]) {
		const original = [new Vec2(), new Vec2(2, 3), new Vec2(10, 10), new Vec2(-1e308, 0)],
			current = [new Vec2(), new Vec2(2 + threshold, 3), new Vec2(10 + threshold * 1.01, 10), new Vec2(1e308, 0)];
		displacements.push({
			original,
			current,
			threshold,
			expected: original.flatMap((p, i) => (p.distanceTo(current[i]) > threshold ? [i] : [])),
		});
	}
	return { placements, relations, displacements };
}

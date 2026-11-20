import { getGeometryKernel } from '../../kernel';
import type {
	TracePlacementInput,
	TracePlacementResult,
	TraceRelationInput,
	TracePair,
} from '../../kernel/tracePostprocessTypes';
import { Vec2, type XY } from '../../math/vector';
import type { TracePlacement } from './build';
import type { TraceResult, ImageTraceSettings } from './types';
import type { SketchDocument } from '../sketch';
import type { IConstraint } from '../../solver/types';
import * as reference from './buildReference';
const finite = (p: XY) => Number.isFinite(p.x) && Number.isFinite(p.y);
export function placeTrace(input: TracePlacementInput): TracePlacementResult {
	const api = getGeometryKernel().tracePostprocess;
	const p = input.placement;
	if (
		api &&
		[input.width, input.height, input.yScale].every(v => Number.isFinite(v) && v > 0) &&
		[p.x, p.y, p.width, p.height, p.angle, ...input.radii].every(Number.isFinite) &&
		input.points.every(finite)
	)
		return api.place(input);
	const transform = reference.createTraceTransform(input, p),
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
/** Snapshot all source coordinates, widths and arc turns in one query, without modifying the trace result. */
export function prepareTracePlacement(result: TraceResult, placement: TracePlacement) {
	const points: XY[] = [],
		indices = new Map<XY, number>(),
		radii: number[] = [],
		arcs: Array<[number, number, number]> = [],
		radiusIndices = new Map<object, number>(),
		arcIndices = new Map<object, number>();
	const add = (p: XY) => {
		let i = indices.get(p);
		if (i === undefined) {
			i = points.length;
			indices.set(p, i);
			points.push(p);
		}
		return i;
	};
	const handles = (h: readonly { h1: XY; h2: XY }[]) => {
		for (const p of h) {
			add(p.h1);
			add(p.h2);
		}
	};
	const radius = (source: object, r: number) => {
		radiusIndices.set(source, radii.length);
		radii.push(r);
	};
	result.vertices.forEach(add);
	for (const path of result.paths)
		for (const segment of path.segments) {
			if (segment.kind === 'arc') {
				add(segment.center);
				radius(segment, segment.radius);
				arcIndices.set(segment, arcs.length);
				arcs.push([add(result.vertices[segment.a]), add(segment.mid), add(result.vertices[segment.b])]);
			} else if (segment.kind === 'spline') {
				segment.points.forEach(add);
				handles(segment.handles);
			}
		}
	for (const circle of result.circles) {
		add(circle.center);
		radius(circle, circle.radius);
	}
	for (const spline of result.closedSplines) {
		spline.points.forEach(add);
		handles(spline.handles);
	}
	const out = placeTrace({ ...result, placement, points, radii, arcs });
	return {
		scale: out.scale,
		toWorld: (p: XY) => {
			const i = indices.get(p);
			if (i === undefined) throw Error('Missing trace placement point');
			return Vec2.from(out.points[i]);
		},
		radius: (p: object) => out.radii[radiusIndices.get(p)!],
		clockwise: (p: object) => out.clockwise[arcIndices.get(p)!],
	};
}
interface Inferred {
	constraint: IConstraint;
	group: 'tangent' | 'axis' | 'relation';
}
export function inferTraceConstraints(
	sketch: SketchDocument,
	settings: ImageTraceSettings,
	scale: number,
	lineIds: string[],
	radial: Array<{ id: string; centerId: string; radius: number }>,
	inferred: Inferred[]
): void {
	const api = getGeometryKernel().tracePostprocess;
	const lines = lineIds.map(id => {
		const line = sketch.lines.get(id),
			a = line && sketch.points.get(line.p1Id),
			b = line && sketch.points.get(line.p2Id);
		return a && b ? ([a, b] as const) : null;
	});
	const input: TraceRelationInput = {
		lines,
		radial: radial.map(r => ({ center: sketch.points.get(r.centerId) ?? null, radius: r.radius })),
		angleTolerance: settings.angleTolerance,
		tolerance: settings.tolerance,
		scale,
		...settings.constraints,
	};
	if (
		!api ||
		![input.angleTolerance, input.tolerance, scale].every(Number.isFinite) ||
		!lines.every(line => !line || line.every(finite)) ||
		!input.radial.every(r => Number.isFinite(r.radius) && (!r.center || finite(r.center)))
	)
		return reference.inferAxisAndRelations(sketch, settings, scale, lineIds, radial, inferred);
	let plan = api.relations(input);
	for (const { line: index, vertical } of plan.axes) {
		const line = sketch.lines.get(lineIds[index])!;
		inferred.push({
			constraint: vertical
				? sketch.addVerticalConstraint(line.p1Id, line.p2Id)
				: sketch.addHorizontalConstraint(line.p1Id, line.p2Id),
			group: 'axis',
		});
	}
	for (const [a, b] of plan.parallel) {
		const c = sketch.addParallelConstraint(lineIds[a], lineIds[b]);
		if (c) inferred.push({ constraint: c, group: 'relation' });
	}
	const applyGreedy = (kind: 'perpendicular' | 'concentric') => {
		const accepted = new Set<string>(),
			rejected: TracePair[] = [];
		for (;;) {
			let retry = false;
			for (const pair of plan[kind]) {
				const [a, b] = pair,
					key = `${a},${b}`;
				if (accepted.has(key)) continue;
				const c =
					kind === 'perpendicular'
						? sketch.addPerpendicularConstraint(lineIds[a], lineIds[b])
						: sketch.addConcentricConstraint(radial[a].id, radial[b].id);
				if (c) {
					accepted.add(key);
					inferred.push({ constraint: c, group: 'relation' });
				} else {
					rejected.push(pair);
					if (kind === 'perpendicular') input.rejectedPerpendicular = rejected;
					else input.rejectedConcentric = rejected;
					plan = api.relations(input);
					retry = true;
					break;
				}
			}
			if (!retry) break;
		}
	};
	applyGreedy('perpendicular');
	for (const [a, b] of plan.equalLength) {
		const c = sketch.addEqualLengthConstraint(lineIds[a], lineIds[b]);
		if (c) inferred.push({ constraint: c, group: 'relation' });
	}
	for (const [a, b] of plan.equalRadius)
		inferred.push({ constraint: sketch.addEqualRadiusConstraint(radial[a].id, radial[b].id), group: 'relation' });
	applyGreedy('concentric');
}
export function movedTracePoints(
	sketch: SketchDocument,
	original: ReadonlyMap<string, Vec2>,
	threshold: number
): Set<string> {
	const ids: string[] = [],
		before: Vec2[] = [],
		after: XY[] = [];
	for (const [id, p] of original) {
		const current = sketch.points.get(id);
		if (current) {
			ids.push(id);
			before.push(p);
			after.push(current);
		}
	}
	const api = getGeometryKernel().tracePostprocess;
	const moved =
		api && Number.isFinite(threshold) && before.every(finite) && after.every(finite)
			? api.moved(before, after, threshold)
			: before.flatMap((p, i) => (p.distanceTo(after[i]) > threshold ? [i] : []));
	return new Set(moved.map(i => ids[i]));
}

import { getGeometryKernel } from '../../kernel';
import type { TracePostprocessKernel } from '../../kernel/tracePostprocessTypes';
import { prepareTracePlacement, inferTraceConstraints, movedTracePoints } from './postprocess';
import type { Vec2, XY } from '../../math/vector';
import type { SketchImage } from '../image';
import type { SelectableEntityType } from '../selection';
import type { SketchDocument } from '../sketch';
import type { IConstraint } from '../../solver/types';
import type { ImageTraceSettings, TraceResult } from './types';

export interface TraceBuildResult {
	entities: Array<{ id: string; type: SelectableEntityType }>;
	constraints: { added: number; dropped: number };
}

type ConstraintGroup = 'tangent' | 'axis' | 'relation';

interface TracedState {
	points: Map<string, Vec2>;
	radii: Map<string, number>;
}

/**
 * Creates sketch geometry for a trace result and infers constraints. Everything happens in a single transaction,
 * so one Undo reverts the conversion.
 */
export function buildTraceGeometry(
	sketch: SketchDocument,
	result: TraceResult,
	image: SketchImage,
	settings: ImageTraceSettings,
	kernel = getGeometryKernel().tracePostprocess
): TraceBuildResult {
	if (!kernel) throw new Error('Image trace postprocessing requires the Rust/WASM kernel');
	const placement = prepareTracePlacement(result, image, kernel);
	const { toWorld, scale } = placement;
	const construction = settings.construction;
	const entities: TraceBuildResult['entities'] = [];
	const inferred: Array<{ constraint: IConstraint; group: ConstraintGroup }> = [];
	const createdPoints = new Set<string>();
	const lineIds: string[] = [];
	const radial: Array<{ id: string; centerId: string; radius: number }> = [];
	const traced: TracedState = { points: new Map(), radii: new Map() };

	sketch.beginTransaction();
	try {
		sketch.withDeferredSolve(() => {
			const addPoint = (p: XY): string => {
				const id = sketch.addPoint(toWorld(p)).id;
				createdPoints.add(id);
				return id;
			};
			const vertexIds = new Map<number, string>();
			const vertex = (index: number) => {
				let id = vertexIds.get(index);
				if (!id) {
					id = addPoint(result.vertices[index]);
					vertexIds.set(index, id);
				}
				return id;
			};
			const worldHandles = (handles: Array<{ h1: XY; h2: XY }>) =>
				handles.map(h => ({ h1: toWorld(h.h1), h2: toWorld(h.h2) }));

			for (const path of result.paths) {
				const ids: Array<{ id: string; kind: 'line' | 'arc' | 'spline' } | null> = [];
				for (const segment of path.segments) {
					const a = vertex(segment.a);
					const b = vertex(segment.b);
					if (segment.kind === 'line') {
						if (a === b) {
							ids.push(null);
							continue;
						}
						const line = sketch.addLine(a, b, construction ? 'construction' : 'solid');
						lineIds.push(line.id);
						entities.push({ id: line.id, type: 'line' });
						ids.push({ id: line.id, kind: 'line' });
					} else if (segment.kind === 'arc') {
						const centerId = addPoint(segment.center);
						const radius = placement.radius(segment),
							clockwise = placement.clockwise(segment);
						const arc = sketch.addArc(centerId, a, b, radius, clockwise, construction ? 'construction' : 'solid');
						radial.push({ id: arc.id, centerId, radius });
						entities.push({ id: arc.id, type: 'arc' });
						ids.push({ id: arc.id, kind: 'arc' });
					} else {
						const pointIds = [a, ...segment.points.map(addPoint), b];
						const spline = sketch.addFitSpline(
							pointIds,
							undefined,
							construction,
							undefined,
							false,
							worldHandles(segment.handles)
						);
						entities.push({ id: spline.id, type: 'spline' });
						ids.push({ id: spline.id, kind: 'spline' });
					}
				}

				if (settings.constraints.tangent) {
					for (let i = 0; i < path.segments.length; i++) {
						if (!path.tangent[i]) continue;
						const current = ids[i];
						const previous = ids[i > 0 ? i - 1 : ids.length - 1];
						if (!current || !previous || current === previous) continue;
						if (current.kind === 'spline' || previous.kind === 'spline') continue;
						if (current.kind === 'line' && previous.kind === 'line') continue;
						const c = sketch.addTangentConstraint(previous.id, current.id);
						if (c) inferred.push({ constraint: c, group: 'tangent' });
					}
				}
			}

			for (const circle of result.circles) {
				const centerId = addPoint(circle.center);
				const created = sketch.addCircle(centerId, placement.radius(circle), construction ? 'construction' : 'solid');
				radial.push({ id: created.id, centerId, radius: created.radius });
				entities.push({ id: created.id, type: 'circle' });
			}

			for (const spline of result.closedSplines) {
				const pointIds = spline.points.map(addPoint);
				const created = sketch.addFitSpline(
					pointIds,
					undefined,
					construction,
					undefined,
					true,
					worldHandles(spline.handles)
				);
				entities.push({ id: created.id, type: 'spline' });
			}

			inferTraceConstraints(sketch, settings, scale, lineIds, radial, inferred, kernel);
			for (const id of createdPoints) {
				const point = sketch.points.get(id);
				if (point) traced.points.set(id, point.clone());
			}
			for (const item of radial) traced.radii.set(item.id, item.radius);
		});

		const dropped = validateConstraints(
			sketch,
			inferred,
			traced,
			Math.max(settings.tolerance * scale * 2, 1e-3),
			kernel
		);

		if (settings.afterConvert === 'delete') sketch.removeImage(image.id);
		else if (settings.afterConvert === 'dim') sketch.updateImage(image.id, { opacity: Math.min(image.opacity, 0.3) });

		sketch.commitTransaction();
		return { entities, constraints: { added: inferred.length - dropped, dropped } };
	} catch (error) {
		sketch.rollbackTransaction();
		throw error;
	}
}

/**
 * Drops inferred constraints that distort the traced geometry or conflict. Expects the sketch to be solved with all
 * constraints; `original` holds the traced positions and radii from before that solve.
 * Returns the number of dropped constraints.
 */
function validateConstraints(
	sketch: SketchDocument,
	inferred: Array<{ constraint: IConstraint; group: ConstraintGroup }>,
	original: TracedState,
	maxDisplacement: number,
	kernel: TracePostprocessKernel
): number {
	if (!inferred.length) return 0;
	const pointsOf = (constraint: IConstraint): string[] => {
		const ids: string[] = [];
		for (const id of constraint.entityIds) {
			if (sketch.points.has(id)) ids.push(id);
			else ids.push(...sketch.getPrimitivePointIds(id));
		}
		return ids;
	};
	const restore = () => {
		for (const [id, p] of original.points) {
			const point = sketch.points.get(id);
			if (point) {
				point.x = p.x;
				point.y = p.y;
			}
		}
		for (const [id, r] of original.radii) {
			const entity = sketch.circles.get(id) ?? sketch.arcs.get(id);
			if (entity) entity.radius = r;
		}
	};
	const measure = () => movedTracePoints(sketch, original.points, maxDisplacement, kernel);

	let remaining = [...inferred];
	let dropped = 0;
	const order: ConstraintGroup[] = ['relation', 'axis', 'tangent'];
	for (let round = 0; round <= order.length; round++) {
		const moved = measure();
		if (sketch.lastSolverResult?.status !== 'OVER_CONSTRAINED' && moved.size === 0) break;
		let candidates: typeof remaining;
		if (round === order.length) {
			candidates = remaining;
		} else {
			candidates = remaining.filter(item => item.group === order[round]);
			// Prefer dropping only the constraints near the distorted geometry.
			if (moved.size) {
				const touching = candidates.filter(item => pointsOf(item.constraint).some(id => moved.has(id)));
				if (touching.length) candidates = touching;
			}
		}
		if (!candidates.length) continue;
		sketch.withDeferredSolve(() => {
			for (const item of candidates) sketch.removeConstraint(item.constraint.id);
			restore();
		});
		remaining = remaining.filter(item => !candidates.includes(item));
		dropped += candidates.length;
		if (!remaining.length) break;
	}
	return dropped;
}

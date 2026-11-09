import type { Vec2 } from '../../math/vector';
import type { SketchImage } from '../image';
import type { SelectableEntityType } from '../selection';
import type { SketchDocument } from '../sketch';
import type { IConstraint } from '../../solver/types';
import type { ImageTraceSettings, TraceResult } from './types';

export interface TracePlacement {
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
}

/** Maps fitting coordinates (x pixels, y scaled by `yScale`) of a trace result to world coordinates. */
export function createTraceTransform(
	result: Pick<TraceResult, 'width' | 'height' | 'yScale'>,
	placement: TracePlacement
): { toWorld: (p: Vec2) => Vec2; scale: number } {
	const radians = (placement.angle * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const scale = placement.width / result.width;
	return {
		scale,
		toWorld: (p: Vec2) => {
			const lx = (p.x / result.width - 0.5) * placement.width;
			const ly = (0.5 - p.y / result.yScale / result.height) * placement.height;
			return { x: placement.x + lx * cos - ly * sin, y: placement.y + lx * sin + ly * cos };
		},
	};
}

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
	settings: ImageTraceSettings
): TraceBuildResult {
	const { toWorld, scale } = createTraceTransform(result, image);
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
			const addPoint = (p: Vec2): string => {
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
			const worldHandles = (handles: Array<{ h1: Vec2; h2: Vec2 }>) =>
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
						const line = sketch.addLine(a, b, construction);
						lineIds.push(line.id);
						entities.push({ id: line.id, type: 'line' });
						ids.push({ id: line.id, kind: 'line' });
					} else if (segment.kind === 'arc') {
						const start = toWorld(result.vertices[segment.a]);
						const mid = toWorld(segment.mid);
						const end = toWorld(result.vertices[segment.b]);
						const turn = (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x);
						const centerId = addPoint(segment.center);
						const radius = segment.radius * scale;
						const arc = sketch.addArc(centerId, a, b, radius, turn < 0, construction);
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
				const created = sketch.addCircle(centerId, circle.radius * scale, construction);
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

			inferAxisAndRelations(sketch, settings, scale, lineIds, radial, inferred);
			for (const id of createdPoints) {
				const point = sketch.points.get(id);
				if (point) traced.points.set(id, { x: point.x, y: point.y });
			}
			for (const item of radial) traced.radii.set(item.id, item.radius);
		});

		const dropped = validateConstraints(sketch, inferred, traced, Math.max(settings.tolerance * scale * 2, 1e-3));

		if (settings.afterConvert === 'delete') sketch.removeImage(image.id);
		else if (settings.afterConvert === 'dim') sketch.updateImage(image.id, { opacity: Math.min(image.opacity, 0.3) });

		sketch.commitTransaction();
		return { entities, constraints: { added: inferred.length - dropped, dropped } };
	} catch (error) {
		sketch.rollbackTransaction();
		throw error;
	}
}

function lineAngle(sketch: SketchDocument, lineId: string): number | null {
	const line = sketch.lines.get(lineId);
	const p1 = line && sketch.points.get(line.p1Id);
	const p2 = line && sketch.points.get(line.p2Id);
	if (!p1 || !p2) return null;
	let angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
	angle = ((angle % 180) + 180) % 180;
	return angle;
}

function lineLength(sketch: SketchDocument, lineId: string): number {
	const line = sketch.lines.get(lineId);
	const p1 = line && sketch.points.get(line.p1Id);
	const p2 = line && sketch.points.get(line.p2Id);
	return p1 && p2 ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : 0;
}

const angleDifference = (a: number, b: number) => {
	const d = Math.abs(a - b) % 180;
	return Math.min(d, 180 - d);
};

/** Groups sorted values whose consecutive differences stay within `tolerance(value)`. */
function clusterBy<T>(items: T[], value: (item: T) => number, tolerance: (v: number) => number): T[][] {
	const sorted = [...items].sort((a, b) => value(a) - value(b));
	const clusters: T[][] = [];
	for (const item of sorted) {
		const last = clusters[clusters.length - 1];
		if (last && value(item) - value(last[0]) <= tolerance(value(last[0]))) last.push(item);
		else clusters.push([item]);
	}
	return clusters.filter(cluster => cluster.length > 1);
}

function inferAxisAndRelations(
	sketch: SketchDocument,
	settings: ImageTraceSettings,
	scale: number,
	lineIds: string[],
	radial: Array<{ id: string; centerId: string; radius: number }>,
	inferred: Array<{ constraint: IConstraint; group: ConstraintGroup }>
): void {
	const tolerance = settings.angleTolerance;
	const axisLines = new Set<string>();
	if (settings.constraints.horizontalVertical) {
		for (const id of lineIds) {
			const angle = lineAngle(sketch, id);
			const line = sketch.lines.get(id);
			if (angle === null || !line) continue;
			if (angleDifference(angle, 0) <= tolerance) {
				inferred.push({ constraint: sketch.addHorizontalConstraint(line.p1Id, line.p2Id), group: 'axis' });
				axisLines.add(id);
			} else if (angleDifference(angle, 90) <= tolerance) {
				inferred.push({ constraint: sketch.addVerticalConstraint(line.p1Id, line.p2Id), group: 'axis' });
				axisLines.add(id);
			}
		}
	}

	if (settings.constraints.parallelPerpendicular) {
		const free = lineIds.filter(id => !axisLines.has(id)).map(id => ({ id, angle: lineAngle(sketch, id) ?? 0 }));
		// Directions wrap at 180°, so lines near 0° and near 180° are compared after shifting.
		const clusters = clusterBy(
			free,
			item => item.angle,
			() => tolerance
		);
		if (clusters.length > 1) {
			const first = clusters[0];
			const last = clusters[clusters.length - 1];
			if (first[0].angle + 180 - last[last.length - 1].angle <= tolerance) {
				first.push(...last);
				clusters.pop();
			}
		}
		for (const cluster of clusters) {
			for (let i = 1; i < cluster.length; i++) {
				const c = sketch.addParallelConstraint(cluster[0].id, cluster[i].id);
				if (c) inferred.push({ constraint: c, group: 'relation' });
			}
		}
		// Link perpendicular directions once per pair of direction groups.
		const groups = [
			...clusters.map(cluster => cluster[0]),
			...free.filter(item => !clusters.some(c => c.includes(item))),
		];
		const linked = new Set<string>();
		for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				if (angleDifference(groups[i].angle, groups[j].angle + 90) > tolerance) continue;
				if (linked.has(groups[i].id) || linked.has(groups[j].id)) continue;
				const c = sketch.addPerpendicularConstraint(groups[i].id, groups[j].id);
				if (c) {
					inferred.push({ constraint: c, group: 'relation' });
					linked.add(groups[i].id);
					linked.add(groups[j].id);
				}
			}
		}
	}

	const distanceTolerance = Math.max(settings.tolerance * scale, 1e-6);
	if (settings.constraints.equal) {
		const lengths = lineIds.map(id => ({ id, length: lineLength(sketch, id) }));
		for (const cluster of clusterBy(
			lengths,
			item => item.length,
			v => Math.max(distanceTolerance, v * 0.01)
		)) {
			for (let i = 1; i < cluster.length; i++) {
				const c = sketch.addEqualLengthConstraint(cluster[0].id, cluster[i].id);
				if (c) inferred.push({ constraint: c, group: 'relation' });
			}
		}
		for (const cluster of clusterBy(
			radial,
			item => item.radius,
			v => Math.max(distanceTolerance, v * 0.01)
		)) {
			for (let i = 1; i < cluster.length; i++) {
				inferred.push({ constraint: sketch.addEqualRadiusConstraint(cluster[0].id, cluster[i].id), group: 'relation' });
			}
		}
	}

	if (settings.constraints.concentric) {
		const used = new Set<number>();
		for (let i = 0; i < radial.length; i++) {
			if (used.has(i)) continue;
			const center = sketch.points.get(radial[i].centerId);
			if (!center) continue;
			for (let j = i + 1; j < radial.length; j++) {
				if (used.has(j)) continue;
				const other = sketch.points.get(radial[j].centerId);
				if (!other || Math.hypot(other.x - center.x, other.y - center.y) > distanceTolerance * 2) continue;
				const c = sketch.addConcentricConstraint(radial[i].id, radial[j].id);
				if (c) {
					inferred.push({ constraint: c, group: 'relation' });
					used.add(j);
				}
			}
		}
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
	maxDisplacement: number
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
	const measure = (): Map<string, number> => {
		const moved = new Map<string, number>();
		for (const [id, p] of original.points) {
			const point = sketch.points.get(id);
			if (!point) continue;
			const d = Math.hypot(point.x - p.x, point.y - p.y);
			if (d > maxDisplacement) moved.set(id, d);
		}
		return moved;
	};

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

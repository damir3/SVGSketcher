import { AABB, getCurveBoundingBox } from '../math/aabb';
import { ORIGIN, Vec2, type XY } from '../math/vector';
import { FixedConstraint, OffsetConstraint } from '../solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../solver/constraints/serialization';
import type { IConstraint } from '../solver/types';
import type { SketchDocument } from './sketch';
import {
	SketchArc,
	SketchCircle,
	SketchEllipse,
	SketchEllipticalArc,
	SketchLine,
	SketchPoint,
	SketchSpline,
	SketchText,
} from './types';

export interface TransformValues {
	x: number;
	y: number;
	angle: number;
	scale: number;
}

export function createTransform(center: Vec2, values: TransformValues) {
	const angle = ((values.angle % 360) * Math.PI) / 180;
	const translation = new Vec2(values.x, values.y);
	const rotate = (vector: XY) => Vec2.from(vector).rotateAround(ORIGIN, angle);
	return {
		rotate,
		point: (point: XY) =>
			center
				.clone()
				.add(translation)
				.addScaledVector(new Vec2().subVectors(point, center).rotateAround(ORIGIN, angle), values.scale),
	};
}

function getEntity(sketch: SketchDocument, id: string) {
	if (!sketch.points.has(id) && (id === 'origin' || id === 'axis_x' || id === 'axis_y')) return undefined;
	return (
		sketch.points.get(id) ??
		sketch.lines.get(id) ??
		sketch.circles.get(id) ??
		sketch.arcs.get(id) ??
		sketch.ellipses.get(id) ??
		sketch.ellipticalArcs.get(id) ??
		sketch.splines.get(id) ??
		sketch.texts.get(id)
	);
}

type Entity = NonNullable<ReturnType<typeof getEntity>>;

export function getTransformSelection(sketch: SketchDocument) {
	const entities = new Map<string, Entity>();
	const selected = [...sketch.getSelectedPrimitives().map(p => p.id), ...sketch.selection.textIds];
	const previewIds = new Set(selected);
	const include = (id: string) => {
		const entity = getEntity(sketch, id);
		if (!entity || entities.has(id)) return;
		entities.set(id, entity);
		sketch.getPrimitivePointIds(id).forEach(include);
		if (entity.type === 'spline') entity.tangentLineIds?.forEach(include);
		if (entity.type === 'text') {
			entity.rectanglePointIds?.forEach(include);
			entity.rectangleLineIds?.forEach(include);
			if (entity.targetPrimitiveId) {
				previewIds.add(entity.targetPrimitiveId);
				include(entity.targetPrimitiveId);
			}
		}
	};
	selected.forEach(include);
	const bounds = new AABB();
	let minScale = 1e-6;
	for (const id of previewIds) {
		const entity = entities.get(id);
		if (!entity) continue;
		if (entity.type === 'point') bounds.addPoint(entity);
		else if (entity.type === 'text') {
			entity.getRectangleCorners(sketch)?.forEach(p => bounds.addPoint(p));
		} else {
			const curve = entity.toGeoCurve(sketch);
			const curveBounds = curve && getCurveBoundingBox(curve);
			if (curveBounds) bounds.addPoint(curveBounds.min).addPoint(curveBounds.max);
			else
				for (const pointId of sketch.getPrimitivePointIds(id)) {
					const point = sketch.points.get(pointId);
					if (point) bounds.addPoint(point);
				}
		}
		if ('radius' in entity && entity.radius > 0) {
			minScale = Math.max(minScale, Math.min(1, 1 / entity.radius));
		}
	}
	if (![bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y].every(Number.isFinite)) return null;
	return { entities, selected, previewIds, bounds, center: new Vec2().midpoint(bounds.min, bounds.max), minScale };
}

type TransformSelection = NonNullable<ReturnType<typeof getTransformSelection>>;

// Serialized constraints contain entity references both in top-level fields and
// in nested data such as offset pairs, spline handles and pattern instances.
function mapConstraintData(value: unknown, mapId: (id: string) => string): unknown {
	if (typeof value === 'string') return mapId(value);
	if (Array.isArray(value)) return value.map(item => mapConstraintData(item, mapId));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				key === 'name' || key === 'type' || key === 'kind' || key === 'expression' || key.endsWith('Expression')
					? item
					: mapConstraintData(item, mapId),
			])
		);
	}
	return value;
}

function constraintError(constraint: IConstraint, params: Map<string, number>): number {
	const residuals = constraint.evaluate(params);
	return residuals.reduce((max, residual) => Math.max(max, Math.abs(residual)), 0) / (Math.abs(constraint.weight) || 1);
}

export function applyTransform(
	sketch: SketchDocument,
	selection: TransformSelection,
	values: TransformValues,
	copy: boolean
): number {
	if (!Object.values(values).every(Number.isFinite) || values.scale < selection.minScale) {
		throw new Error('Invalid transform parameters.');
	}
	const transform = createTransform(selection.center, values);
	const { entities } = selection;
	const before = sketch.paramManager.getCurrentValues();
	const after = new Map(before);
	const ids = new Map<string, string>();
	const constraintUpdates = new Map<string, IConstraint | null>();
	const points = new Map<string, Vec2>();
	const constraints = [...sketch.constraints.values()];
	const movedPoints = new Set<string>();

	for (const entity of entities.values()) {
		if (entity.type === 'point') {
			const p = transform.point(entity);
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('The transformed coordinates are too large.');
			points.set(entity.id, p);
			if (p.x !== entity.x || p.y !== entity.y) movedPoints.add(entity.id);
		} else if ('radius' in entity || entity.type === 'text') {
			const size = 'radius' in entity ? entity.radius : entity.height;
			if (!Number.isFinite(size * values.scale)) throw new Error('The transformed size is too large.');
		}
	}

	sketch.beginTransaction();
	try {
		for (const entity of entities.values()) {
			const prefix = entity.id.replace(/[-_]\d+$/, '');
			ids.set(entity.id, copy ? sketch.nextId(prefix) : entity.id);
		}
		const mapId = (id: string) => ids.get(id) ?? id;

		for (const entity of entities.values()) {
			const id = mapId(entity.id);
			const point = points.get(entity.id);
			if (point) {
				after.set(`${id}.x`, point.x);
				after.set(`${id}.y`, point.y);
			}
			if ('radius' in entity) after.set(`${id}.r`, entity.radius * values.scale);
		}

		let removed = 0;
		for (const constraint of constraints) {
			if (constraint.type === 'drag_point') continue;
			let candidate = constraint;
			if (copy || constraint instanceof OffsetConstraint) {
				const snapshot = serializeConstraint(constraint);
				const { id, ...data } = snapshot;
				let internal = true;
				const mapped = mapConstraintData(data, ref => {
					if (!ids.has(ref) && (getEntity(sketch, ref) || ref === 'origin' || ref === 'axis_x' || ref === 'axis_y')) {
						internal = false;
					}
					return mapId(ref);
				});
				if (copy && (!internal || !snapshot.entityIds.some(ref => ids.has(ref)))) continue;
				if (internal || copy) {
					candidate = deserializeConstraint({ ...(mapped as typeof data), id } as typeof snapshot) ?? constraint;
					if (candidate instanceof OffsetConstraint) {
						for (const pair of candidate.pairs) {
							if (pair.kind !== 'spline') continue;
							for (const point of pair.points) {
								point.basePos = transform.point(point.basePos);
								point.normal = transform.rotate(point.normal);
							}
						}
					}
				}
			}
			const previousError = constraintError(constraint, before);
			const error = constraintError(candidate, after);
			if (error > Math.max(1e-6, previousError + 1e-8) || (!Number.isFinite(error) && Number.isFinite(previousError))) {
				removed++;
				if (!copy) constraintUpdates.set(constraint.id, null);
			} else if (copy) {
				const id = sketch.nextId(`c_${constraint.type}`);
				const duplicate = deserializeConstraint({ ...serializeConstraint(candidate), id });
				if (duplicate) constraintUpdates.set(id, duplicate);
			} else if (candidate !== constraint) {
				constraintUpdates.set(constraint.id, candidate);
			}
		}

		for (const entity of entities.values()) {
			const id = mapId(entity.id);
			if (entity.type === 'point') {
				const point = points.get(entity.id)!;
				const fixed = entity.fixed && !movedPoints.has(entity.id);
				if (copy) sketch.points.set(id, new SketchPoint({ id, ...point, fixed }));
				else Object.assign(entity, point, { fixed });
			} else if (copy) {
				switch (entity.type) {
					case 'line': {
						const parentSplineId = entity.parentSplineId && ids.get(entity.parentSplineId);
						sketch.lines.set(
							id,
							new SketchLine({
								...entity,
								id,
								p1Id: mapId(entity.p1Id),
								p2Id: mapId(entity.p2Id),
								parentSplineId,
								isSplineHandle: !!parentSplineId,
							})
						);
						break;
					}
					case 'circle':
						sketch.circles.set(
							id,
							new SketchCircle({
								...entity,
								id,
								centerId: mapId(entity.centerId),
								radius: entity.radius * values.scale,
							})
						);
						break;
					case 'arc':
						sketch.arcs.set(
							id,
							new SketchArc({
								...entity,
								id,
								centerId: mapId(entity.centerId),
								radius: entity.radius * values.scale,
								startPointId: mapId(entity.startPointId),
								endPointId: mapId(entity.endPointId),
							})
						);
						break;
					case 'ellipse':
					case 'elliptical_arc': {
						const data = {
							...entity,
							id,
							centerId: mapId(entity.centerId),
							majorAxisPointId: mapId(entity.majorAxisPointId),
							minorAxisPointId: mapId(entity.minorAxisPointId),
						};
						if (entity.type === 'ellipse') sketch.ellipses.set(id, new SketchEllipse(data));
						else
							sketch.ellipticalArcs.set(
								id,
								new SketchEllipticalArc({
									...data,
									clockwise: entity.clockwise,
									startPointId: mapId(entity.startPointId),
									endPointId: mapId(entity.endPointId),
								})
							);
						break;
					}
					case 'spline':
						sketch.splines.set(
							id,
							new SketchSpline({
								...entity,
								id,
								pointIds: entity.pointIds.map(mapId),
								tangentLineIds: entity.tangentLineIds?.map(mapId),
							})
						);
						break;
					case 'text':
						sketch.texts.set(
							id,
							new SketchText({
								...entity,
								id,
								height: entity.height * values.scale,
								rectanglePointIds: entity.rectanglePointIds?.map(mapId) as SketchText['rectanglePointIds'],
								rectangleLineIds: entity.rectangleLineIds?.map(mapId) as SketchText['rectangleLineIds'],
								targetPrimitiveId: entity.targetPrimitiveId && mapId(entity.targetPrimitiveId),
							})
						);
						break;
				}
			} else if ('radius' in entity) {
				entity.radius *= values.scale;
			} else if (entity.type === 'text') {
				entity.height *= values.scale;
			}
		}
		for (const [id, constraint] of constraintUpdates) {
			if (constraint) sketch.constraints.set(id, constraint);
			else {
				sketch.constraints.delete(id);
				sketch.selection.constraintIds.delete(id);
			}
		}
		for (const constraint of sketch.constraints.values()) {
			if (!(constraint instanceof FixedConstraint)) continue;
			const point = sketch.points.get(constraint.pointId);
			if (point && sketch.points.has(point.id)) point.fixed = true;
		}

		if (!copy) {
			for (const line of sketch.lines.values()) {
				if (
					line.isAutomaticSplineHandle &&
					!entities.has(line.parentSplineId ?? '') &&
					(movedPoints.has(line.p1Id) || movedPoints.has(line.p2Id))
				) {
					line.isAutomaticSplineHandle = false;
				}
			}
		}

		sketch.rebuildParamManager();
		sketch.solve();
		if (copy) {
			sketch.selectEntities(
				selection.selected.flatMap(id => {
					const entity = entities.get(id);
					return entity ? [{ id: mapId(id), type: entity.type }] : [];
				})
			);
		}
		sketch.commitTransaction();
		return removed;
	} catch (error) {
		sketch.rollbackTransaction();
		throw error;
	}
}

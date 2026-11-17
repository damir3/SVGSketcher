import { getImageBounds } from './image';
import type { SketchDocument } from './sketch';
import { Vec2 } from '../math/vector';
import { AABB } from '../math/aabb';
import type { SelectionState, SketchPoint } from './types';

export type SelectableEntityType =
	| 'point'
	| 'line'
	| 'circle'
	| 'arc'
	| 'ellipse'
	| 'elliptical_arc'
	| 'spline'
	| 'text'
	| 'constraint';

const SELECTION_KEYS: Record<SelectableEntityType, keyof SelectionState> = {
	point: 'pointIds',
	line: 'lineIds',
	circle: 'circleIds',
	arc: 'arcIds',
	ellipse: 'ellipseIds',
	elliptical_arc: 'ellipticalArcIds',
	spline: 'splineIds',
	text: 'textIds',
	constraint: 'constraintIds',
};

export function getSelectionSet(sketch: SketchDocument, type: SelectableEntityType): Set<string> | undefined {
	const key = SELECTION_KEYS[type];
	return key ? sketch.selection[key] : undefined;
}

export function clearSelectionSets(sketch: SketchDocument): void {
	for (const set of Object.values(sketch.selection) as Set<string>[]) {
		set.clear();
	}
}

export function getSelectionCount(sketch: SketchDocument): number {
	let count = 0;
	for (const set of Object.values(sketch.selection) as Set<string>[]) {
		count += set.size;
	}
	return count;
}

export function isEntitySelected(sketch: SketchDocument, id: string, type: SelectableEntityType): boolean {
	return getSelectionSet(sketch, type)?.has(id) ?? false;
}

export function deselectEntity(sketch: SketchDocument, id: string, type: SelectableEntityType, notify = true): void {
	getSelectionSet(sketch, type)?.delete(id);
	if (notify) sketch.notify();
}

export function toggleEntitySelection(sketch: SketchDocument, id: string, type: SelectableEntityType): void {
	if (sketch.isEntitySelected(id, type)) {
		sketch.deselectEntity(id, type);
	} else {
		sketch.selectEntity(id, type, true);
	}
}

export function selectEntities(
	sketch: SketchDocument,
	items: Array<{
		id: string;
		type: SelectableEntityType;
	}>,
	mode: boolean | 'toggle' = false
): void {
	if (mode === false) {
		clearSelectionSets(sketch);
	}

	for (const item of items) {
		if (mode === 'toggle' && isEntitySelected(sketch, item.id, item.type)) {
			deselectEntity(sketch, item.id, item.type, false);
		} else {
			getSelectionSet(sketch, item.type)?.add(item.id);
		}
	}

	sketch.notify();
}

export function selectEntity(
	sketch: SketchDocument,
	id: string,
	type: SelectableEntityType,
	multiSelect = false
): void {
	sketch.selectEntities([{ id, type }], multiSelect);
}

export function clearSelection(sketch: SketchDocument): void {
	clearSelectionSets(sketch);
	sketch.notify();
}

export function getSelectedPrimitives(sketch: SketchDocument): Array<{ id: string; isConstruction?: boolean }> {
	const list: Array<{ id: string; isConstruction?: boolean }> = [];
	const sources: Array<[Set<string>, Map<string, { id: string; isConstruction?: boolean }>, boolean?]> = [
		[sketch.selection.lineIds, sketch.lines],
		[sketch.selection.circleIds, sketch.circles],
		[sketch.selection.arcIds, sketch.arcs],
		[sketch.selection.ellipseIds, sketch.ellipses],
		[sketch.selection.ellipticalArcIds, sketch.ellipticalArcs],
		[sketch.selection.splineIds, sketch.splines],
		[sketch.selection.pointIds, sketch.points, true],
	];
	for (const [ids, map, checkOwnHas] of sources) {
		for (const id of ids) {
			if (checkOwnHas && !map.has(id)) continue;
			const item = map.get(id);
			if (item) list.push(item);
		}
	}
	return list;
}

export function getSelectedConstructionState(sketch: SketchDocument): boolean | null {
	const primitives = sketch.getSelectedPrimitives();
	if (primitives.length === 0) return null;
	return primitives.every(p => !!p.isConstruction);
}

export function deleteSelected(sketch: SketchDocument): void {
	if (getSelectionCount(sketch) === 0) return;

	sketch.beginTransaction();
	const selectedPoints = [...sketch.selection.pointIds];
	const selectedLines = [...sketch.selection.lineIds];
	const selectedCircles = [...sketch.selection.circleIds];
	const selectedArcs = [...sketch.selection.arcIds];
	const selectedEllipses = [...sketch.selection.ellipseIds];
	const selectedEllipticalArcs = [...sketch.selection.ellipticalArcIds];
	const selectedSplines = [...sketch.selection.splineIds];
	const selectedTexts = [...sketch.selection.textIds];
	const selectedConstraints = [...sketch.selection.constraintIds].filter(cid => {
		const c = sketch.constraints.get(cid);
		return c ? !sketch.isSplineInternalConstraint(c) : true;
	});

	const selectedSplinesSet = new Set(selectedSplines);

	// Do not delete tangent lines directly unless parent spline is also being deleted
	const filteredLines = selectedLines.filter(lid => {
		const line = sketch.lines.get(lid);
		if (line?.isSplineHandle) {
			if (!line.parentSplineId || !selectedSplinesSet.has(line.parentSplineId)) {
				sketch.selection.lineIds.delete(lid);
				return false;
			}
		}
		return true;
	});

	// Do not delete tangent handle points directly unless parent spline is also being deleted
	const filteredPoints = selectedPoints.filter(pid => {
		if (sketch.isSplineHandlePoint(pid)) {
			let parentSplineSelected = false;
			for (const line of sketch.lines.values()) {
				if (line.isSplineHandle && (line.p1Id === pid || line.p2Id === pid)) {
					if (line.parentSplineId && selectedSplinesSet.has(line.parentSplineId)) {
						parentSplineSelected = true;
						break;
					}
				}
			}
			if (!parentSplineSelected) {
				sketch.selection.pointIds.delete(pid);
				return false;
			}
		}
		return true;
	});

	// Collect all candidate points from all selected primitives before deleting
	const candidatePointIds = new Set<string>();
	const curveSelectionGroups = [
		filteredLines,
		selectedCircles,
		selectedArcs,
		selectedEllipses,
		selectedEllipticalArcs,
		selectedSplines,
	];
	for (const group of curveSelectionGroups) {
		for (const id of group) {
			for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
	}

	for (const id of selectedConstraints) sketch.removeConstraint(id);
	for (const group of [...curveSelectionGroups, selectedTexts, filteredPoints]) {
		for (const id of group) sketch.removeEntity(id);
	}

	sketch.resetFitSplineTangents(selectedLines, selectedPoints);

	// Final sweep for any candidate points that became unused across the batch
	for (const ptId of candidatePointIds) {
		if (sketch.points.has(ptId) && !sketch.isPointUsed(ptId)) {
			sketch.points.delete(ptId);
			sketch.selection.pointIds.delete(ptId);
		}
	}

	sketch.cleanOrphanConstraints();

	sketch.clearSelection();
	sketch.rebuildParamManager();
	sketch.solve();
	sketch.commitTransaction();
}

function addCircleBounds(bounds: AABB, center: SketchPoint | undefined, radius: number): boolean {
	if (!center) return false;
	bounds.addPoint(center.clone().subScalar(radius));
	bounds.addPoint(center.clone().addScalar(radius));
	return true;
}

function addEllipseBounds(
	bounds: AABB,
	center: SketchPoint | undefined,
	maj: SketchPoint | undefined,
	min: SketchPoint | undefined,
	exactExtents: boolean
): boolean {
	if (!center || !maj || !min) return false;
	if (exactExtents) {
		const u = new Vec2().subVectors(maj, center);
		const v = new Vec2().subVectors(min, center);
		const dir = new Vec2(Math.sqrt(u.x * u.x + v.x * v.x), Math.sqrt(u.y * u.y + v.y * v.y));
		bounds.addPoint(new Vec2().subVectors(center, dir));
		bounds.addPoint(new Vec2().addVectors(center, dir));
	} else {
		const r = center.distancesTo(maj, min);
		const rMax = Math.max(r.x, r.y);
		bounds.addPoint(center.clone().subScalar(rMax));
		bounds.addPoint(center.clone().addScalar(rMax));
	}
	return true;
}

export function getBoundingBox(sketch: SketchDocument): AABB | null {
	if (sketch.points.size === 0 && sketch.images.size === 0) return null;
	const bounds = new AABB();

	for (const p of sketch.points.values()) bounds.addPoint(p);
	for (const image of sketch.images.values()) {
		const imageBounds = getImageBounds(image);
		bounds.addPoint(imageBounds.min).addPoint(imageBounds.max);
	}

	for (const c of [...sketch.circles.values(), ...sketch.arcs.values()]) {
		addCircleBounds(bounds, sketch.points.get(c.centerId), c.radius);
	}

	for (const e of [...sketch.ellipses.values(), ...sketch.ellipticalArcs.values()]) {
		addEllipseBounds(
			bounds,
			sketch.points.get(e.centerId),
			sketch.points.get(e.majorAxisPointId),
			sketch.points.get(e.minorAxisPointId),
			false
		);
	}

	if (!isFinite(bounds.min.x) || !isFinite(bounds.max.x) || !isFinite(bounds.min.y) || !isFinite(bounds.max.y)) {
		return null;
	}
	return bounds;
}

export function getSelectionBoundingBox(sketch: SketchDocument): AABB | null {
	const bounds = new AABB();
	let count = 0;

	const includePoint = (p?: SketchPoint | null) => {
		if (!p) return;
		bounds.addPoint(p);
		count++;
	};

	const includeEntity = (
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline',
		id: string
	) => {
		switch (type) {
			case 'point':
				includePoint(sketch.points.get(id));
				break;
			case 'line': {
				const l = sketch.lines.get(id);
				if (l) {
					includePoint(sketch.points.get(l.p1Id));
					includePoint(sketch.points.get(l.p2Id));
				}
				break;
			}
			case 'circle':
			case 'arc': {
				const radial = type === 'circle' ? sketch.circles.get(id) : sketch.arcs.get(id);
				if (radial) {
					if (addCircleBounds(bounds, sketch.points.get(radial.centerId), radial.radius)) count++;
					if ('startPointId' in radial) {
						includePoint(sketch.points.get(radial.startPointId));
						includePoint(sketch.points.get(radial.endPointId));
					}
				}
				break;
			}
			case 'ellipse':
			case 'elliptical_arc': {
				const el = type === 'ellipse' ? sketch.ellipses.get(id) : sketch.ellipticalArcs.get(id);
				if (el) {
					if (
						addEllipseBounds(
							bounds,
							sketch.points.get(el.centerId),
							sketch.points.get(el.majorAxisPointId),
							sketch.points.get(el.minorAxisPointId),
							true
						)
					) {
						count++;
					}
					if ('startPointId' in el) {
						includePoint(sketch.points.get(el.startPointId));
						includePoint(sketch.points.get(el.endPointId));
					}
				}
				break;
			}
			case 'spline': {
				const s = sketch.splines.get(id);
				if (s) {
					for (const pid of s.pointIds) includePoint(sketch.points.get(pid));
					if (s.tangentLineIds) {
						for (const lid of s.tangentLineIds) includeEntity('line', lid);
					}
				}
				break;
			}
		}
	};

	const selectionGroups: Array<
		['point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline', Set<string>]
	> = [
		['point', sketch.selection.pointIds],
		['line', sketch.selection.lineIds],
		['circle', sketch.selection.circleIds],
		['arc', sketch.selection.arcIds],
		['ellipse', sketch.selection.ellipseIds],
		['elliptical_arc', sketch.selection.ellipticalArcIds],
		['spline', sketch.selection.splineIds],
	];
	for (const [type, ids] of selectionGroups) {
		for (const id of ids) includeEntity(type, id);
	}

	if (count === 0 && sketch.selection.constraintIds.size > 0) {
		for (const cid of sketch.selection.constraintIds) {
			const c = sketch.constraints.get(cid);
			if (!c) continue;
			for (const ent of sketch.getEntitiesForConstraint(c)) {
				if (ent.type === 'point' || ent.type === 'line' || ent.type === 'circle' || ent.type === 'arc') {
					includeEntity(ent.type, ent.id);
				}
			}
		}
	}

	if (
		count === 0 ||
		!isFinite(bounds.min.x) ||
		!isFinite(bounds.max.x) ||
		!isFinite(bounds.min.y) ||
		!isFinite(bounds.max.y)
	) {
		return null;
	}

	return bounds;
}

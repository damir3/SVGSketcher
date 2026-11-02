import type { SketchDocument } from './sketch';
import type { SketchPoint } from './types';

export type SelectableEntityType =
	| 'point'
	| 'line'
	| 'circle'
	| 'arc'
	| 'ellipse'
	| 'elliptical_arc'
	| 'spline'
	| 'constraint';

export function isEntitySelected(
	sketch: SketchDocument,
	id: string,
	type: SelectableEntityType
): boolean {
	switch (type) {
		case 'point': return sketch.selection.pointIds.has(id);
		case 'line': return sketch.selection.lineIds.has(id);
		case 'circle': return sketch.selection.circleIds.has(id);
		case 'arc': return sketch.selection.arcIds.has(id);
		case 'ellipse': return sketch.selection.ellipseIds.has(id);
		case 'elliptical_arc': return sketch.selection.ellipticalArcIds.has(id);
		case 'spline': return sketch.selection.splineIds.has(id);
		case 'constraint': return sketch.selection.constraintIds.has(id);
		default: return false;
	}
}

export function deselectEntity(
	sketch: SketchDocument,
	id: string,
	type: SelectableEntityType
): void {
	switch (type) {
		case 'point':
			sketch.selection.pointIds.delete(id);
			break;
		case 'line':
			sketch.selection.lineIds.delete(id);
			break;
		case 'circle':
			sketch.selection.circleIds.delete(id);
			break;
		case 'arc':
			sketch.selection.arcIds.delete(id);
			break;
		case 'ellipse':
			sketch.selection.ellipseIds.delete(id);
			break;
		case 'elliptical_arc':
			sketch.selection.ellipticalArcIds.delete(id);
			break;
		case 'spline':
			sketch.selection.splineIds.delete(id);
			break;
		case 'constraint':
			sketch.selection.constraintIds.delete(id);
			break;
	}

	if (type !== 'constraint') {
		for (const c of sketch.getConstraintsForEntity(type as any, id)) {
			const otherEntities = sketch.getEntitiesForConstraint(c);
			const stillSelected = otherEntities.some(ent => sketch.isEntitySelected(ent.id, ent.type));
			if (!stillSelected) {
				sketch.selection.constraintIds.delete(c.id);
			}
		}
	}

	sketch.notify();
}

export function toggleEntitySelection(
	sketch: SketchDocument,
	id: string,
	type: SelectableEntityType
): void {
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
	multiSelect = false
): void {
	if (!multiSelect) {
		sketch.selection.pointIds.clear();
		sketch.selection.lineIds.clear();
		sketch.selection.circleIds.clear();
		sketch.selection.arcIds.clear();
		sketch.selection.ellipseIds.clear();
		sketch.selection.ellipticalArcIds.clear();
		sketch.selection.splineIds.clear();
		sketch.selection.constraintIds.clear();
	}

	for (const item of items) {
		if (item.type === 'point') {
			sketch.selection.pointIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('point', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'line') {
			sketch.selection.lineIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('line', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'circle') {
			sketch.selection.circleIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('circle', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'arc') {
			sketch.selection.arcIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('arc', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'ellipse') {
			sketch.selection.ellipseIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('ellipse', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'elliptical_arc') {
			sketch.selection.ellipticalArcIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('elliptical_arc', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'spline') {
			sketch.selection.splineIds.add(item.id);
			for (const c of sketch.getConstraintsForEntity('spline', item.id)) {
				sketch.selection.constraintIds.add(c.id);
			}
		} else if (item.type === 'constraint') {
			sketch.selection.constraintIds.add(item.id);
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
	sketch.selection.pointIds.clear();
	sketch.selection.lineIds.clear();
	sketch.selection.circleIds.clear();
	sketch.selection.arcIds.clear();
	sketch.selection.ellipseIds.clear();
	sketch.selection.ellipticalArcIds.clear();
	sketch.selection.splineIds.clear();
	sketch.selection.constraintIds.clear();
	sketch.notify();
}

export function getSelectedPrimitives(sketch: SketchDocument): Array<{ id: string; isConstruction?: boolean }> {
	const list: Array<{ id: string; isConstruction?: boolean }> = [];
	for (const id of sketch.selection.lineIds) {
		const l = sketch.lines.get(id);
		if (l) list.push(l);
	}
	for (const id of sketch.selection.circleIds) {
		const c = sketch.circles.get(id);
		if (c) list.push(c);
	}
	for (const id of sketch.selection.arcIds) {
		const a = sketch.arcs.get(id);
		if (a) list.push(a);
	}
	for (const id of sketch.selection.ellipseIds) {
		const el = sketch.ellipses.get(id);
		if (el) list.push(el);
	}
	for (const id of sketch.selection.ellipticalArcIds) {
		const ea = sketch.ellipticalArcs.get(id);
		if (ea) list.push(ea);
	}
	for (const id of sketch.selection.splineIds) {
		const s = sketch.splines.get(id);
		if (s) list.push(s);
	}
	for (const id of sketch.selection.pointIds) {
		const p = sketch.points.get(id);
		if (p) list.push(p);
	}
	return list;
}

export function getSelectedConstructionState(sketch: SketchDocument): boolean | null {
	const primitives = sketch.getSelectedPrimitives();
	if (primitives.length === 0) return null;
	return primitives.every(p => !!p.isConstruction);
}

export function deleteSelected(sketch: SketchDocument): void {
	const hasSelection =
		sketch.selection.pointIds.size > 0 ||
		sketch.selection.lineIds.size > 0 ||
		sketch.selection.circleIds.size > 0 ||
		sketch.selection.arcIds.size > 0 ||
		sketch.selection.ellipseIds.size > 0 ||
		sketch.selection.ellipticalArcIds.size > 0 ||
		sketch.selection.splineIds.size > 0 ||
		sketch.selection.constraintIds.size > 0;

	if (!hasSelection) return;

	sketch.beginTransaction();
	const selectedPoints = [...sketch.selection.pointIds];
	const selectedLines = [...sketch.selection.lineIds];
	const selectedCircles = [...sketch.selection.circleIds];
	const selectedArcs = [...sketch.selection.arcIds];
	const selectedEllipses = [...sketch.selection.ellipseIds];
	const selectedEllipticalArcs = [...sketch.selection.ellipticalArcIds];
	const selectedSplines = [...sketch.selection.splineIds];
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
	for (const id of filteredLines) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}
	for (const id of selectedCircles) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}
	for (const id of selectedArcs) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}
	for (const id of selectedEllipses) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}
	for (const id of selectedEllipticalArcs) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}
	for (const id of selectedSplines) {
		for (const ptId of sketch.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
	}

	for (const id of selectedConstraints) sketch.removeConstraint(id);
	for (const id of filteredLines) sketch.removeEntity(id);
	for (const id of selectedCircles) sketch.removeEntity(id);
	for (const id of selectedArcs) sketch.removeEntity(id);
	for (const id of selectedEllipses) sketch.removeEntity(id);
	for (const id of selectedEllipticalArcs) sketch.removeEntity(id);
	for (const id of selectedSplines) sketch.removeEntity(id);
	for (const id of filteredPoints) sketch.removeEntity(id);

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

export function getBoundingBox(sketch: SketchDocument): { minX: number; minY: number; maxX: number; maxY: number } | null {
	if (sketch.points.size === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const p of sketch.points.values()) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}

	for (const c of sketch.circles.values()) {
		const center = sketch.points.get(c.centerId);
		if (center) {
			if (center.x - c.radius < minX) minX = center.x - c.radius;
			if (center.x + c.radius > maxX) maxX = center.x + c.radius;
			if (center.y - c.radius < minY) minY = center.y - c.radius;
			if (center.y + c.radius > maxY) maxY = center.y + c.radius;
		}
	}

	for (const a of sketch.arcs.values()) {
		const center = sketch.points.get(a.centerId);
		if (center) {
			if (center.x - a.radius < minX) minX = center.x - a.radius;
			if (center.x + a.radius > maxX) maxX = center.x + a.radius;
			if (center.y - a.radius < minY) minY = center.y - a.radius;
			if (center.y + a.radius > maxY) maxY = center.y + a.radius;
		}
	}

	for (const e of sketch.ellipses.values()) {
		const center = sketch.points.get(e.centerId);
		const maj = sketch.points.get(e.majorAxisPointId);
		const min = sketch.points.get(e.minorAxisPointId);
		if (center && maj && min) {
			const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
			const ry = Math.hypot(min.x - center.x, min.y - center.y);
			const rMax = Math.max(rx, ry);
			if (center.x - rMax < minX) minX = center.x - rMax;
			if (center.x + rMax > maxX) maxX = center.x + rMax;
			if (center.y - rMax < minY) minY = center.y - rMax;
			if (center.y + rMax > maxY) maxY = center.y + rMax;
		}
	}

	for (const ea of sketch.ellipticalArcs.values()) {
		const center = sketch.points.get(ea.centerId);
		const maj = sketch.points.get(ea.majorAxisPointId);
		const min = sketch.points.get(ea.minorAxisPointId);
		if (center && maj && min) {
			const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
			const ry = Math.hypot(min.x - center.x, min.y - center.y);
			const rMax = Math.max(rx, ry);
			if (center.x - rMax < minX) minX = center.x - rMax;
			if (center.x + rMax > maxX) maxX = center.x + rMax;
			if (center.y - rMax < minY) minY = center.y - rMax;
			if (center.y + rMax > maxY) maxY = center.y + rMax;
		}
	}

	if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
		return null;
	}
	return { minX, minY, maxX, maxY };
}

export function getSelectionBoundingBox(sketch: SketchDocument): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let count = 0;

	const includePoint = (p?: SketchPoint | null) => {
		if (!p) return;
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
		count++;
	};

	for (const pid of sketch.selection.pointIds) {
		includePoint(sketch.points.get(pid));
	}

	for (const lid of sketch.selection.lineIds) {
		const l = sketch.lines.get(lid);
		if (l) {
			includePoint(sketch.points.get(l.p1Id));
			includePoint(sketch.points.get(l.p2Id));
		}
	}

	for (const cid of sketch.selection.circleIds) {
		const c = sketch.circles.get(cid);
		if (c) {
			const center = sketch.points.get(c.centerId);
			if (center) {
				if (center.x - c.radius < minX) minX = center.x - c.radius;
				if (center.x + c.radius > maxX) maxX = center.x + c.radius;
				if (center.y - c.radius < minY) minY = center.y - c.radius;
				if (center.y + c.radius > maxY) maxY = center.y + c.radius;
				count++;
			}
		}
	}

	for (const aid of sketch.selection.arcIds) {
		const a = sketch.arcs.get(aid);
		if (a) {
			const center = sketch.points.get(a.centerId);
			if (center) {
				if (center.x - a.radius < minX) minX = center.x - a.radius;
				if (center.x + a.radius > maxX) maxX = center.x + a.radius;
				if (center.y - a.radius < minY) minY = center.y - a.radius;
				if (center.y + a.radius > maxY) maxY = center.y + a.radius;
				count++;
			}
			includePoint(sketch.points.get(a.startPointId));
			includePoint(sketch.points.get(a.endPointId));
		}
	}

	for (const eid of sketch.selection.ellipseIds) {
		const e = sketch.ellipses.get(eid);
		if (e) {
			const center = sketch.points.get(e.centerId);
			const maj = sketch.points.get(e.majorAxisPointId);
			const min = sketch.points.get(e.minorAxisPointId);
			if (center && maj && min) {
				const ux = maj.x - center.x;
				const uy = maj.y - center.y;
				const vx = min.x - center.x;
				const vy = min.y - center.y;
				const dx = Math.sqrt(ux * ux + vx * vx);
				const dy = Math.sqrt(uy * uy + vy * vy);
				if (center.x - dx < minX) minX = center.x - dx;
				if (center.x + dx > maxX) maxX = center.x + dx;
				if (center.y - dy < minY) minY = center.y - dy;
				if (center.y + dy > maxY) maxY = center.y + dy;
				count++;
			}
		}
	}

	for (const eaid of sketch.selection.ellipticalArcIds) {
		const ea = sketch.ellipticalArcs.get(eaid);
		if (ea) {
			const center = sketch.points.get(ea.centerId);
			const maj = sketch.points.get(ea.majorAxisPointId);
			const min = sketch.points.get(ea.minorAxisPointId);
			if (center && maj && min) {
				const ux = maj.x - center.x;
				const uy = maj.y - center.y;
				const vx = min.x - center.x;
				const vy = min.y - center.y;
				const dx = Math.sqrt(ux * ux + vx * vx);
				const dy = Math.sqrt(uy * uy + vy * vy);
				if (center.x - dx < minX) minX = center.x - dx;
				if (center.x + dx > maxX) maxX = center.x + dx;
				if (center.y - dy < minY) minY = center.y - dy;
				if (center.y + dy > maxY) maxY = center.y + dy;
				count++;
			}
			includePoint(sketch.points.get(ea.startPointId));
			includePoint(sketch.points.get(ea.endPointId));
		}
	}

	for (const sid of sketch.selection.splineIds) {
		const s = sketch.splines.get(sid);
		if (s) {
			for (const pid of s.pointIds) {
				includePoint(sketch.points.get(pid));
			}
			if (s.tangentLineIds) {
				for (const lid of s.tangentLineIds) {
					const l = sketch.lines.get(lid);
					if (l) {
						includePoint(sketch.points.get(l.p1Id));
						includePoint(sketch.points.get(l.p2Id));
					}
				}
			}
		}
	}

	if (count === 0 && sketch.selection.constraintIds.size > 0) {
		for (const cid of sketch.selection.constraintIds) {
			const c = sketch.constraints.get(cid);
			if (c) {
				const entities = sketch.getEntitiesForConstraint(c);
				for (const ent of entities) {
					if (ent.type === 'point') {
						includePoint(sketch.points.get(ent.id));
					} else if (ent.type === 'line') {
						const l = sketch.lines.get(ent.id);
						if (l) {
							includePoint(sketch.points.get(l.p1Id));
							includePoint(sketch.points.get(l.p2Id));
						}
					} else if (ent.type === 'circle') {
						const circle = sketch.circles.get(ent.id);
						if (circle) {
							const center = sketch.points.get(circle.centerId);
							if (center) {
								if (center.x - circle.radius < minX) minX = center.x - circle.radius;
								if (center.x + circle.radius > maxX) maxX = center.x + circle.radius;
								if (center.y - circle.radius < minY) minY = center.y - circle.radius;
								if (center.y + circle.radius > maxY) maxY = center.y + circle.radius;
								count++;
							}
						}
					} else if (ent.type === 'arc') {
						const arc = sketch.arcs.get(ent.id);
						if (arc) {
							const center = sketch.points.get(arc.centerId);
							if (center) {
								if (center.x - arc.radius < minX) minX = center.x - arc.radius;
								if (center.x + arc.radius > maxX) maxX = center.x + arc.radius;
								if (center.y - arc.radius < minY) minY = center.y - arc.radius;
								if (center.y + arc.radius > maxY) maxY = center.y + arc.radius;
								count++;
							}
							includePoint(sketch.points.get(arc.startPointId));
							includePoint(sketch.points.get(arc.endPointId));
						}
					}
				}
			}
		}
	}

	if (count === 0 || !isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
		return null;
	}

	return { minX, minY, maxX, maxY };
}

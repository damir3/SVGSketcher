import type { SketchDocument } from '../model/sketch';
import type { SketchLine } from '../model/types';
import type { Viewport } from './viewport';
import { ORIGIN, Vec2 } from '../math/vector';
import { SNAP_GEOMETRY_DISTANCE_PX, SNAP_GRID_DISTANCE_PX, SNAP_POINT_DISTANCE_PX } from './distances';
import { HorizontalConstraint, VerticalConstraint } from '../solver/constraints';
import { isConstraintTool, type SnapResult, type ToolType } from './tools';
import { showToast } from '../ui/toast';

export function getSelectedSplineIds(sketch: SketchDocument): Set<string> {
	const selectedSplineIds = new Set<string>(sketch.selection.splineIds);
	for (const spline of sketch.splines.values()) {
		if (spline.pointIds.some(pid => sketch.selection.pointIds.has(pid))) {
			selectedSplineIds.add(spline.id);
			continue;
		}
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				const line = sketch.lines.get(lid);
				if (
					line &&
					(sketch.selection.lineIds.has(lid) ||
						sketch.selection.pointIds.has(line.p1Id) ||
						sketch.selection.pointIds.has(line.p2Id))
				) {
					selectedSplineIds.add(spline.id);
					break;
				}
			}
		}
	}
	return selectedSplineIds;
}

export function isSplineHandleLineVisible(
	sketch: SketchDocument,
	line: SketchLine,
	activeTool: ToolType,
	selectedSplineIds?: Set<string>
): boolean {
	if (!line.isSplineHandle || isConstraintTool(activeTool)) return true;
	if (
		sketch.selection.lineIds.has(line.id) ||
		sketch.selection.pointIds.has(line.p1Id) ||
		sketch.selection.pointIds.has(line.p2Id)
	) {
		return true;
	}
	if (!line.parentSplineId) return false;
	if (selectedSplineIds) return selectedSplineIds.has(line.parentSplineId);
	const parentSpline = sketch.splines.get(line.parentSplineId);
	return Boolean(
		parentSpline &&
			(sketch.selection.splineIds.has(parentSpline.id) ||
				parentSpline.pointIds.some(pid => sketch.selection.pointIds.has(pid)))
	);
}

function cleanGridCoordinate(val: number, step: number): number {
	const stepStr = step.toString();
	const decimalIdx = stepStr.indexOf('.');
	const decimals = decimalIdx >= 0 ? Math.min(stepStr.length - decimalIdx - 1 + 4, 10) : 4;
	return parseFloat(val.toFixed(decimals));
}

export function findSnapTarget(
	sketch: SketchDocument,
	viewport: Viewport,
	screenPos: Vec2,
	options: {
		activeTool: ToolType;
		isSnapModifierPressed: boolean;
		isSnappingEnabled: boolean;
		excludePointId?: string;
		allowGrid?: boolean;
	}
): SnapResult | null {
	const { activeTool, isSnapModifierPressed, isSnappingEnabled, excludePointId, allowGrid = true } = options;
	// Suppress all snapping if snap modifier is held (metaKey on Mac, ctrlKey on Windows)
	if (isSnapModifierPressed) {
		return null;
	}

	// Priority 1: Point snapping (Always active, highest priority)
	const pointSnapDistPx = SNAP_POINT_DISTANCE_PX;
	let closestPointDist = pointSnapDistPx;
	let foundPoint: { id: string; worldPos: Vec2; screenPos: Vec2 } | null = null;

	// A dragged spline point can move its own handles, so they cannot be snap targets.
	const excludedSplineIds = new Set<string>();
	const excludedHandleLineIds = new Set<string>();
	const excludedHandlePointIds = new Set<string>();
	if (excludePointId) {
		for (const spline of sketch.splines.values()) {
			const handles = (spline.tangentLineIds ?? []).map(id => sketch.lines.get(id));
			if (
				!spline.pointIds.includes(excludePointId) &&
				!handles.some(line => line?.p1Id === excludePointId || line?.p2Id === excludePointId)
			) {
				continue;
			}
			excludedSplineIds.add(spline.id);
			for (const line of handles) {
				if (!line) continue;
				excludedHandleLineIds.add(line.id);
				if (spline.splineType === 'fit') {
					excludedHandlePointIds.add(line.p1Id);
					excludedHandlePointIds.add(line.p2Id);
				}
			}
		}
	}

	const selectedSplineIds = getSelectedSplineIds(sketch);

	for (const pt of sketch.points.values()) {
		if (pt.id === excludePointId || excludedHandlePointIds.has(pt.id)) continue;
		// If point belongs to a spline handle or control polygon, only snap if spline is selected or constraint tool active
		let isHiddenSplinePoint = false;
		if (!isConstraintTool(activeTool)) {
			for (const spline of sketch.splines.values()) {
				if (selectedSplineIds.has(spline.id)) continue;
				if (spline.splineType === 'control') {
					const isEndpoint = pt.id === spline.pointIds[0] || pt.id === spline.pointIds[spline.pointIds.length - 1];
					if (!isEndpoint && spline.pointIds.includes(pt.id)) {
						isHiddenSplinePoint = true;
						break;
					}
				} else if (spline.tangentLineIds) {
					for (const lid of spline.tangentLineIds) {
						const l = sketch.lines.get(lid);
						if (l && (l.p1Id === pt.id || l.p2Id === pt.id)) {
							isHiddenSplinePoint = true;
							break;
						}
					}
				}
				if (isHiddenSplinePoint) break;
			}
		}
		if (isHiddenSplinePoint) continue;

		const s = viewport.worldToScreen(pt);
		const d = screenPos.distanceTo(s);
		if (d < closestPointDist) {
			closestPointDist = d;
			foundPoint = { id: pt.id, worldPos: pt.clone(), screenPos: s };
		}
	}

	if (excludePointId !== 'origin') {
		const sOrigin = viewport.worldToScreen(ORIGIN);
		const dOrigin = screenPos.distanceTo(sOrigin);
		if (dOrigin < closestPointDist) {
			closestPointDist = dOrigin;
			foundPoint = { id: 'origin', worldPos: new Vec2(0, 0), screenPos: sOrigin };
		}
	}

	if (foundPoint) {
		return {
			type: 'point',
			id: foundPoint.id,
			worldPos: foundPoint.worldPos,
			screenPos: foundPoint.screenPos,
		};
	}

	// Priority 2: Line, Circle/Arc, Ellipse & Spline snapping
	const geomSnapDistPx = SNAP_GEOMETRY_DISTANCE_PX;
	let closestGeomDist = geomSnapDistPx;
	let foundGeom: {
		type: 'line' | 'circle' | 'ellipse' | 'spline';
		id: string;
		worldPos: Vec2;
		screenPos: Vec2;
	} | null = null;

	for (const prim of sketch.getCurvePrimitives()) {
		if (prim.type === 'spline') {
			if (excludedSplineIds.has(prim.id)) continue;
		} else if (excludePointId && prim.getPointIds().includes(excludePointId)) {
			continue;
		}
		if (prim.type === 'line') {
			const line = prim as SketchLine;
			if (excludedHandleLineIds.has(line.id)) continue;
			if (!isSplineHandleLineVisible(sketch, line, activeTool, selectedSplineIds)) continue;
		}

		const snap = prim.snapTo(screenPos, sketch, viewport, closestGeomDist, geomSnapDistPx);
		if (snap && snap.dist < closestGeomDist) {
			closestGeomDist = snap.dist;
			foundGeom = snap;
		}
	}

	if (foundGeom) {
		return {
			type: foundGeom.type,
			id: foundGeom.id,
			worldPos: foundGeom.worldPos,
			screenPos: foundGeom.screenPos,
		};
	}

	// Priority 3: Coordinate axes & grid snapping
	if (!isSnappingEnabled || !allowGrid) {
		return null;
	}

	const sOrigin = viewport.worldToScreen(ORIGIN);
	const dAxisX = Math.abs(screenPos.y - sOrigin.y);
	const dAxisY = Math.abs(screenPos.x - sOrigin.x);

	const world = viewport.screenToWorld(screenPos);
	const { step, subStep } = viewport.getGridStep();
	const subStepPx = subStep * viewport.zoom;
	const gridStep = subStepPx >= 6 ? subStep : step;
	const nearestWorld = new Vec2(
		cleanGridCoordinate(Math.round(world.x / gridStep) * gridStep, gridStep),
		cleanGridCoordinate(Math.round(world.y / gridStep) * gridStep, gridStep)
	);
	const nearestScreen = viewport.worldToScreen(nearestWorld);

	if (dAxisX < geomSnapDistPx && dAxisX <= dAxisY) {
		const snapToGrid = Math.abs(screenPos.x - nearestScreen.x) <= SNAP_GRID_DISTANCE_PX;
		const snapX = snapToGrid ? nearestWorld.x : world.x;
		const snapScreenX = snapToGrid ? nearestScreen.x : screenPos.x;
		return {
			type: 'line',
			id: 'axis_x',
			worldPos: new Vec2(snapX, 0),
			screenPos: new Vec2(snapScreenX, sOrigin.y),
		};
	}

	if (dAxisY < geomSnapDistPx) {
		const snapToGrid = Math.abs(screenPos.y - nearestScreen.y) <= SNAP_GRID_DISTANCE_PX;
		const snapY = snapToGrid ? nearestWorld.y : world.y;
		const snapScreenY = snapToGrid ? nearestScreen.y : screenPos.y;
		return {
			type: 'line',
			id: 'axis_y',
			worldPos: new Vec2(0, snapY),
			screenPos: new Vec2(sOrigin.x, snapScreenY),
		};
	}

	if (screenPos.distanceTo(nearestScreen) <= SNAP_GRID_DISTANCE_PX) {
		return {
			type: 'grid',
			worldPos: nearestWorld,
			screenPos: nearestScreen,
		};
	}

	return null;
}

export function applySnapConstraint(sketch: SketchDocument, pointId: string, snap: SnapResult | null): void {
	if (!snap || !snap.id) return;
	if (snap.type === 'point' && snap.id !== pointId) {
		if (snap.id === 'origin') {
			if (sketch.addOriginCoincidentConstraint(pointId)) {
				showToast('Coincident with origin applied');
			}
		} else if (sketch.addCoincidentConstraint(pointId, snap.id)) {
			showToast('Coincident constraint applied');
		}
	} else if (snap.type === 'line') {
		if (snap.id === 'axis_x' || snap.id === 'axis_y') {
			const axis = snap.id === 'axis_x' ? 'x' : 'y';
			if (sketch.addPointOnAxisConstraint(pointId, axis)) {
				showToast(`Point constrained to ${axis.toUpperCase()}-axis`);
			}
		} else if (sketch.addPointOnLineConstraint(pointId, snap.id)) {
			showToast('Point constrained to line');
		}
	} else if (snap.type === 'circle') {
		if (sketch.addPointOnCircleConstraint(pointId, snap.id)) {
			showToast('Point constrained to circle');
		}
	} else if (snap.type === 'ellipse') {
		const isArc = sketch.ellipticalArcs.has(snap.id);
		if (sketch.addPointOnEllipseConstraint(pointId, snap.id)) {
			showToast(isArc ? 'Point constrained to elliptical arc' : 'Point constrained to ellipse');
		}
	} else if (snap.type === 'spline') {
		if (sketch.addPointOnSplineConstraint(pointId, snap.id)) {
			showToast('Point constrained to spline');
		}
	}
}

export function applyAutoOrientation(sketch: SketchDocument, p1Id: string, p2Id: string): void {
	const p1 = sketch.getPoint(p1Id);
	const p2 = sketch.getPoint(p2Id);
	if (!p1 || !p2) return;

	const dir = new Vec2().subVectors(p2, p1);
	if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) return;

	const angleDeg = dir.angleToXAxisDeg();

	if (angleDeg < 1.0) {
		const alreadyHoriz = [...sketch.constraints.values()].some(
			c =>
				c instanceof HorizontalConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
		);
		if (!alreadyHoriz) {
			sketch.addHorizontalConstraint(p1Id, p2Id);
			showToast('Horizontal constraint applied');
		}
		return;
	}

	if (90 - angleDeg < 1.0) {
		const alreadyVert = [...sketch.constraints.values()].some(
			c =>
				c instanceof VerticalConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
		);
		if (!alreadyVert) {
			sketch.addVerticalConstraint(p1Id, p2Id);
			showToast('Vertical constraint applied');
		}
	}
}

export function computeAxisSnappedWorldPos(
	startPos: Vec2,
	targetPos: Vec2,
	snap: SnapResult | null,
	isSnapModifierPressed: boolean
): { pos: Vec2; axis: 'horizontal' | 'vertical' | null } {
	if (isSnapModifierPressed || snap) {
		return { pos: targetPos, axis: null };
	}

	const dir = new Vec2().subVectors(targetPos, startPos);
	if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
		return { pos: targetPos, axis: null };
	}

	const angleDeg = dir.angleToXAxisDeg();
	if (angleDeg < 1.0) {
		return { pos: new Vec2(targetPos.x, startPos.y), axis: 'horizontal' };
	}
	if (90 - angleDeg < 1.0) {
		return { pos: new Vec2(startPos.x, targetPos.y), axis: 'vertical' };
	}
	return { pos: targetPos, axis: null };
}

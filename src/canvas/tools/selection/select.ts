import { BaseTool } from '../base';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import type { ITool, SnapResult, ToolType } from '../types';
import type { SketchDocument } from '../../../model/sketch';
import type { SketchSnapshot } from '../../../model/history';
import type { Viewport } from '../../viewport';
import type { SVGRenderer } from '../../renderer';
import type { ISketchPrimitive, SketchLine } from '../../../model/types';
import { DistanceConstraint, RadiusConstraint, RectangularPatternConstraint } from '../../../solver/constraints';
import { DimensionTool } from '../constraints/dimension';
import { AABB, curveContainedInAABB } from '../../../math/aabb';
import type { GeoCurve } from '../../../math/intersection';
import { Vec2 } from '../../../math/vector';
import { LABEL_DISTANCE_PX } from '../../distances';
import { hitGizmoHandle } from '../../modifyPreviews';
import {
	findArcNear,
	findCircleNear,
	findConstraintNear,
	findLineNear,
	findPointNear,
	findSelectableEntityNear,
	findTextNear,
} from '../../hitTesting';

export interface SelectInteractionHost {
	sketch: SketchDocument;
	viewport: Viewport;
	renderer?: SVGRenderer;
	svg?: SVGSVGElement;
	sidebar?: any;
	activeTool: ToolType;
	activeToolInstance: ITool | null;
	selectedImageId: string | null;
	lastMouseScreen: Vec2;
	onEditDimension?: (constraint: any, screenPos: Vec2) => void;
	isDraggingPoint: boolean;
	draggedPointId: string | null;
	dragPointStartWorld: Vec2 | null;
	curveDragState: {
		primitive: ISketchPrimitive;
		startWorld: Vec2;
		initialPoints: Map<string, Vec2>;
	} | null;
	isDraggingConstraint: boolean;
	draggedConstraintId: string | null;
	dragConstraintStartScreen: Vec2 | null;
	isBoxSelecting: boolean;
	boxSelectStartScreen: Vec2 | null;
	boxSelectCurrentScreen: Vec2 | null;
	boxSelectShift: boolean;
	boxSelectImageId: string | null;
	pendingExclusiveSelection: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'text' | 'constraint';
	} | null;
	preDragSnapshot: SketchSnapshot | null;
	hasDragged: boolean;
	textRotationDragState: { textId: string; centerWorld: Vec2 } | null;
	textDragState: { textId: string; startWorld: Vec2; initialPoints: Map<string, Vec2> } | null;
	gizmoDragState: {
		axis: 1 | 2;
		startMouseWorld: Vec2;
		centroidWorld: Vec2;
		u: Vec2;
		startDistance: number;
		constraintId?: string;
	} | null;
	setTool(tool: ToolType): void;
	selectImage(id: string): void;
	cancelDrawing(): void;
	render(): void;
	updateCursor?(): void;
	getScreenPos(e: MouseEvent): Vec2;
	findSnap(screen: Vec2, excludePointId?: string, allowGrid?: boolean): SnapResult | null;
	applySnapConstraintIfNeeded(pointId: string, snap: SnapResult | null): void;
	finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void;
}

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';

	override isHighlightEnabled(): boolean {
		return true;
	}

	// Leaving select mode must preserve the current selection so modify tools can
	// initialize their object lists from it. Escape still clears via cancel().
	override deactivate(): void {}

	override canHighlight(target: HoverTarget): boolean {
		return target.id !== 'origin' && target.id !== 'axis_x' && target.id !== 'axis_y';
	}

	override getHighlightClass(_target: HoverTarget): string {
		return 'select-hover';
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: true, allowAxes: false, allowOrigin: false };
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	static performBoxSelection(
		sketch: SketchDocument,
		viewport: Viewport,
		s1: Vec2,
		s2: Vec2,
		shiftKey: boolean,
		activeTool: ToolType,
		tool?: ITool | null
	): void {
		const w1 = viewport.screenToWorld(s1);
		const w2 = viewport.screenToWorld(s2);
		const bounds = AABB.fromPoints([w1, w2])!;
		const { min, max } = bounds;
		const crossing = s2.x < s1.x;
		const matches = (entity: {
			intersectsAABB(min: Vec2, max: Vec2, sketch: SketchDocument): boolean;
			toGeoCurve(sketch: SketchDocument): GeoCurve | null;
		}): boolean => {
			if (crossing) return entity.intersectsAABB(min, max, sketch);
			const curve = entity.toGeoCurve(sketch);
			return curve !== null && curveContainedInAABB(curve, min, max);
		};

		const itemsToSelect: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
		}> = [];

		const hasToolBoxSelect =
			Boolean(tool?.handleBoxSelect) ||
			activeTool === 'mirror' ||
			activeTool === 'circular_pattern' ||
			activeTool === 'rectangular_pattern';

		for (const pt of sketch.points.values()) {
			if (hasToolBoxSelect && sketch.isSplineHandlePoint(pt.id)) continue;
			if (pt.intersectsAABB(min, max, sketch)) {
				itemsToSelect.push({ id: pt.id, type: 'point' });
			}
		}

		for (const prim of sketch.getCurvePrimitives()) {
			if (hasToolBoxSelect && prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
			if (matches(prim)) {
				itemsToSelect.push({ id: prim.id, type: prim.type });
			}
		}

		if (tool?.handleBoxSelect) {
			tool.handleBoxSelect(itemsToSelect);
			return;
		}

		sketch.selectEntities(itemsToSelect, activeTool === 'transform' ? 'toggle' : shiftKey);
	}

	static triggerDimensionEditAt(host: SelectInteractionHost, e: MouseEvent, screen: Vec2, clientPos: Vec2): boolean {
		const { sketch, viewport, onEditDimension } = host;
		const target = e.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type');

		if (!type || (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'constraint')) {
			const hitConstraint = findConstraintNear(sketch, viewport, screen);
			if (hitConstraint) {
				id = hitConstraint.id;
				type = 'constraint';
			} else {
				const hitLine = findLineNear(sketch, viewport, screen, host.activeTool);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = findCircleNear(sketch, viewport, screen);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = findArcNear(sketch, viewport, screen);
						if (hitArc) {
							id = hitArc.id;
							type = 'arc';
						}
					}
				}
			}
		}

		if (!id || !type) return false;

		if (type === 'constraint') {
			const constraint = sketch.constraints.get(id);
			if (constraint?.moveLabelTo && onEditDimension) {
				sketch.selectEntity(constraint.id, 'constraint', false);
				host.render();
				onEditDimension(constraint, clientPos);
				return true;
			}
		} else if (type === 'line') {
			const line = sketch.lines.get(id);
			if (line) {
				let distConstraint = [...sketch.constraints.values()].find(
					(c): c is DistanceConstraint =>
						c instanceof DistanceConstraint &&
						((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
				);
				if (!distConstraint) {
					distConstraint = sketch.addDistanceConstraint(line.p1Id, line.p2Id) ?? undefined;
				}
				if (distConstraint && onEditDimension) {
					sketch.selectEntity(distConstraint.id, 'constraint', false);
					host.render();
					onEditDimension(distConstraint, clientPos);
					return true;
				}
			}
		} else if (type === 'circle' || type === 'arc') {
			const entity = sketch.circles.get(id) ?? sketch.arcs.get(id);
			if (entity) {
				const radConstraint = [...sketch.constraints.values()].find(
					(c): c is RadiusConstraint => c instanceof RadiusConstraint && c.circleId === entity.id
				);
				if (!radConstraint) {
					sketch.clearSelection();
					host.setTool('dimension');
					if (host.activeToolInstance instanceof DimensionTool) {
						host.activeToolInstance.beginRadiusPlacement(entity.id, true);
						return true;
					}
				}
				if (radConstraint && onEditDimension) {
					sketch.selectEntity(radConstraint.id, 'constraint', false);
					host.render();
					onEditDimension(radConstraint, clientPos);
					return true;
				}
			}
		}
		return false;
	}

	static tryHandleDoubleClickAt(host: SelectInteractionHost, e: MouseEvent, screen: Vec2, clientPos: Vec2): boolean {
		const targetEl = e.target as SVGElement | null;
		const clickedText = findTextNear(host.sketch, host.viewport, screen, targetEl);
		if (clickedText) {
			e.preventDefault();
			e.stopPropagation();
			host.cancelDrawing();
			host.sketch.selectEntity(clickedText.id, 'text', false);
			host.sidebar?.render();
			const textarea = host.sidebar?.container?.querySelector('#text-tool-input-text') as HTMLTextAreaElement | null;
			textarea?.focus();
			return true;
		}

		if (SelectTool.triggerDimensionEditAt(host, e, screen, clientPos)) {
			e.preventDefault();
			e.stopPropagation();
			if (host.activeTool === 'select') host.cancelDrawing();
			return true;
		}
		return false;
	}

	static isInteracting(host: SelectInteractionHost): boolean {
		return Boolean(
			host.isDraggingPoint ||
				host.isBoxSelecting ||
				host.gizmoDragState ||
				host.textRotationDragState ||
				host.textDragState
		);
	}

	static resetDragState(host: SelectInteractionHost): void {
		host.isDraggingPoint = false;
		host.draggedPointId = null;
		host.dragPointStartWorld = null;
		host.curveDragState = null;
		host.isDraggingConstraint = false;
		host.draggedConstraintId = null;
		host.dragConstraintStartScreen = null;
		host.preDragSnapshot = null;
		host.hasDragged = false;
		host.svg?.classList?.remove('is-dragging');
		host.isBoxSelecting = false;
		host.boxSelectStartScreen = null;
		host.boxSelectCurrentScreen = null;
		host.boxSelectShift = false;
		host.boxSelectImageId = null;
		host.pendingExclusiveSelection = null;
		if (host.renderer) {
			host.renderer.deferRegionSolve = false;
			host.renderer.clearPreviews?.();
		}
	}

	static beginBoxSelection(
		host: SelectInteractionHost,
		screen: Vec2,
		shiftKey: boolean,
		imageId: string | null = null
	): void {
		host.isBoxSelecting = true;
		host.boxSelectStartScreen = screen;
		host.boxSelectCurrentScreen = screen;
		host.boxSelectShift = shiftKey;
		host.boxSelectImageId = imageId;
	}

	static handleMouseDown(host: SelectInteractionHost, e: MouseEvent, screen: Vec2, imageId: string | null): void {
		if (host.activeTool === 'select' || host.activeTool === 'image') {
			if (imageId && host.sketch.images.has(imageId)) {
				SelectTool.beginBoxSelection(host, screen, e.shiftKey, imageId);
				return;
			}
			if (host.activeTool === 'image') host.setTool('select');
		}

		const world = host.viewport.screenToWorld(screen);
		const snap = host.findSnap ? host.findSnap(screen) : null;

		const textGizmo = host.renderer?.textRotationGizmo;
		if (textGizmo && screen.distanceTo(textGizmo.handleScreen) <= 15) {
			host.textRotationDragState = {
				textId: textGizmo.textId,
				centerWorld: textGizmo.centerWorld,
			};
			host.sketch.beginTransaction();
			return;
		}

		const textDragGizmo = host.renderer?.textDragGizmo;
		if (textDragGizmo && screen.distanceTo(textDragGizmo.centerScreen) <= 15) {
			const text = host.sketch.texts.get(textDragGizmo.textId);
			host.textDragState = {
				textId: textDragGizmo.textId,
				startWorld: world,
				initialPoints: text ? text.captureRectanglePoints(host.sketch) : new Map(),
			};
			host.sketch.beginTransaction();
			return;
		}

		const gizmoHandle = hitGizmoHandle(screen, host.renderer?.rectangularGizmoHandles?.values(), undefined, h =>
			Boolean(h.constraintId)
		);
		if (gizmoHandle?.constraintId) {
			const constraint = host.sketch.constraints.get(gizmoHandle.constraintId);
			if (constraint instanceof RectangularPatternConstraint) {
				const dragState = constraint.createGizmoDragState(host.sketch, gizmoHandle.axis, world);
				if (dragState) {
					host.sketch.selectEntity(gizmoHandle.constraintId, 'constraint', false);
					host.gizmoDragState = dragState;
					return;
				}
			}
		}

		if (host.activeTool === 'select' && host.renderer?.patternCheckboxPositions) {
			for (const entry of host.renderer.patternCheckboxPositions.values()) {
				if (
					entry.constraintId &&
					Math.abs(screen.x - entry.x) <= LABEL_DISTANCE_PX &&
					Math.abs(screen.y - entry.y) <= LABEL_DISTANCE_PX
				) {
					const c = host.sketch.constraints.get(entry.constraintId);
					if (c?.toggleSuppressedCopy?.(host.sketch, entry.copyIndex)) {
						host.render();
						return;
					}
				}
			}
		}

		if (host.activeTool === 'select' || host.activeTool === 'transform') {
			const target = e.target as SVGElement | undefined;
			const targetG = target?.closest?.('[data-id]') as SVGElement | null;
			let id = targetG?.getAttribute('data-id');
			let type = targetG?.getAttribute('data-type') as
				| 'point'
				| 'line'
				| 'circle'
				| 'arc'
				| 'ellipse'
				| 'elliptical_arc'
				| 'spline'
				| 'text'
				| 'constraint'
				| undefined;

			const nearPoint = type !== 'constraint' ? findPointNear(host.sketch, host.viewport, screen) : null;
			if (nearPoint) {
				id = nearPoint.id;
				type = 'point';
			} else if (!type) {
				if (snap && snap.type === 'point' && snap.id) {
					id = snap.id;
					type = 'point';
				} else {
					const fallback = findSelectableEntityNear(host.sketch, host.viewport, screen, host.activeTool, target);
					if (fallback) {
						id = fallback.id;
						type = fallback.type;
					}
				}
			}

			if (host.activeTool === 'select' && type && type !== 'constraint' && type !== 'point') {
				const hitConstraint = findConstraintNear(host.sketch, host.viewport, screen);
				if (hitConstraint && !hitConstraint.isInternalConstraint?.(host.sketch)) {
					id = hitConstraint.id;
					type = 'constraint';
				}
			}

			if (host.activeTool === 'transform' && type === 'constraint') return;
			if (id && type) {
				const isToggle = host.activeTool === 'transform' || e.metaKey || e.ctrlKey;
				if (isToggle) {
					host.sketch.toggleEntitySelection(id, type);
					host.render();
					return;
				}

				const wasAlreadySelected = host.sketch.isEntitySelected(id, type);
				if (e.shiftKey) {
					host.sketch.selectEntity(id, type, true);
				} else if (!wasAlreadySelected) {
					host.sketch.selectEntity(id, type, false);
				} else {
					host.pendingExclusiveSelection = { id, type };
				}

				if (type === 'point' && id !== 'origin') {
					host.renderer?.clearPreviews?.();
					host.isDraggingPoint = true;
					host.draggedPointId = id;
					host.preDragSnapshot = host.sketch.takeSnapshot();
					host.hasDragged = false;
					const pt = host.sketch.points.get(id);
					if (pt) {
						host.dragPointStartWorld = pt.clone();
					}
				} else if (
					type === 'line' ||
					type === 'circle' ||
					type === 'arc' ||
					type === 'ellipse' ||
					type === 'elliptical_arc' ||
					type === 'spline'
				) {
					const prim = host.sketch.getPrimitive(id, type);
					if (prim) {
						const pointIds = prim.getPointIds(host.sketch);
						const initialPoints = new Map<string, Vec2>();
						for (const pid of pointIds) {
							const pt = host.sketch.points.get(pid);
							if (pt) initialPoints.set(pid, pt.clone());
						}
						if (type === 'spline' || initialPoints.size === pointIds.length) {
							host.curveDragState = {
								primitive: prim,
								startWorld: world,
								initialPoints,
							};
							host.preDragSnapshot = host.sketch.takeSnapshot();
							host.hasDragged = false;
						}
					}
				} else if (type === 'constraint') {
					const constraint = host.sketch.constraints.get(id);
					if (constraint?.moveLabelTo) {
						host.isDraggingConstraint = true;
						host.draggedConstraintId = id;
						host.preDragSnapshot = host.sketch.takeSnapshot();
						host.hasDragged = false;
						host.dragConstraintStartScreen = screen;
					}
				}

				if (host.renderer) {
					host.renderer.deferRegionSolve = Boolean(host.isDraggingPoint || host.curveDragState);
				}
				host.svg?.classList?.add('is-dragging');
				host.render();
			} else {
				SelectTool.beginBoxSelection(host, screen, Boolean(e.shiftKey));
				if (host.activeTool === 'select' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
					host.sketch.clearSelection();
					host.render();
				}
			}
		}
	}

	static handleDragMouseMove(host: SelectInteractionHost, e: MouseEvent, screen: Vec2, world: Vec2): boolean {
		if (host.gizmoDragState) {
			const { constraintId } = host.gizmoDragState;
			const constraint = constraintId ? host.sketch.constraints.get(constraintId) : undefined;
			if (
				constraint instanceof RectangularPatternConstraint &&
				constraint.applyGizmoDrag(host.sketch, host.gizmoDragState, world)
			) {
				host.render();
			}
			return true;
		}

		if (host.textRotationDragState) {
			const text = host.sketch.texts.get(host.textRotationDragState.textId);
			if (text?.rotateRectangleTo(host.sketch, host.textRotationDragState.centerWorld, world)) {
				host.render();
			}
			return true;
		}

		if (host.textDragState) {
			const text = host.sketch.texts.get(host.textDragState.textId);
			if (text) {
				text.translateRectangle(host.sketch, host.textDragState.startWorld, world, host.textDragState.initialPoints);
			} else {
				const dir = new Vec2().subVectors(world, host.textDragState.startWorld);
				for (const [pid, initPos] of host.textDragState.initialPoints) {
					host.sketch.points.get(pid)?.addVectors(initPos, dir);
				}
				host.sketch.solve();
			}
			host.render();
			return true;
		}

		if (host.isBoxSelecting && host.boxSelectStartScreen) {
			host.boxSelectCurrentScreen = screen;
			host.renderer?.renderSelectionBox?.(host.boxSelectStartScreen, host.boxSelectCurrentScreen);
			return true;
		}

		if (host.isDraggingConstraint && host.draggedConstraintId) {
			if (host.dragConstraintStartScreen && screen.distanceTo(host.dragConstraintStartScreen) > 3) {
				host.hasDragged = true;
			}
			if (host.hasDragged) {
				const constraint = host.sketch.constraints.get(host.draggedConstraintId);
				if (constraint?.moveLabelTo) {
					constraint.moveLabelTo(screen, host.sketch, host.viewport);
					host.render();
				}
			}
			return true;
		}

		if (host.isDraggingPoint && host.draggedPointId && host.dragPointStartWorld) {
			host.hasDragged = true;
			const snap = host.findSnap(screen, host.draggedPointId);
			const targetWorld = host.sketch.getPointDragTarget(host.draggedPointId, snap?.worldPos ?? world);
			host.sketch.dragPoint(host.draggedPointId, targetWorld.x, targetWorld.y);
			host.render();
			if (snap && targetWorld.equals(snap.worldPos)) {
				host.renderer?.renderSnapIndicator?.(snap.screenPos, snap.type, true);
			} else {
				host.renderer?.clearPreviews?.();
			}
			return true;
		}

		if (host.curveDragState) {
			host.hasDragged = true;
			const { primitive, startWorld, initialPoints } = host.curveDragState;
			primitive.drag(host.sketch, startWorld, world, initialPoints, e);
			host.render();
			return true;
		}

		return false;
	}

	static handleMouseUp(host: SelectInteractionHost, e?: MouseEvent): void {
		const primitiveMoved = Boolean((host.isDraggingPoint || host.curveDragState) && host.hasDragged);
		host.svg?.classList?.remove('is-dragging');

		if (host.gizmoDragState) {
			host.gizmoDragState = null;
			host.render();
		}
		if (host.textRotationDragState) {
			host.textRotationDragState = null;
			host.sketch.commitTransaction();
			host.render();
		}
		if (host.textDragState) {
			host.textDragState = null;
			host.sketch.commitTransaction();
			host.render();
		}
		if (host.isDraggingPoint) {
			const draggedPtId = host.draggedPointId;
			host.isDraggingPoint = false;
			host.draggedPointId = null;
			host.dragPointStartWorld = null;
			host.renderer?.clearPreviews?.();
			if (host.hasDragged) {
				if (draggedPtId) {
					const screen = e ? host.getScreenPos(e) : host.lastMouseScreen;
					const snap = host.findSnap(screen, draggedPtId);
					const target = snap && host.sketch.getPointDragTarget(draggedPtId, snap.worldPos);
					if (snap && target && (host.sketch.isSplineHandlePoint(draggedPtId) || !target.equals(snap.worldPos))) {
						host.sketch.dragPoint(draggedPtId, target.x, target.y);
					} else if (snap && snap.id && (snap.type !== 'point' || snap.id !== draggedPtId)) {
						const pt = host.sketch.getPoint(draggedPtId);
						if (pt) {
							pt.copy(snap.worldPos);
						}
						if (host.preDragSnapshot) {
							host.sketch.beginTransactionWithSnapshot(host.preDragSnapshot);
							host.preDragSnapshot = null;
						} else {
							host.sketch.beginTransaction();
						}
						host.applySnapConstraintIfNeeded(draggedPtId, snap);
						host.sketch.commitTransaction();
					} else if (snap && snap.type === 'grid') {
						const pt = host.sketch.getPoint(draggedPtId);
						if (pt && !host.sketch.isPointFixed(draggedPtId)) {
							pt.copy(snap.worldPos);
						}
					}
				}
				host.sketch.solve();
				if (host.preDragSnapshot) {
					host.sketch.pushSnapshot(host.preDragSnapshot);
				}
			}
			host.preDragSnapshot = null;
			host.hasDragged = false;
			host.updateCursor?.();
		}
		if (host.curveDragState) {
			host.curveDragState = null;
			host.renderer?.clearPreviews?.();
			if (host.hasDragged) {
				host.sketch.solve();
				if (host.preDragSnapshot) {
					host.sketch.pushSnapshot(host.preDragSnapshot);
				}
			}
			host.preDragSnapshot = null;
			host.hasDragged = false;
			host.updateCursor?.();
		}
		if (host.isDraggingConstraint) {
			const hadDragged = host.hasDragged;
			host.isDraggingConstraint = false;
			host.draggedConstraintId = null;
			host.dragConstraintStartScreen = null;
			if (hadDragged) {
				if (host.preDragSnapshot) {
					host.sketch.pushSnapshot(host.preDragSnapshot);
				}
				host.preDragSnapshot = null;
				host.hasDragged = false;
				host.render();
			} else {
				host.preDragSnapshot = null;
				host.hasDragged = false;
			}
			host.updateCursor?.();
		}

		if (host.isBoxSelecting) {
			const startScreen = host.boxSelectStartScreen;
			const endScreen = e ? host.getScreenPos(e) : (host.boxSelectCurrentScreen ?? startScreen);
			const isShift = Boolean(host.boxSelectShift || e?.shiftKey);
			const imageId = host.boxSelectImageId;

			host.isBoxSelecting = false;
			host.boxSelectStartScreen = null;
			host.boxSelectCurrentScreen = null;
			host.boxSelectShift = false;
			host.boxSelectImageId = null;
			host.renderer?.clearPreviews?.();

			if (startScreen && endScreen && startScreen.distanceTo(endScreen) > 4) {
				if (host.activeTool === 'image') host.setTool('select');
				host.finishBoxSelection(startScreen, endScreen, isShift);
			} else if (imageId && imageId !== host.selectedImageId) {
				host.selectImage(imageId);
			}
			host.render();
		}

		if (!host.hasDragged && host.pendingExclusiveSelection) {
			host.sketch.selectEntity(host.pendingExclusiveSelection.id, host.pendingExclusiveSelection.type, false);
			host.render();
		}
		host.pendingExclusiveSelection = null;
		if (host.renderer) {
			host.renderer.deferRegionSolve = false;
		}
		if (primitiveMoved) host.render();
	}
}

import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import { DEFAULT_ZOOM } from '../constants';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import {
	LINE_DISTANCE_PX,
	LABEL_DISTANCE_PX,
	GIZMO_DISTANCE_PX,
	POINT_DISTANCE_PX,
	SNAP_GEOMETRY_DISTANCE_PX,
	SNAP_GRID_DISTANCE_PX,
	SNAP_POINT_DISTANCE_PX,
} from './distances';
import {
	angleFromTo,
	angleToXAxisDeg,
	addScaled,
	dot,
	ORIGIN,
	dist,
	mid,
	distancesFrom,
	mix,
	normalizeOrNull,
	scale,
	sub,
	vec,
	projectPointOntoSegment,
	type Vec2,
} from '../math/vector';
import { AABB, curveContainedInAABB } from '../math/aabb';
import type { IConstraint } from '../solver/types';
import {
	DistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
	computeRectangularPatternDirections,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
} from '../solver/constraints';
import type {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
	SketchText,
} from '../model/types';
import { showToast } from '../ui/toast';
import type { GeoCurve } from '../math/intersection';
import { bsplineToBezier, fitPointsToBezier, getSplineParamAtPoint, type BezierSegment } from '../math/spline';
import { calculateObjectsCentroid } from './tools/modify/utils';
import { HighlightManager } from './highlightManager';

import {
	type ToolType,
	type SnapResult,
	type ITool,
	type ToolContext,
	type ToolMouseEvent,
	type ToolRenderContext,
	isConstraintTool,
	isDrawingPrimitiveTool,
	PointTool,
	LineTool,
	CircleTool,
	RectangleTool,
	SlotTool,
	ArcTool,
	PolygonTool,
	EllipseTool,
	SplineTool,
	TextTool,
	TrimTool,
	ExtendTool,
	BreakTool,
	DeleteTool,
	FilletTool,
	ChamferTool,
	OffsetTool,
	MirrorTool,
	CircularPatternTool,
	RectangularPatternTool,
	DimensionTool,
	ConstraintTool,
	SelectTool,
	PanTool,
	CONSTRAINT_TOOLS,
} from './tools';
export * from './tools';

const TWO_PI = 2 * Math.PI;

export class CanvasInteraction {
	private svg: SVGSVGElement;
	private sketch: SketchDocument;
	private viewport: Viewport;
	private renderer: SVGRenderer;
	readonly highlightManager: HighlightManager;

	activeTool: ToolType = 'select';
	isConstructionMode = false;

	// Dragging point state
	private isDraggingPoint = false;
	private draggedPointId: string | null = null;
	private dragPointStartWorld: Vec2 | null = null;

	// Dragging line state
	private isDraggingLine = false;
	private draggedLineId: string | null = null;
	private dragLineStartWorld: Vec2 | null = null;
	private lineP1Start: Vec2 | null = null;
	private lineP2Start: Vec2 | null = null;

	// Dragging circle state
	private isDraggingCircle = false;
	private draggedCircleId: string | null = null;
	private dragCircleStartWorld: Vec2 | null = null;
	private circleCenterStart: Vec2 | null = null;

	// Dragging arc state
	private isDraggingArc = false;
	private draggedArcId: string | null = null;
	private dragArcStartWorld: Vec2 | null = null;
	private arcCenterStart: Vec2 | null = null;
	private arcStartPointStart: Vec2 | null = null;
	private arcEndPointStart: Vec2 | null = null;

	// Dragging ellipse state
	private isDraggingEllipse = false;
	private draggedEllipseId: string | null = null;
	private dragEllipseStartWorld: Vec2 | null = null;
	private ellipseCenterStart: Vec2 | null = null;
	private ellipseMajorPointStart: Vec2 | null = null;
	private ellipseMinorPointStart: Vec2 | null = null;

	// Dragging elliptical arc state
	private isDraggingEllipticalArc = false;
	private draggedEllipticalArcId: string | null = null;
	private dragEllipticalArcStartWorld: Vec2 | null = null;
	private ellipticalArcCenterStart: Vec2 | null = null;
	private ellipticalArcMajorPointStart: Vec2 | null = null;
	private ellipticalArcMinorPointStart: Vec2 | null = null;
	private ellipticalArcStartPointStart: Vec2 | null = null;
	private ellipticalArcEndPointStart: Vec2 | null = null;

	// Dragging spline state
	private isDraggingSpline = false;
	private draggedSplineId: string | null = null;
	private dragSplineStartWorld: Vec2 | null = null;
	private splinePointsStart: Map<string, Vec2> = new Map();

	// Dragging constraint state
	private isDraggingConstraint = false;
	private draggedConstraintId: string | null = null;
	private dragConstraintStartScreen: Vec2 | null = null;
	private radiusLabelGrabOffset: Vec2 | null = null;

	// Box selection state
	private isBoxSelecting = false;
	private boxSelectStartScreen: Vec2 | null = null;
	private boxSelectCurrentScreen: Vec2 | null = null;
	private boxSelectShift = false;
	private pendingExclusiveSelection: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'text' | 'constraint';
	} | null = null;

	// Dragging history snapshot
	private preDragSnapshot: SketchSnapshot | null = null;
	private hasDragged = false;

	// Viewport panning state
	private isPanning = false;
	private isSpacePressed = false;
	private readonly isMac =
		typeof navigator !== 'undefined' &&
		((navigator as any).userAgentData?.platform === 'macOS' ||
			/Mac|iPod|iPhone|iPad/.test(navigator.platform) ||
			/Macintosh/.test(navigator.userAgent));
	private isSnapModifierPressed = false;
	private lastMouseScreen: Vec2 = ORIGIN;
	private regionHoverPoint: Vec2 | null = null;

	private isSnapModifier(e: MouseEvent | KeyboardEvent): boolean {
		return this.isMac ? e.metaKey : e.ctrlKey;
	}

	// Double click tracking
	private lastClickTime = 0;
	private lastClickPos: Vec2 = ORIGIN;
	private lastDoubleClickedTime = 0;

	// Dimension edit callback
	onEditDimension?: (
		constraint:
			| DistanceConstraint
			| RadiusConstraint
			| AngleConstraint
			| PointToLineDistanceConstraint
			| OffsetConstraint
			| OriginDistanceConstraint
			| LineToAxisDistanceConstraint,
		screenPos: Vec2
	) => void;
	onToolChange?: (tool: ToolType) => void;
	onConstructionChange?: (isConstruction: boolean) => void;
	isSnappingEnabled = true;
	onSnappingChange?: (active: boolean) => void;
	onViewportChange?: () => void;
	sidebar?: any;
	private textRotationDragState: { textId: string; centerWorld: Vec2 } | null = null;
	private textDragState: { textId: string; startWorld: Vec2; initialPoints: Map<string, Vec2> } | null = null;

	gizmoDragState: {
		axis: 1 | 2;
		startMouseWorld: Vec2;
		centroidWorld: Vec2;
		u: Vec2;
		startDistance: number;
		constraintId?: string;
	} | null = null;

	readonly tools = new Map<ToolType, ITool>();
	activeToolInstance: ITool | null = null;
	private isSettingTool = false;

	isDrawingSpline(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool && tool.isBusy();
	}

	canUndoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool && tool.pointCount > 0;
	}

	canRedoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool && tool.hasUndonePoints;
	}

	undoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool ? tool.undoPoint() : false;
	}

	undoSketch(): boolean {
		if (!this.sketch.undo()) return false;
		if (this.activeTool === 'fillet' || this.activeTool === 'chamfer') {
			this.setTool('select');
		} else {
			this.render();
		}
		return true;
	}

	redoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool ? tool.redoPoint() : false;
	}

	private initTools(): void {
		// Primitives
		this.tools.set('point', new PointTool());
		this.tools.set('line', new LineTool());
		this.tools.set('circle', new CircleTool());
		this.tools.set('rectangle', new RectangleTool());
		this.tools.set('slot', new SlotTool('center_to_center'));
		this.tools.set('arc', new ArcTool('center'));
		this.tools.set('polygon', new PolygonTool());
		this.tools.set('ellipse', new EllipseTool('ellipse'));
		this.tools.set('spline', new SplineTool('fit'));
		this.tools.set('text', new TextTool());

		// Modify
		this.tools.set('trim', new TrimTool());
		this.tools.set('extend', new ExtendTool());
		this.tools.set('break', new BreakTool());
		this.tools.set('delete', new DeleteTool());
		this.tools.set('fillet', new FilletTool());
		this.tools.set('chamfer', new ChamferTool());
		this.tools.set('offset', new OffsetTool());
		this.tools.set('mirror', new MirrorTool());
		this.tools.set('circular_pattern', new CircularPatternTool());
		this.tools.set('rectangular_pattern', new RectangularPatternTool());

		// Constraints
		this.tools.set('dimension', new DimensionTool());
		for (const cTool of CONSTRAINT_TOOLS) {
			if (cTool !== 'dimension') {
				this.tools.set(cTool, new ConstraintTool(cTool));
			}
		}

		// Selection & Pan
		this.tools.set('select', new SelectTool());
		this.tools.set('pan', new PanTool());
	}

	createToolContext(): ToolContext {
		const self = this;
		return {
			sketch: this.sketch,
			viewport: this.viewport,
			renderer: this.renderer,
			svg: this.svg,
			get isConstructionMode() {
				return self.isConstructionMode;
			},
			requestRender: () => this.render(),
			setTool: (tool: ToolType) => this.setTool(tool),
			setCursor: (cursor: string) => {
				this.svg.style.cursor = cursor;
			},
			showToast: (msg: string) => showToast(msg),
			onEditDimension: (c, screenPos) => this.onEditDimension?.(c, screenPos),
			findSnap: (screen: Vec2, excludePointId?: string, allowGrid = true) =>
				this.findSnap(screen, excludePointId, allowGrid),
			findPointNear: this.findPointNear.bind(this),
			findLineNear: this.findLineNear.bind(this),
			findCircleNear: this.findCircleNear.bind(this),
			findArcNear: this.findArcNear.bind(this),
			findEllipseNear: this.findEllipseNear.bind(this),
			findEllipticalArcNear: this.findEllipticalArcNear.bind(this),
			findSplineNear: this.findSplineNear.bind(this),
			findConstraintNear: this.findConstraintNear.bind(this),
			toGeoCurve: (type, id) => this.sketch.toGeoCurve(id, type),
			findTrimTarget: this.findTrimTargetNear.bind(this),
			applySnapConstraintIfNeeded: (pointId: string, snap: SnapResult | null) =>
				this.applySnapConstraintIfNeeded(pointId, snap),
			applyAutoOrientationConstraint: (p1Id: string, p2Id: string) => this.applyAutoOrientationConstraint(p1Id, p2Id),
			getAxisSnappedWorldPos: (startPos, targetPos, snap) => this.getAxisSnappedWorldPos(startPos, targetPos, snap),
			get isSnapModifierPressed() {
				return self.isSnapModifierPressed;
			},
			get highlightManager() {
				return self.highlightManager;
			},
		};
	}

	createToolMouseEvent(e: MouseEvent): ToolMouseEvent {
		const screen = this.getScreenPos(e);
		const world = this.viewport.screenToWorld(screen);
		const snapMode = this.activeToolInstance?.shouldSnap ? this.activeToolInstance.shouldSnap() : true;
		const allowGrid = snapMode !== 'no-grid';
		const allowSnap = snapMode !== false;
		const snap = allowSnap ? this.findSnap(screen, undefined, allowGrid) : null;
		const effectiveWorld = snap ? snap.worldPos : world;
		const effectiveScreen = snap ? snap.screenPos : screen;
		return {
			raw: e,
			screen,
			client: vec(e.clientX, e.clientY),
			world,
			snap,
			effectiveWorld,
			effectiveScreen,
		};
	}

	createToolRenderContext(screen: Vec2, world: Vec2, snap: SnapResult | null): ToolRenderContext {
		return {
			viewport: this.viewport,
			sketch: this.sketch,
			targetGroup: this.renderer.previewGroup,
			cursorScreen: screen,
			cursorWorld: world,
			snap,
			isConstruction: this.isConstructionMode,
		};
	}

	updateToolPreview(): void {
		this.renderer.clearPreviews();
		if (this.activeTool !== 'select' && this.activeToolInstance) {
			const screen = this.lastMouseScreen;
			const world = this.viewport.screenToWorld(screen);
			const snapMode = this.activeToolInstance.shouldSnap ? this.activeToolInstance.shouldSnap() : true;
			const allowGrid = snapMode !== 'no-grid';
			const allowSnap = snapMode !== false;
			const snap =
				isDrawingPrimitiveTool(this.activeTool) && allowSnap ? this.findSnap(screen, undefined, allowGrid) : null;
			if (snap) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, false);
			}
			const renderCtx = this.createToolRenderContext(screen, world, snap);
			this.activeToolInstance.renderPreview?.(renderCtx);
		}
	}

	constructor(svg: SVGSVGElement, sketch: SketchDocument, viewport: Viewport, renderer: SVGRenderer) {
		this.svg = svg;
		this.sketch = sketch;
		this.viewport = viewport;
		this.renderer = renderer;
		this.highlightManager = new HighlightManager(this.svg, () => this.createToolContext());

		this.initTools();
		this.bindEvents();
		this.sketch.onChange(() => {
			this.updateConstructionState();
		});
		this.setTool(this.activeTool);
	}

	setTool(tool: ToolType): void {
		if (this.isSettingTool) return;
		if (tool === 'distance') {
			const { circleIds, arcIds, pointIds, lineIds } = this.sketch.selection;
			const radialIds = [...circleIds, ...arcIds];
			if (!pointIds.size && !lineIds.size && radialIds.length === 1 && !this.sketch.hasRadiusConstraint(radialIds[0])) {
				tool = 'dimension';
			}
		}
		this.isSettingTool = true;
		try {
			if (tool !== 'dimension' && this.canApplyConstraint(tool)) {
				this.applyConstraint(tool);
				// A preselected point group is a complete command. Keep its selection and current tool.
				if (tool === 'coincident' && this.sketch.selection.pointIds.size >= 2) return;
			}

			const prevTool = this.activeToolInstance;
			this.activeToolInstance = null;
			if (prevTool) {
				prevTool.deactivate();
			}
			this.activeTool = tool;
			this.highlightManager.clear();
			if (tool !== 'select') {
				this.regionHoverPoint = null;
				this.renderer.updateRegionHover(null);
			}
			this.cancelDrawing();

			const nextTool = this.tools.get(tool) ?? null;
			this.activeToolInstance = nextTool;
			if (nextTool) {
				nextTool.activate(this.createToolContext());
			}

			if (isConstraintTool(tool)) {
				this.pruneIncompatibleSelection(tool);
			}
			this.svg.classList.toggle('tool-constraint', isConstraintTool(tool));
			this.svg.classList.toggle('tool-trim', tool === 'trim' || tool === 'extend' || tool === 'break');
			this.svg.classList.toggle('tool-delete', tool === 'delete');
			this.svg.classList.toggle('tool-select', tool === 'select');
			this.updateCursor();
			this.onToolChange?.(tool);
			this.render();
		} finally {
			this.isSettingTool = false;
		}
	}

	toggleConstructionMode(): void {
		const selected = this.sketch.getSelectedPrimitives();
		if (selected.length > 0) {
			this.sketch.beginTransaction();
			for (const p of selected) {
				this.sketch.toggleConstruction(p.id);
			}
			this.sketch.commitTransaction();
			this.updateConstructionState();
		} else {
			this.isConstructionMode = !this.isConstructionMode;
			this.updateConstructionState();
		}
		this.render();
	}

	getEffectiveConstructionState(): boolean {
		const selectedState = this.sketch.getSelectedConstructionState();
		if (selectedState !== null) {
			return selectedState;
		}
		return this.isConstructionMode;
	}

	updateConstructionState(): void {
		this.onConstructionChange?.(this.getEffectiveConstructionState());
	}

	toggleSnapping(): void {
		this.isSnappingEnabled = !this.isSnappingEnabled;
		this.onSnappingChange?.(this.isSnappingEnabled);
		this.renderer.clearPreviews();
		this.render();
	}

	cancelDrawing(): void {
		this.activeToolInstance?.cancel?.();
		this.highlightManager.clear();

		this.isDraggingPoint = false;
		this.draggedPointId = null;
		this.dragPointStartWorld = null;

		this.isDraggingLine = false;
		this.draggedLineId = null;
		this.dragLineStartWorld = null;
		this.lineP1Start = null;
		this.lineP2Start = null;

		this.isDraggingCircle = false;
		this.draggedCircleId = null;
		this.dragCircleStartWorld = null;
		this.circleCenterStart = null;

		this.isDraggingArc = false;
		this.draggedArcId = null;
		this.dragArcStartWorld = null;
		this.arcCenterStart = null;
		this.arcStartPointStart = null;
		this.arcEndPointStart = null;

		this.isDraggingEllipse = false;
		this.draggedEllipseId = null;
		this.dragEllipseStartWorld = null;
		this.ellipseCenterStart = null;
		this.ellipseMajorPointStart = null;
		this.ellipseMinorPointStart = null;

		this.isDraggingEllipticalArc = false;
		this.draggedEllipticalArcId = null;
		this.dragEllipticalArcStartWorld = null;
		this.ellipticalArcCenterStart = null;
		this.ellipticalArcMajorPointStart = null;
		this.ellipticalArcMinorPointStart = null;
		this.ellipticalArcStartPointStart = null;
		this.ellipticalArcEndPointStart = null;

		this.isDraggingConstraint = false;
		this.draggedConstraintId = null;
		this.dragConstraintStartScreen = null;
		this.radiusLabelGrabOffset = null;

		this.preDragSnapshot = null;
		this.hasDragged = false;
		this.svg.classList.remove('is-dragging');

		this.isBoxSelecting = false;
		this.boxSelectStartScreen = null;
		this.boxSelectCurrentScreen = null;
		this.boxSelectShift = false;
		this.pendingExclusiveSelection = null;

		this.isDraggingSpline = false;
		this.draggedSplineId = null;
		this.dragSplineStartWorld = null;
		this.splinePointsStart.clear();

		this.renderer.clearPreviews();
	}

	render(): void {
		const toolRenderOptions = this.activeToolInstance?.getRenderOptions?.() ?? {};
		this.renderer.render(this.sketch, this.viewport, {
			showSplineHandles: isConstraintTool(this.activeTool),
			regionHoverPoint: this.regionHoverPoint,
			...toolRenderOptions,
		});
		this.highlightManager.refresh(this.activeToolInstance);

		// Update popup positions on screen during zoom / pan
		const polygonTool = this.tools.get('polygon') as PolygonTool | undefined;
		if (polygonTool?.popup.isOpen() && polygonTool.centerWorldPos) {
			const sCtr = this.viewport.worldToScreen(polygonTool.centerWorldPos);
			polygonTool.popup.updatePosition(sCtr);
		}

		const filletTool = this.tools.get('fillet') as FilletTool | undefined;
		if (filletTool?.popup.isOpen() && filletTool.pendingFillets.length > 0) {
			const bbox = filletTool.getGizmoBoundingBox();
			if (bbox) {
				filletTool.popup.updatePosition(bbox);
			}
		}

		const chamferTool = this.tools.get('chamfer') as ChamferTool | undefined;
		if (chamferTool?.popup.isOpen() && chamferTool.candidate) {
			const bbox = chamferTool.getGizmoBoundingBox();
			if (bbox) {
				chamferTool.popup.updatePosition(bbox);
			}
		}

		const offsetTool = this.tools.get('offset') as OffsetTool | undefined;
		if (offsetTool?.popup.isOpen() && offsetTool.geomResult) {
			const bbox = offsetTool.getGizmoBoundingBox();
			if (bbox) {
				offsetTool.popup.updatePosition(bbox);
			}
		}

		const circularPatternTool = this.tools.get('circular_pattern') as CircularPatternTool | undefined;
		if (circularPatternTool?.popup.isOpen()) {
			circularPatternTool.updatePopupPosition();
		}

		const rectangularPatternTool = this.tools.get('rectangular_pattern') as RectangularPatternTool | undefined;
		if (rectangularPatternTool?.popup.isOpen()) {
			rectangularPatternTool.updatePopupPosition();
		}

		this.updateToolPreview();
	}

	private animationFrameId: number | null = null;

	cancelAnimation(): void {
		if (this.animationFrameId !== null) {
			if (typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(this.animationFrameId);
			}
			this.animationFrameId = null;
		}
	}

	animateViewportTo(targetPanX: number, targetPanY: number, targetZoom: number, duration = 700): void {
		this.cancelAnimation();

		const startPan = vec(this.viewport.panX, this.viewport.panY);
		const startZoom = this.viewport.zoom;

		const dPan = vec(Math.abs(startPan.x - targetPanX), Math.abs(startPan.y - targetPanY));
		const dZoom = Math.abs(startZoom - targetZoom);

		if (dPan.x < 0.5 && dPan.y < 0.5 && dZoom < 0.001) {
			this.viewport.panX = targetPanX;
			this.viewport.panY = targetPanY;
			this.viewport.zoom = targetZoom;
			this.render();
			this.onViewportChange?.();
			return;
		}

		if (typeof requestAnimationFrame === 'undefined' || typeof performance === 'undefined') {
			this.viewport.panX = targetPanX;
			this.viewport.panY = targetPanY;
			this.viewport.zoom = targetZoom;
			this.render();
			this.onViewportChange?.();
			return;
		}

		const startTime = performance.now();
		const easeInOut = (t: number, power: number) => {
			return t < 0.5 ? Math.pow(2 * t, power) / 2 : 1 - Math.pow(-2 * t + 2, power) / 2;
		};

		const step = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(1, Math.max(0, elapsed / duration));
			const eased = easeInOut(progress, 3); // cubic ease-in-out

			this.viewport.panX = startPan.x + (targetPanX - startPan.x) * eased;
			this.viewport.panY = startPan.y + (targetPanY - startPan.y) * eased;
			this.viewport.zoom = startZoom + (targetZoom - startZoom) * eased;

			this.render();
			this.onViewportChange?.();

			if (progress < 1) {
				this.animationFrameId = requestAnimationFrame(step);
			} else {
				this.viewport.panX = targetPanX;
				this.viewport.panY = targetPanY;
				this.viewport.zoom = targetZoom;
				this.render();
				this.onViewportChange?.();
				this.animationFrameId = null;
			}
		};

		this.animationFrameId = requestAnimationFrame(step);
	}

	fitToView(smooth = true): void {
		const bbox = this.sketch.getSelectionBoundingBox() ?? this.sketch.getBoundingBox();
		let target: { panX: number; panY: number; zoom: number };
		if (bbox) {
			target = this.viewport.getTargetFit(bbox);
		} else {
			target = {
				panX: this.viewport.width / 2,
				panY: this.viewport.height / 2,
				zoom: DEFAULT_ZOOM,
			};
		}

		if (!smooth || typeof requestAnimationFrame === 'undefined') {
			this.cancelAnimation();
			this.viewport.panX = target.panX;
			this.viewport.panY = target.panY;
			this.viewport.zoom = target.zoom;
			this.render();
			this.onViewportChange?.();
			return;
		}

		this.animateViewportTo(target.panX, target.panY, target.zoom);
	}

	private bindEvents(): void {
		this.svg.addEventListener('mousedown', this.handleMouseDown.bind(this));
		window.addEventListener('mousemove', this.handleMouseMove.bind(this));
		window.addEventListener('mouseup', this.handleMouseUp.bind(this));
		this.svg.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
		this.svg.addEventListener('dblclick', this.handleDoubleClick.bind(this));
		this.svg.addEventListener('mouseleave', () => {
			this.highlightManager.clear();
		});

		// Prevent default context menu for smooth right-click panning
		this.svg.addEventListener('contextmenu', e => {
			e.preventDefault();
		});

		window.addEventListener('keydown', this.handleKeyDown.bind(this));

		window.addEventListener('keyup', e => {
			if (e.code === 'Space') {
				this.isSpacePressed = false;
			}
			if (this.isMac ? e.key === 'Meta' || !e.metaKey : e.key === 'Control' || !e.ctrlKey) {
				this.isSnapModifierPressed = this.isMac ? e.metaKey : e.ctrlKey;
			}
		});

		window.addEventListener('blur', () => {
			this.isSnapModifierPressed = false;
			this.isSpacePressed = false;
			this.highlightManager.clear();
		});
	}

	public handleKeyDown(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		const isInputTarget = Boolean(
			(target &&
				((typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) ||
					(typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
					target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable)) ||
				(activeEl &&
					((typeof HTMLInputElement !== 'undefined' && activeEl instanceof HTMLInputElement) ||
						(typeof HTMLTextAreaElement !== 'undefined' && activeEl instanceof HTMLTextAreaElement) ||
						activeEl.tagName === 'INPUT' ||
						activeEl.tagName === 'TEXTAREA' ||
						activeEl.tagName === 'SELECT' ||
						activeEl.isContentEditable))
		);

		if (isInputTarget) {
			return;
		}

		if (
			this.isMac
				? e.code === 'MetaLeft' || e.code === 'MetaRight' || e.metaKey
				: e.code === 'ControlLeft' || e.code === 'ControlRight' || e.ctrlKey
		) {
			this.isSnapModifierPressed = true;
			this.renderer.clearPreviews();
			this.render();
		}
		if (e.code === 'Space') {
			this.isSpacePressed = true;
		}
		if (e.code === 'Tab') {
			if (this.activeToolInstance?.onKeyDown) {
				const handled = this.activeToolInstance.onKeyDown(e);
				if (handled) return;
			}
		}

		const tool = this.activeToolInstance ?? this.tools?.get(this.activeTool);
		if (tool?.sidebarPanel?.handleKeyDown?.(e)) {
			return;
		}

		switch (e.code) {
			case 'Escape':
				if (this.activeToolInstance?.isBusy?.()) {
					this.activeToolInstance.cancel?.();
					this.render();
					return;
				}
				if (this.activeTool !== 'select') {
					this.setTool('select');
					this.render();
					return;
				}
				this.cancelDrawing();
				this.sketch.clearSelection();
				this.render();
				return;
			case 'Enter':
			case 'NumpadEnter':
				if (
					(this.activeTool === 'fillet' ||
						this.activeTool === 'chamfer' ||
						this.activeTool === 'spline' ||
						this.activeTool === 'text') &&
					tool?.onKeyDown?.(e)
				) {
					return;
				}
				if (this.activeToolInstance?.isBusy?.()) {
					this.activeToolInstance.commit?.();
				}
				return;
			case 'Delete':
			case 'Backspace':
				this.sketch.deleteSelected();
				this.render();
				return;
			case 'KeyX':
				this.toggleConstructionMode();
				return;
			case 'KeyV':
				this.setTool('select');
				return;
			case 'KeyL':
				this.setTool('line');
				return;
			case 'KeyR':
				this.setTool('rectangle');
				return;
			case 'KeyG':
				this.setTool('polygon');
				return;
			case 'KeyP':
				this.setTool('point');
				return;
			case 'KeyC':
				this.setTool('circle');
				return;
			case 'KeyA':
				this.setTool('arc');
				return;
			case 'KeyE':
				this.setTool('ellipse');
				return;
			case 'KeyS':
				this.setTool('slot');
				return;
			case 'KeyT':
				this.setTool('trim');
				return;
			case 'KeyB':
				this.setTool('break');
				return;
			case 'KeyM':
				this.setTool('mirror');
				return;
			case 'KeyO':
				this.setTool('offset');
				return;
			case 'KeyH':
				this.setTool('horizontal_vertical');
				return;
			case 'KeyD':
				this.setTool('dimension');
				return;
			case 'KeyI':
				this.setTool('coincident');
				return;
			case 'KeyF':
				this.setTool('fixed');
				return;
		}
	}

	private getScreenPos(e: MouseEvent): Vec2 {
		const rect = this.svg.getBoundingClientRect();
		return vec(e.clientX - rect.left, e.clientY - rect.top);
	}

	findSnap(screenPos: Vec2, excludePointId?: string, allowGrid = true): SnapResult | null {
		// Suppress all snapping if snap modifier is held (metaKey on Mac, ctrlKey on Windows)
		if (this.isSnapModifierPressed) {
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
			for (const spline of this.sketch.splines.values()) {
				const handles = (spline.tangentLineIds ?? []).map(id => this.sketch.lines.get(id));
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

		const selectedSplineIds = new Set<string>(this.sketch.selection.splineIds);
		for (const spline of this.sketch.splines.values()) {
			if (spline.pointIds.some(pid => this.sketch.selection.pointIds.has(pid))) {
				selectedSplineIds.add(spline.id);
			}
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const line = this.sketch.lines.get(lid);
					if (
						line &&
						(this.sketch.selection.lineIds.has(lid) ||
							this.sketch.selection.pointIds.has(line.p1Id) ||
							this.sketch.selection.pointIds.has(line.p2Id))
					) {
						selectedSplineIds.add(spline.id);
					}
				}
			}
		}

		for (const pt of this.sketch.points.values()) {
			if (pt.id === excludePointId || excludedHandlePointIds.has(pt.id)) continue;
			// If point belongs to a spline handle or control polygon, only snap if spline is selected or constraint tool active
			let isHiddenSplinePoint = false;
			for (const spline of this.sketch.splines.values()) {
				if (!selectedSplineIds.has(spline.id) && !isConstraintTool(this.activeTool)) {
					if (spline.splineType === 'control') {
						const isEndpoint = pt.id === spline.pointIds[0] || pt.id === spline.pointIds[spline.pointIds.length - 1];
						if (!isEndpoint && spline.pointIds.includes(pt.id)) {
							isHiddenSplinePoint = true;
							break;
						}
					}
					if (spline.tangentLineIds && spline.splineType !== 'control') {
						for (const lid of spline.tangentLineIds) {
							const l = this.sketch.lines.get(lid);
							if (l && (l.p1Id === pt.id || l.p2Id === pt.id)) {
								isHiddenSplinePoint = true;
								break;
							}
						}
					}
				}
				if (isHiddenSplinePoint) break;
			}
			if (isHiddenSplinePoint) continue;

			const s = this.viewport.worldToScreen(pt);
			const d = dist(screenPos, s);
			if (d < closestPointDist) {
				closestPointDist = d;
				foundPoint = { id: pt.id, worldPos: vec(pt.x, pt.y), screenPos: s };
			}
		}

		if (excludePointId !== 'origin') {
			const sOrigin = this.viewport.worldToScreen(ORIGIN);
			const dOrigin = dist(screenPos, sOrigin);
			if (dOrigin < closestPointDist) {
				closestPointDist = dOrigin;
				foundPoint = { id: 'origin', worldPos: vec(0, 0), screenPos: sOrigin };
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

		// Priority 2: Line, Circle/Arc & Spline snapping
		const geomSnapDistPx = SNAP_GEOMETRY_DISTANCE_PX;
		let closestGeomDist = geomSnapDistPx;
		let foundGeom: {
			type: 'line' | 'circle' | 'ellipse' | 'spline';
			id: string;
			worldPos: Vec2;
			screenPos: Vec2;
		} | null = null;

		for (const line of this.sketch.lines.values()) {
			if (excludedHandleLineIds.has(line.id)) continue;
			if (excludePointId && (line.p1Id === excludePointId || line.p2Id === excludePointId)) {
				continue;
			}
			if (line.isSplineHandle) {
				const parentSpline = line.parentSplineId ? this.sketch.splines.get(line.parentSplineId) : undefined;
				const isParentSelected = parentSpline && selectedSplineIds.has(parentSpline.id);
				if (!isParentSelected && !this.sketch.selection.lineIds.has(line.id) && !isConstraintTool(this.activeTool)) {
					continue;
				}
			}
			const p1 = this.sketch.points.get(line.p1Id);
			const p2 = this.sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;

			const s1 = this.viewport.worldToScreen(p1);
			const s2 = this.viewport.worldToScreen(p2);
			const proj = projectPointOntoSegment(screenPos, s1, s2);
			if (proj.dist < closestGeomDist) {
				closestGeomDist = proj.dist;
				const worldPos = mix(p1, p2, proj.t);
				foundGeom = {
					type: 'line',
					id: line.id,
					worldPos,
					screenPos: proj.point,
				};
			}
		}

		for (const circle of this.sketch.circles.values()) {
			if (excludePointId && circle.centerId === excludePointId) {
				continue;
			}
			const center = this.sketch.points.get(circle.centerId);
			if (!center) continue;

			const sc = this.viewport.worldToScreen(center);
			const sr = circle.radius * this.viewport.zoom;
			const dToCenter = dist(screenPos, sc);
			const dToPerimeter = Math.abs(dToCenter - sr);

			if (dToPerimeter < closestGeomDist) {
				closestGeomDist = dToPerimeter;
				const dir = sub(screenPos, sc);
				const d = Math.max(Math.hypot(dir.x, dir.y), 1e-6);
				const snappedScreen = addScaled(sc, dir, sr / d);
				const worldPos = this.viewport.screenToWorld(snappedScreen);
				foundGeom = {
					type: 'circle',
					id: circle.id,
					worldPos,
					screenPos: snappedScreen,
				};
			}
		}

		for (const arc of this.sketch.arcs.values()) {
			if (
				excludePointId &&
				(arc.centerId === excludePointId || arc.startPointId === excludePointId || arc.endPointId === excludePointId)
			) {
				continue;
			}
			const center = this.sketch.points.get(arc.centerId);
			const start = this.sketch.points.get(arc.startPointId);
			const end = this.sketch.points.get(arc.endPointId);
			if (!center || !start || !end) continue;

			const sc = this.viewport.worldToScreen(center);
			const ss = this.viewport.worldToScreen(start);
			const se = this.viewport.worldToScreen(end);
			const sr = arc.radius * this.viewport.zoom;

			const dToCenter = dist(screenPos, sc);
			const dToPerimeter = Math.abs(dToCenter - sr);
			if (dToPerimeter >= closestGeomDist) continue;

			const as = angleFromTo(sc, ss);
			const ae = angleFromTo(sc, se);
			const ap = angleFromTo(sc, screenPos);
			const clockwise = !!arc.clockwise;

			let sweepAngle = 0;
			let pAngle = 0;
			if (clockwise) {
				sweepAngle = (ae - as) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
				pAngle = (ap - as) % TWO_PI;
				if (pAngle < 0) pAngle += TWO_PI;
			} else {
				sweepAngle = (as - ae) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
				pAngle = (as - ap) % TWO_PI;
				if (pAngle < 0) pAngle += TWO_PI;
			}

			const angTolerance = geomSnapDistPx / Math.max(sr, 1);
			if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
				closestGeomDist = dToPerimeter;
				const clampedPAngle = Math.max(0, Math.min(sweepAngle, pAngle));
				const actualAng = clockwise ? as + clampedPAngle : as - clampedPAngle;
				const snappedScreen = vec(sc.x + Math.cos(actualAng) * sr, sc.y + Math.sin(actualAng) * sr);
				const worldPos = this.viewport.screenToWorld(snappedScreen);
				foundGeom = {
					type: 'circle',
					id: arc.id,
					worldPos,
					screenPos: snappedScreen,
				};
			}
		}

		// Snap to Ellipses
		for (const ellipse of this.sketch.ellipses.values()) {
			if (
				excludePointId &&
				(ellipse.centerId === excludePointId ||
					ellipse.majorAxisPointId === excludePointId ||
					ellipse.minorAxisPointId === excludePointId)
			) {
				continue;
			}
			const center = this.sketch.points.get(ellipse.centerId);
			const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
			const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
			if (!center || !majorPt || !minorPt) continue;

			const sc = this.viewport.worldToScreen(center);
			const smaj = this.viewport.worldToScreen(majorPt);
			const smin = this.viewport.worldToScreen(minorPt);

			const axisU = sub(smaj, sc);
			const axisV = sub(smin, sc);

			const r = distancesFrom(sc, smaj, smin);
			if (r.x < 1 || r.y < 1) continue;

			const uHat = scale(axisU, 1 / r.x);
			const vHat = scale(axisV, 1 / r.y);

			const t = ellipseParameterAtPoint(screenPos, sc, r, uHat, vHat);
			const snappedScreen = ellipsePointAtParameter(t, sc, r, uHat, vHat);
			const dToPerimeter = dist(screenPos, snappedScreen);

			if (dToPerimeter < closestGeomDist) {
				closestGeomDist = dToPerimeter;
				const worldPos = this.viewport.screenToWorld(snappedScreen);
				foundGeom = {
					type: 'ellipse',
					id: ellipse.id,
					worldPos,
					screenPos: snappedScreen,
				};
			}
		}

		// Snap to Elliptical Arcs
		for (const arc of this.sketch.ellipticalArcs.values()) {
			if (
				excludePointId &&
				(arc.centerId === excludePointId ||
					arc.majorAxisPointId === excludePointId ||
					arc.minorAxisPointId === excludePointId ||
					arc.startPointId === excludePointId ||
					arc.endPointId === excludePointId)
			) {
				continue;
			}
			const center = this.sketch.points.get(arc.centerId);
			const majorPt = this.sketch.points.get(arc.majorAxisPointId);
			const minorPt = this.sketch.points.get(arc.minorAxisPointId);
			const startPt = this.sketch.points.get(arc.startPointId);
			const endPt = this.sketch.points.get(arc.endPointId);
			if (!center || !majorPt || !minorPt || !startPt || !endPt) continue;

			const sc = this.viewport.worldToScreen(center);
			const smaj = this.viewport.worldToScreen(majorPt);
			const smin = this.viewport.worldToScreen(minorPt);

			const r = distancesFrom(sc, smaj, smin);
			if (r.x < 1 || r.y < 1) continue;

			const { axisU, axisV } = ellipseAxes(angleFromTo(sc, smaj));

			const t = ellipseParameterAtPoint(screenPos, sc, r, axisU, axisV);

			const ss = this.viewport.worldToScreen(startPt);
			const se = this.viewport.worldToScreen(endPt);

			const ts = ellipseParameterAtPoint(ss, sc, r, axisU, axisV);
			const te = ellipseParameterAtPoint(se, sc, r, axisU, axisV);
			const clockwise = !!arc.clockwise;

			let sweepAngle = clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
			let pAngle = clockwise ? (t - ts) % TWO_PI : (ts - t) % TWO_PI;
			if (pAngle < 0) pAngle += TWO_PI;

			const angTolerance = geomSnapDistPx / Math.max(Math.min(r.x, r.y), 1);
			if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
				const clampedPAngle = pAngle >= TWO_PI - angTolerance ? 0 : Math.min(sweepAngle, Math.max(0, pAngle));
				const actualT = clockwise ? ts + clampedPAngle : ts - clampedPAngle;
				const snappedScreen = ellipsePointAtParameter(actualT, sc, r, axisU, axisV);
				const dToPerimeter = dist(screenPos, snappedScreen);

				if (dToPerimeter < closestGeomDist) {
					closestGeomDist = dToPerimeter;
					const worldPos = this.viewport.screenToWorld(snappedScreen);
					foundGeom = {
						type: 'ellipse',
						id: arc.id,
						worldPos,
						screenPos: snappedScreen,
					};
				}
			}
		}

		for (const spline of this.sketch.splines.values()) {
			if (excludedSplineIds.has(spline.id)) continue;

			const screenSegments = this.getSplineScreenSegments(spline);
			if (!screenSegments) continue;

			const proj = getSplineParamAtPoint(screenSegments, screenPos);
			if (proj.distance < closestGeomDist) {
				closestGeomDist = proj.distance;
				const worldPos = this.viewport.screenToWorld(proj.point);
				foundGeom = {
					type: 'spline',
					id: spline.id,
					worldPos,
					screenPos: proj.point,
				};
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
		if (!this.isSnappingEnabled || !allowGrid) {
			return null;
		}

		const sOrigin = this.viewport.worldToScreen(ORIGIN);
		const dAxisX = Math.abs(screenPos.y - sOrigin.y);
		const dAxisY = Math.abs(screenPos.x - sOrigin.x);

		const world = this.viewport.screenToWorld(screenPos);
		const { step, subStep } = this.viewport.getGridStep();
		const subStepPx = subStep * this.viewport.zoom;
		const gridStep = subStepPx >= 6 ? subStep : step;
		const nearestWorld = vec(
			this.cleanGridCoordinate(Math.round(world.x / gridStep) * gridStep, gridStep),
			this.cleanGridCoordinate(Math.round(world.y / gridStep) * gridStep, gridStep)
		);
		const nearestScreen = this.viewport.worldToScreen(nearestWorld);

		if (dAxisX < geomSnapDistPx && dAxisX <= dAxisY) {
			const snapX = Math.abs(screenPos.x - nearestScreen.x) <= SNAP_GRID_DISTANCE_PX ? nearestWorld.x : world.x;
			const snapScreenX =
				Math.abs(screenPos.x - nearestScreen.x) <= SNAP_GRID_DISTANCE_PX ? nearestScreen.x : screenPos.x;
			return {
				type: 'line',
				id: 'axis_x',
				worldPos: vec(snapX, 0),
				screenPos: vec(snapScreenX, sOrigin.y),
			};
		}

		if (dAxisY < geomSnapDistPx) {
			const snapY = Math.abs(screenPos.y - nearestScreen.y) <= SNAP_GRID_DISTANCE_PX ? nearestWorld.y : world.y;
			const snapScreenY =
				Math.abs(screenPos.y - nearestScreen.y) <= SNAP_GRID_DISTANCE_PX ? nearestScreen.y : screenPos.y;
			return {
				type: 'line',
				id: 'axis_y',
				worldPos: vec(0, snapY),
				screenPos: vec(sOrigin.x, snapScreenY),
			};
		}

		if (dist(screenPos, nearestScreen) <= SNAP_GRID_DISTANCE_PX) {
			return {
				type: 'grid',
				worldPos: nearestWorld,
				screenPos: nearestScreen,
			};
		}

		return null;
	}

	private cleanGridCoordinate(val: number, step: number): number {
		const stepStr = step.toString();
		const decimalIdx = stepStr.indexOf('.');
		const decimals = decimalIdx >= 0 ? Math.min(stepStr.length - decimalIdx - 1 + 4, 10) : 4;
		return parseFloat(val.toFixed(decimals));
	}

	private applySnapConstraintIfNeeded(pointId: string, snap: SnapResult | null): void {
		if (!snap || !snap.id) return;
		if (snap.type === 'point' && snap.id !== pointId) {
			if (snap.id === 'origin') {
				const c = this.sketch.addOriginCoincidentConstraint(pointId);
				if (c) {
					showToast('Coincident with origin applied');
				}
			} else {
				const c = this.sketch.addCoincidentConstraint(pointId, snap.id);
				if (c) {
					showToast('Coincident constraint applied');
				}
			}
		} else if (snap.type === 'line') {
			if (snap.id === 'axis_x' || snap.id === 'axis_y') {
				const axis = snap.id === 'axis_x' ? 'x' : 'y';
				const c = this.sketch.addPointOnAxisConstraint(pointId, axis);
				if (c) {
					showToast(`Point constrained to ${axis.toUpperCase()}-axis`);
				}
			} else {
				const c = this.sketch.addPointOnLineConstraint(pointId, snap.id);
				if (c) {
					showToast('Point constrained to line');
				}
			}
		} else if (snap.type === 'circle') {
			const c = this.sketch.addPointOnCircleConstraint(pointId, snap.id);
			if (c) {
				showToast('Point constrained to circle');
			}
		} else if (snap.type === 'ellipse') {
			const isArc = this.sketch.ellipticalArcs.has(snap.id);
			const c = this.sketch.addPointOnEllipseConstraint(pointId, snap.id);
			if (c) {
				showToast(isArc ? 'Point constrained to elliptical arc' : 'Point constrained to ellipse');
			}
		} else if (snap.type === 'spline') {
			const c = this.sketch.addPointOnSplineConstraint(pointId, snap.id);
			if (c) {
				showToast('Point constrained to spline');
			}
		}
	}

	private applyAutoOrientationConstraint(p1Id: string, p2Id: string): void {
		const p1 = this.sketch.getPoint(p1Id);
		const p2 = this.sketch.getPoint(p2Id);
		if (!p1 || !p2) return;

		const dir = sub(p2, p1);
		if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) return;

		const angleDeg = angleToXAxisDeg(dir);

		// Horizontal check
		if (angleDeg < 1.0) {
			const alreadyHoriz = [...this.sketch.constraints.values()].some(
				c =>
					c instanceof HorizontalConstraint &&
					((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
			);
			if (!alreadyHoriz) {
				this.sketch.addHorizontalConstraint(p1Id, p2Id);
				showToast('Horizontal constraint applied');
			}
			return;
		}

		// Vertical check
		if (90 - angleDeg < 1.0) {
			const alreadyVert = [...this.sketch.constraints.values()].some(
				c =>
					c instanceof VerticalConstraint &&
					((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
			);
			if (!alreadyVert) {
				this.sketch.addVerticalConstraint(p1Id, p2Id);
				showToast('Vertical constraint applied');
			}
			return;
		}
	}

	private getAxisSnappedWorldPos(
		startPos: Vec2,
		targetPos: Vec2,
		snap: SnapResult | null
	): { pos: Vec2; axis: 'horizontal' | 'vertical' | null } {
		if (this.isSnapModifierPressed) {
			return { pos: targetPos, axis: null };
		}
		if (snap) {
			return { pos: targetPos, axis: null };
		}

		const dir = sub(targetPos, startPos);
		if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
			return { pos: targetPos, axis: null };
		}

		const angleDeg = angleToXAxisDeg(dir);

		if (angleDeg < 1.0) {
			return {
				pos: vec(targetPos.x, startPos.y),
				axis: 'horizontal',
			};
		}

		if (90 - angleDeg < 1.0) {
			return {
				pos: vec(startPos.x, targetPos.y),
				axis: 'vertical',
			};
		}

		return { pos: targetPos, axis: null };
	}

	private getSplineScreenSegments(spline: SketchSpline): BezierSegment[] | null {
		const pts = spline.pointIds.map(id => this.sketch.points.get(id)).filter((p): p is SketchPoint => !!p);
		if (pts.length < 2) return null;

		let bezierSegments: BezierSegment[] = [];
		if (spline.splineType === 'control') {
			bezierSegments = bsplineToBezier(pts, spline.knots);
		} else {
			const handles = (spline.tangentLineIds || []).map(lid => {
				const line = this.sketch.lines.get(lid);
				if (!line) return null;
				const p1 = this.sketch.points.get(line.p1Id);
				const p2 = this.sketch.points.get(line.p2Id);
				if (!p1 || !p2) return null;
				return {
					h1: p1,
					h2: p2,
				};
			});
			bezierSegments = fitPointsToBezier(pts, handles);
		}

		return bezierSegments.map(seg => [
			this.viewport.worldToScreen(seg[0]),
			this.viewport.worldToScreen(seg[1]),
			this.viewport.worldToScreen(seg[2]),
			this.viewport.worldToScreen(seg[3]),
		]);
	}

	findPointNear(screen: Vec2, thresholdPx = POINT_DISTANCE_PX, excludePointId?: string): SketchPoint | null {
		let closestDist = thresholdPx;
		let foundPoint: SketchPoint | null = null;

		for (const pt of this.sketch.points.values()) {
			if (excludePointId && pt.id === excludePointId) continue;
			const d = pt.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundPoint = pt;
			}
		}

		if (excludePointId !== 'origin') {
			const sOrigin = this.viewport.worldToScreen(ORIGIN);
			const dOrigin = Math.hypot(screen.x - sOrigin.x, screen.y - sOrigin.y);
			if (dOrigin < closestDist) {
				closestDist = dOrigin;
				foundPoint = { id: 'origin', x: 0, y: 0 } as SketchPoint;
			}
		}

		return foundPoint;
	}

	findLineNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchLine | null {
		let closestDist = thresholdPx;
		let foundLine: SketchLine | null = null;

		for (const line of this.sketch.lines.values()) {
			if (line.isSplineHandle) {
				const parentSpline = line.parentSplineId ? this.sketch.splines.get(line.parentSplineId) : undefined;
				const isParentSelected =
					parentSpline &&
					(this.sketch.selection.splineIds.has(parentSpline.id) ||
						parentSpline.pointIds.some(pid => this.sketch.selection.pointIds.has(pid)));
				const isHandleActive =
					this.sketch.selection.lineIds.has(line.id) ||
					this.sketch.selection.pointIds.has(line.p1Id) ||
					this.sketch.selection.pointIds.has(line.p2Id);
				if (!isParentSelected && !isHandleActive && !isConstraintTool(this.activeTool)) {
					continue;
				}
			}

			const d = line.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundLine = line;
			}
		}

		return foundLine;
	}

	findCircleNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchCircle | null {
		let closestDist = thresholdPx;
		let foundCircle: SketchCircle | null = null;

		for (const circle of this.sketch.circles.values()) {
			const d = circle.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundCircle = circle;
			}
		}

		return foundCircle;
	}

	findArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchArc | null {
		let closestDist = thresholdPx;
		let foundArc: SketchArc | null = null;

		for (const arc of this.sketch.arcs.values()) {
			const d = arc.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundArc = arc;
			}
		}

		return foundArc;
	}

	findConstraintNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): IConstraint | null {
		let closestDist = thresholdPx;
		let foundConstraint: IConstraint | null = null;

		for (const constraint of this.sketch.constraints.values()) {
			if (!constraint.distanceTo) continue;
			const d = constraint.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundConstraint = constraint;
			}
		}

		return foundConstraint;
	}

	findEllipseNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipse | null {
		let closestDist = thresholdPx;
		let foundEllipse: SketchEllipse | null = null;

		for (const ellipse of this.sketch.ellipses.values()) {
			const d = ellipse.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundEllipse = ellipse;
			}
		}

		return foundEllipse;
	}

	findEllipticalArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipticalArc | null {
		let closestDist = thresholdPx;
		let foundArc: SketchEllipticalArc | null = null;

		for (const arc of this.sketch.ellipticalArcs.values()) {
			const d = arc.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundArc = arc;
			}
		}

		return foundArc;
	}

	findSplineNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchSpline | null {
		let closestDist = thresholdPx;
		let foundSpline: SketchSpline | null = null;

		for (const spline of this.sketch.splines.values()) {
			const d = spline.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				foundSpline = spline;
			}
		}

		return foundSpline;
	}

	findTrimTargetNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): GeoCurve | null {
		let bestDist = thresholdPx;
		let bestCurve: GeoCurve | null = null;

		// 1. Lines
		for (const line of this.sketch.lines.values()) {
			if (line.isSplineHandle) continue;
			const d = line.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = line.toGeoCurve(this.sketch);
			}
		}

		// 2. Arcs
		for (const arc of this.sketch.arcs.values()) {
			const d = arc.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = arc.toGeoCurve(this.sketch);
			}
		}

		// 3. Elliptical Arcs
		for (const arc of this.sketch.ellipticalArcs.values()) {
			const d = arc.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = arc.toGeoCurve(this.sketch);
			}
		}

		// 4. Circles
		for (const circle of this.sketch.circles.values()) {
			const d = circle.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = circle.toGeoCurve(this.sketch);
			}
		}

		// 5. Ellipses
		for (const ellipse of this.sketch.ellipses.values()) {
			const d = ellipse.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = ellipse.toGeoCurve(this.sketch);
			}
		}

		// 6. Splines
		for (const spline of this.sketch.splines.values()) {
			const d = spline.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = spline.toGeoCurve(this.sketch);
			}
		}

		return bestCurve;
	}

	private handleMouseDown(e: MouseEvent): void {
		this.cancelAnimation();
		this.highlightManager.clear();
		this.isSnapModifierPressed = this.isSnapModifier(e);
		const screen = this.getScreenPos(e);
		const clientPos = vec(e.clientX, e.clientY);
		this.lastMouseScreen = screen;

		// Pan with Middle Click (1), Right Click (2), Pan Tool, or Space/Alt Key
		if (e.button === 1 || e.button === 2 || this.activeTool === 'pan' || this.isSpacePressed || e.altKey) {
			this.isPanning = true;
			this.svg.style.cursor = 'grabbing';
			return;
		}

		if (e.button !== 0) return; // Only primary button for drawing/selection

		// Robust double-click detection (works even when DOM nodes are re-rendered)
		const now = performance.now();
		const timeDelta = now - this.lastClickTime;
		const distanceDelta = dist(screen, this.lastClickPos);

		if (this.activeTool === 'select' && timeDelta >= 50 && timeDelta <= 400 && distanceDelta < 30) {
			this.lastClickTime = 0;
			const targetEl = e.target as SVGElement | null;
			const clickedText = this.findTextNear(screen, targetEl);
			if (clickedText) {
				e.preventDefault();
				e.stopPropagation();
				this.lastDoubleClickedTime = now;
				this.cancelDrawing();
				this.sketch.selectEntity(clickedText.id, 'text', false);
				this.sidebar?.render();
				const textarea = this.sidebar?.container?.querySelector('#text-tool-input-text') as HTMLTextAreaElement | null;
				textarea?.focus();
				return;
			}
			if (this.triggerDimensionEditAt(e, screen, clientPos)) {
				e.preventDefault();
				e.stopPropagation();
				this.lastDoubleClickedTime = now;
				if (this.activeTool === 'select') this.cancelDrawing();
				return;
			}
		} else {
			this.lastClickTime = now;
			this.lastClickPos = screen;
		}

		// Delegate to active tool if not select
		if (this.activeTool !== 'select' && this.activeToolInstance?.onMouseDown) {
			const toolEvent = this.createToolMouseEvent(e);
			const handled = this.activeToolInstance.onMouseDown(toolEvent);
			if (handled !== false) {
				this.updateToolPreview();
				return;
			}
		}

		const world = this.viewport.screenToWorld(screen);
		const snap = this.findSnap(screen);

		// Check for Text rotation gizmo handle dragging
		const textGizmo = this.renderer.textRotationGizmo;
		if (textGizmo && dist(screen, textGizmo.handleScreen) <= 15) {
			this.textRotationDragState = {
				textId: textGizmo.textId,
				centerWorld: textGizmo.centerWorld,
			};
			this.sketch.beginTransaction();
			return;
		}

		// Check for Text center drag gizmo handle dragging
		const textDragGizmo = this.renderer.textDragGizmo;
		if (textDragGizmo && dist(screen, textDragGizmo.centerScreen) <= 15) {
			const text = this.sketch.texts.get(textDragGizmo.textId);
			const initialPoints = new Map<string, Vec2>();
			if (text?.rectanglePointIds) {
				for (const pid of text.rectanglePointIds) {
					const pt = this.sketch.points.get(pid);
					if (pt) initialPoints.set(pid, vec(pt.x, pt.y));
				}
			}
			this.textDragState = {
				textId: textDragGizmo.textId,
				startWorld: world,
				initialPoints,
			};
			this.sketch.beginTransaction();
			return;
		}

		// Check for Rectangular Pattern Gizmo handle dragging (in select mode on selected pattern constraint)
		for (const handle of this.renderer.rectangularGizmoHandles.values()) {
			if (dist(screen, handle) <= GIZMO_DISTANCE_PX) {
				let centroidWorld: Vec2 | null = null;
				let u: Vec2 | null = null;
				let startDistance = 0;
				if (handle.constraintId) {
					const constraint = this.sketch.constraints.get(handle.constraintId) as
						| RectangularPatternConstraint
						| undefined;
					if (constraint && constraint.type === 'rectangular_pattern') {
						startDistance = handle.axis === 1 ? constraint.distance1 : constraint.distance2;
						const paramMap = new Map<string, number>();
						for (const [pid, pt] of this.sketch.points.entries()) {
							paramMap.set(`${pid}.x`, pt.x);
							paramMap.set(`${pid}.y`, pt.y);
						}
						const line1 = constraint.line1Id ? this.sketch.lines.get(constraint.line1Id) : null;
						const line2 = constraint.line2Id ? this.sketch.lines.get(constraint.line2Id) : null;
						const dirs = computeRectangularPatternDirections(
							paramMap,
							line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
							line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
						);
						u = handle.axis === 1 ? dirs.u1 : dirs.u2;
						centroidWorld = calculateObjectsCentroid(this.sketch, constraint.sourceObjectIds);
					}
				}

				if (centroidWorld && u) {
					if (handle.constraintId) {
						this.sketch.selectEntity(handle.constraintId, 'constraint', false);
					}
					this.gizmoDragState = {
						axis: handle.axis,
						startMouseWorld: world,
						centroidWorld,
						u,
						startDistance,
						constraintId: handle.constraintId,
					};
					return;
				}
			}
		}

		// --- TOOL: SELECT ---
		if (this.activeTool === 'select') {
			// Check if clicking on a circular or rectangular pattern suppression checkbox on canvas
			for (const entry of this.renderer.patternCheckboxPositions.values()) {
				if (
					entry.constraintId &&
					Math.abs(screen.x - entry.x) <= LABEL_DISTANCE_PX &&
					Math.abs(screen.y - entry.y) <= LABEL_DISTANCE_PX
				) {
					const c = this.sketch.constraints.get(entry.constraintId);
					if (c instanceof CircularPatternConstraint && c.suppression) {
						this.sketch.selectEntity(c.id, 'constraint', false);
						const currentSuppressed = new Set(c.suppressedIndices);
						if (currentSuppressed.has(entry.copyIndex)) {
							currentSuppressed.delete(entry.copyIndex);
						} else {
							currentSuppressed.add(entry.copyIndex);
						}
						this.sketch.updateCircularPattern(c.id, {
							suppressedIndices: Array.from(currentSuppressed),
						});
						this.render();
						return;
					}
					if (c instanceof RectangularPatternConstraint && c.suppression) {
						this.sketch.selectEntity(c.id, 'constraint', false);
						const currentSuppressed = new Set(c.suppressedIndices);
						if (currentSuppressed.has(entry.copyIndex)) {
							currentSuppressed.delete(entry.copyIndex);
						} else {
							currentSuppressed.add(entry.copyIndex);
						}
						this.sketch.updateRectangularPattern(c.id, {
							suppressedIndices: Array.from(currentSuppressed),
						});
						this.render();
						return;
					}
				}
			}

			const target = e.target as SVGElement;
			const targetG = target.closest('[data-id]') as SVGElement | null;
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

			// Priority 1: Points have top priority over primitives (unless user explicitly clicked a constraint badge/dimension)
			const nearPoint = type !== 'constraint' ? this.findPointNear(screen) : null;
			if (nearPoint) {
				id = nearPoint.id;
				type = 'point';
			} else if (!type) {
				if (snap && snap.type === 'point' && snap.id) {
					id = snap.id;
					type = 'point';
				} else {
					const hitConstraint = this.findConstraintNear(screen);
					if (
						hitConstraint &&
						!this.sketch.isSplineInternalConstraint(hitConstraint) &&
						hitConstraint.type !== 'arc_endpoints' &&
						hitConstraint.type !== 'elliptical_arc_endpoints'
					) {
						id = hitConstraint.id;
						type = 'constraint';
					} else {
						const hitLine = this.findLineNear(screen);
						if (hitLine) {
							id = hitLine.id;
							type = 'line';
						} else {
							const hitCircle = this.findCircleNear(screen);
							if (hitCircle) {
								id = hitCircle.id;
								type = 'circle';
							} else {
								const hitArc = this.findArcNear(screen);
								if (hitArc) {
									id = hitArc.id;
									type = 'arc';
								} else {
									const hitEllipse = this.findEllipseNear(screen);
									if (hitEllipse) {
										id = hitEllipse.id;
										type = 'ellipse';
									} else {
										const hitEllipticalArc = this.findEllipticalArcNear(screen, LINE_DISTANCE_PX);
										if (hitEllipticalArc) {
											id = hitEllipticalArc.id;
											type = 'elliptical_arc';
										} else {
											const hitSpline = this.findSplineNear(screen);
											if (hitSpline) {
												id = hitSpline.id;
												type = 'spline';
											} else {
												const hitText = this.findTextNear(screen, target);
												if (hitText) {
													id = hitText.id;
													type = 'text';
												} else {
													const sOrigin = this.viewport.worldToScreen(ORIGIN);
													if (Math.abs(screen.y - sOrigin.y) <= LINE_DISTANCE_PX) {
														id = 'axis_x';
														type = 'line';
													} else if (Math.abs(screen.x - sOrigin.x) <= LINE_DISTANCE_PX) {
														id = 'axis_y';
														type = 'line';
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}

			// A visible primitive can be the raw SVG target even when the pointer is
			// within the wider tolerance of a nearby dimension line.
			if (type && type !== 'constraint' && type !== 'point') {
				const hitConstraint = this.findConstraintNear(screen);
				if (
					hitConstraint &&
					!this.sketch.isSplineInternalConstraint(hitConstraint) &&
					hitConstraint.type !== 'arc_endpoints' &&
					hitConstraint.type !== 'elliptical_arc_endpoints'
				) {
					id = hitConstraint.id;
					type = 'constraint';
				}
			}

			if (id && type) {
				const isToggle = e.metaKey || e.ctrlKey;
				if (isToggle) {
					this.sketch.toggleEntitySelection(id, type);
					this.render();
					return;
				}

				const wasAlreadySelected = this.sketch.isEntitySelected(id, type);
				if (e.shiftKey) {
					this.sketch.selectEntity(id, type, true);
				} else if (!wasAlreadySelected) {
					this.sketch.selectEntity(id, type, false);
				} else {
					this.pendingExclusiveSelection = { id, type };
				}

				if (type === 'point' && id !== 'origin') {
					this.renderer.clearPreviews();
					this.isDraggingPoint = true;
					this.draggedPointId = id;
					this.preDragSnapshot = this.sketch.takeSnapshot();
					this.hasDragged = false;
					const pt = this.sketch.points.get(id);
					if (pt) {
						this.dragPointStartWorld = vec(pt.x, pt.y);
					}
				} else if (type === 'line') {
					const line = this.sketch.lines.get(id);
					if (line) {
						const p1 = this.sketch.points.get(line.p1Id);
						const p2 = this.sketch.points.get(line.p2Id);
						if (p1 && p2) {
							this.isDraggingLine = true;
							this.draggedLineId = id;
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
							this.dragLineStartWorld = world;
							this.lineP1Start = vec(p1.x, p1.y);
							this.lineP2Start = vec(p2.x, p2.y);
						}
					}
				} else if (type === 'circle') {
					const circle = this.sketch.circles.get(id);
					if (circle) {
						const center = this.sketch.points.get(circle.centerId);
						if (center) {
							this.isDraggingCircle = true;
							this.draggedCircleId = id;
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
							this.dragCircleStartWorld = world;
							this.circleCenterStart = vec(center.x, center.y);
						}
					}
				} else if (type === 'arc') {
					const arc = this.sketch.arcs.get(id);
					if (arc) {
						const center = this.sketch.points.get(arc.centerId);
						const start = this.sketch.points.get(arc.startPointId);
						const end = this.sketch.points.get(arc.endPointId);
						if (center && start && end) {
							this.isDraggingArc = true;
							this.draggedArcId = id;
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
							this.dragArcStartWorld = world;
							this.arcCenterStart = vec(center.x, center.y);
							this.arcStartPointStart = vec(start.x, start.y);
							this.arcEndPointStart = vec(end.x, end.y);
						}
					}
				} else if (type === 'ellipse') {
					const ellipse = this.sketch.ellipses.get(id);
					if (ellipse) {
						const center = this.sketch.points.get(ellipse.centerId);
						const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
						const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
						if (center && majorPt && minorPt) {
							this.isDraggingEllipse = true;
							this.draggedEllipseId = id;
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
							this.dragEllipseStartWorld = world;
							this.ellipseCenterStart = vec(center.x, center.y);
							this.ellipseMajorPointStart = vec(majorPt.x, majorPt.y);
							this.ellipseMinorPointStart = vec(minorPt.x, minorPt.y);
						}
					}
				} else if (type === 'elliptical_arc') {
					const arc = this.sketch.ellipticalArcs.get(id);
					if (arc) {
						const center = this.sketch.points.get(arc.centerId);
						const majorPt = this.sketch.points.get(arc.majorAxisPointId);
						const minorPt = this.sketch.points.get(arc.minorAxisPointId);
						const start = this.sketch.points.get(arc.startPointId);
						const end = this.sketch.points.get(arc.endPointId);
						if (center && majorPt && minorPt && start && end) {
							this.isDraggingEllipticalArc = true;
							this.draggedEllipticalArcId = id;
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
							this.dragEllipticalArcStartWorld = world;
							this.ellipticalArcCenterStart = vec(center.x, center.y);
							this.ellipticalArcMajorPointStart = vec(majorPt.x, majorPt.y);
							this.ellipticalArcMinorPointStart = vec(minorPt.x, minorPt.y);
							this.ellipticalArcStartPointStart = vec(start.x, start.y);
							this.ellipticalArcEndPointStart = vec(end.x, end.y);
						}
					}
				} else if (type === 'spline') {
					const spline = this.sketch.splines.get(id);
					if (spline) {
						this.isDraggingSpline = true;
						this.draggedSplineId = id;
						this.preDragSnapshot = this.sketch.takeSnapshot();
						this.hasDragged = false;
						this.dragSplineStartWorld = world;
						this.splinePointsStart.clear();
						for (const pid of spline.pointIds) {
							const p = this.sketch.points.get(pid);
							if (p) this.splinePointsStart.set(pid, vec(p.x, p.y));
						}
						if (spline.tangentLineIds) {
							for (const lid of spline.tangentLineIds) {
								const line = this.sketch.lines.get(lid);
								if (line) {
									const p1 = this.sketch.points.get(line.p1Id);
									const p2 = this.sketch.points.get(line.p2Id);
									if (p1) this.splinePointsStart.set(p1.id, vec(p1.x, p1.y));
									if (p2) this.splinePointsStart.set(p2.id, vec(p2.x, p2.y));
								}
							}
						}
					}
				} else if (type === 'constraint') {
					const constraint = this.sketch.constraints.get(id);
					if (
						constraint instanceof DistanceConstraint ||
						constraint instanceof PointToLineDistanceConstraint ||
						(constraint instanceof OriginDistanceConstraint && !constraint.isCoincident) ||
						(constraint instanceof LineToAxisDistanceConstraint && !constraint.isCollinear) ||
						constraint instanceof OffsetConstraint ||
						constraint instanceof AngleConstraint ||
						constraint instanceof RadiusConstraint
					) {
						this.isDraggingConstraint = true;
						this.draggedConstraintId = id;
						this.preDragSnapshot = this.sketch.takeSnapshot();
						this.hasDragged = false;
						this.dragConstraintStartScreen = screen;
						if (constraint instanceof RadiusConstraint) {
							const anchor = constraint.getLabelAnchor(this.sketch, this.viewport);
							this.radiusLabelGrabOffset = anchor ? sub(anchor, screen) : null;
						}
					}
				}

				this.svg.classList.add('is-dragging');
				this.render();
			} else {
				// Clicked background -> start rectangular box selection
				this.isBoxSelecting = true;
				this.boxSelectStartScreen = screen;
				this.boxSelectCurrentScreen = screen;
				this.boxSelectShift = e.shiftKey;
				if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
					this.sketch.clearSelection();
					this.render();
				}
			}
			return;
		}
	}

	private handleMouseMove(e: MouseEvent): void {
		this.isSnapModifierPressed = this.isSnapModifier(e);
		const screen = this.getScreenPos(e);
		const world = this.viewport.screenToWorld(screen);

		// Pan handling
		if (this.isPanning) {
			this.regionHoverPoint = null;
			this.renderer.updateRegionHover(null);
			const dir = sub(screen, this.lastMouseScreen);
			this.viewport.pan(dir.x, dir.y);
			this.lastMouseScreen = screen;
			this.render();
			return;
		}

		this.lastMouseScreen = screen;

		// Gizmo drag handling (Rectangular pattern distance1 / distance2 in select mode)
		if (this.gizmoDragState) {
			const { axis, centroidWorld, u, startMouseWorld, startDistance, constraintId } = this.gizmoDragState;
			const startProj = dot(sub(startMouseWorld, centroidWorld), u);
			const currentProj = dot(sub(world, centroidWorld), u);
			const delta = currentProj - startProj;
			let newDist = startDistance + delta;
			if (Math.abs(newDist) < 0.25) {
				newDist = 0;
			} else {
				newDist = Math.round(newDist * 2) / 2;
			}

			if (constraintId) {
				const constraint = this.sketch.constraints.get(constraintId) as RectangularPatternConstraint | undefined;
				if (constraint && constraint.type === 'rectangular_pattern') {
					if (axis === 1) {
						if (constraint.distance1 !== newDist) {
							this.sketch.updateRectangularPattern(constraintId, {
								distance1: newDist,
							});
						}
					} else {
						if (constraint.distance2 !== newDist) {
							this.sketch.updateRectangularPattern(constraintId, {
								distance2: newDist,
							});
						}
					}
					this.render();
				}
			}
			return;
		}

		// Text Rotation Gizmo drag handling
		if (this.textRotationDragState) {
			const text = this.sketch.texts.get(this.textRotationDragState.textId);
			if (text && text.rectanglePointIds) {
				const c = this.textRotationDragState.centerWorld;
				const mouseAngle = angleFromTo(c, world);
				const targetAngle = mouseAngle - Math.PI / 2;

				const corners = text.getRectangleCorners(this.sketch);
				if (corners) {
					const [p0, p1, p2, p3] = corners;
					const currentAngle = angleFromTo(p0, p1);
					const deltaAngle = targetAngle - currentAngle;

					const rotatePoint = (p: Vec2, center: Vec2, rad: number): Vec2 => {
						const cos = Math.cos(rad);
						const sin = Math.sin(rad);
						const dir = sub(p, center);
						return vec(center.x + dir.x * cos - dir.y * sin, center.y + dir.x * sin + dir.y * cos);
					};

					const pt0 = this.sketch.points.get(text.rectanglePointIds[0]);
					const pt1 = this.sketch.points.get(text.rectanglePointIds[1]);
					const pt2 = this.sketch.points.get(text.rectanglePointIds[2]);
					const pt3 = this.sketch.points.get(text.rectanglePointIds[3]);

					if (pt0 && pt1 && pt2 && pt3) {
						const np0 = rotatePoint(p0, c, deltaAngle);
						const np1 = rotatePoint(p1, c, deltaAngle);
						const np2 = rotatePoint(p2, c, deltaAngle);
						const np3 = rotatePoint(p3, c, deltaAngle);

						pt0.x = np0.x;
						pt0.y = np0.y;
						pt1.x = np1.x;
						pt1.y = np1.y;
						pt2.x = np2.x;
						pt2.y = np2.y;
						pt3.x = np3.x;
						pt3.y = np3.y;

						this.sketch.solve();
						this.render();
						return;
					}
				}
			}
			return;
		}

		// Text Center Drag Gizmo handling
		if (this.textDragState) {
			const dir = sub(world, this.textDragState.startWorld);
			for (const [pid, initPos] of this.textDragState.initialPoints) {
				const pt = this.sketch.points.get(pid);
				if (pt) {
					pt.x = initPos.x + dir.x;
					pt.y = initPos.y + dir.y;
				}
			}
			this.sketch.solve();
			this.render();
			return;
		}

		// Box selection handling
		if (this.isBoxSelecting && this.boxSelectStartScreen) {
			this.boxSelectCurrentScreen = screen;
			this.renderer.renderSelectionBox(this.boxSelectStartScreen, this.boxSelectCurrentScreen);
			return;
		}

		// Drag constraint handling (Distance offset & Angle radius/quadrant)
		if (this.isDraggingConstraint && this.draggedConstraintId) {
			if (this.dragConstraintStartScreen && dist(screen, this.dragConstraintStartScreen) > 3) {
				this.hasDragged = true;
			}
			if (this.hasDragged) {
				const constraint = this.sketch.constraints.get(this.draggedConstraintId);
				if (constraint instanceof DistanceConstraint) {
					const p1 = this.sketch.points.get(constraint.p1Id);
					const p2 = this.sketch.points.get(constraint.p2Id);
					if (p1 && p2) {
						const s1 = this.viewport.worldToScreen(p1);
						const s2 = this.viewport.worldToScreen(p2);
						const midPoint = mid(s1, s2);
						if (constraint.orientation === 'horizontal') {
							const screenOffset = screen.y - midPoint.y;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else if (constraint.orientation === 'vertical') {
							const screenOffset = screen.x - midPoint.x;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else {
							const dir = normalizeOrNull(sub(s2, s1), 1e-4);
							if (dir) {
								const normal = vec(-dir.y, dir.x);
								const screenOffset = dot(sub(screen, midPoint), normal);
								constraint.offset = screenOffset / this.viewport.zoom;
								this.render();
							}
						}
					}
				} else if (constraint instanceof PointToLineDistanceConstraint) {
					const pt = this.sketch.points.get(constraint.pointId);
					const p1 = this.sketch.points.get(constraint.lineP1Id);
					const p2 = this.sketch.points.get(constraint.lineP2Id);
					if (pt && p1 && p2) {
						const sp = this.viewport.worldToScreen(pt);
						const s1 = this.viewport.worldToScreen(p1);
						const s2 = this.viewport.worldToScreen(p2);
						const dir = normalizeOrNull(sub(s2, s1), 1e-4);
						if (dir) {
							const tProj = dot(sub(sp, s1), dir);
							const tCursor = dot(sub(screen, s1), dir);
							constraint.offset = (tCursor - tProj) / this.viewport.zoom;
							this.render();
						}
					}
				} else if (constraint instanceof OriginDistanceConstraint && !constraint.isCoincident) {
					const pt = this.sketch.points.get(constraint.pointId);
					if (pt) {
						const sp = this.viewport.worldToScreen(pt);
						const sOrigin = this.viewport.worldToScreen(ORIGIN);
						if (constraint.orientation === 'vertical') {
							const screenOffset = screen.x - sp.x;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else if (constraint.orientation === 'horizontal') {
							const sAxisY = this.viewport.worldToScreen({ x: 0, y: 100 });
							const dy = sAxisY.y - sOrigin.y;
							const lineLen = Math.hypot(0, dy);
							const uy = lineLen > 1e-4 ? dy / lineLen : -1;
							const screenOffset = (screen.y - sp.y) * uy;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else {
							const midPoint = mid(sOrigin, sp);
							const dir = normalizeOrNull(sub(sp, sOrigin), 1e-4);
							if (dir) {
								const normal = vec(-dir.y, dir.x);
								const screenOffset = dot(sub(screen, midPoint), normal);
								constraint.offset = screenOffset / this.viewport.zoom;
								this.render();
							}
						}
					}
				} else if (constraint instanceof LineToAxisDistanceConstraint && !constraint.isCollinear) {
					const p1 = this.sketch.points.get(constraint.lineP1Id);
					const p2 = this.sketch.points.get(constraint.lineP2Id);
					if (p1 && p2) {
						const midPt = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
						const sp = this.viewport.worldToScreen(midPt);
						if (constraint.axis === 'x') {
							const screenOffset = screen.x - sp.x;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else {
							const sOrigin = this.viewport.worldToScreen(ORIGIN);
							const sAxisY = this.viewport.worldToScreen({ x: 0, y: 100 });
							const dy = sAxisY.y - sOrigin.y;
							const lineLen = Math.hypot(0, dy);
							const uy = lineLen > 1e-4 ? dy / lineLen : -1;
							const screenOffset = (screen.y - sp.y) * uy;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						}
					}
				} else if (constraint instanceof AngleConstraint) {
					const l1 = this.sketch.getLine(constraint.line1Id);
					const l2 = this.sketch.getLine(constraint.line2Id);
					const p1 = this.sketch.points.get(l1 ? l1.p1Id : constraint.l1P1);
					const p2 = this.sketch.points.get(l1 ? l1.p2Id : constraint.l1P2);
					const p3 = this.sketch.points.get(l2 ? l2.p1Id : constraint.l2P1);
					const p4 = this.sketch.points.get(l2 ? l2.p2Id : constraint.l2P2);
					if (p1 && p2 && p3 && p4) {
						const geom = this.sketch.calculateLinesAngleGeometry(
							p1,
							p2,
							p3,
							p4,
							world,
							constraint.line1Id,
							constraint.line2Id
						);
						const arcRadiusWorld = Math.max(10, Math.hypot(world.x - geom.pInt.x, world.y - geom.pInt.y));
						constraint.arcRadius = arcRadiusWorld;

						if (l1 && l2 && (geom.s1 !== constraint.s1 || geom.s2 !== constraint.s2)) {
							constraint.s1 = geom.s1;
							constraint.s2 = geom.s2;
							constraint.sign = geom.sign;
							const newAngle = Math.round(geom.initialAngleDeg * 10) / 10;
							constraint.targetAngle = newAngle;
							constraint.value = newAngle;
							constraint.name = 'Angle';
							this.sketch.solve();
						}
						this.render();
					}
				} else if (constraint instanceof RadiusConstraint && this.radiusLabelGrabOffset) {
					constraint.moveLabelTo(addScaled(screen, this.radiusLabelGrabOffset, 1), this.sketch, this.viewport);
					this.render();
				}
			}
			return;
		}

		// Drag point handling (Live solver calculation!)
		if (this.isDraggingPoint && this.draggedPointId && this.dragPointStartWorld) {
			this.hasDragged = true;
			const snap = this.findSnap(screen, this.draggedPointId);
			const targetWorld = this.sketch.getPointDragTarget(this.draggedPointId, snap?.worldPos ?? world);
			this.sketch.dragPoint(this.draggedPointId, targetWorld.x, targetWorld.y);
			this.render();
			if (snap && targetWorld.x === snap.worldPos.x && targetWorld.y === snap.worldPos.y) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, true);
			} else {
				this.renderer.clearPreviews();
			}
			return;
		}

		// Drag line handling
		if (this.isDraggingLine && this.draggedLineId && this.dragLineStartWorld && this.lineP1Start && this.lineP2Start) {
			this.hasDragged = true;
			const dir = sub(world, this.dragLineStartWorld);
			this.sketch.dragLine(
				this.draggedLineId,
				this.lineP1Start.x + dir.x,
				this.lineP1Start.y + dir.y,
				this.lineP2Start.x + dir.x,
				this.lineP2Start.y + dir.y
			);
			this.render();
			return;
		}

		// Drag circle handling
		if (this.isDraggingCircle && this.draggedCircleId && this.dragCircleStartWorld && this.circleCenterStart) {
			this.hasDragged = true;
			const circle = this.sketch.circles.get(this.draggedCircleId);
			const center = circle ? this.sketch.points.get(circle.centerId) : null;
			const isFixed = center ? this.sketch.isPointFixed(center.id) : false;
			const hasRadConst = this.sketch.hasRadiusConstraint(this.draggedCircleId);

			if ((e.shiftKey || e.altKey || (isFixed && !hasRadConst)) && center) {
				const newRadius = Math.max(1, dist(center, world));
				this.sketch.dragCircleRadius(this.draggedCircleId, newRadius);
				this.render();
			} else {
				const dir = sub(world, this.dragCircleStartWorld);
				this.sketch.dragCircle(
					this.draggedCircleId,
					this.circleCenterStart.x + dir.x,
					this.circleCenterStart.y + dir.y
				);
				this.render();
			}
			return;
		}

		// Drag arc handling
		if (
			this.isDraggingArc &&
			this.draggedArcId &&
			this.dragArcStartWorld &&
			this.arcCenterStart &&
			this.arcStartPointStart &&
			this.arcEndPointStart
		) {
			this.hasDragged = true;
			const dir = sub(world, this.dragArcStartWorld);

			const arc = this.sketch.arcs.get(this.draggedArcId);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const start = this.sketch.points.get(arc.startPointId);
				const end = this.sketch.points.get(arc.endPointId);
				if (center && !center.fixed) {
					center.x = this.arcCenterStart.x + dir.x;
					center.y = this.arcCenterStart.y + dir.y;
				}
				if (start && !start.fixed) {
					start.x = this.arcStartPointStart.x + dir.x;
					start.y = this.arcStartPointStart.y + dir.y;
				}
				if (end && !end.fixed) {
					end.x = this.arcEndPointStart.x + dir.x;
					end.y = this.arcEndPointStart.y + dir.y;
				}
				this.sketch.solve();
				this.render();
			}
			return;
		}

		// Drag ellipse handling
		if (
			this.isDraggingEllipse &&
			this.draggedEllipseId &&
			this.dragEllipseStartWorld &&
			this.ellipseCenterStart &&
			this.ellipseMajorPointStart &&
			this.ellipseMinorPointStart
		) {
			this.hasDragged = true;
			const dir = sub(world, this.dragEllipseStartWorld);

			const ellipse = this.sketch.ellipses.get(this.draggedEllipseId);
			if (ellipse) {
				const center = this.sketch.points.get(ellipse.centerId);
				const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
				const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
				if (center && !center.fixed) {
					center.x = this.ellipseCenterStart.x + dir.x;
					center.y = this.ellipseCenterStart.y + dir.y;
				}
				if (majorPt && !majorPt.fixed) {
					majorPt.x = this.ellipseMajorPointStart.x + dir.x;
					majorPt.y = this.ellipseMajorPointStart.y + dir.y;
				}
				if (minorPt && !minorPt.fixed) {
					minorPt.x = this.ellipseMinorPointStart.x + dir.x;
					minorPt.y = this.ellipseMinorPointStart.y + dir.y;
				}
				this.sketch.solve();
				this.render();
			}
			return;
		}

		// Drag elliptical arc handling
		if (
			this.isDraggingEllipticalArc &&
			this.draggedEllipticalArcId &&
			this.dragEllipticalArcStartWorld &&
			this.ellipticalArcCenterStart &&
			this.ellipticalArcMajorPointStart &&
			this.ellipticalArcMinorPointStart &&
			this.ellipticalArcStartPointStart &&
			this.ellipticalArcEndPointStart
		) {
			this.hasDragged = true;
			const dir = sub(world, this.dragEllipticalArcStartWorld);

			const arc = this.sketch.ellipticalArcs.get(this.draggedEllipticalArcId);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const majorPt = this.sketch.points.get(arc.majorAxisPointId);
				const minorPt = this.sketch.points.get(arc.minorAxisPointId);
				const start = this.sketch.points.get(arc.startPointId);
				const end = this.sketch.points.get(arc.endPointId);
				if (center && !center.fixed) {
					center.x = this.ellipticalArcCenterStart.x + dir.x;
					center.y = this.ellipticalArcCenterStart.y + dir.y;
				}
				if (majorPt && !majorPt.fixed) {
					majorPt.x = this.ellipticalArcMajorPointStart.x + dir.x;
					majorPt.y = this.ellipticalArcMajorPointStart.y + dir.y;
				}
				if (minorPt && !minorPt.fixed) {
					minorPt.x = this.ellipticalArcMinorPointStart.x + dir.x;
					minorPt.y = this.ellipticalArcMinorPointStart.y + dir.y;
				}
				if (start && !start.fixed) {
					start.x = this.ellipticalArcStartPointStart.x + dir.x;
					start.y = this.ellipticalArcStartPointStart.y + dir.y;
				}
				if (end && !end.fixed) {
					end.x = this.ellipticalArcEndPointStart.x + dir.x;
					end.y = this.ellipticalArcEndPointStart.y + dir.y;
				}
				this.sketch.solve();
				this.render();
			}
			return;
		}

		// Drag spline handling
		if (this.isDraggingSpline && this.draggedSplineId && this.dragSplineStartWorld) {
			this.hasDragged = true;
			const dir = sub(world, this.dragSplineStartWorld);

			for (const [pid, startPos] of this.splinePointsStart.entries()) {
				const pt = this.sketch.points.get(pid);
				if (pt && !pt.fixed) {
					pt.x = startPos.x + dir.x;
					pt.y = startPos.y + dir.y;
				}
			}
			this.sketch.solve();
			this.render();
			return;
		}

		// If mouse is outside the canvas SVG (e.g. over modals, dialogs, header, toolbar, sidebar),
		// clear hover highlights and tool previews, and do not process hover under overlays.
		const isOverCanvas = e.target === this.svg || (e.target instanceof Node && this.svg.contains(e.target));
		if (!isOverCanvas) {
			this.regionHoverPoint = null;
			this.renderer.updateRegionHover(null);
			this.highlightManager.clear();
			this.renderer.clearPreviews();
			return;
		}

		// Centralized hover highlight
		let hoveredTarget = null;
		if (
			this.isPanning ||
			this.isDraggingPoint ||
			this.isBoxSelecting ||
			this.gizmoDragState ||
			this.textRotationDragState ||
			this.textDragState
		) {
			this.highlightManager.clear();
		} else {
			hoveredTarget = this.highlightManager.update(this.activeToolInstance, screen, e.target as SVGElement);
		}
		const allowRegionHover =
			this.activeTool === 'select' &&
			!hoveredTarget &&
			!this.isPanning &&
			!this.isDraggingPoint &&
			!this.isBoxSelecting &&
			!this.gizmoDragState &&
			!this.textRotationDragState &&
			!this.textDragState;
		this.regionHoverPoint = allowRegionHover ? world : null;
		this.renderer.updateRegionHover(this.regionHoverPoint);

		// Delegate to active tool if not select
		if (this.activeTool !== 'select' && this.activeToolInstance) {
			const toolEvent = this.createToolMouseEvent(e);
			this.activeToolInstance.onMouseMove?.(toolEvent);
			this.updateToolPreview();
			return;
		}

		if (this.activeTool === 'select' && this.activeToolInstance) {
			const toolEvent = this.createToolMouseEvent(e);
			this.activeToolInstance.onMouseMove?.(toolEvent);
		}

		this.svg.style.cursor = 'default';
	}

	private handleMouseUp(e?: MouseEvent): void {
		if (e) {
			this.isSnapModifierPressed = this.isSnapModifier(e);
			if (this.activeTool !== 'select' && this.activeToolInstance?.onMouseUp) {
				const toolEvent = this.createToolMouseEvent(e);
				this.activeToolInstance.onMouseUp(toolEvent);
				this.updateToolPreview();
			}
		}
		if (this.activeTool === 'select' && this.activeToolInstance && !this.isPanning && !this.isBoxSelecting) {
			const toolEvent = this.createToolMouseEvent(
				e ?? ({ clientX: this.lastMouseScreen.x, clientY: this.lastMouseScreen.y } as any)
			);
			this.activeToolInstance.onMouseMove?.(toolEvent);
		}
		this.svg.classList.remove('is-dragging');
		if (this.gizmoDragState) {
			this.gizmoDragState = null;
			this.render();
		}
		if (this.textRotationDragState) {
			this.textRotationDragState = null;
			this.sketch.commitTransaction();
			this.render();
		}
		if (this.textDragState) {
			this.textDragState = null;
			this.sketch.commitTransaction();
			this.render();
		}
		if (this.isPanning) {
			this.isPanning = false;
			this.updateCursor();
		}
		if (this.isDraggingPoint) {
			const draggedPtId = this.draggedPointId;
			this.isDraggingPoint = false;
			this.draggedPointId = null;
			this.dragPointStartWorld = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				if (draggedPtId) {
					const screen = e ? this.getScreenPos(e) : this.lastMouseScreen;
					const snap = this.findSnap(screen, draggedPtId);
					const target = snap && this.sketch.getPointDragTarget(draggedPtId, snap.worldPos);
					if (
						snap &&
						target &&
						(this.sketch.isSplineHandlePoint(draggedPtId) ||
							target.x !== snap.worldPos.x ||
							target.y !== snap.worldPos.y)
					) {
						this.sketch.dragPoint(draggedPtId, target.x, target.y);
					} else if (snap && snap.id && (snap.type !== 'point' || snap.id !== draggedPtId)) {
						const pt = this.sketch.getPoint(draggedPtId);
						if (pt) {
							pt.x = snap.worldPos.x;
							pt.y = snap.worldPos.y;
						}
						if (this.preDragSnapshot) {
							this.sketch.beginTransactionWithSnapshot(this.preDragSnapshot);
							this.preDragSnapshot = null;
						} else {
							this.sketch.beginTransaction();
						}
						this.applySnapConstraintIfNeeded(draggedPtId, snap);
						this.sketch.commitTransaction();
					} else if (snap && snap.type === 'grid') {
						const pt = this.sketch.getPoint(draggedPtId);
						if (pt && !this.sketch.isPointFixed(draggedPtId)) {
							pt.x = snap.worldPos.x;
							pt.y = snap.worldPos.y;
						}
					}
				}
				// Final solve without soft drag constraint to ensure exact convergence
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingLine) {
			this.isDraggingLine = false;
			this.draggedLineId = null;
			this.dragLineStartWorld = null;
			this.lineP1Start = null;
			this.lineP2Start = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingCircle) {
			this.isDraggingCircle = false;
			this.draggedCircleId = null;
			this.dragCircleStartWorld = null;
			this.circleCenterStart = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingArc) {
			this.isDraggingArc = false;
			this.draggedArcId = null;
			this.dragArcStartWorld = null;
			this.arcCenterStart = null;
			this.arcStartPointStart = null;
			this.arcEndPointStart = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingEllipse) {
			this.isDraggingEllipse = false;
			this.draggedEllipseId = null;
			this.dragEllipseStartWorld = null;
			this.ellipseCenterStart = null;
			this.ellipseMajorPointStart = null;
			this.ellipseMinorPointStart = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingEllipticalArc) {
			this.isDraggingEllipticalArc = false;
			this.draggedEllipticalArcId = null;
			this.dragEllipticalArcStartWorld = null;
			this.ellipticalArcCenterStart = null;
			this.ellipticalArcMajorPointStart = null;
			this.ellipticalArcMinorPointStart = null;
			this.ellipticalArcStartPointStart = null;
			this.ellipticalArcEndPointStart = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingSpline) {
			this.isDraggingSpline = false;
			this.draggedSplineId = null;
			this.dragSplineStartWorld = null;
			this.splinePointsStart.clear();
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
				this.render();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.isDraggingConstraint) {
			const hadDragged = this.hasDragged;

			this.isDraggingConstraint = false;
			this.draggedConstraintId = null;
			this.dragConstraintStartScreen = null;
			this.radiusLabelGrabOffset = null;

			if (hadDragged) {
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
				this.preDragSnapshot = null;
				this.hasDragged = false;
				this.render();
			} else {
				this.preDragSnapshot = null;
				this.hasDragged = false;
			}
			this.updateCursor();
		}

		if (this.isBoxSelecting) {
			const startScreen = this.boxSelectStartScreen;
			const endScreen = e ? this.getScreenPos(e) : (this.boxSelectCurrentScreen ?? startScreen);
			const isShift = this.boxSelectShift || (e ? e.shiftKey : false);

			this.isBoxSelecting = false;
			this.boxSelectStartScreen = null;
			this.boxSelectCurrentScreen = null;
			this.boxSelectShift = false;
			this.renderer.clearPreviews();

			if (startScreen && endScreen && dist(startScreen, endScreen) > 4) {
				this.finishBoxSelection(startScreen, endScreen, isShift);
			}
			this.render();
		}

		if (!this.hasDragged && this.pendingExclusiveSelection) {
			this.sketch.selectEntity(this.pendingExclusiveSelection.id, this.pendingExclusiveSelection.type, false);
			this.render();
		}
		this.pendingExclusiveSelection = null;
		this.highlightManager.update(this.activeToolInstance, this.lastMouseScreen);
	}

	private handleWheel(e: WheelEvent): void {
		this.cancelAnimation();
		e.preventDefault();
		const screen = this.getScreenPos(e);
		// Smooth continuous zoom factor depending exponentially on deltaY via Math.pow
		const zoomFactor = Math.pow(2, -e.deltaY * 0.0015);
		this.viewport.zoomAt(screen, zoomFactor);
		this.render();
		this.onViewportChange?.();
	}

	private triggerDimensionEditAt(e: MouseEvent, screen: Vec2, clientPos: Vec2): boolean {
		const target = e.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type');

		// If target didn't resolve to a line, circle, arc, or constraint, use geometric hit test
		if (!type || (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'constraint')) {
			const hitConstraint = this.findConstraintNear(screen);
			if (hitConstraint) {
				id = hitConstraint.id;
				type = 'constraint';
			} else {
				const hitLine = this.findLineNear(screen);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = this.findCircleNear(screen);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = this.findArcNear(screen);
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
			const constraint = this.sketch.constraints.get(id);
			if (
				(constraint instanceof DistanceConstraint ||
					constraint instanceof PointToLineDistanceConstraint ||
					constraint instanceof OffsetConstraint ||
					constraint instanceof RadiusConstraint ||
					constraint instanceof AngleConstraint ||
					constraint instanceof OriginDistanceConstraint ||
					constraint instanceof LineToAxisDistanceConstraint) &&
				this.onEditDimension
			) {
				this.sketch.selectEntity(constraint.id, 'constraint', false);
				this.render();
				this.onEditDimension(constraint, clientPos);
				return true;
			}
		} else if (type === 'line') {
			const line = this.sketch.lines.get(id);
			if (line) {
				let distConstraint = [...this.sketch.constraints.values()].find(
					c =>
						c instanceof DistanceConstraint &&
						((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
				) as DistanceConstraint | undefined;

				if (!distConstraint) {
					distConstraint = this.sketch.addDistanceConstraint(line.p1Id, line.p2Id) ?? undefined;
				}

				if (distConstraint && this.onEditDimension) {
					this.sketch.selectEntity(distConstraint.id, 'constraint', false);
					this.render();
					this.onEditDimension(distConstraint, clientPos);
					return true;
				}
			}
		} else if (type === 'circle' || type === 'arc') {
			const entity = this.sketch.circles.get(id) ?? this.sketch.arcs.get(id);
			if (entity) {
				const radConstraint = [...this.sketch.constraints.values()].find(
					(c): c is RadiusConstraint => c instanceof RadiusConstraint && c.circleId === entity.id
				);

				if (!radConstraint) {
					this.sketch.clearSelection();
					this.setTool('dimension');
					if (this.activeToolInstance instanceof DimensionTool) {
						this.activeToolInstance.beginRadiusPlacement(entity.id, true);
						return true;
					}
				}

				if (radConstraint && this.onEditDimension) {
					this.sketch.selectEntity(radConstraint.id, 'constraint', false);
					this.render();
					this.onEditDimension(radConstraint, clientPos);
					return true;
				}
			}
		}

		return false;
	}

	private handleDoubleClick(e: MouseEvent): void {
		if (this.activeTool !== 'select') return;
		const now = performance.now();
		if (now - this.lastDoubleClickedTime < 600) {
			return;
		}
		this.isSnapModifierPressed = this.isSnapModifier(e);
		const screen = this.getScreenPos(e);
		const clientPos = vec(e.clientX, e.clientY);

		const targetEl = e.target as SVGElement | null;
		const clickedText = this.findTextNear(screen, targetEl);
		if (clickedText) {
			e.preventDefault();
			e.stopPropagation();
			this.lastDoubleClickedTime = now;
			this.cancelDrawing();
			this.sketch.selectEntity(clickedText.id, 'text', false);
			this.sidebar?.render();
			const textarea = this.sidebar?.container?.querySelector('#text-tool-input-text') as HTMLTextAreaElement | null;
			textarea?.focus();
			return;
		}

		if (this.triggerDimensionEditAt(e, screen, clientPos)) {
			e.preventDefault();
			e.stopPropagation();
			this.lastDoubleClickedTime = now;
			if (this.activeTool === 'select') this.cancelDrawing();
		}
	}

	findTextNear(screen: Vec2, targetEl?: SVGElement | null): SketchText | null {
		const textIdFromAttr =
			targetEl?.getAttribute('data-text-id') || targetEl?.closest('[data-text-id]')?.getAttribute('data-text-id');
		if (textIdFromAttr) {
			const t = this.sketch.texts.get(textIdFromAttr);
			if (t) return t;
		}

		for (const t of this.sketch.texts.values()) {
			const d = t.distanceTo(screen, this.sketch, this.viewport);
			if (d !== null && d <= 15) {
				return t;
			}
		}

		return null;
	}

	private updateCursor(): void {
		if (this.activeToolInstance) {
			this.svg.style.cursor = this.activeToolInstance.defaultCursor;
		} else if (this.activeTool === 'select') {
			this.svg.style.cursor = 'default';
		} else if (this.activeTool === 'pan') {
			this.svg.style.cursor = 'grab';
		} else {
			this.svg.style.cursor = 'crosshair';
		}
	}

	pruneIncompatibleSelection(type: string): void {
		const sel = this.sketch.selection;
		switch (type) {
			case 'fixed': {
				sel.lineIds.clear();
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'coincident': {
				if (sel.lineIds.size > 0 && sel.circleIds.size + sel.arcIds.size > 0) {
					sel.circleIds.clear();
					sel.arcIds.clear();
				}
				break;
			}
			case 'parallel':
			case 'perpendicular': {
				sel.pointIds.clear();
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'collinear': {
				if (sel.lineIds.size > 0) {
					sel.pointIds.clear();
				}
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'concentric': {
				sel.pointIds.clear();
				sel.lineIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'tangent': {
				sel.pointIds.clear();
				if (sel.lineIds.size > 1) sel.lineIds.clear();
				if (sel.circleIds.size + sel.arcIds.size > 2) {
					sel.circleIds.clear();
					sel.arcIds.clear();
				}
				break;
			}
			case 'point_on_line':
			case 'midpoint': {
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical': {
				if (sel.lineIds.size > 0) {
					sel.pointIds.clear();
				}
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'equal': {
				if (sel.lineIds.size > 0) {
					sel.circleIds.clear();
				} else if (sel.circleIds.size > 0) {
					sel.lineIds.clear();
				}
				sel.pointIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'dimension':
			case 'distance': {
				sel.arcIds.clear();
				break;
			}
		}
		if (sel.lineIds.size > 0 && sel.pointIds.size > 0) {
			for (const lid of sel.lineIds) {
				const l = this.sketch.lines.get(lid);
				if (l) {
					sel.pointIds.delete(l.p1Id);
					sel.pointIds.delete(l.p2Id);
				}
			}
		}
		if (type !== 'coincident') {
			sel.ellipseIds.clear();
			sel.ellipticalArcIds.clear();
			sel.splineIds.clear();
		}
		sel.constraintIds.clear();
	}

	canApplyConstraint(type: string): boolean {
		const sel = this.sketch.selection;
		const pCount = sel.pointIds.size;
		const lCount = sel.lineIds.size;
		const cCount = sel.circleIds.size + sel.arcIds.size;
		const eCount = sel.ellipseIds.size + sel.ellipticalArcIds.size;
		const sCount = sel.splineIds.size;

		switch (type) {
			case 'fixed':
				return pCount >= 1;
			case 'coincident':
				return (
					pCount >= 2 ||
					(pCount === 1 && lCount === 1 && cCount === 0 && eCount === 0 && sCount === 0) ||
					(pCount === 1 && cCount === 1 && lCount === 0 && eCount === 0 && sCount === 0) ||
					(pCount === 1 && eCount === 1 && lCount === 0 && cCount === 0 && sCount === 0) ||
					(pCount === 1 && sCount === 1 && lCount === 0 && cCount === 0 && eCount === 0)
				);
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return (lCount === 1 && pCount === 0 && cCount === 0) || (pCount === 2 && lCount === 0 && cCount === 0);
			case 'dimension':
			case 'distance':
				return (
					(lCount === 1 && pCount === 0 && cCount === 0) ||
					(lCount === 2 && pCount === 0 && cCount === 0) ||
					(pCount === 2 && lCount === 0 && cCount === 0) ||
					(pCount === 3 && lCount === 0 && cCount === 0) ||
					(cCount === 1 && pCount === 0 && lCount === 0) ||
					(lCount === 1 && pCount === 1 && cCount === 0)
				);
			case 'equal':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (cCount === 2 && pCount === 0 && lCount === 0);
			case 'parallel':
			case 'perpendicular':
				return lCount === 2 && pCount === 0 && cCount === 0;
			case 'collinear':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (pCount === 3 && lCount === 0 && cCount === 0);
			case 'tangent':
				return ((lCount === 1 && cCount === 1) || (cCount === 2 && lCount === 0)) && pCount === 0;
			case 'concentric':
				return cCount === 2 && pCount === 0 && lCount === 0;
			case 'point_on_line':
				return pCount === 1 && lCount === 1 && cCount === 0;
			case 'midpoint':
				return (pCount === 1 && lCount === 1 && cCount === 0) || (pCount === 3 && lCount === 0 && cCount === 0);
			case 'symmetry':
				return (
					(pCount === 2 && lCount === 1 && cCount === 0) ||
					(pCount === 3 && sel.pointIds.has('origin') && lCount === 0 && cCount === 0) ||
					(cCount === 2 && lCount === 1 && pCount === 0) ||
					(cCount === 2 && pCount === 1 && sel.pointIds.has('origin') && lCount === 0) ||
					(lCount === 3 && pCount === 0 && cCount === 0) ||
					(lCount === 2 &&
						pCount === 1 &&
						sel.pointIds.has('origin') &&
						!sel.lineIds.has('axis_x') &&
						!sel.lineIds.has('axis_y') &&
						cCount === 0)
				);
			default:
				return false;
		}
	}

	applyConstraint(type: string): boolean {
		const sel = this.sketch.selection;
		const pIds = [...sel.pointIds];
		const lIds = [...sel.lineIds];
		const cIds = [...sel.circleIds, ...sel.arcIds];
		const eIds = [...sel.ellipseIds, ...sel.ellipticalArcIds];
		const sIds = [...sel.splineIds];

		let applied = false;
		let toastMsg = '';

		switch (type) {
			case 'fixed': {
				if (pIds.length >= 1) {
					const appliedNow = this.sketch.toggleFixedConstraints(pIds);
					applied = true;
					toastMsg = appliedNow ? 'Fixed constraint applied' : 'Fixed constraint removed';
				}
				break;
			}
			case 'coincident': {
				if (pIds.length >= 2) {
					applied = this.sketch.addCoincidentConstraints(pIds);
					if (applied) {
						toastMsg = pIds.includes('origin') ? 'Coincident with (0,0) applied' : 'Coincident constraint applied';
					} else {
						showToast('Cannot make these points coincident');
					}
				} else if (
					pIds.length === 1 &&
					lIds.length === 1 &&
					cIds.length === 0 &&
					eIds.length === 0 &&
					sIds.length === 0
				) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const c = this.sketch.addPointOnAxisConstraint(pIds[0], axis);
						if (c) {
							applied = true;
							toastMsg = `Point constrained to ${axis.toUpperCase()}-axis`;
						}
					} else {
						const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
						if (c) {
							applied = true;
							toastMsg = 'Point on line constraint applied';
						} else {
							showToast('Cannot constrain point to this line');
						}
					}
				} else if (
					pIds.length === 1 &&
					cIds.length === 1 &&
					lIds.length === 0 &&
					eIds.length === 0 &&
					sIds.length === 0
				) {
					const c = this.sketch.addPointOnCircleConstraint(pIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on circle constraint applied';
					} else {
						showToast('Cannot constrain point to this circle/arc');
					}
				} else if (
					pIds.length === 1 &&
					eIds.length === 1 &&
					lIds.length === 0 &&
					cIds.length === 0 &&
					sIds.length === 0
				) {
					const c = this.sketch.addPointOnEllipseConstraint(pIds[0], eIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on ellipse constraint applied';
					} else {
						showToast('Cannot constrain point to this ellipse');
					}
				} else if (
					pIds.length === 1 &&
					sIds.length === 1 &&
					lIds.length === 0 &&
					cIds.length === 0 &&
					eIds.length === 0
				) {
					const c = this.sketch.addPointOnSplineConstraint(pIds[0], sIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on spline constraint applied';
					} else {
						showToast('Cannot constrain point to this spline');
					}
				}
				break;
			}
			case 'horizontal_vertical': {
				if (lIds.length === 1) {
					const l = this.sketch.lines.get(lIds[0])!;
					const p1 = this.sketch.points.get(l.p1Id);
					const p2 = this.sketch.points.get(l.p2Id);
					if (p1 && p2) {
						const dir = sub(p2, p1);
						if (Math.abs(dir.x) >= Math.abs(dir.y)) {
							this.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							this.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				} else if (pIds.length === 2) {
					const p1 = this.sketch.points.get(pIds[0]);
					const p2 = this.sketch.points.get(pIds[1]);
					if (p1 && p2) {
						const dir = sub(p2, p1);
						if (Math.abs(dir.x) >= Math.abs(dir.y)) {
							this.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							this.sketch.addVerticalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				}
				break;
			}
			case 'horizontal': {
				if (lIds.length === 1) {
					const l = this.sketch.lines.get(lIds[0])!;
					this.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				} else if (pIds.length === 2) {
					this.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				}
				break;
			}
			case 'vertical': {
				if (lIds.length === 1) {
					const l = this.sketch.lines.get(lIds[0])!;
					this.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				} else if (pIds.length === 2) {
					this.sketch.addVerticalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				}
				break;
			}
			case 'dimension':
			case 'distance': {
				if (lIds.length === 1 && pIds.length === 1) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const existed = this.sketch.hasPointToAxisConstraint(pIds[0], axis);
						const c = this.sketch.addPointToAxisDistanceConstraint(pIds[0], axis);
						applied = true;
						toastMsg = existed
							? `Editing distance to ${axis.toUpperCase()}-axis`
							: `Distance to ${axis.toUpperCase()}-axis applied`;
						if (c && this.onEditDimension) {
							const pt = this.sketch.points.get(pIds[0])!;
							const s = this.viewport.worldToScreen(pt);
							const rect = this.svg.getBoundingClientRect();
							this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
						}
					} else {
						const l = this.sketch.lines.get(lIds[0])!;
						if (pIds[0] !== l.p1Id && pIds[0] !== l.p2Id) {
							const existed = this.sketch.hasPointToLineDistanceConstraint(pIds[0], lIds[0]);
							const c = this.sketch.addPointToLineDistanceConstraint(pIds[0], lIds[0]);
							applied = true;
							toastMsg = existed
								? 'Editing point-to-line distance constraint'
								: 'Point-to-line distance constraint applied';
							if (c && this.onEditDimension) {
								const pt = this.sketch.points.get(pIds[0])!;
								const s = this.viewport.worldToScreen(pt);
								const rect = this.svg.getBoundingClientRect();
								this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
							}
						}
					}
				} else if (lIds.length === 1 && pIds.length === 0) {
					const l = this.sketch.lines.get(lIds[0])!;
					const existed = this.sketch.hasDistanceConstraint(l.p1Id, l.p2Id);
					const c = this.sketch.addDistanceConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
					if (c && this.onEditDimension) {
						const p1 = this.sketch.points.get(l.p1Id);
						const p2 = this.sketch.points.get(l.p2Id);
						const midPoint = p1 && p2 ? mid(p1, p2) : ORIGIN;
						const s = this.viewport.worldToScreen(midPoint);
						const rect = this.svg.getBoundingClientRect();
						this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
					}
				} else if (lIds.length === 2) {
					const existed = this.sketch.hasAngleConstraint(lIds[0], lIds[1]);
					const c = this.sketch.addAngleConstraint(lIds[0], lIds[1]);
					if (c) {
						applied = true;
						toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
						if (this.onEditDimension) {
							const l1 = this.sketch.getLine(lIds[0])!;
							const l2 = this.sketch.getLine(lIds[1])!;
							const p1 = this.sketch.points.get(l1.p1Id)!;
							const p2 = this.sketch.points.get(l1.p2Id)!;
							const p3 = this.sketch.points.get(l2.p1Id)!;
							const p4 = this.sketch.points.get(l2.p2Id)!;
							const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, undefined, lIds[0], lIds[1]);
							const rScreen = Math.max(28, (c.arcRadius ?? 40) * this.viewport.zoom);
							const sCenter = this.viewport.worldToScreen(geom.pInt);
							const sRay1 = this.viewport.worldToScreen({
								x: geom.pInt.x + geom.u1.x * 20,
								y: geom.pInt.y + geom.u1.y * 20,
							});
							const sRay2 = this.viewport.worldToScreen({
								x: geom.pInt.x + geom.u2.x * 20,
								y: geom.pInt.y + geom.u2.y * 20,
							});
							const a1 = angleFromTo(sCenter, sRay1);
							const a2 = angleFromTo(sCenter, sRay2);
							let delta = a2 - a1;
							const TWO_PI = 2 * Math.PI;
							while (delta > Math.PI) delta -= TWO_PI;
							while (delta < -Math.PI) delta += TWO_PI;
							const midAngle = a1 + delta * 0.5;
							const midPoint = vec(sCenter.x + rScreen * Math.cos(midAngle), sCenter.y + rScreen * Math.sin(midAngle));
							const rect = this.svg.getBoundingClientRect();
							this.onEditDimension(c, vec(rect.left + midPoint.x, rect.top + midPoint.y));
						}
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const existed = this.sketch.hasThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]);
					const c = this.sketch.addThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
						if (this.onEditDimension) {
							const p1 = this.sketch.points.get(pIds[0]);
							const p2 = this.sketch.points.get(pIds[1]);
							const p3 = this.sketch.points.get(pIds[2]);
							if (p1 && p2 && p3) {
								const geom = this.sketch.calculateLinesAngleGeometry(p2, p1, p2, p3);
								const rScreen = Math.max(28, (c.arcRadius ?? 40) * this.viewport.zoom);
								const sCenter = this.viewport.worldToScreen(geom.pInt);
								const sRay1 = this.viewport.worldToScreen({
									x: geom.pInt.x + geom.u1.x * 20,
									y: geom.pInt.y + geom.u1.y * 20,
								});
								const sRay2 = this.viewport.worldToScreen({
									x: geom.pInt.x + geom.u2.x * 20,
									y: geom.pInt.y + geom.u2.y * 20,
								});
								const a1 = angleFromTo(sCenter, sRay1);
								const a2 = angleFromTo(sCenter, sRay2);
								let delta = a2 - a1;
								const TWO_PI = 2 * Math.PI;
								while (delta > Math.PI) delta -= TWO_PI;
								while (delta < -Math.PI) delta += TWO_PI;
								const midAngle = a1 + delta * 0.5;
								const midpoint = vec(
									sCenter.x + rScreen * Math.cos(midAngle),
									sCenter.y + rScreen * Math.sin(midAngle)
								);
								const rect = this.svg.getBoundingClientRect();
								this.onEditDimension(c, vec(rect.left + midpoint.x, rect.top + midpoint.y));
							}
						}
					}
				} else if (pIds.length === 2) {
					if (pIds.includes('origin')) {
						const userPtId = pIds[0] === 'origin' ? pIds[1] : pIds[0];
						const existed = this.sketch.hasOriginConstraint(userPtId);
						const c = this.sketch.addOriginDistanceConstraint(userPtId);
						applied = true;
						toastMsg = existed ? 'Editing distance to (0,0)' : 'Distance to (0,0) applied';
						if (c && this.onEditDimension) {
							const pt = this.sketch.points.get(userPtId)!;
							const s = this.viewport.worldToScreen(pt);
							const rect = this.svg.getBoundingClientRect();
							this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
						}
					} else {
						const existed = this.sketch.hasDistanceConstraint(pIds[0], pIds[1]);
						const c = this.sketch.addDistanceConstraint(pIds[0], pIds[1]);
						applied = true;
						toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
						if (c && this.onEditDimension) {
							const p1 = this.sketch.points.get(pIds[0]);
							const p2 = this.sketch.points.get(pIds[1]);
							const midPoint = p1 && p2 ? mid(p1, p2) : ORIGIN;
							const s = this.viewport.worldToScreen(midPoint);
							const rect = this.svg.getBoundingClientRect();
							this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
						}
					}
				} else if (cIds.length === 1) {
					if (!this.sketch.hasRadiusConstraint(cIds[0])) {
						this.setTool('dimension');
						return true;
					}
					const c = this.sketch.addRadiusConstraint(cIds[0]);
					applied = true;
					toastMsg = 'Editing radius constraint';
					if (c && this.onEditDimension) {
						const circ = this.sketch.circles.get(cIds[0]) ?? this.sketch.arcs.get(cIds[0]);
						const center = circ ? this.sketch.points.get(circ.centerId) : null;
						const s = center ? this.viewport.worldToScreen(center) : { x: 100, y: 100 };
						const rect = this.svg.getBoundingClientRect();
						this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
					}
				}
				break;
			}
			case 'equal': {
				if (lIds.length === 2) {
					this.sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Equal length constraint applied';
				} else if (cIds.length === 2) {
					this.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Equal radius constraint applied';
				}
				break;
			}
			case 'parallel': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const line = this.sketch.lines.get(userLineId);
						if (line) {
							if (axis === 'x') {
								this.sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
							} else {
								this.sketch.addVerticalConstraint(line.p1Id, line.p2Id);
							}
							applied = true;
							toastMsg = `Parallel to ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						this.sketch.addParallelConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Parallel constraint applied';
					}
				}
				break;
			}
			case 'collinear': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const c = this.sketch.addLineCollinearWithAxisConstraint(userLineId, axis);
						if (c) {
							applied = true;
							toastMsg = `Collinear with ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						this.sketch.addCollinearConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Collinear constraint applied';
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const c = this.sketch.addThreePointCollinearConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = 'Collinear constraint applied';
					}
				}
				break;
			}
			case 'perpendicular': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const line = this.sketch.lines.get(userLineId);
						if (line) {
							if (axis === 'x') {
								this.sketch.addVerticalConstraint(line.p1Id, line.p2Id);
							} else {
								this.sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
							}
							applied = true;
							toastMsg = `Perpendicular to ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						this.sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Perpendicular constraint applied';
					}
				}
				break;
			}
			case 'tangent': {
				if (lIds.length === 1 && cIds.length === 1) {
					const c = this.sketch.addTangentConstraint(lIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Tangent constraint applied';
					}
				} else if (cIds.length === 2 && lIds.length === 0) {
					const c = this.sketch.addTangentConstraint(cIds[0], cIds[1]);
					if (c) {
						applied = true;
						toastMsg = 'Tangent constraint applied';
					}
				}
				break;
			}
			case 'concentric': {
				if (cIds.length === 2) {
					this.sketch.addConcentricConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Concentric constraint applied';
				}
				break;
			}
			case 'point_on_line': {
				if (pIds.length === 1 && lIds.length === 1) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const c = this.sketch.addPointOnAxisConstraint(pIds[0], axis);
						if (c) {
							applied = true;
							toastMsg = `Point constrained to ${axis.toUpperCase()}-axis`;
						}
					} else {
						const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
						if (c) {
							applied = true;
							toastMsg = 'Point on line constraint applied';
						} else {
							showToast('Cannot constrain point to this line');
						}
					}
				}
				break;
			}
			case 'midpoint': {
				if (pIds.length === 1 && lIds.length === 1) {
					const c = this.sketch.addMidpointConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Midpoint constraint applied';
					} else {
						showToast('Cannot constrain midpoint to this line');
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const c = this.sketch.addThreePointMidpointConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = 'Midpoint constraint applied';
					}
				}
				break;
			}
			case 'symmetry': {
				if (pIds.length === 2 && lIds.length === 1) {
					const c = this.sketch.addSymmetryConstraint(pIds[0], pIds[1], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Symmetry constraint applied';
					} else {
						showToast('Cannot apply symmetry to these entities');
					}
				} else if (pIds.length === 3 && pIds.includes('origin') && lIds.length === 0) {
					const userPts = pIds.filter(id => id !== 'origin');
					const c = this.sketch.addSymmetryConstraint(userPts[0], userPts[1], 'origin');
					if (c) {
						applied = true;
						toastMsg = 'Symmetry constraint applied';
					}
				} else if (cIds.length === 2 && (lIds.length === 1 || (pIds.length === 1 && pIds[0] === 'origin'))) {
					const symAxisId = lIds.length === 1 ? lIds[0] : 'origin';
					const c1 = this.sketch.circles.get(cIds[0]) ?? this.sketch.arcs.get(cIds[0]);
					const c2 = this.sketch.circles.get(cIds[1]) ?? this.sketch.arcs.get(cIds[1]);
					if (c1 && c2) {
						this.sketch.beginTransaction();
						this.sketch.addSymmetryConstraint(c1.centerId, c2.centerId, symAxisId);
						this.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
						this.sketch.commitTransaction();
						applied = true;
						toastMsg = 'Symmetry & equal radius applied';
					}
				} else if (lIds.length === 3) {
					const builtinAxisIdx = lIds.findIndex(id => id === 'axis_x' || id === 'axis_y');
					const constrIdx = lIds.findIndex(id => this.sketch.lines.get(id)?.isConstruction);
					const axisId = builtinAxisIdx !== -1 ? lIds[builtinAxisIdx] : constrIdx !== -1 ? lIds[constrIdx] : lIds[2];
					const otherLines = lIds.filter(id => id !== axisId);
					if (otherLines.length === 2) {
						const created = this.sketch.addLineSymmetryConstraints(otherLines[0], otherLines[1], axisId);
						if (created.length > 0) {
							applied = true;
							toastMsg = 'Line symmetry constraints applied';
						}
					}
				} else if (lIds.length === 2 && pIds.length === 1 && pIds[0] === 'origin') {
					const created = this.sketch.addLineSymmetryConstraints(lIds[0], lIds[1], 'origin');
					if (created.length > 0) {
						applied = true;
						toastMsg = 'Line symmetry constraints applied';
					}
				}
				break;
			}
		}

		if (applied) {
			if (toastMsg) showToast(toastMsg);
			this.sketch.solve();
			this.render();
		}

		return applied;
	}

	private finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void {
		const minScreen = vec(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
		const maxScreen = vec(Math.max(s1.x, s2.x), Math.max(s1.y, s2.y));

		const w1 = this.viewport.screenToWorld(minScreen);
		const w2 = this.viewport.screenToWorld(maxScreen);

		const bounds = AABB.fromPoints([w1, w2])!;
		const { min, max } = bounds;
		const crossing = s2.x < s1.x;
		const matches = (entity: {
			intersectsAABB(min: Vec2, max: Vec2, sketch: SketchDocument): boolean;
			toGeoCurve(sketch: SketchDocument): Exclude<GeoCurve, { type: 'spline' }> | null;
		}): boolean => {
			if (crossing) return entity.intersectsAABB(min, max, this.sketch);
			const curve = entity.toGeoCurve(this.sketch);
			return curve !== null && curveContainedInAABB(curve, min, max);
		};

		const itemsToSelect: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint';
		}> = [];

		// 1. Points
		for (const pt of this.sketch.points.values()) {
			if (pt.intersectsAABB(min, max, this.sketch)) {
				itemsToSelect.push({ id: pt.id, type: 'point' });
			}
		}

		// 2. Lines
		for (const line of this.sketch.lines.values()) {
			if (matches(line)) {
				itemsToSelect.push({ id: line.id, type: 'line' });
			}
		}

		// 3. Circles
		for (const circle of this.sketch.circles.values()) {
			if (matches(circle)) {
				itemsToSelect.push({ id: circle.id, type: 'circle' });
			}
		}

		// 4. Arcs
		for (const arc of this.sketch.arcs.values()) {
			if (matches(arc)) {
				itemsToSelect.push({ id: arc.id, type: 'arc' });
			}
		}

		// 5. Ellipses
		for (const ellipse of this.sketch.ellipses.values()) {
			if (matches(ellipse)) {
				itemsToSelect.push({ id: ellipse.id, type: 'ellipse' });
			}
		}

		// 6. Elliptical Arcs
		for (const elArc of this.sketch.ellipticalArcs.values()) {
			if (matches(elArc)) {
				itemsToSelect.push({ id: elArc.id, type: 'elliptical_arc' });
			}
		}

		if (this.activeTool === 'mirror') {
			(this.tools.get('mirror') as MirrorTool)?.handleBoxSelect(itemsToSelect);
			return;
		}

		if (this.activeTool === 'circular_pattern') {
			(this.tools.get('circular_pattern') as CircularPatternTool)?.handleBoxSelect(itemsToSelect);
			return;
		}

		if (this.activeTool === 'rectangular_pattern') {
			(this.tools.get('rectangular_pattern') as RectangularPatternTool)?.handleBoxSelect(itemsToSelect);
			return;
		}

		this.sketch.selectEntities(itemsToSelect, shiftKey);
	}
}

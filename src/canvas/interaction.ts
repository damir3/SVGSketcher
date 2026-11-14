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
import { ORIGIN, Vec2 } from '../math/vector';
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
	RectangularPatternConstraint,
	computeRectangularPatternDirections,
} from '../solver/constraints';
import type {
	ISketchPrimitive,
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
import { calculateObjectsCentroid } from './tools/modify/utils';
import { ImageTool } from './tools/modify/image';
import { TransformTool } from './tools/modify/transform';
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

const TOOL_KEY_SHORTCUTS: Readonly<Record<string, ToolType>> = {
	KeyV: 'select',
	KeyL: 'line',
	KeyR: 'rectangle',
	KeyG: 'polygon',
	KeyP: 'point',
	KeyC: 'circle',
	KeyA: 'arc',
	KeyE: 'ellipse',
	KeyS: 'slot',
	KeyT: 'trim',
	KeyB: 'break',
	KeyM: 'mirror',
	KeyO: 'offset',
	KeyH: 'horizontal_vertical',
	KeyD: 'dimension',
	KeyI: 'coincident',
	KeyF: 'fixed',
};

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

	// Dragging curve primitive state (line, circle, arc, ellipse, elliptical_arc, spline)
	private curveDragState: {
		primitive: ISketchPrimitive;
		startWorld: Vec2;
		initialPoints: Map<string, Vec2>;
	} | null = null;

	// Dragging constraint state
	private isDraggingConstraint = false;
	private draggedConstraintId: string | null = null;
	private dragConstraintStartScreen: Vec2 | null = null;

	// Box selection state
	private isBoxSelecting = false;
	private boxSelectStartScreen: Vec2 | null = null;
	private boxSelectCurrentScreen: Vec2 | null = null;
	private boxSelectShift = false;
	private boxSelectImageId: string | null = null;
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
			| OffsetConstraint,
		screenPos: Vec2
	) => void;
	onToolChange?: (tool: ToolType) => void;
	onReplaceImage?: (id: string) => void;
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
		if (
			this.activeTool === 'fillet' ||
			this.activeTool === 'chamfer' ||
			(this.selectedImageId && !this.sketch.images.has(this.selectedImageId))
		) {
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
		this.tools.set('transform', new TransformTool());
		this.tools.set('image', new ImageTool(id => this.onReplaceImage?.(id)));
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
			client: new Vec2(e.clientX, e.clientY),
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

	get selectedImageId(): string | null {
		return this.activeToolInstance instanceof ImageTool ? this.activeToolInstance.imageId : null;
	}

	selectImage(id: string): void {
		const tool = this.tools.get('image');
		if (!(tool instanceof ImageTool) || !this.sketch.images.has(id)) return;
		this.sketch.clearSelection();
		tool.imageId = id;
		this.setTool('image');
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

		this.curveDragState = null;

		this.isDraggingConstraint = false;
		this.draggedConstraintId = null;
		this.dragConstraintStartScreen = null;

		this.preDragSnapshot = null;
		this.hasDragged = false;
		this.svg.classList.remove('is-dragging');

		this.isBoxSelecting = false;
		this.boxSelectStartScreen = null;
		this.boxSelectCurrentScreen = null;
		this.boxSelectShift = false;
		this.boxSelectImageId = null;
		this.pendingExclusiveSelection = null;

		this.renderer.deferRegionSolve = false;
		this.renderer.clearPreviews();
	}

	private get isDraggingPrimitive(): boolean {
		return this.isDraggingPoint || this.curveDragState !== null;
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
		if (this.activeToolInstance?.popup?.isOpen()) {
			this.activeToolInstance.updatePopupPosition?.();
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

		const startPan = new Vec2(this.viewport.panX, this.viewport.panY);
		const startZoom = this.viewport.zoom;

		const dPan = new Vec2(Math.abs(startPan.x - targetPanX), Math.abs(startPan.y - targetPanY));
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
			if (this.isDraggingPrimitive) this.handleMouseUp();
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
						this.activeTool === 'polygon' ||
						this.activeTool === 'arc' ||
						this.activeTool === 'ellipse' ||
						this.activeTool === 'line' ||
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
				if (this.selectedImageId) {
					this.sketch.removeImage(this.selectedImageId);
					this.setTool('select');
					return;
				}
				this.sketch.deleteSelected();
				this.render();
				return;
			case 'KeyX':
				this.toggleConstructionMode();
				return;
			default: {
				const shortcutTool = TOOL_KEY_SHORTCUTS[e.code];
				if (shortcutTool) {
					this.setTool(shortcutTool);
				}
				return;
			}
		}
	}

	private getScreenPos(e: MouseEvent): Vec2 {
		const rect = this.svg.getBoundingClientRect();
		return new Vec2(e.clientX - rect.left, e.clientY - rect.top);
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
			const d = screenPos.distanceTo(s);
			if (d < closestPointDist) {
				closestPointDist = d;
				foundPoint = { id: pt.id, worldPos: pt.clone(), screenPos: s };
			}
		}

		if (excludePointId !== 'origin') {
			const sOrigin = this.viewport.worldToScreen(ORIGIN);
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

		for (const prim of this.sketch.getCurvePrimitives()) {
			if (prim.type === 'spline') {
				if (excludedSplineIds.has(prim.id)) continue;
			} else if (excludePointId && prim.getPointIds().includes(excludePointId)) {
				continue;
			}
			if (prim.type === 'line') {
				const line = prim as SketchLine;
				if (excludedHandleLineIds.has(line.id)) continue;
				if (line.isSplineHandle) {
					const parentSpline = line.parentSplineId ? this.sketch.splines.get(line.parentSplineId) : undefined;
					const isParentSelected = parentSpline && selectedSplineIds.has(parentSpline.id);
					if (!isParentSelected && !this.sketch.selection.lineIds.has(line.id) && !isConstraintTool(this.activeTool)) {
						continue;
					}
				}
			}

			const snap = prim.snapTo(screenPos, this.sketch, this.viewport, closestGeomDist, geomSnapDistPx);
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
		const nearestWorld = new Vec2(
			this.cleanGridCoordinate(Math.round(world.x / gridStep) * gridStep, gridStep),
			this.cleanGridCoordinate(Math.round(world.y / gridStep) * gridStep, gridStep)
		);
		const nearestScreen = this.viewport.worldToScreen(nearestWorld);

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

		const dir = new Vec2().subVectors(p2, p1);
		if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) return;

		const angleDeg = dir.angleToXAxisDeg();

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

		const dir = new Vec2().subVectors(targetPos, startPos);
		if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
			return { pos: targetPos, axis: null };
		}

		const angleDeg = dir.angleToXAxisDeg();

		if (angleDeg < 1.0) {
			return {
				pos: new Vec2(targetPos.x, startPos.y),
				axis: 'horizontal',
			};
		}

		if (90 - angleDeg < 1.0) {
			return {
				pos: new Vec2(startPos.x, targetPos.y),
				axis: 'vertical',
			};
		}

		return { pos: targetPos, axis: null };
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
			const dOrigin = sOrigin.distanceTo(screen);
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

	private findClosest<
		T extends {
			distanceTo?(screen: Vec2, sketch: SketchDocument, viewport: Viewport, thresholdPx?: number): number | null;
		},
	>(items: Iterable<T>, screen: Vec2, thresholdPx: number): T | null {
		let closestDist = thresholdPx;
		let found: T | null = null;
		for (const item of items) {
			if (!item.distanceTo) continue;
			const d = item.distanceTo(screen, this.sketch, this.viewport, closestDist);
			if (d !== null && d < closestDist) {
				closestDist = d;
				found = item;
			}
		}
		return found;
	}

	findCircleNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchCircle | null {
		return this.findClosest(this.sketch.circles.values(), screen, thresholdPx);
	}

	findArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchArc | null {
		return this.findClosest(this.sketch.arcs.values(), screen, thresholdPx);
	}

	findConstraintNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): IConstraint | null {
		return this.findClosest(this.sketch.constraints.values(), screen, thresholdPx);
	}

	findEllipseNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipse | null {
		return this.findClosest(this.sketch.ellipses.values(), screen, thresholdPx);
	}

	findEllipticalArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipticalArc | null {
		return this.findClosest(this.sketch.ellipticalArcs.values(), screen, thresholdPx);
	}

	findSplineNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchSpline | null {
		return this.findClosest(this.sketch.splines.values(), screen, thresholdPx);
	}

	private findSelectableEntityNear(
		screen: Vec2,
		target: SVGElement
	): {
		id: string;
		type: 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'text' | 'constraint';
	} | null {
		const hitConstraint = this.activeTool === 'select' ? this.findConstraintNear(screen) : null;
		if (hitConstraint && !hitConstraint.isInternalConstraint?.(this.sketch)) {
			return { id: hitConstraint.id, type: 'constraint' };
		}
		const hitLine = this.findLineNear(screen);
		if (hitLine) return { id: hitLine.id, type: 'line' };
		const hitCircle = this.findCircleNear(screen);
		if (hitCircle) return { id: hitCircle.id, type: 'circle' };
		const hitArc = this.findArcNear(screen);
		if (hitArc) return { id: hitArc.id, type: 'arc' };
		const hitEllipse = this.findEllipseNear(screen);
		if (hitEllipse) return { id: hitEllipse.id, type: 'ellipse' };
		const hitEllipticalArc = this.findEllipticalArcNear(screen, LINE_DISTANCE_PX);
		if (hitEllipticalArc) return { id: hitEllipticalArc.id, type: 'elliptical_arc' };
		const hitSpline = this.findSplineNear(screen);
		if (hitSpline) return { id: hitSpline.id, type: 'spline' };
		const hitText = this.findTextNear(screen, target);
		if (hitText) return { id: hitText.id, type: 'text' };

		const sOrigin = this.viewport.worldToScreen(ORIGIN);
		if (Math.abs(screen.y - sOrigin.y) <= LINE_DISTANCE_PX) {
			return { id: 'axis_x', type: 'line' };
		}
		if (Math.abs(screen.x - sOrigin.x) <= LINE_DISTANCE_PX) {
			return { id: 'axis_y', type: 'line' };
		}
		return null;
	}

	findTrimTargetNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): GeoCurve | null {
		let bestDist = thresholdPx;
		let bestCurve: GeoCurve | null = null;

		for (const prim of this.sketch.getCurvePrimitives()) {
			if (prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
			const d = prim.distanceTo(screen, this.sketch, this.viewport, bestDist);
			if (d !== null && d < bestDist) {
				bestDist = d;
				bestCurve = prim.toGeoCurve(this.sketch);
			}
		}

		return bestCurve;
	}

	private handleMouseDown(e: MouseEvent): void {
		this.cancelAnimation();
		this.highlightManager.clear();
		this.isSnapModifierPressed = this.isSnapModifier(e);
		const screen = this.getScreenPos(e);
		const clientPos = new Vec2(e.clientX, e.clientY);
		this.lastMouseScreen = screen;

		// Pan with Middle Click (1), Right Click (2), Pan Tool, or Space/Alt Key
		if (e.button === 1 || e.button === 2 || this.activeTool === 'pan' || this.isSpacePressed || e.altKey) {
			this.isPanning = true;
			this.svg.style.cursor = 'grabbing';
			return;
		}

		if (e.button !== 0) return; // Only primary button for drawing/selection

		const imageId =
			this.activeTool === 'select' || this.activeTool === 'image'
				? (e.target as SVGElement | null)?.closest('[data-image-id]')?.getAttribute('data-image-id')
				: null;

		// Robust double-click detection (works even when DOM nodes are re-rendered)
		const now = performance.now();
		const timeDelta = now - this.lastClickTime;
		const distanceDelta = screen.distanceTo(this.lastClickPos);

		if (this.activeTool === 'select' && !imageId && timeDelta >= 50 && timeDelta <= 400 && distanceDelta < 30) {
			this.lastClickTime = 0;
			if (this.tryHandleDoubleClickAt(e, screen, clientPos, now)) {
				return;
			}
		} else {
			this.lastClickTime = now;
			this.lastClickPos = screen;
		}

		// Delegate to active tool if not select
		if (this.activeTool !== 'select' && this.activeToolInstance?.onMouseDown) {
			const focusDocument = this.svg.ownerDocument;
			const previousFocus = focusDocument?.activeElement;
			const toolEvent = this.createToolMouseEvent(e);
			const handled = this.activeToolInstance.onMouseDown(toolEvent);
			if (handled !== false) {
				this.updateToolPreview();
				// Keep the focus a tool popup took during this canvas click.
				const focus = focusDocument?.activeElement;
				if (focus !== previousFocus && focus?.closest?.('.tool-popup')) e.preventDefault();
				return;
			}
		}

		if (this.activeTool === 'select' || this.activeTool === 'image') {
			if (imageId && this.sketch.images.has(imageId)) {
				this.beginBoxSelection(screen, e.shiftKey, imageId);
				return;
			}
			if (this.activeTool === 'image') this.setTool('select');
		}

		const world = this.viewport.screenToWorld(screen);
		const snap = this.findSnap(screen);

		// Check for Text rotation gizmo handle dragging
		const textGizmo = this.renderer.textRotationGizmo;
		if (textGizmo && screen.distanceTo(textGizmo.handleScreen) <= 15) {
			this.textRotationDragState = {
				textId: textGizmo.textId,
				centerWorld: textGizmo.centerWorld,
			};
			this.sketch.beginTransaction();
			return;
		}

		// Check for Text center drag gizmo handle dragging
		const textDragGizmo = this.renderer.textDragGizmo;
		if (textDragGizmo && screen.distanceTo(textDragGizmo.centerScreen) <= 15) {
			const text = this.sketch.texts.get(textDragGizmo.textId);
			const initialPoints = new Map<string, Vec2>();
			if (text?.rectanglePointIds) {
				for (const pid of text.rectanglePointIds) {
					const pt = this.sketch.points.get(pid);
					if (pt) initialPoints.set(pid, pt.clone());
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
			if (screen.distanceTo(handle) <= GIZMO_DISTANCE_PX) {
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

		if (this.activeTool === 'select') {
			// Check if clicking on a circular or rectangular pattern suppression checkbox on canvas
			for (const entry of this.renderer.patternCheckboxPositions.values()) {
				if (
					entry.constraintId &&
					Math.abs(screen.x - entry.x) <= LABEL_DISTANCE_PX &&
					Math.abs(screen.y - entry.y) <= LABEL_DISTANCE_PX
				) {
					const c = this.sketch.constraints.get(entry.constraintId);
					if (c?.toggleSuppressedCopy?.(this.sketch, entry.copyIndex)) {
						this.render();
						return;
					}
				}
			}
		}

		if (this.activeTool === 'select' || this.activeTool === 'transform') {
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
					const fallback = this.findSelectableEntityNear(screen, target);
					if (fallback) {
						id = fallback.id;
						type = fallback.type;
					}
				}
			}

			// A visible primitive can be the raw SVG target even when the pointer is
			// within the wider tolerance of a nearby dimension line.
			if (this.activeTool === 'select' && type && type !== 'constraint' && type !== 'point') {
				const hitConstraint = this.findConstraintNear(screen);
				if (hitConstraint && !hitConstraint.isInternalConstraint?.(this.sketch)) {
					id = hitConstraint.id;
					type = 'constraint';
				}
			}

			if (this.activeTool === 'transform' && type === 'constraint') return;
			if (id && type) {
				const isToggle = this.activeTool === 'transform' || e.metaKey || e.ctrlKey;
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
						this.dragPointStartWorld = pt.clone();
					}
				} else if (
					type === 'line' ||
					type === 'circle' ||
					type === 'arc' ||
					type === 'ellipse' ||
					type === 'elliptical_arc' ||
					type === 'spline'
				) {
					const prim = this.sketch.getPrimitive(id, type);
					if (prim) {
						const pointIds = prim.getPointIds(this.sketch);
						const initialPoints = new Map<string, Vec2>();
						for (const pid of pointIds) {
							const pt = this.sketch.points.get(pid);
							if (pt) initialPoints.set(pid, pt.clone());
						}
						if (type === 'spline' || initialPoints.size === pointIds.length) {
							this.curveDragState = {
								primitive: prim,
								startWorld: world,
								initialPoints,
							};
							this.preDragSnapshot = this.sketch.takeSnapshot();
							this.hasDragged = false;
						}
					}
				} else if (type === 'constraint') {
					const constraint = this.sketch.constraints.get(id);
					if (constraint?.moveLabelTo) {
						this.isDraggingConstraint = true;
						this.draggedConstraintId = id;
						this.preDragSnapshot = this.sketch.takeSnapshot();
						this.hasDragged = false;
						this.dragConstraintStartScreen = screen;
					}
				}

				this.renderer.deferRegionSolve = this.isDraggingPrimitive;
				this.svg.classList.add('is-dragging');
				this.render();
			} else {
				// Clicked background -> start rectangular box selection
				this.beginBoxSelection(screen, e.shiftKey);
				if (this.activeTool === 'select' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
					this.sketch.clearSelection();
					this.render();
				}
			}
			return;
		}
	}

	private beginBoxSelection(screen: Vec2, shiftKey: boolean, imageId: string | null = null): void {
		this.isBoxSelecting = true;
		this.boxSelectStartScreen = screen;
		this.boxSelectCurrentScreen = screen;
		this.boxSelectShift = shiftKey;
		this.boxSelectImageId = imageId;
	}

	private handleMouseMove(e: MouseEvent): void {
		this.isSnapModifierPressed = this.isSnapModifier(e);
		const screen = this.getScreenPos(e);
		const world = this.viewport.screenToWorld(screen);

		// Pan handling
		if (this.isPanning) {
			this.regionHoverPoint = null;
			this.renderer.updateRegionHover(null);
			const dir = new Vec2().subVectors(screen, this.lastMouseScreen);
			this.viewport.pan(dir.x, dir.y);
			this.lastMouseScreen = screen;
			this.render();
			return;
		}

		this.lastMouseScreen = screen;

		// Gizmo drag handling (Rectangular pattern distance1 / distance2 in select mode)
		if (this.gizmoDragState) {
			const { axis, centroidWorld, u, startMouseWorld, startDistance, constraintId } = this.gizmoDragState;
			const startProj = new Vec2().subVectors(startMouseWorld, centroidWorld).dot(u);
			const currentProj = new Vec2().subVectors(world, centroidWorld).dot(u);
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
				const mouseAngle = c.angleToPoint(world);
				const targetAngle = mouseAngle - Math.PI / 2;

				const corners = text.getRectangleCorners(this.sketch);
				if (corners) {
					const [p0, p1, p2, p3] = corners;
					const currentAngle = p0.angleToPoint(p1);
					const deltaAngle = targetAngle - currentAngle;

					const pt0 = this.sketch.points.get(text.rectanglePointIds[0]);
					const pt1 = this.sketch.points.get(text.rectanglePointIds[1]);
					const pt2 = this.sketch.points.get(text.rectanglePointIds[2]);
					const pt3 = this.sketch.points.get(text.rectanglePointIds[3]);

					if (pt0 && pt1 && pt2 && pt3) {
						const np0 = p0.clone().rotateAround(c, deltaAngle);
						const np1 = p1.clone().rotateAround(c, deltaAngle);
						const np2 = p2.clone().rotateAround(c, deltaAngle);
						const np3 = p3.clone().rotateAround(c, deltaAngle);

						pt0.copy(np0);
						pt1.copy(np1);
						pt2.copy(np2);
						pt3.copy(np3);

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
			const dir = new Vec2().subVectors(world, this.textDragState.startWorld);
			for (const [pid, initPos] of this.textDragState.initialPoints) {
				const pt = this.sketch.points.get(pid);
				if (pt) {
					pt.addVectors(initPos, dir);
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

		// Constraint label dragging
		if (this.isDraggingConstraint && this.draggedConstraintId) {
			if (this.dragConstraintStartScreen && screen.distanceTo(this.dragConstraintStartScreen) > 3) {
				this.hasDragged = true;
			}
			if (this.hasDragged) {
				const constraint = this.sketch.constraints.get(this.draggedConstraintId);
				if (constraint?.moveLabelTo) {
					constraint.moveLabelTo(screen, this.sketch, this.viewport);
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
			if (snap && targetWorld.equals(snap.worldPos)) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, true);
			} else {
				this.renderer.clearPreviews();
			}
			return;
		}

		// Drag curve primitive handling
		if (this.curveDragState) {
			this.hasDragged = true;
			const { primitive, startWorld, initialPoints } = this.curveDragState;
			primitive.drag(this.sketch, startWorld, world, initialPoints, e);
			this.render();
			return;
		}

		if (
			(this.activeToolInstance instanceof TransformTool || this.activeToolInstance instanceof ImageTool) &&
			this.activeToolInstance.isBusy()
		) {
			this.activeToolInstance.onMouseMove(this.createToolMouseEvent(e));
			this.updateToolPreview();
			return;
		}

		// If mouse is outside the canvas SVG (e.g. over modals, dialogs, header, toolbar, sidebar),
		// clear hover highlights and tool previews, and do not process hover under overlays.
		const isOverCanvas = e.target === this.svg || (e.target instanceof Node && this.svg.contains(e.target));
		if (!isOverCanvas) {
			this.regionHoverPoint = null;
			this.renderer.updateRegionHover(null);
			this.highlightManager.clear();
			if (this.activeTool !== 'transform' && this.activeTool !== 'image') this.renderer.clearPreviews();
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
		const primitiveMoved = this.isDraggingPrimitive && this.hasDragged;
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
					if (snap && target && (this.sketch.isSplineHandlePoint(draggedPtId) || !target.equals(snap.worldPos))) {
						this.sketch.dragPoint(draggedPtId, target.x, target.y);
					} else if (snap && snap.id && (snap.type !== 'point' || snap.id !== draggedPtId)) {
						const pt = this.sketch.getPoint(draggedPtId);
						if (pt) {
							pt.copy(snap.worldPos);
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
							pt.copy(snap.worldPos);
						}
					}
				}
				// Final solve without soft drag constraint to ensure exact convergence
				this.sketch.solve();
				if (this.preDragSnapshot) {
					this.sketch.pushSnapshot(this.preDragSnapshot);
				}
			}
			this.preDragSnapshot = null;
			this.hasDragged = false;
			this.updateCursor();
		}
		if (this.curveDragState) {
			this.curveDragState = null;
			this.renderer.clearPreviews();
			if (this.hasDragged) {
				this.sketch.solve();
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
			const imageId = this.boxSelectImageId;

			this.isBoxSelecting = false;
			this.boxSelectStartScreen = null;
			this.boxSelectCurrentScreen = null;
			this.boxSelectShift = false;
			this.boxSelectImageId = null;
			this.renderer.clearPreviews();

			if (startScreen && endScreen && startScreen.distanceTo(endScreen) > 4) {
				if (this.activeTool === 'image') this.setTool('select');
				this.finishBoxSelection(startScreen, endScreen, isShift);
			} else if (imageId && imageId !== this.selectedImageId) {
				this.selectImage(imageId);
			}
			this.render();
		}

		if (!this.hasDragged && this.pendingExclusiveSelection) {
			this.sketch.selectEntity(this.pendingExclusiveSelection.id, this.pendingExclusiveSelection.type, false);
			this.render();
		}
		this.pendingExclusiveSelection = null;
		this.renderer.deferRegionSolve = false;
		if (primitiveMoved) this.render();
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
			if (constraint?.moveLabelTo && this.onEditDimension) {
				this.sketch.selectEntity(constraint.id, 'constraint', false);
				this.render();
				this.onEditDimension(constraint as any, clientPos);
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

	private tryHandleDoubleClickAt(e: MouseEvent, screen: Vec2, clientPos: Vec2, now: number): boolean {
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
			return true;
		}

		if (this.triggerDimensionEditAt(e, screen, clientPos)) {
			e.preventDefault();
			e.stopPropagation();
			this.lastDoubleClickedTime = now;
			if (this.activeTool === 'select') this.cancelDrawing();
			return true;
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
		const clientPos = new Vec2(e.clientX, e.clientY);
		this.tryHandleDoubleClickAt(e, screen, clientPos, now);
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
		ConstraintTool.pruneIncompatibleSelection(this.sketch, type);
	}

	canApplyConstraint(type: string): boolean {
		return ConstraintTool.canApplyConstraint(this.sketch, type);
	}

	applyConstraint(type: string): boolean {
		return ConstraintTool.applyConstraintToSelection(type, {
			sketch: this.sketch,
			viewport: this.viewport,
			svg: this.svg,
			onEditDimension: this.onEditDimension,
			setTool: (tool: ToolType) => this.setTool(tool),
			requestRender: () => this.render(),
			showToast,
		});
	}

	private finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void {
		const w1 = this.viewport.screenToWorld(s1);
		const w2 = this.viewport.screenToWorld(s2);

		const bounds = AABB.fromPoints([w1, w2])!;
		const { min, max } = bounds;
		const crossing = s2.x < s1.x;
		const matches = (entity: {
			intersectsAABB(min: Vec2, max: Vec2, sketch: SketchDocument): boolean;
			toGeoCurve(sketch: SketchDocument): GeoCurve | null;
		}): boolean => {
			if (crossing) return entity.intersectsAABB(min, max, this.sketch);
			const curve = entity.toGeoCurve(this.sketch);
			return curve !== null && curveContainedInAABB(curve, min, max);
		};

		const itemsToSelect: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
		}> = [];

		const tool = this.activeToolInstance ?? this.tools?.get(this.activeTool);
		const hasToolBoxSelect =
			Boolean(tool?.handleBoxSelect) ||
			this.activeTool === 'mirror' ||
			this.activeTool === 'circular_pattern' ||
			this.activeTool === 'rectangular_pattern';

		// 1. Points
		for (const pt of this.sketch.points.values()) {
			if (hasToolBoxSelect && this.sketch.isSplineHandlePoint(pt.id)) continue;
			if (pt.intersectsAABB(min, max, this.sketch)) {
				itemsToSelect.push({ id: pt.id, type: 'point' });
			}
		}

		// 2. Curves
		for (const prim of this.sketch.getCurvePrimitives()) {
			if (hasToolBoxSelect && prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
			if (matches(prim)) {
				itemsToSelect.push({ id: prim.id, type: prim.type });
			}
		}

		if (tool?.handleBoxSelect) {
			tool.handleBoxSelect(itemsToSelect);
			return;
		}

		this.sketch.selectEntities(itemsToSelect, this.activeTool === 'transform' ? 'toggle' : shiftKey);
	}
}

import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import { DEFAULT_ZOOM } from '../constants';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import { LINE_DISTANCE_PX, POINT_DISTANCE_PX } from './distances';
import { ORIGIN, Vec2 } from '../math/vector';
import type { IConstraint } from '../solver/types';
import type {
	DistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
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
import { ImageTool } from './tools/modify/image';
import { TransformTool } from './tools/modify/transform';
import { HighlightManager } from './highlightManager';
import { applyAutoOrientation, applySnapConstraint, computeAxisSnappedWorldPos, findSnapTarget } from './snapping';
import {
	findArcNear,
	findCircleNear,
	findConstraintNear,
	findEllipseNear,
	findEllipticalArcNear,
	findLineNear,
	findPointNear,
	findSplineNear,
	findTextNear,
	findTrimTargetNear,
} from './hitTesting';

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
	type SelectInteractionHost,
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

function isEditableElement(el: HTMLElement | null | undefined): boolean {
	if (!el) return false;
	return Boolean(
		(typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) ||
			(typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) ||
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable
	);
}

export class CanvasInteraction implements SelectInteractionHost {
	svg: SVGSVGElement;
	sketch: SketchDocument;
	viewport: Viewport;
	renderer: SVGRenderer;
	readonly highlightManager: HighlightManager;

	activeTool: ToolType = 'select';
	isConstructionMode = false;

	// Dragging point state
	isDraggingPoint = false;
	draggedPointId: string | null = null;
	dragPointStartWorld: Vec2 | null = null;

	// Dragging curve primitive state (line, circle, arc, ellipse, elliptical_arc, spline)
	curveDragState: {
		primitive: ISketchPrimitive;
		startWorld: Vec2;
		initialPoints: Map<string, Vec2>;
	} | null = null;

	// Dragging constraint state
	isDraggingConstraint = false;
	draggedConstraintId: string | null = null;
	dragConstraintStartScreen: Vec2 | null = null;

	// Box selection state
	isBoxSelecting = false;
	boxSelectStartScreen: Vec2 | null = null;
	boxSelectCurrentScreen: Vec2 | null = null;
	boxSelectShift = false;
	boxSelectImageId: string | null = null;
	pendingExclusiveSelection: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'text' | 'constraint';
	} | null = null;

	// Dragging history snapshot
	preDragSnapshot: SketchSnapshot | null = null;
	hasDragged = false;

	// Viewport panning state
	private isPanning = false;
	private isSpacePressed = false;
	private readonly isMac =
		typeof navigator !== 'undefined' &&
		((navigator as any).userAgentData?.platform === 'macOS' ||
			/Mac|iPod|iPhone|iPad/.test(navigator.platform) ||
			/Macintosh/.test(navigator.userAgent));
	private isSnapModifierPressed = false;
	lastMouseScreen: Vec2 = ORIGIN;
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
	textRotationDragState: { textId: string; centerWorld: Vec2 } | null = null;
	textDragState: { textId: string; startWorld: Vec2; initialPoints: Map<string, Vec2> } | null = null;

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
		return this.activeTool === 'spline' && Boolean(this.activeToolInstance?.isBusy?.());
	}

	canUndoSplinePoint(): boolean {
		return this.activeToolInstance?.canUndoPoint?.() ?? false;
	}

	canRedoSplinePoint(): boolean {
		return this.activeToolInstance?.canRedoPoint?.() ?? false;
	}

	undoSplinePoint(): boolean {
		return this.activeToolInstance?.undoPoint?.() ?? false;
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
		return this.activeToolInstance?.redoPoint?.() ?? false;
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

	private computeToolSnap(screen: Vec2): SnapResult | null {
		const snapMode = this.activeToolInstance?.shouldSnap ? this.activeToolInstance.shouldSnap() : true;
		if (snapMode === false) return null;
		return this.findSnap(screen, undefined, snapMode !== 'no-grid');
	}

	createToolMouseEvent(e: MouseEvent): ToolMouseEvent {
		const screen = this.getScreenPos(e);
		const world = this.viewport.screenToWorld(screen);
		const snap = this.computeToolSnap(screen);
		return {
			raw: e,
			screen,
			client: new Vec2(e.clientX, e.clientY),
			world,
			snap,
			effectiveWorld: snap ? snap.worldPos : world,
			effectiveScreen: snap ? snap.screenPos : screen,
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
			const snap = isDrawingPrimitiveTool(this.activeTool) ? this.computeToolSnap(screen) : null;
			if (snap) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, false);
			}
			this.activeToolInstance.renderPreview?.(this.createToolRenderContext(screen, world, snap));
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
		SelectTool.resetDragState(this);
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

	cancelAnimation(): void {
		this.viewport?.cancelAnimation?.();
	}

	animateViewportTo(targetPanX: number, targetPanY: number, targetZoom: number, duration = 700): void {
		this.viewport.animateTo(targetPanX, targetPanY, targetZoom, duration, () => {
			this.render();
			this.onViewportChange?.();
		});
	}

	fitToView(smooth = true): void {
		const bbox = this.sketch.getSelectionBoundingBox() ?? this.sketch.getBoundingBox();
		const target = bbox
			? this.viewport.getTargetFit(bbox)
			: {
					panX: this.viewport.width / 2,
					panY: this.viewport.height / 2,
					zoom: DEFAULT_ZOOM,
				};

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
		const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		if (isEditableElement(e.target as HTMLElement | null) || isEditableElement(activeEl)) {
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
				if (tool?.onKeyDown?.(e)) {
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

	getScreenPos(e: MouseEvent): Vec2 {
		const rect = this.svg.getBoundingClientRect();
		return new Vec2(e.clientX - rect.left, e.clientY - rect.top);
	}

	findSnap(screenPos: Vec2, excludePointId?: string, allowGrid = true): SnapResult | null {
		return findSnapTarget(this.sketch, this.viewport, screenPos, {
			activeTool: this.activeTool,
			isSnapModifierPressed: this.isSnapModifierPressed,
			isSnappingEnabled: this.isSnappingEnabled,
			excludePointId,
			allowGrid,
		});
	}

	applySnapConstraintIfNeeded(pointId: string, snap: SnapResult | null): void {
		applySnapConstraint(this.sketch, pointId, snap);
	}

	private applyAutoOrientationConstraint(p1Id: string, p2Id: string): void {
		applyAutoOrientation(this.sketch, p1Id, p2Id);
	}

	private getAxisSnappedWorldPos(
		startPos: Vec2,
		targetPos: Vec2,
		snap: SnapResult | null
	): { pos: Vec2; axis: 'horizontal' | 'vertical' | null } {
		return computeAxisSnappedWorldPos(startPos, targetPos, snap, this.isSnapModifierPressed);
	}

	findPointNear(screen: Vec2, thresholdPx = POINT_DISTANCE_PX, excludePointId?: string): SketchPoint | null {
		return findPointNear(this.sketch, this.viewport, screen, thresholdPx, excludePointId);
	}

	findLineNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchLine | null {
		return findLineNear(this.sketch, this.viewport, screen, this.activeTool, thresholdPx);
	}

	findCircleNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchCircle | null {
		return findCircleNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchArc | null {
		return findArcNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findConstraintNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): IConstraint | null {
		return findConstraintNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findEllipseNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipse | null {
		return findEllipseNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findEllipticalArcNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchEllipticalArc | null {
		return findEllipticalArcNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findSplineNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): SketchSpline | null {
		return findSplineNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findTrimTargetNear(screen: Vec2, thresholdPx = LINE_DISTANCE_PX): GeoCurve | null {
		return findTrimTargetNear(this.sketch, this.viewport, screen, thresholdPx);
	}

	findTextNear(screen: Vec2, targetEl?: SVGElement | null): SketchText | null {
		return findTextNear(this.sketch, this.viewport, screen, targetEl);
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

		SelectTool.handleMouseDown(this, e, screen, imageId ?? null);
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

		if (SelectTool.handleDragMouseMove(this, e, screen, world)) {
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
		const isDraggingOrSelecting = this.isPanning || SelectTool.isInteracting(this);
		const hoveredTarget = isDraggingOrSelecting
			? (this.highlightManager.clear(), null)
			: this.highlightManager.update(this.activeToolInstance, screen, e.target as SVGElement);

		this.regionHoverPoint = this.activeTool === 'select' && !hoveredTarget && !isDraggingOrSelecting ? world : null;
		this.renderer.updateRegionHover(this.regionHoverPoint);

		// Delegate to active tool if not select
		if (this.activeTool !== 'select' && this.activeToolInstance) {
			this.activeToolInstance.onMouseMove?.(this.createToolMouseEvent(e));
			this.updateToolPreview();
			return;
		}

		if (this.activeTool === 'select' && this.activeToolInstance) {
			this.activeToolInstance.onMouseMove?.(this.createToolMouseEvent(e));
		}

		this.svg.style.cursor = 'default';
	}

	private handleMouseUp(e?: MouseEvent): void {
		if (e) {
			this.isSnapModifierPressed = this.isSnapModifier(e);
			if (this.activeTool !== 'select' && this.activeToolInstance?.onMouseUp) {
				this.activeToolInstance.onMouseUp(this.createToolMouseEvent(e));
				this.updateToolPreview();
			}
		}
		if (this.activeTool === 'select' && this.activeToolInstance && !this.isPanning && !this.isBoxSelecting) {
			const toolEvent = this.createToolMouseEvent(
				e ?? ({ clientX: this.lastMouseScreen.x, clientY: this.lastMouseScreen.y } as any)
			);
			this.activeToolInstance.onMouseMove?.(toolEvent);
		}
		if (this.isPanning) {
			this.isPanning = false;
			this.updateCursor();
		}
		SelectTool.handleMouseUp(this, e);
		this.highlightManager?.update(this.activeToolInstance, this.lastMouseScreen);
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
		return SelectTool.triggerDimensionEditAt(e, screen, clientPos, {
			sketch: this.sketch,
			findConstraintNear: s => this.findConstraintNear(s),
			findLineNear: s => this.findLineNear(s),
			findCircleNear: s => this.findCircleNear(s),
			findArcNear: s => this.findArcNear(s),
			onEditDimension: this.onEditDimension,
			setTool: tool => this.setTool(tool),
			getActiveToolInstance: () => this.activeToolInstance,
			render: () => this.render(),
		});
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

	updateCursor(): void {
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

	finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void {
		const tool = this.activeToolInstance ?? this.tools?.get(this.activeTool);
		SelectTool.performBoxSelection(this.sketch, this.viewport, s1, s2, shiftKey, this.activeTool, tool);
	}
}

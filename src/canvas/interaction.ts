import type { SketchDocument } from '../model/sketch';
import type { SketchSnapshot } from '../model/history';
import type { Viewport } from './viewport';
import type { SVGRenderer } from './renderer';
import { dist, vec, projectPointOntoSegment, type Vec2 } from '../math/vector';
import type { IConstraint } from '../solver/types';
import {
	DistanceConstraint,
	RadiusConstraint,
	AngleConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	PointToLineDistanceConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
	computeRectangularPatternDirections,
} from '../solver/constraints';
import type {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
} from '../model/types';
import { showToast } from '../ui/toast';
import { PolygonPopup } from '../ui/polygon-popup';
import { FilletPopup } from '../ui/fillet-popup';
import type { FilletCandidate } from '../math/fillet';
import type { GeoCurve } from '../math/intersection';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineParamAtPoint,
	type BezierSegment,
} from '../math/spline';
import { calculateObjectsCentroid } from './tools/modify/utils';

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
	type RectangleMode,
	ArcTool,
	type ArcMode,
	PolygonTool,
	EllipseTool,
	EllipticalArcTool,
	SplineTool,
	TrimTool,
	BreakTool,
	FilletTool,
	MirrorTool,
	CircularPatternTool,
	RectangularPatternTool,
	DimensionTool,
	ConstraintTool,
	SelectTool,
	PanTool,
	CONSTRAINT_TOOLS,
	type MirrorState,
	type CircularPatternState,
	type RectangularPatternState,
} from './tools';
export * from './tools';

const TWO_PI = 2 * Math.PI;

export class CanvasInteraction {
	private svg: SVGSVGElement;
	private sketch: SketchDocument;
	private viewport: Viewport;
	private renderer: SVGRenderer;

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

	// Box selection state
	private isBoxSelecting = false;
	private boxSelectStartScreen: Vec2 | null = null;
	private boxSelectCurrentScreen: Vec2 | null = null;
	private boxSelectShift = false;
	private pendingExclusiveSelection: {
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
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
	private lastMouseScreen: Vec2 = { x: 0, y: 0 };

	private isSnapModifier(e: MouseEvent | KeyboardEvent): boolean {
		return this.isMac ? e.metaKey : e.ctrlKey;
	}

	// Double click tracking
	private lastClickTime = 0;
	private lastClickPos: Vec2 = { x: 0, y: 0 };
	private lastDoubleClickedTime = 0;

	// Dimension edit callback
	onEditDimension?: (
		constraint: DistanceConstraint | RadiusConstraint | AngleConstraint | PointToLineDistanceConstraint,
		screenPos: Vec2
	) => void;
	onToolChange?: (tool: ToolType) => void;
	onConstructionChange?: (isConstruction: boolean) => void;
	isSnappingEnabled = true;
	onSnappingChange?: (active: boolean) => void;

	onMirrorStateChange?: () => void;
	onCircularPatternStateChange?: () => void;
	onRectangularPatternStateChange?: () => void;
	onArcStateChange?: () => void;
	onArcModeChange?: (mode: ArcMode) => void;
	onRectangleStateChange?: () => void;
	onRectangleModeChange?: (mode: RectangleMode) => void;

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

	get mirrorState(): MirrorState | null {
		return (this.tools.get('mirror') as MirrorTool)?.state ?? null;
	}
	set mirrorState(state: MirrorState | null) {
		const tool = this.tools.get('mirror') as MirrorTool;
		if (tool) tool.state = state;
	}

	getArcTool(): ArcTool | undefined {
		return this.tools.get('arc') as ArcTool | undefined;
	}

	get arcMode(): ArcMode {
		return this.getArcTool()?.mode ?? 'center';
	}

	setArcMode(mode: ArcMode): void {
		const arcTool = this.getArcTool();
		if (arcTool) {
			arcTool.setMode(mode);
			this.onArcModeChange?.(mode);
			if (this.activeTool !== 'arc') {
				this.setTool('arc');
			} else {
				this.updateToolPreview();
				this.onArcStateChange?.();
			}
		}
	}

	getRectangleTool(): RectangleTool | undefined {
		return this.tools.get('rectangle') as RectangleTool | undefined;
	}

	get rectangleMode(): RectangleMode {
		return this.getRectangleTool()?.mode ?? 'corner';
	}

	setRectangleMode(mode: RectangleMode): void {
		const rectTool = this.getRectangleTool();
		if (rectTool) {
			rectTool.setMode(mode);
			this.onRectangleModeChange?.(mode);
			if (this.activeTool !== 'rectangle') {
				this.setTool('rectangle');
			} else {
				this.updateToolPreview();
				this.onRectangleStateChange?.();
			}
		}
	}

	setMirrorPhase(phase: 'objects' | 'mirror_line'): void {
		(this.tools.get('mirror') as MirrorTool)?.setPhase(phase);
	}

	cancelMirror(): void {
		(this.tools.get('mirror') as MirrorTool)?.cancel();
		this.setTool('select');
	}

	executeMirror(): boolean {
		return (this.tools.get('mirror') as MirrorTool)?.executeMirror() ?? false;
	}

	get circularPatternState(): CircularPatternState | null {
		return (this.tools.get('circular_pattern') as CircularPatternTool)?.state ?? null;
	}
	set circularPatternState(state: CircularPatternState | null) {
		const tool = this.tools.get('circular_pattern') as CircularPatternTool;
		if (tool) tool.state = state;
	}

	setCircularPatternPhase(phase: 'objects' | 'center_point'): void {
		(this.tools.get('circular_pattern') as CircularPatternTool)?.setPhase(phase);
	}

	cancelCircularPattern(): void {
		(this.tools.get('circular_pattern') as CircularPatternTool)?.cancel();
		this.setTool('select');
	}

	executeCircularPattern(): boolean {
		return (this.tools.get('circular_pattern') as CircularPatternTool)?.executeCircularPattern() ?? false;
	}

	get rectangularPatternState(): RectangularPatternState | null {
		return (this.tools.get('rectangular_pattern') as RectangularPatternTool)?.state ?? null;
	}
	set rectangularPatternState(state: RectangularPatternState | null) {
		const tool = this.tools.get('rectangular_pattern') as RectangularPatternTool;
		if (tool) tool.state = state;
	}

	setRectangularPatternPhase(phase: 'objects' | 'direction1' | 'direction2'): void {
		(this.tools.get('rectangular_pattern') as RectangularPatternTool)?.setPhase(phase);
	}

	cancelRectangularPattern(): void {
		(this.tools.get('rectangular_pattern') as RectangularPatternTool)?.cancel();
		this.setTool('select');
	}

	executeRectangularPattern(): boolean {
		return (this.tools.get('rectangular_pattern') as RectangularPatternTool)?.executeRectangularPattern() ?? false;
	}

	get polygonPopup(): PolygonPopup | undefined {
		return (this.tools.get('polygon') as PolygonTool)?.popup;
	}

	get filletPopup(): FilletPopup | undefined {
		return (this.tools.get('fillet') as FilletTool)?.popup;
	}

	get filletRadius(): number {
		return (this.tools.get('fillet') as FilletTool)?.filletRadius ?? 10.0;
	}
	set filletRadius(r: number) {
		const tool = this.tools.get('fillet') as FilletTool;
		if (tool) tool.filletRadius = r;
	}

	get pendingFillets(): FilletCandidate[] {
		return (this.tools.get('fillet') as FilletTool)?.pendingFillets ?? [];
	}

	isDrawingSpline(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool && tool.isBusy();
	}

	undoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool ? tool.undoPoint() : false;
	}

	redoSplinePoint(): boolean {
		const tool = this.activeToolInstance;
		return tool instanceof SplineTool ? tool.redoPoint() : false;
	}

	finishSpline(isClosed = false): void {
		const tool = this.activeToolInstance;
		if (tool instanceof SplineTool) {
			tool.finishSpline(isClosed);
		}
	}

	cancelSpline(): void {
		const tool = this.activeToolInstance;
		if (tool instanceof SplineTool) {
			tool.cancel();
		}
	}

	private initTools(): void {
		// Primitives
		this.tools.set('point', new PointTool());
		this.tools.set('line', new LineTool());
		this.tools.set('circle', new CircleTool());
		const rectTool = new RectangleTool();
		rectTool.onModeChange = mode => {
			this.onRectangleModeChange?.(mode);
			this.onRectangleStateChange?.();
		};
		rectTool.onStateChange = () => this.onRectangleStateChange?.();
		this.tools.set('rectangle', rectTool);
		const arcTool = new ArcTool('center');
		arcTool.onModeChange = mode => {
			this.onArcModeChange?.(mode);
			this.onArcStateChange?.();
		};
		arcTool.onStateChange = () => this.onArcStateChange?.();
		this.tools.set('arc', arcTool);
		this.tools.set('polygon', new PolygonTool());
		this.tools.set('ellipse', new EllipseTool());
		this.tools.set('elliptical_arc', new EllipticalArcTool());
		this.tools.set('spline_fit', new SplineTool('fit'));
		this.tools.set('spline_control', new SplineTool('control'));

		// Modify
		this.tools.set('trim', new TrimTool());
		this.tools.set('break', new BreakTool());
		this.tools.set('fillet', new FilletTool());
		const mirrorTool = new MirrorTool();
		mirrorTool.onStateChange = () => this.onMirrorStateChange?.();
		this.tools.set('mirror', mirrorTool);
		const circularPatternTool = new CircularPatternTool();
		circularPatternTool.onStateChange = () => this.onCircularPatternStateChange?.();
		this.tools.set('circular_pattern', circularPatternTool);
		const rectangularPatternTool = new RectangularPatternTool();
		rectangularPatternTool.onStateChange = () => this.onRectangularPatternStateChange?.();
		this.tools.set('rectangular_pattern', rectangularPatternTool);

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
			findSnap: (screen: Vec2, excludePointId?: string) => this.findSnap(screen, excludePointId),
			findPointNear: (screen: Vec2, thresholdPx?: number) => this.findPointNearScreen(screen, thresholdPx),
			findLineNear: (screen: Vec2, thresholdPx?: number) => this.findLineNearScreen(screen, thresholdPx),
			findCircleNear: (screen: Vec2, thresholdPx?: number) => this.findCircleNearScreen(screen, thresholdPx),
			findArcNear: (screen: Vec2, thresholdPx?: number) => this.findArcNearScreen(screen, thresholdPx),
			findEllipseNear: (screen: Vec2, thresholdPx?: number) => this.findEllipseNearScreen(screen, thresholdPx),
			findEllipticalArcNear: (screen: Vec2, thresholdPx?: number) =>
				this.findEllipticalArcNearScreen(screen, thresholdPx),
			findSplineNear: (screen: Vec2, thresholdPx?: number) => this.findSplineNearScreen(screen, thresholdPx),
			toGeoCurve: (type, id) => this.sketch.toGeoCurve(id, type),
			findTrimTarget: (screen: Vec2, thresholdPx?: number) =>
				this.findTrimTargetNearScreen(screen, thresholdPx),
			applySnapConstraintIfNeeded: (pointId: string, snap: SnapResult | null) =>
				this.applySnapConstraintIfNeeded(pointId, snap),
			applyAutoOrientationConstraint: (p1Id: string, p2Id: string) =>
				this.applyAutoOrientationConstraint(p1Id, p2Id),
			getAxisSnappedWorldPos: (startPos, targetPos, snap) =>
				this.getAxisSnappedWorldPos(startPos, targetPos, snap),
			get isSnapModifierPressed() {
				return self.isSnapModifierPressed;
			},
		};
	}

	createToolMouseEvent(e: MouseEvent): ToolMouseEvent {
		const screen = this.getScreenPos(e);
		const world = this.viewport.screenToWorld(screen.x, screen.y);
		const snap = this.findSnap(screen);
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
			const world = this.viewport.screenToWorld(screen.x, screen.y);
			const snap = isDrawingPrimitiveTool(this.activeTool) ? this.findSnap(screen) : null;
			if (snap) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, false);
			}
			const renderCtx = this.createToolRenderContext(screen, world, snap);
			this.activeToolInstance.renderPreview?.(renderCtx);
		}
	}

	constructor(
		svg: SVGSVGElement,
		sketch: SketchDocument,
		viewport: Viewport,
		renderer: SVGRenderer
	) {
		this.svg = svg;
		this.sketch = sketch;
		this.viewport = viewport;
		this.renderer = renderer;

		this.initTools();
		this.bindEvents();
		this.sketch.onChange(() => {
			this.updateConstructionState();
		});
		this.setTool(this.activeTool);
	}

	setTool(tool: ToolType): void {
		if (this.isSettingTool) return;
		this.isSettingTool = true;
		try {
			const prevTool = this.activeToolInstance;
			this.activeToolInstance = null;
			if (prevTool) {
				prevTool.deactivate();
			}
			this.activeTool = tool;
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
			this.svg.classList.toggle('tool-trim', tool === 'trim' || tool === 'break');
			this.updateCursor();
			this.onToolChange?.(tool);
			this.onMirrorStateChange?.();
			this.onCircularPatternStateChange?.();
			this.onRectangularPatternStateChange?.();
			this.onArcStateChange?.();
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

	setSnapping(enabled: boolean): void {
		if (this.isSnappingEnabled !== enabled) {
			this.isSnappingEnabled = enabled;
			this.onSnappingChange?.(this.isSnappingEnabled);
			this.renderer.clearPreviews();
			this.render();
		}
	}

	cancelDrawing(): void {
		this.activeToolInstance?.cancel?.();

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
			...toolRenderOptions,
		});

		// Update popup positions on screen during zoom / pan
		const polygonTool = this.tools.get('polygon') as PolygonTool | undefined;
		if (polygonTool?.popup.isOpen() && polygonTool.centerWorldPos) {
			const sCtr = this.viewport.worldToScreen(polygonTool.centerWorldPos.x, polygonTool.centerWorldPos.y);
			polygonTool.popup.updatePosition(sCtr);
		}

		const filletTool = this.tools.get('fillet') as FilletTool | undefined;
		if (filletTool?.popup.isOpen() && filletTool.pendingFillets.length > 0) {
			const activePf =
				filletTool.pendingFillets.find(pf => pf.id === filletTool.activeFilletId) ||
				filletTool.pendingFillets[filletTool.pendingFillets.length - 1];
			if (activePf) {
				if (activePf.result) {
					const sPos = this.viewport.worldToScreen(activePf.result.midArc.x, activePf.result.midArc.y);
					filletTool.popup.updatePosition(sPos);
				} else if (activePf.vertexPointId) {
					const pt = this.sketch.points.get(activePf.vertexPointId);
					if (pt) {
						const sPos = this.viewport.worldToScreen(pt.x, pt.y);
						filletTool.popup.updatePosition(sPos);
					}
				} else if (activePf.clickPos1) {
					const sPos = this.viewport.worldToScreen(activePf.clickPos1.x, activePf.clickPos1.y);
					filletTool.popup.updatePosition(sPos);
				}
			}
		}

		this.updateToolPreview();
	}

	private bindEvents(): void {
		this.svg.addEventListener('mousedown', this.handleMouseDown.bind(this));
		window.addEventListener('mousemove', this.handleMouseMove.bind(this));
		window.addEventListener('mouseup', this.handleMouseUp.bind(this));
		this.svg.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
		this.svg.addEventListener('dblclick', this.handleDoubleClick.bind(this));

		// Prevent default context menu for smooth right-click panning
		this.svg.addEventListener('contextmenu', e => {
			e.preventDefault();
			if (this.activeToolInstance?.isBusy?.()) {
				this.cancelDrawing();
				this.setTool('select');
			}
		});

		window.addEventListener('keydown', this.handleKeyDown.bind(this));

		window.addEventListener('keyup', e => {
			if (e.code === 'Space') {
				this.isSpacePressed = false;
			}
			if (this.isMac ? (e.key === 'Meta' || !e.metaKey) : (e.key === 'Control' || !e.ctrlKey)) {
				this.isSnapModifierPressed = this.isMac ? e.metaKey : e.ctrlKey;
			}
		});

		window.addEventListener('blur', () => {
			this.isSnapModifierPressed = false;
			this.isSpacePressed = false;
		});
	}

	public handleKeyDown(e: KeyboardEvent): void {
		if (this.isMac ? (e.key === 'Meta' || e.metaKey) : (e.key === 'Control' || e.ctrlKey)) {
			this.isSnapModifierPressed = true;
			this.renderer.clearPreviews();
			this.render();
		}
		const isInputTarget = Boolean(
			e.target &&
			((typeof HTMLInputElement !== 'undefined' && e.target instanceof HTMLInputElement) ||
			(typeof HTMLTextAreaElement !== 'undefined' && e.target instanceof HTMLTextAreaElement) ||
			(e.target as any).tagName === 'INPUT' ||
			(e.target as any).tagName === 'TEXTAREA')
		);
		if (e.code === 'Space' && !isInputTarget) {
			this.isSpacePressed = true;
		}
		if (e.key === 'Tab') {
			if (this.activeToolInstance?.onKeyDown) {
				const handled = this.activeToolInstance.onKeyDown(e);
				if (handled) return;
			}
		}
		if (isInputTarget) {
			return;
		}

		// Alt + 1..4: Mode switching for Rectangle and Arc tools
		if (e.altKey && !e.ctrlKey && !e.metaKey) {
			const isDigit1 = e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1';
			const isDigit2 = e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2';
			const isDigit3 = e.code === 'Digit3' || e.code === 'Numpad3' || e.key === '3';
			const isDigit4 = e.code === 'Digit4' || e.code === 'Numpad4' || e.key === '4';

			if (this.activeTool === 'rectangle') {
				if (isDigit1) {
					e.preventDefault();
					this.setRectangleMode('corner');
					showToast('2-Point Rectangle (Alt+1)');
					return;
				} else if (isDigit2) {
					e.preventDefault();
					this.setRectangleMode('center');
					showToast('Center Rectangle (Alt+2)');
					return;
				} else if (isDigit3) {
					e.preventDefault();
					this.setRectangleMode('three_point');
					showToast('3-Point Rectangle (Alt+3)');
					return;
				} else if (isDigit4) {
					e.preventDefault();
					this.setRectangleMode('rounded');
					showToast('Rounded Rectangle (Alt+4)');
					return;
				}
			} else if (this.activeTool === 'arc') {
				if (isDigit1) {
					e.preventDefault();
					this.setArcMode('center');
					showToast('Centerpoint Arc (Alt+1)');
					return;
				} else if (isDigit2) {
					e.preventDefault();
					this.setArcMode('three_point');
					showToast('3-Point Arc (Alt+2)');
					return;
				} else if (isDigit3) {
					e.preventDefault();
					this.setArcMode('tangent');
					showToast('Tangent Arc (Alt+3)');
					return;
				}
			}
		}
		if (e.key === 'Escape') {
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
		} else if (e.key === 'Enter') {
			if (this.activeToolInstance?.isBusy?.()) {
				this.activeToolInstance.commit?.();
				return;
			}
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			this.sketch.deleteSelected();
			this.render();
		} else if (e.key === 'x' || e.key === 'X') {
			this.toggleConstructionMode();
		} else if (e.key === 'v' || e.key === 'V') {
			this.setTool('select');
		} else if (e.key === 'l' || e.key === 'L') {
			this.setTool('line');
		} else if (e.key === 'c' || e.key === 'C') {
			this.setTool('circle');
		} else if (e.key === 'a' || e.key === 'A') {
			this.setTool('arc');
		} else if (e.key === 'r' || e.key === 'R') {
			this.setTool('rectangle');
		} else if (e.key === 'g' || e.key === 'G') {
			this.setTool('polygon');
		} else if (e.key === 'p' || e.key === 'P') {
			this.setTool('point');
		} else if (e.key === 'e' || e.key === 'E') {
			this.setTool('ellipse');
		} else if (e.key === 't' || e.key === 'T') {
			this.setTool(this.activeTool === 'trim' ? 'select' : 'trim');
		} else if (e.key === 'b' || e.key === 'B') {
			this.setTool(this.activeTool === 'break' ? 'select' : 'break');
		} else if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
			this.setTool(this.activeTool === 'mirror' ? 'select' : 'mirror');
		} else if (e.key === 'h' || e.key === 'H') {
			this.setTool(this.activeTool === 'horizontal_vertical' ? 'select' : 'horizontal_vertical');
		} else if (e.key === 'd' || e.key === 'D') {
			this.setTool(this.activeTool === 'dimension' ? 'select' : 'dimension');
		} else if (e.key === 'i' || e.key === 'I') {
			this.setTool(this.activeTool === 'coincident' ? 'select' : 'coincident');
		} else if (e.key === 'f' || e.key === 'F') {
			if (this.sketch.selection.pointIds.size > 0) {
				this.applyConstraint('fixed');
			} else {
				this.setTool(this.activeTool === 'fixed' ? 'select' : 'fixed');
			}
		} else if (e.key === 's' || e.key === 'S') {
			if (!e.ctrlKey && !e.metaKey) {
				this.toggleSnapping();
			}
		}
	}

	private getScreenPos(e: MouseEvent): Vec2 {
		const rect = this.svg.getBoundingClientRect();
		return vec(e.clientX - rect.left, e.clientY - rect.top);
	}


	private findSnap(screenPos: Vec2, excludePointId?: string): SnapResult | null {
		// Suppress all snapping if snap modifier is held (metaKey on Mac, ctrlKey on Windows)
		if (this.isSnapModifierPressed) {
			return null;
		}

		// Priority 1: Point snapping (Always active, highest priority)
		const pointSnapDistPx = 10;
		let closestPointDist = pointSnapDistPx;
		let foundPoint: { id: string; worldPos: Vec2; screenPos: Vec2 } | null = null;

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
			if (excludePointId && pt.id === excludePointId) continue;
			// If point belongs to a spline handle or control polygon, only snap if spline is selected or constraint tool active
			let isHiddenSplinePoint = false;
			for (const spline of this.sketch.splines.values()) {
				if (!selectedSplineIds.has(spline.id) && !isConstraintTool(this.activeTool)) {
					if (spline.splineType === 'control') {
						const isEndpoint =
							pt.id === spline.pointIds[0] || pt.id === spline.pointIds[spline.pointIds.length - 1];
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

			const s = this.viewport.worldToScreen(pt.x, pt.y);
			const d = dist(screenPos, s);
			if (d < closestPointDist) {
				closestPointDist = d;
				foundPoint = { id: pt.id, worldPos: vec(pt.x, pt.y), screenPos: s };
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
		const geomSnapDistPx = 10;
		let closestGeomDist = geomSnapDistPx;
		let foundGeom:
			| { type: 'line'; lineId: string; worldPos: Vec2; screenPos: Vec2 }
			| { type: 'circle'; circleId: string; worldPos: Vec2; screenPos: Vec2 }
			| { type: 'spline'; splineId: string; worldPos: Vec2; screenPos: Vec2 }
			| null = null;

		for (const line of this.sketch.lines.values()) {
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

			const s1 = this.viewport.worldToScreen(p1.x, p1.y);
			const s2 = this.viewport.worldToScreen(p2.x, p2.y);
			const proj = projectPointOntoSegment(screenPos, s1, s2);
			if (proj.dist < closestGeomDist) {
				closestGeomDist = proj.dist;
				const worldPos = vec(
					p1.x + proj.t * (p2.x - p1.x),
					p1.y + proj.t * (p2.y - p1.y)
				);
				foundGeom = {
					type: 'line',
					lineId: line.id,
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

			const sc = this.viewport.worldToScreen(center.x, center.y);
			const sr = circle.radius * this.viewport.zoom;
			const dToCenter = dist(screenPos, sc);
			const dToPerimeter = Math.abs(dToCenter - sr);

			if (dToPerimeter < closestGeomDist) {
				closestGeomDist = dToPerimeter;
				const dx = screenPos.x - sc.x;
				const dy = screenPos.y - sc.y;
				const d = Math.max(Math.hypot(dx, dy), 1e-6);
				const snappedScreen = vec(
					sc.x + (dx / d) * sr,
					sc.y + (dy / d) * sr
				);
				const worldPos = this.viewport.screenToWorld(snappedScreen.x, snappedScreen.y);
				foundGeom = {
					type: 'circle',
					circleId: circle.id,
					worldPos,
					screenPos: snappedScreen,
				};
			}
		}

		for (const arc of this.sketch.arcs.values()) {
			if (
				excludePointId &&
				(arc.centerId === excludePointId ||
					arc.startPointId === excludePointId ||
					arc.endPointId === excludePointId)
			) {
				continue;
			}
			const center = this.sketch.points.get(arc.centerId);
			const start = this.sketch.points.get(arc.startPointId);
			const end = this.sketch.points.get(arc.endPointId);
			if (!center || !start || !end) continue;

			const sc = this.viewport.worldToScreen(center.x, center.y);
			const ss = this.viewport.worldToScreen(start.x, start.y);
			const se = this.viewport.worldToScreen(end.x, end.y);
			const sr = arc.radius * this.viewport.zoom;

			const dToCenter = dist(screenPos, sc);
			const dToPerimeter = Math.abs(dToCenter - sr);
			if (dToPerimeter >= closestGeomDist) continue;

			const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
			const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
			const ap = Math.atan2(screenPos.y - sc.y, screenPos.x - sc.x);
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
				const snappedScreen = vec(
					sc.x + Math.cos(actualAng) * sr,
					sc.y + Math.sin(actualAng) * sr
				);
				const worldPos = this.viewport.screenToWorld(snappedScreen.x, snappedScreen.y);
				foundGeom = {
					type: 'circle',
					circleId: arc.id,
					worldPos,
					screenPos: snappedScreen,
				};
			}
		}

		if (!isConstraintTool(this.activeTool)) {
			for (const spline of this.sketch.splines.values()) {
				const screenSegments = this.getSplineScreenSegments(spline);
				if (!screenSegments) continue;

				const proj = getSplineParamAtPoint(screenSegments, screenPos);
				if (proj.distance < closestGeomDist) {
					closestGeomDist = proj.distance;
					const worldPos = this.viewport.screenToWorld(proj.point.x, proj.point.y);
					foundGeom = {
						type: 'spline',
						splineId: spline.id,
						worldPos,
						screenPos: proj.point,
					};
				}
			}
		}

		if (foundGeom) {
			if (foundGeom.type === 'spline') {
				return {
					type: 'spline',
					splineId: foundGeom.splineId,
					worldPos: foundGeom.worldPos,
					screenPos: foundGeom.screenPos,
				};
			} else if (foundGeom.type === 'line') {
				return {
					type: 'line',
					lineId: foundGeom.lineId,
					worldPos: foundGeom.worldPos,
					screenPos: foundGeom.screenPos,
				};
			} else {
				return {
					type: 'circle',
					circleId: foundGeom.circleId,
					worldPos: foundGeom.worldPos,
					screenPos: foundGeom.screenPos,
				};
			}
		}

		// Priority 3: Grid snapping
		if (!this.isSnappingEnabled) {
			return null;
		}

		const { step, subStep } = this.viewport.getGridStep();
		const subStepPx = subStep * this.viewport.zoom;
		const gridStep = subStepPx >= 6 ? subStep : step;

		const world = this.viewport.screenToWorld(screenPos.x, screenPos.y);
		const nearestWorldX = Math.round(world.x / gridStep) * gridStep;
		const nearestWorldY = Math.round(world.y / gridStep) * gridStep;
		const nearestWorld = vec(nearestWorldX, nearestWorldY);
		const nearestScreen = this.viewport.worldToScreen(nearestWorld.x, nearestWorld.y);
		const gridDist = dist(screenPos, nearestScreen);

		const gridSnapDistPx = 4;
		if (gridDist <= gridSnapDistPx) {
			return {
				type: 'grid',
				worldPos: nearestWorld,
				screenPos: nearestScreen,
			};
		}

		return null;
	}

	private applySnapConstraintIfNeeded(pointId: string, snap: SnapResult | null): void {
		if (!snap) return;
		if (snap.type === 'point' && snap.id && snap.id !== pointId) {
			const c = this.sketch.addCoincidentConstraint(pointId, snap.id);
			if (c) {
				showToast('Coincident constraint applied');
			}
		} else if (snap.type === 'line' && snap.lineId) {
			const c = this.sketch.addPointOnLineConstraint(pointId, snap.lineId);
			if (c) {
				showToast('Point constrained to line');
			}
		} else if (snap.type === 'circle' && snap.circleId) {
			const c = this.sketch.addPointOnCircleConstraint(pointId, snap.circleId);
			if (c) {
				showToast('Point constrained to circle');
			}
		}
	}

	private applyAutoOrientationConstraint(p1Id: string, p2Id: string): void {
		const p1 = this.sketch.getPoint(p1Id);
		const p2 = this.sketch.getPoint(p2Id);
		if (!p1 || !p2) return;

		const dx = Math.abs(p2.x - p1.x);
		const dy = Math.abs(p2.y - p1.y);
		if (dx < 1e-6 && dy < 1e-6) return;

		const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

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
		if (snap && (snap.type === 'point' || snap.type === 'line' || snap.type === 'circle')) {
			return { pos: targetPos, axis: null };
		}

		const dx = Math.abs(targetPos.x - startPos.x);
		const dy = Math.abs(targetPos.y - startPos.y);
		if (dx < 1e-6 && dy < 1e-6) {
			return { pos: targetPos, axis: null };
		}

		const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

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
					h1: { x: p1.x, y: p1.y },
					h2: { x: p2.x, y: p2.y },
				};
			});
			bezierSegments = fitPointsToBezier(pts, handles);
		}

		return bezierSegments.map(seg => [
			this.viewport.worldToScreen(seg[0].x, seg[0].y),
			this.viewport.worldToScreen(seg[1].x, seg[1].y),
			this.viewport.worldToScreen(seg[2].x, seg[2].y),
			this.viewport.worldToScreen(seg[3].x, seg[3].y),
		]);
	}

	private findPointNearScreen(screen: Vec2, thresholdPx = 16, excludePointId?: string): SketchPoint | null {
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

		return foundPoint;
	}

	private findLineNearScreen(screen: Vec2, thresholdPx = 16): SketchLine | null {
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

	private findCircleNearScreen(screen: Vec2, thresholdPx = 18): SketchCircle | null {
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

	private findArcNearScreen(screen: Vec2, thresholdPx = 18): SketchArc | null {
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

	private findConstraintNearScreen(
		screen: Vec2,
		thresholdPx = 18
	): IConstraint | null {
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

	private findEllipseNearScreen(screen: Vec2, thresholdPx = 18): SketchEllipse | null {
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

	private findEllipticalArcNearScreen(screen: Vec2, thresholdPx = 18): SketchEllipticalArc | null {
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

	private findSplineNearScreen(screen: Vec2, thresholdPx = 18): SketchSpline | null {
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

	private findTrimTargetNearScreen(screen: Vec2, thresholdPx = 18): GeoCurve | null {
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

		if (this.activeTool === 'select' && timeDelta >= 50 && timeDelta <= 350 && distanceDelta < 30) {
			this.lastClickTime = 0;
			if (this.triggerDimensionEditAt(e, screen, clientPos)) {
				e.preventDefault();
				e.stopPropagation();
				this.lastDoubleClickedTime = now;
				this.cancelDrawing();
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

		const world = this.viewport.screenToWorld(screen.x, screen.y);
		const snap = this.findSnap(screen);

		// Check for Rectangular Pattern Gizmo handle dragging (in select mode on selected pattern constraint)
		for (const handle of this.renderer.rectangularGizmoHandles.values()) {
			if (dist(screen, { x: handle.x, y: handle.y }) <= 18) {
				let centroidWorld: Vec2 | null = null;
				let u: Vec2 | null = null;
				let startDistance = 0;
				if (handle.constraintId) {
					const constraint = this.sketch.constraints.get(handle.constraintId) as RectangularPatternConstraint | undefined;
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
				if (entry.constraintId && Math.abs(screen.x - entry.x) <= 14 && Math.abs(screen.y - entry.y) <= 14) {
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
				| 'constraint'
				| undefined;

			// Priority 1: Points ALWAYS have top priority! If cursor is near any point, select & drag the point!
			const nearPoint = this.findPointNearScreen(screen, 16);
			if (nearPoint) {
				id = nearPoint.id;
				type = 'point';
			} else if (!type) {
				if (snap && snap.type === 'point' && snap.id) {
					id = snap.id;
					type = 'point';
				} else {
					const hitLine = this.findLineNearScreen(screen, 18);
					if (hitLine) {
						id = hitLine.id;
						type = 'line';
					} else {
						const hitCircle = this.findCircleNearScreen(screen, 18);
						if (hitCircle) {
							id = hitCircle.id;
							type = 'circle';
						} else {
							const hitArc = this.findArcNearScreen(screen, 18);
							if (hitArc) {
								id = hitArc.id;
								type = 'arc';
							} else {
								const hitEllipse = this.findEllipseNearScreen(screen, 18);
								if (hitEllipse) {
									id = hitEllipse.id;
									type = 'ellipse';
								} else {
									const hitEllipticalArc = this.findEllipticalArcNearScreen(screen, 18);
									if (hitEllipticalArc) {
										id = hitEllipticalArc.id;
										type = 'elliptical_arc';
									} else {
										const hitSpline = this.findSplineNearScreen(screen, 18);
										if (hitSpline) {
											id = hitSpline.id;
											type = 'spline';
										}
									}
								}
							}
						}
					}
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

				if (type === 'point') {
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
						constraint instanceof AngleConstraint ||
						constraint instanceof RadiusConstraint
					) {
						this.isDraggingConstraint = true;
						this.draggedConstraintId = id;
						this.preDragSnapshot = this.sketch.takeSnapshot();
						this.hasDragged = false;
						this.dragConstraintStartScreen = screen;
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
		const world = this.viewport.screenToWorld(screen.x, screen.y);

		// Pan handling
		if (this.isPanning) {
			const dx = screen.x - this.lastMouseScreen.x;
			const dy = screen.y - this.lastMouseScreen.y;
			this.viewport.pan(dx, dy);
			this.lastMouseScreen = screen;
			this.render();
			return;
		}

		this.lastMouseScreen = screen;

		// Gizmo drag handling (Rectangular pattern distance1 / distance2 in select mode)
		if (this.gizmoDragState) {
			const { axis, centroidWorld, u, startMouseWorld, startDistance, constraintId } = this.gizmoDragState;
			const startProj = (startMouseWorld.x - centroidWorld.x) * u.x + (startMouseWorld.y - centroidWorld.y) * u.y;
			const currentProj = (world.x - centroidWorld.x) * u.x + (world.y - centroidWorld.y) * u.y;
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
							this.sketch.updateRectangularPattern(constraintId, { distance1: newDist });
						}
					} else {
						if (constraint.distance2 !== newDist) {
							this.sketch.updateRectangularPattern(constraintId, { distance2: newDist });
						}
					}
					this.render();
				}
			}
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
						const s1 = this.viewport.worldToScreen(p1.x, p1.y);
						const s2 = this.viewport.worldToScreen(p2.x, p2.y);
						const midX = (s1.x + s2.x) * 0.5;
						const midY = (s1.y + s2.y) * 0.5;
						if (constraint.orientation === 'horizontal') {
							const screenOffset = screen.y - midY;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else if (constraint.orientation === 'vertical') {
							const screenOffset = screen.x - midX;
							constraint.offset = screenOffset / this.viewport.zoom;
							this.render();
						} else {
							const dx = s2.x - s1.x;
							const dy = s2.y - s1.y;
							const len = Math.hypot(dx, dy);
							if (len > 1e-4) {
								const nx = -dy / len;
								const ny = dx / len;
								const screenOffset = (screen.x - midX) * nx + (screen.y - midY) * ny;
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
						const sp = this.viewport.worldToScreen(pt.x, pt.y);
						const s1 = this.viewport.worldToScreen(p1.x, p1.y);
						const s2 = this.viewport.worldToScreen(p2.x, p2.y);
						const dx = s2.x - s1.x;
						const dy = s2.y - s1.y;
						const lineLen = Math.hypot(dx, dy);
						if (lineLen > 1e-4) {
							const ux = dx / lineLen;
							const uy = dy / lineLen;
							const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
							const tCursor = (screen.x - s1.x) * ux + (screen.y - s1.y) * uy;
							constraint.offset = (tCursor - tProj) / this.viewport.zoom;
							this.render();
						}
					}
				} else if (constraint instanceof AngleConstraint) {
					const l1 = this.sketch.lines.get(constraint.line1Id);
					const l2 = this.sketch.lines.get(constraint.line2Id);
					if (l1 && l2) {
						const p1 = this.sketch.points.get(l1.p1Id);
						const p2 = this.sketch.points.get(l1.p2Id);
						const p3 = this.sketch.points.get(l2.p1Id);
						const p4 = this.sketch.points.get(l2.p2Id);
						if (p1 && p2 && p3 && p4) {
							const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4, world);
							const arcRadiusWorld = Math.max(10, Math.hypot(world.x - geom.pInt.x, world.y - geom.pInt.y));
							constraint.arcRadius = arcRadiusWorld;

							if (geom.s1 !== constraint.s1 || geom.s2 !== constraint.s2) {
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
					}
				} else if (constraint instanceof RadiusConstraint) {
					const entity = this.sketch.circles.get(constraint.circleId) ?? this.sketch.arcs.get(constraint.circleId);
					if (entity) {
						const center = this.sketch.points.get(entity.centerId);
						if (center) {
							const sc = this.viewport.worldToScreen(center.x, center.y);
							constraint.leaderAngle = Math.atan2(screen.y - sc.y, screen.x - sc.x);
							this.render();
						}
					}
				}
			}
			return;
		}

		// Drag point handling (Live solver calculation!)
		if (this.isDraggingPoint && this.draggedPointId && this.dragPointStartWorld) {
			this.hasDragged = true;
			const snap = this.findSnap(screen, this.draggedPointId);
			const targetWorld = snap ? snap.worldPos : world;
			this.sketch.dragPoint(this.draggedPointId, targetWorld.x, targetWorld.y);
			this.render();
			if (snap) {
				this.renderer.renderSnapIndicator(snap.screenPos, snap.type, true);
			} else {
				this.renderer.clearPreviews();
			}
			return;
		}

		// Drag line handling
		if (
			this.isDraggingLine &&
			this.draggedLineId &&
			this.dragLineStartWorld &&
			this.lineP1Start &&
			this.lineP2Start
		) {
			this.hasDragged = true;
			const dx = world.x - this.dragLineStartWorld.x;
			const dy = world.y - this.dragLineStartWorld.y;
			this.sketch.dragLine(
				this.draggedLineId,
				this.lineP1Start.x + dx,
				this.lineP1Start.y + dy,
				this.lineP2Start.x + dx,
				this.lineP2Start.y + dy
			);
			this.render();
			return;
		}

		// Drag circle handling
		if (
			this.isDraggingCircle &&
			this.draggedCircleId &&
			this.dragCircleStartWorld &&
			this.circleCenterStart
		) {
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
				const dx = world.x - this.dragCircleStartWorld.x;
				const dy = world.y - this.dragCircleStartWorld.y;
				this.sketch.dragCircle(
					this.draggedCircleId,
					this.circleCenterStart.x + dx,
					this.circleCenterStart.y + dy
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
			const dx = world.x - this.dragArcStartWorld.x;
			const dy = world.y - this.dragArcStartWorld.y;

			const arc = this.sketch.arcs.get(this.draggedArcId);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const start = this.sketch.points.get(arc.startPointId);
				const end = this.sketch.points.get(arc.endPointId);
				if (center && !center.fixed) {
					center.x = this.arcCenterStart.x + dx;
					center.y = this.arcCenterStart.y + dy;
				}
				if (start && !start.fixed) {
					start.x = this.arcStartPointStart.x + dx;
					start.y = this.arcStartPointStart.y + dy;
				}
				if (end && !end.fixed) {
					end.x = this.arcEndPointStart.x + dx;
					end.y = this.arcEndPointStart.y + dy;
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
			const dx = world.x - this.dragEllipseStartWorld.x;
			const dy = world.y - this.dragEllipseStartWorld.y;

			const ellipse = this.sketch.ellipses.get(this.draggedEllipseId);
			if (ellipse) {
				const center = this.sketch.points.get(ellipse.centerId);
				const majorPt = this.sketch.points.get(ellipse.majorAxisPointId);
				const minorPt = this.sketch.points.get(ellipse.minorAxisPointId);
				if (center && !center.fixed) {
					center.x = this.ellipseCenterStart.x + dx;
					center.y = this.ellipseCenterStart.y + dy;
				}
				if (majorPt && !majorPt.fixed) {
					majorPt.x = this.ellipseMajorPointStart.x + dx;
					majorPt.y = this.ellipseMajorPointStart.y + dy;
				}
				if (minorPt && !minorPt.fixed) {
					minorPt.x = this.ellipseMinorPointStart.x + dx;
					minorPt.y = this.ellipseMinorPointStart.y + dy;
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
			const dx = world.x - this.dragEllipticalArcStartWorld.x;
			const dy = world.y - this.dragEllipticalArcStartWorld.y;

			const arc = this.sketch.ellipticalArcs.get(this.draggedEllipticalArcId);
			if (arc) {
				const center = this.sketch.points.get(arc.centerId);
				const majorPt = this.sketch.points.get(arc.majorAxisPointId);
				const minorPt = this.sketch.points.get(arc.minorAxisPointId);
				const start = this.sketch.points.get(arc.startPointId);
				const end = this.sketch.points.get(arc.endPointId);
				if (center && !center.fixed) {
					center.x = this.ellipticalArcCenterStart.x + dx;
					center.y = this.ellipticalArcCenterStart.y + dy;
				}
				if (majorPt && !majorPt.fixed) {
					majorPt.x = this.ellipticalArcMajorPointStart.x + dx;
					majorPt.y = this.ellipticalArcMajorPointStart.y + dy;
				}
				if (minorPt && !minorPt.fixed) {
					minorPt.x = this.ellipticalArcMinorPointStart.x + dx;
					minorPt.y = this.ellipticalArcMinorPointStart.y + dy;
				}
				if (start && !start.fixed) {
					start.x = this.ellipticalArcStartPointStart.x + dx;
					start.y = this.ellipticalArcStartPointStart.y + dy;
				}
				if (end && !end.fixed) {
					end.x = this.ellipticalArcEndPointStart.x + dx;
					end.y = this.ellipticalArcEndPointStart.y + dy;
				}
				this.sketch.solve();
				this.render();
			}
			return;
		}

		// Drag spline handling
		if (
			this.isDraggingSpline &&
			this.draggedSplineId &&
			this.dragSplineStartWorld
		) {
			this.hasDragged = true;
			const dx = world.x - this.dragSplineStartWorld.x;
			const dy = world.y - this.dragSplineStartWorld.y;

			for (const [pid, startPos] of this.splinePointsStart.entries()) {
				const pt = this.sketch.points.get(pid);
				if (pt && !pt.fixed) {
					pt.x = startPos.x + dx;
					pt.y = startPos.y + dy;
				}
			}
			this.sketch.solve();
			this.render();
			return;
		}

		// Delegate to active tool if not select
		if (this.activeTool !== 'select' && this.activeToolInstance) {
			const toolEvent = this.createToolMouseEvent(e);
			this.activeToolInstance.onMouseMove?.(toolEvent);
			this.updateToolPreview();
			return;
		}

		// Hover cursor in select mode
		const nearPt = this.findPointNearScreen(screen, 16);
		if (nearPt) {
			this.svg.style.cursor = 'move';
		} else {
			this.svg.style.cursor = 'default';
		}
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
		this.svg.classList.remove('is-dragging');
		if (this.gizmoDragState) {
			this.gizmoDragState = null;
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
					if (
						snap &&
						((snap.type === 'point' && snap.id && snap.id !== draggedPtId) ||
							(snap.type === 'line' && snap.lineId) ||
							(snap.type === 'circle' && snap.circleId))
					) {
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
						if (snap.type === 'point' && snap.id) {
							const c = this.sketch.addCoincidentConstraint(draggedPtId, snap.id);
							if (c) {
								showToast('Coincident constraint applied');
							}
						} else if (snap.type === 'line' && snap.lineId) {
							const c = this.sketch.addPointOnLineConstraint(draggedPtId, snap.lineId);
							if (c) {
								showToast('Point constrained to line');
							}
						} else if (snap.type === 'circle' && snap.circleId) {
							const c = this.sketch.addPointOnCircleConstraint(draggedPtId, snap.circleId);
							if (c) {
								showToast('Point constrained to circle');
							}
						}
						this.sketch.commitTransaction();
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
			this.sketch.selectEntity(
				this.pendingExclusiveSelection.id,
				this.pendingExclusiveSelection.type,
				false
			);
			this.render();
		}
		this.pendingExclusiveSelection = null;
	}

	private handleWheel(e: WheelEvent): void {
		e.preventDefault();
		const screen = this.getScreenPos(e);
		// Smooth continuous zoom factor depending exponentially on deltaY via Math.pow
		const zoomFactor = Math.pow(2, -e.deltaY * 0.0015);
		this.viewport.zoomAt(screen.x, screen.y, zoomFactor);
		this.render();
	}

	private triggerDimensionEditAt(e: MouseEvent, screen: Vec2, clientPos: Vec2): boolean {
		const target = e.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type');

		// If target didn't resolve to a line, circle, arc, or constraint, use geometric hit test
		if (!type || (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'constraint')) {
			const hitConstraint = this.findConstraintNearScreen(screen, 18);
			if (hitConstraint) {
				id = hitConstraint.id;
				type = 'constraint';
			} else {
				const hitLine = this.findLineNearScreen(screen, 18);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = this.findCircleNearScreen(screen, 18);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = this.findArcNearScreen(screen, 18);
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
					constraint instanceof RadiusConstraint ||
					constraint instanceof AngleConstraint) &&
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
						((c.p1Id === line.p1Id && c.p2Id === line.p2Id) ||
							(c.p1Id === line.p2Id && c.p2Id === line.p1Id))
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
			const isCircle = this.sketch.circles.has(id);
			const entity = this.sketch.circles.get(id) ?? this.sketch.arcs.get(id);
			if (entity) {
				let radConstraint = [...this.sketch.constraints.values()].find(
					c => c instanceof RadiusConstraint && c.circleId === entity.id
				) as RadiusConstraint | undefined;

				if (!radConstraint) {
					// Circle defaults to diameter, arc defaults to radius
					radConstraint =
						this.sketch.addRadiusConstraint(entity.id, undefined, isCircle ? 'diameter' : 'radius') ??
						undefined;
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
		if (this.triggerDimensionEditAt(e, screen, clientPos)) {
			e.preventDefault();
			e.stopPropagation();
			this.lastDoubleClickedTime = now;
			this.cancelDrawing();
		}
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
			case 'collinear':
			case 'perpendicular': {
				sel.pointIds.clear();
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
		sel.ellipseIds.clear();
		sel.ellipticalArcIds.clear();
		sel.splineIds.clear();
		// Clean up constraintIds
		sel.constraintIds.clear();
		for (const pid of sel.pointIds) {
			for (const c of this.sketch.getConstraintsForEntity('point', pid)) {
				sel.constraintIds.add(c.id);
			}
		}
		for (const lid of sel.lineIds) {
			for (const c of this.sketch.getConstraintsForEntity('line', lid)) {
				sel.constraintIds.add(c.id);
			}
		}
		for (const cid of sel.circleIds) {
			for (const c of this.sketch.getConstraintsForEntity('circle', cid)) {
				sel.constraintIds.add(c.id);
			}
		}
		for (const aid of sel.arcIds) {
			for (const c of this.sketch.getConstraintsForEntity('arc', aid)) {
				sel.constraintIds.add(c.id);
			}
		}
		for (const eid of sel.ellipseIds) {
			for (const c of this.sketch.getConstraintsForEntity('ellipse', eid)) {
				sel.constraintIds.add(c.id);
			}
		}
		for (const eaid of sel.ellipticalArcIds) {
			for (const c of this.sketch.getConstraintsForEntity('elliptical_arc', eaid)) {
				sel.constraintIds.add(c.id);
			}
		}
	}

	isEntityCompatibleWithConstraint(
		constraintType: string,
		entityType: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
	): boolean {
		switch (constraintType) {
			case 'fixed':
				return entityType === 'point';
			case 'coincident':
				return entityType === 'point' || entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return entityType === 'line' || entityType === 'point';
			case 'dimension':
			case 'distance':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc' || entityType === 'point';
			case 'equal':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'parallel':
			case 'collinear':
			case 'perpendicular':
				return entityType === 'line';
			case 'tangent':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'concentric':
				return entityType === 'circle' || entityType === 'arc';
			case 'point_on_line':
			case 'midpoint':
				return entityType === 'point' || entityType === 'line';
			case 'symmetry':
				return entityType === 'point' || entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			default:
				return false;
		}
	}

	canApplyConstraint(type: string): boolean {
		const sel = this.sketch.selection;
		const pCount = sel.pointIds.size;
		const lCount = sel.lineIds.size;
		const cCount = sel.circleIds.size + sel.arcIds.size;

		switch (type) {
			case 'fixed':
				return pCount >= 1;
			case 'coincident':
				return (
					(pCount === 2 && lCount === 0 && cCount === 0) ||
					(pCount === 1 && lCount === 1 && cCount === 0) ||
					(pCount === 1 && cCount === 1 && lCount === 0)
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
					(cCount === 1 && pCount === 0 && lCount === 0) ||
					(lCount === 1 && pCount === 1 && cCount === 0)
				);
			case 'equal':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (cCount === 2 && pCount === 0 && lCount === 0);
			case 'parallel':
			case 'collinear':
			case 'perpendicular':
				return lCount === 2 && pCount === 0 && cCount === 0;
			case 'tangent':
				return (
					((lCount === 1 && cCount === 1) || (cCount === 2 && lCount === 0)) &&
					pCount === 0
				);
			case 'concentric':
				return cCount === 2 && pCount === 0 && lCount === 0;
			case 'point_on_line':
			case 'midpoint':
				return pCount === 1 && lCount === 1 && cCount === 0;
			case 'symmetry':
				return (
					(pCount === 2 && lCount === 1 && cCount === 0) ||
					(cCount === 2 && lCount === 1 && pCount === 0) ||
					(lCount === 3 && pCount === 0 && cCount === 0)
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
				if (pIds.length === 2 && lIds.length === 0 && cIds.length === 0) {
					this.sketch.addCoincidentConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Coincident constraint applied';
				} else if (pIds.length === 1 && lIds.length === 1 && cIds.length === 0) {
					const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on line constraint applied';
					} else {
						showToast('Cannot constrain point to this line');
					}
				} else if (pIds.length === 1 && cIds.length === 1 && lIds.length === 0) {
					const c = this.sketch.addPointOnCircleConstraint(pIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on circle constraint applied';
					} else {
						showToast('Cannot constrain point to this circle/arc');
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
						const dx = Math.abs(p2.x - p1.x);
						const dy = Math.abs(p2.y - p1.y);
						if (dx >= dy) {
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
						const dx = Math.abs(p2.x - p1.x);
						const dy = Math.abs(p2.y - p1.y);
						if (dx >= dy) {
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
					const l = this.sketch.lines.get(lIds[0])!;
					if (pIds[0] !== l.p1Id && pIds[0] !== l.p2Id) {
						const existed = this.sketch.hasPointToLineDistanceConstraint(pIds[0], lIds[0]);
						const c = this.sketch.addPointToLineDistanceConstraint(pIds[0], lIds[0]);
						applied = true;
						toastMsg = existed ? 'Editing point-to-line distance constraint' : 'Point-to-line distance constraint applied';
						if (c && this.onEditDimension) {
							const pt = this.sketch.points.get(pIds[0])!;
							const s = this.viewport.worldToScreen(pt.x, pt.y);
							const rect = this.svg.getBoundingClientRect();
							this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
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
						const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0;
						const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0;
						const s = this.viewport.worldToScreen(midX, midY);
						const rect = this.svg.getBoundingClientRect();
						this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
					}
				} else if (lIds.length === 2) {
					const existed = this.sketch.hasAngleConstraint(lIds[0], lIds[1]);
					const c = this.sketch.addAngleConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
					if (c && this.onEditDimension) {
						const l1 = this.sketch.lines.get(lIds[0])!;
						const l2 = this.sketch.lines.get(lIds[1])!;
						const p1 = this.sketch.points.get(l1.p1Id)!;
						const p2 = this.sketch.points.get(l1.p2Id)!;
						const p3 = this.sketch.points.get(l2.p1Id)!;
						const p4 = this.sketch.points.get(l2.p2Id)!;
						const geom = this.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);
						const s = this.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
						const rect = this.svg.getBoundingClientRect();
						this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
					}
				} else if (pIds.length === 2) {
					const existed = this.sketch.hasDistanceConstraint(pIds[0], pIds[1]);
					const c = this.sketch.addDistanceConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
					if (c && this.onEditDimension) {
						const p1 = this.sketch.points.get(pIds[0]);
						const p2 = this.sketch.points.get(pIds[1]);
						const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0;
						const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0;
						const s = this.viewport.worldToScreen(midX, midY);
						const rect = this.svg.getBoundingClientRect();
						this.onEditDimension(c, vec(rect.left + s.x, rect.top + s.y));
					}
				} else if (cIds.length === 1) {
					const existed = this.sketch.hasRadiusConstraint(cIds[0]);
					const c = this.sketch.addRadiusConstraint(cIds[0]);
					applied = true;
					toastMsg = existed ? 'Editing radius constraint' : 'Radius constraint applied';
					if (c && this.onEditDimension) {
						const circ = this.sketch.circles.get(cIds[0]) ?? this.sketch.arcs.get(cIds[0]);
						const center = circ ? this.sketch.points.get(circ.centerId) : null;
						const s = center ? this.viewport.worldToScreen(center.x, center.y) : { x: 100, y: 100 };
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
					this.sketch.addParallelConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Parallel constraint applied';
				}
				break;
			}
			case 'collinear': {
				if (lIds.length === 2) {
					this.sketch.addCollinearConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Collinear constraint applied';
				}
				break;
			}
			case 'perpendicular': {
				if (lIds.length === 2) {
					this.sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Perpendicular constraint applied';
				}
				break;
			}
			case 'tangent': {
				if (lIds.length === 1 && cIds.length === 1) {
					this.sketch.addTangentConstraint(lIds[0], cIds[0]);
					applied = true;
					toastMsg = 'Tangent constraint applied';
				} else if (cIds.length === 2 && lIds.length === 0) {
					this.sketch.addTangentConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Tangent constraint applied';
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
					const c = this.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on line constraint applied';
					} else {
						showToast('Cannot constrain point to this line');
					}
				}
				break;
			}
			case 'midpoint': {
				if (pIds.length === 1 && lIds.length === 1) {
					this.sketch.addMidpointConstraint(pIds[0], lIds[0]);
					applied = true;
					toastMsg = 'Midpoint constraint applied';
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
				} else if (cIds.length === 2 && lIds.length === 1) {
					const c1 = this.sketch.circles.get(cIds[0]) ?? this.sketch.arcs.get(cIds[0]);
					const c2 = this.sketch.circles.get(cIds[1]) ?? this.sketch.arcs.get(cIds[1]);
					if (c1 && c2) {
						this.sketch.beginTransaction();
						this.sketch.addSymmetryConstraint(c1.centerId, c2.centerId, lIds[0]);
						this.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
						this.sketch.commitTransaction();
						applied = true;
						toastMsg = 'Symmetry & equal radius applied';
					}
				} else if (lIds.length === 3) {
					const constrIdx = lIds.findIndex(id => this.sketch.lines.get(id)?.isConstruction);
					const axisId = constrIdx !== -1 ? lIds[constrIdx] : lIds[2];
					const otherLines = lIds.filter(id => id !== axisId);
					const l1 = this.sketch.lines.get(otherLines[0]);
					const l2 = this.sketch.lines.get(otherLines[1]);
					if (l1 && l2) {
						this.sketch.beginTransaction();
						this.sketch.addSymmetryConstraint(l1.p1Id, l2.p1Id, axisId);
						this.sketch.addSymmetryConstraint(l1.p2Id, l2.p2Id, axisId);
						this.sketch.commitTransaction();
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

	deselectEntity(id: string, type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'): void {
		if (type === 'point') {
			this.sketch.selection.pointIds.delete(id);
		} else if (type === 'line') {
			this.sketch.selection.lineIds.delete(id);
		} else if (type === 'circle') {
			this.sketch.selection.circleIds.delete(id);
		} else if (type === 'arc') {
			this.sketch.selection.arcIds.delete(id);
		} else if (type === 'ellipse') {
			this.sketch.selection.ellipseIds.delete(id);
		} else if (type === 'elliptical_arc') {
			this.sketch.selection.ellipticalArcIds.delete(id);
		}
		this.sketch.selection.constraintIds.clear();
		for (const pid of this.sketch.selection.pointIds) {
			for (const c of this.sketch.getConstraintsForEntity('point', pid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		for (const lid of this.sketch.selection.lineIds) {
			for (const c of this.sketch.getConstraintsForEntity('line', lid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		for (const cid of this.sketch.selection.circleIds) {
			for (const c of this.sketch.getConstraintsForEntity('circle', cid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		for (const aid of this.sketch.selection.arcIds) {
			for (const c of this.sketch.getConstraintsForEntity('arc', aid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		for (const eid of this.sketch.selection.ellipseIds) {
			for (const c of this.sketch.getConstraintsForEntity('ellipse', eid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		for (const eaid of this.sketch.selection.ellipticalArcIds) {
			for (const c of this.sketch.getConstraintsForEntity('elliptical_arc', eaid)) {
				this.sketch.selection.constraintIds.add(c.id);
			}
		}
		this.sketch.notify();
	}

	private finishBoxSelection(s1: Vec2, s2: Vec2, shiftKey: boolean): void {
		const minScreenX = Math.min(s1.x, s2.x);
		const maxScreenX = Math.max(s1.x, s2.x);
		const minScreenY = Math.min(s1.y, s2.y);
		const maxScreenY = Math.max(s1.y, s2.y);

		const w1 = this.viewport.screenToWorld(minScreenX, minScreenY);
		const w2 = this.viewport.screenToWorld(maxScreenX, maxScreenY);

		const minX = Math.min(w1.x, w2.x);
		const maxX = Math.max(w1.x, w2.x);
		const minY = Math.min(w1.y, w2.y);
		const maxY = Math.max(w1.y, w2.y);

		const itemsToSelect: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint';
		}> = [];

		// 1. Points
		for (const pt of this.sketch.points.values()) {
			if (pt.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
				itemsToSelect.push({ id: pt.id, type: 'point' });
			}
		}

		// 2. Lines
		for (const line of this.sketch.lines.values()) {
			if (line.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
				itemsToSelect.push({ id: line.id, type: 'line' });
			}
		}

		// 3. Circles
		for (const circle of this.sketch.circles.values()) {
			if (circle.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
				itemsToSelect.push({ id: circle.id, type: 'circle' });
			}
		}

		// 4. Arcs
		for (const arc of this.sketch.arcs.values()) {
			if (arc.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
				itemsToSelect.push({ id: arc.id, type: 'arc' });
			}
		}

		// 5. Ellipses
		for (const ellipse of this.sketch.ellipses.values()) {
			if (ellipse.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
				itemsToSelect.push({ id: ellipse.id, type: 'ellipse' });
			}
		}

		// 6. Elliptical Arcs
		for (const elArc of this.sketch.ellipticalArcs.values()) {
			if (elArc.intersectsAABB(minX, minY, maxX, maxY, this.sketch)) {
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

import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../viewport';
import type { SVGRenderer } from '../renderer';
import type { Vec2 } from '../../math/vector';
import type { GeoCurve } from '../../math/intersection';
import type { IConstraint } from '../../solver/types';
import type {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
} from '../../model/types';

export const DRAWING_PRIMITIVE_TOOLS = [
	'point',
	'line',
	'circle',
	'polygon',
	'arc',
	'rectangle',
	'slot',
	'ellipse',
	'elliptical_arc',
	'spline',
] as const;

export const CONSTRAINT_TOOLS = [
	'coincident',
	'fixed',
	'horizontal_vertical',
	'horizontal',
	'vertical',
	'dimension',
	'distance',
	'equal',
	'parallel',
	'collinear',
	'perpendicular',
	'tangent',
	'concentric',
	'point_on_line',
	'midpoint',
	'symmetry',
] as const;

export type DrawingPrimitiveToolType = (typeof DRAWING_PRIMITIVE_TOOLS)[number];
export type ConstraintToolType = (typeof CONSTRAINT_TOOLS)[number];

const DRAWING_PRIMITIVE_TOOL_SET: ReadonlySet<string> = new Set(DRAWING_PRIMITIVE_TOOLS);
const CONSTRAINT_TOOL_SET: ReadonlySet<string> = new Set(CONSTRAINT_TOOLS);

export function isDrawingPrimitiveTool(tool: string): tool is DrawingPrimitiveToolType {
	return DRAWING_PRIMITIVE_TOOL_SET.has(tool);
}

export function isConstraintTool(tool: string): tool is ConstraintToolType {
	return CONSTRAINT_TOOL_SET.has(tool);
}

export type ToolType =
	| 'select'
	| 'pan'
	| 'trim'
	| 'break'
	| 'delete'
	| 'mirror'
	| 'circular_pattern'
	| 'rectangular_pattern'
	| 'fillet'
	| 'chamfer'
	| DrawingPrimitiveToolType
	| ConstraintToolType;

export interface SnapResult {
	type: 'point' | 'line' | 'circle' | 'spline' | 'grid';
	id?: string;
	lineId?: string;
	circleId?: string;
	splineId?: string;
	worldPos: Vec2;
	screenPos: Vec2;
}

/**
 * Enriched mouse/pointer event passed to active tools.
 */
export interface ToolMouseEvent {
	/** Original browser DOM event */
	readonly raw: MouseEvent;
	/** Screen position relative to SVG canvas */
	readonly screen: Vec2;
	/** Client position in browser window coordinates */
	readonly client: Vec2;
	/** World position in sketch coordinates */
	readonly world: Vec2;
	/** Snapping result if cursor is near snap targets */
	readonly snap: SnapResult | null;
	/** Effective world position with snap applied (snap.worldPos ?? world) */
	readonly effectiveWorld: Vec2;
	/** Effective screen position with snap applied */
	readonly effectiveScreen: Vec2;
}

/**
 * Context and services provided to the active tool by the interaction controller.
 */
export interface ToolContext {
	readonly sketch: SketchDocument;
	readonly viewport: Viewport;
	readonly renderer: SVGRenderer;
	readonly svg: SVGSVGElement;

	/** Whether construction geometry mode is currently enabled */
	readonly isConstructionMode: boolean;

	/** Trigger full redraw of canvas */
	requestRender(): void;

	/** Switch the currently active tool (e.g. back to 'select' when finished) */
	setTool(tool: ToolType): void;

	/** Update CSS cursor on the SVG canvas */
	setCursor(cursor: string): void;

	/** Display user notification toast */
	showToast(message: string): void;

	/** Dimension edit callback */
	onEditDimension?(constraint: any, screenPos: Vec2): void;

	/** Snapping helper */
	findSnap(screen: Vec2, excludePointId?: string, allowGrid?: boolean): SnapResult | null;

	/** Entity query / hit-testing helpers */
	findPointNear(screen: Vec2, thresholdPx?: number): SketchPoint | null;
	findLineNear(screen: Vec2, thresholdPx?: number): SketchLine | null;
	findCircleNear(screen: Vec2, thresholdPx?: number): SketchCircle | null;
	findArcNear(screen: Vec2, thresholdPx?: number): SketchArc | null;
	findEllipseNear?(screen: Vec2, thresholdPx?: number): SketchEllipse | null;
	findEllipticalArcNear?(screen: Vec2, thresholdPx?: number): SketchEllipticalArc | null;
	findSplineNear(screen: Vec2, thresholdPx?: number): SketchSpline | null;
	findConstraintNear?(screen: Vec2, thresholdPx?: number): IConstraint | null;
	toGeoCurve(type: 'line' | 'circle' | 'arc' | 'spline' | 'ellipse' | 'elliptical_arc', id: string): GeoCurve | null;
	findTrimTarget?(screen: Vec2, thresholdPx?: number): GeoCurve | null;

	/** Apply geometric constraints based on snap target (coincident, point-on-line, point-on-circle) */
	applySnapConstraintIfNeeded?(pointId: string, snap: SnapResult | null): void;

	/** Automatically apply horizontal or vertical constraint if line is within 1 degree of an axis */
	applyAutoOrientationConstraint?(p1Id: string, p2Id: string): void;

	/** Axis-aligned snapping for line drawing */
	getAxisSnappedWorldPos?(
		startPos: Vec2,
		targetPos: Vec2,
		snap: SnapResult | null
	): { pos: Vec2; axis: 'horizontal' | 'vertical' | null };

	readonly isSnapModifierPressed?: boolean;
}

/**
 * Render context provided to tools for interactive overlays and rubberband previews.
 */
export interface ToolRenderContext {
	readonly viewport: Viewport;
	readonly sketch: SketchDocument;
	/** Target SVG group for tool preview visuals */
	readonly targetGroup: SVGGElement;
	readonly cursorScreen: Vec2;
	readonly cursorWorld: Vec2;
	readonly snap: SnapResult | null;
	readonly isConstruction: boolean;
}

/**
 * Interface that all interaction tools must implement.
 */
export interface ITool {
	/** Unique tool identifier ('select', 'line', 'fillet', etc.) */
	readonly id: ToolType;

	/** Default CSS cursor for this tool */
	readonly defaultCursor?: string;

	// --- Lifecycle ---
	/** Called when tool is selected and becomes active */
	activate(ctx: ToolContext): void;

	/** Called when switching away from this tool */
	deactivate(): void;

	// --- Mouse Events ---
	onMouseDown?(e: ToolMouseEvent): boolean | void;
	onMouseMove?(e: ToolMouseEvent): void;
	onMouseUp?(e: ToolMouseEvent): void;
	onDoubleClick?(e: ToolMouseEvent): void;

	// --- Keyboard Events ---
	onKeyDown?(e: KeyboardEvent): boolean | void;
	onKeyUp?(e: KeyboardEvent): void;

	// --- Interactive Previews ---
	renderPreview?(ctx: ToolRenderContext): void;

	/** Optional render options to pass into SVGRenderer.render (e.g. filletState, patternHighlight) */
	getRenderOptions?(): Record<string, unknown>;

	// --- State & Commands ---
	/** Returns true if tool is in the middle of a multi-step operation */
	isBusy?(): boolean;

	/** Returns false to temporarily suppress snapping, or 'no-grid' to suppress only grid snapping (e.g. arc endpoints) */
	shouldSnap?(): boolean | 'no-grid';

	/** Cancel current operation (e.g. Esc key or tool switch) */
	cancel?(): void;

	/** Commit current operation (e.g. Enter key or confirmation) */
	commit?(): void;

	/** Tool-specific point undo (e.g. spline point undo) */
	undoPoint?(): boolean;

	/** Tool-specific point redo (e.g. spline point redo) */
	redoPoint?(): boolean;
}

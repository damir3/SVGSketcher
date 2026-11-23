import { LINE_DISTANCE_PX } from './distances';
import { isDrawingLineType, type DrawingLineType, type LineType } from '../model/lineTypes';
import { CANVAS_COLOR_TOKENS, canvasColorVariable, type CanvasColorToken } from '../theme/themes';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// ==========================================
// Styling Constants & Design Tokens
// ==========================================

/**
 * Theme-aware canvas colors. Each value is a `var(--canvas-…)` reference that
 * resolves against the active theme (see `src/theme/themes.ts`), so switching
 * themes recolors the canvas without re-rendering it.
 */
export const COLORS: Readonly<Record<CanvasColorToken, string>> & { readonly hitTransparent: string } = {
	...(Object.fromEntries(CANVAS_COLOR_TOKENS.map(token => [token, `var(${canvasColorVariable(token)})`])) as Record<
		CanvasColorToken,
		string
	>),
	hitTransparent: 'rgba(0, 0, 0, 0.001)', // invisible but hit-testable fill/stroke
};

export const REGION_STYLE = {
	fill: COLORS.regionFill,
	hoverFill: COLORS.regionHoverFill,
	fillOpacity: 0.1,
	hoverFillOpacity: 0.5,
	stroke: COLORS.primary,
} as const;

export const SVG_EXPORT_STYLE = {
	geometryStroke: '#0f172a',
	strokeWidth: 0.2,
	fill: 'none',
	isolatedPointFill: '#0f172a',
	regionFill: '#bae6fd',
	regionFillOpacity: 0.5,
	regionStroke: 'none',
} as const;

export const DRAWING_LINE_STYLES = {
	centerline: { layer: 'centerlines', dash: [12, 4, 2, 4], canvasWidthFactor: 1, exportWidthFactor: 0.5 },
	hidden: { layer: 'hidden-lines', dash: [5, 3], canvasWidthFactor: 1, exportWidthFactor: 0.5 },
	phantom: { layer: 'phantom-lines', dash: [12, 4, 2, 4, 2, 4], canvasWidthFactor: 1, exportWidthFactor: 0.5 },
	cutting_plane: { layer: 'cutting-planes', dash: [9, 5, 1, 5], canvasWidthFactor: 2, exportWidthFactor: 1 },
} as const satisfies Record<
	DrawingLineType,
	{ layer: string; dash: readonly number[]; canvasWidthFactor: number; exportWidthFactor: number }
>;

export const DASH_ARRAY = {
	construction: '6,6',
	ray: '2,2',
	axis: '3,3',
	guide: '2,4',
	guideCircle: '4,4',
	selectionBox: '4 3',
	splineHandle: '4 3',
	splineControlPolygon: '4 3',
	splinePreviewGuide: '3 3',
	splineConstruction: '6 4',
	mirrorLine: '6 3',
	directionLine: '6 3',
	patternCenterRing: '4 2',
	gizmo: '4 4',
	symmetryChord: '3 3',
} as const;

export const STROKE_WIDTH = {
	minorGrid: 0.75,
	thin: 1,
	majorGrid: 1,
	dimension: 1,
	normal: 1.5,
	construction: 1,
	thick: 2,
	selected: 2,
	trim: 2,
	heavy: 3,
	hitArea: LINE_DISTANCE_PX,
	splineHandle: 1,
	splineHandleSelected: 2,
	splineControlPolygon: 1.5,
	splinePreview: 1.5,
	splinePreviewGuide: 1.2,
} as const;

export const FILTERS = {
	splineCheckmark: 'drop-shadow(0 1px 3px rgba(0,0,0,0.25))',
	gizmo: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
	checkboxHalo: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
} as const;

export const DIM_ARROWS = {
	default: 'url(#dim-arrow)',
	selected: 'url(#dim-arrow-selected)',
	delete: 'url(#dim-arrow-delete)',
} as const;

export const DIMENSION_FONT_SIZE = 12;

export const DIMENSION_TEXT_ATTRS = {
	'text-anchor': 'middle',
	'dominant-baseline': 'central',
	'font-size': DIMENSION_FONT_SIZE,
	'font-weight': 600,
	'font-family': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const satisfies SvgAttrs;

export type SvgAttrs = Record<string, string | number | boolean | undefined | null>;

// ==========================================
// Reusable SvgAttrs Presets & Helpers
// ==========================================

export const HIT_AREA_STROKE_ATTRS: SvgAttrs = {
	class: 'hit-area',
	fill: 'none',
	stroke: COLORS.hitTransparent,
	'stroke-width': STROKE_WIDTH.hitArea,
	'stroke-linecap': 'round',
	'pointer-events': 'stroke',
};

export const HIT_AREA_RING_ATTRS: SvgAttrs = {
	class: 'hit-area',
	fill: 'none',
	stroke: COLORS.hitTransparent,
	'stroke-width': STROKE_WIDTH.hitArea,
	'pointer-events': 'stroke',
};

export const HIT_AREA_POINT_ATTRS: SvgAttrs = {
	class: 'hit-area',
	fill: COLORS.hitTransparent,
	'pointer-events': 'all',
};

export const AUX_RAY_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-dasharray': DASH_ARRAY.ray,
	fill: 'none',
};

export const AUX_AXIS_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-dasharray': DASH_ARRAY.axis,
	fill: 'none',
};

export const GUIDE_OUTLINE_ATTRS: SvgAttrs = {
	stroke: COLORS.guideFaint,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-dasharray': DASH_ARRAY.guide,
	fill: 'none',
};

export const EXTENSION_LINE_ATTRS: SvgAttrs = {
	stroke: COLORS.extLineDim,
	'stroke-width': STROKE_WIDTH.thin,
	'pointer-events': 'none',
};

export const PREVIEW_EXTENSION_LINE_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
};

export const TRIM_STROKE_ATTRS: SvgAttrs = {
	stroke: COLORS.trim,
	'stroke-width': STROKE_WIDTH.trim,
	'stroke-linecap': 'round',
	fill: 'none',
	'pointer-events': 'none',
};

export const COPY_STROKE_BASE_ATTRS: SvgAttrs = {
	'stroke-linecap': 'round',
	fill: 'none',
	'pointer-events': 'none',
};

export const SELECTION_BOX_ATTRS: SvgAttrs = {
	fill: COLORS.selectionBoxFill,
	stroke: COLORS.selected,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-dasharray': DASH_ARRAY.selectionBox,
	'pointer-events': 'none',
};

export const CROSSING_SELECTION_BOX_ATTRS: SvgAttrs = {
	...SELECTION_BOX_ATTRS,
	fill: COLORS.crossingSelectionBoxFill,
	stroke: COLORS.constrained,
};

export const SYMMETRY_CHORD_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': 1.2,
	'stroke-dasharray': DASH_ARRAY.symmetryChord,
	opacity: 0.7,
	'pointer-events': 'none',
};

// Mirror & Direction Lines
export const TRANSFORM_PREVIEW_COLOR = COLORS.splinePreview;
export const TRANSFORM_GEOMETRY_ATTRS = { opacity: 0.7, 'pointer-events': 'none' };

export const TRANSFORM_FRAME_ATTRS = {
	fill: 'none',
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-dasharray': DASH_ARRAY.gizmo,
};

export const MIRROR_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive',
	fill: 'none',
	stroke: COLORS.mirrorLine,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.mirrorLine,
	'stroke-linecap': 'round',
};

export const DIR1_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive',
	fill: 'none',
	stroke: COLORS.patternAxis1,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.directionLine,
	'stroke-linecap': 'round',
};

export const DIR2_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive',
	fill: 'none',
	stroke: COLORS.patternAxis2,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.directionLine,
	'stroke-linecap': 'round',
};

export const MIRROR_PREVIEW_LINE_ATTRS: SvgAttrs = {
	stroke: COLORS.mirrorLine,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.mirrorLine,
	opacity: 0.9,
	'pointer-events': 'none',
};

export const MIRROR_PREVIEW_VERTEX_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.background,
	'stroke-width': STROKE_WIDTH.dimension,
	opacity: 0.85,
	'pointer-events': 'none',
};

// Pattern Previews & Gizmos
export const PATTERN_CENTER_RING_ATTRS: SvgAttrs = {
	fill: 'none',
	stroke: COLORS.patternCenter,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-dasharray': DASH_ARRAY.patternCenterRing,
	opacity: 0.9,
	'pointer-events': 'none',
};

export const PATTERN_CENTER_CROSSHAIR_ATTRS: SvgAttrs = {
	stroke: COLORS.patternCenter,
	'stroke-width': STROKE_WIDTH.dimension,
	opacity: 0.8,
	'pointer-events': 'none',
};

export const PATTERN_CENTER_DOT_ATTRS: SvgAttrs = {
	fill: COLORS.patternCenter,
	stroke: COLORS.background,
	'stroke-width': STROKE_WIDTH.dimension,
	'pointer-events': 'none',
};

export const CHECKBOX_HALO_ATTRS: SvgAttrs = {
	rx: 5,
	fill: COLORS.background,
	stroke: COLORS.badgeBorder,
	'stroke-width': STROKE_WIDTH.thin,
	filter: FILTERS.checkboxHalo,
};

export const CHECKBOX_ACTIVE_ATTRS: SvgAttrs = {
	rx: 3.5,
	fill: COLORS.checkboxActiveFill,
	stroke: COLORS.checkboxActiveStroke,
	'stroke-width': STROKE_WIDTH.thin,
};

export const CHECKBOX_CHECKMARK_ATTRS: SvgAttrs = {
	stroke: COLORS.onAccent,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
	fill: 'none',
};

export const CHECKBOX_SUPPRESSED_ATTRS: SvgAttrs = {
	rx: 3.5,
	fill: COLORS.checkboxSuppressedFill,
	stroke: COLORS.checkboxSuppressedStroke,
	'stroke-width': STROKE_WIDTH.dimension,
};

export const CHECKBOX_SUPPRESSED_DASH_ATTRS: SvgAttrs = {
	stroke: COLORS.checkboxSuppressedDash,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-linecap': 'round',
};

export const RECT_PATTERN_PILL_ATTRS: SvgAttrs = {
	rx: 4,
	fill: COLORS.tooltipBg,
	'stroke-width': STROKE_WIDTH.dimension,
	opacity: 0.9,
	'pointer-events': 'none',
};

export const RECT_PATTERN_PILL_TEXT_ATTRS: SvgAttrs = {
	'text-anchor': 'middle',
	fill: COLORS.labelSlate,
	'font-size': 10,
	'font-weight': 600,
	'font-family': 'monospace',
	'pointer-events': 'none',
};

// Shared Gizmo Styles
export const GIZMO_POINT_ATTRS: SvgAttrs = {
	fill: COLORS.background,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'pointer-events': 'none',
};

export const GIZMO_GUIDE_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-dasharray': DASH_ARRAY.gizmo,
	fill: 'none',
	'pointer-events': 'none',
};

export const GIZMO_ARROW_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.background,
	'stroke-width': STROKE_WIDTH.dimension,
	'stroke-linejoin': 'round',
	class: 'gizmo-arrow',
	filter: FILTERS.gizmo,
};

export const GIZMO_CIRCLE_RADIUS = 5.5;

export const GIZMO_CIRCLE_ATTRS: SvgAttrs = {
	fill: COLORS.background,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thick,
	'pointer-events': 'all',
	class: 'gizmo-circle',
	filter: FILTERS.gizmo,
};

// Fillet Previews & Gizmos
export const FILLET_HIGHLIGHT_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.heavy,
	opacity: 0.8,
	fill: 'none',
	'stroke-linecap': 'round',
	'pointer-events': 'none',
};

export const FILLET_HOVER_POINT_ATTRS: SvgAttrs = {
	fill: COLORS.guideFaint,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'pointer-events': 'none',
};

export const FILLET_WEDGE_ATTRS: SvgAttrs = {
	fill: COLORS.filletWedgeFill,
	stroke: 'none',
	'pointer-events': 'none',
};

export const FILLET_ARC_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thick,
	fill: 'none',
	'stroke-linecap': 'round',
	'pointer-events': 'none',
};

export const FILLET_GIZMO_SQUARE_ATTRS: SvgAttrs = {
	fill: COLORS.background,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.dimension,
	'pointer-events': 'none',
};

// Chamfer Previews & Gizmos
export const CHAMFER_HIGHLIGHT_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.heavy,
	opacity: 0.9,
	fill: 'none',
	'stroke-linecap': 'round',
	'pointer-events': 'none',
};

export const CHAMFER_CUT_LINE_ATTRS: SvgAttrs = {
	stroke: COLORS.construction,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-dasharray': DASH_ARRAY.ray,
	fill: 'none',
	'pointer-events': 'none',
};

export const CHAMFER_HOVER_POINT_ATTRS: SvgAttrs = {
	fill: COLORS.guideFaint,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'pointer-events': 'none',
};

// Offset Previews & Gizmos
export const OFFSET_CHAIN_ATTRS: SvgAttrs = {
	stroke: COLORS.selected,
	'stroke-width': 2.5,
	fill: 'none',
	'stroke-linecap': 'round',
	'pointer-events': 'none',
};

export const OFFSET_PREVIEW_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': '5 3',
	fill: 'none',
	'stroke-linecap': 'round',
	'pointer-events': 'none',
};

// Snap Indicators
export const SNAP_POINT_ATTRS: SvgAttrs = {
	fill: COLORS.pointSnapFill,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
	'pointer-events': 'none',
};

export const SNAP_GRID_ATTRS: SvgAttrs = {
	fill: COLORS.gridSnapFill,
	stroke: COLORS.gridSnapStroke,
	'stroke-width': STROKE_WIDTH.thin,
	'pointer-events': 'none',
};

export const SNAP_OBJECT_ATTRS: SvgAttrs = {
	fill: COLORS.objectSnapFill,
	stroke: COLORS.objectSnapStroke,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-linejoin': 'round',
	'pointer-events': 'none',
};

// Spline SvgAttrs Presets
export const SPLINE_HANDLE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-spline-handle',
	fill: 'none',
	stroke: COLORS.splineHandle,
	'stroke-width': STROKE_WIDTH.splineHandle,
	'stroke-dasharray': DASH_ARRAY.splineHandle,
	'stroke-linecap': 'round',
};

export const SPLINE_HANDLE_SELECTED_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-spline-handle',
	fill: 'none',
	stroke: COLORS.selected,
	'stroke-width': STROKE_WIDTH.splineHandleSelected,
	'stroke-dasharray': 'none',
	'stroke-linecap': 'round',
};

export const SPLINE_CONTROL_POLYGON_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-spline-handle',
	stroke: COLORS.splineHandle,
	'stroke-width': STROKE_WIDTH.splineControlPolygon,
	'stroke-dasharray': DASH_ARRAY.splineControlPolygon,
	fill: 'none',
};

export const SPLINE_PREVIEW_STROKE_ATTRS: SvgAttrs = {
	stroke: COLORS.splinePreview,
	'stroke-width': STROKE_WIDTH.splinePreview,
	fill: 'none',
};

export const SPLINE_PREVIEW_GUIDE_ATTRS: SvgAttrs = {
	stroke: COLORS.splinePreview,
	'stroke-width': STROKE_WIDTH.splinePreviewGuide,
	'stroke-dasharray': DASH_ARRAY.splinePreviewGuide,
	opacity: '0.7',
};

export const SPLINE_PREVIEW_VERTEX_ATTRS: SvgAttrs = {
	fill: COLORS.splinePreview,
	stroke: 'none',
	'stroke-width': 1,
};

export const SPLINE_CHECKMARK_CIRCLE_ATTRS: SvgAttrs = {
	fill: COLORS.splineCheckmarkFill,
	stroke: COLORS.splineCheckmarkStroke,
	'stroke-width': 1.5,
	filter: FILTERS.splineCheckmark,
};

export const SPLINE_CHECKMARK_PATH_ATTRS: SvgAttrs = {
	stroke: COLORS.onAccent,
	'stroke-width': 2,
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
	fill: 'none',
};

// Preview Points
export const PREVIEW_POINT_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.background,
	'stroke-width': STROKE_WIDTH.thin,
};

export const POLYGON_RADIUS_HANDLE_ATTRS: SvgAttrs = {
	fill: COLORS.constrained,
	stroke: COLORS.background,
	'stroke-width': STROKE_WIDTH.thin,
};

export function getSplineHandleStrokeAttrs(isSelected: boolean): SvgAttrs {
	return isSelected ? SPLINE_HANDLE_SELECTED_ATTRS : SPLINE_HANDLE_ATTRS;
}

export function getSplinePreviewStrokeAttrs(isConstruction = false): SvgAttrs {
	return {
		...SPLINE_PREVIEW_STROKE_ATTRS,
		'stroke-dasharray': isConstruction ? DASH_ARRAY.splineConstruction : undefined,
	};
}

export const SPLINE_STYLES = {
	handle: {
		normal: SPLINE_HANDLE_ATTRS,
		selected: SPLINE_HANDLE_SELECTED_ATTRS,
	},
	controlPolygon: SPLINE_CONTROL_POLYGON_ATTRS,
	handleDot: {
		stroke: COLORS.splineHandleDotStroke,
		r: 3,
	},
	closedFill: COLORS.splineClosedFill,
} as const;

export function getCopyStrokeAttrs(
	isConstruction: boolean,
	baseColor: string,
	opacity = 1.0,
	strokeWidth: number = STROKE_WIDTH.normal
): SvgAttrs {
	return {
		...COPY_STROKE_BASE_ATTRS,
		stroke: isConstruction ? COLORS.construction : baseColor,
		'stroke-width': strokeWidth,
		'stroke-dasharray': isConstruction ? DASH_ARRAY.construction : undefined,
		opacity,
	};
}

export function getPrimitiveStrokeAttrs(
	isSelected: boolean,
	isConstruction: boolean,
	baseColor: string,
	roundCap = false
): SvgAttrs {
	return {
		class: 'entity-visible visible-primitive',
		fill: 'none',
		stroke: isSelected ? COLORS.selected : isConstruction ? COLORS.construction : baseColor,
		'stroke-width': isSelected
			? STROKE_WIDTH.selected
			: isConstruction
				? STROKE_WIDTH.construction
				: STROKE_WIDTH.normal,
		'stroke-linecap': roundCap ? 'round' : undefined,
		'stroke-dasharray': isConstruction ? DASH_ARRAY.construction : undefined,
		'pointer-events': 'stroke',
	};
}

export function getPreviewStrokeAttrs(isConstruction = false, isGuide = false, roundCap = false): SvgAttrs {
	return {
		stroke: isGuide ? COLORS.primary : isConstruction ? COLORS.construction : COLORS.unconstrained,
		'stroke-width': !isGuide && isConstruction ? STROKE_WIDTH.construction : STROKE_WIDTH.normal,
		'stroke-linecap': roundCap ? 'round' : undefined,
		'stroke-dasharray': isGuide ? DASH_ARRAY.guideCircle : isConstruction ? DASH_ARRAY.construction : undefined,
		fill: 'none',
	};
}

export function applyDrawingLineStyle(attrs: SvgAttrs, type: LineType): SvgAttrs {
	if (!isDrawingLineType(type)) return attrs;
	const { dash, canvasWidthFactor } = DRAWING_LINE_STYLES[type];
	return {
		...attrs,
		'stroke-dasharray': dash.join(' '),
		'stroke-width': Number(attrs['stroke-width'] ?? STROKE_WIDTH.normal) * canvasWidthFactor,
	};
}

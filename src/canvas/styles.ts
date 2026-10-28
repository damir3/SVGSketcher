export const SVG_NS = 'http://www.w3.org/2000/svg';

// ==========================================
// Styling Constants & Design Tokens
// ==========================================

export const COLORS = {
	primary: '#0284c7', // Sky-600: main active CAD color (selection, dimensions, rays)
	selected: '#0ea5e9', // Sky-500: selected constraint/dimension/accent
	selectedBg: '#e0f2fe', // Sky-100: selected badge fill
	unconstrained: '#1e293b', // Slate-800: normal unconstrained geometry
	constrained: '#16a34a', // Green-600: fully constrained geometry & vertices
	conflict: '#dc2626', // Red-600: overconstrained error
	construction: '#64748b', // Slate-500: construction geometry & auxiliary rings
	fixed: '#d97706', // Amber-600: fixed points / badges
	badgeBorder: '#cbd5e1', // Slate-300: default badge border
	badgeText: '#475569', // Slate-600: default badge text
	tooltipBg: '#0f172a', // Slate-900: tooltip background
	white: '#ffffff',
	hitTransparent: 'rgba(0, 0, 0, 0.001)',
	guideFaint: 'rgba(2, 132, 199, 0.25)',
	guideStartEllipse: 'rgba(2, 132, 199, 0.3)',
	extLineDim: 'rgba(2, 132, 199, 0.45)',
	selectionBoxFill: 'rgba(14, 165, 233, 0.12)',
	pointSnapFill: 'rgba(2, 132, 199, 0.2)',
	objectSnapFill: 'rgba(16, 185, 129, 0.25)',
	objectSnapStroke: '#0e9c6d',
	gridSnapFill: 'rgba(99, 102, 241, 0.15)',
	gridSnapStroke: '#7cbdfa',
	xAxis: 'rgba(220, 38, 38, 0.65)',
	yAxis: 'rgba(22, 163, 74, 0.65)',
	originQuarter: 'rgba(100, 116, 139, 0.45)',
	gridMinor: 'rgba(0, 0, 0, 0.08)',
	gridMajor: 'rgba(0, 0, 0, 0.20)',
	gridLabel: 'rgba(0, 0, 0, 0.6)',
	trim: 'rgba(255, 0, 0, 0.75)',

	// Spline styles and colors
	splineHandle: '#84cc16', // Amber-700: tangent handle & control polygon idle stroke
	splineHandleSelected: '#0284c7', // Sky-600: selected tangent handle stroke
	splineHandleDotFill: '#22c55e', // Green-500: tangent handle endpoint dot fill
	splineHandleDotStroke: 'none',
	splineClosedFill: 'rgba(56, 189, 248, 0.12)', // Sky-400 12%: closed spline fill
	splinePreview: '#84cc16', // Lime-500: spline drawing preview stroke
	splineCheckmarkFill: '#22c55e', // Green-500: spline completion checkmark fill
	splineCheckmarkStroke: '#16a34a', // Green-600: spline completion checkmark border

	// Mirror & Patterns
	mirrorLine: '#f59e0b', // Amber-500: mirror axis line
	patternCenter: '#f59e0b', // Amber-500: circular pattern center marker
	patternAxis1: '#2563eb', // Blue-600: rectangular pattern direction 1 axis
	patternAxis2: '#059669', // Emerald-600: rectangular pattern direction 2 axis
	checkboxActiveFill: '#2563eb', // Blue-600: active suppression checkbox fill
	checkboxActiveStroke: '#1d4ed8', // Blue-700: active suppression checkbox stroke
	checkboxSuppressedFill: '#f8fafc', // Slate-50: suppressed checkbox fill
	checkboxSuppressedStroke: '#94a3b8', // Slate-400: suppressed checkbox border
	checkboxSuppressedDash: '#ef4444', // Red-500: suppressed checkbox minus dash
	labelSlate: '#f8fafc', // Slate-50: label text on dark pills

	// Fillet
	filletWedgeFill: 'rgba(2, 132, 199, 0.16)', // Sky-600 16%: corner wedge fill
} as const;

export const DASH_ARRAY = {
	construction: '6,6',
	ray: '2,2',
	axis: '3,3',
	guide: '2,4',
	guideCircle: '4,4',
	angleExtension: '4,4',
	selectionBox: '4 3',
	splineHandle: '4 3',
	splineControlPolygon: '4 3',
	splinePreviewGuide: '3 3',
	splineConstruction: '6 4',
	mirrorLine: '6 3',
	directionLine: '6 3',
	patternCenterRing: '4 2',
	filletGizmo: '4 4',
	symmetryChord: '3 3',
} as const;

export const STROKE_WIDTH = {
	minorGrid: 0.75,
	thin: 1,
	majorGrid: 1,
	dimension: 1,
	normal: 1.5,
	thick: 2,
	selected: 2,
	trim: 2,
	heavy: 3,
	hitArea: 18,
	splineHandle: 1,
	splineHandleSelected: 2,
	splineControlPolygon: 1.5,
	splinePreview: 1.5,
	splinePreviewGuide: 1.2,
} as const;

export const FILTERS = {
	splineCheckmark: 'drop-shadow(0 1px 3px rgba(0,0,0,0.25))',
	gizmoArrow: 'drop-shadow(0 2px 5px rgba(0,0,0,0.35))',
	filletGizmoArrow: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
	checkboxHalo: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
} as const;

export const DIM_ARROWS = {
	default: 'url(#dim-arrow)',
	selected: 'url(#dim-arrow-selected)',
} as const;

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
	'stroke-dasharray': DASH_ARRAY.ray,
};

export const TRIM_STROKE_ATTRS: SvgAttrs = {
	stroke: COLORS.trim,
	'stroke-width': STROKE_WIDTH.trim,
	'stroke-linecap': 'round',
	fill: 'none',
	'pointer-events': 'none',
};

export const CUT_MARKER_ATTRS: SvgAttrs = {
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

export const SYMMETRY_CHORD_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': 1.2,
	'stroke-dasharray': DASH_ARRAY.symmetryChord,
	opacity: 0.7,
	'pointer-events': 'none',
};

// Mirror & Direction Lines
export const MIRROR_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive is-mirror-line',
	fill: 'none',
	stroke: COLORS.mirrorLine,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.mirrorLine,
	'stroke-linecap': 'round',
};

export const DIR1_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive is-direction-line is-dir1-line',
	fill: 'none',
	stroke: COLORS.patternAxis1,
	'stroke-width': STROKE_WIDTH.thick,
	'stroke-dasharray': DASH_ARRAY.directionLine,
	'stroke-linecap': 'round',
};

export const DIR2_LINE_ATTRS: SvgAttrs = {
	class: 'entity-visible visible-primitive is-direction-line is-dir2-line',
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
	stroke: COLORS.white,
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
	stroke: COLORS.white,
	'stroke-width': STROKE_WIDTH.dimension,
	'pointer-events': 'none',
};

export const CHECKBOX_HALO_ATTRS: SvgAttrs = {
	rx: 5,
	fill: COLORS.white,
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
	stroke: COLORS.white,
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

export const FILLET_GIZMO_CENTER_ATTRS: SvgAttrs = {
	fill: COLORS.white,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'pointer-events': 'none',
};

export const FILLET_GIZMO_RADIAL_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.normal,
	'stroke-dasharray': DASH_ARRAY.filletGizmo,
	'pointer-events': 'none',
};

export const FILLET_GIZMO_SQUARE_ATTRS: SvgAttrs = {
	fill: COLORS.white,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.dimension,
	'pointer-events': 'none',
};

export const FILLET_GIZMO_ARROW_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.white,
	'stroke-width': STROKE_WIDTH.dimension,
	'stroke-linejoin': 'round',
	class: 'fillet-gizmo-arrow',
	filter: FILTERS.filletGizmoArrow,
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

// Tooltip
export const TOOLTIP_RECT_ATTRS: SvgAttrs = {
	rx: 4,
	fill: COLORS.tooltipBg,
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
};

export const TOOLTIP_TEXT_ATTRS: SvgAttrs = {
	'text-anchor': 'middle',
	fill: COLORS.white,
	'font-size': 11,
	'font-weight': 500,
	'font-family': 'monospace',
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
	stroke: COLORS.splineHandleSelected,
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
	stroke: COLORS.white,
	'stroke-width': 2,
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
	fill: 'none',
};

// Polygon Preview
export const POLYGON_VERTEX_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.white,
	'stroke-width': STROKE_WIDTH.thin,
};

export const POLYGON_CENTER_ATTRS: SvgAttrs = {
	fill: COLORS.primary,
	stroke: COLORS.white,
	'stroke-width': STROKE_WIDTH.thin,
};

export const POLYGON_RADIUS_HANDLE_ATTRS: SvgAttrs = {
	fill: COLORS.constrained,
	stroke: COLORS.white,
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
		fill: COLORS.splineHandleDotFill,
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
		stroke: isSelected ? COLORS.primary : isConstruction ? COLORS.construction : baseColor,
		'stroke-width': isSelected ? STROKE_WIDTH.selected : STROKE_WIDTH.normal,
		'stroke-linecap': roundCap ? 'round' : undefined,
		'stroke-dasharray': isConstruction ? DASH_ARRAY.construction : undefined,
		'pointer-events': 'stroke',
	};
}

export function getPreviewStrokeAttrs(
	isConstruction = false,
	isGuide = false,
	roundCap = false
): SvgAttrs {
	return {
		stroke: isGuide ? COLORS.primary : isConstruction ? COLORS.construction : COLORS.unconstrained,
		'stroke-width': STROKE_WIDTH.normal,
		'stroke-linecap': roundCap ? 'round' : undefined,
		'stroke-dasharray': isGuide ? DASH_ARRAY.guideCircle : isConstruction ? DASH_ARRAY.construction : undefined,
		fill: 'none',
	};
}

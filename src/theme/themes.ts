// ==========================================
// Color Themes
// ==========================================
//
// A theme is a pure color palette: it never controls stroke widths, dash
// patterns or any other geometry of the drawing. Every token is exposed as a
// CSS custom property on the document root, so both the stylesheet and the SVG
// canvas (via presentation attributes such as `stroke="var(--canvas-primary)"`)
// follow the active theme without re-rendering.
//
// To add a theme: declare a `Theme` object below (TypeScript enforces that
// every token is provided) and append it to `THEMES`.

/** Colors of the drawing canvas, exposed as `--canvas-<kebab-case-key>`. */
const LIGHT_CANVAS = {
	primary: '#0284c7', // main active CAD color (selection, dimensions, rays)
	selected: '#0ea5e9', // selected constraint/dimension/accent
	selectedHover: '#38bdf8', // hovered selected entity / highlighted tangent targets
	selectedBg: '#e0f2fe', // selected badge fill
	background: '#ffffff', // canvas background; also fill/halo of points, badges and gizmos
	onAccent: '#ffffff', // marks drawn on top of accent fills (checkmarks)
	unconstrained: '#1e293b', // normal unconstrained geometry
	constrained: '#16a34a', // fully constrained geometry & vertices
	conflict: '#dc2626', // overconstrained error
	construction: '#64748b', // construction geometry & auxiliary rings
	fixed: '#d97706', // fixed points / badges
	delete: 'rgba(255, 0, 0, 0.85)', // delete tool hover
	deleteBg: 'rgba(255, 220, 220, 0.95)', // delete tool hover badge fill
	badgeBorder: '#cbd5e1', // default badge border
	badgeText: '#475569', // default badge text
	tooltipBg: '#0f172a', // pill background
	labelSlate: '#f8fafc', // label text on pills
	guideFaint: 'rgba(2, 132, 199, 0.25)',
	guideStartEllipse: 'rgba(2, 132, 199, 0.3)',
	extLineDim: 'rgba(2, 132, 199, 1)',
	selectionBoxFill: 'rgba(14, 165, 233, 0.12)',
	crossingSelectionBoxFill: 'rgba(22, 163, 74, 0.12)',
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
	regionFill: '#888888',
	regionHoverFill: '#bae6fd',

	// Splines
	splineHandle: '#84cc16', // tangent handle & control polygon idle stroke
	splineHandleDotStroke: '#22c55e', // tangent handle endpoint outline
	splineClosedFill: 'rgba(56, 189, 248, 0.12)', // closed spline fill
	splinePreview: '#84cc16', // spline drawing preview stroke
	splineCheckmarkFill: '#22c55e', // spline completion checkmark fill
	splineCheckmarkStroke: '#16a34a', // spline completion checkmark border

	// Mirror & Patterns
	mirrorLine: '#f59e0b', // mirror axis line
	patternCenter: '#f59e0b', // circular pattern center marker
	patternAxis1: '#2563eb', // rectangular pattern direction 1 axis
	patternAxis2: '#059669', // rectangular pattern direction 2 axis
	checkboxActiveFill: '#2563eb', // active suppression checkbox fill
	checkboxActiveStroke: '#1d4ed8', // active suppression checkbox stroke
	checkboxSuppressedFill: '#f8fafc', // suppressed checkbox fill
	checkboxSuppressedStroke: '#94a3b8', // suppressed checkbox border
	checkboxSuppressedDash: '#ef4444', // suppressed checkbox minus dash

	// Fillet
	filletWedgeFill: 'rgba(2, 132, 199, 0.16)', // corner wedge fill
};

export type CanvasColorToken = keyof typeof LIGHT_CANVAS;
export type CanvasColors = Readonly<Record<CanvasColorToken, string>>;

/** Colors of the application chrome, exposed as `--<key>`. */
const LIGHT_UI = {
	'bg-app': '#ffffff',
	'bg-surface': '#ffffff',
	'bg-surface-elevated': '#f8fafc',
	'bg-surface-hover': '#f1f5f9',
	'hover-overlay': 'rgba(0, 0, 0, 0.05)',
	'border-color': '#e2e8f0',
	'border-strong': '#cbd5e1',

	'text-primary': '#0f172a',
	'text-secondary': '#475569',
	'text-muted': '#94a3b8',
	'text-on-accent': '#ffffff',

	'cad-blue': '#0284c7',
	'cad-blue-hover': '#0369a1',
	'cad-blue-bright': '#0ea5e9',
	'cad-blue-light': '#38bdf8',
	'cad-blue-border': '#7dd3fc',
	'cad-blue-soft': '#e0f2fe',
	'cad-blue-soft-hover': '#bae6fd',
	'cad-blue-subtle': '#f0f9ff',
	'cad-info': '#2563eb',

	'cad-green': '#16a34a',
	'cad-green-soft': '#dcfce7',
	'cad-green-border': '#86efac',

	'cad-amber': '#d97706',
	'cad-amber-text': '#92400e',
	'cad-amber-soft': '#fffbeb',
	'cad-amber-border': '#fde68a',

	'cad-red': '#dc2626',
	'cad-red-bright': '#ef4444',
	'cad-red-solid': '#dc2626',
	'cad-red-solid-hover': '#b91c1c',
	'cad-red-soft': '#fee2e2',
	'cad-red-subtle': '#fef2f2',
	'cad-red-border': '#fca5a5',
	'cad-red-border-soft': '#fecaca',

	'tooltip-bg': '#0f172a',
	'tooltip-text': '#f8fafc',
	'tooltip-border': '#1e293b',

	'icon-accent': '#0284c7',
	'icon-accent-light': '#38bdf8',
	'icon-outline': '#0f172a',
	'icon-secondary': '#b45309',
};

export type UiColorToken = keyof typeof LIGHT_UI;
export type UiColors = Readonly<Record<UiColorToken, string>>;

export interface Theme {
	readonly id: string;
	readonly label: string;
	/** Native widgets (scrollbars, form controls) palette. */
	readonly colorScheme: 'light' | 'dark';
	readonly ui: UiColors;
	readonly canvas: CanvasColors;
}

export const LIGHT_THEME: Theme = {
	id: 'light',
	label: 'Light',
	colorScheme: 'light',
	ui: LIGHT_UI,
	canvas: LIGHT_CANVAS,
};

export const DARK_THEME: Theme = {
	id: 'dark',
	label: 'Dark',
	colorScheme: 'dark',
	ui: {
		'bg-app': '#0b1120',
		'bg-surface': '#111827',
		'bg-surface-elevated': '#1a2333',
		'bg-surface-hover': '#243045',
		'hover-overlay': 'rgba(255, 255, 255, 0.06)',
		'border-color': '#273449',
		'border-strong': '#3b4a61',

		'text-primary': '#e2e8f0',
		'text-secondary': '#a3b1c6',
		'text-muted': '#6b7a90',
		'text-on-accent': '#04131f',

		'cad-blue': '#38bdf8',
		'cad-blue-hover': '#7dd3fc',
		'cad-blue-bright': '#7dd3fc',
		'cad-blue-light': '#0ea5e9',
		'cad-blue-border': '#0369a1',
		'cad-blue-soft': 'rgba(56, 189, 248, 0.16)',
		'cad-blue-soft-hover': 'rgba(56, 189, 248, 0.26)',
		'cad-blue-subtle': 'rgba(56, 189, 248, 0.08)',
		'cad-info': '#60a5fa',

		'cad-green': '#4ade80',
		'cad-green-soft': 'rgba(74, 222, 128, 0.14)',
		'cad-green-border': 'rgba(74, 222, 128, 0.4)',

		'cad-amber': '#fbbf24',
		'cad-amber-text': '#fcd34d',
		'cad-amber-soft': 'rgba(251, 191, 36, 0.1)',
		'cad-amber-border': 'rgba(251, 191, 36, 0.35)',

		'cad-red': '#f87171',
		'cad-red-bright': '#f87171',
		'cad-red-solid': '#dc2626',
		'cad-red-solid-hover': '#ef4444',
		'cad-red-soft': 'rgba(248, 113, 113, 0.16)',
		'cad-red-subtle': 'rgba(248, 113, 113, 0.1)',
		'cad-red-border': 'rgba(248, 113, 113, 0.45)',
		'cad-red-border-soft': 'rgba(248, 113, 113, 0.3)',

		'tooltip-bg': '#273449',
		'tooltip-text': '#f1f5f9',
		'tooltip-border': '#3b4a61',

		'icon-accent': '#38bdf8',
		'icon-accent-light': '#7dd3fc',
		'icon-outline': '#0b1120',
		'icon-secondary': '#f59e0b',
	},
	canvas: {
		primary: '#38bdf8',
		selected: '#7dd3fc',
		selectedHover: '#bae6fd',
		selectedBg: '#0c4a6e',
		background: '#0b1120',
		onAccent: '#ffffff',
		unconstrained: '#e2e8f0',
		constrained: '#4ade80',
		conflict: '#f87171',
		construction: '#8a99ad',
		fixed: '#fbbf24',
		delete: 'rgba(248, 113, 113, 0.95)',
		deleteBg: 'rgba(127, 29, 29, 0.95)',
		badgeBorder: '#3b4a61',
		badgeText: '#cbd5e1',
		tooltipBg: '#334155',
		labelSlate: '#f8fafc',
		guideFaint: 'rgba(56, 189, 248, 0.3)',
		guideStartEllipse: 'rgba(56, 189, 248, 0.35)',
		extLineDim: 'rgba(56, 189, 248, 1)',
		selectionBoxFill: 'rgba(125, 211, 252, 0.12)',
		crossingSelectionBoxFill: 'rgba(74, 222, 128, 0.12)',
		pointSnapFill: 'rgba(56, 189, 248, 0.25)',
		objectSnapFill: 'rgba(52, 211, 153, 0.25)',
		objectSnapStroke: '#34d399',
		gridSnapFill: 'rgba(129, 140, 248, 0.2)',
		gridSnapStroke: '#93c5fd',
		xAxis: 'rgba(248, 113, 113, 0.7)',
		yAxis: 'rgba(74, 222, 128, 0.7)',
		originQuarter: 'rgba(148, 163, 184, 0.5)',
		gridMinor: 'rgba(255, 255, 255, 0.06)',
		gridMajor: 'rgba(255, 255, 255, 0.14)',
		gridLabel: 'rgba(255, 255, 255, 0.6)',
		trim: 'rgba(248, 113, 113, 0.9)',
		regionFill: '#94a3b8',
		regionHoverFill: '#0284c7',

		splineHandle: '#a3e635',
		splineHandleDotStroke: '#4ade80',
		splineClosedFill: 'rgba(56, 189, 248, 0.12)',
		splinePreview: '#a3e635',
		splineCheckmarkFill: '#22c55e',
		splineCheckmarkStroke: '#16a34a',

		mirrorLine: '#fbbf24',
		patternCenter: '#fbbf24',
		patternAxis1: '#60a5fa',
		patternAxis2: '#34d399',
		checkboxActiveFill: '#3b82f6',
		checkboxActiveStroke: '#60a5fa',
		checkboxSuppressedFill: '#1a2333',
		checkboxSuppressedStroke: '#64748b',
		checkboxSuppressedDash: '#f87171',

		filletWedgeFill: 'rgba(56, 189, 248, 0.18)',
	},
};

/** Registered themes; the first one is the default. */
export const THEMES: readonly Theme[] = [LIGHT_THEME, DARK_THEME];

export const DEFAULT_THEME = THEMES[0];

export function findTheme(id: string | null | undefined): Theme | undefined {
	return THEMES.find(theme => theme.id === id);
}

export const CANVAS_COLOR_TOKENS = Object.keys(LIGHT_CANVAS) as CanvasColorToken[];

function kebabCase(name: string): string {
	return name.replace(/[A-Z0-9]+/g, match => `-${match.toLowerCase()}`);
}

/** CSS custom property name of a canvas color token, e.g. `--canvas-selected-bg`. */
export function canvasColorVariable(token: CanvasColorToken): string {
	return `--canvas-${kebabCase(token)}`;
}

/** All CSS custom properties defined by a theme. */
export function themeCssVariables(theme: Theme): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const [token, value] of Object.entries(theme.ui)) vars[`--${token}`] = value;
	for (const token of CANVAS_COLOR_TOKENS) vars[canvasColorVariable(token)] = theme.canvas[token];
	return vars;
}

/**
 * Replaces canvas color variable references (`var(--canvas-…)`) with concrete
 * colors of the given theme, for markup that leaves the document (SVG export).
 */
export function resolveCanvasColorVariables(markup: string, theme: Theme = DEFAULT_THEME): string {
	return markup.replace(/var\((--canvas-[a-z0-9-]+)\)/g, (match, name: string) => {
		const token = CANVAS_COLOR_TOKENS.find(t => canvasColorVariable(t) === name);
		return token ? theme.canvas[token] : match;
	});
}

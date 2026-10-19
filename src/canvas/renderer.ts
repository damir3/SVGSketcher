import type { SketchDocument } from '../model/sketch';
import type { Viewport } from './viewport';
import {
	DistanceConstraint,
	RadiusConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	EqualLengthConstraint,
	EqualRadiusConstraint,
	TangentLineCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	FixedConstraint,
	CoincidentConstraint,
	AngleConstraint,
	PointToLineDistanceConstraint,
} from '../solver/constraints';
import { type Vec2, dist, projectPointOntoSegment } from '../math/vector';
import { getBadgeIcon } from './badgeIcons';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const TWO_PI = 2 * Math.PI;

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
} as const;

export const DASH_ARRAY = {
	construction: '6,6',
	ray: '2,2',
	axis: '3,3',
	guide: '2,4',
	guideCircle: '4,4',
	angleExtension: '4,4',
	selectionBox: '4 3',
} as const;

export const STROKE_WIDTH = {
	minorGrid: 0.75,
	thin: 1,
	majorGrid: 1.2,
	normal: 2,
	selected: 3.5,
	dimension: 1.5,
	hitArea: 18,
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
};

export const AUX_AXIS_ATTRS: SvgAttrs = {
	stroke: COLORS.primary,
	'stroke-width': STROKE_WIDTH.thin,
	'stroke-dasharray': DASH_ARRAY.axis,
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

function fmtCoord(v: number | string): string {
	return typeof v === 'number' ? (Number.isInteger(v) ? v.toString() : v.toFixed(1)) : String(v);
}

/**
 * Creates an SVG element with attributes, optional parent to append to, and optional textContent.
 */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs?: SvgAttrs,
	parent?: SVGElement,
	textContent?: string
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (const [key, val] of Object.entries(attrs)) {
			if (val !== undefined && val !== null) {
				const sVal = String(val);
				el.setAttribute(key, sVal);
				if (key === 'pointer-events') {
					el.style.pointerEvents = sVal;
				}
			}
		}
	}
	if (textContent !== undefined) {
		el.textContent = textContent;
	}
	if (parent) {
		parent.appendChild(el);
	}
	return el;
}

export function createSvgLine(
	x1: number | string,
	y1: number | string,
	x2: number | string,
	y2: number | string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGLineElement {
	return createSvgElement(
		'line',
		{
			x1: fmtCoord(x1),
			y1: fmtCoord(y1),
			x2: fmtCoord(x2),
			y2: fmtCoord(y2),
			...attrs,
		},
		parent
	);
}

export function createSvgCircle(
	cx: number | string,
	cy: number | string,
	r: number | string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGCircleElement {
	return createSvgElement(
		'circle',
		{
			cx: fmtCoord(cx),
			cy: fmtCoord(cy),
			r: fmtCoord(r),
			...attrs,
		},
		parent
	);
}

export function createSvgRect(
	x: number | string,
	y: number | string,
	width: number | string,
	height: number | string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGRectElement {
	return createSvgElement(
		'rect',
		{
			x: fmtCoord(x),
			y: fmtCoord(y),
			width: fmtCoord(width),
			height: fmtCoord(height),
			...attrs,
		},
		parent
	);
}

export function createSvgEllipse(
	cx: number | string,
	cy: number | string,
	rx: number | string,
	ry: number | string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGEllipseElement {
	return createSvgElement(
		'ellipse',
		{
			cx: fmtCoord(cx),
			cy: fmtCoord(cy),
			rx: fmtCoord(rx),
			ry: fmtCoord(ry),
			...attrs,
		},
		parent
	);
}

export function createSvgPath(
	d: string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGPathElement {
	return createSvgElement(
		'path',
		{
			d,
			...attrs,
		},
		parent
	);
}

export function createSvgText(
	x: number | string,
	y: number | string,
	text: string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGTextElement {
	return createSvgElement(
		'text',
		{
			x: fmtCoord(x),
			y: fmtCoord(y),
			...attrs,
		},
		parent,
		text
	);
}

export interface RenderOptions {
	showGrid?: boolean;
	showConstraints?: boolean;
	showDimensions?: boolean;
}

export function getArcSvgPath(sc: Vec2, ss: Vec2, se: Vec2, sr: number, clockwise: boolean): string {
	const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
	const ae = Math.atan2(se.y - sc.y, se.x - sc.x);

	let sweepAngle = 0;
	const sweepFlag = clockwise ? 1 : 0;
	if (clockwise) {
		sweepAngle = (ae - as) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	} else {
		sweepAngle = (as - ae) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	}

	// For arcs up to 135°, standard SVG arc command is completely stable
	if (sweepAngle <= Math.PI * 0.75) {
		return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
	}

	// For larger arcs (> 135°, including 180° and near 360°):
	// Split at the exact geometric midpoint into two sub-arcs (each <= 180°).
	// This avoids the SVG endpoint-to-center singularity at 180° (where endpoints are diameter-apart)
	// and at 360° (where endpoints coincide and SVG drops the arc).
	const midAngle = clockwise ? as + sweepAngle * 0.5 : as - sweepAngle * 0.5;
	const mx = sc.x + sr * Math.cos(midAngle);
	const my = sc.y + sr * Math.sin(midAngle);

	return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${mx.toFixed(2)} ${my.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
}

export function getEllipticalArcSvgPath(
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2,
	se: Vec2,
	clockwise: boolean
): string {
	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	if (rx < 0.1 || ry < 0.1) return '';

	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const thetaDeg = (theta * 180) / Math.PI;

	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
	const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
	const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
	const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

	const ts = Math.atan2(vs / ry, us / rx);
	const te = Math.atan2(ve / ry, ue / rx);

	let sweepAngle = 0;
	const sweepFlag = clockwise ? 1 : 0;
	if (clockwise) {
		sweepAngle = (te - ts) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	} else {
		sweepAngle = (ts - te) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	}

	if (sweepAngle <= Math.PI * 0.75) {
		return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
	}

	const tmid = clockwise ? ts + sweepAngle * 0.5 : ts - sweepAngle * 0.5;
	const umid = rx * Math.cos(tmid);
	const vmid = ry * Math.sin(tmid);
	const mx = sc.x + umid * ux + vmid * vx;
	const my = sc.y + umid * uy + vmid * vy;

	return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${mx.toFixed(2)} ${my.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
}

interface LinearDimensionGeometry {
	d1: Vec2;
	d2: Vec2;
	extensionLines: Array<{ from: Vec2; to: Vec2 }>;
}

interface LinearDimensionVisualOptions {
	d1: Vec2;
	d2: Vec2;
	label: string;
	extensionLines?: Array<{ from: Vec2; to: Vec2 }>;
	parent: SVGElement;
	isSelected?: boolean;
	constraintId?: string;
	isTooltip?: boolean;
	startPointHighlight?: Vec2;
	targetPointSnapped?: boolean;
}

function formatDimensionValue(val: number): string {
	return Number.isInteger(val) ? val.toFixed(1) : Number(val.toFixed(2)).toString();
}

function computeDistanceDimensionGeometry(
	s1: Vec2,
	s2: Vec2,
	orientation: 'aligned' | 'horizontal' | 'vertical' | 'direct',
	screenOffset = 0,
	cursor?: Vec2
): LinearDimensionGeometry | null {
	if (orientation === 'direct') {
		return {
			d1: s1,
			d2: s2,
			extensionLines: [],
		};
	}

	let d1: Vec2;
	let d2: Vec2;
	let extEnd1: Vec2;
	let extEnd2: Vec2;

	if (orientation === 'horizontal') {
		const midY = (s1.y + s2.y) * 0.5;
		const dimY = cursor ? cursor.y : midY + screenOffset;
		d1 = { x: s1.x, y: dimY };
		d2 = { x: s2.x, y: dimY };
		const extDir = dimY >= midY ? 1 : -1;
		extEnd1 = { x: s1.x, y: dimY + extDir * 4 };
		extEnd2 = { x: s2.x, y: dimY + extDir * 4 };
	} else if (orientation === 'vertical') {
		const midX = (s1.x + s2.x) * 0.5;
		const dimX = cursor ? cursor.x : midX + screenOffset;
		d1 = { x: dimX, y: s1.y };
		d2 = { x: dimX, y: s2.y };
		const extDir = dimX >= midX ? 1 : -1;
		extEnd1 = { x: dimX + extDir * 4, y: s1.y };
		extEnd2 = { x: dimX + extDir * 4, y: s2.y };
	} else {
		const dx = s2.x - s1.x;
		const dy = s2.y - s1.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-4) return null;

		const nx = -dy / len;
		const ny = dx / len;
		const midX = (s1.x + s2.x) * 0.5;
		const midY = (s1.y + s2.y) * 0.5;
		const offset = cursor ? (cursor.x - midX) * nx + (cursor.y - midY) * ny : screenOffset;

		d1 = { x: s1.x + nx * offset, y: s1.y + ny * offset };
		d2 = { x: s2.x + nx * offset, y: s2.y + ny * offset };
		const extDir = offset >= 0 ? 4 : -4;
		extEnd1 = { x: d1.x + nx * extDir, y: d1.y + ny * extDir };
		extEnd2 = { x: d2.x + nx * extDir, y: d2.y + ny * extDir };
	}

	return {
		d1,
		d2,
		extensionLines: [
			{ from: s1, to: extEnd1 },
			{ from: s2, to: extEnd2 },
		],
	};
}

function computePointToLineDimensionGeometry(
	sp: Vec2,
	s1: Vec2,
	s2: Vec2,
	screenOffset = 0,
	cursor?: Vec2
): LinearDimensionGeometry | null {
	const dx = s2.x - s1.x;
	const dy = s2.y - s1.y;
	const lineLen = Math.hypot(dx, dy);
	if (lineLen < 1e-4) return null;

	const ux = dx / lineLen;
	const uy = dy / lineLen;

	const tProj = (sp.x - s1.x) * ux + (sp.y - s1.y) * uy;
	let tDim = cursor ? (cursor.x - s1.x) * ux + (cursor.y - s1.y) * uy : tProj + screenOffset;

	// Ensure there is always a visible offset / выноска if none was specified or cursor is directly at projection
	if (Math.abs(tDim - tProj) < 2) {
		const defaultOffset = (tProj < lineLen * 0.5 ? 25 : -25);
		tDim = tProj + (screenOffset !== 0 ? screenOffset : defaultOffset);
	}

	const dBase = { x: s1.x + ux * tDim, y: s1.y + uy * tDim };
	const hx = sp.x - (s1.x + ux * tProj);
	const hy = sp.y - (s1.y + uy * tProj);
	const dTop = { x: dBase.x + hx, y: dBase.y + hy };

	const extensionLines: Array<{ from: Vec2; to: Vec2 }> = [];

	// Extension line from point to dTop if offset along line
	if (Math.abs(tDim - tProj) > 2) {
		const extDir = tDim >= tProj ? 1 : -1;
		extensionLines.push({
			from: sp,
			to: { x: dTop.x + ux * extDir * 4, y: dTop.y + uy * extDir * 4 },
		});
	}

	// Extension line along line if dBase is beyond segment endpoints
	if (tDim < 0) {
		extensionLines.push({
			from: s1,
			to: { x: dBase.x - ux * 4, y: dBase.y - uy * 4 },
		});
	} else if (tDim > lineLen) {
		extensionLines.push({
			from: s2,
			to: { x: dBase.x + ux * 4, y: dBase.y + uy * 4 },
		});
	}

	return {
		d1: dBase,
		d2: dTop,
		extensionLines,
	};
}

export class SVGRenderer {
	private svg: SVGSVGElement;
	private defsEl: SVGDefsElement;
	private gridGroup: SVGGElement;
	private geometryGroup: SVGGElement;
	private constraintGroup: SVGGElement;
	private pointGroup: SVGGElement;
	private previewGroup: SVGGElement;
	private overlayGroup: SVGGElement;

	constructor(svgElement: SVGSVGElement) {
		this.svg = svgElement;
		this.svg.innerHTML = '';

		// Create defs for markers and filters
		this.defsEl = createSvgElement('defs', undefined, this.svg);
		this.setupDefs();

		this.gridGroup = this.createGroup('grid-layer');
		this.gridGroup.style.pointerEvents = 'none';

		this.geometryGroup = this.createGroup('geometry-layer');
		this.constraintGroup = this.createGroup('constraint-layer');
		this.pointGroup = this.createGroup('point-layer');

		this.previewGroup = this.createGroup('preview-layer');
		this.previewGroup.style.pointerEvents = 'none';

		this.overlayGroup = this.createGroup('overlay-layer');
		this.overlayGroup.style.pointerEvents = 'none';

		this.svg.appendChild(this.gridGroup);
		this.svg.appendChild(this.geometryGroup);
		this.svg.appendChild(this.constraintGroup);
		this.svg.appendChild(this.pointGroup);
		this.svg.appendChild(this.previewGroup);
		this.svg.appendChild(this.overlayGroup);
	}

	private createGroup(className: string): SVGGElement {
		return createSvgElement('g', { class: className });
	}

	private setupDefs(): void {
		const createArrowMarker = (id: string, color: string) => {
			const marker = createSvgElement('marker', {
				id,
				viewBox: '0 0 12.5 10',
				refX: '12.5',
				refY: '5',
				markerWidth: '7.5',
				markerHeight: '6',
				orient: 'auto-start-reverse',
			}, this.defsEl);

			createSvgPath('M 0 1.5 L 12.5 5 L 0 8.5 z', { fill: color }, marker);
		};

		createArrowMarker('dim-arrow', COLORS.primary);
		createArrowMarker('dim-arrow-selected', COLORS.selected);
	}

	render(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
		this.renderGrid(viewport, options.showGrid ?? true);
		this.renderGeometry(sketch, viewport);
		if (options.showConstraints !== false) {
			this.renderConstraints(sketch, viewport);
		}
	}

	private renderGrid(viewport: Viewport, showGrid: boolean): void {
		this.gridGroup.innerHTML = '';
		if (!showGrid) return;

		const { step, subStep } = viewport.getGridStep();
		const minWorld = viewport.screenToWorld(0, viewport.height);
		const maxWorld = viewport.screenToWorld(viewport.width, 0);

		const startX = Math.floor(minWorld.x / subStep) * subStep;
		const endX = Math.ceil(maxWorld.x / subStep) * subStep;
		const startY = Math.floor(minWorld.y / subStep) * subStep;
		const endY = Math.ceil(maxWorld.y / subStep) * subStep;

		const subStepPx = subStep * viewport.zoom;
		const showSubGrid = subStepPx >= 6;

		// 1. Minor grid lines (every subStep)
		let dMinor = '';
		// 2. Major grid lines (every step = 5 * subStep)
		let dMajor = '';

		const origin = viewport.worldToScreen(0, 0);
		const axisY = Math.max(8, Math.min(viewport.height - 40, origin.y));
		const axisX = Math.max(8, Math.min(viewport.width - 30, origin.x));

		const labelsG = createSvgElement('g', { class: 'grid-labels' });

		const labelStyle: SvgAttrs = {
			'dominant-baseline': 'central',
			'font-size': 11,
			'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
			fill: COLORS.gridLabel,
			'paint-order': 'stroke fill',
			stroke: COLORS.white,
			'stroke-width': 3,
			'stroke-linejoin': 'round',
		};

		for (let x = startX; x <= endX; x += subStep) {
			const s = viewport.worldToScreen(x, 0);
			const isMajor = Math.abs(Math.round(x / subStep) % 5) === 0;
			if (isMajor) {
				dMajor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;

				const cleanVal = parseFloat((Math.round(x / step) * step).toFixed(6));
				if (Math.abs(cleanVal) > 1e-4) {
					const anchorX = s.x;
					const anchorY = axisY + 4;
					createSvgText(anchorX, anchorY, cleanVal.toString(), {
						transform: `rotate(-90 ${anchorX.toFixed(1)} ${anchorY.toFixed(1)})`,
						'text-anchor': 'end',
						...labelStyle,
					}, labelsG);
				}
			} else if (showSubGrid) {
				dMinor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;
			}
		}

		for (let y = startY; y <= endY; y += subStep) {
			const s = viewport.worldToScreen(0, y);
			const isMajor = Math.abs(Math.round(y / subStep) % 5) === 0;
			if (isMajor) {
				dMajor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;

				const cleanVal = parseFloat((Math.round(y / step) * step).toFixed(6));
				if (Math.abs(cleanVal) > 1e-4) {
					createSvgText(axisX + 8, s.y, cleanVal.toString(), {
						'text-anchor': 'start',
						...labelStyle,
					}, labelsG);
				}
			} else if (showSubGrid) {
				dMinor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;
			}
		}

		// Minor grid (subStep) - light subtle lines
		if (showSubGrid && dMinor) {
			createSvgPath(dMinor, {
				stroke: COLORS.gridMinor,
				'stroke-width': STROKE_WIDTH.minorGrid,
				fill: 'none',
			}, this.gridGroup);
		}

		// Major grid (step = 5 * subStep) - distinct darker lines
		if (dMajor) {
			createSvgPath(dMajor, {
				stroke: COLORS.gridMajor,
				'stroke-width': STROKE_WIDTH.majorGrid,
				fill: 'none',
			}, this.gridGroup);
		}

		// Coordinate labels
		this.gridGroup.appendChild(labelsG);

		// Origin Axes
		const originG = createSvgElement('g', undefined, this.gridGroup);

		// X Axis (Red)
		createSvgLine(0, origin.y, viewport.width, origin.y, {
			stroke: COLORS.xAxis,
			'stroke-width': STROKE_WIDTH.dimension,
		}, originG);

		// Y Axis (Green)
		createSvgLine(origin.x, 0, origin.x, viewport.height, {
			stroke: COLORS.yAxis,
			'stroke-width': STROKE_WIDTH.dimension,
		}, originG);

		// Origin marker target (CAD surveyor style matching reference image)
		const r = 8;
		createSvgPath(`M ${origin.x} ${origin.y} L ${origin.x + r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y - r} Z`, {
			fill: COLORS.originQuarter,
		}, originG);

		createSvgPath(`M ${origin.x} ${origin.y} L ${origin.x - r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y + r} Z`, {
			fill: COLORS.originQuarter,
		}, originG);

		createSvgCircle(origin.x, origin.y, r, {
			fill: 'none',
			stroke: COLORS.construction,
			'stroke-width': STROKE_WIDTH.dimension,
		}, originG);
	}

	private renderGeometry(sketch: SketchDocument, viewport: Viewport): void {
		this.geometryGroup.innerHTML = '';
		this.pointGroup.innerHTML = '';

		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';

		// Light Theme: Unconstrained is bold slate, fully constrained is green, conflict is red
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		// 1. Render Lines
		for (const line of sketch.lines.values()) {
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;

			const s1 = viewport.worldToScreen(p1.x, p1.y);
			const s2 = viewport.worldToScreen(p2.x, p2.y);
			const isSelected = sketch.selection.lineIds.has(line.id);

			const lineG = createSvgElement('g', {
				'data-id': line.id,
				'data-type': 'line',
				class: `sketch-entity sketch-line ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px wide)
			createSvgLine(s1.x, s1.y, s2.x, s2.y, HIT_AREA_STROKE_ATTRS, lineG);

			// Visible line
			createSvgLine(s1.x, s1.y, s2.x, s2.y, getPrimitiveStrokeAttrs(isSelected, !!line.isConstruction, baseColor, true), lineG);
		}

		// 2. Render Circles
		for (const circle of sketch.circles.values()) {
			const center = sketch.points.get(circle.centerId);
			if (!center) continue;

			const sc = viewport.worldToScreen(center.x, center.y);
			const sr = circle.radius * viewport.zoom;
			const isSelected = sketch.selection.circleIds.has(circle.id);

			const circleG = createSvgElement('g', {
				'data-id': circle.id,
				'data-type': 'circle',
				class: `sketch-entity sketch-circle ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px stroke ring)
			createSvgCircle(sc.x, sc.y, sr, HIT_AREA_RING_ATTRS, circleG);

			// Visible circle
			createSvgCircle(sc.x, sc.y, sr, {
				fill: 'none',
				...getPrimitiveStrokeAttrs(isSelected, !!circle.isConstruction, baseColor),
			}, circleG);
		}

		// 3. Render Arcs
		for (const arc of sketch.arcs.values()) {
			const center = sketch.points.get(arc.centerId);
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (!center || !start || !end) continue;

			const sc = viewport.worldToScreen(center.x, center.y);
			const ss = viewport.worldToScreen(start.x, start.y);
			const se = viewport.worldToScreen(end.x, end.y);
			const sr = arc.radius * viewport.zoom;
			const isSelected = sketch.selection.arcIds.has(arc.id);

			const clockwise = !!arc.clockwise;
			const d = getArcSvgPath(sc, ss, se, sr, clockwise);

			const arcG = createSvgElement('g', {
				'data-id': arc.id,
				'data-type': 'arc',
				class: `sketch-entity sketch-arc ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px stroke)
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);

			// Visible arc path
			createSvgPath(d, {
				fill: 'none',
				...getPrimitiveStrokeAttrs(isSelected, !!arc.isConstruction, baseColor, true),
			}, arcG);

			// Light dashed radial lines to center if selected
			if (isSelected) {
				createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc.x, sc.y, se.x, se.y, AUX_AXIS_ATTRS, arcG);
			}
		}

		// 4. Render Ellipses
		for (const ellipse of sketch.ellipses.values()) {
			const center = sketch.points.get(ellipse.centerId);
			const majorPt = sketch.points.get(ellipse.majorAxisPointId);
			const minorPt = sketch.points.get(ellipse.minorAxisPointId);
			if (!center || !majorPt || !minorPt) continue;

			const sc = viewport.worldToScreen(center.x, center.y);
			const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
			const smin = viewport.worldToScreen(minorPt.x, minorPt.y);

			const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
			const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
			if (rx < 0.1 || ry < 0.1) continue;

			const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
			const isSelected = sketch.selection.ellipseIds.has(ellipse.id);

			const ellipseG = createSvgElement('g', {
				'data-id': ellipse.id,
				'data-type': 'ellipse',
				class: `sketch-entity sketch-ellipse ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px stroke)
			createSvgEllipse(sc.x, sc.y, rx, ry, {
				transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
				...HIT_AREA_RING_ATTRS,
			}, ellipseG);

			// Visible ellipse
			createSvgEllipse(sc.x, sc.y, rx, ry, {
				transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
				fill: 'none',
				...getPrimitiveStrokeAttrs(isSelected, !!ellipse.isConstruction, baseColor),
			}, ellipseG);

			// Subtle dashed conjugate axes if selected
			if (isSelected) {
				createSvgLine(sc.x, sc.y, smaj.x, smaj.y, AUX_AXIS_ATTRS, ellipseG);
				createSvgLine(sc.x, sc.y, smin.x, smin.y, AUX_AXIS_ATTRS, ellipseG);
			}
		}

		// 5. Render Elliptical Arcs
		for (const arc of sketch.ellipticalArcs.values()) {
			const center = sketch.points.get(arc.centerId);
			const majorPt = sketch.points.get(arc.majorAxisPointId);
			const minorPt = sketch.points.get(arc.minorAxisPointId);
			const startPt = sketch.points.get(arc.startPointId);
			const endPt = sketch.points.get(arc.endPointId);
			if (!center || !majorPt || !minorPt || !startPt || !endPt) continue;

			const sc = viewport.worldToScreen(center.x, center.y);
			const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
			const smin = viewport.worldToScreen(minorPt.x, minorPt.y);
			const ss = viewport.worldToScreen(startPt.x, startPt.y);
			const se = viewport.worldToScreen(endPt.x, endPt.y);

			const clockwise = !!arc.clockwise;
			const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, clockwise);
			const isSelected = sketch.selection.ellipticalArcIds.has(arc.id);

			const arcG = createSvgElement('g', {
				'data-id': arc.id,
				'data-type': 'elliptical_arc',
				class: `sketch-entity sketch-elliptical-arc ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px stroke)
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);

			// Visible arc path
			createSvgPath(d, {
				fill: 'none',
				...getPrimitiveStrokeAttrs(isSelected, !!arc.isConstruction, baseColor, true),
			}, arcG);

			// Light dashed radial lines to center and axes if selected
			if (isSelected) {
				createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc.x, sc.y, se.x, se.y, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc.x, sc.y, smaj.x, smaj.y, AUX_RAY_ATTRS, arcG);
				createSvgLine(sc.x, sc.y, smin.x, smin.y, AUX_RAY_ATTRS, arcG);
			}
		}

		// 6. Render Points (Vertices)
		for (const pt of sketch.points.values()) {
			const s = viewport.worldToScreen(pt.x, pt.y);
			const isSelected = sketch.selection.pointIds.has(pt.id);

			const ptG = createSvgElement('g', {
				'data-id': pt.id,
				'data-type': 'point',
				class: `sketch-entity sketch-point ${isSelected ? 'is-selected' : ''}`,
			}, this.pointGroup);

			// Invisible larger hit target for easy clicking
			createSvgCircle(s.x, s.y, 14, HIT_AREA_POINT_ATTRS, ptG);

			// Visible point handle
			let fillColor: string = COLORS.primary; // Default interactive CAD vertex color
			let strokeColor: string = COLORS.white;

			if (pt.fixed) {
				fillColor = COLORS.fixed; // Fixed points highlighted amber
			} else if (isFullyConstrained) {
				fillColor = COLORS.constrained; // Fully defined
			}

			if (isSelected) {
				fillColor = COLORS.selected;
				strokeColor = COLORS.tooltipBg;
			}

			createSvgCircle(s.x, s.y, isSelected ? 4.5 : 3.5, {
				class: 'entity-visible visible-point',
				fill: fillColor,
				stroke: strokeColor,
				'stroke-width': STROKE_WIDTH.normal,
				'pointer-events': 'all',
			}, ptG);
		}
	}

	private renderConstraints(sketch: SketchDocument, viewport: Viewport): void {
		this.constraintGroup.innerHTML = '';
		const lineBadgeCounts = new Map<string, number>();

		for (const constraint of sketch.constraints.values()) {
			const isSelected = sketch.selection.constraintIds.has(constraint.id);

			if (constraint instanceof DistanceConstraint) {
				this.renderDistanceDimension(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof PointToLineDistanceConstraint) {
				this.renderPointToLineDistanceDimension(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof RadiusConstraint) {
				this.renderRadiusDimension(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof HorizontalConstraint) {
				this.renderBadgeOnSegment(constraint.id, constraint.p1Id, constraint.p2Id, sketch, viewport, 'H', isSelected, lineBadgeCounts);
			} else if (constraint instanceof VerticalConstraint) {
				this.renderBadgeOnSegment(constraint.id, constraint.p1Id, constraint.p2Id, sketch, viewport, 'V', isSelected, lineBadgeCounts);
			} else if (constraint instanceof ParallelConstraint) {
				this.renderBadgeOnSegment(constraint.id, constraint.l1P1, constraint.l1P2, sketch, viewport, '//', isSelected, lineBadgeCounts);
				this.renderBadgeOnSegment(constraint.id, constraint.l2P1, constraint.l2P2, sketch, viewport, '//', isSelected, lineBadgeCounts);
			} else if (constraint instanceof PerpendicularConstraint) {
				this.renderPerpendicularBadge(constraint, sketch, viewport, isSelected, lineBadgeCounts);
			} else if (constraint instanceof EqualLengthConstraint) {
				this.renderBadgeOnSegment(constraint.id, constraint.line1P1, constraint.line1P2, sketch, viewport, '=', isSelected, lineBadgeCounts);
				this.renderBadgeOnSegment(constraint.id, constraint.line2P1, constraint.line2P2, sketch, viewport, '=', isSelected, lineBadgeCounts);
			} else if (constraint instanceof EqualRadiusConstraint) {
				this.renderBadgeOnCircle(constraint.id, constraint.circle1Id, sketch, viewport, '=', isSelected);
				this.renderBadgeOnCircle(constraint.id, constraint.circle2Id, sketch, viewport, '=', isSelected);
			} else if (constraint instanceof TangentLineCircleConstraint) {
				this.renderBadgeOnSegment(constraint.id, constraint.lineP1Id, constraint.lineP2Id, sketch, viewport, '⟂O', isSelected, lineBadgeCounts);
				this.renderBadgeOnCircle(constraint.id, constraint.circleId, sketch, viewport, '⟂O', isSelected);
			} else if (constraint instanceof ConcentricConstraint) {
				this.renderConcentricBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof MidpointConstraint) {
				this.renderMidpointBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof PointOnLineConstraint) {
				this.renderPointOnLineBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof PointOnCircleConstraint) {
				this.renderPointOnCircleBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof FixedConstraint) {
				this.renderFixedBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof CoincidentConstraint) {
				this.renderCoincidentBadge(constraint, sketch, viewport, isSelected);
			} else if (constraint instanceof AngleConstraint) {
				this.renderAngleDimension(constraint, sketch, viewport, isSelected);
			}
		}
	}

	private renderDistanceDimension(
		constraint: DistanceConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const p1 = sketch.points.get(constraint.p1Id);
		const p2 = sketch.points.get(constraint.p2Id);
		if (!p1 || !p2) return;

		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);
		const offsetScreen = constraint.offset !== undefined ? constraint.offset * viewport.zoom : 32;
		const geom = computeDistanceDimensionGeometry(s1, s2, constraint.orientation ?? 'aligned', offsetScreen);
		if (!geom) return;

		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: formatDimensionValue(constraint.targetDistance),
			extensionLines: geom.extensionLines,
			parent: this.constraintGroup,
			isSelected,
			constraintId: constraint.id,
		});
	}

	private renderPointToLineDistanceDimension(
		constraint: PointToLineDistanceConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.pointId);
		const p1 = sketch.points.get(constraint.lineP1Id);
		const p2 = sketch.points.get(constraint.lineP2Id);
		if (!pt || !p1 || !p2) return;

		const sp = viewport.worldToScreen(pt.x, pt.y);
		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);
		const offsetScreen = constraint.offset !== undefined ? constraint.offset * viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, offsetScreen);
		if (!geom) return;

		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: formatDimensionValue(constraint.targetDistance),
			extensionLines: geom.extensionLines,
			parent: this.constraintGroup,
			isSelected,
			constraintId: constraint.id,
		});
	}

	private renderLinearDimensionVisual(opts: LinearDimensionVisualOptions): void {
		const {
			d1,
			d2,
			label,
			extensionLines,
			parent,
			isSelected = false,
			constraintId,
			isTooltip = false,
			startPointHighlight,
			targetPointSnapped = false,
		} = opts;

		const g = constraintId
			? createSvgElement('g', {
				class: 'dimension-item',
				'data-id': constraintId,
				'data-type': 'constraint',
			}, parent)
			: parent;

		const color = isSelected ? COLORS.selected : COLORS.primary;
		const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

		// 1. Extension lines
		if (extensionLines && extensionLines.length > 0) {
			const extAttrs = isTooltip
				? PREVIEW_EXTENSION_LINE_ATTRS
				: isSelected
				? { ...EXTENSION_LINE_ATTRS, stroke: COLORS.selected }
				: EXTENSION_LINE_ATTRS;
			for (const ext of extensionLines) {
				createSvgLine(ext.from.x, ext.from.y, ext.to.x, ext.to.y, extAttrs, g);
			}
		}

		// 2. Start point highlight (origin anchor)
		if (startPointHighlight) {
			createSvgCircle(startPointHighlight.x, startPointHighlight.y, 4, {
				fill: COLORS.primary,
				stroke: COLORS.white,
				'stroke-width': 1.5,
			}, g);
		}

		// 3. Target point snap ring
		if (targetPointSnapped) {
			createSvgCircle(d2.x, d2.y, 6, {
				fill: 'rgba(2, 132, 199, 0.25)',
				stroke: COLORS.primary,
				'stroke-width': 1.5,
			}, g);
		}

		// 4. Dimension line with arrowheads
		const screenDist = Math.hypot(d2.x - d1.x, d2.y - d1.y);
		const lineAttrs: SvgAttrs = {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		};
		if (screenDist >= 20) {
			lineAttrs['marker-start'] = arrowUrl;
			lineAttrs['marker-end'] = arrowUrl;
		}
		createSvgLine(d1.x, d1.y, d2.x, d2.y, lineAttrs, g);

		// 5. Label (tooltip or badge) at midpoint
		const mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };
		if (isTooltip) {
			this.renderTooltip(mid.x, mid.y - 12, label);
		} else {
			const textLen = label.length * 8 + 14;
			createSvgRect(mid.x - textLen * 0.5, mid.y - 10, textLen, 20, {
				rx: 4,
				fill: COLORS.white,
				stroke: color,
				'stroke-width': isSelected ? STROKE_WIDTH.normal : STROKE_WIDTH.thin,
			}, g);

			createSvgText(mid.x, mid.y + 4, label, {
				'text-anchor': 'middle',
				fill: color,
				'font-size': 12,
				'font-weight': 600,
				'font-family': 'monospace',
			}, g);
		}
	}

	private renderDashedExtensionLines(
		parentG: SVGElement,
		sCenter: Vec2,
		angleRad: number,
		rScreen: number,
		pA: Vec2,
		pB: Vec2,
		color: string
	): void {
		const vx = Math.cos(angleRad);
		const vy = Math.sin(angleRad);

		const k1 = (pA.x - sCenter.x) * vx + (pA.y - sCenter.y) * vy;
		const k2 = (pB.x - sCenter.x) * vx + (pB.y - sCenter.y) * vy;
		const kMin = Math.min(k1, k2);
		const kMax = Math.max(k1, k2);

		const kEnd = rScreen + 6;
		if (kEnd <= 0) return;

		const intervals: Array<[number, number]> = [];
		if (kMax <= 0) {
			intervals.push([0, kEnd]);
		} else if (kMin <= 0) {
			if (kEnd > kMax) {
				intervals.push([kMax, kEnd]);
			}
		} else {
			intervals.push([0, Math.min(kMin, kEnd)]);
			if (kEnd > kMax) {
				intervals.push([kMax, kEnd]);
			}
		}

		for (const [startK, endK] of intervals) {
			if (endK - startK < 1) continue;
			const x1 = sCenter.x + startK * vx;
			const y1 = sCenter.y + startK * vy;
			const x2 = sCenter.x + endK * vx;
			const y2 = sCenter.y + endK * vy;

			createSvgLine(x1, y1, x2, y2, {
				stroke: color,
				'stroke-width': STROKE_WIDTH.majorGrid,
				'stroke-dasharray': DASH_ARRAY.angleExtension,
				'pointer-events': 'none',
			}, parentG);
		}
	}

	private renderAngleDimension(
		constraint: AngleConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const l1 = sketch.lines.get(constraint.line1Id);
		const l2 = sketch.lines.get(constraint.line2Id);
		if (!l1 || !l2) return;

		const p1 = sketch.points.get(l1.p1Id);
		const p2 = sketch.points.get(l1.p2Id);
		const p3 = sketch.points.get(l2.p1Id);
		const p4 = sketch.points.get(l2.p2Id);
		if (!p1 || !p2 || !p3 || !p4) return;

		const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

		const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
		const v2 = { x: p4.x - p3.x, y: p4.y - p3.y };
		const l1Len = Math.max(Math.hypot(v1.x, v1.y), 1e-7);
		const l2Len = Math.max(Math.hypot(v2.x, v2.y), 1e-7);

		const s1Factor = constraint.s1 ?? geom.s1;
		const s2Factor = constraint.s2 ?? geom.s2;

		const u1 = { x: (s1Factor * v1.x) / l1Len, y: (s1Factor * v1.y) / l1Len };
		const u2 = { x: (s2Factor * v2.x) / l2Len, y: (s2Factor * v2.y) / l2Len };

		const sCenter = viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
		const sRay1 = viewport.worldToScreen(geom.pInt.x + u1.x * 20, geom.pInt.y + u1.y * 20);
		const sRay2 = viewport.worldToScreen(geom.pInt.x + u2.x * 20, geom.pInt.y + u2.y * 20);

		const a1 = Math.atan2(sRay1.y - sCenter.y, sRay1.x - sCenter.x);
		const a2 = Math.atan2(sRay2.y - sCenter.y, sRay2.x - sCenter.x);

		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;

		const sweepFlag = delta > 0 ? 1 : 0;
		const rWorld = constraint.arcRadius ?? 40;
		const rScreen = Math.max(28, rWorld * viewport.zoom);

		const ax = sCenter.x + rScreen * Math.cos(a1);
		const ay = sCenter.y + rScreen * Math.sin(a1);
		const bx = sCenter.x + rScreen * Math.cos(a2);
		const by = sCenter.y + rScreen * Math.sin(a2);

		const midAngle = a1 + delta * 0.5;
		const midX = sCenter.x + rScreen * Math.cos(midAngle);
		const midY = sCenter.y + rScreen * Math.sin(midAngle);

		const g = createSvgElement('g', {
			class: 'dimension-item',
			'data-id': constraint.id,
			'data-type': 'constraint',
		}, this.constraintGroup);

		const color = isSelected ? COLORS.selected : COLORS.primary;

		// Dashed extension lines if arc points extend beyond the physical line segments
		const sp1 = viewport.worldToScreen(p1.x, p1.y);
		const sp2 = viewport.worldToScreen(p2.x, p2.y);
		const sp3 = viewport.worldToScreen(p3.x, p3.y);
		const sp4 = viewport.worldToScreen(p4.x, p4.y);

		this.renderDashedExtensionLines(g, sCenter, a1, rScreen, sp1, sp2, color);
		this.renderDashedExtensionLines(g, sCenter, a2, rScreen, sp3, sp4, color);

		// Arc path with arrowheads
		const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;
		createSvgPath(
			`M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`,
			{
				fill: 'none',
				stroke: color,
				'stroke-width': STROKE_WIDTH.dimension,
				'marker-start': arrowUrl,
				'marker-end': arrowUrl,
			},
			g
		);

		// Text label badge with background
		const textVal = `${constraint.targetAngle.toFixed(1)}°`;
		const textLen = textVal.length * 8 + 14;

		createSvgRect(midX - textLen * 0.5, midY - 10, textLen, 20, {
			rx: 4,
			fill: COLORS.white,
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		}, g);

		createSvgText(midX, midY + 4, textVal, {
			'text-anchor': 'middle',
			fill: color,
			'font-size': 11,
			'font-weight': 700,
			'font-family': 'ui-monospace, monospace',
		}, g);
	}

	private renderRadiusDimension(
		constraint: RadiusConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const circle = sketch.circles.get(constraint.circleId);
		const arc = sketch.arcs.get(constraint.circleId);
		const entity = circle ?? arc;
		if (!entity) return;
		const center = sketch.points.get(entity.centerId);
		if (!center) return;

		const sc = viewport.worldToScreen(center.x, center.y);
		const sr = entity.radius * viewport.zoom;

		// Leader angle in screen space (screen Y is positive downwards)
		let screenAngle = -Math.PI / 4; // Default for circle: 45° up and right

		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start.x, start.y);
				const se = viewport.worldToScreen(end.x, end.y);
				const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
				const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
				const clockwise = !!arc.clockwise;

				let sweepAngle = 0;
				if (clockwise) {
					sweepAngle = (ae - as) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					if (constraint.leaderAngle !== undefined) {
						let rel = (constraint.leaderAngle - as) % TWO_PI;
						if (rel < 0) rel += TWO_PI;
						if (rel > sweepAngle) {
							rel = rel - sweepAngle < TWO_PI - rel ? sweepAngle : 0;
						}
						screenAngle = as + rel;
					} else {
						screenAngle = as + sweepAngle / 2;
					}
				} else {
					sweepAngle = (as - ae) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					if (constraint.leaderAngle !== undefined) {
						let rel = (as - constraint.leaderAngle) % TWO_PI;
						if (rel < 0) rel += TWO_PI;
						if (rel > sweepAngle) {
							rel = rel - sweepAngle < TWO_PI - rel ? sweepAngle : 0;
						}
						screenAngle = as - rel;
					} else {
						screenAngle = as - sweepAngle / 2;
					}
				}
			}
		} else {
			if (constraint.leaderAngle !== undefined) {
				screenAngle = constraint.leaderAngle;
			}
		}

		const cosA = Math.cos(screenAngle);
		const sinA = Math.sin(screenAngle);
		const edge = {
			x: sc.x + cosA * sr,
			y: sc.y + sinA * sr,
		};

		const dirX = cosA >= 0 ? 1 : -1;
		const dirY = sinA >= 0 ? 1 : -1;
		const tip = {
			x: edge.x + dirX * 30,
			y: edge.y + dirY * 20,
		};

		const g = createSvgElement('g', {
			class: 'dimension-item',
			'data-id': constraint.id,
			'data-type': 'constraint',
		}, this.constraintGroup);

		const color = isSelected ? COLORS.selected : COLORS.primary;
		const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

		// Leader radial line from center to edge with arrow at circumference
		createSvgLine(sc.x, sc.y, edge.x, edge.y, {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
			'marker-end': arrowUrl,
		}, g);

		// Shelf line from edge to tip
		createSvgLine(edge.x, edge.y, tip.x, tip.y, {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		}, g);

		const isDiameter = constraint.displayMode === 'diameter';
		const num = isDiameter ? constraint.targetRadius * 2 : constraint.targetRadius;
		const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
		const textVal = isDiameter ? `Ø ${numStr}` : `R ${numStr}`;
		const textLen = textVal.length * 8 + 14;

		const rectX = dirX > 0 ? tip.x : tip.x - textLen;
		createSvgRect(rectX, tip.y - 12, textLen, 20, {
			rx: 4,
			fill: COLORS.white,
			stroke: color,
			'stroke-width': isSelected ? STROKE_WIDTH.normal : STROKE_WIDTH.thin,
		}, g);

		createSvgText(rectX + textLen * 0.5, tip.y + 3, textVal, {
			'text-anchor': 'middle',
			fill: color,
			'font-size': 12,
			'font-weight': 600,
			'font-family': 'monospace',
		}, g);
	}

	private renderPerpendicularBadge(
		constraint: PerpendicularConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean,
		lineBadgeCounts: Map<string, number>
	): void {
		const p1 = sketch.points.get(constraint.l1P1);
		const p2 = sketch.points.get(constraint.l1P2);
		const p3 = sketch.points.get(constraint.l2P1);
		const p4 = sketch.points.get(constraint.l2P2);
		if (!p1 || !p2 || !p3 || !p4) return;

		const isSharedPoint =
			p1.id === p3.id ||
			p1.id === p4.id ||
			p2.id === p3.id ||
			p2.id === p4.id ||
			dist(p1, p3) < 1e-3 ||
			dist(p1, p4) < 1e-3 ||
			dist(p2, p3) < 1e-3 ||
			dist(p2, p4) < 1e-3;

		const geom = sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

		const distToSeg1 = projectPointOntoSegment(geom.pInt, p1, p2).dist;
		const distToSeg2 = projectPointOntoSegment(geom.pInt, p3, p4).dist;
		const isNearSegments = distToSeg1 < 30 && distToSeg2 < 30;

		if (isSharedPoint || isNearSegments) {
			const sCenter = viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
			const sRay1 = viewport.worldToScreen(geom.pInt.x + geom.u1.x * 20, geom.pInt.y + geom.u1.y * 20);
			const sRay2 = viewport.worldToScreen(geom.pInt.x + geom.u2.x * 20, geom.pInt.y + geom.u2.y * 20);

			const d1 = { x: sRay1.x - sCenter.x, y: sRay1.y - sCenter.y };
			const d2 = { x: sRay2.x - sCenter.x, y: sRay2.y - sCenter.y };
			const l1 = Math.hypot(d1.x, d1.y);
			const l2 = Math.hypot(d2.x, d2.y);

			let dir = { x: 1, y: -1 };
			if (l1 > 1e-4 && l2 > 1e-4) {
				const u1 = { x: d1.x / l1, y: d1.y / l1 };
				const u2 = { x: d2.x / l2, y: d2.y / l2 };
				const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
				const bisLen = Math.hypot(bis.x, bis.y);
				if (bisLen > 1e-3) {
					dir = { x: bis.x / bisLen, y: bis.y / bisLen };
				} else {
					dir = { x: -u1.y, y: u1.x };
				}
			}

			const offset = 18;
			const badgeX = sCenter.x + dir.x * offset;
			const badgeY = sCenter.y + dir.y * offset;
			this.renderConstraintBadge(constraint.id, badgeX, badgeY, '⊥', isSelected);
			return;
		}

		// Fallback if segments are completely disconnected and far apart
		this.renderBadgeOnSegment(constraint.id, constraint.l1P1, constraint.l1P2, sketch, viewport, '⊥', isSelected, lineBadgeCounts);
		this.renderBadgeOnSegment(constraint.id, constraint.l2P1, constraint.l2P2, sketch, viewport, '⊥', isSelected, lineBadgeCounts);
	}

	private renderBadgeOnSegment(
		constraintId: string,
		p1Id: string,
		p2Id: string,
		sketch: SketchDocument,
		viewport: Viewport,
		label: string,
		isSelected: boolean,
		lineBadgeCounts?: Map<string, number>
	): void {
		const p1 = sketch.points.get(p1Id);
		const p2 = sketch.points.get(p2Id);
		if (!p1 || !p2) return;

		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);

		const dx = s2.x - s1.x;
		const dy = s2.y - s1.y;
		const len = Math.max(Math.hypot(dx, dy), 1);
		const ux = dx / len;
		const uy = dy / len;

		let nx = -uy;
		let ny = ux;
		if (ny > 0 || (Math.abs(ny) < 1e-4 && nx < 0)) {
			nx = -nx;
			ny = -ny;
		}

		let badgeIndex = 0;
		if (lineBadgeCounts) {
			const lineKey = p1Id < p2Id ? `${p1Id}_${p2Id}` : `${p2Id}_${p1Id}`;
			badgeIndex = lineBadgeCounts.get(lineKey) ?? 0;
			lineBadgeCounts.set(lineKey, badgeIndex + 1);
		}

		const offsetAlong =
			badgeIndex === 0
				? 0
				: (badgeIndex % 2 === 1 ? Math.floor((badgeIndex + 1) / 2) : -Math.floor(badgeIndex / 2)) * 22;

		const midX = (s1.x + s2.x) * 0.5 + nx * 14 + ux * offsetAlong;
		const midY = (s1.y + s2.y) * 0.5 + ny * 14 + uy * offsetAlong;

		this.renderConstraintBadge(constraintId, midX, midY, label, isSelected);
	}

	private renderBadgeOnCircle(
		constraintId: string,
		circleId: string,
		sketch: SketchDocument,
		viewport: Viewport,
		label: string,
		isSelected: boolean
	): void {
		const circle = sketch.circles.get(circleId);
		const arc = sketch.arcs.get(circleId);
		const entity = circle ?? arc;
		if (!entity) return;
		const center = sketch.points.get(entity.centerId);
		if (!center) return;

		const sc = viewport.worldToScreen(center.x, center.y);
		const rScreen = entity.radius * viewport.zoom;
		let bx = sc.x + rScreen * 0.7071;
		let by = sc.y - rScreen * 0.7071;

		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start.x, start.y);
				const se = viewport.worldToScreen(end.x, end.y);
				const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
				const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
				const clockwise = !!arc.clockwise;

				let sweepAngle = 0;
				if (clockwise) {
					sweepAngle = (ae - as) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					const midAngle = as + sweepAngle / 2;
					bx = sc.x + Math.cos(midAngle) * rScreen;
					by = sc.y + Math.sin(midAngle) * rScreen;
				} else {
					sweepAngle = (as - ae) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					const midAngle = as - sweepAngle / 2;
					bx = sc.x + Math.cos(midAngle) * rScreen;
					by = sc.y + Math.sin(midAngle) * rScreen;
				}
			}
		}

		this.renderConstraintBadge(constraintId, bx, by, label, isSelected);
	}

	private renderConcentricBadge(
		constraint: ConcentricConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.c1CenterId);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x + 12, s.y + 12, '◎', isSelected, COLORS.primary);
	}

	private renderMidpointBadge(
		constraint: MidpointConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.midId);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x, s.y - 14, 'M', isSelected, COLORS.primary);
	}

	private renderPointOnLineBadge(
		constraint: PointOnLineConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.pointId);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, COLORS.primary);
	}

	private renderPointOnCircleBadge(
		constraint: PointOnCircleConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.pointId);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, COLORS.primary);
	}

	private renderFixedBadge(
		constraint: FixedConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.pointId);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x + 12, s.y - 12, 'fixed', isSelected, COLORS.fixed);
	}

	private renderCoincidentBadge(
		constraint: CoincidentConstraint,
		sketch: SketchDocument,
		viewport: Viewport,
		isSelected: boolean
	): void {
		const pt = sketch.points.get(constraint.p1Id);
		if (!pt) return;
		const s = viewport.worldToScreen(pt.x, pt.y);
		this.renderConstraintBadge(constraint.id, s.x - 12, s.y - 12, '●', isSelected, COLORS.primary);
	}

	private renderConstraintBadge(
		id: string,
		x: number,
		y: number,
		label: string,
		isSelected: boolean,
		customColor?: string
	): void {
		const g = createSvgElement('g', {
			class: 'constraint-badge',
			'data-id': id,
			'data-type': 'constraint',
		}, this.constraintGroup);

		const color = isSelected ? COLORS.primary : customColor ?? COLORS.badgeText;
		const icon = getBadgeIcon(label, x, y, color);
		const width = icon ? 18 : Math.max(18, label.length * 8 + 8);

		createSvgRect(x - width * 0.5, y - 9, width, 18, {
			rx: 3,
			fill: isSelected ? COLORS.selectedBg : COLORS.white,
			stroke: isSelected ? COLORS.primary : COLORS.badgeBorder,
			'stroke-width': isSelected ? STROKE_WIDTH.dimension : STROKE_WIDTH.thin,
		}, g);

		if (icon) {
			g.appendChild(icon);
		} else {
			createSvgText(x, y + 4, label, {
				'text-anchor': 'middle',
				fill: color,
				'font-size': 10,
				'font-weight': 700,
				'font-family': 'sans-serif',
			}, g);
		}
	}

	// Live drawing previews
	renderLinePreview(
		s1: Vec2,
		s2: Vec2,
		len: number,
		angleDeg: number,
		isConstruction = false,
		axisBadge?: 'H' | 'V'
	): void {
		this.previewGroup.innerHTML = '';

		createSvgLine(s1.x, s1.y, s2.x, s2.y, getPreviewStrokeAttrs(isConstruction, false, true), this.previewGroup);

		// Length & Angle Tooltip
		const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
		const badgeText = axisBadge ? ` [${axisBadge}]` : '';
		const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°${badgeText}`;
		this.renderTooltip(mid.x, mid.y, label);
	}

	renderDistancePreview(
		s1: Vec2,
		s2: Vec2,
		cursor?: Vec2,
		distVal = 0,
		orientation: 'aligned' | 'horizontal' | 'vertical' | 'direct' = 'aligned',
		isTargetSnapped = false
	): void {
		this.previewGroup.innerHTML = '';
		const geom = computeDistanceDimensionGeometry(s1, s2, orientation, 0, cursor);
		if (!geom) return;

		const labelPrefix = orientation === 'horizontal' ? 'H: ' : orientation === 'vertical' ? 'V: ' : '';
		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: `${labelPrefix}${distVal.toFixed(1)} mm`,
			extensionLines: geom.extensionLines,
			parent: this.previewGroup,
			isTooltip: true,
			startPointHighlight: orientation === 'direct' ? s1 : undefined,
			targetPointSnapped: isTargetSnapped,
		});
	}

	renderDistanceLinePreview(
		s1: Vec2,
		s2: Vec2,
		distVal: number,
		isTargetSnapped = false
	): void {
		this.renderDistancePreview(s1, s2, undefined, distVal, 'direct', isTargetSnapped);
	}

	renderPointToLineDistancePreview(
		sp: Vec2,
		s1: Vec2,
		s2: Vec2,
		cursor?: Vec2,
		distVal = 0
	): void {
		this.previewGroup.innerHTML = '';
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, 0, cursor);
		if (!geom) return;

		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: `${distVal.toFixed(1)} mm`,
			extensionLines: geom.extensionLines,
			parent: this.previewGroup,
			isTooltip: true,
			startPointHighlight: sp,
		});
	}

	renderAnglePreview(
		sCenter: Vec2,
		sRay1: Vec2,
		sRay2: Vec2,
		cursor: Vec2,
		angleDeg: number,
		sp1?: Vec2,
		sp2?: Vec2,
		sp3?: Vec2,
		sp4?: Vec2
	): void {
		this.previewGroup.innerHTML = '';

		const a1 = Math.atan2(sRay1.y - sCenter.y, sRay1.x - sCenter.x);
		const a2 = Math.atan2(sRay2.y - sCenter.y, sRay2.x - sCenter.x);

		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;

		const sweepFlag = delta > 0 ? 1 : 0;
		const rScreen = Math.max(28, Math.hypot(cursor.x - sCenter.x, cursor.y - sCenter.y));

		if (sp1 && sp2) {
			this.renderDashedExtensionLines(this.previewGroup, sCenter, a1, rScreen, sp1, sp2, COLORS.primary);
		}
		if (sp3 && sp4) {
			this.renderDashedExtensionLines(this.previewGroup, sCenter, a2, rScreen, sp3, sp4, COLORS.primary);
		}

		const ax = sCenter.x + rScreen * Math.cos(a1);
		const ay = sCenter.y + rScreen * Math.sin(a1);
		const bx = sCenter.x + rScreen * Math.cos(a2);
		const by = sCenter.y + rScreen * Math.sin(a2);

		const midAngle = a1 + delta * 0.5;
		const midX = sCenter.x + rScreen * Math.cos(midAngle);
		const midY = sCenter.y + rScreen * Math.sin(midAngle);

		createSvgPath(
			`M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`,
			{
				fill: 'none',
				stroke: COLORS.primary,
				'stroke-width': STROKE_WIDTH.dimension,
				'marker-start': DIM_ARROWS.default,
				'marker-end': DIM_ARROWS.default,
			},
			this.previewGroup
		);

		this.renderTooltip(midX, midY, `${angleDeg.toFixed(1)}°`);
	}

	renderCirclePreview(
		center: Vec2,
		current: Vec2,
		radius: number,
		isConstruction = false,
		isGuide = false
	): void {
		this.previewGroup.innerHTML = '';

		const rPx = Math.hypot(current.x - center.x, current.y - center.y);
		createSvgCircle(center.x, center.y, rPx, getPreviewStrokeAttrs(isConstruction, isGuide), this.previewGroup);

		createSvgLine(center.x, center.y, current.x, current.y, AUX_RAY_ATTRS, this.previewGroup);

		this.renderTooltip(current.x + 12, current.y - 12, `R ${radius.toFixed(1)} mm`);
	}

	renderArcPreview(
		sc: Vec2,
		ss: Vec2,
		se: Vec2,
		sr: number,
		clockwise: boolean,
		radiusVal: number,
		sweepDeg?: number,
		isConstruction = false
	): void {
		this.previewGroup.innerHTML = '';

		const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
		const ae = Math.atan2(se.y - sc.y, se.x - sc.x);

		let sweepAngle = 0;
		if (clockwise) {
			sweepAngle = (ae - as) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
		} else {
			sweepAngle = (as - ae) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
		}

		// Faint guide circle
		createSvgCircle(sc.x, sc.y, sr, GUIDE_OUTLINE_ATTRS, this.previewGroup);

		const d = getArcSvgPath(sc, ss, se, sr, clockwise);
		createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), this.previewGroup);

		// Dashed center rays
		createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, this.previewGroup);
		createSvgLine(sc.x, sc.y, se.x, se.y, AUX_RAY_ATTRS, this.previewGroup);

		// Tooltip at mid-arc
		const midAngle = clockwise ? as + sweepAngle * 0.5 : as - sweepAngle * 0.5;
		const midX = sc.x + sr * Math.cos(midAngle);
		const midY = sc.y + sr * Math.sin(midAngle);

		const deg = sweepDeg ?? (sweepAngle * 180 / Math.PI);
		this.renderTooltip(midX, midY, `R ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
	}

	renderRectanglePreview(s1: Vec2, s2: Vec2, w: number, h: number, isConstruction = false): void {
		this.previewGroup.innerHTML = '';

		const rx = Math.min(s1.x, s2.x);
		const ry = Math.min(s1.y, s2.y);
		const rw = Math.abs(s2.x - s1.x);
		const rh = Math.abs(s2.y - s1.y);

		createSvgRect(rx, ry, rw, rh, getPreviewStrokeAttrs(isConstruction), this.previewGroup);

		this.renderTooltip(s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
	}

	renderEllipseMajorAxisPreview(sc: Vec2, current: Vec2, radiusVal: number, _isConstruction = false): void {
		this.previewGroup.innerHTML = '';

		createSvgLine(sc.x, sc.y, current.x, current.y, {
			stroke: COLORS.primary,
			'stroke-width': STROKE_WIDTH.dimension,
			'stroke-dasharray': DASH_ARRAY.axis,
		}, this.previewGroup);

		const deg = (Math.atan2(current.y - sc.y, current.x - sc.x) * 180) / Math.PI;
		this.renderTooltip(current.x + 12, current.y - 12, `Rx ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
	}

	renderEllipsePreview(
		sc: Vec2,
		smaj: Vec2,
		smin: Vec2,
		rxVal: number,
		ryVal: number,
		isConstruction = false,
		isGuide = false
	): void {
		this.previewGroup.innerHTML = '';

		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

		createSvgEllipse(sc.x, sc.y, rx, ry, {
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...getPreviewStrokeAttrs(isConstruction, isGuide),
		}, this.previewGroup);

		createSvgLine(sc.x, sc.y, smaj.x, smaj.y, AUX_RAY_ATTRS, this.previewGroup);
		createSvgLine(sc.x, sc.y, smin.x, smin.y, AUX_RAY_ATTRS, this.previewGroup);

		this.renderTooltip(smin.x + 12, smin.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm`);
	}

	renderEllipticalArcStartPreview(
		sc: Vec2,
		smaj: Vec2,
		smin: Vec2,
		ss: Vec2,
		rxVal: number,
		ryVal: number,
		_isConstruction = false
	): void {
		this.previewGroup.innerHTML = '';

		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

		createSvgEllipse(sc.x, sc.y, rx, ry, {
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			stroke: COLORS.guideStartEllipse,
			'stroke-width': STROKE_WIDTH.dimension,
			'stroke-dasharray': DASH_ARRAY.axis,
			fill: 'none',
		}, this.previewGroup);

		createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, this.previewGroup);

		createSvgCircle(ss.x, ss.y, 4, {
			fill: COLORS.primary,
		}, this.previewGroup);

		this.renderTooltip(ss.x + 12, ss.y - 12, `Start Angle | Rx ${rxVal.toFixed(1)} Ry ${ryVal.toFixed(1)}`);
	}

	renderEllipticalArcPreview(
		sc: Vec2,
		smaj: Vec2,
		smin: Vec2,
		ss: Vec2,
		se: Vec2,
		rxVal: number,
		ryVal: number,
		clockwise: boolean,
		isConstruction = false
	): void {
		this.previewGroup.innerHTML = '';

		const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
		const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
		if (rx < 0.1 || ry < 0.1) return;

		const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
		const thetaDeg = (theta * 180) / Math.PI;

		// Faint guide ellipse
		createSvgEllipse(sc.x, sc.y, rx, ry, {
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...GUIDE_OUTLINE_ATTRS,
		}, this.previewGroup);

		const ux = Math.cos(theta);
		const uy = Math.sin(theta);
		const vx = -Math.sin(theta);
		const vy = Math.cos(theta);

		const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
		const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
		const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
		const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

		const ts = Math.atan2(vs / ry, us / rx);
		const te = Math.atan2(ve / ry, ue / rx);

		let sweepAngle = 0;
		if (clockwise) {
			sweepAngle = (te - ts) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
		} else {
			sweepAngle = (ts - te) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
		}

		const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, clockwise);
		createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), this.previewGroup);

		createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, this.previewGroup);
		createSvgLine(sc.x, sc.y, se.x, se.y, AUX_RAY_ATTRS, this.previewGroup);

		const sweepDeg = (sweepAngle * 180) / Math.PI;
		this.renderTooltip(se.x + 12, se.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm | ${sweepDeg.toFixed(1)}°`);
	}

	renderSnapIndicator(s: Vec2, type: 'point' | 'line' | 'circle' | 'grid' = 'point', clearFirst = true): void {
		if (clearFirst) {
			this.overlayGroup.innerHTML = '';
		}

		if (type === 'line' || type === 'circle') {
			// Emerald diamond on object - enlarged so it clearly surrounds points
			const d = 10;
			createSvgElement(
				'polygon',
				{
					points: `${s.x.toFixed(1)},${(s.y - d).toFixed(1)} ${(s.x + d).toFixed(1)},${s.y.toFixed(1)} ${s.x.toFixed(1)},${(s.y + d).toFixed(1)} ${(s.x - d).toFixed(1)},${s.y.toFixed(1)}`,
					fill: COLORS.objectSnapFill,
					stroke: COLORS.objectSnapStroke,
					'stroke-width': STROKE_WIDTH.thin,
					'pointer-events': 'none',
				},
				this.overlayGroup
			);
		} else if (type === 'grid') {
			// Indigo square at grid intersection
			const size = 7;
			createSvgRect(s.x - size, s.y - size, size * 2, size * 2, {
				fill: COLORS.gridSnapFill,
				stroke: COLORS.gridSnapStroke,
				'stroke-width': STROKE_WIDTH.thin,
				rx: 1,
				'pointer-events': 'none',
			}, this.overlayGroup);
		} else {
			// Circular blue ring for point
			createSvgCircle(s.x, s.y, 9, {
				fill: COLORS.pointSnapFill,
				stroke: COLORS.primary,
				'stroke-width': STROKE_WIDTH.thin,
				'pointer-events': 'none',
			}, this.overlayGroup);
		}
	}

	renderDragLine(_s1: Vec2, _s2: Vec2): void {
		// Disabled: user requested not to display dashed displacement line or old ghost anchor dot
		this.overlayGroup.innerHTML = '';
	}

	renderSelectionBox(s1: Vec2, s2: Vec2): void {
		this.overlayGroup.innerHTML = '';
		const minX = Math.min(s1.x, s2.x);
		const minY = Math.min(s1.y, s2.y);
		const width = Math.abs(s2.x - s1.x);
		const height = Math.abs(s2.y - s1.y);

		createSvgRect(minX, minY, width, height, {
			fill: COLORS.selectionBoxFill,
			stroke: COLORS.selected,
			'stroke-width': STROKE_WIDTH.thin,
			'stroke-dasharray': DASH_ARRAY.selectionBox,
			'pointer-events': 'none',
		}, this.overlayGroup);
	}

	clearPreviews(): void {
		this.previewGroup.innerHTML = '';
		this.overlayGroup.innerHTML = '';
	}

	private renderTooltip(x: number, y: number, textStr: string): void {
		const g = createSvgElement('g', undefined, this.previewGroup);
		const width = textStr.length * 7.5 + 14;

		createSvgRect(x - width * 0.5, y - 11, width, 22, {
			rx: 4,
			fill: COLORS.tooltipBg,
			stroke: COLORS.primary,
			'stroke-width': STROKE_WIDTH.thin,
		}, g);

		createSvgText(x, y + 4, textStr, {
			'text-anchor': 'middle',
			fill: COLORS.white,
			'font-size': 11,
			'font-weight': 500,
			'font-family': 'monospace',
		}, g);
	}
}

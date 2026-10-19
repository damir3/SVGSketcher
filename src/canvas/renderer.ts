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
} from '../solver/constraints';
import { type Vec2, dist, projectPointOntoSegment } from '../math/vector';
import { getBadgeIcon } from './badgeIcons';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const TWO_PI = 2 * Math.PI;

export type SvgAttrs = Record<string, string | number | boolean | undefined | null>;

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

		createArrowMarker('dim-arrow', '#0284c7');
		createArrowMarker('dim-arrow-selected', '#0ea5e9');
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
			fill: 'rgba(0, 0, 0, 0.6)',
			'paint-order': 'stroke fill',
			stroke: '#ffffff',
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
				stroke: 'rgba(0, 0, 0, 0.08)',
				'stroke-width': 0.75,
				fill: 'none',
			}, this.gridGroup);
		}

		// Major grid (step = 5 * subStep) - distinct darker lines
		if (dMajor) {
			createSvgPath(dMajor, {
				stroke: 'rgba(0, 0, 0, 0.20)',
				'stroke-width': 1.2,
				fill: 'none',
			}, this.gridGroup);
		}

		// Coordinate labels
		this.gridGroup.appendChild(labelsG);

		// Origin Axes
		const originG = createSvgElement('g', undefined, this.gridGroup);

		// X Axis (Red)
		createSvgLine(0, origin.y, viewport.width, origin.y, {
			stroke: 'rgba(220, 38, 38, 0.65)',
			'stroke-width': 1.5,
		}, originG);

		// Y Axis (Green)
		createSvgLine(origin.x, 0, origin.x, viewport.height, {
			stroke: 'rgba(22, 163, 74, 0.65)',
			'stroke-width': 1.5,
		}, originG);

		// Origin marker target (CAD surveyor style matching reference image)
		const r = 8;
		createSvgPath(`M ${origin.x} ${origin.y} L ${origin.x + r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y - r} Z`, {
			fill: 'rgba(100, 116, 139, 0.45)',
		}, originG);

		createSvgPath(`M ${origin.x} ${origin.y} L ${origin.x - r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y + r} Z`, {
			fill: 'rgba(100, 116, 139, 0.45)',
		}, originG);

		createSvgCircle(origin.x, origin.y, r, {
			fill: 'none',
			stroke: '#64748b',
			'stroke-width': 1.5,
		}, originG);
	}

	private renderGeometry(sketch: SketchDocument, viewport: Viewport): void {
		this.geometryGroup.innerHTML = '';
		this.pointGroup.innerHTML = '';

		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';

		// Light Theme: Unconstrained is bold slate (#1e293b), fully constrained is green (#16a34a), conflict is red (#dc2626)
		const baseColor = hasConflict ? '#dc2626' : isFullyConstrained ? '#16a34a' : '#1e293b';
		const selectedColor = '#0284c7';

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
			createSvgLine(s1.x, s1.y, s2.x, s2.y, {
				class: 'hit-area',
				stroke: 'rgba(0, 0, 0, 0.001)',
				'stroke-width': 18,
				'stroke-linecap': 'round',
				'pointer-events': 'stroke',
			}, lineG);

			// Visible line
			createSvgLine(s1.x, s1.y, s2.x, s2.y, {
				class: 'entity-visible visible-primitive',
				stroke: isSelected ? selectedColor : line.isConstruction ? '#64748b' : baseColor,
				'stroke-width': isSelected ? 3.5 : 2,
				'stroke-linecap': 'round',
				'stroke-dasharray': line.isConstruction ? '6,6' : undefined,
				'pointer-events': 'stroke',
			}, lineG);
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
			createSvgCircle(sc.x, sc.y, sr, {
				class: 'hit-area',
				fill: 'none',
				stroke: 'rgba(0, 0, 0, 0.001)',
				'stroke-width': 18,
				'pointer-events': 'stroke',
			}, circleG);

			// Visible circle
			createSvgCircle(sc.x, sc.y, sr, {
				class: 'entity-visible visible-primitive',
				fill: 'none',
				stroke: isSelected ? selectedColor : circle.isConstruction ? '#64748b' : baseColor,
				'stroke-width': isSelected ? 3.5 : 2,
				'stroke-dasharray': circle.isConstruction ? '6,6' : undefined,
				'pointer-events': 'stroke',
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
			createSvgPath(d, {
				class: 'hit-area',
				fill: 'none',
				stroke: 'rgba(0, 0, 0, 0.001)',
				'stroke-width': 18,
				'stroke-linecap': 'round',
				'pointer-events': 'stroke',
			}, arcG);

			// Visible arc path
			createSvgPath(d, {
				class: 'entity-visible visible-primitive',
				fill: 'none',
				stroke: isSelected ? selectedColor : arc.isConstruction ? '#64748b' : baseColor,
				'stroke-width': isSelected ? 3.5 : 2,
				'stroke-linecap': 'round',
				'stroke-dasharray': arc.isConstruction ? '6,6' : undefined,
				'pointer-events': 'stroke',
			}, arcG);

			// Light dashed radial lines to center if selected
			if (isSelected) {
				const radAttrs: SvgAttrs = {
					stroke: '#0284c7',
					'stroke-width': 1,
					'stroke-dasharray': '3,3',
				};
				createSvgLine(sc.x, sc.y, ss.x, ss.y, radAttrs, arcG);
				createSvgLine(sc.x, sc.y, se.x, se.y, radAttrs, arcG);
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
				class: 'hit-area',
				transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
				fill: 'none',
				stroke: 'rgba(0, 0, 0, 0.001)',
				'stroke-width': 18,
				'pointer-events': 'stroke',
			}, ellipseG);

			// Visible ellipse
			createSvgEllipse(sc.x, sc.y, rx, ry, {
				class: 'entity-visible visible-primitive',
				transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
				fill: 'none',
				stroke: isSelected ? selectedColor : ellipse.isConstruction ? '#64748b' : baseColor,
				'stroke-width': isSelected ? 3.5 : 2,
				'stroke-dasharray': ellipse.isConstruction ? '6,6' : undefined,
				'pointer-events': 'stroke',
			}, ellipseG);

			// Subtle dashed conjugate axes if selected
			if (isSelected) {
				const axAttrs: SvgAttrs = {
					stroke: '#0284c7',
					'stroke-width': 1,
					'stroke-dasharray': '3,3',
				};
				createSvgLine(sc.x, sc.y, smaj.x, smaj.y, axAttrs, ellipseG);
				createSvgLine(sc.x, sc.y, smin.x, smin.y, axAttrs, ellipseG);
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
			createSvgPath(d, {
				class: 'hit-area',
				fill: 'none',
				stroke: 'rgba(0, 0, 0, 0.001)',
				'stroke-width': 18,
				'stroke-linecap': 'round',
				'pointer-events': 'stroke',
			}, arcG);

			// Visible arc path
			createSvgPath(d, {
				class: 'entity-visible visible-primitive',
				fill: 'none',
				stroke: isSelected ? selectedColor : arc.isConstruction ? '#64748b' : baseColor,
				'stroke-width': isSelected ? 3.5 : 2,
				'stroke-linecap': 'round',
				'stroke-dasharray': arc.isConstruction ? '6,6' : undefined,
				'pointer-events': 'stroke',
			}, arcG);

			// Light dashed radial lines to center and axes if selected
			if (isSelected) {
				const radAttrs: SvgAttrs = {
					stroke: '#0284c7',
					'stroke-width': 1,
					'stroke-dasharray': '3,3',
				};
				createSvgLine(sc.x, sc.y, ss.x, ss.y, radAttrs, arcG);
				createSvgLine(sc.x, sc.y, se.x, se.y, radAttrs, arcG);

				const axAttrs: SvgAttrs = {
					stroke: '#0284c7',
					'stroke-width': 1,
					'stroke-dasharray': '2,2',
				};
				createSvgLine(sc.x, sc.y, smaj.x, smaj.y, axAttrs, arcG);
				createSvgLine(sc.x, sc.y, smin.x, smin.y, axAttrs, arcG);
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
			createSvgCircle(s.x, s.y, 14, {
				class: 'hit-area',
				fill: 'rgba(0, 0, 0, 0.001)',
				'pointer-events': 'all',
			}, ptG);

			// Visible point handle
			let fillColor = '#0284c7'; // Default interactive CAD vertex color
			let strokeColor = '#ffffff';

			if (pt.fixed) {
				fillColor = '#d97706'; // Fixed points highlighted amber
			} else if (isFullyConstrained) {
				fillColor = '#16a34a'; // Fully defined
			}

			if (isSelected) {
				fillColor = '#0ea5e9';
				strokeColor = '#0f172a';
			}

			createSvgCircle(s.x, s.y, isSelected ? 4.5 : 3.5, {
				class: 'entity-visible visible-point',
				fill: fillColor,
				stroke: strokeColor,
				'stroke-width': 2,
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

		const orientation = constraint.orientation ?? 'aligned';
		const screenOffset = constraint.offset !== undefined ? constraint.offset * viewport.zoom : 32;

		let d1: Vec2;
		let d2: Vec2;
		let extEnd1: Vec2;
		let extEnd2: Vec2;
		let mid: Vec2;

		if (orientation === 'horizontal') {
			const midY = (s1.y + s2.y) * 0.5;
			const dimY = midY + screenOffset;
			d1 = { x: s1.x, y: dimY };
			d2 = { x: s2.x, y: dimY };
			const extDir = screenOffset >= 0 ? 1 : -1;
			extEnd1 = { x: s1.x, y: dimY + extDir * 5 };
			extEnd2 = { x: s2.x, y: dimY + extDir * 5 };
			mid = { x: (d1.x + d2.x) * 0.5, y: dimY };
		} else if (orientation === 'vertical') {
			const midX = (s1.x + s2.x) * 0.5;
			const dimX = midX + screenOffset;
			d1 = { x: dimX, y: s1.y };
			d2 = { x: dimX, y: s2.y };
			const extDir = screenOffset >= 0 ? 1 : -1;
			extEnd1 = { x: dimX + extDir * 5, y: s1.y };
			extEnd2 = { x: dimX + extDir * 5, y: s2.y };
			mid = { x: dimX, y: (d1.y + d2.y) * 0.5 };
		} else {
			const dx = s2.x - s1.x;
			const dy = s2.y - s1.y;
			const len = Math.hypot(dx, dy);
			if (len < 1e-4) return;

			const nx = -dy / len;
			const ny = dx / len;
			d1 = { x: s1.x + nx * screenOffset, y: s1.y + ny * screenOffset };
			d2 = { x: s2.x + nx * screenOffset, y: s2.y + ny * screenOffset };
			extEnd1 = { x: d1.x + nx * 5, y: d1.y + ny * 5 };
			extEnd2 = { x: d2.x + nx * 5, y: d2.y + ny * 5 };
			mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };
		}

		const g = createSvgElement('g', {
			class: 'dimension-item',
			'data-id': constraint.id,
			'data-type': 'constraint',
		}, this.constraintGroup);

		const color = isSelected ? '#0ea5e9' : '#0284c7';
		const extAttrs: SvgAttrs = {
			stroke: 'rgba(2, 132, 199, 0.45)',
			'stroke-width': 1,
			'pointer-events': 'none',
		};

		// Extension lines from points
		createSvgLine(s1.x, s1.y, extEnd1.x, extEnd1.y, extAttrs, g);
		createSvgLine(s2.x, s2.y, extEnd2.x, extEnd2.y, extAttrs, g);

		// Dimension line with arrowheads
		const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';
		createSvgLine(d1.x, d1.y, d2.x, d2.y, {
			stroke: color,
			'stroke-width': 1.5,
			'marker-start': arrowUrl,
			'marker-end': arrowUrl,
		}, g);

		// Text label badge with background
		const textVal = Number.isInteger(constraint.targetDistance)
			? constraint.targetDistance.toFixed(1)
			: Number(constraint.targetDistance.toFixed(2)).toString();
		const textLen = textVal.length * 8 + 14;

		createSvgRect(mid.x - textLen * 0.5, mid.y - 10, textLen, 20, {
			rx: 4,
			fill: '#ffffff',
			stroke: color,
			'stroke-width': isSelected ? 2 : 1,
		}, g);

		createSvgText(mid.x, mid.y + 4, textVal, {
			'text-anchor': 'middle',
			fill: color,
			'font-size': 12,
			'font-weight': 600,
			'font-family': 'monospace',
		}, g);
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
				'stroke-width': 1.2,
				'stroke-dasharray': '4,4',
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

		const color = isSelected ? '#0ea5e9' : '#0284c7';

		// Dashed extension lines if arc points extend beyond the physical line segments
		const sp1 = viewport.worldToScreen(p1.x, p1.y);
		const sp2 = viewport.worldToScreen(p2.x, p2.y);
		const sp3 = viewport.worldToScreen(p3.x, p3.y);
		const sp4 = viewport.worldToScreen(p4.x, p4.y);

		this.renderDashedExtensionLines(g, sCenter, a1, rScreen, sp1, sp2, color);
		this.renderDashedExtensionLines(g, sCenter, a2, rScreen, sp3, sp4, color);

		// Arc path with arrowheads
		const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';
		createSvgPath(
			`M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`,
			{
				fill: 'none',
				stroke: color,
				'stroke-width': 1.5,
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
			fill: '#ffffff',
			stroke: color,
			'stroke-width': 1.5,
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

		const color = isSelected ? '#0ea5e9' : '#0284c7';
		const arrowUrl = isSelected ? 'url(#dim-arrow-selected)' : 'url(#dim-arrow)';

		// Leader radial line from center to edge with arrow at circumference
		createSvgLine(sc.x, sc.y, edge.x, edge.y, {
			stroke: color,
			'stroke-width': 1.5,
			'marker-end': arrowUrl,
		}, g);

		// Shelf line from edge to tip
		createSvgLine(edge.x, edge.y, tip.x, tip.y, {
			stroke: color,
			'stroke-width': 1.5,
		}, g);

		const isDiameter = constraint.displayMode === 'diameter';
		const num = isDiameter ? constraint.targetRadius * 2 : constraint.targetRadius;
		const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
		const textVal = isDiameter ? `Ø ${numStr}` : `R ${numStr}`;
		const textLen = textVal.length * 8 + 14;

		const rectX = dirX > 0 ? tip.x : tip.x - textLen;
		createSvgRect(rectX, tip.y - 12, textLen, 20, {
			rx: 4,
			fill: '#ffffff',
			stroke: color,
			'stroke-width': isSelected ? 2 : 1,
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
		this.renderConstraintBadge(constraint.id, s.x + 12, s.y + 12, '◎', isSelected, '#0284c7');
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
		this.renderConstraintBadge(constraint.id, s.x, s.y - 14, 'M', isSelected, '#0284c7');
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
		this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, '#0284c7');
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
		this.renderConstraintBadge(constraint.id, s.x, s.y + 14, '⚲', isSelected, '#0284c7');
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
		this.renderConstraintBadge(constraint.id, s.x + 12, s.y - 12, 'fixed', isSelected, '#d97706');
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
		this.renderConstraintBadge(constraint.id, s.x - 12, s.y - 12, '●', isSelected, '#0284c7');
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

		const color = isSelected ? '#0284c7' : customColor ?? '#475569';
		const icon = getBadgeIcon(label, x, y, color);
		const width = icon ? 18 : Math.max(18, label.length * 8 + 8);

		createSvgRect(x - width * 0.5, y - 9, width, 18, {
			rx: 3,
			fill: isSelected ? '#e0f2fe' : '#ffffff',
			stroke: isSelected ? '#0284c7' : '#cbd5e1',
			'stroke-width': isSelected ? 1.5 : 1,
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

		createSvgLine(s1.x, s1.y, s2.x, s2.y, {
			stroke: isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-linecap': 'round',
			'stroke-dasharray': isConstruction ? '6,6' : undefined,
		}, this.previewGroup);

		// Length & Angle Tooltip
		const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
		const badgeText = axisBadge ? ` [${axisBadge}]` : '';
		const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°${badgeText}`;
		this.renderTooltip(mid.x, mid.y, label);
	}

	renderDistancePreview(
		s1: Vec2,
		s2: Vec2,
		cursor: Vec2,
		distVal: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
	): void {
		this.previewGroup.innerHTML = '';

		let d1: Vec2;
		let d2: Vec2;
		let extEnd1: Vec2;
		let extEnd2: Vec2;
		let mid: Vec2;

		if (orientation === 'horizontal') {
			const dimY = cursor.y;
			d1 = { x: s1.x, y: dimY };
			d2 = { x: s2.x, y: dimY };
			const midY = (s1.y + s2.y) * 0.5;
			const extDir = dimY >= midY ? 1 : -1;
			extEnd1 = { x: s1.x, y: dimY + extDir * 4 };
			extEnd2 = { x: s2.x, y: dimY + extDir * 4 };
			mid = { x: (d1.x + d2.x) * 0.5, y: dimY };
		} else if (orientation === 'vertical') {
			const dimX = cursor.x;
			d1 = { x: dimX, y: s1.y };
			d2 = { x: dimX, y: s2.y };
			const midX = (s1.x + s2.x) * 0.5;
			const extDir = dimX >= midX ? 1 : -1;
			extEnd1 = { x: dimX + extDir * 4, y: s1.y };
			extEnd2 = { x: dimX + extDir * 4, y: s2.y };
			mid = { x: dimX, y: (d1.y + d2.y) * 0.5 };
		} else {
			const dx = s2.x - s1.x;
			const dy = s2.y - s1.y;
			const len = Math.hypot(dx, dy);
			if (len < 1e-4) return;

			const nx = -dy / len;
			const ny = dx / len;
			const midX = (s1.x + s2.x) * 0.5;
			const midY = (s1.y + s2.y) * 0.5;
			const offset = (cursor.x - midX) * nx + (cursor.y - midY) * ny;

			d1 = { x: s1.x + nx * offset, y: s1.y + ny * offset };
			d2 = { x: s2.x + nx * offset, y: s2.y + ny * offset };
			extEnd1 = { x: d1.x + nx * 4, y: d1.y + ny * 4 };
			extEnd2 = { x: d2.x + nx * 4, y: d2.y + ny * 4 };
			mid = { x: (d1.x + d2.x) * 0.5, y: (d1.y + d2.y) * 0.5 };
		}

		const extAttrs: SvgAttrs = {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		};
		createSvgLine(s1.x, s1.y, extEnd1.x, extEnd1.y, extAttrs, this.previewGroup);
		createSvgLine(s2.x, s2.y, extEnd2.x, extEnd2.y, extAttrs, this.previewGroup);

		createSvgLine(d1.x, d1.y, d2.x, d2.y, {
			stroke: '#0284c7',
			'stroke-width': 1.5,
			'marker-start': 'url(#dim-arrow)',
			'marker-end': 'url(#dim-arrow)',
		}, this.previewGroup);

		const labelPrefix = orientation === 'horizontal' ? 'H: ' : orientation === 'vertical' ? 'V: ' : '';
		this.renderTooltip(mid.x, mid.y, `${labelPrefix}${distVal.toFixed(1)} mm`);
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
			this.renderDashedExtensionLines(this.previewGroup, sCenter, a1, rScreen, sp1, sp2, '#0284c7');
		}
		if (sp3 && sp4) {
			this.renderDashedExtensionLines(this.previewGroup, sCenter, a2, rScreen, sp3, sp4, '#0284c7');
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
				stroke: '#0284c7',
				'stroke-width': 1.5,
				'marker-start': 'url(#dim-arrow)',
				'marker-end': 'url(#dim-arrow)',
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
		createSvgCircle(center.x, center.y, rPx, {
			stroke: isGuide ? '#0284c7' : isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-dasharray': isGuide ? '4,4' : isConstruction ? '6,6' : undefined,
			fill: 'none',
		}, this.previewGroup);

		createSvgLine(center.x, center.y, current.x, current.y, {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		}, this.previewGroup);

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
		createSvgCircle(sc.x, sc.y, sr, {
			stroke: 'rgba(2, 132, 199, 0.25)',
			'stroke-width': 1,
			'stroke-dasharray': '2,4',
			fill: 'none',
		}, this.previewGroup);

		const d = getArcSvgPath(sc, ss, se, sr, clockwise);
		createSvgPath(d, {
			stroke: isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-linecap': 'round',
			'stroke-dasharray': isConstruction ? '6,6' : undefined,
			fill: 'none',
		}, this.previewGroup);

		// Dashed center rays
		const rayAttrs: SvgAttrs = {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		};
		createSvgLine(sc.x, sc.y, ss.x, ss.y, rayAttrs, this.previewGroup);
		createSvgLine(sc.x, sc.y, se.x, se.y, rayAttrs, this.previewGroup);

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

		createSvgRect(rx, ry, rw, rh, {
			stroke: isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-dasharray': isConstruction ? '6,6' : undefined,
			fill: 'none',
		}, this.previewGroup);

		this.renderTooltip(s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
	}

	renderEllipseMajorAxisPreview(sc: Vec2, current: Vec2, radiusVal: number, _isConstruction = false): void {
		this.previewGroup.innerHTML = '';

		createSvgLine(sc.x, sc.y, current.x, current.y, {
			stroke: '#0284c7',
			'stroke-width': 1.5,
			'stroke-dasharray': '3,3',
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
			stroke: isGuide ? '#0284c7' : isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-dasharray': isGuide ? '4,4' : isConstruction ? '6,6' : undefined,
			fill: 'none',
		}, this.previewGroup);

		const axisAttrs: SvgAttrs = {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		};
		createSvgLine(sc.x, sc.y, smaj.x, smaj.y, axisAttrs, this.previewGroup);
		createSvgLine(sc.x, sc.y, smin.x, smin.y, axisAttrs, this.previewGroup);

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
			stroke: 'rgba(2, 132, 199, 0.3)',
			'stroke-width': 1.5,
			'stroke-dasharray': '3,3',
			fill: 'none',
		}, this.previewGroup);

		createSvgLine(sc.x, sc.y, ss.x, ss.y, {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		}, this.previewGroup);

		createSvgCircle(ss.x, ss.y, 4, {
			fill: '#0284c7',
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
			stroke: 'rgba(2, 132, 199, 0.25)',
			'stroke-width': 1,
			'stroke-dasharray': '2,4',
			fill: 'none',
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
		createSvgPath(d, {
			stroke: isConstruction ? '#64748b' : '#1e293b',
			'stroke-width': 2,
			'stroke-linecap': 'round',
			'stroke-dasharray': isConstruction ? '6,6' : undefined,
			fill: 'none',
		}, this.previewGroup);

		const rayAttrs: SvgAttrs = {
			stroke: '#0284c7',
			'stroke-width': 1,
			'stroke-dasharray': '2,2',
		};
		createSvgLine(sc.x, sc.y, ss.x, ss.y, rayAttrs, this.previewGroup);
		createSvgLine(sc.x, sc.y, se.x, se.y, rayAttrs, this.previewGroup);

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
					fill: 'rgba(16, 185, 129, 0.25)',
					stroke: '#0e9c6dff',
					'stroke-width': 1,
					'pointer-events': 'none',
				},
				this.overlayGroup
			);
		} else if (type === 'grid') {
			// Indigo square at grid intersection
			const size = 7;
			createSvgRect(s.x - size, s.y - size, size * 2, size * 2, {
				fill: 'rgba(99, 102, 241, 0.15)',
				stroke: '#7cbdfaff',
				'stroke-width': 1,
				rx: 1,
				'pointer-events': 'none',
			}, this.overlayGroup);
		} else {
			// Circular blue ring for point
			createSvgCircle(s.x, s.y, 9, {
				fill: 'rgba(2, 132, 199, 0.2)',
				stroke: '#0284c7',
				'stroke-width': 1,
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
			fill: 'rgba(14, 165, 233, 0.12)',
			stroke: '#0ea5e9',
			'stroke-width': 1,
			'stroke-dasharray': '4 3',
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
			fill: '#0f172a',
			stroke: '#0284c7',
			'stroke-width': 1,
		}, g);

		createSvgText(x, y + 4, textStr, {
			'text-anchor': 'middle',
			fill: '#ffffff',
			'font-size': 11,
			'font-weight': 500,
			'font-family': 'monospace',
		}, g);
	}
}

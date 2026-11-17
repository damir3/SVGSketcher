import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import {
	COLORS,
	DIMENSION_TEXT_ATTRS,
	GIZMO_CIRCLE_ATTRS,
	GIZMO_CIRCLE_RADIUS,
	GIZMO_GUIDE_ATTRS,
	SVG_NS,
	type SvgAttrs,
} from './styles';
import { Vec2, type XY } from '../math/vector';

export function fmtCoord(v: number | string): string {
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

export function createSvgLine(start: XY, end: XY, attrs?: SvgAttrs, parent?: SVGElement): SVGLineElement {
	return createSvgElement(
		'line',
		{
			x1: fmtCoord(start.x),
			y1: fmtCoord(start.y),
			x2: fmtCoord(end.x),
			y2: fmtCoord(end.y),
			...attrs,
		},
		parent
	);
}

export function createSvgCircle(
	center: XY,
	r: number | string,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGCircleElement {
	return createSvgElement(
		'circle',
		{
			cx: fmtCoord(center.x),
			cy: fmtCoord(center.y),
			r: fmtCoord(r),
			...attrs,
		},
		parent
	);
}

export function createSvgRect(position: Vec2, size: Vec2, attrs?: SvgAttrs, parent?: SVGElement): SVGRectElement {
	return createSvgElement(
		'rect',
		{
			x: fmtCoord(position.x),
			y: fmtCoord(position.y),
			width: fmtCoord(size.x),
			height: fmtCoord(size.y),
			...attrs,
		},
		parent
	);
}

export function createSvgEllipse(center: Vec2, r: Vec2, attrs?: SvgAttrs, parent?: SVGElement): SVGEllipseElement {
	return createSvgElement(
		'ellipse',
		{
			cx: fmtCoord(center.x),
			cy: fmtCoord(center.y),
			rx: fmtCoord(r.x),
			ry: fmtCoord(r.y),
			...attrs,
		},
		parent
	);
}

export function createSvgPath(d: string, attrs?: SvgAttrs, parent?: SVGElement): SVGPathElement {
	return createSvgElement(
		'path',
		{
			d,
			...attrs,
		},
		parent
	);
}

export function createSvgArrow(
	tip: XY,
	dir: XY,
	length = 16,
	halfWidth = 6.5,
	attrs?: SvgAttrs,
	parent?: SVGElement
): SVGPathElement {
	const u = Vec2.from(dir);
	const perp = u.clone().perpendicular();
	const base = Vec2.from(tip).addScaledVector(u, -length);
	const b1 = base.clone().addScaledVector(perp, halfWidth);
	const b2 = base.clone().addScaledVector(perp, -halfWidth);
	return createSvgPath(`M ${tip.x} ${tip.y} L ${b1.x} ${b1.y} L ${b2.x} ${b2.y} Z`, attrs, parent);
}

export function createSvgGizmoCircle(
	center: XY,
	parent?: SVGElement,
	color: string = COLORS.primary,
	attrs?: SvgAttrs
): SVGCircleElement {
	return createSvgCircle(
		center,
		GIZMO_CIRCLE_RADIUS,
		{
			...GIZMO_CIRCLE_ATTRS,
			stroke: color,
			...attrs,
		},
		parent
	);
}

export function createSvgGizmoDashedLine(
	start: XY,
	end: XY,
	parent?: SVGElement,
	color: string = COLORS.primary,
	attrs?: SvgAttrs
): SVGLineElement {
	return createSvgLine(
		start,
		end,
		{
			...GIZMO_GUIDE_ATTRS,
			stroke: color,
			...attrs,
		},
		parent
	);
}

export function createSvgText(position: Vec2, text: string, attrs?: SvgAttrs, parent?: SVGElement): SVGTextElement {
	return createSvgElement(
		'text',
		{
			x: fmtCoord(position.x),
			y: fmtCoord(position.y),
			...attrs,
		},
		parent,
		text
	);
}

export interface DimensionLabelOptions {
	angleDeg?: number;
}

export function renderDimensionLabel(
	parent: SVGElement,
	center: Vec2,
	label: string,
	color: string,
	_kind: 'linear' | 'angle' = 'linear',
	options?: DimensionLabelOptions
): void {
	const angleDeg = options?.angleDeg ?? 0;

	const labelG = createSvgElement(
		'g',
		{
			class: 'dimension-label',
			transform:
				Math.abs(angleDeg) > 1e-2
					? `translate(${fmtCoord(center.x)}, ${fmtCoord(center.y)}) rotate(${fmtCoord(angleDeg)})`
					: `translate(${fmtCoord(center.x)}, ${fmtCoord(center.y)})`,
			'pointer-events': 'all',
		},
		parent
	);

	createSvgText(
		new Vec2(0, 0),
		label,
		{
			...DIMENSION_TEXT_ATTRS,
			fill: color,
		},
		labelG
	);
}

const TWO_PI = 2 * Math.PI;

export function getArcSweep(startAngle: number, endAngle: number, clockwise: boolean): number {
	const sweep = (clockwise ? endAngle - startAngle : startAngle - endAngle) % TWO_PI;
	return sweep < 0 ? sweep + TWO_PI : sweep;
}

function formatArcSvgPath(
	ss: XY,
	se: XY,
	rx: number,
	ry: number,
	xAxisRotationDeg: string,
	sweepFlag: 0 | 1,
	midpoint?: XY
): string {
	const arc = (to: XY) =>
		`A ${rx.toFixed(2)} ${ry.toFixed(2)} ${xAxisRotationDeg} 0 ${sweepFlag} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
	return midpoint
		? `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} ${arc(midpoint)} ${arc(se)}`
		: `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} ${arc(se)}`;
}

export function getArcSvgPath(sc: Vec2, ss: Vec2, se: Vec2, sr: number, clockwise: boolean): string {
	const as = sc.angleToPoint(ss);
	const sweepAngle = getArcSweep(as, sc.angleToPoint(se), clockwise);
	const sweepFlag = clockwise ? 1 : 0;
	const midpoint =
		sweepAngle > Math.PI * 0.75 ? Vec2.fromPolar(sr, as + (clockwise ? 0.5 : -0.5) * sweepAngle).add(sc) : undefined;
	return formatArcSvgPath(ss, se, sr, sr, '0', sweepFlag, midpoint);
}

export function getEllipticalArcSvgPath(
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2,
	se: Vec2,
	clockwise: boolean
): string {
	const r = sc.distancesTo(smaj, smin);
	if (r.x < 0.1 || r.y < 0.1) return '';

	const theta = sc.angleToPoint(smaj);
	const { axisU: u, axisV: v } = ellipseAxes(theta);
	const ts = ellipseParameterAtPoint(ss, sc, r, u, v);
	const sweepAngle = getArcSweep(ts, ellipseParameterAtPoint(se, sc, r, u, v), clockwise);
	const sweepFlag = clockwise ? 1 : 0;
	const midpoint =
		sweepAngle > Math.PI * 0.75
			? ellipsePointAtParameter(ts + (clockwise ? 0.5 : -0.5) * sweepAngle, sc, r, u, v)
			: undefined;
	return formatArcSvgPath(ss, se, r.x, r.y, ((theta * 180) / Math.PI).toFixed(2), sweepFlag, midpoint);
}

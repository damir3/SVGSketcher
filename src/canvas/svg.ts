import { SVG_NS, type SvgAttrs, TOOLTIP_RECT_ATTRS, TOOLTIP_TEXT_ATTRS } from './styles';
import type { Vec2 } from '../math/vector';

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

export function renderTooltip(parent: SVGElement, x: number, y: number, textStr: string): void {
	const g = createSvgElement('g', undefined, parent);
	const width = textStr.length * 7.5 + 14;
	createSvgRect(x - width * 0.5, y - 11, width, 22, TOOLTIP_RECT_ATTRS, g);
	createSvgText(x, y + 4, textStr, TOOLTIP_TEXT_ATTRS, g);
}

const TWO_PI = 2 * Math.PI;

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

	if (sweepAngle <= Math.PI * 0.75) {
		return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
	}

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


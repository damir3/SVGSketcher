import { SVG_NS, type SvgAttrs, TOOLTIP_RECT_ATTRS, TOOLTIP_TEXT_ATTRS } from './styles';
import { dot, sub, vec, distancesFrom, type Vec2 } from '../math/vector';

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

export function createSvgLine(start: Vec2, end: Vec2, attrs?: SvgAttrs, parent?: SVGElement): SVGLineElement {
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
	center: Vec2,
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

export function renderTooltip(parent: SVGElement, position: Vec2, textStr: string): void {
	const g = createSvgElement('g', undefined, parent);
	const width = textStr.length * 7.5 + 14;
	createSvgRect({ x: position.x - width * 0.5, y: position.y - 11 }, { x: width, y: 22 }, TOOLTIP_RECT_ATTRS, g);
	createSvgText({ x: position.x, y: position.y + 4 }, textStr, TOOLTIP_TEXT_ATTRS, g);
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
	const midpoint = vec(sc.x + sr * Math.cos(midAngle), sc.y + sr * Math.sin(midAngle));

	return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${midpoint.x.toFixed(2)} ${midpoint.y.toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
}

export function getEllipticalArcSvgPath(
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2,
	se: Vec2,
	clockwise: boolean
): string {
	const r = distancesFrom(sc, smaj, smin);
	if (r.x < 0.1 || r.y < 0.1) return '';

	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const thetaDeg = (theta * 180) / Math.PI;

	const u = vec(Math.cos(theta), Math.sin(theta));
	const v = vec(-Math.sin(theta), Math.cos(theta));

	const startOffset = sub(ss, sc);
	const us = dot(startOffset, u);
	const vs = dot(startOffset, v);
	const endOffset = sub(se, sc);
	const ue = dot(endOffset, u);
	const ve = dot(endOffset, v);

	const ts = Math.atan2(vs / r.y, us / r.x);
	const te = Math.atan2(ve / r.y, ue / r.x);

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
		return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
	}

	const tmid = clockwise ? ts + sweepAngle * 0.5 : ts - sweepAngle * 0.5;
	const umid = r.x * Math.cos(tmid);
	const vmid = r.y * Math.sin(tmid);
	const midpoint = vec(sc.x + umid * u.x + vmid * v.x, sc.y + umid * u.y + vmid * v.y);

	return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${midpoint.x.toFixed(2)} ${midpoint.y.toFixed(2)} A ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
}

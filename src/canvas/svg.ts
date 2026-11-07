import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import { COLORS, SVG_NS, STROKE_WIDTH, type SvgAttrs } from './styles';
import { angleFromTo, vec, distancesFrom, type Vec2 } from '../math/vector';

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

export function renderDimensionLabel(
	parent: SVGElement,
	center: Vec2,
	label: string,
	color: string,
	kind: 'linear' | 'angle' = 'linear'
): void {
	const width = label.length * 8 + 14;
	const isAngle = kind === 'angle';
	createSvgRect(
		{ x: center.x - width * 0.5, y: center.y - 10 },
		{ x: width, y: 20 },
		{ rx: 4, fill: COLORS.white, stroke: color, 'stroke-width': isAngle ? STROKE_WIDTH.dimension : STROKE_WIDTH.thin },
		parent
	);
	createSvgText(
		{ x: center.x, y: center.y + 4 },
		label,
		{
			'text-anchor': 'middle',
			fill: color,
			'font-size': isAngle ? 11 : 12,
			'font-weight': isAngle ? 700 : 600,
			'font-family': isAngle ? 'ui-monospace, monospace' : 'monospace',
		},
		parent
	);
}

const TWO_PI = 2 * Math.PI;

export function getArcSvgPath(sc: Vec2, ss: Vec2, se: Vec2, sr: number, clockwise: boolean): string {
	const as = angleFromTo(sc, ss);
	const ae = angleFromTo(sc, se);

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

	const theta = angleFromTo(sc, smaj);
	const thetaDeg = (theta * 180) / Math.PI;

	const { axisU: u, axisV: v } = ellipseAxes(theta);

	const ts = ellipseParameterAtPoint(ss, sc, r, u, v);
	const te = ellipseParameterAtPoint(se, sc, r, u, v);

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
	const midpoint = ellipsePointAtParameter(tmid, sc, r, u, v);

	return `M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${midpoint.x.toFixed(2)} ${midpoint.y.toFixed(2)} A ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${thetaDeg.toFixed(2)} 0 ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}`;
}

import { SVG_NS, type SvgAttrs } from './styles';

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

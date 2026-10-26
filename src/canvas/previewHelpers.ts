import type { Vec2 } from '../math/vector';
import type { Viewport } from './viewport';
import type { TrimCandidate } from '../math/intersection';
import {
	createSvgElement,
	createSvgLine,
	createSvgCircle,
	createSvgRect,
	createSvgEllipse,
	createSvgPath,
	renderTooltip,
} from './svg';
import {
	COLORS,
	STROKE_WIDTH,
	DASH_ARRAY,
	getPreviewStrokeAttrs,
	AUX_RAY_ATTRS,
	GUIDE_OUTLINE_ATTRS,
	POLYGON_VERTEX_ATTRS,
	POLYGON_CENTER_ATTRS,
	POLYGON_RADIUS_HANDLE_ATTRS,
	SPLINE_STYLES,
	SPLINE_PREVIEW_GUIDE_ATTRS,
	SPLINE_PREVIEW_VERTEX_ATTRS,
	SPLINE_CHECKMARK_CIRCLE_ATTRS,
	SPLINE_CHECKMARK_PATH_ATTRS,
	getSplinePreviewStrokeAttrs,
	TRIM_STROKE_ATTRS,
	CUT_MARKER_ATTRS,
} from './styles';
import { getArcSvgPath, getEllipticalArcSvgPath } from './svg';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineSvgPath,
	extractSplineInterval,
	type BezierSegment,
} from '../math/spline';

const TWO_PI = 2 * Math.PI;

export function renderLinePreviewVisual(
	parent: SVGElement,
	s1: Vec2,
	s2: Vec2,
	len: number,
	angleDeg: number,
	isConstruction = false,
	axisBadge?: 'H' | 'V'
): void {
	createSvgLine(s1.x, s1.y, s2.x, s2.y, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
	const badgeText = axisBadge ? ` [${axisBadge}]` : '';
	const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°${badgeText}`;
	renderTooltip(parent, mid.x, mid.y, label);
}

export function renderCirclePreviewVisual(
	parent: SVGElement,
	center: Vec2,
	current: Vec2,
	radius: number,
	isConstruction = false,
	isGuide = false
): void {
	const rPx = Math.hypot(current.x - center.x, current.y - center.y);
	createSvgCircle(center.x, center.y, rPx, getPreviewStrokeAttrs(isConstruction, isGuide), parent);
	createSvgLine(center.x, center.y, current.x, current.y, AUX_RAY_ATTRS, parent);
	renderTooltip(parent, current.x + 12, current.y - 12, `R ${radius.toFixed(1)} mm`);
}

export function renderArcPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	ss: Vec2,
	se: Vec2,
	sr: number,
	clockwise: boolean,
	radiusVal: number,
	sweepDeg?: number,
	isConstruction = false
): void {
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

	createSvgCircle(sc.x, sc.y, sr, GUIDE_OUTLINE_ATTRS, parent);

	const d = getArcSvgPath(sc, ss, se, sr, clockwise);
	createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, parent);
	createSvgLine(sc.x, sc.y, se.x, se.y, AUX_RAY_ATTRS, parent);

	const midAngle = clockwise ? as + sweepAngle * 0.5 : as - sweepAngle * 0.5;
	const midX = sc.x + sr * Math.cos(midAngle);
	const midY = sc.y + sr * Math.sin(midAngle);

	const deg = sweepDeg ?? (sweepAngle * 180 / Math.PI);
	renderTooltip(parent, midX, midY, `R ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
}

export function renderRectanglePreviewVisual(
	parent: SVGElement,
	s1: Vec2,
	s2: Vec2,
	w: number,
	h: number,
	isConstruction = false
): void {
	const minX = Math.min(s1.x, s2.x);
	const minY = Math.min(s1.y, s2.y);
	const width = Math.abs(s2.x - s1.x);
	const height = Math.abs(s2.y - s1.y);

	createSvgRect(minX, minY, width, height, getPreviewStrokeAttrs(isConstruction), parent);
	renderTooltip(parent, s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
}

export function renderPolygonPreviewVisual(
	parent: SVGElement,
	sCtr: Vec2,
	centerWorld: Vec2,
	sides: number,
	inradius: number,
	angleRad: number,
	isConstruction: boolean,
	viewport: Viewport
): void {
	const N = Math.max(3, Math.round(sides));
	const R = inradius / Math.cos(Math.PI / N);
	const sInradius = inradius * viewport.zoom;

	createSvgCircle(sCtr.x, sCtr.y, sInradius, GUIDE_OUTLINE_ATTRS, parent);

	const midWorld: Vec2 = {
		x: centerWorld.x + inradius * Math.cos(angleRad),
		y: centerWorld.y + inradius * Math.sin(angleRad),
	};
	const midScreen = viewport.worldToScreen(midWorld.x, midWorld.y);
	createSvgLine(sCtr.x, sCtr.y, midScreen.x, midScreen.y, AUX_RAY_ATTRS, parent);

	const baseAngle = angleRad - Math.PI / N;
	const step = (2 * Math.PI) / N;
	const pts: Vec2[] = [];
	for (let i = 0; i < N; i++) {
		const a = baseAngle + i * step;
		const wx = centerWorld.x + R * Math.cos(a);
		const wy = centerWorld.y + R * Math.sin(a);
		pts.push(viewport.worldToScreen(wx, wy));
	}

	if (pts.length >= 3) {
		let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
		for (let i = 1; i < pts.length; i++) {
			d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
		}
		d += ' Z';
		createSvgPath(d, getPreviewStrokeAttrs(isConstruction), parent);
	}

	for (const pt of pts) {
		createSvgCircle(pt.x, pt.y, 2.5, POLYGON_VERTEX_ATTRS, parent);
	}
	createSvgCircle(sCtr.x, sCtr.y, 3, POLYGON_CENTER_ATTRS, parent);
	createSvgCircle(midScreen.x, midScreen.y, 2.5, POLYGON_RADIUS_HANDLE_ATTRS, parent);
}

export function renderEllipseMajorAxisPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	current: Vec2,
	radiusVal: number,
	_isConstruction = false
): void {
	createSvgLine(sc.x, sc.y, current.x, current.y, {
		stroke: COLORS.primary,
		'stroke-width': STROKE_WIDTH.dimension,
		'stroke-dasharray': DASH_ARRAY.axis,
	}, parent);

	const deg = (Math.atan2(current.y - sc.y, current.x - sc.x) * 180) / Math.PI;
	renderTooltip(parent, current.x + 12, current.y - 12, `Rx ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
}

export function renderEllipsePreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	rxVal: number,
	ryVal: number,
	isConstruction = false,
	isGuide = false
): void {
	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

	createSvgEllipse(sc.x, sc.y, rx, ry, {
		transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
		...getPreviewStrokeAttrs(isConstruction, isGuide),
	}, parent);

	createSvgLine(sc.x, sc.y, smaj.x, smaj.y, AUX_RAY_ATTRS, parent);
	createSvgLine(sc.x, sc.y, smin.x, smin.y, AUX_RAY_ATTRS, parent);

	renderTooltip(parent, smin.x + 12, smin.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm`);
}

export function renderEllipticalArcStartPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2,
	rxVal: number,
	ryVal: number,
	_isConstruction = false
): void {
	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

	createSvgEllipse(sc.x, sc.y, rx, ry, {
		transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
		stroke: COLORS.guideStartEllipse,
		'stroke-width': STROKE_WIDTH.dimension,
		'stroke-dasharray': DASH_ARRAY.axis,
		fill: 'none',
	}, parent);

	createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, parent);
	createSvgCircle(ss.x, ss.y, 4, { fill: COLORS.primary }, parent);
	renderTooltip(parent, ss.x + 12, ss.y - 12, `Start Angle | Rx ${rxVal.toFixed(1)} Ry ${ryVal.toFixed(1)}`);
}

export function renderEllipticalArcPreviewVisual(
	parent: SVGElement,
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
	const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
	const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
	if (rx < 0.1 || ry < 0.1) return;

	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const thetaDeg = (theta * 180) / Math.PI;

	createSvgEllipse(sc.x, sc.y, rx, ry, {
		transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
		...GUIDE_OUTLINE_ATTRS,
	}, parent);

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
	createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	createSvgLine(sc.x, sc.y, ss.x, ss.y, AUX_RAY_ATTRS, parent);
	createSvgLine(sc.x, sc.y, se.x, se.y, AUX_RAY_ATTRS, parent);

	const sweepDeg = (sweepAngle * 180) / Math.PI;
	renderTooltip(parent, se.x + 12, se.y - 12, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm | ${sweepDeg.toFixed(1)}°`);
}

export function renderSplinePreviewVisual(
	parent: SVGElement,
	splineType: 'fit' | 'control',
	points: Vec2[],
	cursorPos: Vec2,
	isConstruction = false
): { checkmarkPos?: Vec2 } {
	if (points.length === 0) return {};

	const allPts = [...points, cursorPos];
	let segments: BezierSegment[] = [];
	if (splineType === 'control') {
		segments = bsplineToBezier(allPts);
		for (let i = 0; i < allPts.length - 1; i++) {
			createSvgLine(allPts[i].x, allPts[i].y, allPts[i + 1].x, allPts[i + 1].y, SPLINE_STYLES.controlPolygon, parent);
		}
	} else {
		segments = fitPointsToBezier(allPts);
	}

	const d = getSplineSvgPath(segments);
	createSvgPath(d, getSplinePreviewStrokeAttrs(isConstruction), parent);

	const lastPt = points[points.length - 1];
	createSvgLine(lastPt.x, lastPt.y, cursorPos.x, cursorPos.y, SPLINE_PREVIEW_GUIDE_ATTRS, parent);

	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		createSvgCircle(p.x, p.y, 3, SPLINE_PREVIEW_VERTEX_ATTRS, parent);
	}

	const checkmarkPos = { x: lastPt.x + 20, y: lastPt.y - 12 };
	const checkG = createSvgElement('g', {
		class: 'spline-finish-checkmark',
		style: 'cursor: pointer;',
	}, parent);

	createSvgCircle(checkmarkPos.x, checkmarkPos.y, 11, SPLINE_CHECKMARK_CIRCLE_ATTRS, checkG);
	const checkD = `M ${checkmarkPos.x - 4} ${checkmarkPos.y} L ${checkmarkPos.x - 1} ${checkmarkPos.y + 3.5} L ${checkmarkPos.x + 4.5} ${checkmarkPos.y - 3.5}`;
	createSvgPath(checkD, SPLINE_CHECKMARK_PATH_ATTRS, checkG);

	return { checkmarkPos };
}

export function renderTrimPreviewVisual(parent: SVGElement, candidate: TrimCandidate, viewport: Viewport): void {
	const { curve, isWholeEntity, cutStartWorld, cutEndWorld } = candidate;

	if (isWholeEntity) {
		if (curve.type === 'segment') {
			const s1 = viewport.worldToScreen(curve.p1.x, curve.p1.y);
			const s2 = viewport.worldToScreen(curve.p2.x, curve.p2.y);
			createSvgLine(s1.x, s1.y, s2.x, s2.y, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'circle') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const sr = curve.radius * viewport.zoom;
			createSvgCircle(sc.x, sc.y, sr, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'arc') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const ss = viewport.worldToScreen(curve.start.x, curve.start.y);
			const se = viewport.worldToScreen(curve.end.x, curve.end.y);
			const sr = curve.radius * viewport.zoom;
			const d = getArcSvgPath(sc, ss, se, sr, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'ellipse') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
			const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
			const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
			const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
			const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
			createSvgEllipse(sc.x, sc.y, rx, ry, { transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`, ...TRIM_STROKE_ATTRS }, parent);
		} else if (curve.type === 'elliptical_arc') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
			const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
			const ss = viewport.worldToScreen(curve.start.x, curve.start.y);
			const se = viewport.worldToScreen(curve.end.x, curve.end.y);
			const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'spline') {
			const d = getSplineSvgPath(curve.bezierSegments, p => viewport.worldToScreen(p.x, p.y), !!curve.isClosed);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		}
		return;
	}

	const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
	const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);

	if (curve.type === 'segment') {
		createSvgLine(sStart.x, sStart.y, sEnd.x, sEnd.y, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'circle') {
		const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
		const sr = curve.radius * viewport.zoom;
		const d = getArcSvgPath(sc, sStart, sEnd, sr, true);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'arc') {
		const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
		const sr = curve.radius * viewport.zoom;
		const d = getArcSvgPath(sc, sStart, sEnd, sr, curve.clockwise);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'ellipse') {
		const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
		const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
		const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
		const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, true);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'elliptical_arc') {
		const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
		const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
		const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
		const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, curve.clockwise);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'spline') {
		const subSegments = extractSplineInterval(curve.bezierSegments, candidate.interval[0], candidate.interval[1]);
		const d = getSplineSvgPath(subSegments, p => viewport.worldToScreen(p.x, p.y));
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	}
}

export function renderCutMarkerVisual(parent: SVGElement, pt: Vec2): void {
	const size = 5;
	createSvgLine(pt.x - size, pt.y - size, pt.x + size, pt.y + size, CUT_MARKER_ATTRS, parent);
	createSvgLine(pt.x - size, pt.y + size, pt.x + size, pt.y - size, CUT_MARKER_ATTRS, parent);
}

export function renderBreakPreviewVisual(parent: SVGElement, candidate: TrimCandidate, viewport: Viewport): void {
	const { curve, isWholeEntity, cutStartWorld, cutEndWorld, interval } = candidate;
	if (isWholeEntity) return;

	if (curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && !!curve.isClosed)) {
		const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
		const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);
		renderCutMarkerVisual(parent, sStart);
		renderCutMarkerVisual(parent, sEnd);
	} else {
		if (interval[0] > 1e-4) {
			const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
			renderCutMarkerVisual(parent, sStart);
		}
		if (interval[1] < 1 - 1e-4) {
			const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);
			renderCutMarkerVisual(parent, sEnd);
		}
	}
}

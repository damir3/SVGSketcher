import { abs, distancesFrom, vec, type Vec2 } from '../math/vector';
import type { Viewport } from './viewport';
import type { TrimCandidate } from '../math/intersection';
import type { ExtendCandidate } from '../math/extend';
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
	createSvgLine(s1, s2, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	const mid = { x: (s1.x + s2.x) * 0.5, y: (s1.y + s2.y) * 0.5 - 16 };
	const badgeText = axisBadge ? ` [${axisBadge}]` : '';
	const label = `${len.toFixed(1)} mm | ${angleDeg.toFixed(1)}°${badgeText}`;
	renderTooltip(parent, mid, label);
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
	createSvgCircle(center, rPx, getPreviewStrokeAttrs(isConstruction, isGuide), parent);
	createSvgLine(center, current, AUX_RAY_ATTRS, parent);
	renderTooltip(parent, { x: current.x + 12, y: current.y - 12 }, `R ${radius.toFixed(1)} mm`);
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

	createSvgCircle(sc, sr, GUIDE_OUTLINE_ATTRS, parent);

	const d = getArcSvgPath(sc, ss, se, sr, clockwise);
	createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	createSvgLine(sc, ss, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, se, AUX_RAY_ATTRS, parent);

	const midAngle = clockwise ? as + sweepAngle * 0.5 : as - sweepAngle * 0.5;
	const midX = sc.x + sr * Math.cos(midAngle);
	const midY = sc.y + sr * Math.sin(midAngle);

	const deg = sweepDeg ?? (sweepAngle * 180) / Math.PI;
	renderTooltip(parent, { x: midX, y: midY }, `R ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
}

export function renderRectanglePreviewVisual(
	parent: SVGElement,
	s1: Vec2,
	s2: Vec2,
	w: number,
	h: number,
	isConstruction = false
): void {
	const min = { x: Math.min(s1.x, s2.x), y: Math.min(s1.y, s2.y) };
	const size = abs(s2, s1);
	const width = size.x;
	const height = size.y;

	createSvgRect(min, { x: width, y: height }, getPreviewStrokeAttrs(isConstruction), parent);
	renderTooltip(parent, { x: s2.x + 12, y: s2.y - 12 }, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
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

	createSvgCircle(sCtr, sInradius, GUIDE_OUTLINE_ATTRS, parent);

	const midWorld: Vec2 = {
		x: centerWorld.x + inradius * Math.cos(angleRad),
		y: centerWorld.y + inradius * Math.sin(angleRad),
	};
	const midScreen = viewport.worldToScreen(midWorld);
	createSvgLine(sCtr, midScreen, AUX_RAY_ATTRS, parent);

	const baseAngle = angleRad - Math.PI / N;
	const step = (2 * Math.PI) / N;
	const pts: Vec2[] = [];
	for (let i = 0; i < N; i++) {
		const a = baseAngle + i * step;
		const wx = centerWorld.x + R * Math.cos(a);
		const wy = centerWorld.y + R * Math.sin(a);
		pts.push(viewport.worldToScreen({ x: wx, y: wy }));
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
		createSvgCircle(pt, 2.5, POLYGON_VERTEX_ATTRS, parent);
	}
	createSvgCircle(sCtr, 3, POLYGON_CENTER_ATTRS, parent);
	createSvgCircle(midScreen, 2.5, POLYGON_RADIUS_HANDLE_ATTRS, parent);
}

export function renderEllipseMajorAxisPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	current: Vec2,
	radiusVal: number,
	_isConstruction = false
): void {
	createSvgLine(
		sc,
		current,
		{
			stroke: COLORS.primary,
			'stroke-width': STROKE_WIDTH.dimension,
			'stroke-dasharray': DASH_ARRAY.axis,
		},
		parent
	);

	const deg = (Math.atan2(current.y - sc.y, current.x - sc.x) * 180) / Math.PI;
	renderTooltip(parent, { x: current.x + 12, y: current.y - 12 }, `Rx ${radiusVal.toFixed(1)} mm | ${deg.toFixed(1)}°`);
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
	const r = distancesFrom(sc, smaj, smin);
	const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;

	createSvgEllipse(
		sc,
		{ x: r.x, y: r.y },
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...getPreviewStrokeAttrs(isConstruction, isGuide),
		},
		parent
	);

	createSvgLine(sc, smaj, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, smin, AUX_RAY_ATTRS, parent);

	renderTooltip(parent, { x: smin.x + 12, y: smin.y - 12 }, `Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm`);
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
	const r = distancesFrom(sc, smaj, smin);
	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const thetaDeg = (theta * 180) / Math.PI;

	createSvgEllipse(
		sc,
		{ x: r.x, y: r.y },
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			stroke: COLORS.guideStartEllipse,
			'stroke-width': STROKE_WIDTH.dimension,
			'stroke-dasharray': DASH_ARRAY.axis,
			fill: 'none',
		},
		parent
	);

	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
	const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
	const ts = Math.atan2(vs / r.y, us / r.x);

	const projSs = vec(
		sc.x + r.x * Math.cos(ts) * ux + r.y * Math.sin(ts) * vx,
		sc.y + r.x * Math.cos(ts) * uy + r.y * Math.sin(ts) * vy
	);

	createSvgLine(sc, projSs, AUX_RAY_ATTRS, parent);
	createSvgCircle(projSs, 4, { fill: COLORS.primary }, parent);
	renderTooltip(
		parent,
		{ x: projSs.x + 12, y: projSs.y - 12 },
		`Start Angle | Rx ${rxVal.toFixed(1)} Ry ${ryVal.toFixed(1)}`
	);
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
	const r = distancesFrom(sc, smaj, smin);
	if (r.x < 0.1 || r.y < 0.1) return;

	const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
	const thetaDeg = (theta * 180) / Math.PI;

	createSvgEllipse(
		sc,
		{ x: r.x, y: r.y },
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...GUIDE_OUTLINE_ATTRS,
		},
		parent
	);

	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const vx = -Math.sin(theta);
	const vy = Math.cos(theta);

	const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
	const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
	const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
	const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

	const ts = Math.atan2(vs / r.y, us / r.x);
	const te = Math.atan2(ve / r.y, ue / r.x);

	let sweepAngle = 0;
	if (clockwise) {
		sweepAngle = (te - ts) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	} else {
		sweepAngle = (ts - te) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
	}

	const projSe = vec(
		sc.x + r.x * Math.cos(te) * ux + r.y * Math.sin(te) * vx,
		sc.y + r.x * Math.cos(te) * uy + r.y * Math.sin(te) * vy
	);

	const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, projSe, clockwise);
	createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	createSvgLine(sc, ss, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, projSe, AUX_RAY_ATTRS, parent);

	const sweepDeg = (sweepAngle * 180) / Math.PI;
	renderTooltip(
		parent,
		{ x: projSe.x + 12, y: projSe.y - 12 },
		`Rx ${rxVal.toFixed(1)} | Ry ${ryVal.toFixed(1)} mm | ${sweepDeg.toFixed(1)}°`
	);
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
			createSvgLine(allPts[i], allPts[i + 1], SPLINE_STYLES.controlPolygon, parent);
		}
	} else {
		segments = fitPointsToBezier(allPts);
	}

	const d = getSplineSvgPath(segments);
	createSvgPath(d, getSplinePreviewStrokeAttrs(isConstruction), parent);

	const lastPt = points[points.length - 1];
	createSvgLine(lastPt, cursorPos, SPLINE_PREVIEW_GUIDE_ATTRS, parent);

	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		createSvgCircle(p, 3, SPLINE_PREVIEW_VERTEX_ATTRS, parent);
	}

	const checkmarkPos = { x: lastPt.x + 20, y: lastPt.y - 12 };
	const checkG = createSvgElement(
		'g',
		{
			class: 'spline-finish-checkmark',
			style: 'cursor: pointer;',
		},
		parent
	);

	createSvgCircle(checkmarkPos, 11, SPLINE_CHECKMARK_CIRCLE_ATTRS, checkG);
	const checkD = `M ${checkmarkPos.x - 4} ${checkmarkPos.y} L ${checkmarkPos.x - 1} ${checkmarkPos.y + 3.5} L ${checkmarkPos.x + 4.5} ${checkmarkPos.y - 3.5}`;
	createSvgPath(checkD, SPLINE_CHECKMARK_PATH_ATTRS, checkG);

	return { checkmarkPos };
}

export function renderTrimPreviewVisual(parent: SVGElement, candidate: TrimCandidate, viewport: Viewport): void {
	const { curve, isWholeEntity, cutStartWorld, cutEndWorld } = candidate;

	if (isWholeEntity) {
		if (curve.type === 'segment') {
			const s1 = viewport.worldToScreen(curve.p1);
			const s2 = viewport.worldToScreen(curve.p2);
			createSvgLine(s1, s2, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'circle') {
			const sc = viewport.worldToScreen(curve.center);
			const sr = curve.radius * viewport.zoom;
			createSvgCircle(sc, sr, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'arc') {
			const sc = viewport.worldToScreen(curve.center);
			const ss = viewport.worldToScreen(curve.start);
			const se = viewport.worldToScreen(curve.end);
			const sr = curve.radius * viewport.zoom;
			const d = getArcSvgPath(sc, ss, se, sr, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'ellipse') {
			const sc = viewport.worldToScreen(curve.center);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint);
			const smin = viewport.worldToScreen(curve.minorAxisPoint);
			const r = distancesFrom(sc, smaj, smin);
			const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
			createSvgEllipse(
				sc,
				{ x: r.x, y: r.y },
				{
					transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
					...TRIM_STROKE_ATTRS,
				},
				parent
			);
		} else if (curve.type === 'elliptical_arc') {
			const sc = viewport.worldToScreen(curve.center);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint);
			const smin = viewport.worldToScreen(curve.minorAxisPoint);
			const ss = viewport.worldToScreen(curve.start);
			const se = viewport.worldToScreen(curve.end);
			const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		} else if (curve.type === 'spline') {
			const d = getSplineSvgPath(curve.bezierSegments, p => viewport.worldToScreen(p), !!curve.isClosed);
			createSvgPath(d, TRIM_STROKE_ATTRS, parent);
		}
		return;
	}

	const sStart = viewport.worldToScreen(cutStartWorld);
	const sEnd = viewport.worldToScreen(cutEndWorld);

	if (curve.type === 'segment') {
		createSvgLine(sStart, sEnd, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'circle') {
		const sc = viewport.worldToScreen(curve.center);
		const sr = curve.radius * viewport.zoom;
		const d = getArcSvgPath(sc, sStart, sEnd, sr, true);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'arc') {
		const sc = viewport.worldToScreen(curve.center);
		const sr = curve.radius * viewport.zoom;
		const d = getArcSvgPath(sc, sStart, sEnd, sr, curve.clockwise);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'ellipse') {
		const sc = viewport.worldToScreen(curve.center);
		const smaj = viewport.worldToScreen(curve.majorAxisPoint);
		const smin = viewport.worldToScreen(curve.minorAxisPoint);
		const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, true);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'elliptical_arc') {
		const sc = viewport.worldToScreen(curve.center);
		const smaj = viewport.worldToScreen(curve.majorAxisPoint);
		const smin = viewport.worldToScreen(curve.minorAxisPoint);
		const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, curve.clockwise);
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'spline') {
		const subSegments = extractSplineInterval(curve.bezierSegments, candidate.interval[0], candidate.interval[1]);
		const d = getSplineSvgPath(subSegments, p => viewport.worldToScreen(p));
		createSvgPath(d, TRIM_STROKE_ATTRS, parent);
	}
}

export function renderCutMarkerVisual(parent: SVGElement, pt: Vec2): void {
	const size = 5;
	createSvgLine({ x: pt.x - size, y: pt.y - size }, { x: pt.x + size, y: pt.y + size }, CUT_MARKER_ATTRS, parent);
	createSvgLine({ x: pt.x - size, y: pt.y + size }, { x: pt.x + size, y: pt.y - size }, CUT_MARKER_ATTRS, parent);
}

export function renderBreakPreviewVisual(parent: SVGElement, candidate: TrimCandidate, viewport: Viewport): void {
	const { curve, isWholeEntity, cutStartWorld, cutEndWorld, interval } = candidate;
	if (isWholeEntity) return;

	if (curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && !!curve.isClosed)) {
		const sStart = viewport.worldToScreen(cutStartWorld);
		const sEnd = viewport.worldToScreen(cutEndWorld);
		renderCutMarkerVisual(parent, sStart);
		renderCutMarkerVisual(parent, sEnd);
	} else {
		if (interval[0] > 1e-4) {
			const sStart = viewport.worldToScreen(cutStartWorld);
			renderCutMarkerVisual(parent, sStart);
		}
		if (interval[1] < 1 - 1e-4) {
			const sEnd = viewport.worldToScreen(cutEndWorld);
			renderCutMarkerVisual(parent, sEnd);
		}
	}
}

export function renderExtendPreviewVisual(parent: SVGElement, candidate: ExtendCandidate, viewport: Viewport): void {
	const EXTEND_PREVIEW_ATTRS = {
		stroke: '#0284c7',
		'stroke-width': 2,
		'stroke-dasharray': '5 3',
		fill: 'none',
		'stroke-linecap': 'round',
		'pointer-events': 'none',
	};

	const sFrom = viewport.worldToScreen(candidate.fromPoint);
	const sTo = viewport.worldToScreen(candidate.toPoint);

	if (candidate.previewType === 'line' || candidate.previewType === 'spline') {
		createSvgLine(sFrom, sTo, EXTEND_PREVIEW_ATTRS, parent);
		createSvgCircle(
			sTo,
			4,
			{
				fill: '#0284c7',
				stroke: '#ffffff',
				'stroke-width': 1.5,
				'pointer-events': 'none',
			},
			parent
		);
	} else if (candidate.previewType === 'arc') {
		if (candidate.becomesFullLoop) {
			if (candidate.previewData.becomesFullCircle) {
				const c = candidate.previewData.center;
				const r = candidate.previewData.radius;
				const sc = viewport.worldToScreen(c);
				createSvgCircle(sc, r * viewport.zoom, EXTEND_PREVIEW_ATTRS, parent);
			} else if (candidate.previewData.becomesFullEllipse) {
				const c = candidate.previewData.center;
				const maj = candidate.previewData.majorAxisPoint;
				const min = candidate.previewData.minorAxisPoint;
				const sc = viewport.worldToScreen(c);
				const smaj = viewport.worldToScreen(maj);
				const smin = viewport.worldToScreen(min);
				const r = distancesFrom(sc, smaj, smin);
				const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
				createSvgEllipse(
					sc,
					{ x: r.x, y: r.y },
					{
						transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
						...EXTEND_PREVIEW_ATTRS,
					},
					parent
				);
			}
		} else {
			if (candidate.targetType === 'arc') {
				const c = candidate.previewData.center;
				const r = candidate.previewData.radius;
				const sc = viewport.worldToScreen(c);
				const ss = viewport.worldToScreen(candidate.fromPoint);
				const se = viewport.worldToScreen(candidate.toPoint);
				const d = getArcSvgPath(sc, ss, se, r * viewport.zoom, !!candidate.previewData.clockwise);
				createSvgPath(d, EXTEND_PREVIEW_ATTRS, parent);
			} else if (candidate.targetType === 'elliptical_arc') {
				const c = candidate.previewData.center;
				const maj = candidate.previewData.majorAxisPoint;
				const min = candidate.previewData.minorAxisPoint;
				const sc = viewport.worldToScreen(c);
				const smaj = viewport.worldToScreen(maj);
				const smin = viewport.worldToScreen(min);
				const ss = viewport.worldToScreen(candidate.fromPoint);
				const se = viewport.worldToScreen(candidate.toPoint);
				const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, !!candidate.previewData.clockwise);
				createSvgPath(d, EXTEND_PREVIEW_ATTRS, parent);
			}
			createSvgCircle(
				sTo,
				4,
				{
					fill: '#0284c7',
					stroke: '#ffffff',
					'stroke-width': 1.5,
					'pointer-events': 'none',
				},
				parent
			);
		}
	}
}

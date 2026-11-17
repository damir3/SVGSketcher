import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../math/ellipse';
import { Vec2 } from '../math/vector';
import type { Viewport } from './viewport';
import type { TrimCandidate } from '../math/intersection';
import type { ExtendCandidate } from '../math/extend';
import { POINT_TOLERANCE } from '../constants';
import {
	createSvgElement,
	createSvgLine,
	createSvgCircle,
	createSvgEllipse,
	createSvgPath,
	createSvgRect,
} from './svg';
import {
	COLORS,
	STROKE_WIDTH,
	DASH_ARRAY,
	getPreviewStrokeAttrs,
	AUX_RAY_ATTRS,
	GUIDE_OUTLINE_ATTRS,
	PREVIEW_POINT_ATTRS,
	POLYGON_RADIUS_HANDLE_ATTRS,
	SPLINE_STYLES,
	SPLINE_PREVIEW_GUIDE_ATTRS,
	SPLINE_PREVIEW_VERTEX_ATTRS,
	SPLINE_CHECKMARK_CIRCLE_ATTRS,
	SPLINE_CHECKMARK_PATH_ATTRS,
	getSplinePreviewStrokeAttrs,
	TRIM_STROKE_ATTRS,
	SELECTION_BOX_ATTRS,
	CROSSING_SELECTION_BOX_ATTRS,
	SNAP_POINT_ATTRS,
	SNAP_GRID_ATTRS,
	SNAP_OBJECT_ATTRS,
	type SvgAttrs,
} from './styles';
import { getArcSvgPath, getEllipticalArcSvgPath } from './svg';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineSvgPath,
	extractSplineInterval,
	type BezierSegment,
} from '../math/spline';
import { createTraceTransform, type TracePlacement, type TraceResult } from '../model/imageTrace';

export function renderArcPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	ss: Vec2,
	se: Vec2,
	sr: number,
	clockwise: boolean,
	isConstruction = false
): void {
	createSvgCircle(sc, sr, GUIDE_OUTLINE_ATTRS, parent);
	createSvgPath(getArcSvgPath(sc, ss, se, sr, clockwise), getPreviewStrokeAttrs(isConstruction, false, true), parent);
	createSvgLine(sc, ss, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, se, AUX_RAY_ATTRS, parent);
}

export function renderPolygonPreviewVisual(
	parent: SVGElement,
	sCtr: Vec2,
	centerWorld: Vec2,
	sides: number,
	radius: number,
	angleRad: number,
	isConstruction: boolean,
	viewport: Viewport,
	{ radiusToVertex = false, showGuide = true } = {}
): void {
	const N = Math.max(3, Math.round(sides));
	const R = radiusToVertex ? radius : radius / Math.cos(Math.PI / N);
	const baseAngle = radiusToVertex ? angleRad : angleRad - Math.PI / N;

	const handle = showGuide ? viewport.worldToScreen(Vec2.fromPolar(radius, angleRad).add(centerWorld)) : null;
	if (handle) {
		createSvgCircle(sCtr, radius * viewport.zoom, GUIDE_OUTLINE_ATTRS, parent);
		createSvgLine(sCtr, handle, AUX_RAY_ATTRS, parent);
	}

	const step = (2 * Math.PI) / N;
	const pts: Vec2[] = [];
	for (let i = 0; i < N; i++) {
		const a = baseAngle + i * step;
		const w = Vec2.fromPolar(R, a).add(centerWorld);
		pts.push(viewport.worldToScreen(w));
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
		createSvgCircle(pt, 2.5, PREVIEW_POINT_ATTRS, parent);
	}
	createSvgCircle(sCtr, 3, PREVIEW_POINT_ATTRS, parent);
	if (handle) createSvgCircle(handle, 2.5, POLYGON_RADIUS_HANDLE_ATTRS, parent);
}

export function renderEllipseMajorAxisPreviewVisual(parent: SVGElement, sc: Vec2, current: Vec2): void {
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
}

export function renderEllipsePreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	isConstruction = false,
	isGuide = false
): void {
	const r = sc.distancesTo(smaj, smin);
	const thetaDeg = sc.angleToPointDeg(smaj);

	createSvgEllipse(
		sc,
		r,
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...getPreviewStrokeAttrs(isConstruction, isGuide),
		},
		parent
	);

	createSvgLine(sc, smaj, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, smin, AUX_RAY_ATTRS, parent);
}

export function renderEllipticalArcStartPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2
): void {
	const r = sc.distancesTo(smaj, smin);
	const theta = sc.angleToPoint(smaj);
	const thetaDeg = (theta * 180) / Math.PI;

	createSvgEllipse(
		sc,
		r,
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			stroke: COLORS.guideStartEllipse,
			'stroke-width': STROKE_WIDTH.dimension,
			'stroke-dasharray': DASH_ARRAY.axis,
			fill: 'none',
		},
		parent
	);

	const { axisU: u, axisV: v } = ellipseAxes(theta);

	const ts = ellipseParameterAtPoint(ss, sc, r, u, v);

	const projSs = ellipsePointAtParameter(ts, sc, r, u, v);

	createSvgLine(sc, projSs, AUX_RAY_ATTRS, parent);
	createSvgCircle(projSs, 4, { fill: COLORS.primary }, parent);
}

export function renderEllipticalArcPreviewVisual(
	parent: SVGElement,
	sc: Vec2,
	smaj: Vec2,
	smin: Vec2,
	ss: Vec2,
	se: Vec2,
	clockwise: boolean,
	isConstruction = false
): void {
	const r = sc.distancesTo(smaj, smin);
	if (r.x < 0.1 || r.y < 0.1) return;

	const theta = sc.angleToPoint(smaj);
	const thetaDeg = (theta * 180) / Math.PI;

	createSvgEllipse(
		sc,
		r,
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...GUIDE_OUTLINE_ATTRS,
		},
		parent
	);

	const { axisU: u, axisV: v } = ellipseAxes(theta);

	const te = ellipseParameterAtPoint(se, sc, r, u, v);

	const projSe = ellipsePointAtParameter(te, sc, r, u, v);

	const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, projSe, clockwise);
	createSvgPath(d, getPreviewStrokeAttrs(isConstruction, false, true), parent);

	createSvgLine(sc, ss, AUX_RAY_ATTRS, parent);
	createSvgLine(sc, projSe, AUX_RAY_ATTRS, parent);
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

	if (points.length < 2) return {};

	const checkmarkPos = new Vec2(lastPt.x + 20, lastPt.y - 12);
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

function drawRotatedScreenEllipse(
	parent: SVGElement,
	viewport: Viewport,
	center: Vec2,
	majorAxisPoint: Vec2,
	minorAxisPoint: Vec2,
	attrs: SvgAttrs
): void {
	const sc = viewport.worldToScreen(center);
	const smaj = viewport.worldToScreen(majorAxisPoint);
	const smin = viewport.worldToScreen(minorAxisPoint);
	const r = sc.distancesTo(smaj, smin);
	const thetaDeg = sc.angleToPointDeg(smaj);
	createSvgEllipse(
		sc,
		r,
		{
			transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
			...attrs,
		},
		parent
	);
}

export function renderTrimPreviewVisual(parent: SVGElement, candidate: TrimCandidate, viewport: Viewport): void {
	const { curve, isWholeEntity, cutStartWorld, cutEndWorld } = candidate;

	const sFrom = viewport.worldToScreen(
		!isWholeEntity
			? cutStartWorld
			: curve.type === 'segment'
				? curve.p1
				: curve.type === 'arc' || curve.type === 'elliptical_arc'
					? curve.start
					: cutStartWorld
	);
	const sTo = viewport.worldToScreen(
		!isWholeEntity
			? cutEndWorld
			: curve.type === 'segment'
				? curve.p2
				: curve.type === 'arc' || curve.type === 'elliptical_arc'
					? curve.end
					: cutEndWorld
	);

	if (curve.type === 'segment') {
		createSvgLine(sFrom, sTo, TRIM_STROKE_ATTRS, parent);
	} else if (curve.type === 'circle' || curve.type === 'arc') {
		const sc = viewport.worldToScreen(curve.center);
		const sr = curve.radius * viewport.zoom;
		if (isWholeEntity && curve.type === 'circle') {
			createSvgCircle(sc, sr, TRIM_STROKE_ATTRS, parent);
		} else {
			const clockwise = curve.type === 'circle' ? true : curve.clockwise;
			createSvgPath(getArcSvgPath(sc, sFrom, sTo, sr, clockwise), TRIM_STROKE_ATTRS, parent);
		}
	} else if (curve.type === 'ellipse' || curve.type === 'elliptical_arc') {
		if (isWholeEntity && curve.type === 'ellipse') {
			drawRotatedScreenEllipse(
				parent,
				viewport,
				curve.center,
				curve.majorAxisPoint,
				curve.minorAxisPoint,
				TRIM_STROKE_ATTRS
			);
		} else {
			const sc = viewport.worldToScreen(curve.center);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint);
			const smin = viewport.worldToScreen(curve.minorAxisPoint);
			const clockwise = curve.type === 'ellipse' ? true : curve.clockwise;
			createSvgPath(getEllipticalArcSvgPath(sc, smaj, smin, sFrom, sTo, clockwise), TRIM_STROKE_ATTRS, parent);
		}
	} else if (curve.type === 'spline') {
		const segments = isWholeEntity
			? curve.bezierSegments
			: extractSplineInterval(curve.bezierSegments, candidate.interval[0], candidate.interval[1]);
		createSvgPath(
			getSplineSvgPath(segments, p => viewport.worldToScreen(p), isWholeEntity && !!curve.isClosed),
			TRIM_STROKE_ATTRS,
			parent
		);
	}
}

export function renderCutMarkerVisual(parent: SVGElement, pt: Vec2): void {
	const size = 5;
	createSvgLine(pt.clone().subScalar(size), pt.clone().addScalar(size), TRIM_STROKE_ATTRS, parent);
	createSvgLine(new Vec2(pt.x - size, pt.y + size), new Vec2(pt.x + size, pt.y - size), TRIM_STROKE_ATTRS, parent);
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
		if (interval[0] > POINT_TOLERANCE) {
			const sStart = viewport.worldToScreen(cutStartWorld);
			renderCutMarkerVisual(parent, sStart);
		}
		if (interval[1] < 1 - POINT_TOLERANCE) {
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
	} else if (candidate.previewType === 'arc') {
		if (candidate.becomesFullLoop) {
			if (candidate.previewData.becomesFullCircle) {
				const sc = viewport.worldToScreen(candidate.previewData.center);
				createSvgCircle(sc, candidate.previewData.radius * viewport.zoom, EXTEND_PREVIEW_ATTRS, parent);
			} else if (candidate.previewData.becomesFullEllipse) {
				drawRotatedScreenEllipse(
					parent,
					viewport,
					candidate.previewData.center,
					candidate.previewData.majorAxisPoint,
					candidate.previewData.minorAxisPoint,
					EXTEND_PREVIEW_ATTRS
				);
			}
			return;
		}
		if (candidate.targetType === 'arc') {
			const sc = viewport.worldToScreen(candidate.previewData.center);
			const d = getArcSvgPath(
				sc,
				sFrom,
				sTo,
				candidate.previewData.radius * viewport.zoom,
				!!candidate.previewData.clockwise
			);
			createSvgPath(d, EXTEND_PREVIEW_ATTRS, parent);
		} else if (candidate.targetType === 'elliptical_arc') {
			const sc = viewport.worldToScreen(candidate.previewData.center);
			const smaj = viewport.worldToScreen(candidate.previewData.majorAxisPoint);
			const smin = viewport.worldToScreen(candidate.previewData.minorAxisPoint);
			const d = getEllipticalArcSvgPath(sc, smaj, smin, sFrom, sTo, !!candidate.previewData.clockwise);
			createSvgPath(d, EXTEND_PREVIEW_ATTRS, parent);
		}
	}

	if (candidate.previewType === 'line' || candidate.previewType === 'spline' || candidate.previewType === 'arc') {
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

export function renderTracePreviewVisual(
	parent: SVGElement,
	viewport: Viewport,
	result: TraceResult,
	placement: TracePlacement,
	isConstruction: boolean
): void {
	const { toWorld, scale } = createTraceTransform(result, placement);
	const strokeAttrs = getPreviewStrokeAttrs(isConstruction, false, true);
	const group = createSvgElement('g', { class: 'image-trace-preview', 'pointer-events': 'none' }, parent);

	const worldVertices = result.vertices.map(toWorld);
	const screenVertices = worldVertices.map(p => viewport.worldToScreen(p));
	const visibleVertices = new Set<number>();

	for (const path of result.paths) {
		for (const segment of path.segments) {
			visibleVertices.add(segment.a);
			visibleVertices.add(segment.b);
			if (segment.kind === 'line') {
				createSvgLine(screenVertices[segment.a], screenVertices[segment.b], strokeAttrs, group);
			} else if (segment.kind === 'arc') {
				const start = worldVertices[segment.a];
				const mid = toWorld(segment.mid);
				const end = worldVertices[segment.b];
				const turn = (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x);
				const sc = viewport.worldToScreen(toWorld(segment.center));
				const sr = segment.radius * scale * viewport.zoom;
				const d = getArcSvgPath(sc, screenVertices[segment.a], screenVertices[segment.b], sr, turn < 0);
				createSvgPath(d, strokeAttrs, group);
			} else {
				const fitPoints = [worldVertices[segment.a], ...segment.points.map(toWorld), worldVertices[segment.b]];
				const handles = segment.handles.map(h => ({ h1: toWorld(h.h1), h2: toWorld(h.h2) }));
				const beziers = fitPointsToBezier(fitPoints, handles);
				const d = getSplineSvgPath(beziers, p => viewport.worldToScreen(p), false);
				createSvgPath(d, strokeAttrs, group);
			}
		}
	}

	for (const circle of result.circles) {
		const sc = viewport.worldToScreen(toWorld(circle.center));
		const sr = circle.radius * scale * viewport.zoom;
		createSvgCircle(sc, sr, strokeAttrs, group);
		createSvgCircle(sc, 2.5, PREVIEW_POINT_ATTRS, group);
	}

	for (const spline of result.closedSplines) {
		if (spline.points.length < 2) continue;
		const worldPoints = spline.points.map(toWorld);
		const worldHandles = spline.handles.map(h => ({ h1: toWorld(h.h1), h2: toWorld(h.h2) }));
		const beziers = fitPointsToBezier([...worldPoints, worldPoints[0]], [...worldHandles, worldHandles[0]]);
		const d = getSplineSvgPath(beziers, p => viewport.worldToScreen(p), true);
		createSvgPath(d, strokeAttrs, group);
	}

	if (visibleVertices.size <= 500) {
		for (const index of visibleVertices) {
			createSvgCircle(screenVertices[index], 2.5, PREVIEW_POINT_ATTRS, group);
		}
	}
}

export function renderSnapIndicatorVisual(
	overlayGroup: SVGGElement,
	s: Vec2,
	type: 'point' | 'line' | 'circle' | 'spline' | 'ellipse' | 'grid' = 'point',
	clearFirst = true
): void {
	if (clearFirst) {
		overlayGroup.innerHTML = '';
	}

	if (type === 'line' || type === 'circle' || type === 'spline' || type === 'ellipse') {
		const d = 7;
		createSvgElement(
			'polygon',
			{
				points: `${s.x.toFixed(1)},${(s.y - d).toFixed(1)} ${(s.x + d).toFixed(1)},${s.y.toFixed(1)} ${s.x.toFixed(1)},${(s.y + d).toFixed(1)} ${(s.x - d).toFixed(1)},${s.y.toFixed(1)}`,
				...SNAP_OBJECT_ATTRS,
			},
			overlayGroup
		);
	} else if (type === 'grid') {
		const size = 5;
		createSvgRect(
			s.clone().subScalar(size),
			new Vec2(size * 2, size * 2),
			{
				...SNAP_GRID_ATTRS,
				rx: 1,
			},
			overlayGroup
		);
	} else {
		createSvgCircle(s, 7, SNAP_POINT_ATTRS, overlayGroup);
	}
}

export function renderSelectionBoxVisual(overlayGroup: SVGGElement, s1: Vec2, s2: Vec2): void {
	overlayGroup.innerHTML = '';
	const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
	const width = Math.abs(s2.x - s1.x);
	const height = Math.abs(s2.y - s1.y);

	const attrs = s2.x < s1.x ? CROSSING_SELECTION_BOX_ATTRS : SELECTION_BOX_ATTRS;
	createSvgRect(min, new Vec2(width, height), attrs, overlayGroup);
}

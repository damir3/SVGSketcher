import type { SketchDocument } from '../model/sketch';
import type { SketchPoint, SketchSpline } from '../model/types';
import type { Viewport } from './viewport';
import {
	computePatternCopyAngle,
	computeRectangularPatternOffset,
	computeRectangularPatternDirections,
	type ConstraintRenderContext,
} from '../solver/constraints';
import { type Vec2 } from '../math/vector';
import { getBadgeIcon } from './badgeIcons';
import { sketchPrimitiveToGeoCurve, type GeoSpline, type TrimCandidate } from '../math/intersection';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineSvgPath,
	extractSplineInterval,
	type BezierSegment,
} from '../math/spline';

export * from './styles';
export * from './svg';
export * from './dimensionGeometry';

import {
	createSvgElement,
	createSvgLine,
	createSvgCircle,
	createSvgRect,
	createSvgEllipse,
	createSvgPath,
	createSvgText,
} from './svg';
import {
	type LinearDimensionVisualOptions,
	computeDistanceDimensionGeometry,
	computePointToLineDimensionGeometry,
} from './dimensionGeometry';
import {
	COLORS,
	DASH_ARRAY,
	STROKE_WIDTH,
	DIM_ARROWS,
	FILTERS,
	type SvgAttrs,
	HIT_AREA_STROKE_ATTRS,
	HIT_AREA_RING_ATTRS,
	HIT_AREA_POINT_ATTRS,
	AUX_RAY_ATTRS,
	AUX_AXIS_ATTRS,
	GUIDE_OUTLINE_ATTRS,
	EXTENSION_LINE_ATTRS,
	PREVIEW_EXTENSION_LINE_ATTRS,
	TRIM_STROKE_ATTRS,
	CUT_MARKER_ATTRS,
	SELECTION_BOX_ATTRS,
	MIRROR_LINE_ATTRS,
	DIR1_LINE_ATTRS,
	DIR2_LINE_ATTRS,
	MIRROR_PREVIEW_LINE_ATTRS,
	MIRROR_PREVIEW_VERTEX_ATTRS,
	PATTERN_CENTER_RING_ATTRS,
	PATTERN_CENTER_CROSSHAIR_ATTRS,
	PATTERN_CENTER_DOT_ATTRS,
	CHECKBOX_HALO_ATTRS,
	CHECKBOX_ACTIVE_ATTRS,
	CHECKBOX_CHECKMARK_ATTRS,
	CHECKBOX_SUPPRESSED_ATTRS,
	CHECKBOX_SUPPRESSED_DASH_ATTRS,
	RECT_PATTERN_PILL_ATTRS,
	RECT_PATTERN_PILL_TEXT_ATTRS,
	FILLET_HIGHLIGHT_ATTRS,
	FILLET_HOVER_POINT_ATTRS,
	FILLET_WEDGE_ATTRS,
	FILLET_ARC_ATTRS,
	FILLET_GIZMO_CENTER_ATTRS,
	FILLET_GIZMO_RADIAL_ATTRS,
	FILLET_GIZMO_SQUARE_ATTRS,
	FILLET_GIZMO_ARROW_ATTRS,
	SNAP_POINT_ATTRS,
	SNAP_GRID_ATTRS,
	SNAP_OBJECT_ATTRS,
	TOOLTIP_RECT_ATTRS,
	TOOLTIP_TEXT_ATTRS,
	SPLINE_HANDLE_SELECTED_ATTRS,
	SPLINE_CONTROL_POLYGON_ATTRS,
	SPLINE_PREVIEW_GUIDE_ATTRS,
	SPLINE_PREVIEW_VERTEX_ATTRS,
	SPLINE_CHECKMARK_CIRCLE_ATTRS,
	SPLINE_CHECKMARK_PATH_ATTRS,
	POLYGON_VERTEX_ATTRS,
	POLYGON_CENTER_ATTRS,
	POLYGON_RADIUS_HANDLE_ATTRS,
	getSplineHandleStrokeAttrs,
	getSplinePreviewStrokeAttrs,
	SPLINE_STYLES,
	getCopyStrokeAttrs,
	getPrimitiveStrokeAttrs,
	getPreviewStrokeAttrs,
} from './styles';

const TWO_PI = 2 * Math.PI;


export interface RenderOptions {
	showGrid?: boolean;
	showConstraints?: boolean;
	showDimensions?: boolean;
	showSplineHandles?: boolean;
	mirrorHighlight?: {
		selectedObjectIds: Set<string>;
		mirrorLineId: string | null;
	};
	patternHighlight?: {
		selectedObjectIds: Set<string>;
		centerPointId: string | null;
		distribution: 'full' | 'partial' | 'symmetric';
		angle: number;
		quantity: number;
		suppression: boolean;
		suppressedIndices: Set<number>;
	};
	rectangularPatternHighlight?: {
		selectedObjectIds: Set<string>;
		line1Id: string | null;
		line2Id: string | null;
		quantity1: number;
		distance1: number;
		direction1: 'one_direction' | 'symmetric';
		quantity2: number;
		distance2: number;
		direction2: 'one_direction' | 'symmetric';
		suppression: boolean;
		suppressedIndices: Set<number>;
	};
	filletState?: {
		pendingFillets: Array<{
			id: string;
			result?: {
				center: Vec2;
				radius: number;
				t1: Vec2;
				t2: Vec2;
				clockwise: boolean;
				cornerVertex: Vec2;
				midArc: Vec2;
				bisectorDir: Vec2;
			} | null;
		}>;
		activeFilletId?: string | null;
		selectedPrimitive1?: { type: 'line' | 'arc' | 'spline'; id: string } | null;
		hoverPointId?: string | null;
	};
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
	private mirrorGroup: SVGGElement;
	private patternGroup: SVGGElement;
	private patternCheckboxGroup: SVGGElement;
	readonly patternCheckboxPositions = new Map<string, { x: number; y: number; copyIndex: number; constraintId?: string }>();
	readonly rectangularGizmoHandles = new Map<string, { x: number; y: number; axis: 1 | 2; constraintId?: string }>();
	filletGizmoHandle: {
		screenX: number;
		screenY: number;
		worldMidArc: Vec2;
		worldCenter: Vec2;
		worldBisectorDir: Vec2;
		radius: number;
	} | null = null;
	private previewGroup: SVGGElement;
	private overlayGroup: SVGGElement;
	private filletGroup: SVGGElement;

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

		this.mirrorGroup = this.createGroup('mirror-preview-layer');
		this.mirrorGroup.style.pointerEvents = 'none';

		this.patternGroup = this.createGroup('pattern-preview-layer');
		this.patternGroup.style.pointerEvents = 'none';

		this.patternCheckboxGroup = this.createGroup('pattern-checkbox-layer');

		this.filletGroup = this.createGroup('fillet-layer');

		this.previewGroup = this.createGroup('preview-layer');
		this.previewGroup.style.pointerEvents = 'none';

		this.overlayGroup = this.createGroup('overlay-layer');
		this.overlayGroup.style.pointerEvents = 'none';

		this.svg.appendChild(this.gridGroup);
		this.svg.appendChild(this.geometryGroup);
		this.svg.appendChild(this.constraintGroup);
		this.svg.appendChild(this.pointGroup);
		this.svg.appendChild(this.mirrorGroup);
		this.svg.appendChild(this.patternGroup);
		this.svg.appendChild(this.patternCheckboxGroup);
		this.svg.appendChild(this.filletGroup);
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
		this.patternCheckboxPositions.clear();
		this.rectangularGizmoHandles.clear();
		this.patternCheckboxGroup.innerHTML = '';
		this.renderGrid(viewport, options.showGrid ?? true);
		this.renderGeometry(sketch, viewport, options);
		if (options.showConstraints !== false) {
			this.renderConstraints(sketch, viewport);
		}
		this.mirrorGroup.innerHTML = '';
		if (options.mirrorHighlight) {
			this.renderMirrorPreview(
				sketch,
				viewport,
				options.mirrorHighlight.selectedObjectIds,
				options.mirrorHighlight.mirrorLineId
			);
		}
		this.patternGroup.innerHTML = '';
		if (options.patternHighlight) {
			this.renderPatternPreview(
				sketch,
				viewport,
				options.patternHighlight.selectedObjectIds,
				options.patternHighlight.centerPointId,
				options.patternHighlight.distribution,
				options.patternHighlight.angle,
				options.patternHighlight.quantity,
				options.patternHighlight.suppression,
				options.patternHighlight.suppressedIndices
			);
		}
		if (options.rectangularPatternHighlight) {
			this.renderRectangularPatternPreview(
				sketch,
				viewport,
				options.rectangularPatternHighlight
			);
		}
		this.filletGizmoHandle = null;
		this.filletGroup.innerHTML = '';
		if (options.filletState) {
			this.renderFilletPreviews(sketch, viewport, options.filletState);
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

	private renderGeometry(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
		this.geometryGroup.innerHTML = '';
		this.pointGroup.innerHTML = '';

		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';

		// Light Theme: Unconstrained is bold slate, fully constrained is green, conflict is red
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		// Determine which splines have any part active (spline curve, fit points, or tangent handles/endpoints)
		const activeSplineIds = new Set<string>(sketch.selection.splineIds);
		for (const spline of sketch.splines.values()) {
			if (spline.pointIds.some(pid => sketch.selection.pointIds.has(pid))) {
				activeSplineIds.add(spline.id);
			}
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					if (sketch.selection.lineIds.has(lid)) {
						activeSplineIds.add(spline.id);
						break;
					}
					const l = sketch.lines.get(lid);
					if (l && (sketch.selection.pointIds.has(l.p1Id) || sketch.selection.pointIds.has(l.p2Id))) {
						activeSplineIds.add(spline.id);
						break;
					}
				}
			}
		}

		// 1. Render Lines
		for (const line of sketch.lines.values()) {
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;

			if (line.isSplineHandle) {
				const isParentActive = line.parentSplineId ? activeSplineIds.has(line.parentSplineId) : false;
				if (!isParentActive && !options.showSplineHandles) continue;
			}

			const s1 = viewport.worldToScreen(p1.x, p1.y);
			const s2 = viewport.worldToScreen(p2.x, p2.y);
			const isMirrorLine = options.mirrorHighlight?.mirrorLineId === line.id;
			const isDir1Line = options.rectangularPatternHighlight?.line1Id === line.id;
			const isDir2Line = options.rectangularPatternHighlight?.line2Id === line.id;
			const isMirrorSelected = options.mirrorHighlight?.selectedObjectIds.has(line.id);
			const isPatternSelected =
				options.patternHighlight?.selectedObjectIds.has(line.id) ||
				options.rectangularPatternHighlight?.selectedObjectIds.has(line.id);
			const isSelected = sketch.selection.lineIds.has(line.id) || !!isMirrorSelected || !!isPatternSelected;

			const lineG = createSvgElement('g', {
				'data-id': line.id,
				'data-type': 'line',
				class: `sketch-entity sketch-line ${isSelected ? 'is-selected' : ''} ${line.isSplineHandle ? 'sketch-spline-handle' : ''} ${isMirrorLine ? 'is-mirror-line' : ''} ${isDir1Line || isDir2Line ? 'is-direction-line' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px wide)
			createSvgLine(s1.x, s1.y, s2.x, s2.y, HIT_AREA_STROKE_ATTRS, lineG);

			// Visible line
			if (line.isSplineHandle) {
				const parentSpline = line.parentSplineId ? sketch.splines.get(line.parentSplineId) : undefined;
				if (parentSpline?.splineType === 'control') {
					createSvgLine(s1.x, s1.y, s2.x, s2.y, isSelected ? SPLINE_HANDLE_SELECTED_ATTRS : SPLINE_CONTROL_POLYGON_ATTRS, lineG);
				} else {
					createSvgLine(s1.x, s1.y, s2.x, s2.y, getSplineHandleStrokeAttrs(isSelected), lineG);
				}
			} else if (isMirrorLine) {
				createSvgLine(s1.x, s1.y, s2.x, s2.y, MIRROR_LINE_ATTRS, lineG);
			} else if (isDir1Line) {
				createSvgLine(s1.x, s1.y, s2.x, s2.y, DIR1_LINE_ATTRS, lineG);
			} else if (isDir2Line) {
				createSvgLine(s1.x, s1.y, s2.x, s2.y, DIR2_LINE_ATTRS, lineG);
			} else {
				createSvgLine(s1.x, s1.y, s2.x, s2.y, getPrimitiveStrokeAttrs(isSelected, !!line.isConstruction, baseColor, true), lineG);
			}
		}

		// 2. Render Circles
		for (const circle of sketch.circles.values()) {
			const center = sketch.points.get(circle.centerId);
			if (!center) continue;

			const sc = viewport.worldToScreen(center.x, center.y);
			const sr = circle.radius * viewport.zoom;
			const isSelected =
				sketch.selection.circleIds.has(circle.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(circle.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(circle.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(circle.id);

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
			const isSelected =
				sketch.selection.arcIds.has(arc.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(arc.id);

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
			const isSelected =
				sketch.selection.ellipseIds.has(ellipse.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(ellipse.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(ellipse.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(ellipse.id);

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
			const isSelected =
				sketch.selection.ellipticalArcIds.has(arc.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(arc.id);

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

		// 5b. Render Splines
		for (const spline of sketch.splines.values()) {
			const pts = spline.pointIds.map(id => sketch.points.get(id)).filter((p): p is SketchPoint => !!p);
			if (pts.length < 2) continue;

			let bezierSegments: BezierSegment[] = [];
			if (spline.splineType === 'control') {
				bezierSegments = bsplineToBezier(pts, spline.knots);
			} else {
				const handles = (spline.tangentLineIds || []).map(lid => {
					const line = sketch.lines.get(lid);
					if (!line) return null;
					const p1 = sketch.points.get(line.p1Id);
					const p2 = sketch.points.get(line.p2Id);
					if (!p1 || !p2) return null;
					return {
						h1: { x: p1.x, y: p1.y },
						h2: { x: p2.x, y: p2.y },
					};
				});
				bezierSegments = fitPointsToBezier(pts, handles);
			}

			const isSelected =
				sketch.selection.splineIds.has(spline.id) ||
				spline.pointIds.some(pid => sketch.selection.pointIds.has(pid)) ||
				(spline.tangentLineIds && spline.tangentLineIds.some(lid => {
					const line = sketch.lines.get(lid);
					return line && (sketch.selection.lineIds.has(lid) || sketch.selection.pointIds.has(line.p1Id) || sketch.selection.pointIds.has(line.p2Id));
				}));

			const d = getSplineSvgPath(bezierSegments, p => viewport.worldToScreen(p.x, p.y), !!spline.isClosed);

			const splineG = createSvgElement('g', {
				'data-id': spline.id,
				'data-type': 'spline',
				class: `sketch-entity sketch-spline ${isSelected ? 'is-selected' : ''}`,
			}, this.geometryGroup);

			// Invisible generous hit target (18px stroke)
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, splineG);

			// Visible spline path
			createSvgPath(d, {
				fill: spline.isClosed ? SPLINE_STYLES.closedFill : 'none',
				...getPrimitiveStrokeAttrs(isSelected, !!spline.isConstruction, baseColor, true),
			}, splineG);

		}

		// 6. Render Points (Vertices)
		const handlePointToSpline = new Map<string, { spline: SketchSpline; isHandleDot: boolean }>();
		const controlPointToSpline = new Map<string, SketchSpline>();
		for (const spline of sketch.splines.values()) {
			if (spline.splineType === 'control') {
				for (let i = 1; i < spline.pointIds.length - 1; i++) {
					controlPointToSpline.set(spline.pointIds[i], spline);
				}
			}
			if (spline.tangentLineIds && spline.splineType !== 'control') {
				for (const lid of spline.tangentLineIds) {
					const line = sketch.lines.get(lid);
					if (line) {
						handlePointToSpline.set(line.p1Id, { spline, isHandleDot: true });
						handlePointToSpline.set(line.p2Id, { spline, isHandleDot: true });
					}
				}
			}
		}

		for (const pt of sketch.points.values()) {
			const splineHandleInfo = handlePointToSpline.get(pt.id);
			const splineControl = controlPointToSpline.get(pt.id);

			if (splineHandleInfo) {
				if (!activeSplineIds.has(splineHandleInfo.spline.id) && !sketch.selection.pointIds.has(pt.id) && !options.showSplineHandles) {
					continue;
				}
			}
			if (splineControl) {
				if (!activeSplineIds.has(splineControl.id) && !sketch.selection.pointIds.has(pt.id) && !options.showSplineHandles) {
					continue;
				}
			}

			const s = viewport.worldToScreen(pt.x, pt.y);
			const isPatternCenter = options.patternHighlight?.centerPointId === pt.id;
			const isPatternSelected =
				options.patternHighlight?.selectedObjectIds.has(pt.id) ||
				options.rectangularPatternHighlight?.selectedObjectIds.has(pt.id);
			const isSelected =
				sketch.selection.pointIds.has(pt.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(pt.id) ||
				!!isPatternSelected ||
				isPatternCenter;

			const ptG = createSvgElement('g', {
				'data-id': pt.id,
				'data-type': 'point',
				class: `sketch-entity sketch-point ${isSelected ? 'is-selected' : ''} ${isPatternCenter ? 'is-pattern-center' : ''}`,
			}, this.pointGroup);

			// Invisible larger hit target for easy clicking
			createSvgCircle(s.x, s.y, 14, HIT_AREA_POINT_ATTRS, ptG);

			// Visible point handle
			let fillColor: string = COLORS.primary; // Default interactive CAD vertex color
			let strokeColor: string = 'none';

			if (splineHandleInfo?.isHandleDot) {
				fillColor = SPLINE_STYLES.handleDot.fill;
				strokeColor = SPLINE_STYLES.handleDot.stroke;
			} else if (pt.fixed) {
				fillColor = COLORS.fixed; // Fixed points highlighted amber
			} else if (isFullyConstrained) {
				fillColor = COLORS.constrained; // Fully defined
			}

			if (isSelected) {
				fillColor = COLORS.selected;
				strokeColor = COLORS.tooltipBg;
			}
			if (isPatternCenter) {
				fillColor = COLORS.patternCenter;
				strokeColor = COLORS.white;
			}

			createSvgCircle(s.x, s.y, isSelected ? 4 : (splineHandleInfo?.isHandleDot ? SPLINE_STYLES.handleDot.r : 3), {
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

		const ctx: ConstraintRenderContext = {
			sketch,
			viewport,
			targetGroup: this.constraintGroup,
			isSelected: false,
			lineBadgeCounts,
			renderBadge: (id, x, y, label, color) => {
				this.renderConstraintBadge(id, x, y, label, ctx.isSelected, color);
			},
			renderBadgeOnSegment: (id, p1Id, p2Id, label) => {
				this.renderBadgeOnSegment(id, p1Id, p2Id, sketch, viewport, label, ctx.isSelected, lineBadgeCounts);
			},
			renderBadgeOnCircle: (id, circleId, label) => {
				this.renderBadgeOnCircle(id, circleId, sketch, viewport, label, ctx.isSelected);
			},
			renderLinearDimensionVisual: (opts) => {
				this.renderLinearDimensionVisual(opts);
			},
			renderDashedExtensionLines: (g, sCenter, angle, rScreen, sp1, sp2, color) => {
				this.renderDashedExtensionLines(g, sCenter, angle, rScreen, sp1, sp2, color);
			},
			patternCheckboxGroup: this.patternCheckboxGroup,
			patternCheckboxPositions: this.patternCheckboxPositions,
			rectangularGizmoHandles: this.rectangularGizmoHandles,
			isConstraintOnlySelected: (constraintId) => this.isConstraintOnlySelected(constraintId, sketch),
			renderTransformedObjects: (objectIds, transform, options) => {
				return this.renderTransformedObjects(sketch, viewport, objectIds, transform, options);
			},
			renderPatternSuppressionCheckbox: (centroid, k, isSuppressed, constraintId) => {
				this.renderPatternSuppressionCheckbox(centroid, k, isSuppressed, constraintId);
			},
			renderRectangularPatternGizmos: (v, centroidWorld, u1, u2, distance1, distance2, options) => {
				this.renderRectangularPatternGizmos(v, centroidWorld, u1, u2, distance1, distance2, options);
			},
			isAngleNearArc: (arc, center, px, py, rScreen) => {
				return this.isAngleNearArc(arc, center, px, py, sketch, viewport, rScreen);
			},
		};

		for (const constraint of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(constraint)) continue;
			ctx.isSelected = sketch.selection.constraintIds.has(constraint.id);
			constraint.render?.(ctx);
		}
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
				fill: COLORS.guideFaint,
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


	private isAngleNearArc(
		arc: { startPointId: string; endPointId: string; clockwise?: boolean },
		center: { x: number; y: number },
		px: number,
		py: number,
		sketch: SketchDocument,
		viewport: Viewport,
		rScreen: number
	): boolean {
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (!start || !end) return true;

		const sCenter = viewport.worldToScreen(center.x, center.y);
		const ss = viewport.worldToScreen(start.x, start.y);
		const se = viewport.worldToScreen(end.x, end.y);
		const as = Math.atan2(ss.y - sCenter.y, ss.x - sCenter.x);
		const ae = Math.atan2(se.y - sCenter.y, se.x - sCenter.x);
		const aPt = Math.atan2(py - sCenter.y, px - sCenter.x);
		const clockwise = !!arc.clockwise;

		let totalSweep = 0;
		let ptSweep = 0;
		if (clockwise) {
			totalSweep = (ae - as) % TWO_PI;
			if (totalSweep < 0) totalSweep += TWO_PI;
			ptSweep = (aPt - as) % TWO_PI;
			if (ptSweep < 0) ptSweep += TWO_PI;
		} else {
			totalSweep = (as - ae) % TWO_PI;
			if (totalSweep < 0) totalSweep += TWO_PI;
			ptSweep = (as - aPt) % TWO_PI;
			if (ptSweep < 0) ptSweep += TWO_PI;
		}

		if (ptSweep > totalSweep) {
			const excessAngle = Math.min(ptSweep - totalSweep, TWO_PI - ptSweep);
			if (excessAngle * rScreen > 60) {
				return false;
			}
		}
		return true;
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


	private isConstraintOnlySelected(constraintId: string, sketch: SketchDocument): boolean {
		const sel = sketch.selection;
		return (
			sel.constraintIds.has(constraintId) &&
			sel.pointIds.size === 0 &&
			sel.lineIds.size === 0 &&
			sel.circleIds.size === 0 &&
			sel.arcIds.size === 0 &&
			sel.ellipseIds.size === 0 &&
			sel.ellipticalArcIds.size === 0
		);
	}


	private renderRectangularPatternGizmos(
		viewport: Viewport,
		centroidWorld: { x: number; y: number },
		u1: { x: number; y: number },
		u2: { x: number; y: number },
		distance1: number,
		distance2: number,
		options: {
			targetGroup: SVGGElement;
			constraintId?: string;
		}
	): void {
		const sCtr = viewport.worldToScreen(centroidWorld.x, centroidWorld.y);

		const p1Screen = viewport.worldToScreen(centroidWorld.x + u1.x, centroidWorld.y + u1.y);
		const v1x = p1Screen.x - sCtr.x;
		const v1y = p1Screen.y - sCtr.y;
		const v1Len = Math.max(Math.hypot(v1x, v1y), 1e-6);
		const u1Screen = { x: v1x / v1Len, y: v1y / v1Len };

		const p2Screen = viewport.worldToScreen(centroidWorld.x + u2.x, centroidWorld.y + u2.y);
		const v2x = p2Screen.x - sCtr.x;
		const v2y = p2Screen.y - sCtr.y;
		const v2Len = Math.max(Math.hypot(v2x, v2y), 1e-6);
		const u2Screen = { x: v2x / v2Len, y: v2y / v2Len };

		const h1World = { x: centroidWorld.x + distance1 * u1.x, y: centroidWorld.y + distance1 * u1.y };
		const h1Screen = viewport.worldToScreen(h1World.x, h1World.y);

		const h2World = { x: centroidWorld.x + distance2 * u2.x, y: centroidWorld.y + distance2 * u2.y };
		const h2Screen = viewport.worldToScreen(h2World.x, h2World.y);

		const gizmoG = createSvgElement('g', {
			class: 'rectangular-pattern-gizmos',
		}, options.targetGroup);

		const renderArrow = (
			from: { x: number; y: number },
			to: { x: number; y: number },
			dirScreen: { x: number; y: number },
			color: string,
			axisNum: 1 | 2,
			distVal: number
		) => {
			const isNegative = distVal < -1e-3;
			const aux = isNegative ? -dirScreen.x : dirScreen.x;
			const auy = isNegative ? -dirScreen.y : dirScreen.y;
			const apx = -auy;
			const apy = aux;

			const arrowLen = 18;
			const arrowHalfWidth = 7.5;
			const offsetDist = 48; // Offset equals initial line length at distance=0 (48px)

			const tipX = to.x + offsetDist * aux;
			const tipY = to.y + offsetDist * auy;
			const baseCenterX = tipX - arrowLen * aux;
			const baseCenterY = tipY - arrowLen * auy;

			const base1X = baseCenterX + arrowHalfWidth * apx;
			const base1Y = baseCenterY + arrowHalfWidth * apy;
			const base2X = baseCenterX - arrowHalfWidth * apx;
			const base2Y = baseCenterY - arrowHalfWidth * apy;

			// Register handle centered on the arrowhead for dragging
			const key = options.constraintId ? `gizmo-${axisNum}-${options.constraintId}` : `gizmo-${axisNum}`;
			this.rectangularGizmoHandles.set(key, {
				x: tipX - (arrowLen * 0.5) * aux,
				y: tipY - (arrowLen * 0.5) * auy,
				axis: axisNum,
				constraintId: options.constraintId,
			});

			// Shaft line connecting origin to base of arrowhead (always solid, no dashed lines)
			createSvgLine(from.x, from.y, baseCenterX, baseCenterY, {
				stroke: color,
				'stroke-width': 2.5,
				'stroke-dasharray': 'none',
				opacity: 0.9,
				'pointer-events': 'none',
			}, gizmoG);

			// Arrowhead as the draggable gizmo handle (replaces circle)
			const arrowPath = `M ${tipX} ${tipY} L ${base1X} ${base1Y} L ${base2X} ${base2Y} Z`;
			createSvgPath(arrowPath, {
				fill: color,
				stroke: COLORS.white,
				'stroke-width': 1.5,
				'stroke-linejoin': 'round',
				class: 'rectangular-pattern-gizmo-arrow',
				filter: FILTERS.gizmoArrow,
				'data-axis': String(axisNum),
			}, gizmoG);

			// Distance label pill: without "d1:", "d2:", only the value
			const labelText = `${distVal.toFixed(1)} mm`;
			const pillWidth = labelText.length * 6.8 + 14;
			const isHorizontal = Math.abs(aux) >= Math.abs(auy);

			let pillX: number;
			let pillY: number;

			if (isHorizontal) {
				// Horizontal arrow -> place label below the arrow
				const midX = tipX - (arrowLen * 0.5) * aux;
				const maxY = Math.max(from.y, tipY, base1Y, base2Y);
				pillX = midX;
				pillY = maxY + 16;
			} else {
				// Vertical arrow -> place label to the right of the arrow
				const midY = tipY - (arrowLen * 0.5) * auy;
				const maxX = Math.max(from.x, tipX, base1X, base2X);
				pillX = maxX + 10 + pillWidth * 0.5;
				pillY = midY;
			}

			createSvgRect(pillX - pillWidth * 0.5, pillY - 10, pillWidth, 20, {
				...RECT_PATTERN_PILL_ATTRS,
				stroke: color,
			}, gizmoG);

			createSvgText(pillX, pillY + 3.5, labelText, RECT_PATTERN_PILL_TEXT_ATTRS, gizmoG);
		};

		renderArrow(sCtr, h1Screen, u1Screen, COLORS.patternAxis1, 1, distance1);
		renderArrow(sCtr, h2Screen, u2Screen, COLORS.patternAxis2, 2, distance2);
	}

	private renderPatternSuppressionCheckbox(
		centroid: { x: number; y: number },
		k: number,
		isSuppressed: boolean,
		constraintId?: string
	): void {
		const cbG = createSvgElement('g', {
			class: 'pattern-suppression-checkbox',
			style: 'cursor: pointer;',
			'data-copy-k': String(k),
			...(constraintId ? { 'data-constraint-id': constraintId } : {}),
		}, this.patternCheckboxGroup);

		// Outer halo / shadow
		createSvgRect(centroid.x - 11, centroid.y - 11, 22, 22, CHECKBOX_HALO_ATTRS, cbG);

		if (!isSuppressed) {
			// Active checkbox (blue filled with white checkmark)
			createSvgRect(centroid.x - 9, centroid.y - 9, 18, 18, CHECKBOX_ACTIVE_ATTRS, cbG);

			createSvgPath(
				`M ${centroid.x - 4.5} ${centroid.y} L ${centroid.x - 1.5} ${centroid.y + 3.5} L ${centroid.x + 5} ${centroid.y - 3.5}`,
				CHECKBOX_CHECKMARK_ATTRS,
				cbG
			);
		} else {
			// Suppressed checkbox (grey outline with red dash)
			createSvgRect(centroid.x - 9, centroid.y - 9, 18, 18, CHECKBOX_SUPPRESSED_ATTRS, cbG);

			createSvgLine(centroid.x - 4, centroid.y, centroid.x + 4, centroid.y, CHECKBOX_SUPPRESSED_DASH_ATTRS, cbG);
		}
	}

	private renderTransformedObjects(
		sketch: SketchDocument,
		viewport: Viewport,
		objectIds: Iterable<string>,
		transform:
			| { center: { x: number; y: number }; angleDeg: number }
			| { dx: number; dy: number }
			| ((x: number, y: number) => { x: number; y: number }),
		options: {
			targetGroup?: SVGGElement;
			baseColor?: string;
			opacity?: number;
			isSuppressed?: boolean;
			drawVertices?: boolean;
			strokeWidth?: number;
			skipRender?: boolean;
		}
	): Array<{ x: number; y: number }> {
		let transformPoint: (x: number, y: number) => { x: number; y: number };
		if (typeof transform === 'function') {
			transformPoint = transform;
		} else if ('angleDeg' in transform) {
			const rad = (transform.angleDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);
			const cx = transform.center.x;
			const cy = transform.center.y;
			transformPoint = (x: number, y: number) => {
				const dx = x - cx;
				const dy = y - cy;
				return {
					x: cx + dx * cosA - dy * sinA,
					y: cy + dx * sinA + dy * cosA,
				};
			};
		} else {
			const dx = transform.dx;
			const dy = transform.dy;
			transformPoint = (x: number, y: number) => ({ x: x + dx, y: y + dy });
		}

		const copyWorldPoints: Array<{ x: number; y: number }> = [];
		const targetGroup = options.targetGroup;
		const skipRender = options.skipRender || !targetGroup;
		const opacity = options.opacity ?? 1.0;
		const baseColor = options.baseColor ?? COLORS.unconstrained;
		const strokeWidth = options.strokeWidth ?? STROKE_WIDTH.normal;

		const drawTransformedVertex = (screenPt: { x: number; y: number }) => {
			if (!options.drawVertices || skipRender || !targetGroup) return;
			createSvgCircle(screenPt.x, screenPt.y, 3, {
				fill: baseColor === COLORS.constrained ? COLORS.constrained : COLORS.primary,
				stroke: COLORS.white,
				'stroke-width': STROKE_WIDTH.normal,
				opacity,
				'pointer-events': 'none',
			}, targetGroup);
		};

		const getAttrs = (isConstruction: boolean) =>
			getCopyStrokeAttrs(isConstruction, baseColor, opacity, strokeWidth);

		for (const objId of objectIds) {
			// Line
			const l = sketch.lines.get(objId);
			if (l) {
				const pt1 = sketch.points.get(l.p1Id);
				const pt2 = sketch.points.get(l.p2Id);
				if (pt1 && pt2) {
					const rp1 = transformPoint(pt1.x, pt1.y);
					const rp2 = transformPoint(pt2.x, pt2.y);
					copyWorldPoints.push(rp1, rp2);

					if (!skipRender && targetGroup) {
						const sp1 = viewport.worldToScreen(rp1.x, rp1.y);
						const sp2 = viewport.worldToScreen(rp2.x, rp2.y);
						createSvgLine(sp1.x, sp1.y, sp2.x, sp2.y, getAttrs(!!l.isConstruction), targetGroup);

						drawTransformedVertex(sp1);
						drawTransformedVertex(sp2);
					}
				}
				continue;
			}

			// Circle
			const c = sketch.circles.get(objId);
			if (c) {
				const origCtr = sketch.points.get(c.centerId);
				if (origCtr) {
					const rc = transformPoint(origCtr.x, origCtr.y);
					copyWorldPoints.push(rc);

					if (!skipRender && targetGroup) {
						const sc = viewport.worldToScreen(rc.x, rc.y);
						const sr = c.radius * viewport.zoom;
						createSvgCircle(sc.x, sc.y, sr, getAttrs(!!c.isConstruction), targetGroup);

						drawTransformedVertex(sc);
					}
				}
				continue;
			}

			// Arc
			const a = sketch.arcs.get(objId);
			if (a) {
				const origCtr = sketch.points.get(a.centerId);
				const origStart = sketch.points.get(a.startPointId);
				const origEnd = sketch.points.get(a.endPointId);
				if (origCtr && origStart && origEnd) {
					const rc = transformPoint(origCtr.x, origCtr.y);
					const rs = transformPoint(origStart.x, origStart.y);
					const re = transformPoint(origEnd.x, origEnd.y);
					copyWorldPoints.push(rc, rs, re);

					if (!skipRender && targetGroup) {
						const sc = viewport.worldToScreen(rc.x, rc.y);
						const ss = viewport.worldToScreen(rs.x, rs.y);
						const se = viewport.worldToScreen(re.x, re.y);
						const sr = a.radius * viewport.zoom;

						const d = getArcSvgPath(sc, ss, se, sr, a.clockwise);
						createSvgPath(d, getAttrs(!!a.isConstruction), targetGroup);

						drawTransformedVertex(sc);
						drawTransformedVertex(ss);
						drawTransformedVertex(se);
					}
				}
				continue;
			}

			// Ellipse
			const e = sketch.ellipses.get(objId);
			if (e) {
				const origCtr = sketch.points.get(e.centerId);
				const origMajor = sketch.points.get(e.majorAxisPointId);
				const origMinor = sketch.points.get(e.minorAxisPointId);
				if (origCtr && origMajor && origMinor) {
					const rc = transformPoint(origCtr.x, origCtr.y);
					const rmaj = transformPoint(origMajor.x, origMajor.y);
					const rmin = transformPoint(origMinor.x, origMinor.y);
					copyWorldPoints.push(rc, rmaj, rmin);

					if (!skipRender && targetGroup) {
						const src = viewport.worldToScreen(rc.x, rc.y);
						const srmaj = viewport.worldToScreen(rmaj.x, rmaj.y);
						const srmin = viewport.worldToScreen(rmin.x, rmin.y);
						const rx = Math.hypot(srmaj.x - src.x, srmaj.y - src.y);
						const ry = Math.hypot(srmin.x - src.x, srmin.y - src.y);
						const thetaDeg = (Math.atan2(srmaj.y - src.y, srmaj.x - src.x) * 180) / Math.PI;

						createSvgEllipse(src.x, src.y, rx, ry, {
							transform: `rotate(${thetaDeg.toFixed(2)} ${src.x.toFixed(1)} ${src.y.toFixed(1)})`,
							...getAttrs(!!e.isConstruction),
						}, targetGroup);

						drawTransformedVertex(src);
						drawTransformedVertex(srmaj);
						drawTransformedVertex(srmin);
					}
				}
				continue;
			}

			// Elliptical Arc
			const elArc = sketch.ellipticalArcs.get(objId);
			if (elArc) {
				const origCtr = sketch.points.get(elArc.centerId);
				const origMajor = sketch.points.get(elArc.majorAxisPointId);
				const origMinor = sketch.points.get(elArc.minorAxisPointId);
				const origStart = sketch.points.get(elArc.startPointId);
				const origEnd = sketch.points.get(elArc.endPointId);
				if (origCtr && origMajor && origMinor && origStart && origEnd) {
					const rc = transformPoint(origCtr.x, origCtr.y);
					const rmaj = transformPoint(origMajor.x, origMajor.y);
					const rmin = transformPoint(origMinor.x, origMinor.y);
					const rs = transformPoint(origStart.x, origStart.y);
					const re = transformPoint(origEnd.x, origEnd.y);
					copyWorldPoints.push(rc, rmaj, rmin, rs, re);

					if (!skipRender && targetGroup) {
						const src = viewport.worldToScreen(rc.x, rc.y);
						const srmaj = viewport.worldToScreen(rmaj.x, rmaj.y);
						const srmin = viewport.worldToScreen(rmin.x, rmin.y);
						const srs = viewport.worldToScreen(rs.x, rs.y);
						const sre = viewport.worldToScreen(re.x, re.y);
						const d = getEllipticalArcSvgPath(src, srmaj, srmin, srs, sre, elArc.clockwise);

						createSvgPath(d, getAttrs(!!elArc.isConstruction), targetGroup);

						drawTransformedVertex(srs);
						drawTransformedVertex(sre);
						drawTransformedVertex(src);
					}
				}
				continue;
			}

			// Standalone Point
			const pt = sketch.points.get(objId);
			if (pt) {
				const rp = transformPoint(pt.x, pt.y);
				copyWorldPoints.push(rp);

				if (!skipRender && targetGroup) {
					const srp = viewport.worldToScreen(rp.x, rp.y);
					drawTransformedVertex(srp);
				}
			}
		}

		return copyWorldPoints;
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
	renderSplinePreview(
		splineType: 'fit' | 'control',
		points: Vec2[],
		cursorPos: Vec2,
		isConstruction = false
	): { checkmarkPos?: Vec2 } {
		this.previewGroup.innerHTML = '';
		if (points.length === 0) return {};

		const allPts = [...points, cursorPos];
		let segments: BezierSegment[] = [];
		if (splineType === 'control') {
			segments = bsplineToBezier(allPts);
			for (let i = 0; i < allPts.length - 1; i++) {
				createSvgLine(allPts[i].x, allPts[i].y, allPts[i + 1].x, allPts[i + 1].y, SPLINE_STYLES.controlPolygon, this.previewGroup);
			}
		} else {
			segments = fitPointsToBezier(allPts);
		}

		const d = getSplineSvgPath(segments);
		createSvgPath(d, getSplinePreviewStrokeAttrs(isConstruction), this.previewGroup);

		const lastPt = points[points.length - 1];
		createSvgLine(lastPt.x, lastPt.y, cursorPos.x, cursorPos.y, SPLINE_PREVIEW_GUIDE_ATTRS, this.previewGroup);

		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			createSvgCircle(p.x, p.y, 3, SPLINE_PREVIEW_VERTEX_ATTRS, this.previewGroup);
		}

		const checkmarkPos = { x: lastPt.x + 20, y: lastPt.y - 12 };
		const checkG = createSvgElement('g', {
			class: 'spline-finish-checkmark',
			style: 'cursor: pointer;',
		}, this.previewGroup);

		createSvgCircle(checkmarkPos.x, checkmarkPos.y, 11, SPLINE_CHECKMARK_CIRCLE_ATTRS, checkG);
		const checkD = `M ${checkmarkPos.x - 4} ${checkmarkPos.y} L ${checkmarkPos.x - 1} ${checkmarkPos.y + 3.5} L ${checkmarkPos.x + 4.5} ${checkmarkPos.y - 3.5}`;
		createSvgPath(checkD, SPLINE_CHECKMARK_PATH_ATTRS, checkG);

		return { checkmarkPos };
	}

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

	renderPolygonPreview(
		sCtr: Vec2,
		_sCurrent: Vec2,
		centerWorld: Vec2,
		_currentWorld: Vec2,
		sides: number,
		inradius: number,
		angleRad: number,
		isConstruction = false,
		viewport: Viewport
	): void {
		this.previewGroup.innerHTML = '';

		const N = Math.max(3, Math.round(sides));
		const R = inradius / Math.cos(Math.PI / N);
		const sInradius = inradius * viewport.zoom;

		// 1. Inscribed guide circle (dashed faint outline)
		createSvgCircle(sCtr.x, sCtr.y, sInradius, GUIDE_OUTLINE_ATTRS, this.previewGroup);

		// 2. Auxiliary ray from center to current point (tangency point on incircle / midpoint of first edge)
		const midWorld: Vec2 = {
			x: centerWorld.x + inradius * Math.cos(angleRad),
			y: centerWorld.y + inradius * Math.sin(angleRad),
		};
		const midScreen = viewport.worldToScreen(midWorld.x, midWorld.y);
		createSvgLine(sCtr.x, sCtr.y, midScreen.x, midScreen.y, AUX_RAY_ATTRS, this.previewGroup);

		// 3. Polygon vertices in world coordinates, transformed to screen
		const baseAngle = angleRad - Math.PI / N;
		const step = (2 * Math.PI) / N;
		const pts: Vec2[] = [];
		for (let i = 0; i < N; i++) {
			const a = baseAngle + i * step;
			const wx = centerWorld.x + R * Math.cos(a);
			const wy = centerWorld.y + R * Math.sin(a);
			pts.push(viewport.worldToScreen(wx, wy));
		}

		// 4. Polygon outline path
		if (pts.length >= 3) {
			let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
			for (let i = 1; i < pts.length; i++) {
				d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
			}
			d += ' Z';
			createSvgPath(d, getPreviewStrokeAttrs(isConstruction), this.previewGroup);
		}

		// 5. Draw vertex dots
		for (const pt of pts) {
			createSvgCircle(pt.x, pt.y, 2.5, POLYGON_VERTEX_ATTRS, this.previewGroup);
		}

		// 6. Center marker
		createSvgCircle(sCtr.x, sCtr.y, 3, POLYGON_CENTER_ATTRS, this.previewGroup);

		// 7. Midpoint marker on incircle
		createSvgCircle(midScreen.x, midScreen.y, 2.5, POLYGON_RADIUS_HANDLE_ATTRS, this.previewGroup);
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

	renderSnapIndicator(s: Vec2, type: 'point' | 'line' | 'circle' | 'spline' | 'grid' = 'point', clearFirst = true): void {
		if (clearFirst) {
			this.overlayGroup.innerHTML = '';
		}

		if (type === 'line' || type === 'circle' || type === 'spline') {
			// Emerald diamond on object - enlarged so it clearly surrounds points
			const d = 10;
			createSvgElement(
				'polygon',
				{
					points: `${s.x.toFixed(1)},${(s.y - d).toFixed(1)} ${(s.x + d).toFixed(1)},${s.y.toFixed(1)} ${s.x.toFixed(1)},${(s.y + d).toFixed(1)} ${(s.x - d).toFixed(1)},${s.y.toFixed(1)}`,
					...SNAP_OBJECT_ATTRS,
				},
				this.overlayGroup
			);
		} else if (type === 'grid') {
			// Indigo square at grid intersection
			const size = 7;
			createSvgRect(s.x - size, s.y - size, size * 2, size * 2, {
				...SNAP_GRID_ATTRS,
				rx: 1,
			}, this.overlayGroup);
		} else {
			// Circular blue ring for point
			createSvgCircle(s.x, s.y, 9, SNAP_POINT_ATTRS, this.overlayGroup);
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

		createSvgRect(minX, minY, width, height, SELECTION_BOX_ATTRS, this.overlayGroup);
	}

	renderTrimPreview(candidate: TrimCandidate, viewport: Viewport): void {
		this.previewGroup.innerHTML = '';
		const { curve, isWholeEntity, cutStartWorld, cutEndWorld } = candidate;

		if (isWholeEntity) {
			if (curve.type === 'segment') {
				const s1 = viewport.worldToScreen(curve.p1.x, curve.p1.y);
				const s2 = viewport.worldToScreen(curve.p2.x, curve.p2.y);
				createSvgLine(s1.x, s1.y, s2.x, s2.y, TRIM_STROKE_ATTRS, this.previewGroup);
			} else if (curve.type === 'circle') {
				const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
				const sr = curve.radius * viewport.zoom;
				createSvgCircle(sc.x, sc.y, sr, TRIM_STROKE_ATTRS, this.previewGroup);
			} else if (curve.type === 'arc') {
				const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
				const ss = viewport.worldToScreen(curve.start.x, curve.start.y);
				const se = viewport.worldToScreen(curve.end.x, curve.end.y);
				const sr = curve.radius * viewport.zoom;
				const d = getArcSvgPath(sc, ss, se, sr, curve.clockwise);
				createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
			} else if (curve.type === 'ellipse') {
				const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
				const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
				const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
				const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
				const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
				const thetaDeg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
				createSvgEllipse(sc.x, sc.y, rx, ry, { transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`, ...TRIM_STROKE_ATTRS }, this.previewGroup);
			} else if (curve.type === 'elliptical_arc') {
				const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
				const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
				const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
				const ss = viewport.worldToScreen(curve.start.x, curve.start.y);
				const se = viewport.worldToScreen(curve.end.x, curve.end.y);
				const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, curve.clockwise);
				createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
			} else if (curve.type === 'spline') {
				const d = getSplineSvgPath(curve.bezierSegments, p => viewport.worldToScreen(p.x, p.y), !!curve.isClosed);
				createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
			}
			return;
		}

		// Partial curve trimmed:
		const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
		const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);

		if (curve.type === 'segment') {
			createSvgLine(sStart.x, sStart.y, sEnd.x, sEnd.y, TRIM_STROKE_ATTRS, this.previewGroup);
		} else if (curve.type === 'circle') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const sr = curve.radius * viewport.zoom;
			const d = getArcSvgPath(sc, sStart, sEnd, sr, true);
			createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
		} else if (curve.type === 'arc') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const sr = curve.radius * viewport.zoom;
			const d = getArcSvgPath(sc, sStart, sEnd, sr, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
		} else if (curve.type === 'ellipse') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
			const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
			const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, true);
			createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
		} else if (curve.type === 'elliptical_arc') {
			const sc = viewport.worldToScreen(curve.center.x, curve.center.y);
			const smaj = viewport.worldToScreen(curve.majorAxisPoint.x, curve.majorAxisPoint.y);
			const smin = viewport.worldToScreen(curve.minorAxisPoint.x, curve.minorAxisPoint.y);
			const d = getEllipticalArcSvgPath(sc, smaj, smin, sStart, sEnd, curve.clockwise);
			createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
		} else if (curve.type === 'spline') {
			const subSegments = extractSplineInterval(curve.bezierSegments, candidate.interval[0], candidate.interval[1]);
			const d = getSplineSvgPath(subSegments, p => viewport.worldToScreen(p.x, p.y));
			createSvgPath(d, TRIM_STROKE_ATTRS, this.previewGroup);
		}
	}

	renderCutMarker(pt: Vec2): void {
		const size = 5;
		createSvgLine(pt.x - size, pt.y - size, pt.x + size, pt.y + size, CUT_MARKER_ATTRS, this.previewGroup);
		createSvgLine(pt.x - size, pt.y + size, pt.x + size, pt.y - size, CUT_MARKER_ATTRS, this.previewGroup);
	}

	renderBreakPreview(candidate: TrimCandidate, viewport: Viewport): void {
		this.previewGroup.innerHTML = '';
		const { curve, isWholeEntity, cutStartWorld, cutEndWorld, interval } = candidate;
		if (isWholeEntity) return;

		if (curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && !!curve.isClosed)) {
			const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
			const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);
			this.renderCutMarker(sStart);
			this.renderCutMarker(sEnd);
		} else {
			if (interval[0] > 1e-4) {
				const sStart = viewport.worldToScreen(cutStartWorld.x, cutStartWorld.y);
				this.renderCutMarker(sStart);
			}
			if (interval[1] < 1 - 1e-4) {
				const sEnd = viewport.worldToScreen(cutEndWorld.x, cutEndWorld.y);
				this.renderCutMarker(sEnd);
			}
		}
	}

	renderMirrorPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		selectedObjectIds: Set<string>,
		mirrorLineId: string | null
	): void {
		this.mirrorGroup.innerHTML = '';
		if (!mirrorLineId) return;

		const line = sketch.lines.get(mirrorLineId);
		if (!line) return;
		const pA = sketch.points.get(line.p1Id);
		const pB = sketch.points.get(line.p2Id);
		if (!pA || !pB) return;

		const sA = viewport.worldToScreen(pA.x, pA.y);
		const sB = viewport.worldToScreen(pB.x, pB.y);

		const dx = pB.x - pA.x;
		const dy = pB.y - pA.y;
		const lineLen = Math.hypot(dx, dy);
		if (lineLen < 1e-6) return;

		const nx = -dy / lineLen;
		const ny = dx / lineLen;

		// Highlight mirror line: bright gold/amber centerline
		createSvgLine(sA.x, sA.y, sB.x, sB.y, MIRROR_PREVIEW_LINE_ATTRS, this.mirrorGroup);

		if (selectedObjectIds.size === 0) return;

		const reflectPoint = (x: number, y: number): { x: number; y: number } => {
			const distToLine = (x - pA.x) * nx + (y - pA.y) * ny;
			return {
				x: x - 2 * distToLine * nx,
				y: y - 2 * distToLine * ny,
			};
		};

		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		const reflectedPoints = new Set<string>();
		const drawReflectedVertex = (screenPt: { x: number; y: number }, key: string) => {
			if (reflectedPoints.has(key)) return;
			reflectedPoints.add(key);
			createSvgCircle(screenPt.x, screenPt.y, 3.5, {
				...MIRROR_PREVIEW_VERTEX_ATTRS,
				opacity: 0.5,
			}, this.mirrorGroup);
		};

		const getAttrs = (isConstruction: boolean) =>
			getCopyStrokeAttrs(isConstruction, baseColor, 0.5);

		for (const objId of selectedObjectIds) {
			if (objId === mirrorLineId) continue;

			// Line
			const l = sketch.lines.get(objId);
			if (l) {
				const pt1 = sketch.points.get(l.p1Id);
				const pt2 = sketch.points.get(l.p2Id);
				if (pt1 && pt2) {
					const r1 = reflectPoint(pt1.x, pt1.y);
					const r2 = reflectPoint(pt2.x, pt2.y);
					const sr1 = viewport.worldToScreen(r1.x, r1.y);
					const sr2 = viewport.worldToScreen(r2.x, r2.y);

					createSvgLine(sr1.x, sr1.y, sr2.x, sr2.y, getAttrs(!!l.isConstruction), this.mirrorGroup);

					drawReflectedVertex(sr1, `${Math.round(r1.x * 100)},${Math.round(r1.y * 100)}`);
					drawReflectedVertex(sr2, `${Math.round(r2.x * 100)},${Math.round(r2.y * 100)}`);
				}
				continue;
			}

			// Circle
			const c = sketch.circles.get(objId);
			if (c) {
				const center = sketch.points.get(c.centerId);
				if (center) {
					const rc = reflectPoint(center.x, center.y);
					const src = viewport.worldToScreen(rc.x, rc.y);
					const sr = c.radius * viewport.zoom;

					createSvgCircle(src.x, src.y, sr, getAttrs(!!c.isConstruction), this.mirrorGroup);

					drawReflectedVertex(src, `${Math.round(rc.x * 100)},${Math.round(rc.y * 100)}`);
				}
				continue;
			}

			// Arc
			const arc = sketch.arcs.get(objId);
			if (arc) {
				const center = sketch.points.get(arc.centerId);
				const start = sketch.points.get(arc.startPointId);
				const end = sketch.points.get(arc.endPointId);
				if (center && start && end) {
					const rc = reflectPoint(center.x, center.y);
					const rs = reflectPoint(start.x, start.y);
					const re = reflectPoint(end.x, end.y);
					const src = viewport.worldToScreen(rc.x, rc.y);
					const srs = viewport.worldToScreen(rs.x, rs.y);
					const sre = viewport.worldToScreen(re.x, re.y);
					const sr = arc.radius * viewport.zoom;
					const d = getArcSvgPath(src, srs, sre, sr, !arc.clockwise);

					createSvgPath(d, getAttrs(!!arc.isConstruction), this.mirrorGroup);

					drawReflectedVertex(srs, `${Math.round(rs.x * 100)},${Math.round(rs.y * 100)}`);
					drawReflectedVertex(sre, `${Math.round(re.x * 100)},${Math.round(re.y * 100)}`);
					drawReflectedVertex(src, `${Math.round(rc.x * 100)},${Math.round(rc.y * 100)}`);
				}
				continue;
			}

			// Ellipse
			const el = sketch.ellipses.get(objId);
			if (el) {
				const center = sketch.points.get(el.centerId);
				const major = sketch.points.get(el.majorAxisPointId);
				const minor = sketch.points.get(el.minorAxisPointId);
				if (center && major && minor) {
					const rc = reflectPoint(center.x, center.y);
					const rmaj = reflectPoint(major.x, major.y);
					const rmin = reflectPoint(minor.x, minor.y);
					const src = viewport.worldToScreen(rc.x, rc.y);
					const srmaj = viewport.worldToScreen(rmaj.x, rmaj.y);
					const srmin = viewport.worldToScreen(rmin.x, rmin.y);
					const rx = Math.hypot(srmaj.x - src.x, srmaj.y - src.y);
					const ry = Math.hypot(srmin.x - src.x, srmin.y - src.y);
					const thetaDeg = (Math.atan2(srmaj.y - src.y, srmaj.x - src.x) * 180) / Math.PI;

					createSvgEllipse(src.x, src.y, rx, ry, {
						transform: `rotate(${thetaDeg.toFixed(2)} ${src.x.toFixed(1)} ${src.y.toFixed(1)})`,
						...getAttrs(!!el.isConstruction),
					}, this.mirrorGroup);

					drawReflectedVertex(src, `${Math.round(rc.x * 100)},${Math.round(rc.y * 100)}`);
				}
				continue;
			}

			// Elliptical Arc
			const elArc = sketch.ellipticalArcs.get(objId);
			if (elArc) {
				const center = sketch.points.get(elArc.centerId);
				const major = sketch.points.get(elArc.majorAxisPointId);
				const minor = sketch.points.get(elArc.minorAxisPointId);
				const start = sketch.points.get(elArc.startPointId);
				const end = sketch.points.get(elArc.endPointId);
				if (center && major && minor && start && end) {
					const rc = reflectPoint(center.x, center.y);
					const rmaj = reflectPoint(major.x, major.y);
					const rmin = reflectPoint(minor.x, minor.y);
					const rs = reflectPoint(start.x, start.y);
					const re = reflectPoint(end.x, end.y);
					const src = viewport.worldToScreen(rc.x, rc.y);
					const srmaj = viewport.worldToScreen(rmaj.x, rmaj.y);
					const srmin = viewport.worldToScreen(rmin.x, rmin.y);
					const srs = viewport.worldToScreen(rs.x, rs.y);
					const sre = viewport.worldToScreen(re.x, re.y);
					const d = getEllipticalArcSvgPath(src, srmaj, srmin, srs, sre, !elArc.clockwise);

					createSvgPath(d, getAttrs(!!elArc.isConstruction), this.mirrorGroup);

					drawReflectedVertex(srs, `${Math.round(rs.x * 100)},${Math.round(rs.y * 100)}`);
					drawReflectedVertex(sre, `${Math.round(re.x * 100)},${Math.round(re.y * 100)}`);
					drawReflectedVertex(src, `${Math.round(rc.x * 100)},${Math.round(rc.y * 100)}`);
				}
				continue;
			}

			// Standalone Point
			const pt = sketch.points.get(objId);
			if (pt) {
				const rp = reflectPoint(pt.x, pt.y);
				const srp = viewport.worldToScreen(rp.x, rp.y);
				drawReflectedVertex(srp, `${Math.round(rp.x * 100)},${Math.round(rp.y * 100)}`);
				continue;
			}
		}
	}

	renderPatternPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		selectedObjectIds: Set<string>,
		centerPointId: string | null,
		distribution: 'full' | 'partial' | 'symmetric',
		angle: number,
		quantity: number,
		suppression: boolean,
		suppressedIndices: Set<number>
	): void {
		this.patternGroup.innerHTML = '';
		if (!centerPointId) return;

		const centerPt = sketch.points.get(centerPointId);
		if (!centerPt) return;

		const sCtr = viewport.worldToScreen(centerPt.x, centerPt.y);

		// Render center point marker: amber target crosshair & concentric ring
		createSvgCircle(sCtr.x, sCtr.y, 12, PATTERN_CENTER_RING_ATTRS, this.patternGroup);

		createSvgLine(sCtr.x - 16, sCtr.y, sCtr.x + 16, sCtr.y, PATTERN_CENTER_CROSSHAIR_ATTRS, this.patternGroup);

		createSvgLine(sCtr.x, sCtr.y - 16, sCtr.x, sCtr.y + 16, PATTERN_CENTER_CROSSHAIR_ATTRS, this.patternGroup);

		createSvgCircle(sCtr.x, sCtr.y, 4, PATTERN_CENTER_DOT_ATTRS, this.patternGroup);

		if (selectedObjectIds.size === 0) return;

		const N = Math.max(2, Math.round(quantity));
		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		// Calculate angle for each copy k (1 .. N-1)
		for (let k = 1; k < N; k++) {
			const aDeg = computePatternCopyAngle(k, N, distribution, angle);
			const isSuppressed = suppressedIndices.has(k);
			const copyOpacity = isSuppressed ? 0.15 : 0.5;

			const copyWorldPoints = this.renderTransformedObjects(
				sketch,
				viewport,
				selectedObjectIds,
				{ center: centerPt, angleDeg: aDeg },
				{
					targetGroup: this.patternGroup,
					baseColor,
					opacity: copyOpacity,
					isSuppressed,
					drawVertices: true,
					strokeWidth: STROKE_WIDTH.normal,
				}
			);

			// Compute centroid of this copy to place suppression checkbox
			let centroid = { x: 0, y: 0 };
			if (copyWorldPoints.length > 0) {
				let sumX = 0;
				let sumY = 0;
				for (const p of copyWorldPoints) {
					sumX += p.x;
					sumY += p.y;
				}
				centroid = viewport.worldToScreen(sumX / copyWorldPoints.length, sumY / copyWorldPoints.length);
			} else {
				const rad = (aDeg * Math.PI) / 180;
				centroid = {
					x: sCtr.x + 40 * Math.cos(rad),
					y: sCtr.y + 40 * Math.sin(rad),
				};
			}

			// Register checkbox screen position for hit-testing
			this.patternCheckboxPositions.set(`tool-${k}`, { x: centroid.x, y: centroid.y, copyIndex: k });

			// Render suppression checkbox over copy if suppression is enabled
			if (suppression) {
				this.renderPatternSuppressionCheckbox(centroid, k, isSuppressed);
			}
		}
	}

	renderRectangularPatternPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		highlight: {
			selectedObjectIds: Set<string>;
			line1Id: string | null;
			line2Id: string | null;
			quantity1: number;
			distance1: number;
			direction1: 'one_direction' | 'symmetric';
			quantity2: number;
			distance2: number;
			direction2: 'one_direction' | 'symmetric';
			suppression: boolean;
			suppressedIndices: Set<number>;
		}
	): void {
		this.patternGroup.innerHTML = '';
		if (highlight.selectedObjectIds.size === 0) return;

		let sumX = 0, sumY = 0, ptCount = 0;
		for (const objId of highlight.selectedObjectIds) {
			const pt = sketch.points.get(objId);
			if (pt) { sumX += pt.x; sumY += pt.y; ptCount++; continue; }
			const l = sketch.lines.get(objId);
			if (l) {
				const p1 = sketch.points.get(l.p1Id);
				const p2 = sketch.points.get(l.p2Id);
				if (p1) { sumX += p1.x; sumY += p1.y; ptCount++; }
				if (p2) { sumX += p2.x; sumY += p2.y; ptCount++; }
				continue;
			}
			const c = sketch.circles.get(objId);
			if (c) {
				const cp = sketch.points.get(c.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const a = sketch.arcs.get(objId);
			if (a) {
				const cp = sketch.points.get(a.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const el = sketch.ellipses.get(objId);
			if (el) {
				const cp = sketch.points.get(el.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const ea = sketch.ellipticalArcs.get(objId);
			if (ea) {
				const cp = sketch.points.get(ea.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
		}

		if (ptCount === 0) return;
		const centroidWorld = { x: sumX / ptCount, y: sumY / ptCount };

		const paramMap = new Map<string, number>();
		for (const [pid, pt] of sketch.points.entries()) {
			paramMap.set(`${pid}.x`, pt.x);
			paramMap.set(`${pid}.y`, pt.y);
		}
		const line1 = highlight.line1Id ? sketch.lines.get(highlight.line1Id) : null;
		const line2 = highlight.line2Id ? sketch.lines.get(highlight.line2Id) : null;
		const { u1, u2 } = computeRectangularPatternDirections(
			paramMap,
			line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
			line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
		);

		const maxI = Math.abs(highlight.distance1) > 1e-6 ? highlight.quantity1 : 1;
		const maxJ = Math.abs(highlight.distance2) > 1e-6 ? highlight.quantity2 : 1;
		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		for (let i = 0; i < maxI; i++) {
			for (let j = 0; j < maxJ; j++) {
				if (i === 0 && j === 0) continue;
				const copyIndex = i * 1000 + j;
				const isSuppressed = highlight.suppressedIndices.has(copyIndex);
				const copyOpacity = isSuppressed ? 0.15 : 0.5;
				const offset = computeRectangularPatternOffset(i, j, highlight.distance1, highlight.direction1, highlight.distance2, highlight.direction2, u1, u2);

				const copyWorldPoints = this.renderTransformedObjects(
					sketch,
					viewport,
					highlight.selectedObjectIds,
					offset,
					{
						targetGroup: this.patternGroup,
						baseColor,
						opacity: copyOpacity,
						isSuppressed,
						drawVertices: true,
						strokeWidth: STROKE_WIDTH.normal,
					}
				);

				let centroid: { x: number; y: number };
				if (copyWorldPoints.length > 0) {
					let cSumX = 0, cSumY = 0;
					for (const p of copyWorldPoints) {
						cSumX += p.x;
						cSumY += p.y;
					}
					centroid = viewport.worldToScreen(cSumX / copyWorldPoints.length, cSumY / copyWorldPoints.length);
				} else {
					centroid = viewport.worldToScreen(centroidWorld.x + offset.dx, centroidWorld.y + offset.dy);
				}

				this.patternCheckboxPositions.set(`tool-${copyIndex}`, { x: centroid.x, y: centroid.y, copyIndex });

				if (highlight.suppression) {
					this.renderPatternSuppressionCheckbox(centroid, copyIndex, isSuppressed);
				}
			}
		}

		this.renderRectangularPatternGizmos(viewport, centroidWorld, u1, u2, highlight.distance1, highlight.distance2, {
			targetGroup: this.patternGroup,
		});
	}

	renderFilletPreviews(
		sketch: SketchDocument,
		viewport: Viewport,
		state: NonNullable<RenderOptions['filletState']>
	): void {
		// 1. Highlight selected first primitive if any
		if (state.selectedPrimitive1) {
			const { type, id } = state.selectedPrimitive1;
			if (type === 'line') {
				const line = sketch.lines.get(id);
				if (line) {
					const p1 = sketch.points.get(line.p1Id);
					const p2 = sketch.points.get(line.p2Id);
					if (p1 && p2) {
						const s1 = viewport.worldToScreen(p1.x, p1.y);
						const s2 = viewport.worldToScreen(p2.x, p2.y);
						createSvgLine(s1.x, s1.y, s2.x, s2.y, FILLET_HIGHLIGHT_ATTRS, this.filletGroup);
					}
				}
			} else if (type === 'arc') {
				const arc = sketch.arcs.get(id);
				if (arc) {
					const sc = viewport.worldToScreen(sketch.points.get(arc.centerId)!.x, sketch.points.get(arc.centerId)!.y);
					const ss = viewport.worldToScreen(sketch.points.get(arc.startPointId)!.x, sketch.points.get(arc.startPointId)!.y);
					const se = viewport.worldToScreen(sketch.points.get(arc.endPointId)!.x, sketch.points.get(arc.endPointId)!.y);
					const sr = arc.radius * viewport.zoom;
					const d = getArcSvgPath(sc, ss, se, sr, !!arc.clockwise);
					createSvgPath(d, FILLET_HIGHLIGHT_ATTRS, this.filletGroup);
				}
			} else if (type === 'spline') {
				const spline = sketch.splines.get(id);
				if (spline) {
					const geoCurve = sketchPrimitiveToGeoCurve(sketch, 'spline', spline.id) as GeoSpline | null;
					if (geoCurve) {
						const d = getSplineSvgPath(geoCurve.bezierSegments, p => viewport.worldToScreen(p.x, p.y), !!spline.isClosed);
						createSvgPath(d, FILLET_HIGHLIGHT_ATTRS, this.filletGroup);
					}
				}
			}
		}

		// 2. Highlight hovered eligible point
		if (state.hoverPointId) {
			const pt = sketch.points.get(state.hoverPointId);
			if (pt) {
				const s = viewport.worldToScreen(pt.x, pt.y);
				createSvgCircle(s.x, s.y, 8, FILLET_HOVER_POINT_ATTRS, this.filletGroup);
			}
		}

		// 3. Render all pending fillets
		for (const pf of state.pendingFillets) {
			const res = pf.result;
			if (!res) continue;

			const sV = viewport.worldToScreen(res.cornerVertex.x, res.cornerVertex.y);
			const sT1 = viewport.worldToScreen(res.t1.x, res.t1.y);
			const sT2 = viewport.worldToScreen(res.t2.x, res.t2.y);
			const sCenter = viewport.worldToScreen(res.center.x, res.center.y);
			const sMid = viewport.worldToScreen(res.midArc.x, res.midArc.y);
			const sRadius = res.radius * viewport.zoom;

			// Shaded corner wedge
			const sweepWedgeFlag = res.clockwise ? 0 : 1;
			const wedgePath = `M ${sT1.x} ${sT1.y} L ${sV.x} ${sV.y} L ${sT2.x} ${sT2.y} A ${sRadius.toFixed(2)} ${sRadius.toFixed(2)} 0 0 ${sweepWedgeFlag} ${sT1.x} ${sT1.y} Z`;
			createSvgPath(wedgePath, FILLET_WEDGE_ATTRS, this.filletGroup);

			// Fillet arc
			const arcD = getArcSvgPath(sCenter, sT1, sT2, sRadius, res.clockwise);
			createSvgPath(arcD, FILLET_ARC_ATTRS, this.filletGroup);

			// Check if this fillet is active for Gizmo
			const isActive = pf.id === state.activeFilletId || (!state.activeFilletId && pf === state.pendingFillets[state.pendingFillets.length - 1]);
			if (isActive) {
				// Center circle handle
				createSvgCircle(sCenter.x, sCenter.y, 4, FILLET_GIZMO_CENTER_ATTRS, this.filletGroup);

				// Radial dashed line extending outward from center through midArc
				const uDir = {
					x: (sMid.x - sCenter.x) / (Math.hypot(sMid.x - sCenter.x, sMid.y - sCenter.y) || 1),
					y: (sMid.y - sCenter.y) / (Math.hypot(sMid.x - sCenter.x, sMid.y - sCenter.y) || 1),
				};
				const lineLen = sRadius + 45;
				const lineEndX = sCenter.x + lineLen * uDir.x;
				const lineEndY = sCenter.y + lineLen * uDir.y;

				createSvgLine(sCenter.x, sCenter.y, lineEndX, lineEndY, FILLET_GIZMO_RADIAL_ATTRS, this.filletGroup);

				// Small square at tip
				const sqSize = 6;
				createSvgRect(lineEndX - sqSize * 0.5, lineEndY - sqSize * 0.5, sqSize, sqSize, FILLET_GIZMO_SQUARE_ATTRS, this.filletGroup);

				// Inward arrow gizmo at sMid pointing towards sCenter
				const aux = -uDir.x;
				const auy = -uDir.y;
				const apx = -auy;
				const apy = aux;

				const arrowLen = 18;
				const arrowHalfWidth = 7.5;
				const tipX = sMid.x;
				const tipY = sMid.y;
				const baseCenterX = tipX - arrowLen * aux;
				const baseCenterY = tipY - arrowLen * auy;
				const b1X = baseCenterX + arrowHalfWidth * apx;
				const b1Y = baseCenterY + arrowHalfWidth * apy;
				const b2X = baseCenterX - arrowHalfWidth * apx;
				const b2Y = baseCenterY - arrowHalfWidth * apy;

				const arrowPath = `M ${tipX} ${tipY} L ${b1X} ${b1Y} L ${b2X} ${b2Y} Z`;
				createSvgPath(arrowPath, FILLET_GIZMO_ARROW_ATTRS, this.filletGroup);

				this.filletGizmoHandle = {
					screenX: tipX,
					screenY: tipY,
					worldMidArc: res.midArc,
					worldCenter: res.center,
					worldBisectorDir: res.bisectorDir,
					radius: res.radius,
				};
			}
		}
	}

	clearPreviews(): void {
		this.previewGroup.innerHTML = '';
		this.overlayGroup.innerHTML = '';
		this.filletGroup.innerHTML = '';
		this.filletGizmoHandle = null;
	}

	private renderTooltip(x: number, y: number, textStr: string): void {
		const g = createSvgElement('g', undefined, this.previewGroup);
		const width = textStr.length * 7.5 + 14;

		createSvgRect(x - width * 0.5, y - 11, width, 22, TOOLTIP_RECT_ATTRS, g);

		createSvgText(x, y + 4, textStr, TOOLTIP_TEXT_ATTRS, g);
	}
}

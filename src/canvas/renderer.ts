import type { SvgExportDimensions } from '../model/io/svgIO';
import { AABB } from '../math/aabb';
import type { SketchImage } from '../model/image';
import { createTransform, type TransformValues } from '../model/transform';
import { calculateObjectsCentroid } from './tools/modify/utils';
import type { SketchDocument } from '../model/sketch';
import type { SketchPoint, SketchSpline } from '../model/types';
import type { Viewport } from './viewport';
import { getAllGeoCurves } from '../math/intersection';
import { findCurveRegions, pointInRegion, type SketchRegion } from '../math/regions';
import type { FilletCandidate } from '../math/fillet';
import { collectFilletPreviewTrims, filletSplinePreview } from '../math/filletPreview';
import {
	computePatternCopyAngle,
	computeRectangularPatternOffset,
	computeRectangularPatternDirections,
	type ConstraintRenderContext,
} from '../solver/constraints';
import { ORIGIN, Vec2 } from '../math/vector';
import { getBadgeIcon } from './badgeIcons';
import { bsplineToBezier, fitPointsToBezier, getSplineSvgPath, type BezierSegment } from '../math/spline';
import { getFontSync, loadFontAsync } from './fonts';
import { generateTextSvgPathData } from '../math/textPath';

export * from './styles';
export * from './svg';
export * from './dimensionGeometry';
export { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';

import {
	TEXT_ROTATION_HANDLE_DISTANCE_PX,
	DIMENSION_EXTERNAL_ARROW_TAIL_PX,
	DIMENSION_EXTENSION_OVERRUN_PX,
} from './distances';

import {
	createSvgElement,
	createSvgLine,
	createSvgCircle,
	createSvgRect,
	createSvgEllipse,
	createSvgPath,
	createSvgText,
	renderDimensionLabel,
	getArcSvgPath,
	getEllipticalArcSvgPath,
} from './svg';
import {
	type LinearDimensionVisualOptions,
	formatDimensionValue,
	computeDistanceDimensionGeometry,
	computePointToLineDimensionGeometry,
} from './dimensionGeometry';
import {
	COLORS,
	REGION_STYLE,
	DASH_ARRAY,
	STROKE_WIDTH,
	SVG_EXPORT_STYLE,
	DIM_ARROWS,
	FILTERS,
	type SvgAttrs,
	HIT_AREA_STROKE_ATTRS,
	HIT_AREA_RING_ATTRS,
	HIT_AREA_POINT_ATTRS,
	AUX_RAY_ATTRS,
	AUX_AXIS_ATTRS,
	EXTENSION_LINE_ATTRS,
	PREVIEW_EXTENSION_LINE_ATTRS,
	SELECTION_BOX_ATTRS,
	CROSSING_SELECTION_BOX_ATTRS,
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
	FILLET_WEDGE_ATTRS,
	FILLET_ARC_ATTRS,
	GIZMO_POINT_ATTRS,
	FILLET_GIZMO_RADIAL_ATTRS,
	FILLET_GIZMO_SQUARE_ATTRS,
	FILLET_GIZMO_ARROW_ATTRS,
	CHAMFER_HIGHLIGHT_ATTRS,
	CHAMFER_CUT_LINE_ATTRS,
	CHAMFER_GIZMO_ARROW_ATTRS,
	CHAMFER_GIZMO_CIRCLE_ATTRS,
	GIZMO_GUIDE_ATTRS,
	OFFSET_CHAIN_ATTRS,
	OFFSET_PREVIEW_ATTRS,
	OFFSET_GIZMO_ARROW_ATTRS,
	SNAP_POINT_ATTRS,
	SNAP_GRID_ATTRS,
	SNAP_OBJECT_ATTRS,
	SPLINE_HANDLE_SELECTED_ATTRS,
	SPLINE_CONTROL_POLYGON_ATTRS,
	getSplineHandleStrokeAttrs,
	SPLINE_STYLES,
	getCopyStrokeAttrs,
	getPrimitiveStrokeAttrs,
} from './styles';

const TWO_PI = 2 * Math.PI;

export interface RenderOptions {
	activeTextId?: string | null;
	hideTextGizmos?: boolean;
	imagePreview?: SketchImage | null;
	hiddenEntityIds?: Set<string>;
	regionHoverPoint?: Vec2 | null;
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
		angleHandleEnabled: boolean;
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
		pendingFillets: FilletCandidate[];
		activeFilletId?: string | null;
		selectedPrimitive1?: { type: 'line' | 'arc' | 'spline'; id: string } | null;
		hoverPointId?: string | null;
	};
	chamferState?: {
		candidate: import('../math/chamfer').ChamferCandidate | null;
		firstLine: { id: string; clickPos: Vec2 } | null;
		hoverPointId: string | null;
		mode: import('../math/chamfer').ChamferMode;
		flip: boolean;
	};
	offsetState?: {
		chain: import('../math/offset').OffsetChain | null;
		geomResult: import('../math/offset').OffsetGeometryResult | null;
		direction: import('../math/offset').OffsetDirection;
		dist1: number;
		dist2: number;
		flip: boolean;
	};
}

export interface OffsetGizmoHandle {
	type: 'dist1' | 'dist2';
	screenX: number;
	screenY: number;
	worldPos: Vec2;
	normal: Vec2;
	currentValue: number;
}

export interface ChamferGizmoHandle {
	type: 'dist1' | 'dist2' | 'angle';
	screenX: number;
	screenY: number;
	worldPos: Vec2;
	dir?: Vec2;
	currentValue: number;
}

export class SVGRenderer {
	private svg: SVGSVGElement;
	private defsEl: SVGDefsElement;
	private gridGroup: SVGGElement;
	private imageGroup: SVGGElement;
	private originAxisGroup: SVGGElement;
	private geometryGroup: SVGGElement;
	private regionGroup: SVGGElement;
	private regionHoverGroup: SVGGElement;
	private constraintBadgesVisible = true;
	private dimensionsVisible = true;
	private cachedRegions: SketchRegion[] = [];
	private regionGeometryKey: string | null = null;
	private cachedViewport: Viewport | null = null;
	deferRegionSolve = false;
	onRegionSolve?: (elapsedMs: number) => void;
	private constraintGroup: SVGGElement;
	private pointGroup: SVGGElement;
	private mirrorGroup: SVGGElement;
	private patternGroup: SVGGElement;
	private patternCheckboxGroup: SVGGElement;
	readonly patternCheckboxPositions = new Map<
		string,
		{ x: number; y: number; copyIndex: number; constraintId?: string }
	>();
	patternAngleHandle: {
		x: number;
		y: number;
		worldX: number;
		worldY: number;
		copyIndex: number;
	} | null = null;
	readonly rectangularGizmoHandles = new Map<string, { x: number; y: number; axis: 1 | 2; constraintId?: string }>();
	readonly chamferGizmoHandles: ChamferGizmoHandle[] = [];
	readonly offsetGizmoHandles: OffsetGizmoHandle[] = [];
	filletGizmoHandle: {
		screenX: number;
		screenY: number;
		worldMidArc: Vec2;
		worldBisectorDir: Vec2;
		radius: number;
	} | null = null;
	public previewGroup: SVGGElement;
	public textGroup: SVGGElement;
	public textRotationGizmo: {
		textId: string;
		centerWorld: Vec2;
		handleScreen: Vec2;
	} | null = null;
	public textDragGizmo: {
		textId: string;
		centerWorld: Vec2;
		centerScreen: Vec2;
	} | null = null;
	private overlayGroup: SVGGElement;
	private filletGroup: SVGGElement;
	private chamferGroup: SVGGElement;
	private offsetGroup: SVGGElement;

	constructor(svgElement: SVGSVGElement) {
		this.svg = svgElement;
		this.svg.innerHTML = '';

		// Create defs for markers and filters
		this.defsEl = createSvgElement('defs', undefined, this.svg);
		this.setupDefs();

		this.gridGroup = this.createGroup('grid-layer');
		this.gridGroup.style.pointerEvents = 'none';

		this.imageGroup = this.createGroup('image-layer');
		this.originAxisGroup = this.createGroup('origin-axis-layer');
		this.regionGroup = this.createGroup('region-layer');
		this.regionGroup.style.pointerEvents = 'none';
		this.regionHoverGroup = this.createGroup('region-hover-layer');
		this.regionHoverGroup.style.pointerEvents = 'none';

		this.geometryGroup = this.createGroup('geometry-layer');
		this.textGroup = this.createGroup('text-layer');
		this.constraintGroup = this.createGroup('constraint-layer');
		this.pointGroup = this.createGroup('point-layer');

		this.mirrorGroup = this.createGroup('mirror-preview-layer');
		this.mirrorGroup.style.pointerEvents = 'none';

		this.patternGroup = this.createGroup('pattern-preview-layer');
		this.patternGroup.style.pointerEvents = 'none';

		this.patternCheckboxGroup = this.createGroup('pattern-checkbox-layer');

		this.filletGroup = this.createGroup('fillet-layer');
		this.chamferGroup = this.createGroup('chamfer-layer');
		this.offsetGroup = this.createGroup('offset-layer');

		this.previewGroup = this.createGroup('preview-layer');
		this.previewGroup.style.pointerEvents = 'none';

		this.overlayGroup = this.createGroup('overlay-layer');
		this.overlayGroup.style.pointerEvents = 'none';

		this.svg.appendChild(this.gridGroup);
		this.svg.appendChild(this.imageGroup);
		this.svg.appendChild(this.originAxisGroup);
		this.svg.appendChild(this.regionGroup);
		this.svg.appendChild(this.geometryGroup);
		this.svg.appendChild(this.textGroup);
		this.svg.appendChild(this.regionHoverGroup);
		this.svg.appendChild(this.constraintGroup);
		this.svg.appendChild(this.pointGroup);
		this.svg.appendChild(this.mirrorGroup);
		this.svg.appendChild(this.patternGroup);
		this.svg.appendChild(this.patternCheckboxGroup);
		this.svg.appendChild(this.filletGroup);
		this.svg.appendChild(this.chamferGroup);
		this.svg.appendChild(this.offsetGroup);
		this.svg.appendChild(this.previewGroup);
		this.svg.appendChild(this.overlayGroup);
	}

	private createGroup(className: string): SVGGElement {
		return createSvgElement('g', { class: className });
	}

	private setupDefs(): void {
		const createArrowMarker = (id: string, color: string) => {
			const marker = createSvgElement(
				'marker',
				{
					id,
					viewBox: '0 0 16 10',
					refX: '16',
					refY: '5',
					markerWidth: '16',
					markerHeight: '10',
					markerUnits: 'userSpaceOnUse',
					orient: 'auto-start-reverse',
				},
				this.defsEl
			);

			createSvgPath('M 0 1.5 L 16 5 L 0 8.5 z', { fill: color }, marker);
		};

		createArrowMarker('dim-arrow', COLORS.primary);
		createArrowMarker('dim-arrow-selected', COLORS.selected);
		createArrowMarker('dim-arrow-delete', 'rgba(255, 0, 0, 0.9)');
	}

	render(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
		this.patternCheckboxPositions.clear();
		this.patternAngleHandle = null;
		this.rectangularGizmoHandles.clear();
		this.patternCheckboxGroup.innerHTML = '';
		this.renderGrid(sketch, viewport, options.showGrid ?? true, options);
		this.renderImages(sketch, viewport, options.imagePreview);
		this.renderRegions(sketch, viewport, options.regionHoverPoint ?? null);
		this.renderGeometry(sketch, viewport, options);
		this.textRotationGizmo = null;
		this.textDragGizmo = null;
		this.textGroup.innerHTML = '';
		this.renderTexts(sketch, viewport, options);
		if (options.showConstraints !== false) {
			this.renderConstraints(sketch, viewport, options);
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
				options.patternHighlight.suppressedIndices,
				options.patternHighlight.angleHandleEnabled
			);
		}
		if (options.rectangularPatternHighlight) {
			this.renderRectangularPatternPreview(sketch, viewport, options.rectangularPatternHighlight);
		}
		this.filletGizmoHandle = null;
		this.filletGroup.innerHTML = '';
		if (options.filletState) {
			this.renderFilletPreviews(sketch, viewport, options.filletState);
		}
		this.chamferGizmoHandles.length = 0;
		this.chamferGroup.innerHTML = '';
		if (options.chamferState) {
			this.renderChamferPreviews(viewport, options.chamferState);
		}
		this.offsetGizmoHandles.length = 0;
		this.offsetGroup.innerHTML = '';
		if (options.offsetState) {
			this.renderOffsetPreviews(sketch, viewport, options.offsetState);
		}
	}

	private renderRegions(sketch: SketchDocument, viewport: Viewport, hoverPoint: Vec2 | null): void {
		if (!this.deferRegionSolve) {
			const start = performance.now();
			const curves = getAllGeoCurves(sketch).filter(curve => !curve.isConstruction);
			const geometryKey = JSON.stringify(curves);
			if (geometryKey !== this.regionGeometryKey) {
				this.cachedRegions = findCurveRegions(curves);
				this.regionGeometryKey = geometryKey;
				this.onRegionSolve?.(performance.now() - start);
			}
		}
		this.cachedViewport = viewport;
		this.drawRegions(hoverPoint);
	}

	updateRegionHover(hoverPoint: Vec2 | null): boolean {
		if (this.cachedViewport) this.drawRegions(hoverPoint);
		return hoverPoint !== null && this.cachedRegions.some(region => pointInRegion(hoverPoint, region));
	}

	setRegionsVisible(visible: boolean): void {
		this.regionGroup.style.display = visible ? '' : 'none';
		this.regionHoverGroup.style.display = visible ? '' : 'none';
	}

	setConstraintBadgesVisible(visible: boolean): void {
		this.constraintBadgesVisible = visible;
		this.constraintGroup.querySelectorAll<SVGGElement>('.constraint-badge').forEach(badge => {
			badge.style.display = visible ? '' : 'none';
		});
	}

	setDimensionsVisible(visible: boolean): void {
		this.dimensionsVisible = visible;
		this.constraintGroup.querySelectorAll<SVGGElement>('.dimension-item').forEach(dimension => {
			dimension.style.display = visible ? '' : 'none';
		});
	}

	private drawRegions(hoverPoint: Vec2 | null): void {
		this.regionGroup.innerHTML = '';
		this.regionHoverGroup.innerHTML = '';
		for (const region of this.cachedRegions) {
			const hovered = hoverPoint ? pointInRegion(hoverPoint, region) : false;
			const d = [region.points, ...region.holes]
				.map(
					ring =>
						`M ${ring
							.map(p => {
								const s = this.cachedViewport!.worldToScreen(p);
								return `${s.x.toFixed(2)} ${s.y.toFixed(2)}`;
							})
							.join(' L ')} Z`
				)
				.join(' ');
			createSvgPath(
				d,
				{
					fill: hovered ? REGION_STYLE.hoverFill : REGION_STYLE.fill,
					'fill-opacity': hovered ? REGION_STYLE.hoverFillOpacity : REGION_STYLE.fillOpacity,
					stroke: 'none',
					'fill-rule': 'evenodd',
				},
				this.regionGroup
			);
			if (hovered)
				createSvgPath(
					d,
					{
						fill: 'none',
						stroke: REGION_STYLE.stroke,
						'stroke-width': STROKE_WIDTH.normal,
						'stroke-linejoin': 'round',
					},
					this.regionHoverGroup
				);
		}
	}

	renderImages(sketch: SketchDocument, viewport: Viewport, preview?: SketchImage | null): void {
		this.imageGroup.innerHTML = '';
		for (const stored of sketch.images.values()) {
			const image = preview?.id === stored.id ? preview : stored;
			const center = viewport.worldToScreen(image);
			const width = image.width * viewport.zoom;
			const height = image.height * viewport.zoom;
			const attrs = {
				x: center.x - width / 2,
				y: center.y - height / 2,
				width,
				height,
				transform: `rotate(${-image.angle % 360} ${center.x} ${center.y})`,
				'data-image-id': image.id,
				'pointer-events': 'all',
			};
			if (image.objectUrl) {
				createSvgElement(
					'image',
					{
						...attrs,
						href: image.objectUrl,
						opacity: image.opacity,
						preserveAspectRatio: 'none',
					},
					this.imageGroup
				);
			} else {
				createSvgElement(
					'rect',
					{
						...attrs,
						fill: 'none',
						stroke: COLORS.construction,
						'stroke-dasharray': DASH_ARRAY.guideCircle,
					},
					this.imageGroup
				);
			}
		}
	}

	private renderGrid(sketch: SketchDocument, viewport: Viewport, showGrid: boolean, options: RenderOptions = {}): void {
		this.gridGroup.innerHTML = '';
		this.originAxisGroup.innerHTML = '';

		const origin = viewport.worldToScreen(ORIGIN);

		if (showGrid) {
			const { step, subStep } = viewport.getGridStep();
			const minWorld = viewport.screenToWorld(new Vec2(0, viewport.height));
			const maxWorld = viewport.screenToWorld(new Vec2(viewport.width, 0));

			const start = new Vec2(Math.floor(minWorld.x / subStep) * subStep, Math.floor(minWorld.y / subStep) * subStep);
			const end = new Vec2(Math.ceil(maxWorld.x / subStep) * subStep, Math.ceil(maxWorld.y / subStep) * subStep);

			const subStepPx = subStep * viewport.zoom;
			const showSubGrid = subStepPx >= 6;

			// 1. Minor grid lines (every subStep)
			let dMinor = '';
			// 2. Major grid lines (every step = 5 * subStep)
			let dMajor = '';

			const axisY = Math.max(8, Math.min(viewport.height - 40, origin.y));
			const axisX = Math.max(8, Math.min(viewport.width - 30, origin.x));

			const labelsG = createSvgElement('g', { class: 'grid-labels', 'pointer-events': 'none' }, this.originAxisGroup);

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

			for (let x = start.x; x <= end.x; x += subStep) {
				const s = viewport.worldToScreen(new Vec2(x, 0));
				const isMajor = Math.abs(Math.round(x / subStep) % 5) === 0;
				if (isMajor) {
					dMajor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;

					const cleanVal = parseFloat((Math.round(x / step) * step).toFixed(6));
					if (Math.abs(cleanVal) > 1e-4) {
						const anchor = new Vec2(s.x, axisY + 4);
						createSvgText(
							anchor,
							cleanVal.toString(),
							{
								transform: `rotate(-90 ${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)})`,
								'text-anchor': 'end',
								...labelStyle,
							},
							labelsG
						);
					}
				} else if (showSubGrid) {
					dMinor += `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `;
				}
			}

			for (let y = start.y; y <= end.y; y += subStep) {
				const s = viewport.worldToScreen(new Vec2(0, y));
				const isMajor = Math.abs(Math.round(y / subStep) % 5) === 0;
				if (isMajor) {
					dMajor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;

					const cleanVal = parseFloat((Math.round(y / step) * step).toFixed(6));
					if (Math.abs(cleanVal) > 1e-4) {
						createSvgText(
							new Vec2(axisX + 8, s.y),
							cleanVal.toString(),
							{
								'text-anchor': 'start',
								...labelStyle,
							},
							labelsG
						);
					}
				} else if (showSubGrid) {
					dMinor += `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;
				}
			}

			// Minor grid (subStep) - light subtle lines
			if (showSubGrid && dMinor) {
				createSvgPath(
					dMinor,
					{
						stroke: COLORS.gridMinor,
						'stroke-width': STROKE_WIDTH.minorGrid,
						fill: 'none',
					},
					this.gridGroup
				);
			}

			// Major grid (step = 5 * subStep) - distinct darker lines
			if (dMajor) {
				createSvgPath(
					dMajor,
					{
						stroke: COLORS.gridMajor,
						'stroke-width': STROKE_WIDTH.majorGrid,
						fill: 'none',
					},
					this.gridGroup
				);
			}
		}

		// Origin Axes & Marker
		const isXSelected = sketch.selection.lineIds.has('axis_x');
		const isYSelected = sketch.selection.lineIds.has('axis_y');
		const isOriginSelected = sketch.selection.pointIds.has('origin');

		// X Axis (Red)
		const axisXG = createSvgElement(
			'g',
			{
				'data-id': 'axis_x',
				'data-type': 'line',
				class: 'sketch-entity sketch-line sketch-axis-line' + (isXSelected ? ' is-selected selected' : ''),
			},
			this.originAxisGroup
		);

		createSvgLine(new Vec2(0, origin.y), new Vec2(viewport.width, origin.y), HIT_AREA_STROKE_ATTRS, axisXG);
		createSvgLine(
			new Vec2(0, origin.y),
			new Vec2(viewport.width, origin.y),
			{
				stroke: isXSelected ? COLORS.selected : COLORS.xAxis,
				'stroke-width': isXSelected ? STROKE_WIDTH.selected : STROKE_WIDTH.dimension,
			},
			axisXG
		);

		// Y Axis (Green)
		const axisYG = createSvgElement(
			'g',
			{
				'data-id': 'axis_y',
				'data-type': 'line',
				class: 'sketch-entity sketch-line sketch-axis-line' + (isYSelected ? ' is-selected selected' : ''),
			},
			this.originAxisGroup
		);

		createSvgLine(new Vec2(origin.x, 0), new Vec2(origin.x, viewport.height), HIT_AREA_STROKE_ATTRS, axisYG);
		createSvgLine(
			new Vec2(origin.x, 0),
			new Vec2(origin.x, viewport.height),
			{
				stroke: isYSelected ? COLORS.selected : COLORS.yAxis,
				'stroke-width': isYSelected ? STROKE_WIDTH.selected : STROKE_WIDTH.dimension,
			},
			axisYG
		);

		// Origin marker target (CAD surveyor style matching reference image)
		const isPatternCenter = options.patternHighlight?.centerPointId === 'origin';
		const originMarkerG = createSvgElement(
			'g',
			{
				'data-id': 'origin',
				'data-type': 'point',
				class: 'sketch-entity sketch-point sketch-origin-marker' + (isOriginSelected ? ' is-selected selected' : ''),
			},
			this.originAxisGroup
		);

		const r = 8;
		createSvgPath(
			`M ${origin.x} ${origin.y} L ${origin.x + r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y - r} Z`,
			{
				fill: isOriginSelected ? COLORS.selected : isPatternCenter ? COLORS.patternCenter : COLORS.originQuarter,
			},
			originMarkerG
		);

		createSvgPath(
			`M ${origin.x} ${origin.y} L ${origin.x - r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y + r} Z`,
			{
				fill: isOriginSelected ? COLORS.selected : isPatternCenter ? COLORS.patternCenter : COLORS.originQuarter,
			},
			originMarkerG
		);

		createSvgCircle(
			origin,
			r,
			{
				fill: 'none',
				stroke: isOriginSelected ? COLORS.selected : isPatternCenter ? COLORS.patternCenter : COLORS.construction,
				'stroke-width': isOriginSelected || isPatternCenter ? STROKE_WIDTH.selected : STROKE_WIDTH.dimension,
			},
			originMarkerG
		);

		// Transparent hit target circle so clicking/hovering near (0,0) is easy
		createSvgCircle(
			origin,
			14,
			{
				fill: COLORS.hitTransparent,
				stroke: 'none',
			},
			originMarkerG
		);
	}

	private renderGeometry(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
		this.geometryGroup.innerHTML = '';
		this.pointGroup.innerHTML = '';

		const { constrainedParams, status } = sketch.lastSolverResult ?? {};
		const hasConflict = status === 'OVER_CONSTRAINED';
		const isPointConstrained = (id: string) => !!constrainedParams?.has(`${id}.x`) && constrainedParams.has(`${id}.y`);
		const getBaseColor = (isConstrained: boolean) =>
			hasConflict ? COLORS.conflict : isConstrained ? COLORS.constrained : COLORS.unconstrained;

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

		const lineCuts = new Map<string, Map<string, Vec2>>();
		const addCut = (lineId: string, pointId: string, cut: Vec2) => {
			let cuts = lineCuts.get(lineId);
			if (!cuts) {
				cuts = new Map();
				lineCuts.set(lineId, cuts);
			}
			cuts.set(pointId, cut);
		};
		const filletTrims = collectFilletPreviewTrims(sketch, options.filletState?.pendingFillets ?? []);
		for (const [id, trim] of filletTrims) {
			const line = sketch.lines.get(id);
			if (!line) continue;
			if (trim.start) addCut(id, line.p1Id, trim.start.point);
			if (trim.end) addCut(id, line.p2Id, trim.end.point);
		}
		const chamfer = options.chamferState?.candidate;
		if (chamfer?.result?.isValid) {
			addCut(chamfer.line1.id, chamfer.line1.cornerPointId, chamfer.result.t1);
			addCut(chamfer.line2.id, chamfer.line2.cornerPointId, chamfer.result.t2);
		}

		// 1. Render Lines
		const splineTangentGroups: SVGGElement[] = [];
		for (const line of sketch.lines.values()) {
			if (options.hiddenEntityIds?.has(line.id)) continue;
			const p1 = sketch.points.get(line.p1Id);
			const p2 = sketch.points.get(line.p2Id);
			if (!p1 || !p2) continue;

			if (line.isSplineHandle) {
				const isParentActive = line.parentSplineId ? activeSplineIds.has(line.parentSplineId) : false;
				if (!isParentActive && !options.showSplineHandles) continue;
			}

			const s1 = viewport.worldToScreen(p1);
			const s2 = viewport.worldToScreen(p2);
			const isMirrorLine = options.mirrorHighlight?.mirrorLineId === line.id;
			const isDir1Line = options.rectangularPatternHighlight?.line1Id === line.id;
			const isDir2Line = options.rectangularPatternHighlight?.line2Id === line.id;
			const isMirrorSelected = options.mirrorHighlight?.selectedObjectIds.has(line.id);
			const isPatternSelected =
				options.patternHighlight?.selectedObjectIds.has(line.id) ||
				options.rectangularPatternHighlight?.selectedObjectIds.has(line.id);
			const isChamferSelected = options.chamferState?.firstLine?.id === line.id;
			const isFilletSelected =
				options.filletState?.selectedPrimitive1?.type === 'line' &&
				options.filletState.selectedPrimitive1.id === line.id;
			const isSelected =
				sketch.selection.lineIds.has(line.id) ||
				!!isMirrorSelected ||
				!!isPatternSelected ||
				isChamferSelected ||
				isFilletSelected;

			const lineG = createSvgElement(
				'g',
				{
					'data-id': line.id,
					'data-type': 'line',
					class: `sketch-entity sketch-line ${isSelected ? 'is-selected' : ''} ${line.isSplineHandle ? 'sketch-spline-handle' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgLine(s1, s2, HIT_AREA_STROKE_ATTRS, lineG);

			// Visible line
			if (line.isSplineHandle) {
				const parentSpline = line.parentSplineId ? sketch.splines.get(line.parentSplineId) : undefined;
				if (parentSpline?.splineType === 'control') {
					createSvgLine(s1, s2, isSelected ? SPLINE_HANDLE_SELECTED_ATTRS : SPLINE_CONTROL_POLYGON_ATTRS, lineG);
				} else {
					lineG.classList.add('sketch-spline-tangent');
					createSvgLine(s1, s2, getSplineHandleStrokeAttrs(isSelected), lineG);
					splineTangentGroups.push(lineG);
				}
			} else if (isMirrorLine) {
				createSvgLine(s1, s2, MIRROR_LINE_ATTRS, lineG);
			} else if (isDir1Line) {
				createSvgLine(s1, s2, DIR1_LINE_ATTRS, lineG);
			} else if (isDir2Line) {
				createSvgLine(s1, s2, DIR2_LINE_ATTRS, lineG);
			} else {
				const cuts = lineCuts.get(line.id);
				const start = cuts?.get(line.p1Id);
				const end = cuts?.get(line.p2Id);
				const isChamferPreview =
					chamfer?.result?.isValid && (chamfer.line1.id === line.id || chamfer.line2.id === line.id);
				createSvgLine(
					start ? viewport.worldToScreen(start) : s1,
					end ? viewport.worldToScreen(end) : s2,
					isChamferPreview
						? CHAMFER_HIGHLIGHT_ATTRS
						: getPrimitiveStrokeAttrs(
								isSelected,
								!!line.isConstruction,
								getBaseColor(isPointConstrained(line.p1Id) && isPointConstrained(line.p2Id)),
								true
							),
					lineG
				);
			}
		}

		// 2. Render Circles
		for (const circle of sketch.circles.values()) {
			const center = sketch.points.get(circle.centerId);
			if (!center) continue;

			const sc = viewport.worldToScreen(center);
			const sr = circle.radius * viewport.zoom;
			const isSelected =
				sketch.selection.circleIds.has(circle.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(circle.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(circle.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(circle.id);

			const circleG = createSvgElement(
				'g',
				{
					'data-id': circle.id,
					'data-type': 'circle',
					class: `sketch-entity sketch-circle ${isSelected ? 'is-selected' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgCircle(sc, sr, HIT_AREA_RING_ATTRS, circleG);

			// Visible circle
			createSvgCircle(
				sc,
				sr,
				{
					fill: 'none',
					...getPrimitiveStrokeAttrs(
						isSelected,
						!!circle.isConstruction,
						getBaseColor(isPointConstrained(circle.centerId) && !!constrainedParams?.has(`${circle.id}.r`))
					),
				},
				circleG
			);
		}

		// 3. Render Arcs
		for (const arc of sketch.arcs.values()) {
			const center = sketch.points.get(arc.centerId);
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (!center || !start || !end) continue;

			const sc = viewport.worldToScreen(center);
			const ss = viewport.worldToScreen(start);
			const se = viewport.worldToScreen(end);
			const sr = arc.radius * viewport.zoom;
			const isFilletSelected =
				options.filletState?.selectedPrimitive1?.type === 'arc' && options.filletState.selectedPrimitive1.id === arc.id;
			const isSelected =
				sketch.selection.arcIds.has(arc.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(arc.id) ||
				isFilletSelected;

			const clockwise = !!arc.clockwise;
			const d = getArcSvgPath(sc, ss, se, sr, clockwise);
			const trim = filletTrims.get(arc.id);
			const previewD = trim
				? trim.start && trim.end && trim.start.param >= trim.end.param
					? ''
					: getArcSvgPath(
							sc,
							trim.start ? viewport.worldToScreen(trim.start.point) : ss,
							trim.end ? viewport.worldToScreen(trim.end.point) : se,
							sr,
							clockwise
						)
				: d;

			const arcG = createSvgElement(
				'g',
				{
					'data-id': arc.id,
					'data-type': 'arc',
					class: `sketch-entity sketch-arc ${isSelected ? 'is-selected' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);

			// Visible arc path
			createSvgPath(
				previewD,
				{
					fill: 'none',
					...getPrimitiveStrokeAttrs(
						isSelected,
						!!arc.isConstruction,
						getBaseColor(
							[arc.centerId, arc.startPointId, arc.endPointId].every(isPointConstrained) &&
								!!constrainedParams?.has(`${arc.id}.r`)
						),
						true
					),
				},
				arcG
			);

			// Light dashed radial lines to center if selected
			if (isSelected) {
				createSvgLine(sc, ss, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc, se, AUX_AXIS_ATTRS, arcG);
			}
		}

		// 4. Render Ellipses
		for (const ellipse of sketch.ellipses.values()) {
			const center = sketch.points.get(ellipse.centerId);
			const majorPt = sketch.points.get(ellipse.majorAxisPointId);
			const minorPt = sketch.points.get(ellipse.minorAxisPointId);
			if (!center || !majorPt || !minorPt) continue;

			const sc = viewport.worldToScreen(center);
			const smaj = viewport.worldToScreen(majorPt);
			const smin = viewport.worldToScreen(minorPt);

			const r = sc.distancesTo(smaj, smin);
			if (r.x < 0.1 || r.y < 0.1) continue;

			const thetaDeg = sc.angleToPointDeg(smaj);
			const isSelected =
				sketch.selection.ellipseIds.has(ellipse.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(ellipse.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(ellipse.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(ellipse.id);

			const ellipseG = createSvgElement(
				'g',
				{
					'data-id': ellipse.id,
					'data-type': 'ellipse',
					class: `sketch-entity sketch-ellipse ${isSelected ? 'is-selected' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgEllipse(
				sc,
				r,
				{
					transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
					...HIT_AREA_RING_ATTRS,
				},
				ellipseG
			);

			// Visible ellipse
			createSvgEllipse(
				sc,
				r,
				{
					transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
					fill: 'none',
					...getPrimitiveStrokeAttrs(
						isSelected,
						!!ellipse.isConstruction,
						getBaseColor(
							[ellipse.centerId, ellipse.majorAxisPointId, ellipse.minorAxisPointId].every(isPointConstrained)
						)
					),
				},
				ellipseG
			);

			// Subtle dashed conjugate axes if selected
			if (isSelected) {
				createSvgLine(sc, smaj, AUX_AXIS_ATTRS, ellipseG);
				createSvgLine(sc, smin, AUX_AXIS_ATTRS, ellipseG);
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

			const sc = viewport.worldToScreen(center);
			const smaj = viewport.worldToScreen(majorPt);
			const smin = viewport.worldToScreen(minorPt);
			const ss = viewport.worldToScreen(startPt);
			const se = viewport.worldToScreen(endPt);

			const clockwise = !!arc.clockwise;
			const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, clockwise);
			const isSelected =
				sketch.selection.ellipticalArcIds.has(arc.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.patternHighlight?.selectedObjectIds.has(arc.id) ||
				!!options.rectangularPatternHighlight?.selectedObjectIds.has(arc.id);

			const arcG = createSvgElement(
				'g',
				{
					'data-id': arc.id,
					'data-type': 'elliptical_arc',
					class: `sketch-entity sketch-elliptical-arc ${isSelected ? 'is-selected' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);

			// Visible arc path
			createSvgPath(
				d,
				{
					fill: 'none',
					...getPrimitiveStrokeAttrs(
						isSelected,
						!!arc.isConstruction,
						getBaseColor(
							[arc.centerId, arc.majorAxisPointId, arc.minorAxisPointId, arc.startPointId, arc.endPointId].every(
								isPointConstrained
							)
						),
						true
					),
				},
				arcG
			);

			// Light dashed radial lines to center and axes if selected
			if (isSelected) {
				createSvgLine(sc, ss, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc, se, AUX_AXIS_ATTRS, arcG);
				createSvgLine(sc, smaj, AUX_RAY_ATTRS, arcG);
				createSvgLine(sc, smin, AUX_RAY_ATTRS, arcG);
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
						h1: p1,
						h2: p2,
					};
				});
				bezierSegments = fitPointsToBezier(pts, handles);
			}

			const isFilletSelected =
				options.filletState?.selectedPrimitive1?.type === 'spline' &&
				options.filletState.selectedPrimitive1.id === spline.id;
			const isSelected =
				sketch.selection.splineIds.has(spline.id) ||
				options.mirrorHighlight?.selectedObjectIds.has(spline.id) ||
				options.patternHighlight?.selectedObjectIds.has(spline.id) ||
				options.rectangularPatternHighlight?.selectedObjectIds.has(spline.id) ||
				isFilletSelected;

			const d = getSplineSvgPath(bezierSegments, p => viewport.worldToScreen(p), !!spline.isClosed);
			const trim = filletTrims.get(spline.id);
			const closed = !!spline.isClosed && !trim;
			const previewD = trim
				? getSplineSvgPath(
						filletSplinePreview(bezierSegments, spline.splineType, trim),
						p => viewport.worldToScreen(p),
						closed
					)
				: d;

			const isConstrained =
				pts.every(point => isPointConstrained(point.id)) &&
				(spline.splineType !== 'fit' ||
					!spline.tangentLineIds ||
					spline.tangentLineIds.every(id => {
						const line = sketch.lines.get(id);
						return !line || (isPointConstrained(line.p1Id) && isPointConstrained(line.p2Id));
					}));

			const splineG = createSvgElement(
				'g',
				{
					'data-id': spline.id,
					'data-type': 'spline',
					class: `sketch-entity sketch-spline ${isSelected ? 'is-selected' : ''}`,
				},
				this.geometryGroup
			);

			// Invisible generous hit target using the shared line hit width
			createSvgPath(d, HIT_AREA_STROKE_ATTRS, splineG);

			// Visible spline path
			createSvgPath(
				previewD,
				{
					fill: closed ? SPLINE_STYLES.closedFill : 'none',
					...getPrimitiveStrokeAttrs(isSelected, !!spline.isConstruction, getBaseColor(isConstrained), true),
				},
				splineG
			);
		}

		// Paint tangent handles above the spline paths.
		for (const group of splineTangentGroups) this.geometryGroup.appendChild(group);

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
			if (options.hiddenEntityIds?.has(pt.id)) continue;
			const splineHandleInfo = handlePointToSpline.get(pt.id);
			const splineControl = controlPointToSpline.get(pt.id);

			if (splineHandleInfo) {
				if (
					!activeSplineIds.has(splineHandleInfo.spline.id) &&
					!sketch.selection.pointIds.has(pt.id) &&
					!options.showSplineHandles
				) {
					continue;
				}
			}
			if (splineControl) {
				if (
					!activeSplineIds.has(splineControl.id) &&
					!sketch.selection.pointIds.has(pt.id) &&
					!options.showSplineHandles
				) {
					continue;
				}
			}

			const s = viewport.worldToScreen(pt);
			const isPatternCenter = options.patternHighlight?.centerPointId === pt.id;
			const isPatternSelected =
				options.patternHighlight?.selectedObjectIds.has(pt.id) ||
				options.rectangularPatternHighlight?.selectedObjectIds.has(pt.id);
			const isSelected =
				sketch.selection.pointIds.has(pt.id) ||
				!!options.mirrorHighlight?.selectedObjectIds.has(pt.id) ||
				!!isPatternSelected ||
				isPatternCenter;

			const ptG = createSvgElement(
				'g',
				{
					'data-id': pt.id,
					'data-type': 'point',
					class: `sketch-entity sketch-point ${isSelected ? 'is-selected' : ''}`,
				},
				this.pointGroup
			);

			// Invisible larger hit target for easy clicking
			createSvgCircle(s, 14, HIT_AREA_POINT_ATTRS, ptG);

			// Visible point handle
			let strokeColor: string = COLORS.primary;

			if (splineHandleInfo?.isHandleDot) {
				strokeColor = SPLINE_STYLES.handleDot.stroke;
			} else if (pt.fixed) {
				strokeColor = COLORS.fixed;
			} else if (!hasConflict && isPointConstrained(pt.id)) {
				strokeColor = COLORS.constrained;
			}

			if (isPatternCenter) {
				strokeColor = COLORS.patternCenter;
			} else if (isSelected) {
				strokeColor = COLORS.selected;
			}

			createSvgCircle(
				s,
				isSelected ? 4 : splineHandleInfo?.isHandleDot ? SPLINE_STYLES.handleDot.r : 3,
				{
					class: 'entity-visible visible-point',
					fill: COLORS.white,
					stroke: strokeColor,
					'stroke-width': STROKE_WIDTH.thin,
					'pointer-events': 'all',
				},
				ptG
			);
		}
	}

	private renderTexts(
		sketch: SketchDocument,
		viewport: Viewport,
		options: RenderOptions,
		preview?: { ids: ReadonlySet<string>; target: SVGGElement; color: string }
	): void {
		for (const text of sketch.texts.values()) {
			if (options.hiddenEntityIds?.has(text.id) || (preview && !preview.ids.has(text.id))) continue;
			const isSelected = sketch.selection.textIds.has(text.id) || options.activeTextId === text.id;
			const color = preview?.color ?? (isSelected ? COLORS.primary : COLORS.unconstrained);
			const hScreen = Math.max(1, text.height * viewport.zoom);
			const fontFam = text.fontFamily || 'Arial, sans-serif';

			if (text.mode === 'text') {
				const corners = text.getRectangleCorners(sketch);
				if (!corners) continue;

				const [p0, p1, p2, p3] = corners;
				const cWorld = new Vec2().midpoint(p0, p2);
				const sCenter = viewport.worldToScreen(cWorld);
				const widthWorld = p0.distanceTo(p1);
				const heightWorld = p0.distanceTo(p3);
				const wScreen = widthWorld * viewport.zoom;
				const hBoxScreen = heightWorld * viewport.zoom;

				const angleCad = p0.angleToPoint(p1);
				const angleScreenDeg = (-angleCad * 180) / Math.PI;

				const textG = createSvgElement(
					'g',
					{
						class: `sketch-text-entity ${isSelected ? 'selected' : ''}`,
						transform: `translate(${sCenter.x.toFixed(2)}, ${sCenter.y.toFixed(2)}) rotate(${angleScreenDeg.toFixed(2)})`,
						'data-id': text.id,
						'data-text-id': text.id,
						cursor: 'pointer',
					},
					preview?.target ?? this.textGroup
				);

				// Transparent hit-rect covering the entire box for easy clicking & double-clicking
				createSvgElement(
					'rect',
					{
						x: -wScreen / 2,
						y: -hBoxScreen / 2,
						width: wScreen,
						height: hBoxScreen,
						fill: 'rgba(0, 0, 0, 0.001)',
						'data-id': text.id,
						'data-text-id': text.id,
					},
					textG
				);

				const scaleX = text.flipHorizontal ? -1 : 1;
				const scaleY = text.flipVertical ? -1 : 1;
				const innerG =
					text.flipHorizontal || text.flipVertical
						? createSvgElement('g', { transform: `scale(${scaleX}, ${scaleY})` }, textG)
						: textG;

				let posX = 0;
				let textAnchor = 'middle';
				if (text.alignment === 'left') {
					if (text.flipHorizontal) {
						posX = wScreen / 2 - 4;
						textAnchor = 'end';
					} else {
						posX = -wScreen / 2 + 4;
						textAnchor = 'start';
					}
				} else if (text.alignment === 'right') {
					if (text.flipHorizontal) {
						posX = -wScreen / 2 + 4;
						textAnchor = 'start';
					} else {
						posX = wScreen / 2 - 4;
						textAnchor = 'end';
					}
				}

				const letterSpacingPx = (text.characterSpacing / 100) * hScreen;
				const lines = (text.text || '').split(/\r?\n/);
				const numLines = Math.max(1, lines.length);
				const lineHeightPx = hScreen * 1.25;
				const totalBlockHeightPx = (numLines - 1) * lineHeightPx;

				let startY = 0;
				const vAlign = text.verticalAlignment ?? 'middle';
				if (vAlign === 'top') {
					startY = text.flipVertical ? hBoxScreen / 2 - hScreen / 2 - 3 : -hBoxScreen / 2 + hScreen / 2 + 3;
				} else if (vAlign === 'bottom') {
					startY = text.flipVertical
						? -hBoxScreen / 2 + hScreen / 2 + 3 + totalBlockHeightPx
						: hBoxScreen / 2 - hScreen / 2 - 3 - totalBlockHeightPx;
				} else {
					startY = text.flipVertical ? totalBlockHeightPx / 2 : -totalBlockHeightPx / 2;
				}

				const textEl = createSvgElement(
					'text',
					{
						x: posX,
						y: startY,
						fill: color,
						'font-family': fontFam,
						'font-size': `${hScreen.toFixed(1)}px`,
						'font-weight': text.bold ? 'bold' : 'normal',
						'font-style': text.italic ? 'italic' : 'normal',
						'letter-spacing': `${letterSpacingPx.toFixed(1)}px`,
						'text-anchor': textAnchor,
						'dominant-baseline': 'central',
						'data-id': text.id,
						'data-text-id': text.id,
					},
					innerG
				);

				for (let i = 0; i < lines.length; i++) {
					const lineY = text.flipVertical ? startY - i * lineHeightPx : startY + i * lineHeightPx;
					createSvgElement(
						'tspan',
						{
							x: posX,
							y: lineY.toFixed(1),
							'data-id': text.id,
							'data-text-id': text.id,
						},
						textEl,
						lines[i] || ' '
					);
				}

				// Rotation Gizmo Handle (at top center of rectangle)
				if (isSelected && !options.hideTextGizmos && !preview) {
					const stemLen = TEXT_ROTATION_HANDLE_DISTANCE_PX;
					const topEdgeY = -hBoxScreen / 2;
					const handleY = topEdgeY - stemLen;

					createSvgElement(
						'line',
						{
							x1: 0,
							y1: topEdgeY,
							x2: 0,
							y2: handleY,
							stroke: COLORS.primary,
							'stroke-width': 1.5,
							'stroke-dasharray': '2,2',
						},
						textG
					);

					createSvgElement(
						'circle',
						{
							cx: 0,
							cy: handleY,
							r: 5.5,
							fill: COLORS.white,
							stroke: COLORS.primary,
							'stroke-width': 2,
							class: 'text-rotation-handle',
							cursor: 'grab',
						},
						textG
					);

					const rad = (angleScreenDeg * Math.PI) / 180;
					const handleScreen = new Vec2(0, handleY).rotateAround(ORIGIN, rad).add(sCenter);

					this.textRotationGizmo = {
						textId: text.id,
						centerWorld: cWorld,
						handleScreen,
					};

					// Center Drag / Move Handle (at center of rectangle)
					createSvgElement(
						'circle',
						{
							cx: 0,
							cy: 0,
							r: 5.5,
							fill: COLORS.white,
							stroke: COLORS.primary,
							'stroke-width': 2,
							class: 'text-drag-handle',
							cursor: 'move',
						},
						textG
					);

					this.textDragGizmo = {
						textId: text.id,
						centerWorld: cWorld,
						centerScreen: sCenter,
					};
				}
			} else if (text.mode === 'text_on_path' && text.targetPrimitiveId) {
				const curve = sketch.toGeoCurve(text.targetPrimitiveId, text.targetPrimitiveType);
				if (!curve) continue;

				const font = getFontSync(text.fontFamily, text.bold, text.italic);
				if (!font) {
					loadFontAsync(text.fontFamily, text.bold, text.italic);
				}

				const pathData = font
					? generateTextSvgPathData(
							{
								mode: 'text_on_path',
								text: text.text,
								height: text.height,
								characterSpacing: text.characterSpacing,
								placement: text.placement,
								fitToPath: text.fitToPath,
								flipHorizontal: text.flipHorizontal,
								flipVertical: text.flipVertical,
								alignment: text.alignment,
								coordSystem: 'cad',
							},
							font,
							curve
						)
					: '';

				if (pathData) {
					const textPathG = createSvgElement(
						'g',
						{
							class: `sketch-text-entity ${isSelected ? 'selected' : ''}`,
							transform: `matrix(${viewport.zoom}, 0, 0, ${-viewport.zoom}, ${viewport.panX.toFixed(2)}, ${viewport.panY.toFixed(2)})`,
							'data-id': text.id,
							'data-text-id': text.id,
							cursor: 'pointer',
						},
						preview?.target ?? this.textGroup
					);

					createSvgElement(
						'path',
						{
							d: pathData,
							fill: color,
							'data-id': text.id,
							'data-text-id': text.id,
							cursor: 'pointer',
						},
						textPathG
					);
				}
			}
		}
	}

	exportDimensions(sketch: SketchDocument, viewport: Viewport): SvgExportDimensions | undefined {
		const group = createSvgElement('g', { visibility: 'hidden' }, this.svg);
		try {
			this.renderConstraints(sketch, viewport, {}, group, true);
			if (!group.children.length) return undefined;
			group.querySelectorAll('text').forEach(text => {
				text.textContent = text.textContent?.replace(/^fx:\s*/, '') ?? '';
			});
			group.querySelectorAll('[stroke-width]').forEach(element => {
				element.setAttribute('stroke-width', String(SVG_EXPORT_STYLE.dimensionStrokeWidth * viewport.zoom));
			});
			const box = group.getBBox();
			// SVG bounding boxes omit arrow markers and strokes.
			const padding = 16;
			const bounds = new AABB(viewport.screenToWorld(new Vec2(box.x - padding, box.y - padding))).addPoint(
				viewport.screenToWorld(new Vec2(box.x + box.width + padding, box.y + box.height + padding))
			);
			const transform = `translate(${-viewport.panX / viewport.zoom} ${-viewport.panY / viewport.zoom}) scale(${1 / viewport.zoom})`;
			return {
				svg: `${this.defsEl.outerHTML}<g transform="${transform}">${group.innerHTML}</g>`,
				bounds,
			};
		} finally {
			group.remove();
		}
	}

	private renderConstraints(
		sketch: SketchDocument,
		viewport: Viewport,
		options: RenderOptions = {},
		targetGroup = this.constraintGroup,
		dimensionsOnly = false
	): void {
		targetGroup.innerHTML = '';
		const lineBadgeCounts = new Map<string, number>();

		const ctx: ConstraintRenderContext = {
			sketch,
			viewport,
			targetGroup,
			isSelected: false,
			lineBadgeCounts,
			renderBadge: (id, position, label, color) => {
				this.renderConstraintBadge(id, position, label, ctx.isSelected, color);
			},
			renderBadgeOnSegment: (id, p1Id, p2Id, label) => {
				this.renderBadgeOnSegment(id, p1Id, p2Id, sketch, viewport, label, ctx.isSelected, lineBadgeCounts);
			},
			renderBadgeOnCircle: (id, circleId, label) => {
				this.renderBadgeOnCircle(id, circleId, sketch, viewport, label, ctx.isSelected);
			},
			renderLinearDimensionVisual: opts => {
				this.renderLinearDimensionVisual(opts);
			},
			renderAngleExtensionLines: (g, sCenter, angle, rScreen, sp1, sp2, color) => {
				this.renderAngleExtensionLines(g, sCenter, angle, rScreen, sp1, sp2, color);
			},
			patternCheckboxGroup: this.patternCheckboxGroup,
			patternCheckboxPositions: this.patternCheckboxPositions,
			rectangularGizmoHandles: this.rectangularGizmoHandles,
			isConstraintOnlySelected: constraintId => this.isConstraintOnlySelected(constraintId, sketch),
			renderTransformedObjects: (objectIds, transform, options) => {
				return this.renderTransformedObjects(sketch, viewport, objectIds, transform, options);
			},
			renderPatternSuppressionCheckbox: (centroid, k, isSuppressed, constraintId) => {
				this.renderPatternSuppressionCheckbox(centroid, k, isSuppressed, constraintId);
			},
			renderRectangularPatternGizmos: (v, centroidWorld, u1, u2, distance1, distance2, options) => {
				this.renderRectangularPatternGizmos(v, centroidWorld, u1, u2, distance1, distance2, options);
			},
			isAngleNearArc: (arc, center, point, rScreen) => {
				return this.isAngleNearArc(arc, center, point, sketch, viewport, rScreen);
			},
		};

		for (const constraint of sketch.constraints.values()) {
			if (dimensionsOnly && !constraint.isDimensional) continue;
			if (sketch.isSplineInternalConstraint(constraint)) continue;
			if (options.hiddenEntityIds && constraint.entityIds?.some(id => options.hiddenEntityIds!.has(id))) continue;
			ctx.isSelected = !dimensionsOnly && sketch.selection.constraintIds.has(constraint.id);
			constraint.render?.(ctx);
		}
		if (!dimensionsOnly) {
			this.setDimensionsVisible(this.dimensionsVisible);
			this.setConstraintBadgesVisible(this.constraintBadgesVisible);
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
			isPreview = false,
			startPointHighlight,
			targetPointSnapped = false,
		} = opts;

		const g = constraintId
			? createSvgElement(
					'g',
					{
						class: 'dimension-item',
						'data-id': constraintId,
						'data-type': 'constraint',
					},
					parent
				)
			: parent;

		const color = isSelected ? COLORS.selected : COLORS.primary;
		const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

		// 1. Extension lines
		if (extensionLines && extensionLines.length > 0) {
			const extAttrs = isPreview
				? PREVIEW_EXTENSION_LINE_ATTRS
				: isSelected
					? { ...EXTENSION_LINE_ATTRS, stroke: COLORS.selected }
					: EXTENSION_LINE_ATTRS;
			for (const ext of extensionLines) {
				createSvgLine(ext.from, ext.to, extAttrs, g);
			}
		}

		// 2. Start point highlight (origin anchor)
		if (startPointHighlight) {
			createSvgCircle(
				startPointHighlight,
				4,
				{
					fill: COLORS.primary,
					stroke: COLORS.white,
					'stroke-width': 1.5,
				},
				g
			);
		}

		// 3. Target point snap ring
		if (targetPointSnapped) {
			createSvgCircle(
				d2,
				6,
				{
					fill: COLORS.guideFaint,
					stroke: COLORS.primary,
					'stroke-width': 1.5,
				},
				g
			);
		}

		// 4. Dimension line with arrowheads (Engineering CAD style)
		const screenDist = d1.distanceTo(d2);
		const lineAttrs: SvgAttrs = {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		};
		const minInsideDist = 40;
		if (screenDist >= minInsideDist) {
			createSvgLine(d1, d2, { ...lineAttrs, 'marker-start': arrowUrl, 'marker-end': arrowUrl }, g);
		} else if (screenDist > 1e-4) {
			// Flipped arrows outside pointing inward (GOST 2.307)
			createSvgLine(d1, d2, lineAttrs, g);
			const u = new Vec2().subVectors(d2, d1).multiplyScalar(1 / screenDist);
			createSvgLine(
				d1.clone().addScaledVector(u, -DIMENSION_EXTERNAL_ARROW_TAIL_PX),
				d1,
				{ ...lineAttrs, 'marker-end': arrowUrl },
				g
			);
			createSvgLine(
				d2.clone().addScaledVector(u, DIMENSION_EXTERNAL_ARROW_TAIL_PX),
				d2,
				{ ...lineAttrs, 'marker-end': arrowUrl },
				g
			);
		} else {
			createSvgLine(d1, d2, lineAttrs, g);
		}

		// Option B: Dimension number placed above the dimension line
		let angle = 0;
		if (screenDist > 1e-4) {
			angle = Math.atan2(d2.y - d1.y, d2.x - d1.x);
		}
		// Normalize angle so text reads from left to right (or bottom to top from the right side, GOST 2.307)
		if (angle > Math.PI / 2 - 1e-4) {
			angle -= Math.PI;
		} else if (angle <= -Math.PI / 2) {
			angle += Math.PI;
		}
		const uText = Vec2.fromPolar(1, angle);
		const up = new Vec2(uText.y, -uText.x);

		// Position along the dimension line (can be moved anywhere, default is midpoint t = 0.5)
		const t = opts.labelPosition ?? 0.5;
		const basePos = d1.clone().lerp(d2, t);

		// Extend dimension line if text moved outside extension lines
		if (screenDist > 1e-4 && (t < 0 || t > 1)) {
			const u = new Vec2().subVectors(d2, d1).multiplyScalar(1 / screenDist);
			const overhang = Math.max(12, (label.length * 7.5) / 2) + 6;
			if (t < 0) {
				createSvgLine(basePos.clone().addScaledVector(u, -overhang), d1, lineAttrs, g);
			} else if (t > 1) {
				createSvgLine(d2, basePos.clone().addScaledVector(u, overhang), lineAttrs, g);
			}
		}

		const textPos = basePos.addScaledVector(up, 8.5);
		const angleDeg = (angle * 180) / Math.PI;

		renderDimensionLabel(g, textPos, label, color, 'linear', {
			angleDeg,
		});
	}

	private renderAngleExtensionLines(
		parentG: SVGElement,
		sCenter: Vec2,
		angleRad: number,
		rScreen: number,
		pA: Vec2,
		pB: Vec2,
		color: string
	): void {
		const v = Vec2.fromPolar(1, angleRad);

		const k1 = new Vec2().subVectors(pA, sCenter).dot(v);
		const k2 = new Vec2().subVectors(pB, sCenter).dot(v);
		const kMin = Math.min(k1, k2);
		const kMax = Math.max(k1, k2);

		const kEnd = rScreen + DIMENSION_EXTENSION_OVERRUN_PX;
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
			const p1 = sCenter.clone().addScaledVector(v, startK);
			const p2 = sCenter.clone().addScaledVector(v, endK);

			createSvgLine(
				p1,
				p2,
				{
					...EXTENSION_LINE_ATTRS,
					stroke: color,
				},
				parentG
			);
		}
	}

	private isAngleNearArc(
		arc: { startPointId: string; endPointId: string; clockwise?: boolean },
		center: Vec2,
		point: Vec2,
		sketch: SketchDocument,
		viewport: Viewport,
		rScreen: number
	): boolean {
		const start = sketch.points.get(arc.startPointId);
		const end = sketch.points.get(arc.endPointId);
		if (!start || !end) return true;

		const sCenter = viewport.worldToScreen(center);
		const ss = viewport.worldToScreen(start);
		const se = viewport.worldToScreen(end);
		const as = sCenter.angleToPoint(ss);
		const ae = sCenter.angleToPoint(se);
		const aPt = sCenter.angleToPoint(point);
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

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);

		const dir = new Vec2().subVectors(s2, s1);
		const len = Math.max(dir.length(), 1);
		const u = dir.clone().multiplyScalar(1 / len);

		const normal = u.clone().perpendicular();
		if (normal.y > 0 || (Math.abs(normal.y) < 1e-4 && normal.x < 0)) {
			normal.negate();
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

		const midpoint = new Vec2().midpoint(s1, s2).addScaledVector(normal, 14).addScaledVector(u, offsetAlong);

		this.renderConstraintBadge(constraintId, midpoint, label, isSelected);
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

		const sc = viewport.worldToScreen(center);
		const rScreen = entity.radius * viewport.zoom;
		let bx = sc.x + rScreen * 0.7071;
		let by = sc.y - rScreen * 0.7071;

		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start);
				const se = viewport.worldToScreen(end);
				const as = sc.angleToPoint(ss);
				const ae = sc.angleToPoint(se);
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

		this.renderConstraintBadge(constraintId, new Vec2(bx, by), label, isSelected);
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
		const sCtr = viewport.worldToScreen(centroidWorld);

		const p1Screen = viewport.worldToScreen(new Vec2().addVectors(centroidWorld, u1));
		const v1 = new Vec2().subVectors(p1Screen, sCtr);
		const v1Len = Math.max(p1Screen.distanceTo(sCtr), 1e-6);
		const u1Screen = v1.clone().multiplyScalar(1.0 / v1Len);

		const p2Screen = viewport.worldToScreen(new Vec2().addVectors(centroidWorld, u2));
		const v2 = new Vec2().subVectors(p2Screen, sCtr);
		const v2Len = Math.max(p2Screen.distanceTo(sCtr), 1e-6);
		const u2Screen = v2.clone().multiplyScalar(1.0 / v2Len);

		const h1World = Vec2.from(centroidWorld).addScaledVector(u1, distance1);
		const h1Screen = viewport.worldToScreen(h1World);

		const h2World = Vec2.from(centroidWorld).addScaledVector(u2, distance2);
		const h2Screen = viewport.worldToScreen(h2World);

		const gizmoG = createSvgElement(
			'g',
			{
				class: 'rectangular-pattern-gizmos',
			},
			options.targetGroup
		);

		const renderArrow = (
			from: { x: number; y: number },
			to: { x: number; y: number },
			dirScreen: { x: number; y: number },
			color: string,
			axisNum: 1 | 2,
			distVal: number
		) => {
			const isNegative = distVal < -1e-3;
			const arrowDir = Vec2.from(dirScreen).multiplyScalar(isNegative ? -1 : 1);
			const perp = arrowDir.clone().perpendicular();

			const arrowLen = 18;
			const arrowHalfWidth = 7.5;
			const offsetDist = 48; // Offset equals initial line length at distance=0 (48px)

			const tip = Vec2.from(to).addScaledVector(arrowDir, offsetDist);
			const baseCenter = tip.clone().addScaledVector(arrowDir, -arrowLen);

			const base1 = baseCenter.clone().addScaledVector(perp, arrowHalfWidth);
			const base2 = baseCenter.clone().addScaledVector(perp, -arrowHalfWidth);

			// Register handle centered on the arrowhead for dragging
			const key = options.constraintId ? `gizmo-${axisNum}-${options.constraintId}` : `gizmo-${axisNum}`;
			this.rectangularGizmoHandles.set(key, {
				x: tip.x - arrowLen * 0.5 * arrowDir.x,
				y: tip.y - arrowLen * 0.5 * arrowDir.y,
				axis: axisNum,
				constraintId: options.constraintId,
			});

			// Shaft line connecting origin to base of arrowhead (always solid, no dashed lines)
			createSvgLine(
				from,
				baseCenter,
				{
					stroke: color,
					'stroke-width': 2.5,
					'stroke-dasharray': 'none',
					opacity: 0.9,
					'pointer-events': 'none',
				},
				gizmoG
			);

			// Arrowhead as the draggable gizmo handle (replaces circle)
			const arrowPath = `M ${tip.x} ${tip.y} L ${base1.x} ${base1.y} L ${base2.x} ${base2.y} Z`;
			createSvgPath(
				arrowPath,
				{
					fill: color,
					stroke: COLORS.white,
					'stroke-width': 1.5,
					'stroke-linejoin': 'round',
					class: 'rectangular-pattern-gizmo-arrow',
					filter: FILTERS.gizmoArrow,
					'data-axis': String(axisNum),
				},
				gizmoG
			);

			// Distance label pill: without "d1:", "d2:", only the value
			const labelText = `${formatDimensionValue(distVal, 1)} mm`;
			const pillWidth = labelText.length * 6.8 + 14;
			const isHorizontal = Math.abs(arrowDir.x) >= Math.abs(arrowDir.y);

			let pillX: number;
			let pillY: number;

			if (isHorizontal) {
				// Horizontal arrow -> place label below the arrow
				const midX = tip.x - arrowLen * 0.5 * arrowDir.x;
				const max = new Vec2(from.x, Math.max(from.y, tip.y, base1.y, base2.y));
				pillX = midX;
				pillY = max.y + 16;
			} else {
				// Vertical arrow -> place label to the right of the arrow
				const midY = tip.y - arrowLen * 0.5 * arrowDir.y;
				const max = new Vec2(Math.max(from.x, tip.x, base1.x, base2.x), from.y);
				pillX = max.x + 10 + pillWidth * 0.5;
				pillY = midY;
			}

			createSvgRect(
				new Vec2(pillX - pillWidth * 0.5, pillY - 10),
				new Vec2(pillWidth, 20),
				{
					...RECT_PATTERN_PILL_ATTRS,
					stroke: color,
				},
				gizmoG
			);

			createSvgText(new Vec2(pillX, pillY + 3.5), labelText, RECT_PATTERN_PILL_TEXT_ATTRS, gizmoG);
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
		const cbG = createSvgElement(
			'g',
			{
				class: 'pattern-suppression-checkbox',
				style: 'cursor: pointer;',
				'data-copy-k': String(k),
				...(constraintId ? { 'data-constraint-id': constraintId } : {}),
			},
			this.patternCheckboxGroup
		);

		// Outer halo / shadow
		createSvgRect(Vec2.from(centroid).subScalar(11), new Vec2(22, 22), CHECKBOX_HALO_ATTRS, cbG);

		if (!isSuppressed) {
			// Active checkbox (blue filled with white checkmark)
			createSvgRect(Vec2.from(centroid).subScalar(9), new Vec2(18, 18), CHECKBOX_ACTIVE_ATTRS, cbG);

			createSvgPath(
				`M ${centroid.x - 4.5} ${centroid.y} L ${centroid.x - 1.5} ${centroid.y + 3.5} L ${centroid.x + 5} ${centroid.y - 3.5}`,
				CHECKBOX_CHECKMARK_ATTRS,
				cbG
			);
		} else {
			// Suppressed checkbox (grey outline with red dash)
			createSvgRect(Vec2.from(centroid).subScalar(9), new Vec2(18, 18), CHECKBOX_SUPPRESSED_ATTRS, cbG);

			createSvgLine(
				new Vec2(centroid.x - 4, centroid.y),
				new Vec2(centroid.x + 4, centroid.y),
				CHECKBOX_SUPPRESSED_DASH_ATTRS,
				cbG
			);
		}
	}

	renderTransformPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		ids: ReadonlySet<string>,
		center: Vec2,
		values: TransformValues,
		targetGroup: SVGGElement,
		color: string
	): void {
		const transform = createTransform(center, values);
		this.renderTransformedObjects(sketch, viewport, ids, (x, y) => transform.point(new Vec2(x, y)), {
			targetGroup,
			baseColor: color,
			transformScale: values.scale,
			drawVertices: true,
		});

		if (sketch.selection.textIds.size === 0) return;
		const from = viewport.worldToScreen(center);
		const to = viewport.worldToScreen(transform.point(center));
		const textPreview = createSvgElement(
			'g',
			{
				transform: `translate(${to.x}, ${to.y}) rotate(${-values.angle % 360}) scale(${values.scale}) translate(${-from.x}, ${-from.y})`,
			},
			targetGroup
		);
		this.renderTexts(sketch, viewport, {}, { ids, target: textPreview, color });
	}

	private renderTransformedObjects(
		sketch: SketchDocument,
		viewport: Viewport,
		objectIds: Iterable<string>,
		transform:
			| { center: { x: number; y: number }; angleDeg: number }
			| Vec2
			| ((x: number, y: number) => { x: number; y: number }),
		options: {
			targetGroup?: SVGGElement;
			baseColor?: string;
			opacity?: number;
			isSuppressed?: boolean;
			drawVertices?: boolean;
			strokeWidth?: number;
			skipRender?: boolean;
			transformScale?: number;
		}
	): Array<{ x: number; y: number }> {
		let transformPoint: (x: number, y: number) => { x: number; y: number };
		if (typeof transform === 'function') {
			transformPoint = transform;
		} else if ('angleDeg' in transform) {
			const rad = (transform.angleDeg * Math.PI) / 180;
			const center = transform.center;
			transformPoint = (x, y) => new Vec2(x, y).rotateAround(center, rad);
		} else {
			transformPoint = (x, y) => new Vec2(x, y).add(transform);
		}

		const copyWorldPoints: Array<{ x: number; y: number }> = [];
		const targetGroup = options.targetGroup;
		const skipRender = options.skipRender || !targetGroup;
		const opacity = options.opacity ?? 1.0;
		const baseColor = options.baseColor ?? COLORS.unconstrained;
		const strokeWidth = options.strokeWidth ?? STROKE_WIDTH.normal;
		const transformScale = options.transformScale ?? 1;

		const drawTransformedVertex = (screenPt: { x: number; y: number }) => {
			if (!options.drawVertices || skipRender || !targetGroup) return;
			createSvgCircle(
				screenPt,
				3,
				{
					fill: options.transformScale !== undefined || baseColor === COLORS.constrained ? baseColor : COLORS.primary,
					stroke: COLORS.white,
					'stroke-width': STROKE_WIDTH.normal,
					opacity,
					'pointer-events': 'none',
				},
				targetGroup
			);
		};

		const getAttrs = (isConstruction: boolean) => {
			const attrs = getCopyStrokeAttrs(isConstruction, baseColor, opacity, strokeWidth);
			return options.transformScale === undefined ? attrs : { ...attrs, stroke: baseColor };
		};

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
						const sp1 = viewport.worldToScreen(rp1);
						const sp2 = viewport.worldToScreen(rp2);
						createSvgLine(sp1, sp2, getAttrs(!!l.isConstruction), targetGroup);

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
						const sc = viewport.worldToScreen(rc);
						const sr = c.radius * viewport.zoom * transformScale;
						createSvgCircle(sc, sr, getAttrs(!!c.isConstruction), targetGroup);

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
						const sc = viewport.worldToScreen(rc);
						const ss = viewport.worldToScreen(rs);
						const se = viewport.worldToScreen(re);
						const sr = a.radius * viewport.zoom * transformScale;

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
						const src = viewport.worldToScreen(rc);
						const srmaj = viewport.worldToScreen(rmaj);
						const srmin = viewport.worldToScreen(rmin);
						const r = src.distancesTo(srmaj, srmin);
						const thetaDeg = src.angleToPointDeg(srmaj);

						createSvgEllipse(
							src,
							r,
							{
								transform: `rotate(${thetaDeg.toFixed(2)} ${src.x.toFixed(1)} ${src.y.toFixed(1)})`,
								...getAttrs(!!e.isConstruction),
							},
							targetGroup
						);

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
						const src = viewport.worldToScreen(rc);
						const srmaj = viewport.worldToScreen(rmaj);
						const srmin = viewport.worldToScreen(rmin);
						const srs = viewport.worldToScreen(rs);
						const sre = viewport.worldToScreen(re);
						const d = getEllipticalArcSvgPath(src, srmaj, srmin, srs, sre, elArc.clockwise);

						createSvgPath(d, getAttrs(!!elArc.isConstruction), targetGroup);

						drawTransformedVertex(srs);
						drawTransformedVertex(sre);
						drawTransformedVertex(src);
					}
				}
				continue;
			}

			const spline = sketch.splines.get(objId)?.toGeoCurve(sketch);
			if (spline) {
				const points = spline.points.map(point => transformPoint(point.x, point.y));
				copyWorldPoints.push(...(spline.isClosed ? points.slice(0, -1) : points));
				if (!skipRender && targetGroup) {
					const d = getSplineSvgPath(
						spline.bezierSegments,
						point => viewport.worldToScreen(transformPoint(point.x, point.y)),
						spline.isClosed
					);
					createSvgPath(d, getAttrs(!!spline.isConstruction), targetGroup);
					for (const point of points) drawTransformedVertex(viewport.worldToScreen(point));
				}
				continue;
			}

			// Standalone Point
			const pt = sketch.points.get(objId);
			if (pt) {
				const rp = transformPoint(pt.x, pt.y);
				copyWorldPoints.push(rp);

				if (!skipRender && targetGroup) {
					const srp = viewport.worldToScreen(rp);
					drawTransformedVertex(srp);
				}
			}
		}

		return copyWorldPoints;
	}
	private renderConstraintBadge(
		id: string,
		position: Vec2,
		label: string,
		isSelected: boolean,
		customColor?: string
	): void {
		const g = createSvgElement(
			'g',
			{
				class: 'constraint-badge',
				'data-id': id,
				'data-type': 'constraint',
			},
			this.constraintGroup
		);
		g.style.display = this.constraintBadgesVisible ? '' : 'none';

		const color = isSelected ? COLORS.primary : (customColor ?? COLORS.badgeText);
		const icon = getBadgeIcon(label, position, color);
		const width = icon ? 18 : Math.max(18, label.length * 8 + 8);

		createSvgRect(
			new Vec2(position.x - width * 0.5, position.y - 9),
			new Vec2(width, 18),
			{
				rx: 3,
				fill: isSelected ? COLORS.selectedBg : COLORS.white,
				stroke: isSelected ? COLORS.primary : COLORS.badgeBorder,
				'stroke-width': STROKE_WIDTH.thin,
			},
			g
		);

		if (icon) {
			g.appendChild(icon);
		} else {
			createSvgText(
				new Vec2(position.x, position.y + 4),
				label,
				{
					'text-anchor': 'middle',
					fill: color,
					'font-size': 10,
					'font-weight': 700,
					'font-family': 'sans-serif',
				},
				g
			);
		}
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

		let labelPosition: number | undefined;
		if (cursor && orientation !== 'direct') {
			if (orientation === 'horizontal') {
				const dx = s2.x - s1.x;
				if (Math.abs(dx) > 1e-4) labelPosition = (cursor.x - s1.x) / dx;
			} else if (orientation === 'vertical') {
				const dy = s2.y - s1.y;
				if (Math.abs(dy) > 1e-4) labelPosition = (cursor.y - s1.y) / dy;
			} else {
				const dir = new Vec2().subVectors(s2, s1).normalizeOrNull(1e-4);
				if (dir) {
					const totalLen = s1.distanceTo(s2);
					if (totalLen > 1e-4) {
						labelPosition = new Vec2().subVectors(cursor, s1).dot(dir) / totalLen;
					}
				}
			}
		}

		const labelPrefix = orientation === 'horizontal' ? 'H: ' : orientation === 'vertical' ? 'V: ' : '';
		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: `${labelPrefix}${formatDimensionValue(distVal, 1)} mm`,
			extensionLines: geom.extensionLines,
			parent: this.previewGroup,
			isPreview: true,
			startPointHighlight: orientation === 'direct' ? s1 : undefined,
			targetPointSnapped: isTargetSnapped,
			labelPosition,
		});
	}

	renderDistanceLinePreview(s1: Vec2, s2: Vec2, distVal: number, isTargetSnapped = false): void {
		this.renderDistancePreview(s1, s2, undefined, distVal, 'direct', isTargetSnapped);
	}

	renderPointToLineDistancePreview(sp: Vec2, s1: Vec2, s2: Vec2, cursor?: Vec2, distVal = 0): void {
		this.previewGroup.innerHTML = '';
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, 0, cursor);
		if (!geom) return;

		this.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: `${formatDimensionValue(distVal, 1)} mm`,
			extensionLines: geom.extensionLines,
			parent: this.previewGroup,
			isPreview: true,
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

		const a1 = sCenter.angleToPoint(sRay1);
		const a2 = sCenter.angleToPoint(sRay2);

		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;

		const sweepFlag = delta > 0 ? 1 : 0;
		const rScreen = Math.max(28, sCenter.distanceTo(cursor));

		if (sp1 && sp2) {
			this.renderAngleExtensionLines(this.previewGroup, sCenter, a1, rScreen, sp1, sp2, COLORS.primary);
		}
		if (sp3 && sp4) {
			this.renderAngleExtensionLines(this.previewGroup, sCenter, a2, rScreen, sp3, sp4, COLORS.primary);
		}

		const a = Vec2.fromPolar(rScreen, a1).add(sCenter);
		const b = Vec2.fromPolar(rScreen, a2).add(sCenter);

		const midAngle = a1 + delta * 0.5;
		const midpoint = Vec2.fromPolar(rScreen, midAngle).add(sCenter);

		const arcLen = rScreen * Math.abs(delta);
		const arrowUrl = DIM_ARROWS.default;
		const lineAttrs: SvgAttrs = {
			fill: 'none',
			stroke: COLORS.primary,
			'stroke-width': STROKE_WIDTH.dimension,
		};

		if (arcLen >= 40) {
			createSvgPath(
				`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
				{
					...lineAttrs,
					'marker-start': arrowUrl,
					'marker-end': arrowUrl,
				},
				this.previewGroup
			);
		} else {
			// Flipped tangential arrows outside for sharp angles
			createSvgPath(
				`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
				lineAttrs,
				this.previewGroup
			);
			const uA = Vec2.fromPolar(1, a1);
			const tanA = uA.perpendicular().multiplyScalar(sweepFlag ? 1 : -1);
			createSvgLine(
				a.clone().addScaledVector(tanA, -DIMENSION_EXTERNAL_ARROW_TAIL_PX),
				a,
				{ stroke: COLORS.primary, 'stroke-width': STROKE_WIDTH.dimension, 'marker-end': arrowUrl },
				this.previewGroup
			);
			const uB = Vec2.fromPolar(1, a2);
			const tanB = uB.perpendicular().multiplyScalar(sweepFlag ? 1 : -1);
			createSvgLine(
				b.clone().addScaledVector(tanB, DIMENSION_EXTERNAL_ARROW_TAIL_PX),
				b,
				{ stroke: COLORS.primary, 'stroke-width': STROKE_WIDTH.dimension, 'marker-end': arrowUrl },
				this.previewGroup
			);
		}

		const labelText = `${formatDimensionValue(angleDeg, 1)}°`;
		if (arcLen < 26) {
			const uRad = Vec2.fromPolar(1, midAngle);
			const anchor = midpoint.clone().addScaledVector(uRad, 14);
			createSvgLine(
				midpoint,
				anchor,
				{ stroke: COLORS.primary, 'stroke-width': STROKE_WIDTH.dimension },
				this.previewGroup
			);
			const dirX = uRad.x >= 0 ? 1 : -1;
			const shelfLen = labelText.length * 7.5 + 10;
			const shelfEnd = new Vec2(anchor.x + dirX * shelfLen, anchor.y);
			createSvgLine(
				anchor,
				shelfEnd,
				{ stroke: COLORS.primary, 'stroke-width': STROKE_WIDTH.dimension },
				this.previewGroup
			);
			renderDimensionLabel(
				this.previewGroup,
				new Vec2(anchor.x + dirX * (shelfLen * 0.5), anchor.y - 8.5),
				labelText,
				COLORS.primary,
				'angle'
			);
		} else {
			const uRad = Vec2.fromPolar(1, midAngle);
			const textPos = midpoint.clone().addScaledVector(uRad, 8.5);
			const uTan = uRad.perpendicular();
			let textAngle = Math.atan2(uTan.y, uTan.x);
			if (textAngle > Math.PI / 2 - 1e-4) textAngle -= Math.PI;
			else if (textAngle <= -Math.PI / 2) textAngle += Math.PI;
			renderDimensionLabel(this.previewGroup, textPos, labelText, COLORS.primary, 'angle', {
				angleDeg: (textAngle * 180) / Math.PI,
			});
		}
	}

	renderSnapIndicator(
		s: Vec2,
		type: 'point' | 'line' | 'circle' | 'spline' | 'ellipse' | 'grid' = 'point',
		clearFirst = true
	): void {
		if (clearFirst) {
			this.overlayGroup.innerHTML = '';
		}

		if (type === 'line' || type === 'circle' || type === 'spline' || type === 'ellipse') {
			// Emerald diamond on object - enlarged so it clearly surrounds points
			const d = 7;
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
			const size = 5;
			createSvgRect(
				s.clone().subScalar(size),
				new Vec2(size * 2, size * 2),
				{
					...SNAP_GRID_ATTRS,
					rx: 1,
				},
				this.overlayGroup
			);
		} else {
			// Circular blue ring for point
			createSvgCircle(s, 7, SNAP_POINT_ATTRS, this.overlayGroup);
		}
	}

	renderDragLine(_s1: Vec2, _s2: Vec2): void {
		// Disabled: user requested not to display dashed displacement line or old ghost anchor dot
		this.overlayGroup.innerHTML = '';
	}

	renderSelectionBox(s1: Vec2, s2: Vec2): void {
		this.overlayGroup.innerHTML = '';
		const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
		const width = Math.abs(s2.x - s1.x);
		const height = Math.abs(s2.y - s1.y);

		const attrs = s2.x < s1.x ? CROSSING_SELECTION_BOX_ATTRS : SELECTION_BOX_ATTRS;
		createSvgRect(min, new Vec2(width, height), attrs, this.overlayGroup);
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

		const sA = viewport.worldToScreen(pA);
		const sB = viewport.worldToScreen(pB);

		const dir = new Vec2().subVectors(pB, pA);
		const lineLen = dir.length();
		if (lineLen < 1e-6) return;

		const normal = dir.clone().perpendicular().divideScalar(lineLen);

		// Highlight mirror line: bright gold/amber centerline
		createSvgLine(sA, sB, MIRROR_PREVIEW_LINE_ATTRS, this.mirrorGroup);

		if (selectedObjectIds.size === 0) return;

		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

		const reflectedPoints = new Set<string>();
		const drawReflectedVertex = (screenPt: { x: number; y: number }, key: string) => {
			if (reflectedPoints.has(key)) return;
			reflectedPoints.add(key);
			createSvgCircle(
				screenPt,
				3.5,
				{
					...MIRROR_PREVIEW_VERTEX_ATTRS,
					opacity: 0.5,
				},
				this.mirrorGroup
			);
		};

		const getAttrs = (isConstruction: boolean) => getCopyStrokeAttrs(isConstruction, baseColor, 0.5);

		for (const objId of selectedObjectIds) {
			if (objId === mirrorLineId) continue;

			// Line
			const l = sketch.lines.get(objId);
			if (l) {
				const pt1 = sketch.points.get(l.p1Id);
				const pt2 = sketch.points.get(l.p2Id);
				if (pt1 && pt2) {
					const r1 = pt1.clone().reflectAcrossLine(pA, normal);
					const r2 = pt2.clone().reflectAcrossLine(pA, normal);
					const sr1 = viewport.worldToScreen(r1);
					const sr2 = viewport.worldToScreen(r2);

					createSvgLine(sr1, sr2, getAttrs(!!l.isConstruction), this.mirrorGroup);

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
					const rc = center.clone().reflectAcrossLine(pA, normal);
					const src = viewport.worldToScreen(rc);
					const sr = c.radius * viewport.zoom;

					createSvgCircle(src, sr, getAttrs(!!c.isConstruction), this.mirrorGroup);

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
					const rc = center.clone().reflectAcrossLine(pA, normal);
					const rs = start.clone().reflectAcrossLine(pA, normal);
					const re = end.clone().reflectAcrossLine(pA, normal);
					const src = viewport.worldToScreen(rc);
					const srs = viewport.worldToScreen(rs);
					const sre = viewport.worldToScreen(re);
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
					const rc = center.clone().reflectAcrossLine(pA, normal);
					const rmaj = major.clone().reflectAcrossLine(pA, normal);
					const rmin = minor.clone().reflectAcrossLine(pA, normal);
					const src = viewport.worldToScreen(rc);
					const srmaj = viewport.worldToScreen(rmaj);
					const srmin = viewport.worldToScreen(rmin);
					const r = src.distancesTo(srmaj, srmin);
					const thetaDeg = src.angleToPointDeg(srmaj);

					createSvgEllipse(
						src,
						r,
						{
							transform: `rotate(${thetaDeg.toFixed(2)} ${src.x.toFixed(1)} ${src.y.toFixed(1)})`,
							...getAttrs(!!el.isConstruction),
						},
						this.mirrorGroup
					);

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
					const rc = center.clone().reflectAcrossLine(pA, normal);
					const rmaj = major.clone().reflectAcrossLine(pA, normal);
					const rmin = minor.clone().reflectAcrossLine(pA, normal);
					const rs = start.clone().reflectAcrossLine(pA, normal);
					const re = end.clone().reflectAcrossLine(pA, normal);
					const src = viewport.worldToScreen(rc);
					const srmaj = viewport.worldToScreen(rmaj);
					const srmin = viewport.worldToScreen(rmin);
					const srs = viewport.worldToScreen(rs);
					const sre = viewport.worldToScreen(re);
					const d = getEllipticalArcSvgPath(src, srmaj, srmin, srs, sre, !elArc.clockwise);

					createSvgPath(d, getAttrs(!!elArc.isConstruction), this.mirrorGroup);

					drawReflectedVertex(srs, `${Math.round(rs.x * 100)},${Math.round(rs.y * 100)}`);
					drawReflectedVertex(sre, `${Math.round(re.x * 100)},${Math.round(re.y * 100)}`);
					drawReflectedVertex(src, `${Math.round(rc.x * 100)},${Math.round(rc.y * 100)}`);
				}
				continue;
			}

			if (sketch.splines.has(objId)) {
				this.renderTransformedObjects(
					sketch,
					viewport,
					[objId],
					(x, y) => new Vec2(x, y).reflectAcrossLine(pA, normal),
					{
						targetGroup: this.mirrorGroup,
						baseColor,
						opacity: 0.5,
						drawVertices: true,
					}
				);
				continue;
			}

			// Standalone Point
			const pt = sketch.points.get(objId);
			if (pt) {
				const rp = pt.clone().reflectAcrossLine(pA, normal);
				const srp = viewport.worldToScreen(rp);
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
		suppressedIndices: Set<number>,
		angleHandleEnabled = false
	): void {
		this.patternGroup.innerHTML = '';
		if (!centerPointId) return;

		const centerPt = sketch.points.get(centerPointId);
		if (!centerPt) return;

		const sCtr = viewport.worldToScreen(centerPt);

		// Render center point marker: amber target crosshair & concentric ring
		createSvgCircle(sCtr, 12, PATTERN_CENTER_RING_ATTRS, this.patternGroup);

		createSvgLine(
			new Vec2(sCtr.x - 16, sCtr.y),
			new Vec2(sCtr.x + 16, sCtr.y),
			PATTERN_CENTER_CROSSHAIR_ATTRS,
			this.patternGroup
		);

		createSvgLine(
			new Vec2(sCtr.x, sCtr.y - 16),
			new Vec2(sCtr.x, sCtr.y + 16),
			PATTERN_CENTER_CROSSHAIR_ATTRS,
			this.patternGroup
		);

		createSvgCircle(sCtr, 4, PATTERN_CENTER_DOT_ATTRS, this.patternGroup);

		if (selectedObjectIds.size === 0) return;

		const N = Math.max(2, Math.round(quantity));
		const isFullyConstrained = sketch.lastSolverResult?.status === 'CONVERGED';
		const hasConflict = sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
		const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;
		let lastVisibleCopyIndex = N - 1;
		if (suppression) {
			while (lastVisibleCopyIndex > 0 && suppressedIndices.has(lastVisibleCopyIndex)) lastVisibleCopyIndex--;
		}

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
			const worldCentroid =
				copyWorldPoints.length > 0
					? Vec2.centroid(copyWorldPoints)
					: Vec2.fromPolar(40, (aDeg * Math.PI) / 180).add(centerPt);
			let copyCentroid = new Vec2(0, 0);
			if (copyWorldPoints.length > 0) {
				copyCentroid = viewport.worldToScreen(worldCentroid);
			} else {
				const rad = (aDeg * Math.PI) / 180;
				copyCentroid = Vec2.fromPolar(40, rad).add(sCtr);
			}

			// Register checkbox screen position for hit-testing
			this.patternCheckboxPositions.set(`tool-${k}`, {
				x: copyCentroid.x,
				y: copyCentroid.y,
				copyIndex: k,
			});

			// Render suppression checkbox over copy if suppression is enabled
			if (suppression) {
				this.renderPatternSuppressionCheckbox(copyCentroid, k, isSuppressed);
			}
			if (angleHandleEnabled && k === lastVisibleCopyIndex) {
				const dir = new Vec2().subVectors(copyCentroid, sCtr);
				const len = dir.length() || 1;
				// The arrow points back along the angle arc, toward the pattern center.
				const direction = angle < 0 ? -1 : 1;
				const dirVector = dir
					.clone()
					.perpendicular()
					.multiplyScalar(-direction / len);
				const tip = Vec2.from(copyCentroid).addScaledVector(dirVector, 30);
				const arrowLen = 16,
					arrowHalfWidth = 6.5;
				const base = tip.clone().addScaledVector(dirVector, -arrowLen);
				const perp = dirVector.clone().perpendicular();
				const arrowPath = `M ${tip.x} ${tip.y} L ${base.x + arrowHalfWidth * perp.x} ${base.y + arrowHalfWidth * perp.y} L ${base.x - arrowHalfWidth * perp.x} ${base.y - arrowHalfWidth * perp.y} Z`;
				createSvgLine(
					copyCentroid,
					base,
					{ stroke: COLORS.primary, 'stroke-width': 2, 'stroke-dasharray': '4 3' },
					this.patternGroup
				);
				createSvgPath(arrowPath, OFFSET_GIZMO_ARROW_ATTRS, this.patternGroup);
				this.patternAngleHandle = {
					x: base.x,
					y: base.y,
					worldX: worldCentroid.x,
					worldY: worldCentroid.y,
					copyIndex: k,
				};
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

		const centroidWorld = calculateObjectsCentroid(sketch, highlight.selectedObjectIds);
		if (!centroidWorld) return;

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
				const offset = computeRectangularPatternOffset(
					i,
					j,
					highlight.distance1,
					highlight.direction1,
					highlight.distance2,
					highlight.direction2,
					u1,
					u2
				);

				const copyWorldPoints = this.renderTransformedObjects(sketch, viewport, highlight.selectedObjectIds, offset, {
					targetGroup: this.patternGroup,
					baseColor,
					opacity: copyOpacity,
					isSuppressed,
					drawVertices: true,
					strokeWidth: STROKE_WIDTH.normal,
				});

				let copyCentroid: { x: number; y: number };
				if (copyWorldPoints.length > 0) {
					copyCentroid = viewport.worldToScreen(Vec2.centroid(copyWorldPoints));
				} else {
					copyCentroid = viewport.worldToScreen(centroidWorld.clone().add(offset));
				}

				this.patternCheckboxPositions.set(`tool-${copyIndex}`, {
					x: copyCentroid.x,
					y: copyCentroid.y,
					copyIndex,
				});

				if (highlight.suppression) {
					this.renderPatternSuppressionCheckbox(copyCentroid, copyIndex, isSuppressed);
				}
			}
		}

		this.renderRectangularPatternGizmos(viewport, centroidWorld, u1, u2, highlight.distance1, highlight.distance2, {
			targetGroup: this.patternGroup,
		});
	}

	renderFilletPreviews(
		_sketch: SketchDocument,
		viewport: Viewport,
		state: NonNullable<RenderOptions['filletState']>
	): void {
		// 1. Highlight selected first primitive if any

		// 3. Render all pending fillets
		for (const pf of state.pendingFillets) {
			const res = pf.result;
			if (!res) continue;

			const sV = viewport.worldToScreen(res.cornerVertex);
			const sT1 = viewport.worldToScreen(res.t1);
			const sT2 = viewport.worldToScreen(res.t2);
			const sCenter = viewport.worldToScreen(res.center);
			const sMid = viewport.worldToScreen(res.midArc);
			const sRadius = res.radius * viewport.zoom;

			// Shaded corner wedge
			const sweepWedgeFlag = res.clockwise ? 0 : 1;
			const wedgePath = `M ${sT1.x} ${sT1.y} L ${sV.x} ${sV.y} L ${sT2.x} ${sT2.y} A ${sRadius.toFixed(2)} ${sRadius.toFixed(2)} 0 0 ${sweepWedgeFlag} ${sT1.x} ${sT1.y} Z`;
			createSvgPath(wedgePath, FILLET_WEDGE_ATTRS, this.filletGroup);

			// Fillet arc
			const arcD = getArcSvgPath(sCenter, sT1, sT2, sRadius, res.clockwise);
			createSvgPath(arcD, FILLET_ARC_ATTRS, this.filletGroup);

			// Check if this fillet is active for Gizmo
			const isActive =
				pf.id === state.activeFilletId ||
				(!state.activeFilletId && pf === state.pendingFillets[state.pendingFillets.length - 1]);
			if (isActive) {
				// Center circle handle
				createSvgCircle(sCenter, 4, GIZMO_POINT_ATTRS, this.filletGroup);

				// Radial dashed line extending outward from center through midArc
				const uDir = new Vec2().subVectors(sMid, sCenter).divideScalar(sCenter.distanceTo(sMid) || 1);
				const lineLen = sRadius + 45;
				const lineEnd = sCenter.clone().addScaledVector(uDir, lineLen);

				createSvgLine(sCenter, lineEnd, FILLET_GIZMO_RADIAL_ATTRS, this.filletGroup);

				// Small square at tip
				const sqSize = 6;
				createSvgRect(
					new Vec2(lineEnd.x - sqSize * 0.5, lineEnd.y - sqSize * 0.5),
					new Vec2(sqSize, sqSize),
					FILLET_GIZMO_SQUARE_ATTRS,
					this.filletGroup
				);

				// Inward arrow gizmo at sMid pointing towards sCenter
				const arrowDir = uDir.clone().negate();
				const perp = arrowDir.clone().perpendicular();

				const arrowLen = 18;
				const arrowHalfWidth = 7.5;
				const tip = sMid;
				const baseCenter = tip.clone().addScaledVector(arrowDir, -arrowLen);
				const b1 = baseCenter.clone().addScaledVector(perp, arrowHalfWidth);
				const b2 = baseCenter.clone().addScaledVector(perp, -arrowHalfWidth);

				const arrowPath = `M ${tip.x} ${tip.y} L ${b1.x} ${b1.y} L ${b2.x} ${b2.y} Z`;
				createSvgPath(arrowPath, FILLET_GIZMO_ARROW_ATTRS, this.filletGroup);

				this.filletGizmoHandle = {
					screenX: tip.x,
					screenY: tip.y,
					worldMidArc: res.midArc,
					worldBisectorDir: res.bisectorDir,
					radius: res.radius,
				};
			}
		}
	}

	renderChamferPreviews(viewport: Viewport, state: NonNullable<RenderOptions['chamferState']>): void {
		// 1. Render candidate preview and gizmos
		const cand = state.candidate;
		if (!cand || !cand.result) return;
		const res = cand.result;

		const sV = viewport.worldToScreen(cand.vertexPos);
		const sT1 = viewport.worldToScreen(res.t1);
		const sT2 = viewport.worldToScreen(res.t2);

		// Cut lines from T1 to V and T2 to V
		createSvgLine(sT1, sV, CHAMFER_CUT_LINE_ATTRS, this.chamferGroup);
		createSvgLine(sT2, sV, CHAMFER_CUT_LINE_ATTRS, this.chamferGroup);

		// Vertex V point
		createSvgCircle(sV, 3.5, GIZMO_POINT_ATTRS, this.chamferGroup);

		// Chamfer line
		createSvgLine(sT1, sT2, CHAMFER_HIGHLIGHT_ATTRS, this.chamferGroup);

		// Cut points T1 and T2
		createSvgCircle(sT1, 3, GIZMO_POINT_ATTRS, this.chamferGroup);
		createSvgCircle(sT2, 3, GIZMO_POINT_ATTRS, this.chamferGroup);

		// Helper to draw an arrow head
		const drawArrow = (tip: Vec2, dir: Vec2) => {
			const arrowLen = 16;
			const arrowHalfWidth = 6.5;
			const perp = dir.clone().perpendicular();
			const baseCenter = tip.clone().addScaledVector(dir, -arrowLen);
			const b1 = baseCenter.clone().addScaledVector(perp, arrowHalfWidth);
			const b2 = baseCenter.clone().addScaledVector(perp, -arrowHalfWidth);
			const arrowPath = `M ${tip.x} ${tip.y} L ${b1.x} ${b1.y} L ${b2.x} ${b2.y} Z`;
			createSvgPath(arrowPath, CHAMFER_GIZMO_ARROW_ATTRS, this.chamferGroup);
		};

		// Unit screen directions for line 1 and line 2 (pointing away from V)
		const screenScale = new Vec2(viewport.zoom, -viewport.zoom);
		const uSDir1 = cand.dir1.clone().multiply(screenScale).normalize();
		const uSDir2 = cand.dir2.clone().multiply(screenScale).normalize();

		if (state.mode === 'equal_distance') {
			// Mode 1: 1 arrow gizmo along the angle bisector, shifted back so tip points at chamfer midpoint
			const sMid = new Vec2().midpoint(sT1, sT2);
			const vBis = new Vec2().subVectors(sMid, sV);
			const lenBis = vBis.length() || 1;
			const uSBis = vBis.clone().multiplyScalar(1.0 / lenBis);

			// Arrow tip points towards sMid
			const tip = Vec2.from(sMid).addScaledVector(uSBis, -2);
			drawArrow(tip, uSBis);

			// Dashed guide line from vertex V to the base of the arrow along bisector
			const baseCenter = tip.clone().addScaledVector(uSBis, -16);
			if (sV.distanceTo(baseCenter) > 4) {
				createSvgLine(sV, baseCenter, GIZMO_GUIDE_ATTRS, this.chamferGroup);
			}

			const bisectorWorld = new Vec2().addVectors(cand.dir1, cand.dir2).normalizeOrUnitX();

			this.chamferGizmoHandles.push({
				type: 'dist1',
				screenX: tip.x - uSBis.x * 8,
				screenY: tip.y - uSBis.y * 8,
				worldPos: res.midPoint,
				dir: bisectorWorld,
				currentValue: res.dist1,
			});
		} else if (state.mode === 'two_distance') {
			// Mode 2: 2 arrow gizmos shifted back so their tips point directly at T1 and T2
			const tip1 = sT1.clone().addScaledVector(uSDir1, -3.5);
			drawArrow(tip1, uSDir1);
			this.chamferGizmoHandles.push({
				type: 'dist1',
				screenX: tip1.x - uSDir1.x * 8,
				screenY: tip1.y - uSDir1.y * 8,
				worldPos: res.t1,
				dir: cand.dir1,
				currentValue: res.dist1,
			});

			const tip2 = sT2.clone().addScaledVector(uSDir2, -3.5);
			drawArrow(tip2, uSDir2);
			this.chamferGizmoHandles.push({
				type: 'dist2',
				screenX: tip2.x - uSDir2.x * 8,
				screenY: tip2.y - uSDir2.y * 8,
				worldPos: res.t2,
				dir: cand.dir2,
				currentValue: res.dist2,
			});
		} else if (state.mode === 'distance_angle') {
			// Mode 3: 1 distance arrow on reference line + 1 angle circle at 100px from reference vertex
			if (!state.flip) {
				// Reference line is line 1 (vertex A = T1)
				const tip1 = sT1.clone().addScaledVector(uSDir1, -3.5);
				drawArrow(tip1, uSDir1);
				this.chamferGizmoHandles.push({
					type: 'dist1',
					screenX: tip1.x - uSDir1.x * 8,
					screenY: tip1.y - uSDir1.y * 8,
					worldPos: res.t1,
					dir: cand.dir1,
					currentValue: res.dist1,
				});

				// Direction along chamfer line from T1 to T2
				const vChamfer = new Vec2().subVectors(sT2, sT1);
				const lenChamfer = vChamfer.length() || 1;
				const uSChamfer = vChamfer.clone().multiplyScalar(1.0 / lenChamfer);

				// Circle handle at exactly 100px from point A (T1)
				const circle = sT1.clone().addScaledVector(uSChamfer, 100);

				// Guide line along the angle ray to the circle handle
				createSvgLine(sT1, circle, GIZMO_GUIDE_ATTRS, this.chamferGroup);

				// Visual arc showing the angle at T1 between ray towards V and ray towards T2 at 100px
				const vV = new Vec2().subVectors(sV, sT1);
				const lenV = vV.length();
				if (lenV > 1e-4) {
					const angV = vV.signedAngle();
					const angChamfer = uSChamfer.signedAngle();
					let diff = angChamfer - angV;
					while (diff > Math.PI) diff -= 2 * Math.PI;
					while (diff < -Math.PI) diff += 2 * Math.PI;

					const arcR = 100;
					const start = Vec2.fromPolar(arcR, angV).add(sT1);
					const end = circle;

					// Guide line along reference arm towards V out to 100px
					createSvgLine(sT1, start, GIZMO_GUIDE_ATTRS, this.chamferGroup);

					if (Math.abs(diff) > 1e-3) {
						const sweepFlag = diff > 0 ? 1 : 0;
						const arcD = `M ${start.x} ${start.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${end.x} ${end.y}`;
						createSvgPath(arcD, GIZMO_GUIDE_ATTRS, this.chamferGroup);
					}
				}

				// Angle adjustment circle handle (100px from A)
				createSvgCircle(circle, 6, CHAMFER_GIZMO_CIRCLE_ATTRS, this.chamferGroup);
				this.chamferGizmoHandles.push({
					type: 'angle',
					screenX: circle.x,
					screenY: circle.y,
					worldPos: res.t1,
					currentValue: res.angleDeg,
				});
			} else {
				// Reference line is line 2 (flipped: reference vertex is B = T2)
				const tip2 = sT2.clone().addScaledVector(uSDir2, -3.5);
				drawArrow(tip2, uSDir2);
				this.chamferGizmoHandles.push({
					type: 'dist2',
					screenX: tip2.x - uSDir2.x * 8,
					screenY: tip2.y - uSDir2.y * 8,
					worldPos: res.t2,
					dir: cand.dir2,
					currentValue: res.dist2,
				});

				// Direction along chamfer line from T2 to T1
				const vChamfer = new Vec2().subVectors(sT1, sT2);
				const lenChamfer = vChamfer.length() || 1;
				const uSChamfer = vChamfer.clone().multiplyScalar(1.0 / lenChamfer);

				// Circle handle at exactly 100px from point B (T2)
				const circle = sT2.clone().addScaledVector(uSChamfer, 100);

				// Guide line along the angle ray to the circle handle
				createSvgLine(sT2, circle, GIZMO_GUIDE_ATTRS, this.chamferGroup);

				// Visual arc showing the angle at T2 between ray towards V and ray towards T1 at 100px
				const vV = new Vec2().subVectors(sV, sT2);
				const lenV = vV.length();
				if (lenV > 1e-4) {
					const angV = vV.signedAngle();
					const angChamfer = uSChamfer.signedAngle();
					let diff = angChamfer - angV;
					while (diff > Math.PI) diff -= 2 * Math.PI;
					while (diff < -Math.PI) diff += 2 * Math.PI;

					const arcR = 100;
					const start = Vec2.fromPolar(arcR, angV).add(sT2);
					const end = circle;

					// Guide line along reference arm towards V out to 100px
					createSvgLine(sT2, start, GIZMO_GUIDE_ATTRS, this.chamferGroup);

					if (Math.abs(diff) > 1e-3) {
						const sweepFlag = diff > 0 ? 1 : 0;
						const arcD = `M ${start.x} ${start.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${end.x} ${end.y}`;
						createSvgPath(arcD, GIZMO_GUIDE_ATTRS, this.chamferGroup);
					}
				}

				// Angle adjustment circle handle (100px from B)
				createSvgCircle(circle, 6, CHAMFER_GIZMO_CIRCLE_ATTRS, this.chamferGroup);
				this.chamferGizmoHandles.push({
					type: 'angle',
					screenX: circle.x,
					screenY: circle.y,
					worldPos: res.t2,
					currentValue: res.angleDeg,
				});
			}
		}
	}

	renderOffsetPreviews(
		sketch: SketchDocument,
		viewport: Viewport,
		state: NonNullable<RenderOptions['offsetState']>
	): void {
		const { chain, geomResult, direction, dist1, dist2, flip } = state;
		if (!chain || !geomResult) return;

		// 1. Highlight the selected chain primitives
		for (const it of chain.items) {
			if (it.type === 'line') {
				const l = sketch.lines.get(it.id);
				if (l) {
					const p1 = sketch.points.get(l.p1Id);
					const p2 = sketch.points.get(l.p2Id);
					if (p1 && p2) {
						const s1 = viewport.worldToScreen(p1);
						const s2 = viewport.worldToScreen(p2);
						createSvgLine(s1, s2, OFFSET_CHAIN_ATTRS, this.offsetGroup);
					}
				}
			} else if (it.type === 'circle') {
				const c = sketch.circles.get(it.id);
				if (c) {
					const center = sketch.points.get(c.centerId);
					if (center) {
						const sc = viewport.worldToScreen(center);
						createSvgCircle(sc, c.radius * viewport.zoom, OFFSET_CHAIN_ATTRS, this.offsetGroup);
					}
				}
			} else if (it.type === 'arc') {
				const a = sketch.arcs.get(it.id);
				if (a) {
					const center = sketch.points.get(a.centerId);
					const start = sketch.points.get(a.startPointId);
					const end = sketch.points.get(a.endPointId);
					if (center && start && end) {
						const sc = viewport.worldToScreen(center);
						const ss = viewport.worldToScreen(start);
						const se = viewport.worldToScreen(end);
						const d = getArcSvgPath(sc, ss, se, a.radius * viewport.zoom, !!a.clockwise);
						createSvgPath(d, OFFSET_CHAIN_ATTRS, this.offsetGroup);
					}
				}
			} else if (it.type === 'ellipse') {
				const el = sketch.ellipses.get(it.id);
				if (el) {
					const center = sketch.points.get(el.centerId);
					const maj = sketch.points.get(el.majorAxisPointId);
					const min = sketch.points.get(el.minorAxisPointId);
					if (center && maj && min) {
						const sc = viewport.worldToScreen(center);
						const r = center.distancesTo(maj, min).clone().multiplyScalar(viewport.zoom);
						const thetaDeg = center.angleToPointDeg(maj);
						createSvgEllipse(
							sc,
							r,
							{
								transform: `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`,
								...OFFSET_CHAIN_ATTRS,
							},
							this.offsetGroup
						);
					}
				}
			} else if (it.type === 'elliptical_arc') {
				const ea = sketch.ellipticalArcs.get(it.id);
				if (ea) {
					const center = sketch.points.get(ea.centerId);
					const maj = sketch.points.get(ea.majorAxisPointId);
					const min = sketch.points.get(ea.minorAxisPointId);
					const start = sketch.points.get(ea.startPointId);
					const end = sketch.points.get(ea.endPointId);
					if (center && maj && min && start && end) {
						const sc = viewport.worldToScreen(center);
						const smaj = viewport.worldToScreen(maj);
						const smin = viewport.worldToScreen(min);
						const ss = viewport.worldToScreen(start);
						const se = viewport.worldToScreen(end);
						const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, !!ea.clockwise);
						createSvgPath(d, OFFSET_CHAIN_ATTRS, this.offsetGroup);
					}
				}
			} else if (it.type === 'spline') {
				const s = sketch.splines.get(it.id);
				if (s) {
					const geo = s.toGeoCurve(sketch);
					if (geo && geo.bezierSegments.length > 0) {
						const d = getSplineSvgPath(geo.bezierSegments, p => viewport.worldToScreen(p), !!s.isClosed);
						createSvgPath(d, OFFSET_CHAIN_ATTRS, this.offsetGroup);
					}
				}
			}
		}

		// 2. Render computed offset curves for each side
		for (const side of geomResult.sides) {
			for (const prim of side.primitives) {
				if (prim.type === 'line' && prim.p1 && prim.p2) {
					const s1 = viewport.worldToScreen(prim.p1);
					const s2 = viewport.worldToScreen(prim.p2);
					createSvgLine(s1, s2, OFFSET_PREVIEW_ATTRS, this.offsetGroup);
				} else if (prim.type === 'circle' && prim.circleCenter && prim.circleRadius) {
					const sc = viewport.worldToScreen(prim.circleCenter);
					createSvgCircle(sc, prim.circleRadius * viewport.zoom, OFFSET_PREVIEW_ATTRS, this.offsetGroup);
				} else if (prim.type === 'arc' && prim.center && prim.start && prim.end && prim.radius) {
					const sc = viewport.worldToScreen(prim.center);
					const ss = viewport.worldToScreen(prim.start);
					const se = viewport.worldToScreen(prim.end);
					const d = getArcSvgPath(sc, ss, se, prim.radius * viewport.zoom, !!prim.clockwise);
					createSvgPath(d, OFFSET_PREVIEW_ATTRS, this.offsetGroup);
				} else if (prim.type === 'spline' && prim.fitPoints && prim.fitPoints.length >= 2) {
					const beziers = fitPointsToBezier(prim.fitPoints, prim.handles);
					const d = getSplineSvgPath(beziers, p => viewport.worldToScreen(p), !!prim.isSplineClosed);
					createSvgPath(d, OFFSET_PREVIEW_ATTRS, this.offsetGroup);
				}
			}
		}

		// 3. Helper to draw arrow
		const drawArrow = (tip: Vec2, dir: Vec2) => {
			const arrowLen = 16;
			const arrowHalfWidth = 6.5;
			const perp = dir.clone().perpendicular();
			const baseCenter = tip.clone().addScaledVector(dir, -arrowLen);
			const b1 = baseCenter.clone().addScaledVector(perp, arrowHalfWidth);
			const b2 = baseCenter.clone().addScaledVector(perp, -arrowHalfWidth);
			const arrowPath = `M ${tip.x} ${tip.y} L ${b1.x} ${b1.y} L ${b2.x} ${b2.y} Z`;
			createSvgPath(arrowPath, OFFSET_GIZMO_ARROW_ATTRS, this.offsetGroup);
		};

		// 4. Render gizmo arrow(s) at gizmoAnchor along gizmoNormal
		const anchor = geomResult.gizmoAnchor;
		const norm = geomResult.gizmoNormal;
		const sAnchor = viewport.worldToScreen(anchor);

		const renderGizmoArrowForSide = (type: 'dist1' | 'dist2', offsetVal: number, sign: number) => {
			const targetWorld = anchor.clone().addScaledVector(norm, sign * offsetVal);
			const sTarget = viewport.worldToScreen(targetWorld);

			// Screen direction from anchor to target
			const vDir = new Vec2().subVectors(sTarget, sAnchor);
			const lenDir = vDir.length() || 1;
			const uDir = vDir.clone().multiplyScalar(1.0 / lenDir);

			// Dashed guide line from anchor to target
			createSvgLine(sAnchor, sTarget, GIZMO_GUIDE_ATTRS, this.offsetGroup);

			// Tip points towards sTarget
			const tip = sTarget;
			drawArrow(tip, uDir);

			this.offsetGizmoHandles.push({
				type,
				screenX: tip.x - uDir.x * 8,
				screenY: tip.y - uDir.y * 8,
				worldPos: targetWorld,
				normal: norm.clone().multiplyScalar(sign),
				currentValue: offsetVal,
			});
		};

		if (direction === 'one_side') {
			const sign = flip ? -1 : 1;
			renderGizmoArrowForSide('dist1', dist1, sign);
		} else if (direction === 'two_sides') {
			const sign1 = !flip ? 1 : -1;
			const sign2 = !flip ? -1 : 1;
			renderGizmoArrowForSide('dist1', dist1, sign1);
			renderGizmoArrowForSide('dist2', dist2, sign2);
		} else if (direction === 'symmetric') {
			renderGizmoArrowForSide('dist1', dist1, 1);
			renderGizmoArrowForSide('dist1', dist1, -1);
		}
	}

	clearPreviews(): void {
		this.previewGroup.innerHTML = '';
		this.overlayGroup.innerHTML = '';
	}
}

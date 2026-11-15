import type { SvgExportDimensions } from '../model/io/svgIO';
import { AABB } from '../math/aabb';
import type { SketchImage } from '../model/image';
import { createTransform, type TransformValues } from '../model/transform';
import { calculateObjectsCentroid } from './tools/modify/utils';
import type { SketchDocument } from '../model/sketch';
import { isPointIdConstrained, type ISketchPrimitive } from '../model/primitives';
import type { Viewport } from './viewport';
import { getAllGeoCurves } from '../math/intersection';
import { findCurveRegions, pointInRegion, type SketchRegion } from '../math/regions';
import type { FilletCandidate } from '../math/fillet';
import { collectFilletPreviewTrims } from '../math/filletPreview';
import {
	computePatternCopyAngle,
	computeRectangularPatternOffset,
	computeRectangularPatternDirections,
	getPatternBaseColor,
	renderPatternSuppressionCheckbox,
	type ConstraintRenderContext,
} from '../solver/constraints';
import { ORIGIN, Vec2 } from '../math/vector';
import { renderConstraintBadge, renderBadgeOnSegment, renderBadgeOnCircle } from './badgeIcons';
import { fitPointsToBezier, getSplineSvgPath } from '../math/spline';

export * from './styles';
export * from './svg';
export * from './dimensionGeometry';
export { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';

import {
	createSvgElement,
	createSvgLine,
	createSvgCircle,
	createSvgRect,
	createSvgPath,
	createSvgArrow,
	createSvgText,
	getArcSvgPath,
} from './svg';
import {
	formatDimensionValue,
	computeDistanceDimensionGeometry,
	computePointToLineDimensionGeometry,
	renderLinearDimensionVisual,
	renderAngleDimensionVisual,
} from './dimensionGeometry';
import {
	COLORS,
	REGION_STYLE,
	DASH_ARRAY,
	STROKE_WIDTH,
	SVG_EXPORT_STYLE,
	FILTERS,
	type SvgAttrs,
	HIT_AREA_STROKE_ATTRS,
	SELECTION_BOX_ATTRS,
	CROSSING_SELECTION_BOX_ATTRS,
	MIRROR_PREVIEW_LINE_ATTRS,
	MIRROR_PREVIEW_VERTEX_ATTRS,
	PATTERN_CENTER_RING_ATTRS,
	PATTERN_CENTER_CROSSHAIR_ATTRS,
	PATTERN_CENTER_DOT_ATTRS,
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
	getCopyStrokeAttrs,
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
					markerWidth: '12',
					markerHeight: '8',
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

	private isPrimitiveSelected(prim: ISketchPrimitive, sketch: SketchDocument, options: RenderOptions): boolean {
		const sel = sketch.selection;
		const inSelection =
			(prim.type === 'line' && sel.lineIds.has(prim.id)) ||
			(prim.type === 'circle' && sel.circleIds.has(prim.id)) ||
			(prim.type === 'arc' && sel.arcIds.has(prim.id)) ||
			(prim.type === 'ellipse' && sel.ellipseIds.has(prim.id)) ||
			(prim.type === 'elliptical_arc' && sel.ellipticalArcIds.has(prim.id)) ||
			(prim.type === 'spline' && sel.splineIds.has(prim.id)) ||
			(prim.type === 'point' && sel.pointIds.has(prim.id));
		return (
			inSelection ||
			!!options.mirrorHighlight?.selectedObjectIds.has(prim.id) ||
			!!options.patternHighlight?.selectedObjectIds.has(prim.id) ||
			!!options.rectangularPatternHighlight?.selectedObjectIds.has(prim.id) ||
			(options.filletState?.selectedPrimitive1?.type === prim.type &&
				options.filletState.selectedPrimitive1.id === prim.id) ||
			(prim.type === 'line' && options.chamferState?.firstLine?.id === prim.id) ||
			(prim.type === 'point' && options.patternHighlight?.centerPointId === prim.id)
		);
	}

	private renderGeometry(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}): void {
		this.geometryGroup.innerHTML = '';
		this.pointGroup.innerHTML = '';

		const { constrainedParams, status } = sketch.lastSolverResult ?? {};
		const hasConflict = status === 'OVER_CONSTRAINED';
		const isPointConstrained = (id: string) => isPointIdConstrained(id, constrainedParams);
		const getBaseColor = (isConstrained: boolean) =>
			hasConflict ? COLORS.conflict : isConstrained ? COLORS.constrained : COLORS.unconstrained;

		// Determine which splines have any part active (spline curve, fit points, or tangent handles/endpoints)
		const activeSplineIds = new Set<string>(sketch.selection.splineIds);
		const splinePointInfo = new Map<string, { splineId: string; isHandleDot: boolean }>();
		for (const spline of sketch.splines.values()) {
			if (spline.pointIds.some(pid => sketch.selection.pointIds.has(pid))) {
				activeSplineIds.add(spline.id);
			}
			if (spline.splineType === 'control') {
				for (let i = 1; i < spline.pointIds.length - 1; i++) {
					splinePointInfo.set(spline.pointIds[i], { splineId: spline.id, isHandleDot: false });
				}
			}
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const l = sketch.lines.get(lid);
					if (
						sketch.selection.lineIds.has(lid) ||
						(l && (sketch.selection.pointIds.has(l.p1Id) || sketch.selection.pointIds.has(l.p2Id)))
					) {
						activeSplineIds.add(spline.id);
					}
					if (l && spline.splineType !== 'control') {
						splinePointInfo.set(l.p1Id, { splineId: spline.id, isHandleDot: true });
						splinePointInfo.set(l.p2Id, { splineId: spline.id, isHandleDot: true });
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

		const splineTangentGroups: SVGGElement[] = [];
		const baseCtx = {
			sketch,
			viewport,
			geometryGroup: this.geometryGroup,
			pointGroup: this.pointGroup,
			options,
			hasConflict,
			isPointConstrained,
			activeSplineIds,
			lineCuts,
			filletTrims,
			splinePointInfo,
			deferTangentGroup: (group: SVGGElement) => splineTangentGroups.push(group),
		};

		for (const primitive of sketch.getCurvePrimitives()) {
			if (options.hiddenEntityIds?.has(primitive.id)) continue;
			primitive.render({
				...baseCtx,
				isSelected: this.isPrimitiveSelected(primitive, sketch, options),
				baseColor: getBaseColor(primitive.isConstrained(sketch, constrainedParams)),
			});
		}

		// Paint tangent handles above the spline paths.
		for (const group of splineTangentGroups) this.geometryGroup.appendChild(group);

		for (const pt of sketch.points.values()) {
			if (options.hiddenEntityIds?.has(pt.id)) continue;
			pt.render({
				...baseCtx,
				isSelected: this.isPrimitiveSelected(pt, sketch, options),
				baseColor: getBaseColor(pt.isConstrained(sketch, constrainedParams)),
			});
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
			const gizmos = text.render({
				sketch,
				viewport,
				targetGroup: preview?.target ?? this.textGroup,
				isSelected,
				color,
				showGizmos: isSelected && !options.hideTextGizmos && !preview,
			});
			if (gizmos.rotationGizmo) this.textRotationGizmo = gizmos.rotationGizmo;
			if (gizmos.dragGizmo) this.textDragGizmo = gizmos.dragGizmo;
		}
	}

	exportDimensions(
		sketch: SketchDocument,
		viewport: Viewport,
		strokeWidth: number = SVG_EXPORT_STYLE.strokeWidth
	): SvgExportDimensions | undefined {
		const group = createSvgElement('g', { visibility: 'hidden' }, this.svg);
		try {
			this.renderConstraints(sketch, viewport, {}, group, true);
			if (!group.children.length) return undefined;
			group.querySelectorAll('text').forEach(text => {
				text.textContent = text.textContent?.replace(/^fx:\s*/, '') ?? '';
			});
			group.querySelectorAll('[stroke-width]').forEach(element => {
				element.setAttribute('stroke-width', String((strokeWidth / 2) * viewport.zoom));
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
				renderConstraintBadge(
					this.constraintGroup,
					id,
					position,
					label,
					ctx.isSelected,
					this.constraintBadgesVisible,
					color
				);
			},
			renderBadgeOnSegment: (id, p1Id, p2Id, label) => {
				renderBadgeOnSegment(
					this.constraintGroup,
					id,
					p1Id,
					p2Id,
					sketch,
					viewport,
					label,
					ctx.isSelected,
					this.constraintBadgesVisible,
					lineBadgeCounts
				);
			},
			renderBadgeOnCircle: (id, circleId, label) => {
				renderBadgeOnCircle(
					this.constraintGroup,
					id,
					circleId,
					sketch,
					viewport,
					label,
					ctx.isSelected,
					this.constraintBadgesVisible
				);
			},
			renderLinearDimensionVisual,
			patternCheckboxGroup: this.patternCheckboxGroup,
			patternCheckboxPositions: this.patternCheckboxPositions,
			rectangularGizmoHandles: this.rectangularGizmoHandles,
			renderTransformedObjects: (objectIds, transform, options) => {
				return this.renderTransformedObjects(sketch, viewport, objectIds, transform, options);
			},
			renderRectangularPatternGizmos: (v, centroidWorld, u1, u2, distance1, distance2, options) => {
				this.renderRectangularPatternGizmos(v, centroidWorld, u1, u2, distance1, distance2, options);
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
			createSvgArrow(
				tip,
				arrowDir,
				arrowLen,
				arrowHalfWidth,
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
				const maxY = Math.max(from.y, tip.y, baseCenter.y + Math.abs(perp.y) * arrowHalfWidth);
				pillX = midX;
				pillY = maxY + 16;
			} else {
				// Vertical arrow -> place label to the right of the arrow
				const midY = tip.y - arrowLen * 0.5 * arrowDir.y;
				const maxX = Math.max(from.x, tip.x, baseCenter.x + Math.abs(perp.x) * arrowHalfWidth);
				pillX = maxX + 10 + pillWidth * 0.5;
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
			invertWinding?: boolean;
			vertexRadius?: number;
			vertexAttrs?: SvgAttrs;
			deduplicateVertices?: boolean;
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
		const targetGroup = options.skipRender ? undefined : options.targetGroup;
		const opacity = options.opacity ?? 1.0;
		const baseColor = options.baseColor ?? COLORS.unconstrained;
		const strokeWidth = options.strokeWidth ?? STROKE_WIDTH.normal;
		const seenVertices = options.deduplicateVertices ? new Set<string>() : null;

		const drawVertex = (screenPt: Vec2, worldPt: { x: number; y: number }) => {
			if (!options.drawVertices || !targetGroup) return;
			if (seenVertices) {
				const key = `${Math.round(worldPt.x * 100)},${Math.round(worldPt.y * 100)}`;
				if (seenVertices.has(key)) return;
				seenVertices.add(key);
			}
			createSvgCircle(
				screenPt,
				options.vertexRadius ?? 3,
				options.vertexAttrs ?? {
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
			const prim = sketch.getPrimitive(objId);
			if (!prim) continue;
			const pts = prim.renderTransformed({
				sketch,
				viewport,
				transformPoint,
				targetGroup,
				strokeAttrs: targetGroup ? getAttrs(!!prim.isConstruction) : undefined,
				transformScale: options.transformScale,
				invertWinding: options.invertWinding,
				drawVertex,
			});
			copyWorldPoints.push(...pts);
		}

		return copyWorldPoints;
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
		renderLinearDimensionVisual({
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

		renderLinearDimensionVisual({
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

		const rScreen = Math.max(28, sCenter.distanceTo(cursor));
		const extensionLines: Array<{ angle: number; pA: Vec2; pB: Vec2 }> = [];
		if (sp1 && sp2) extensionLines.push({ angle: a1, pA: sp1, pB: sp2 });
		if (sp3 && sp4) extensionLines.push({ angle: a2, pA: sp3, pB: sp4 });

		renderAngleDimensionVisual({
			parent: this.previewGroup,
			sCenter,
			a1,
			a2,
			delta,
			rScreen,
			label: `${formatDimensionValue(angleDeg, 1)}°`,
			extensionLines,
		});
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

		const baseColor = getPatternBaseColor(sketch);
		const idsToMirror = [...selectedObjectIds].filter(id => id !== mirrorLineId);
		this.renderTransformedObjects(
			sketch,
			viewport,
			idsToMirror,
			(x, y) => new Vec2(x, y).reflectAcrossLine(pA, normal),
			{
				targetGroup: this.mirrorGroup,
				baseColor,
				opacity: 0.5,
				drawVertices: true,
				invertWinding: true,
				vertexRadius: 3.5,
				vertexAttrs: {
					...MIRROR_PREVIEW_VERTEX_ATTRS,
					opacity: 0.5,
				},
				deduplicateVertices: true,
			}
		);
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
		const baseColor = getPatternBaseColor(sketch);
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
			const copyCentroid =
				copyWorldPoints.length > 0
					? viewport.worldToScreen(worldCentroid)
					: Vec2.fromPolar(40, (aDeg * Math.PI) / 180).add(sCtr);

			// Register checkbox screen position for hit-testing
			this.patternCheckboxPositions.set(`tool-${k}`, {
				x: copyCentroid.x,
				y: copyCentroid.y,
				copyIndex: k,
			});

			// Render suppression checkbox over copy if suppression is enabled
			if (suppression) {
				renderPatternSuppressionCheckbox(this.patternCheckboxGroup, copyCentroid, k, isSuppressed);
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
				const arrowLen = 16;
				const base = tip.clone().addScaledVector(dirVector, -arrowLen);
				createSvgLine(
					copyCentroid,
					base,
					{ stroke: COLORS.primary, 'stroke-width': 2, 'stroke-dasharray': '4 3' },
					this.patternGroup
				);
				createSvgArrow(tip, dirVector, arrowLen, 6.5, OFFSET_GIZMO_ARROW_ATTRS, this.patternGroup);
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
		const baseColor = getPatternBaseColor(sketch);

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

				const copyCentroid = viewport.worldToScreen(
					copyWorldPoints.length > 0 ? Vec2.centroid(copyWorldPoints) : centroidWorld.clone().add(offset)
				);

				this.patternCheckboxPositions.set(`tool-${copyIndex}`, {
					x: copyCentroid.x,
					y: copyCentroid.y,
					copyIndex,
				});

				if (highlight.suppression) {
					renderPatternSuppressionCheckbox(this.patternCheckboxGroup, copyCentroid, copyIndex, isSuppressed);
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
				createSvgArrow(sMid, arrowDir, 18, 7.5, FILLET_GIZMO_ARROW_ATTRS, this.filletGroup);

				this.filletGizmoHandle = {
					screenX: sMid.x,
					screenY: sMid.y,
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

		// Unit screen directions for line 1 and line 2 (pointing away from V)
		const screenScale = new Vec2(viewport.zoom, -viewport.zoom);
		const uSDir1 = cand.dir1.clone().multiply(screenScale).normalize();
		const uSDir2 = cand.dir2.clone().multiply(screenScale).normalize();

		const pushDistArrow = (type: 'dist1' | 'dist2', sT: Vec2, uSDir: Vec2, worldPos: Vec2, dir: Vec2, val: number) => {
			const tip = sT.clone().addScaledVector(uSDir, -3.5);
			createSvgArrow(tip, uSDir, 16, 6.5, CHAMFER_GIZMO_ARROW_ATTRS, this.chamferGroup);
			this.chamferGizmoHandles.push({
				type,
				screenX: tip.x - uSDir.x * 8,
				screenY: tip.y - uSDir.y * 8,
				worldPos,
				dir,
				currentValue: val,
			});
		};

		if (state.mode === 'equal_distance') {
			// Mode 1: 1 arrow gizmo along the angle bisector, shifted back so tip points at chamfer midpoint
			const sMid = new Vec2().midpoint(sT1, sT2);
			const vBis = new Vec2().subVectors(sMid, sV);
			const lenBis = vBis.length() || 1;
			const uSBis = vBis.clone().multiplyScalar(1.0 / lenBis);

			// Arrow tip points towards sMid
			const tip = Vec2.from(sMid).addScaledVector(uSBis, -2);
			createSvgArrow(tip, uSBis, 16, 6.5, CHAMFER_GIZMO_ARROW_ATTRS, this.chamferGroup);

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
			pushDistArrow('dist1', sT1, uSDir1, res.t1, cand.dir1, res.dist1);
			pushDistArrow('dist2', sT2, uSDir2, res.t2, cand.dir2, res.dist2);
		} else if (state.mode === 'distance_angle') {
			// Mode 3: 1 distance arrow on reference line + 1 angle circle at 100px from reference vertex
			const [distType, sRef, uSDirRef, tRef, dirRef, distVal, sOther] = !state.flip
				? (['dist1', sT1, uSDir1, res.t1, cand.dir1, res.dist1, sT2] as const)
				: (['dist2', sT2, uSDir2, res.t2, cand.dir2, res.dist2, sT1] as const);

			pushDistArrow(distType, sRef, uSDirRef, tRef, dirRef, distVal);

			// Direction along chamfer line from reference vertex to opposite vertex
			const vChamfer = new Vec2().subVectors(sOther, sRef);
			const lenChamfer = vChamfer.length() || 1;
			const uSChamfer = vChamfer.clone().multiplyScalar(1.0 / lenChamfer);

			// Circle handle at exactly 100px from reference vertex
			const arcR = 100;
			const circle = sRef.clone().addScaledVector(uSChamfer, arcR);
			createSvgLine(sRef, circle, GIZMO_GUIDE_ATTRS, this.chamferGroup);

			// Visual arc showing the angle at reference vertex between ray towards V and chamfer ray
			const vV = new Vec2().subVectors(sV, sRef);
			if (vV.length() > 1e-4) {
				const angV = vV.signedAngle();
				let diff = uSChamfer.signedAngle() - angV;
				while (diff > Math.PI) diff -= 2 * Math.PI;
				while (diff < -Math.PI) diff += 2 * Math.PI;

				const start = Vec2.fromPolar(arcR, angV).add(sRef);
				createSvgLine(sRef, start, GIZMO_GUIDE_ATTRS, this.chamferGroup);

				if (Math.abs(diff) > 1e-3) {
					const sweepFlag = diff > 0 ? 1 : 0;
					createSvgPath(
						`M ${start.x} ${start.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${circle.x} ${circle.y}`,
						GIZMO_GUIDE_ATTRS,
						this.chamferGroup
					);
				}
			}

			createSvgCircle(circle, 6, CHAMFER_GIZMO_CIRCLE_ATTRS, this.chamferGroup);
			this.chamferGizmoHandles.push({
				type: 'angle',
				screenX: circle.x,
				screenY: circle.y,
				worldPos: tRef,
				currentValue: res.angleDeg,
			});
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
			sketch.getPrimitive(it.id, it.type)?.renderTransformed({
				sketch,
				viewport,
				transformPoint: (x, y) => ({ x, y }),
				targetGroup: this.offsetGroup,
				strokeAttrs: OFFSET_CHAIN_ATTRS,
			});
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

		// 3. Render gizmo arrow(s) at gizmoAnchor along gizmoNormal
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
			createSvgArrow(tip, uDir, 16, 6.5, OFFSET_GIZMO_ARROW_ATTRS, this.offsetGroup);

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

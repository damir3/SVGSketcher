import type { SvgExportDimensions } from '../model/io/svgIO';
import { AABB } from '../math/aabb';
import type { SketchImage } from '../model/image';
import type { TransformValues } from '../model/transform';
import type { SketchDocument } from '../model/sketch';
import { isPointIdConstrained, type ISketchPrimitive } from '../model/primitives';
import type { Viewport } from './viewport';
import { getAllGeoCurves } from '../math/intersection';
import { findCurveRegions, pointInRegion, type SketchRegion } from '../math/regions';
import { collectFilletPreviewTrims } from '../math/filletPreview';
import type { ConstraintRenderContext } from '../solver/constraints';
import { ORIGIN, Vec2 } from '../math/vector';
import { renderConstraintBadge, renderBadgeOnSegment, renderBadgeOnCircle } from './badgeIcons';

export * from './styles';
export * from './svg';
export * from './dimensionGeometry';
export * from './modifyPreviews';
export { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';

import { createSvgElement, createSvgLine, createSvgCircle, createSvgRect, createSvgPath, createSvgText } from './svg';
import {
	formatDimensionValue,
	computeDistanceDimensionGeometry,
	computePointToLineDimensionGeometry,
	renderLinearDimensionVisual,
	renderAngleDimensionVisual,
} from './dimensionGeometry';
import {
	type ChamferGizmoHandle,
	type ChamferPreviewState,
	type FilletGizmoHandle,
	type FilletPreviewState,
	type MirrorHighlight,
	type OffsetGizmoHandle,
	type OffsetPreviewState,
	type PatternAngleHandle,
	type PatternCheckboxPosition,
	type PatternHighlight,
	type RectangularGizmoHandle,
	type RectangularPatternHighlight,
	renderChamferPreviews as renderChamferPreviewElements,
	renderFilletPreviews as renderFilletPreviewElements,
	renderMirrorPreview as renderMirrorPreviewElements,
	renderOffsetPreviews as renderOffsetPreviewElements,
	renderPatternPreview as renderPatternPreviewElements,
	renderRectangularPatternGizmos as renderRectangularPatternGizmoElements,
	renderRectangularPatternPreview as renderRectangularPatternPreviewElements,
	renderTransformedObjects as renderTransformedPreviewObjects,
	renderTransformPreview as renderTransformPreviewElements,
} from './modifyPreviews';
import {
	COLORS,
	REGION_STYLE,
	DASH_ARRAY,
	STROKE_WIDTH,
	SVG_EXPORT_STYLE,
	type SvgAttrs,
	HIT_AREA_STROKE_ATTRS,
	SELECTION_BOX_ATTRS,
	CROSSING_SELECTION_BOX_ATTRS,
	SNAP_POINT_ATTRS,
	SNAP_GRID_ATTRS,
	SNAP_OBJECT_ATTRS,
	MIRROR_LINE_ATTRS,
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
	mirrorHighlight?: MirrorHighlight;
	patternHighlight?: PatternHighlight;
	rectangularPatternHighlight?: RectangularPatternHighlight;
	filletState?: FilletPreviewState;
	chamferState?: ChamferPreviewState;
	offsetState?: OffsetPreviewState;
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
	readonly patternCheckboxPositions = new Map<string, PatternCheckboxPosition>();
	patternAngleHandle: PatternAngleHandle | null = null;
	readonly rectangularGizmoHandles = new Map<string, RectangularGizmoHandle>();
	readonly chamferGizmoHandles: ChamferGizmoHandle[] = [];
	readonly offsetGizmoHandles: OffsetGizmoHandle[] = [];
	filletGizmoHandle: FilletGizmoHandle | null = null;
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
		const isXMirror = options.mirrorHighlight?.mirrorLineId === 'axis_x';
		const isYMirror = options.mirrorHighlight?.mirrorLineId === 'axis_y';
		const isXSelected = !isXMirror && sketch.selection.lineIds.has('axis_x');
		const isYSelected = !isYMirror && sketch.selection.lineIds.has('axis_y');
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
			isXMirror
				? MIRROR_LINE_ATTRS
				: {
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
			isYMirror
				? MIRROR_LINE_ATTRS
				: {
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
				return renderTransformedPreviewObjects(sketch, viewport, objectIds, transform, options);
			},
			renderRectangularPatternGizmos: (v, centroidWorld, u1, u2, distance1, distance2, options) => {
				renderRectangularPatternGizmoElements(v, centroidWorld, u1, u2, distance1, distance2, {
					...options,
					gizmoHandles: this.rectangularGizmoHandles,
				});
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

	renderTransformPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		ids: ReadonlySet<string>,
		center: Vec2,
		values: TransformValues,
		targetGroup: SVGGElement,
		color: string
	): void {
		renderTransformPreviewElements(sketch, viewport, ids, center, values, targetGroup, color, textPreview => {
			this.renderTexts(sketch, viewport, {}, { ids, target: textPreview, color });
		});
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
		renderMirrorPreviewElements(sketch, viewport, this.mirrorGroup, selectedObjectIds, mirrorLineId);
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
		this.patternAngleHandle = renderPatternPreviewElements(sketch, viewport, {
			targetGroup: this.patternGroup,
			checkboxGroup: this.patternCheckboxGroup,
			checkboxPositions: this.patternCheckboxPositions,
			selectedObjectIds,
			centerPointId,
			distribution,
			angle,
			quantity,
			suppression,
			suppressedIndices,
			angleHandleEnabled,
		});
	}

	renderRectangularPatternPreview(
		sketch: SketchDocument,
		viewport: Viewport,
		highlight: RectangularPatternHighlight
	): void {
		renderRectangularPatternPreviewElements(sketch, viewport, {
			targetGroup: this.patternGroup,
			checkboxGroup: this.patternCheckboxGroup,
			checkboxPositions: this.patternCheckboxPositions,
			gizmoHandles: this.rectangularGizmoHandles,
			highlight,
		});
	}

	renderFilletPreviews(_sketch: SketchDocument, viewport: Viewport, state: FilletPreviewState): void {
		this.filletGizmoHandle = renderFilletPreviewElements(viewport, this.filletGroup, state);
	}

	renderChamferPreviews(viewport: Viewport, state: ChamferPreviewState): void {
		renderChamferPreviewElements(viewport, this.chamferGroup, state, this.chamferGizmoHandles);
	}

	renderOffsetPreviews(sketch: SketchDocument, viewport: Viewport, state: OffsetPreviewState): void {
		renderOffsetPreviewElements(sketch, viewport, this.offsetGroup, state, this.offsetGizmoHandles);
	}

	clearPreviews(): void {
		this.previewGroup.innerHTML = '';
		this.overlayGroup.innerHTML = '';
	}
}

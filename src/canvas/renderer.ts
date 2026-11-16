import type { SvgExportDimensions } from '../model/io/svgIO';
import { AABB } from '../math/aabb';
import type { SketchImage } from '../model/image';
import type { TransformValues } from '../model/transform';
import type { SketchDocument } from '../model/sketch';
import { isPointIdConstrained, type ISketchPrimitive } from '../model/primitives';
import type { Viewport } from './viewport';
import { getAllGeoCurves } from '../math/intersection';
import { findCurveRegions, regionsContainingPoint, type SketchRegion } from '../math/regions';
import { collectFilletPreviewTrims } from '../math/filletPreview';
import type { ConstraintRenderContext } from '../solver/constraints';
import { Vec2 } from '../math/vector';
import { renderConstraintBadge, renderBadgeOnSegment, renderBadgeOnCircle } from './badgeIcons';
import { getGridRenderKey, renderGridAndAxes } from './gridRenderer';

export * from './styles';
export * from './svg';
export * from './dimensionGeometry';
export * from './modifyPreviews';
export { TEXT_ROTATION_HANDLE_DISTANCE_PX } from './distances';

import { createSvgElement, createSvgPath } from './svg';
import {
	renderAnglePreviewVisual,
	renderDistancePreviewVisual,
	renderLinearDimensionVisual,
	renderPointToLineDistancePreviewVisual,
} from './dimensionGeometry';
import { renderSelectionBoxVisual, renderSnapIndicatorVisual } from './previewHelpers';
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
import { COLORS, DASH_ARRAY, REGION_STYLE, STROKE_WIDTH, SVG_EXPORT_STYLE } from './styles';

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
	private gridRenderKey: string | null = null;
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

		this.gridGroup = this.createGroup('grid-layer', true);
		this.imageGroup = this.createGroup('image-layer');
		this.originAxisGroup = this.createGroup('origin-axis-layer');
		this.regionGroup = this.createGroup('region-layer', true);
		this.geometryGroup = this.createGroup('geometry-layer');
		this.textGroup = this.createGroup('text-layer');
		this.regionHoverGroup = this.createGroup('region-hover-layer', true);
		this.constraintGroup = this.createGroup('constraint-layer');
		this.pointGroup = this.createGroup('point-layer');
		this.mirrorGroup = this.createGroup('mirror-preview-layer', true);
		this.patternGroup = this.createGroup('pattern-preview-layer', true);
		this.patternCheckboxGroup = this.createGroup('pattern-checkbox-layer');
		this.filletGroup = this.createGroup('fillet-layer');
		this.chamferGroup = this.createGroup('chamfer-layer');
		this.offsetGroup = this.createGroup('offset-layer');
		this.previewGroup = this.createGroup('preview-layer', true);
		this.overlayGroup = this.createGroup('overlay-layer', true);
	}

	private createGroup(className: string, pointerEventsNone = false): SVGGElement {
		const group = createSvgElement('g', { class: className }, this.svg);
		if (pointerEventsNone) {
			group.style.pointerEvents = 'none';
		}
		return group;
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
		const hovered = hoverPoint ? regionsContainingPoint(hoverPoint, this.cachedRegions) : [];
		if (this.cachedViewport) this.drawRegions(hoverPoint, hovered);
		return hovered.some(Boolean);
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

	private drawRegions(
		hoverPoint: Vec2 | null,
		hoveredRegions = hoverPoint ? regionsContainingPoint(hoverPoint, this.cachedRegions) : []
	): void {
		this.regionGroup.innerHTML = '';
		this.regionHoverGroup.innerHTML = '';
		for (const [index, region] of this.cachedRegions.entries()) {
			const hovered = hoveredRegions[index] ?? false;
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
		const state = {
			showGrid,
			mirrorLineId: options.mirrorHighlight?.mirrorLineId,
			patternCenterPointId: options.patternHighlight?.centerPointId,
		};
		const key = getGridRenderKey(sketch, viewport, state);
		if (key === this.gridRenderKey) return;
		this.gridRenderKey = key;
		renderGridAndAxes(this.gridGroup, this.originAxisGroup, sketch, viewport, state);
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
		renderDistancePreviewVisual(this.previewGroup, s1, s2, cursor, distVal, orientation, isTargetSnapped);
	}

	renderDistanceLinePreview(s1: Vec2, s2: Vec2, distVal: number, isTargetSnapped = false): void {
		this.renderDistancePreview(s1, s2, undefined, distVal, 'direct', isTargetSnapped);
	}

	renderPointToLineDistancePreview(sp: Vec2, s1: Vec2, s2: Vec2, cursor?: Vec2, distVal = 0): void {
		this.previewGroup.innerHTML = '';
		renderPointToLineDistancePreviewVisual(this.previewGroup, sp, s1, s2, cursor, distVal);
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
		renderAnglePreviewVisual(this.previewGroup, sCenter, sRay1, sRay2, cursor, angleDeg, sp1, sp2, sp3, sp4);
	}

	renderSnapIndicator(
		s: Vec2,
		type: 'point' | 'line' | 'circle' | 'spline' | 'ellipse' | 'grid' = 'point',
		clearFirst = true
	): void {
		renderSnapIndicatorVisual(this.overlayGroup, s, type, clearFirst);
	}

	renderSelectionBox(s1: Vec2, s2: Vec2): void {
		renderSelectionBoxVisual(this.overlayGroup, s1, s2);
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

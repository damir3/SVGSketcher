import { projectPointOntoSegment, Vec2 } from '../../math/vector';
import { distanceToSegment } from '../../math/hitTest';
import { segmentIntersectsAABB } from '../../math/aabb';
import type { GeoSegment } from '../../math/intersection';
import type { LineType } from '../lineTypes';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveSnapCandidate,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';
import { createSvgLine } from '../../canvas/svg';
import { renderCuttingPlaneMarks } from '../../canvas/cuttingPlane';
import {
	applyDrawingLineStyle,
	CHAMFER_HIGHLIGHT_ATTRS,
	DIR1_LINE_ATTRS,
	DIR2_LINE_ATTRS,
	getPrimitiveStrokeAttrs,
	getSplineHandleStrokeAttrs,
	HIT_AREA_STROKE_ATTRS,
	MIRROR_LINE_ATTRS,
	SPLINE_CONTROL_POLYGON_ATTRS,
	SPLINE_HANDLE_SELECTED_ATTRS,
} from '../../canvas/styles';

interface LineData {
	id: string;
	p1Id: string;
	p2Id: string;
	lineType: LineType;
	parentSplineId?: string;
	isAutomaticSplineHandle?: boolean;
}

export class SketchLine implements ISketchPrimitive {
	readonly type = 'line' as const;
	id: string;
	p1Id: string;
	p2Id: string;
	lineType: LineType;
	parentSplineId?: string;
	isAutomaticSplineHandle?: boolean;

	constructor(data: LineData) {
		this.id = data.id;
		this.p1Id = data.p1Id;
		this.p2Id = data.p2Id;
		this.lineType = data.lineType;
		this.parentSplineId = data.parentSplineId;
		this.isAutomaticSplineHandle = data.isAutomaticSplineHandle;
	}

	get isConstruction(): boolean {
		return this.lineType !== 'solid';
	}

	get isSplineHandle(): boolean {
		return this.lineType === 'spline_handle';
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		return distanceToSegment(screen, s1, s2);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return false;
		return segmentIntersectsAABB(p1, p2, min, max);
	}

	toGeoCurve(sketch: any): GeoSegment | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;
		return {
			type: 'segment',
			id: this.id,
			p1: new Vec2(p1.x, p1.y),
			p2: new Vec2(p2.x, p2.y),
			isConstruction: this.isConstruction,
		};
	}

	getPointIds(_sketch?: any): string[] {
		return [this.p1Id, this.p2Id];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return isPointIdConstrained(this.p1Id, constrainedParams) && isPointIdConstrained(this.p2Id, constrainedParams);
	}

	render(ctx: PrimitiveRenderContext): void {
		const p1 = ctx.sketch.points.get(this.p1Id);
		const p2 = ctx.sketch.points.get(this.p2Id);
		if (!p1 || !p2) return;

		if (this.isSplineHandle) {
			const isParentActive = this.parentSplineId ? ctx.activeSplineIds.has(this.parentSplineId) : false;
			if (!isParentActive && !ctx.options.showSplineHandles) return;
		}

		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const lineG = createPrimitiveSvgGroup(
			this,
			ctx.isSelected,
			ctx.geometryGroup,
			this.isSplineHandle ? 'sketch-spline-handle' : ''
		);

		createSvgLine(s1, s2, HIT_AREA_STROKE_ATTRS, lineG);

		if (this.isSplineHandle) {
			const parentSpline = this.parentSplineId ? ctx.sketch.splines.get(this.parentSplineId) : undefined;
			if (parentSpline?.splineType === 'control') {
				createSvgLine(s1, s2, ctx.isSelected ? SPLINE_HANDLE_SELECTED_ATTRS : SPLINE_CONTROL_POLYGON_ATTRS, lineG);
			} else {
				lineG.classList.add('sketch-spline-tangent');
				createSvgLine(s1, s2, getSplineHandleStrokeAttrs(ctx.isSelected), lineG);
				ctx.deferTangentGroup(lineG);
			}
		} else if (ctx.options.mirrorHighlight?.mirrorLineId === this.id) {
			createSvgLine(s1, s2, MIRROR_LINE_ATTRS, lineG);
		} else if (ctx.options.rectangularPatternHighlight?.line1Id === this.id) {
			createSvgLine(s1, s2, DIR1_LINE_ATTRS, lineG);
		} else if (ctx.options.rectangularPatternHighlight?.line2Id === this.id) {
			createSvgLine(s1, s2, DIR2_LINE_ATTRS, lineG);
		} else {
			const cuts = ctx.lineCuts.get(this.id);
			const start = cuts?.get(this.p1Id);
			const end = cuts?.get(this.p2Id);
			const chamfer = ctx.options.chamferState?.candidate;
			const isChamferPreview =
				chamfer?.result?.isValid && (chamfer.line1.id === this.id || chamfer.line2.id === this.id);
			const attrs = isChamferPreview
				? CHAMFER_HIGHLIGHT_ATTRS
				: getPrimitiveStrokeAttrs(
						ctx.isSelected,
						this.lineType === 'construction' || this.lineType === 'centerline',
						ctx.baseColor,
						true
					);
			createSvgLine(
				start ? ctx.viewport.worldToScreen(start) : s1,
				end ? ctx.viewport.worldToScreen(end) : s2,
				applyDrawingLineStyle(attrs, this.lineType),
				lineG
			);
			if (this.lineType === 'cutting_plane') renderCuttingPlaneMarks(s1, s2, String(attrs.stroke), lineG);
		}
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const pt1 = opts.sketch.points.get(this.p1Id);
		const pt2 = opts.sketch.points.get(this.p2Id);
		if (!pt1 || !pt2) return [];

		const rp1 = opts.transformPoint(pt1.x, pt1.y);
		const rp2 = opts.transformPoint(pt2.x, pt2.y);
		if (opts.targetGroup && opts.strokeAttrs) {
			const sp1 = opts.viewport.worldToScreen(rp1);
			const sp2 = opts.viewport.worldToScreen(rp2);
			const attrs = opts.strokeAttrs;
			createSvgLine(sp1, sp2, applyDrawingLineStyle(attrs, this.lineType), opts.targetGroup);
			if (this.lineType === 'cutting_plane') renderCuttingPlaneMarks(sp1, sp2, String(attrs.stroke), opts.targetGroup);
			opts.drawVertex?.(sp1, rp1);
			opts.drawVertex?.(sp2, rp2);
		}
		return [rp1, rp2];
	}

	snapTo(screenPos: Vec2, sketch: any, viewport: any, maxDistPx: number): PrimitiveSnapCandidate | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const proj = projectPointOntoSegment(screenPos, s1, s2);
		if (proj.dist >= maxDistPx) return null;

		return {
			type: 'line',
			id: this.id,
			dist: proj.dist,
			worldPos: p1.clone().lerp(p2, proj.t),
			screenPos: proj.point,
		};
	}

	drag(sketch: any, startWorld: Vec2, currentWorld: Vec2, initialPoints: ReadonlyMap<string, Vec2>): void {
		const p1Start = initialPoints.get(this.p1Id);
		const p2Start = initialPoints.get(this.p2Id);
		if (!p1Start || !p2Start) return;
		const dir = new Vec2().subVectors(currentWorld, startWorld);
		sketch.dragLine(this.id, p1Start.x + dir.x, p1Start.y + dir.y, p2Start.x + dir.x, p2Start.y + dir.y);
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-line-length',
				label: 'Length',
				unit: 'mm',
				getValue: ctx => {
					const p1 = ctx.sketch.points.get(this.p1Id);
					const p2 = ctx.sketch.points.get(this.p2Id);
					return p1 && p2 ? Number(p1.distanceTo(p2).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setLineLength(this.id, val),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-line-angle',
				label: 'Angle',
				unit: '°',
				getValue: ctx => {
					const p1 = ctx.sketch.points.get(this.p1Id);
					const p2 = ctx.sketch.points.get(this.p2Id);
					return p1 && p2 ? Number(p1.angleToPointDeg(p2).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setLineAngle(this.id, val),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('line', this.id),
		constraintsLabel: 'this line',
		entityIds: () => [this.id],
	});
}

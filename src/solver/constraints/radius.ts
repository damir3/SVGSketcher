import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { COLORS, STROKE_WIDTH, DIM_ARROWS } from '../../canvas/styles';
import { createSvgElement, createSvgLine, createSvgRect, createSvgText } from '../../canvas/svg';
import type { Viewport } from '../../canvas/viewport';
import { distanceToSegment } from '../../math/hitTest';
import { angleFromTo, addScaled, dist, sub, vec, type Vec2 } from '../../math/vector';
import type { SketchDocument } from '../../model/sketch';

const DEFAULT_LEADER_OFFSET = 8;
const LABEL_HEIGHT = 20;
const TWO_PI = 2 * Math.PI;

/**
 * Dimensional constraint: circle radius equals value
 */
export class RadiusConstraint extends BaseConstraint {
	readonly circleId: string;
	targetRadius: number;
	leaderAngle?: number;
	leaderOffset?: number; // Signed distance from the perimeter in sketch units.
	displayMode: 'radius' | 'diameter';

	constructor(
		id: string,
		circleId: string,
		targetRadius: number,
		weight = 1.0,
		leaderAngle?: number,
		displayMode: 'radius' | 'diameter' = 'radius'
	) {
		const valStr = displayMode === 'diameter' ? Number((targetRadius * 2).toFixed(2)) : Number(targetRadius.toFixed(2));
		const label = displayMode === 'diameter' ? `Diameter (${valStr})` : `Radius (${valStr})`;
		super(id, 'radius', label, [circleId], weight, false, true, targetRadius);
		this.circleId = circleId;
		this.targetRadius = targetRadius;
		this.leaderAngle = leaderAngle;
		this.displayMode = displayMode;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const r = paramMap.get(`${this.circleId}.r`) ?? this.targetRadius;
		return [(r - this.targetRadius) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, this.weight);
		return res;
	}

	private getLayout(sketch: SketchDocument, viewport: Viewport, labelTarget?: Vec2) {
		const arc = sketch.arcs.get(this.circleId);
		const entity = sketch.circles.get(this.circleId) ?? arc;
		const center = entity && sketch.points.get(entity.centerId);
		if (!entity || !center) return null;

		const screenCenter = viewport.worldToScreen(center);
		const screenRadius = entity.radius * viewport.zoom;
		const targetDistance = labelTarget && dist(screenCenter, labelTarget);
		let angle = this.leaderAngle;
		if (labelTarget && targetDistance) {
			angle = angleFromTo(screenCenter, labelTarget);
		}

		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start);
				const se = viewport.worldToScreen(end);
				const startAngle = angleFromTo(screenCenter, ss);
				const endAngle = angleFromTo(screenCenter, se);
				const sign = arc.clockwise ? 1 : -1;
				let sweep = ((endAngle - startAngle) * sign) % TWO_PI;
				if (sweep < 0) sweep += TWO_PI;
				let rel = angle === undefined ? sweep / 2 : ((angle - startAngle) * sign) % TWO_PI;
				if (rel < 0) rel += TWO_PI;
				if (rel > sweep) rel = rel - sweep < TWO_PI - rel ? sweep : 0;
				angle = startAngle + sign * rel;
			}
		}

		angle ??= -Math.PI / 4;
		const dir = vec(Math.cos(angle), Math.sin(angle));
		const isDiameter = this.displayMode === 'diameter';
		const num = isDiameter ? this.targetRadius * 2 : this.targetRadius;
		const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
		const prefix = this.expression ? 'fx: ' : '';
		const text = isDiameter ? `${prefix}Ø ${numStr}` : `${prefix}R ${numStr}`;
		const labelSize = vec(text.length * 8 + 14, LABEL_HEIGHT);

		const offset =
			targetDistance === undefined
				? (this.leaderOffset ?? DEFAULT_LEADER_OFFSET)
				: (targetDistance - screenRadius) / viewport.zoom;
		const isInside = offset < 0;
		const edge = addScaled(screenCenter, dir, screenRadius);
		const anchor = addScaled(screenCenter, dir, Math.max(0, screenRadius + offset * viewport.zoom));
		const labelCenter = isInside ? anchor : vec(anchor.x + ((dir.x >= 0 ? 1 : -1) * labelSize.x) / 2, anchor.y);
		const labelOrigin = vec(labelCenter.x - labelSize.x / 2, labelCenter.y - labelSize.y / 2);
		return {
			start: isDiameter ? addScaled(screenCenter, dir, -screenRadius) : screenCenter,
			edge,
			anchor,
			isInside,
			isDiameter,
			angle,
			offset,
			text,
			labelCenter,
			labelOrigin,
			labelSize,
		};
	}

	getLabelAnchor(sketch: SketchDocument, viewport: Viewport): Vec2 | undefined {
		return this.getLayout(sketch, viewport)?.anchor;
	}

	moveLabelTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		const layout = this.getLayout(sketch, viewport, screen);
		if (!layout) return;
		this.leaderAngle = layout.angle;
		this.leaderOffset = layout.offset;
	}

	override render(ctx: ConstraintRenderContext): void {
		this.renderDimension(ctx.sketch, ctx.viewport, ctx.targetGroup, ctx.isSelected);
	}

	renderDimension(sketch: SketchDocument, viewport: Viewport, targetGroup: SVGGElement, isSelected = false): void {
		const layout = this.getLayout(sketch, viewport);
		if (!layout) return;
		const { start, edge, anchor, isInside, isDiameter, text, labelCenter, labelOrigin, labelSize } = layout;
		const g = createSvgElement(
			'g',
			{
				class: 'dimension-item',
				'data-id': this.id,
				'data-type': 'constraint',
			},
			targetGroup
		);

		const color = isSelected ? COLORS.selected : COLORS.primary;
		const arrowUrl = isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

		// A diameter dimension crosses the full circle; a radius dimension starts at its center.
		createSvgLine(
			start,
			edge,
			{
				stroke: color,
				'stroke-width': STROKE_WIDTH.dimension,
				...(isDiameter ? { 'marker-start': arrowUrl, 'marker-end': arrowUrl } : { 'marker-end': arrowUrl }),
			},
			g
		);

		if (!isInside) {
			createSvgLine(edge, anchor, { stroke: color, 'stroke-width': STROKE_WIDTH.dimension }, g);
		}

		createSvgRect(
			labelOrigin,
			labelSize,
			{
				rx: 4,
				fill: COLORS.white,
				stroke: color,
				'stroke-width': isSelected ? STROKE_WIDTH.normal : STROKE_WIDTH.thin,
			},
			g
		);

		createSvgText(
			vec(labelCenter.x, labelCenter.y + 4),
			text,
			{
				'text-anchor': 'middle',
				fill: color,
				'font-size': 12,
				'font-weight': 600,
				'font-family': 'monospace',
			},
			g
		);
	}

	override distanceTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): number | null {
		const layout = this.getLayout(sketch, viewport);
		if (!layout) return null;
		const { start, edge, anchor, isInside, labelOrigin, labelSize } = layout;
		const local = sub(screen, labelOrigin);
		const labelDistance = Math.hypot(
			Math.max(0, -local.x, local.x - labelSize.x),
			Math.max(0, -local.y, local.y - labelSize.y)
		);
		return Math.min(labelDistance, distanceToSegment(screen, start, isInside ? edge : anchor));
	}

	override readonly sidebarPanel: ConstraintPanel = new ConstraintPanel({
		constraint: this,
		title: () => (this.displayMode === 'diameter' ? 'Diameter' : 'Radius'),
		segmentedControls: [
			{
				label: 'Mode',
				options: [
					{ id: 'radius', label: 'Radius' },
					{ id: 'diameter', label: 'Diameter' },
				],
				getCurrent: () => this.displayMode ?? 'radius',
				onSelect: (mode, context) => {
					context.sketch.pushHistory();
					const val = mode === 'diameter' ? this.targetRadius * 2 : this.targetRadius;
					context.sketch.updateDimensionalConstraint(this.id, val, mode as any);
					context.requestRender?.();
				},
			},
		],
		dimension: {
			label: () => (this.displayMode === 'diameter' ? 'Diameter' : 'Radius'),
			getValue: () =>
				`${this.displayMode === 'diameter' ? Number((this.targetRadius * 2).toFixed(2)) : Number(this.targetRadius.toFixed(2))} mm`,
		},
	});
}

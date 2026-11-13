import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { COLORS, STROKE_WIDTH, DIM_ARROWS } from '../../canvas/styles';
import { createSvgElement, createSvgLine, renderDimensionLabel } from '../../canvas/svg';
import type { Viewport } from '../../canvas/viewport';
import { distanceToSegment } from '../../math/hitTest';
import { Vec2 } from '../../math/vector';
import type { SketchDocument } from '../../model/sketch';

export const DEFAULT_LEADER_OFFSET = 8;
const LABEL_HEIGHT = 20;
const LABEL_LINE_OFFSET = 8.5;
const TWO_PI = 2 * Math.PI;

/**
 * Dimensional constraint: circle radius equals value
 */
export class RadiusConstraint extends BaseConstraint {
	readonly circleId: string;
	targetRadius: number;
	leaderAngle?: number;
	leaderOffset?: number; // Signed distance from the perimeter in sketch units (mm).
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
		const targetDistance = labelTarget && screenCenter.distanceTo(labelTarget);
		let angle = this.leaderAngle;
		let edgeAngle;
		if (labelTarget && targetDistance) {
			angle = screenCenter.angleToPoint(labelTarget);
		}

		edgeAngle = angle;
		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start);
				const se = viewport.worldToScreen(end);
				const startAngle = screenCenter.angleToPoint(ss);
				const endAngle = screenCenter.angleToPoint(se);
				const sign = arc.clockwise ? 1 : -1;
				let sweep = ((endAngle - startAngle) * sign) % TWO_PI;
				if (sweep < 0) sweep += TWO_PI;
				let rel = angle === undefined ? sweep / 2 : ((angle - startAngle) * sign) % TWO_PI;
				if (rel < 0) rel += TWO_PI;
				if (rel > sweep) rel = rel - sweep < TWO_PI - rel ? sweep : 0;
				edgeAngle = startAngle + sign * rel;
				angle ??= edgeAngle;
			}
		}

		angle ??= -Math.PI / 4;
		const dir = Vec2.fromPolar(1, angle);
		const isDiameter = this.displayMode === 'diameter';
		const num = isDiameter ? this.targetRadius * 2 : this.targetRadius;
		const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
		const prefix = this.expression ? 'fx: ' : '';
		const text = `${prefix}${isDiameter ? 'Ø' : 'R'}${numStr}`;
		const labelSize = new Vec2(text.length * 8 + 14, LABEL_HEIGHT);

		let offset =
			targetDistance === undefined
				? (this.leaderOffset ?? DEFAULT_LEADER_OFFSET)
				: (targetDistance - screenRadius) / viewport.zoom;
		// The rotated label must fit completely inside the circle, including its corners.
		const innerRadius = Math.max(0, screenRadius - 4);
		const maxInsideDistance =
			Math.sqrt(Math.max(0, innerRadius ** 2 - (labelSize.y / 2 + LABEL_LINE_OFFSET) ** 2)) - labelSize.x / 2;
		const isInside = offset < 0 && maxInsideDistance >= 0;
		let anchorDistance = Math.max(0, screenRadius + offset * viewport.zoom);
		if (isInside) anchorDistance = Math.min(anchorDistance, maxInsideDistance);
		else if (offset < 0) anchorDistance = screenRadius + 8;
		offset = (anchorDistance - screenRadius) / viewport.zoom;
		const edgeDir = Vec2.fromPolar(1, edgeAngle ?? angle);
		const edge = screenCenter.clone().addScaledVector(edgeDir, screenRadius);
		const anchor = screenCenter.clone().addScaledVector(dir, anchorDistance);
		let textAngle = angle;
		if (textAngle > Math.PI / 2 - 1e-4) textAngle -= Math.PI;
		else if (textAngle <= -Math.PI / 2) textAngle += Math.PI;
		const textUp = new Vec2(Math.sin(textAngle), -Math.cos(textAngle));
		const labelCenter = isInside
			? anchor.clone().addScaledVector(textUp, LABEL_LINE_OFFSET)
			: new Vec2(anchor.x + ((dir.x >= 0 ? 1 : -1) * labelSize.x) / 2, anchor.y - LABEL_LINE_OFFSET);
		return {
			start: isDiameter ? screenCenter.clone().addScaledVector(edgeDir, -screenRadius) : screenCenter,
			edge,
			anchor,
			isInside,
			isDiameter,
			angle,
			dir,
			offset,
			text,
			labelCenter,
			textAngle,
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

	placeLabelInsideNear(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		const entity = sketch.circles.get(this.circleId) ?? sketch.arcs.get(this.circleId);
		const center = entity && sketch.points.get(entity.centerId);
		if (!entity || !center) return;
		const screenCenter = viewport.worldToScreen(center);
		const delta = new Vec2().subVectors(screen, screenCenter);
		const distance = delta.length();
		const radius = entity.radius * viewport.zoom;
		// Start inside even when the final construction click lies on or beyond the perimeter.
		const target = screenCenter
			.clone()
			.addScaledVector(delta, distance > 0 ? Math.min(distance, radius * 0.99) / distance : 0);
		this.moveLabelTo(target, sketch, viewport);
	}

	override render(ctx: ConstraintRenderContext): void {
		this.renderDimension(ctx.sketch, ctx.viewport, ctx.targetGroup, ctx.isSelected);
	}

	renderDimension(sketch: SketchDocument, viewport: Viewport, targetGroup: SVGGElement, isSelected = false): void {
		const layout = this.getLayout(sketch, viewport);
		if (!layout) return;
		const { start, edge, anchor, isInside, isDiameter, text, labelSize, dir, labelCenter, textAngle } = layout;
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

		// 1. Radial line:
		// A diameter dimension crosses the full circle; a radius dimension starts at its center.
		const radialAttrs = {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		};
		createSvgLine(
			start,
			edge,
			{
				...radialAttrs,
				...(isDiameter ? { 'marker-start': arrowUrl, 'marker-end': arrowUrl } : { 'marker-end': arrowUrl }),
			},
			g
		);
		if (isInside && distanceToSegment(anchor, start, edge) > 1e-4) {
			createSvgLine(edge, anchor, radialAttrs, g);
		}

		if (isInside) {
			renderDimensionLabel(g, labelCenter, text, color, 'linear', {
				angleDeg: (textAngle * 180) / Math.PI,
			});
		} else {
			// 2. Leader line extending to anchor (when outside)
			createSvgLine(edge, anchor, { stroke: color, 'stroke-width': STROKE_WIDTH.dimension }, g);

			// 3. Horizontal shelf at anchor (Engineering CAD style)
			const dirX = dir.x >= 0 ? 1 : -1;
			const shelfLen = labelSize.x;
			const shelfEnd = new Vec2(anchor.x + dirX * shelfLen, anchor.y);
			createSvgLine(
				anchor,
				shelfEnd,
				{
					stroke: color,
					'stroke-width': STROKE_WIDTH.dimension,
				},
				g
			);

			// 4. Dimension text placed above the shelf without background fill
			renderDimensionLabel(g, labelCenter, text, color, 'linear');
		}
	}

	override distanceTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): number | null {
		const layout = this.getLayout(sketch, viewport);
		if (!layout) return null;
		const { start, edge, anchor, isInside, labelSize, dir } = layout;
		const local = new Vec2().subVectors(screen, layout.labelCenter);
		if (isInside) {
			const angle = Math.atan2(dir.y, dir.x);
			local.set(
				local.x * Math.cos(angle) + local.y * Math.sin(angle),
				-local.x * Math.sin(angle) + local.y * Math.cos(angle)
			);
		}
		local.addScaledVector(labelSize, 0.5);
		const labelDistance = Math.hypot(
			Math.max(0, -local.x, local.x - labelSize.x),
			Math.max(0, -local.y, local.y - labelSize.y)
		);
		if (isInside) {
			return Math.min(labelDistance, distanceToSegment(screen, start, edge), distanceToSegment(screen, edge, anchor));
		}
		const dirX = dir.x >= 0 ? 1 : -1;
		const shelfEnd = new Vec2(anchor.x + dirX * labelSize.x, anchor.y);
		const leaderDistance = Math.min(
			distanceToSegment(screen, start, edge),
			distanceToSegment(screen, edge, anchor),
			distanceToSegment(screen, anchor, shelfEnd)
		);
		return Math.min(labelDistance, leaderDistance);
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
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
}

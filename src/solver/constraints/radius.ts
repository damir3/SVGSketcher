import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS, STROKE_WIDTH, DIM_ARROWS } from '../../canvas/styles';
import { createSvgElement, createSvgLine, createSvgRect, createSvgText } from '../../canvas/svg';
import { distanceToRadiusDimension } from '../../math/hitTest';

/**
 * Dimensional constraint: circle radius equals value
 */
export class RadiusConstraint extends BaseConstraint {
	readonly circleId: string;
	targetRadius: number;
	leaderAngle?: number;
	displayMode: 'radius' | 'diameter';

	constructor(
		id: string,
		circleId: string,
		targetRadius: number,
		weight = 1.0,
		leaderAngle?: number,
		displayMode: 'radius' | 'diameter' = 'radius'
	) {
		const valStr = displayMode === 'diameter'
			? Number((targetRadius * 2).toFixed(2))
			: Number(targetRadius.toFixed(2));
		const label = displayMode === 'diameter'
			? `Diameter (${valStr})`
			: `Radius (${valStr})`;
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

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const circle = ctx.sketch.circles.get(this.circleId);
		const arc = ctx.sketch.arcs.get(this.circleId);
		const entity = circle ?? arc;
		if (!entity) return;
		const center = ctx.sketch.points.get(entity.centerId);
		if (!center) return;

		const sc = ctx.viewport.worldToScreen(center.x, center.y);
		const sr = entity.radius * ctx.viewport.zoom;

		// Leader angle in screen space (screen Y is positive downwards)
		let screenAngle = -Math.PI / 4; // Default for circle: 45° up and right

		const TWO_PI = 2 * Math.PI;
		if (arc) {
			const start = ctx.sketch.points.get(arc.startPointId);
			const end = ctx.sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = ctx.viewport.worldToScreen(start.x, start.y);
				const se = ctx.viewport.worldToScreen(end.x, end.y);
				const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
				const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
				const clockwise = !!arc.clockwise;

				let sweepAngle = 0;
				if (clockwise) {
					sweepAngle = (ae - as) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					if (this.leaderAngle !== undefined) {
						let rel = (this.leaderAngle - as) % TWO_PI;
						if (rel < 0) rel += TWO_PI;
						if (rel > sweepAngle) {
							rel = rel - sweepAngle < TWO_PI - rel ? sweepAngle : 0;
						}
						screenAngle = as + rel;
					} else {
						screenAngle = as + sweepAngle / 2;
					}
				} else {
					sweepAngle = (as - ae) % TWO_PI;
					if (sweepAngle < 0) sweepAngle += TWO_PI;
					if (this.leaderAngle !== undefined) {
						let rel = (as - this.leaderAngle) % TWO_PI;
						if (rel < 0) rel += TWO_PI;
						if (rel > sweepAngle) {
							rel = rel - sweepAngle < TWO_PI - rel ? sweepAngle : 0;
						}
						screenAngle = as - rel;
					} else {
						screenAngle = as - sweepAngle / 2;
					}
				}
			}
		} else {
			if (this.leaderAngle !== undefined) {
				screenAngle = this.leaderAngle;
			}
		}

		const cosA = Math.cos(screenAngle);
		const sinA = Math.sin(screenAngle);
		const edge = {
			x: sc.x + cosA * sr,
			y: sc.y + sinA * sr,
		};

		const dirX = cosA >= 0 ? 1 : -1;
		const dirY = sinA >= 0 ? 1 : -1;
		const tip = {
			x: edge.x + dirX * 30,
			y: edge.y + dirY * 20,
		};

		const g = createSvgElement('g', {
			class: 'dimension-item',
			'data-id': this.id,
			'data-type': 'constraint',
		}, ctx.targetGroup);

		const color = ctx.isSelected ? COLORS.selected : COLORS.primary;
		const arrowUrl = ctx.isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;

		// Leader radial line from center to edge with arrow at circumference
		createSvgLine(sc.x, sc.y, edge.x, edge.y, {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
			'marker-end': arrowUrl,
		}, g);

		// Shelf line from edge to tip
		createSvgLine(edge.x, edge.y, tip.x, tip.y, {
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		}, g);

		const isDiameter = this.displayMode === 'diameter';
		const num = isDiameter ? this.targetRadius * 2 : this.targetRadius;
		const numStr = Number.isInteger(num) ? num.toFixed(1) : Number(num.toFixed(2)).toString();
		const textVal = isDiameter ? `Ø ${numStr}` : `R ${numStr}`;
		const textLen = textVal.length * 8 + 14;

		const rectX = dirX > 0 ? tip.x : tip.x - textLen;
		createSvgRect(rectX, tip.y - 12, textLen, 20, {
			rx: 4,
			fill: COLORS.white,
			stroke: color,
			'stroke-width': ctx.isSelected ? STROKE_WIDTH.normal : STROKE_WIDTH.thin,
		}, g);

		createSvgText(rectX + textLen * 0.5, tip.y + 3, textVal, {
			'text-anchor': 'middle',
			fill: color,
			'font-size': 12,
			'font-weight': 600,
			'font-family': 'monospace',
		}, g);
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const circle = sketch.circles.get(this.circleId);
		const arc = sketch.arcs.get(this.circleId);
		const entity = circle ?? arc;
		if (!entity) return null;
		const center = sketch.points.get(entity.centerId);
		if (!center) return null;

		const sc = viewport.worldToScreen(center.x, center.y);
		const sr = entity.radius * viewport.zoom;

		let screenAngle = -Math.PI / 4;
		if (arc) {
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (start && end) {
				const ss = viewport.worldToScreen(start.x, start.y);
				const se = viewport.worldToScreen(end.x, end.y);
				const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
				const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
				const clockwise = !!arc.clockwise;
				let sweepAngle = clockwise ? (ae - as) % (2 * Math.PI) : (as - ae) % (2 * Math.PI);
				if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
				if (this.leaderAngle !== undefined) {
					let rel = clockwise ? (this.leaderAngle - as) % (2 * Math.PI) : (as - this.leaderAngle) % (2 * Math.PI);
					if (rel < 0) rel += 2 * Math.PI;
					if (rel > sweepAngle) rel = rel - sweepAngle < (2 * Math.PI) - rel ? sweepAngle : 0;
					screenAngle = clockwise ? as + rel : as - rel;
				} else {
					screenAngle = clockwise ? as + sweepAngle / 2 : as - sweepAngle / 2;
				}
			}
		} else {
			if (this.leaderAngle !== undefined) {
				screenAngle = this.leaderAngle;
			}
		}

		return distanceToRadiusDimension(screen, sc, sr, screenAngle);
	}
}

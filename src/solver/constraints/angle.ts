import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS, STROKE_WIDTH, DIM_ARROWS } from '../../canvas/styles';
import { createSvgElement, createSvgPath, createSvgRect, createSvgText } from '../../canvas/svg';

/**
 * Dimensional constraint: angle between two lines equals targetAngle (in degrees)
 */
export class AngleConstraint extends BaseConstraint {
	readonly line1Id: string;
	readonly line2Id: string;
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;
	targetAngle: number; // in degrees
	arcRadius?: number; // visual radius in world units
	s1: number; // orientation factor for line 1 (+1 or -1)
	s2: number; // orientation factor for line 2 (+1 or -1)
	sign: number; // cross direction factor (+1 or -1)

	constructor(
		id: string,
		line1Id: string,
		line2Id: string,
		l1P1: string,
		l1P2: string,
		l2P1: string,
		l2P2: string,
		targetAngle: number,
		arcRadius = 40,
		s1 = 1,
		s2 = 1,
		sign = 1,
		weight = 1.0
	) {
		super(
			id,
			'angle',
			'Angle',
			[line1Id, line2Id, l1P1, l1P2, l2P1, l2P2],
			weight,
			false,
			true,
			targetAngle
		);
		this.line1Id = line1Id;
		this.line2Id = line2Id;
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
		this.targetAngle = targetAngle;
		this.arcRadius = arcRadius;
		this.s1 = s1;
		this.s2 = s2;
		this.sign = sign;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.l1P1}.x`) ?? 0;
		const p1y = paramMap.get(`${this.l1P1}.y`) ?? 0;
		const p2x = paramMap.get(`${this.l1P2}.x`) ?? 0;
		const p2y = paramMap.get(`${this.l1P2}.y`) ?? 0;
		const p3x = paramMap.get(`${this.l2P1}.x`) ?? 0;
		const p3y = paramMap.get(`${this.l2P1}.y`) ?? 0;
		const p4x = paramMap.get(`${this.l2P2}.x`) ?? 0;
		const p4y = paramMap.get(`${this.l2P2}.y`) ?? 0;

		const dx1 = (p2x - p1x) * this.s1;
		const dy1 = (p2y - p1y) * this.s1;
		const dx2 = (p4x - p3x) * this.s2;
		const dy2 = (p4y - p3y) * this.s2;

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const u1x = dx1 / l1;
		const u1y = dy1 / l1;
		const u2x = dx2 / l2;
		const u2y = dy2 / l2;

		const targetRad = (this.targetAngle * Math.PI) / 180;
		const rotAngle = this.sign * targetRad;
		const cosA = Math.cos(rotAngle);
		const sinA = Math.sin(rotAngle);

		// Rotate u1 by rotAngle
		const rx = u1x * cosA - u1y * sinA;
		const ry = u1x * sinA + u1y * cosA;

		// Cross product between rotated u1 and u2
		const cross = rx * u2y - ry * u2x;
		return [cross * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const l1 = ctx.sketch.lines.get(this.line1Id);
		const l2 = ctx.sketch.lines.get(this.line2Id);

		const p1 = ctx.sketch.points.get(l1 ? l1.p1Id : this.l1P1);
		const p2 = ctx.sketch.points.get(l1 ? l1.p2Id : this.l1P2);
		const p3 = ctx.sketch.points.get(l2 ? l2.p1Id : this.l2P1);
		const p4 = ctx.sketch.points.get(l2 ? l2.p2Id : this.l2P2);
		if (!p1 || !p2 || !p3 || !p4) return;

		const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

		const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
		const v2 = { x: p4.x - p3.x, y: p4.y - p3.y };
		const l1Len = Math.max(Math.hypot(v1.x, v1.y), 1e-7);
		const l2Len = Math.max(Math.hypot(v2.x, v2.y), 1e-7);

		const s1Factor = this.s1 ?? geom.s1;
		const s2Factor = this.s2 ?? geom.s2;

		const u1 = { x: (s1Factor * v1.x) / l1Len, y: (s1Factor * v1.y) / l1Len };
		const u2 = { x: (s2Factor * v2.x) / l2Len, y: (s2Factor * v2.y) / l2Len };

		const sCenter = ctx.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
		const sRay1 = ctx.viewport.worldToScreen(geom.pInt.x + u1.x * 20, geom.pInt.y + u1.y * 20);
		const sRay2 = ctx.viewport.worldToScreen(geom.pInt.x + u2.x * 20, geom.pInt.y + u2.y * 20);

		const a1 = Math.atan2(sRay1.y - sCenter.y, sRay1.x - sCenter.x);
		const a2 = Math.atan2(sRay2.y - sCenter.y, sRay2.x - sCenter.x);

		const TWO_PI = 2 * Math.PI;
		let delta = a2 - a1;
		while (delta > Math.PI) delta -= TWO_PI;
		while (delta < -Math.PI) delta += TWO_PI;

		const sweepFlag = delta > 0 ? 1 : 0;
		const rWorld = this.arcRadius ?? 40;
		const rScreen = Math.max(28, rWorld * ctx.viewport.zoom);

		const ax = sCenter.x + rScreen * Math.cos(a1);
		const ay = sCenter.y + rScreen * Math.sin(a1);
		const bx = sCenter.x + rScreen * Math.cos(a2);
		const by = sCenter.y + rScreen * Math.sin(a2);

		const midAngle = a1 + delta * 0.5;
		const midX = sCenter.x + rScreen * Math.cos(midAngle);
		const midY = sCenter.y + rScreen * Math.sin(midAngle);

		const g = createSvgElement('g', {
			class: 'dimension-item',
			'data-id': this.id,
			'data-type': 'constraint',
		}, ctx.targetGroup);

		const color = ctx.isSelected ? COLORS.selected : COLORS.primary;

		// Dashed extension lines if arc points extend beyond the physical line segments
		const sp1 = ctx.viewport.worldToScreen(p1.x, p1.y);
		const sp2 = ctx.viewport.worldToScreen(p2.x, p2.y);
		const sp3 = ctx.viewport.worldToScreen(p3.x, p3.y);
		const sp4 = ctx.viewport.worldToScreen(p4.x, p4.y);

		if (ctx.renderDashedExtensionLines) {
			ctx.renderDashedExtensionLines(g, sCenter, a1, rScreen, sp1, sp2, color);
			ctx.renderDashedExtensionLines(g, sCenter, a2, rScreen, sp3, sp4, color);
		}

		// Arc path with arrowheads
		const arrowUrl = ctx.isSelected ? DIM_ARROWS.selected : DIM_ARROWS.default;
		createSvgPath(
			`M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${rScreen.toFixed(1)} ${rScreen.toFixed(1)} 0 0 ${sweepFlag} ${bx.toFixed(1)} ${by.toFixed(1)}`,
			{
				fill: 'none',
				stroke: color,
				'stroke-width': STROKE_WIDTH.dimension,
				'marker-start': arrowUrl,
				'marker-end': arrowUrl,
			},
			g
		);

		// Text label badge with background
		const textVal = `${this.targetAngle.toFixed(1)}°`;
		const textLen = textVal.length * 8 + 14;

		createSvgRect(midX - textLen * 0.5, midY - 10, textLen, 20, {
			rx: 4,
			fill: COLORS.white,
			stroke: color,
			'stroke-width': STROKE_WIDTH.dimension,
		}, g);

		createSvgText(midX, midY + 4, textVal, {
			'text-anchor': 'middle',
			fill: color,
			'font-size': 11,
			'font-weight': 700,
			'font-family': 'ui-monospace, monospace',
		}, g);
	}
}

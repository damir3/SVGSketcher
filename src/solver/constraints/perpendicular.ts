import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { dist, projectPointOntoSegment } from '../../math/vector';

/**
 * Constrains two lines to be perpendicular (dot product of unit vectors = 0)
 */
export class PerpendicularConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'perpendicular', 'Perpendicular', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const dx1 = (paramMap.get(`${this.l1P2}.x`) ?? 0) - (paramMap.get(`${this.l1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.l1P2}.y`) ?? 0) - (paramMap.get(`${this.l1P1}.y`) ?? 0);
		const dx2 = (paramMap.get(`${this.l2P2}.x`) ?? 0) - (paramMap.get(`${this.l2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.l2P2}.y`) ?? 0) - (paramMap.get(`${this.l2P1}.y`) ?? 0);

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const dotProd = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
		return [dotProd * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const p1 = ctx.sketch.points.get(this.l1P1);
		const p2 = ctx.sketch.points.get(this.l1P2);
		const p3 = ctx.sketch.points.get(this.l2P1);
		const p4 = ctx.sketch.points.get(this.l2P2);
		if (!p1 || !p2 || !p3 || !p4) return;

		const isSharedPoint =
			p1.id === p3.id ||
			p1.id === p4.id ||
			p2.id === p3.id ||
			p2.id === p4.id ||
			dist(p1, p3) < 1e-3 ||
			dist(p1, p4) < 1e-3 ||
			dist(p2, p3) < 1e-3 ||
			dist(p2, p4) < 1e-3;

		const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

		const distToSeg1 = projectPointOntoSegment(geom.pInt, p1, p2).dist;
		const distToSeg2 = projectPointOntoSegment(geom.pInt, p3, p4).dist;
		const isNearSegments = distToSeg1 < 30 && distToSeg2 < 30;

		if (isSharedPoint || isNearSegments) {
			const sCenter = ctx.viewport.worldToScreen(geom.pInt.x, geom.pInt.y);
			const sRay1 = ctx.viewport.worldToScreen(geom.pInt.x + geom.u1.x * 20, geom.pInt.y + geom.u1.y * 20);
			const sRay2 = ctx.viewport.worldToScreen(geom.pInt.x + geom.u2.x * 20, geom.pInt.y + geom.u2.y * 20);

			const d1 = { x: sRay1.x - sCenter.x, y: sRay1.y - sCenter.y };
			const d2 = { x: sRay2.x - sCenter.x, y: sRay2.y - sCenter.y };
			const l1 = Math.hypot(d1.x, d1.y);
			const l2 = Math.hypot(d2.x, d2.y);

			let dir = { x: 1, y: -1 };
			if (l1 > 1e-4 && l2 > 1e-4) {
				const u1 = { x: d1.x / l1, y: d1.y / l1 };
				const u2 = { x: d2.x / l2, y: d2.y / l2 };
				const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
				const bisLen = Math.hypot(bis.x, bis.y);
				if (bisLen > 1e-3) {
					dir = { x: bis.x / bisLen, y: bis.y / bisLen };
				} else {
					dir = { x: -u1.y, y: u1.x };
				}
			}

			const offset = 18;
			const badgeX = sCenter.x + dir.x * offset;
			const badgeY = sCenter.y + dir.y * offset;
			ctx.renderBadge(this.id, badgeX, badgeY, '⊥');
			return;
		}

		// Fallback if segments are completely disconnected and far apart
		ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, '⊥');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, '⊥');
	}
}

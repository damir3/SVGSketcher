import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { dot, vec, add, addScaled, dist, projectPointOntoSegment, scale, sub } from '../../math/vector';

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
		const dir1 = vec(
			(paramMap.get(`${this.l1P2}.x`) ?? 0) - (paramMap.get(`${this.l1P1}.x`) ?? 0),
			(paramMap.get(`${this.l1P2}.y`) ?? 0) - (paramMap.get(`${this.l1P1}.y`) ?? 0)
		);
		const dir2 = vec(
			(paramMap.get(`${this.l2P2}.x`) ?? 0) - (paramMap.get(`${this.l2P1}.x`) ?? 0),
			(paramMap.get(`${this.l2P2}.y`) ?? 0) - (paramMap.get(`${this.l2P1}.y`) ?? 0)
		);

		const l1 = Math.max(Math.hypot(dir1.x, dir1.y), 1e-7);
		const l2 = Math.max(Math.hypot(dir2.x, dir2.y), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const dotProd = dot(dir1, dir2) / (l1 * l2);
		return [dotProd * avgL * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
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
			const sCenter = ctx.viewport.worldToScreen(geom.pInt);
			const sRay1 = ctx.viewport.worldToScreen(addScaled(geom.pInt, geom.u1, 20));
			const sRay2 = ctx.viewport.worldToScreen(addScaled(geom.pInt, geom.u2, 20));

			const d1 = sub(sRay1, sCenter);
			const d2 = sub(sRay2, sCenter);
			const l1 = Math.hypot(d1.x, d1.y);
			const l2 = Math.hypot(d2.x, d2.y);

			let dir = { x: 1, y: -1 };
			if (l1 > 1e-4 && l2 > 1e-4) {
				const u1 = scale(d1, 1.0 / l1);
				const u2 = scale(d2, 1.0 / l2);
				const bis = add(u1, u2);
				const bisLen = Math.hypot(bis.x, bis.y);
				if (bisLen > 1e-3) {
					dir = scale(bis, 1.0 / bisLen);
				} else {
					dir = { x: -u1.y, y: u1.x };
				}
			}

			const offset = 18;
			const badge = addScaled(sCenter, dir, offset);
			ctx.renderBadge(this.id, badge, '⊥');
			return;
		}

		// Fallback if segments are completely disconnected and far apart
		ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, '⊥');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, '⊥');
	}
}

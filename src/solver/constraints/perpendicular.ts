import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { Vec2, projectPointOntoSegment } from '../../math/vector';

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
		const dir1 = readParamPoint(paramMap, this.l1P2).sub(readParamPoint(paramMap, this.l1P1));
		const dir2 = readParamPoint(paramMap, this.l2P2).sub(readParamPoint(paramMap, this.l2P1));

		const l1 = Math.max(dir1.length(), 1e-7);
		const l2 = Math.max(dir2.length(), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const dotProd = dir1.dot(dir2) / (l1 * l2);
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
			p1.distanceTo(p3) < 1e-3 ||
			p1.distanceTo(p4) < 1e-3 ||
			p2.distanceTo(p3) < 1e-3 ||
			p2.distanceTo(p4) < 1e-3;

		const geom = ctx.sketch.calculateLinesAngleGeometry(p1, p2, p3, p4);

		const distToSeg1 = projectPointOntoSegment(geom.pInt, p1, p2).dist;
		const distToSeg2 = projectPointOntoSegment(geom.pInt, p3, p4).dist;
		const isNearSegments = distToSeg1 < 30 && distToSeg2 < 30;

		if (isSharedPoint || isNearSegments) {
			const sCenter = ctx.viewport.worldToScreen(geom.pInt);
			const sRay1 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u1, 20));
			const sRay2 = ctx.viewport.worldToScreen(Vec2.from(geom.pInt).addScaledVector(geom.u2, 20));

			const d1 = new Vec2().subVectors(sRay1, sCenter);
			const d2 = new Vec2().subVectors(sRay2, sCenter);
			const l1 = d1.length();
			const l2 = d2.length();

			let dir = new Vec2(1, -1);
			if (l1 > 1e-4 && l2 > 1e-4) {
				const u1 = d1.clone().multiplyScalar(1.0 / l1);
				const u2 = d2.clone().multiplyScalar(1.0 / l2);
				const bis = new Vec2().addVectors(u1, u2);
				const bisLen = bis.length();
				if (bisLen > 1e-3) {
					dir = bis.clone().multiplyScalar(1.0 / bisLen);
				} else {
					dir = u1.clone().perpendicular();
				}
			}

			const offset = 18;
			const badge = sCenter.clone().addScaledVector(dir, offset);
			ctx.renderBadge(this.id, badge, '⊥');
			return;
		}

		// Fallback if segments are completely disconnected and far apart
		ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, '⊥');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, '⊥');
	}
}

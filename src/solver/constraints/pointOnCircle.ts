import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Constrains a point to lie on the circumference of a circle or arc
 */
export class PointOnCircleConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly circleCenterId: string;
	readonly circleId: string;

	constructor(
		id: string,
		pointId: string,
		circleCenterId: string,
		circleId: string,
		weight = 1.0
	) {
		super(id, 'point_on_circle', 'Point on Circle', [pointId, circleCenterId, circleId], weight);
		this.pointId = pointId;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const dx = px - cx;
		const dy = py - cy;
		const cur = Math.hypot(dx, dy);

		return [(cur - r) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;

		const dx = px - cx;
		const dy = py - cy;
		const cur = Math.max(Math.hypot(dx, dy), 1e-7);

		const dPx = (dx / cur) * this.weight;
		const dPy = (dy / cur) * this.weight;

		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, dPx);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, dPy);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.x`, baseRow, -dPx);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.y`, baseRow, -dPy);
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, -1.0 * this.weight);

		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt.x, pt.y);
		ctx.renderBadge(this.id, s.x, s.y + 14, '⚲', COLORS.primary);
	}
}

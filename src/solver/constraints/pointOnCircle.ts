import { sub, vec } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Constrains a point to lie on the circumference of a circle or arc
 */
export class PointOnCircleConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly circleCenterId: string;
	readonly circleId: string;

	constructor(id: string, pointId: string, circleCenterId: string, circleId: string, weight = 1.0) {
		super(id, 'point_on_circle', 'Point on Circle', [pointId, circleCenterId, circleId], weight);
		this.pointId = pointId;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p = readParamPoint(paramMap, this.pointId);
		const center = readParamPoint(paramMap, this.circleCenterId);
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const dir = sub(p, center);
		const cur = Math.hypot(dir.x, dir.y);

		return [(cur - r) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const p = readParamPoint(paramMap, this.pointId);
		const center = readParamPoint(paramMap, this.circleCenterId);

		const dir = sub(p, center);
		const cur = Math.max(Math.hypot(dir.x, dir.y), 1e-7);

		const dP = vec((dir.x / cur) * this.weight, (dir.y / cur) * this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, dP.x);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, dP.y);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.x`, baseRow, -dP.x);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.y`, baseRow, -dP.y);
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, -1.0 * this.weight);

		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, { x: s.x, y: s.y + 14 }, '⚲', COLORS.primary);
	}
}

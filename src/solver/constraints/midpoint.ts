import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Midpoint constraint: midpoint equals 0.5 * (p1 + p2)
 */
export class MidpointConstraint extends BaseConstraint {
	readonly midId: string;
	readonly p1Id: string;
	readonly p2Id: string;
	readonly ratio: number;

	constructor(id: string, midId: string, p1Id: string, p2Id: string, weight = 1.0, ratio = 0.5) {
		super(id, 'midpoint', 'Midpoint', [midId, p1Id, p2Id], weight);
		this.midId = midId;
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.ratio = ratio;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const mx = paramMap.get(`${this.midId}.x`) ?? 0;
		const my = paramMap.get(`${this.midId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		const alpha = this.ratio;
		return [
			(mx - ((1 - alpha) * p1x + alpha * p2x)) * this.weight,
			(my - ((1 - alpha) * p1y + alpha * p2y)) * this.weight,
		];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const alpha = this.ratio;
		this.addJacobianEntry(res, paramIndices, `${this.midId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -alpha * this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.midId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -alpha * this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		for (const line of ctx.sketch.lines.values()) {
			if (line.isSplineHandle && ((line.p1Id === this.p1Id && line.p2Id === this.p2Id) || (line.p1Id === this.p2Id && line.p2Id === this.p1Id))) {
				return;
			}
		}
		const pt = ctx.sketch.points.get(this.midId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt.x, pt.y);
		ctx.renderBadge(this.id, s.x, s.y - 14, 'M', COLORS.primary);
	}
}

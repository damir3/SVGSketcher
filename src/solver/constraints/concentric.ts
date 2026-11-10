import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Concentric circles: centers coincide
 */
export class ConcentricConstraint extends BaseConstraint {
	readonly c1CenterId: string;
	readonly c2CenterId: string;

	constructor(id: string, c1CenterId: string, c2CenterId: string, weight = 1.0) {
		super(id, 'concentric', 'Concentric', [c1CenterId, c2CenterId], weight);
		this.c1CenterId = c1CenterId;
		this.c2CenterId = c2CenterId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1 = readParamPoint(paramMap, this.c1CenterId);
		const c2 = readParamPoint(paramMap, this.c2CenterId);

		return [(c1.x - c2.x) * this.weight, (c1.y - c2.y) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.y`, baseRow + 1, -this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.c1CenterId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, s.clone().addScalar(12), '◎', COLORS.primary);
	}
}

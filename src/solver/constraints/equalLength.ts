import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains two line segments to have equal length
 */
export class EqualLengthConstraint extends BaseConstraint {
	readonly line1P1: string;
	readonly line1P2: string;
	readonly line2P1: string;
	readonly line2P2: string;

	constructor(
		id: string,
		line1P1: string,
		line1P2: string,
		line2P1: string,
		line2P2: string,
		weight = 1.0
	) {
		super(id, 'equal_length', 'Equal Length', [line1P1, line1P2, line2P1, line2P2], weight);
		this.line1P1 = line1P1;
		this.line1P2 = line1P2;
		this.line2P1 = line2P1;
		this.line2P2 = line2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const l1 = Math.hypot(
			(paramMap.get(`${this.line1P2}.x`) ?? 0) - (paramMap.get(`${this.line1P1}.x`) ?? 0),
			(paramMap.get(`${this.line1P2}.y`) ?? 0) - (paramMap.get(`${this.line1P1}.y`) ?? 0)
		);
		const l2 = Math.hypot(
			(paramMap.get(`${this.line2P2}.x`) ?? 0) - (paramMap.get(`${this.line2P1}.x`) ?? 0),
			(paramMap.get(`${this.line2P2}.y`) ?? 0) - (paramMap.get(`${this.line2P1}.y`) ?? 0)
		);
		return [(l1 - l2) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];

		const dx1 = (paramMap.get(`${this.line1P2}.x`) ?? 0) - (paramMap.get(`${this.line1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.line1P2}.y`) ?? 0) - (paramMap.get(`${this.line1P1}.y`) ?? 0);
		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);

		const dx2 = (paramMap.get(`${this.line2P2}.x`) ?? 0) - (paramMap.get(`${this.line2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.line2P2}.y`) ?? 0) - (paramMap.get(`${this.line2P1}.y`) ?? 0);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);

		// d(l1)/dx
		this.addJacobianEntry(res, paramIndices, `${this.line1P1}.x`, baseRow, (-dx1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P1}.y`, baseRow, (-dy1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P2}.x`, baseRow, (dx1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P2}.y`, baseRow, (dy1 / l1) * this.weight);

		// -d(l2)/dx
		this.addJacobianEntry(res, paramIndices, `${this.line2P1}.x`, baseRow, (dx2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P1}.y`, baseRow, (dy2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P2}.x`, baseRow, (-dx2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P2}.y`, baseRow, (-dy2 / l2) * this.weight);

		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		ctx.renderBadgeOnSegment(this.id, this.line1P1, this.line1P2, '=');
		ctx.renderBadgeOnSegment(this.id, this.line2P1, this.line2P2, '=');
	}
}

import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains a line segment or two points to be horizontal (y1 = y2)
 */
export class HorizontalConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'horizontal', 'Horizontal', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;
		return [(p2y - p1y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		ctx.renderBadgeOnSegment(this.id, this.p1Id, this.p2Id, 'H');
	}
}

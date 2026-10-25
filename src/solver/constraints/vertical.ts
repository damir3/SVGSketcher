import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Constrains a line segment or two points to be vertical (x1 = x2)
 */
export class VerticalConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'vertical', 'Vertical', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		return [(p2x - p1x) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, this.weight);
		return res;
	}
}

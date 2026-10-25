import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Makes two points coincide
 */
export class CoincidentConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'coincident', 'Coincident', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		return [(p1x - p2x) * this.weight, (p1y - p2y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -this.weight);
		return res;
	}
}

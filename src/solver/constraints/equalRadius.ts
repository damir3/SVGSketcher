import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Constrains two circles to have equal radius
 */
export class EqualRadiusConstraint extends BaseConstraint {
	readonly circle1Id: string;
	readonly circle2Id: string;

	constructor(id: string, circle1Id: string, circle2Id: string, weight = 1.0) {
		super(id, 'equal_radius', 'Equal Radius', [circle1Id, circle2Id], weight);
		this.circle1Id = circle1Id;
		this.circle2Id = circle2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 0;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 0;
		return [(r1 - r2) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circle1Id}.r`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.circle2Id}.r`, baseRow, -this.weight);
		return res;
	}
}

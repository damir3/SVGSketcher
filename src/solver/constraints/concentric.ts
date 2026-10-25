import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

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
		const c1x = paramMap.get(`${this.c1CenterId}.x`) ?? 0;
		const c1y = paramMap.get(`${this.c1CenterId}.y`) ?? 0;
		const c2x = paramMap.get(`${this.c2CenterId}.x`) ?? 0;
		const c2y = paramMap.get(`${this.c2CenterId}.y`) ?? 0;

		return [(c1x - c2x) * this.weight, (c1y - c2y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.y`, baseRow + 1, -this.weight);
		return res;
	}
}

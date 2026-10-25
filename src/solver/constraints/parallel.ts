import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains two lines to be parallel (cross product of unit vectors = 0)
 */
export class ParallelConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'parallel', 'Parallel', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const dx1 = (paramMap.get(`${this.l1P2}.x`) ?? 0) - (paramMap.get(`${this.l1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.l1P2}.y`) ?? 0) - (paramMap.get(`${this.l1P1}.y`) ?? 0);
		const dx2 = (paramMap.get(`${this.l2P2}.x`) ?? 0) - (paramMap.get(`${this.l2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.l2P2}.y`) ?? 0) - (paramMap.get(`${this.l2P1}.y`) ?? 0);

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Cross product normalized to dimensional scale
		const cross = (dx1 * dy2 - dy1 * dx2) / (l1 * l2);
		return [cross * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

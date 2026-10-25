import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains two lines to be collinear (parallel and lying on the same line)
 */
export class CollinearConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'collinear', 'Collinear', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p11x = paramMap.get(`${this.l1P1}.x`) ?? 0;
		const p11y = paramMap.get(`${this.l1P1}.y`) ?? 0;
		const p12x = paramMap.get(`${this.l1P2}.x`) ?? 0;
		const p12y = paramMap.get(`${this.l1P2}.y`) ?? 0;

		const p21x = paramMap.get(`${this.l2P1}.x`) ?? 0;
		const p21y = paramMap.get(`${this.l2P1}.y`) ?? 0;
		const p22x = paramMap.get(`${this.l2P2}.x`) ?? 0;
		const p22y = paramMap.get(`${this.l2P2}.y`) ?? 0;

		const dx1 = p12x - p11x;
		const dy1 = p12y - p11y;
		const dx2 = p22x - p21x;
		const dy2 = p22y - p21y;

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Equation 0: Direction parallel (cross product of unit vectors)
		const cross = (dx1 * dy2 - dy1 * dx2) / (l1 * l2);
		const eq0 = cross * avgL * this.weight;

		// Equation 1: Perpendicular distance from midpoint of line 2 to infinite line 1
		const mid2x = (p21x + p22x) * 0.5;
		const mid2y = (p21y + p22y) * 0.5;
		const ptCross = (mid2x - p11x) * dy1 - (mid2y - p11y) * dx1;
		const eq1 = (ptCross / l1) * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}
}

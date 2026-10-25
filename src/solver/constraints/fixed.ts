import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Fixes a point to specific world coordinates (X0, Y0)
 */
export class FixedConstraint extends BaseConstraint {
	readonly pointId: string;
	targetX: number;
	targetY: number;

	constructor(id: string, pointId: string, targetX: number, targetY: number, weight = 1.0) {
		super(id, 'fixed', 'Fixed Point', [pointId], weight, false, false);
		this.pointId = pointId;
		this.targetX = targetX;
		this.targetY = targetY;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? this.targetX;
		const py = paramMap.get(`${this.pointId}.y`) ?? this.targetY;
		return [(px - this.targetX) * this.weight, (py - this.targetY) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow + 1, this.weight);
		return res;
	}
}

import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Soft spring constraint for interactive real-time mouse dragging
 */
export class DragPointConstraint extends BaseConstraint {
	readonly pointId: string;
	targetX: number;
	targetY: number;

	constructor(pointId: string, targetX: number, targetY: number, softWeight = 0.05) {
		super(`drag_${pointId}`, 'drag_point', 'Drag', [pointId], softWeight, true, false);
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

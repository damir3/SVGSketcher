import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains a point to lie on the infinite line passing through lineP1 and lineP2
 */
export class PointOnLineConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;

	constructor(id: string, pointId: string, lineP1Id: string, lineP2Id: string, weight = 1.0) {
		super(id, 'point_on_line', 'Point on Line', [pointId, lineP1Id, lineP2Id], weight);
		this.pointId = pointId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Perpendicular distance from point to line
		const cross = (px - p1x) * dy - (py - p1y) * dx;
		return [(cross / lineLen) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

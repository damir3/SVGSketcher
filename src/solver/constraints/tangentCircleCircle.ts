import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains two circles or arcs to be tangent to each other (either externally or internally)
 */
export class TangentCircleCircleConstraint extends BaseConstraint {
	readonly circle1CenterId: string;
	readonly circle1Id: string;
	readonly circle2CenterId: string;
	readonly circle2Id: string;
	readonly isInternal: boolean;
	readonly outerCircleId: string | null;

	constructor(
		id: string,
		circle1CenterId: string,
		circle1Id: string,
		circle2CenterId: string,
		circle2Id: string,
		isInternal = false,
		outerCircleId: string | null = null,
		weight = 1.0
	) {
		super(id, 'tangent_circle_circle', 'Tangent', [circle1CenterId, circle1Id, circle2CenterId, circle2Id], weight);
		this.circle1CenterId = circle1CenterId;
		this.circle1Id = circle1Id;
		this.circle2CenterId = circle2CenterId;
		this.circle2Id = circle2Id;
		this.isInternal = isInternal;
		this.outerCircleId = outerCircleId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1x = paramMap.get(`${this.circle1CenterId}.x`) ?? 0;
		const c1y = paramMap.get(`${this.circle1CenterId}.y`) ?? 0;
		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 10;

		const c2x = paramMap.get(`${this.circle2CenterId}.x`) ?? 0;
		const c2y = paramMap.get(`${this.circle2CenterId}.y`) ?? 0;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 10;

		const dx = c2x - c1x;
		const dy = c2y - c1y;
		const dist = Math.max(Math.hypot(dx, dy), 1e-7);

		let targetDist: number;
		if (!this.isInternal || !this.outerCircleId) {
			targetDist = r1 + r2;
		} else if (this.outerCircleId === this.circle1Id) {
			targetDist = r1 - r2;
		} else {
			targetDist = r2 - r1;
		}

		return [(dist - targetDist) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

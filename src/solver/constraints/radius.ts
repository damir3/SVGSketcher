import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Dimensional constraint: circle radius equals value
 */
export class RadiusConstraint extends BaseConstraint {
	readonly circleId: string;
	targetRadius: number;
	leaderAngle?: number;
	displayMode: 'radius' | 'diameter';

	constructor(
		id: string,
		circleId: string,
		targetRadius: number,
		weight = 1.0,
		leaderAngle?: number,
		displayMode: 'radius' | 'diameter' = 'radius'
	) {
		const valStr = displayMode === 'diameter'
			? Number((targetRadius * 2).toFixed(2))
			: Number(targetRadius.toFixed(2));
		const label = displayMode === 'diameter'
			? `Diameter (${valStr})`
			: `Radius (${valStr})`;
		super(id, 'radius', label, [circleId], weight, false, true, targetRadius);
		this.circleId = circleId;
		this.targetRadius = targetRadius;
		this.leaderAngle = leaderAngle;
		this.displayMode = displayMode;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const r = paramMap.get(`${this.circleId}.r`) ?? this.targetRadius;
		return [(r - this.targetRadius) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, this.weight);
		return res;
	}
}

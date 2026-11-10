import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';

/**
 * Structural constraint ensuring arc start and end points remain at distance r from center
 */
export class ArcEndpointsConstraint extends BaseConstraint {
	readonly arcId: string;
	readonly centerId: string;
	readonly startPointId: string;
	readonly endPointId: string;

	constructor(id: string, arcId: string, centerId: string, startPointId: string, endPointId: string, weight = 1.0) {
		super(id, 'arc_endpoints', 'Arc Endpoints', [arcId, centerId, startPointId, endPointId], weight, false, false);
		this.arcId = arcId;
		this.centerId = centerId;
		this.startPointId = startPointId;
		this.endPointId = endPointId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const center = readParamPoint(paramMap, this.centerId);
		const s = readParamPoint(paramMap, this.startPointId);
		const end = readParamPoint(paramMap, this.endPointId);
		const r = paramMap.get(`${this.arcId}.r`) ?? 10;

		const ds = center.distanceTo(s);
		const de = center.distanceTo(end);

		return [(ds - r) * this.weight, (de - r) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const center = readParamPoint(paramMap, this.centerId);
		const s = readParamPoint(paramMap, this.startPointId);
		const end = readParamPoint(paramMap, this.endPointId);

		const ds = Math.max(center.distanceTo(s), 1e-7);
		const de = Math.max(center.distanceTo(end), 1e-7);

		// Row 0: dist(C, S) - r = 0
		const startDerivative = s.sub(center).divideScalar(ds).multiplyScalar(this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.x`, baseRow, startDerivative.x);
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.y`, baseRow, startDerivative.y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow, -startDerivative.x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow, -startDerivative.y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow, -1.0 * this.weight);

		// Row 1: dist(C, E) - r = 0
		const endDerivative = end.sub(center).divideScalar(de).multiplyScalar(this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.x`, baseRow + 1, endDerivative.x);
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.y`, baseRow + 1, endDerivative.y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow + 1, -endDerivative.x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow + 1, -endDerivative.y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow + 1, -1.0 * this.weight);

		return res;
	}
}

import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';

/**
 * Structural constraint ensuring arc start and end points remain at distance r from center
 */
export class ArcEndpointsConstraint extends BaseConstraint {
	readonly arcId: string;
	readonly centerId: string;
	readonly startPointId: string;
	readonly endPointId: string;

	constructor(
		id: string,
		arcId: string,
		centerId: string,
		startPointId: string,
		endPointId: string,
		weight = 1.0
	) {
		super(
			id,
			'arc_endpoints',
			'Arc Endpoints',
			[arcId, centerId, startPointId, endPointId],
			weight,
			false,
			false
		);
		this.arcId = arcId;
		this.centerId = centerId;
		this.startPointId = startPointId;
		this.endPointId = endPointId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;
		const r = paramMap.get(`${this.arcId}.r`) ?? 10;

		const ds = Math.hypot(sx - cx, sy - cy);
		const de = Math.hypot(ex - cx, ey - cy);

		return [(ds - r) * this.weight, (de - r) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;

		const ds = Math.max(Math.hypot(sx - cx, sy - cy), 1e-7);
		const de = Math.max(Math.hypot(ex - cx, ey - cy), 1e-7);

		// Row 0: dist(C, S) - r = 0
		const dS_x = ((sx - cx) / ds) * this.weight;
		const dS_y = ((sy - cy) / ds) * this.weight;
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.x`, baseRow, dS_x);
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.y`, baseRow, dS_y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow, -dS_x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow, -dS_y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow, -1.0 * this.weight);

		// Row 1: dist(C, E) - r = 0
		const dE_x = ((ex - cx) / de) * this.weight;
		const dE_y = ((ey - cy) / de) * this.weight;
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.x`, baseRow + 1, dE_x);
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.y`, baseRow + 1, dE_y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow + 1, -dE_x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow + 1, -dE_y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow + 1, -1.0 * this.weight);

		return res;
	}
}

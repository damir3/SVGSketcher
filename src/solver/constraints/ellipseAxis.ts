import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains the major axis and minor axis of an ellipse / elliptical arc to be perpendicular
 */
export class EllipseAxisConstraint extends BaseConstraint {
	readonly ellipseId: string;
	readonly centerId: string;
	readonly majorAxisPointId: string;
	readonly minorAxisPointId: string;

	constructor(
		id: string,
		ellipseId: string,
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		weight = 1.0
	) {
		super(id, 'ellipse_axis', 'Ellipse Axis Perpendicularity', [centerId, majorAxisPointId, minorAxisPointId], weight);
		this.ellipseId = ellipseId;
		this.centerId = centerId;
		this.majorAxisPointId = majorAxisPointId;
		this.minorAxisPointId = minorAxisPointId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const x1 = paramMap.get(`${this.majorAxisPointId}.x`) ?? 0;
		const y1 = paramMap.get(`${this.majorAxisPointId}.y`) ?? 0;
		const x2 = paramMap.get(`${this.minorAxisPointId}.x`) ?? 0;
		const y2 = paramMap.get(`${this.minorAxisPointId}.y`) ?? 0;

		const dx1 = x1 - cx;
		const dy1 = y1 - cy;
		const dx2 = x2 - cx;
		const dy2 = y2 - cy;

		const r1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const r2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgR = (r1 + r2) * 0.5;

		const dot = (dx1 * dx2 + dy1 * dy2) / (r1 * r2);
		return [dot * avgR * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

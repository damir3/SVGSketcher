import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';

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
		const center = readParamPoint(paramMap, this.centerId);
		const p1 = readParamPoint(paramMap, this.majorAxisPointId);
		const p2 = readParamPoint(paramMap, this.minorAxisPointId);

		const dir1 = new Vec2().subVectors(p1, center);
		const dir2 = new Vec2().subVectors(p2, center);

		const r1 = Math.max(dir1.length(), 1e-7);
		const r2 = Math.max(dir2.length(), 1e-7);
		const avgR = (r1 + r2) * 0.5;

		const alignment = dir1.dot(dir2) / (r1 * r2);
		return [alignment * avgR * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

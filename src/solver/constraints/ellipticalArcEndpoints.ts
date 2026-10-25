import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains endpoints of an elliptical arc to lie on the ellipse defined by center, major axis, and minor axis
 */
export class EllipticalArcEndpointsConstraint extends BaseConstraint {
	readonly arcId: string;
	readonly centerId: string;
	readonly majorAxisPointId: string;
	readonly minorAxisPointId: string;
	readonly startPointId: string;
	readonly endPointId: string;

	constructor(
		id: string,
		arcId: string,
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		startPointId: string,
		endPointId: string,
		weight = 1.0
	) {
		super(
			id,
			'elliptical_arc_endpoints',
			'Elliptical Arc Endpoints',
			[centerId, majorAxisPointId, minorAxisPointId, startPointId, endPointId],
			weight
		);
		this.arcId = arcId;
		this.centerId = centerId;
		this.majorAxisPointId = majorAxisPointId;
		this.minorAxisPointId = minorAxisPointId;
		this.startPointId = startPointId;
		this.endPointId = endPointId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const x1 = paramMap.get(`${this.majorAxisPointId}.x`) ?? 0;
		const y1 = paramMap.get(`${this.majorAxisPointId}.y`) ?? 0;
		const x2 = paramMap.get(`${this.minorAxisPointId}.x`) ?? 0;
		const y2 = paramMap.get(`${this.minorAxisPointId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;

		const uX = x1 - cx;
		const uY = y1 - cy;
		const vX = x2 - cx;
		const vY = y2 - cy;

		const rx = Math.max(Math.hypot(uX, uY), 1e-7);
		const ry = Math.max(Math.hypot(vX, vY), 1e-7);
		const avgR = (rx + ry) * 0.5;

		// Unit axis vectors
		const uHatX = uX / rx;
		const uHatY = uY / rx;
		const vHatX = vX / ry;
		const vHatY = vY / ry;

		// Start point local coords
		const dsX = sx - cx;
		const dsY = sy - cy;
		const uS = dsX * uHatX + dsY * uHatY;
		const vS = dsX * vHatX + dsY * vHatY;
		const resS = ((uS * uS) / (rx * rx) + (vS * vS) / (ry * ry) - 1.0) * avgR * this.weight;

		// End point local coords
		const deX = ex - cx;
		const deY = ey - cy;
		const uE = deX * uHatX + deY * uHatY;
		const vE = deX * vHatX + deY * vHatY;
		const resE = ((uE * uE) / (rx * rx) + (vE * vE) / (ry * ry) - 1.0) * avgR * this.weight;

		return [resS, resE];
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

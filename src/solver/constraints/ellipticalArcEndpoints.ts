import { dot, scale, sub } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';

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
		const center = readParamPoint(paramMap, this.centerId);
		const p1 = readParamPoint(paramMap, this.majorAxisPointId);
		const p2 = readParamPoint(paramMap, this.minorAxisPointId);
		const s = readParamPoint(paramMap, this.startPointId);
		const end = readParamPoint(paramMap, this.endPointId);

		const u = sub(p1, center);
		const v = sub(p2, center);

		const rx = Math.max(Math.hypot(u.x, u.y), 1e-7);
		const ry = Math.max(Math.hypot(v.x, v.y), 1e-7);
		const avgR = (rx + ry) * 0.5;

		// Unit axis vectors
		const uHat = scale(u, 1 / rx);
		const vHat = scale(v, 1 / ry);

		// Start point local coords
		const ds = sub(s, center);
		const uS = dot(ds, uHat);
		const vS = dot(ds, vHat);
		const resS = ((uS * uS) / (rx * rx) + (vS * vS) / (ry * ry) - 1.0) * avgR * this.weight;

		// End point local coords
		const de = sub(end, center);
		const uE = dot(de, uHat);
		const vE = dot(de, vHat);
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

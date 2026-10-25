import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Dimensional constraint: angle between two lines equals targetAngle (in degrees)
 */
export class AngleConstraint extends BaseConstraint {
	readonly line1Id: string;
	readonly line2Id: string;
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;
	targetAngle: number; // in degrees
	arcRadius?: number; // visual radius in world units
	s1: number; // orientation factor for line 1 (+1 or -1)
	s2: number; // orientation factor for line 2 (+1 or -1)
	sign: number; // cross direction factor (+1 or -1)

	constructor(
		id: string,
		line1Id: string,
		line2Id: string,
		l1P1: string,
		l1P2: string,
		l2P1: string,
		l2P2: string,
		targetAngle: number,
		arcRadius = 40,
		s1 = 1,
		s2 = 1,
		sign = 1,
		weight = 1.0
	) {
		super(
			id,
			'angle',
			'Angle',
			[line1Id, line2Id, l1P1, l1P2, l2P1, l2P2],
			weight,
			false,
			true,
			targetAngle
		);
		this.line1Id = line1Id;
		this.line2Id = line2Id;
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
		this.targetAngle = targetAngle;
		this.arcRadius = arcRadius;
		this.s1 = s1;
		this.s2 = s2;
		this.sign = sign;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.l1P1}.x`) ?? 0;
		const p1y = paramMap.get(`${this.l1P1}.y`) ?? 0;
		const p2x = paramMap.get(`${this.l1P2}.x`) ?? 0;
		const p2y = paramMap.get(`${this.l1P2}.y`) ?? 0;
		const p3x = paramMap.get(`${this.l2P1}.x`) ?? 0;
		const p3y = paramMap.get(`${this.l2P1}.y`) ?? 0;
		const p4x = paramMap.get(`${this.l2P2}.x`) ?? 0;
		const p4y = paramMap.get(`${this.l2P2}.y`) ?? 0;

		const dx1 = (p2x - p1x) * this.s1;
		const dy1 = (p2y - p1y) * this.s1;
		const dx2 = (p4x - p3x) * this.s2;
		const dy2 = (p4y - p3y) * this.s2;

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const u1x = dx1 / l1;
		const u1y = dy1 / l1;
		const u2x = dx2 / l2;
		const u2y = dy2 / l2;

		const targetRad = (this.targetAngle * Math.PI) / 180;
		const rotAngle = this.sign * targetRad;
		const cosA = Math.cos(rotAngle);
		const sinA = Math.sin(rotAngle);

		// Rotate u1 by rotAngle
		const rx = u1x * cosA - u1y * sinA;
		const ry = u1x * sinA + u1y * cosA;

		// Cross product between rotated u1 and u2
		const cross = rx * u2y - ry * u2x;
		return [cross * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

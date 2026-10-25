import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';

/**
 * Constrains two points to be symmetric with respect to an infinite line (lineP1 to lineP2)
 */
export class SymmetryConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly lineId?: string;

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		lineP1Id: string,
		lineP2Id: string,
		weight = 1.0,
		lineId?: string
	) {
		super(id, 'symmetry', 'Symmetry', [p1Id, p2Id, lineP1Id, lineP2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.lineId = lineId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		const ax = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const ay = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const bx = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const by = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = bx - ax;
		const dy = by - ay;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Equation 0: Midpoint of (P1, P2) lies on the line AB
		const mx = (p1x + p2x) * 0.5;
		const my = (p1y + p2y) * 0.5;
		const cross = (mx - ax) * dy - (my - ay) * dx;
		const eq0 = (cross / lineLen) * this.weight;

		// Equation 1: Chord vector (P2 - P1) is perpendicular to line AB
		const cx = p2x - p1x;
		const cy = p2y - p1y;
		const dot = (cx * dx + cy * dy) / lineLen;
		const eq1 = dot * this.weight;

		return [eq0, eq1];
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

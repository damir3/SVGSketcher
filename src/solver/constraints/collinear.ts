import { cross, mid, sub } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains two lines or three points to be collinear (parallel and lying on the same line)
 */
export class CollinearConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'collinear', 'Collinear', [...new Set([l1P1, l1P2, l2P1, l2P2].filter(Boolean))], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	isThreePoint(): boolean {
		return this.l1P1 === this.l2P1 || this.l1P1 === this.l2P2 || this.l1P2 === this.l2P1 || this.l1P2 === this.l2P2;
	}

	override getEquationsCount(): number {
		return this.isThreePoint() ? 1 : 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p11 = readParamPoint(paramMap, this.l1P1);
		const p12 = readParamPoint(paramMap, this.l1P2);

		const p21 = readParamPoint(paramMap, this.l2P1);
		const p22 = readParamPoint(paramMap, this.l2P2);

		const dir1 = sub(p12, p11);
		const dir2 = sub(p22, p21);

		const l1 = Math.max(Math.hypot(dir1.x, dir1.y), 1e-7);
		const l2 = Math.max(Math.hypot(dir2.x, dir2.y), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Equation 0: Direction parallel (cross product of unit vectors)
		const eq0 = (cross(dir1, dir2) / (l1 * l2)) * avgL * this.weight;

		if (this.isThreePoint()) {
			return [eq0];
		}

		// Equation 1: Perpendicular distance from midpoint of line 2 to infinite line 1
		const mid2 = mid(p21, p22);
		const ptCross = cross(sub(mid2, p11), dir1);
		const eq1 = (ptCross / l1) * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		if (this.isThreePoint()) {
			return j0;
		}
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}

	override render(ctx: ConstraintRenderContext): void {
		ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, 'collinear');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, 'collinear');
	}
}

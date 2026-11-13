import { Vec2 } from '../../math/vector';
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
		super(
			id,
			'collinear',
			l1P1 === 'origin' && (l1P2 === 'axis_x' || l1P2 === 'axis_y')
				? `Collinear with ${l1P2 === 'axis_x' ? 'X' : 'Y'}-Axis`
				: 'Collinear',
			[...new Set([l1P1, l1P2, l2P1, l2P2].filter(Boolean))],
			weight
		);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	get axisCoordinate(): 'x' | 'y' | undefined {
		return this.l1P1 === 'origin'
			? this.l1P2 === 'axis_x'
				? 'y'
				: this.l1P2 === 'axis_y'
					? 'x'
					: undefined
			: undefined;
	}

	isThreePoint(): boolean {
		return this.l1P1 === this.l2P1 || this.l1P1 === this.l2P2 || this.l1P2 === this.l2P1 || this.l1P2 === this.l2P2;
	}

	override getEquationsCount(): number {
		return this.axisCoordinate ? 2 : this.isThreePoint() ? 1 : 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		if (this.axisCoordinate)
			return [this.l2P1, this.l2P2].map(id => (paramMap.get(`${id}.${this.axisCoordinate}`) ?? 0) * this.weight);
		const p11 = readParamPoint(paramMap, this.l1P1);
		const p12 = readParamPoint(paramMap, this.l1P2);

		const p21 = readParamPoint(paramMap, this.l2P1);
		const p22 = readParamPoint(paramMap, this.l2P2);

		const dir1 = new Vec2().subVectors(p12, p11);
		const dir2 = new Vec2().subVectors(p22, p21);

		const l1 = Math.max(dir1.length(), 1e-7);
		const l2 = Math.max(dir2.length(), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Equation 0: Direction parallel (cross product of unit vectors)
		const eq0 = (dir1.cross(dir2) / (l1 * l2)) * avgL * this.weight;

		if (this.isThreePoint()) {
			return [eq0];
		}

		// Equation 1: Perpendicular distance from midpoint of line 2 to infinite line 1
		const mid2 = new Vec2().midpoint(p21, p22);
		const ptCross = new Vec2().subVectors(mid2, p11).cross(dir1);
		const eq1 = (ptCross / l1) * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		if (this.axisCoordinate) {
			const entries: JacobianEntry[] = [];
			[this.l2P1, this.l2P2].forEach((id, row) =>
				this.addJacobianEntry(entries, paramIndices, `${id}.${this.axisCoordinate}`, baseRow + row, this.weight)
			);
			return entries;
		}
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		if (this.isThreePoint()) {
			return j0;
		}
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}

	override render(ctx: ConstraintRenderContext): void {
		if (!this.axisCoordinate) ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, 'collinear');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, 'collinear');
	}
}

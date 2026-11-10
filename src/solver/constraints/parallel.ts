import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains two lines to be parallel (cross product of unit vectors = 0)
 */
export class ParallelConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'parallel', 'Parallel', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const dir1 = readParamPoint(paramMap, this.l1P2).sub(readParamPoint(paramMap, this.l1P1));
		const dir2 = readParamPoint(paramMap, this.l2P2).sub(readParamPoint(paramMap, this.l2P1));

		const l1 = Math.max(dir1.length(), 1e-7);
		const l2 = Math.max(dir2.length(), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Cross product normalized to dimensional scale
		return [(dir1.cross(dir2) / (l1 * l2)) * avgL * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		// Forward-difference error can make parallelism appear independent of
		// redundant rectangle constraints, hiding a real degree of freedom.
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap, true);
	}

	override render(ctx: ConstraintRenderContext): void {
		ctx.renderBadgeOnSegment(this.id, this.l1P1, this.l1P2, '//');
		ctx.renderBadgeOnSegment(this.id, this.l2P1, this.l2P2, '//');
	}
}

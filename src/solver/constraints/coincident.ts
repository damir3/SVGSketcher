import type { Vec2 } from '../../math/vector';
import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import { distanceToPoint } from '../../math/hitTest';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Makes two points coincide
 */
export class CoincidentConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(
			id,
			'coincident',
			p1Id === 'origin' || p2Id === 'origin' ? 'Coincident with (0,0)' : 'Coincident',
			[p1Id, p2Id],
			weight
		);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		return [(p1.x - p2.x) * this.weight, (p1.y - p2.y) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -this.weight);
		return res;
	}

	override distanceTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): number | null {
		const point = sketch.points.get(this.p1Id);
		if (!point) return null;
		const position = viewport.worldToScreen(point);
		return distanceToPoint(screen, position.subScalar(12));
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.p1Id);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, s.clone().subScalar(12), '●', COLORS.primary);
	}
}

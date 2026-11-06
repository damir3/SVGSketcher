import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';
import { distanceToPoint } from '../../math/hitTest';

/**
 * Midpoint constraint: midpoint equals 0.5 * (p1 + p2)
 */
export class MidpointConstraint extends BaseConstraint {
	readonly midId: string;
	readonly p1Id: string;
	readonly p2Id: string;
	readonly ratio: number;

	constructor(id: string, midId: string, p1Id: string, p2Id: string, weight = 1.0, ratio = 0.5) {
		super(id, 'midpoint', 'Midpoint', [midId, p1Id, p2Id], weight);
		this.midId = midId;
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.ratio = ratio;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const midpoint = readParamPoint(paramMap, this.midId);
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		const alpha = this.ratio;
		return [
			(midpoint.x - ((1 - alpha) * p1.x + alpha * p2.x)) * this.weight,
			(midpoint.y - ((1 - alpha) * p1.y + alpha * p2.y)) * this.weight,
		];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const alpha = this.ratio;
		this.addJacobianEntry(res, paramIndices, `${this.midId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -alpha * this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.midId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -alpha * this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		for (const line of ctx.sketch.lines.values()) {
			if (
				line.isSplineHandle &&
				((line.p1Id === this.p1Id && line.p2Id === this.p2Id) || (line.p1Id === this.p2Id && line.p2Id === this.p1Id))
			) {
				return;
			}
		}
		const pt = ctx.sketch.points.get(this.midId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, { x: s.x, y: s.y - 14 }, 'M', COLORS.primary);
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pt = sketch.points.get(this.midId);
		if (!pt) return null;
		const s = viewport.worldToScreen(pt);
		return distanceToPoint(screen, { x: s.x, y: s.y - 14 });
	}
}

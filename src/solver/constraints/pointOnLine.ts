import { cross, sub, type Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

export function signedDistanceToLine(point: Vec2, start: Vec2, end: Vec2): number {
	const dir = sub(end, start);
	const lineLen = Math.max(Math.hypot(dir.x, dir.y), 1e-7);
	return cross(sub(point, start), dir) / lineLen;
}

/**
 * Constrains a point to lie on the infinite line passing through lineP1 and lineP2
 */
export class PointOnLineConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;

	constructor(id: string, pointId: string, lineP1Id: string, lineP2Id: string, weight = 1.0) {
		super(id, 'point_on_line', 'Point on Line', [pointId, lineP1Id, lineP2Id], weight);
		this.pointId = pointId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p = readParamPoint(paramMap, this.pointId);
		const p1 = readParamPoint(paramMap, this.lineP1Id);
		const p2 = readParamPoint(paramMap, this.lineP2Id);

		return [signedDistanceToLine(p, p1, p2) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, { x: s.x, y: s.y + 14 }, '⚲', COLORS.primary);
	}
}

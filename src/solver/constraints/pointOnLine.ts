import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import { distanceToPoint } from '../../math/hitTest';
import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

export function signedDistanceToLine(point: Vec2, start: Vec2, end: Vec2): number {
	const dir = new Vec2().subVectors(end, start);
	const lineLen = Math.max(dir.length(), 1e-7);
	return new Vec2().subVectors(point, start).cross(dir) / lineLen;
}

/**
 * Constrains a point to lie on the infinite line passing through lineP1 and lineP2
 */
export class PointOnLineConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;

	constructor(id: string, pointId: string, lineP1Id: string, lineP2Id: string, weight = 1.0) {
		super(
			id,
			'point_on_line',
			lineP1Id === 'origin' && (lineP2Id === 'axis_x' || lineP2Id === 'axis_y')
				? `Point on ${lineP2Id === 'axis_x' ? 'X' : 'Y'}-Axis`
				: 'Point on Line',
			[pointId, lineP1Id, lineP2Id],
			weight
		);
		this.pointId = pointId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
	}

	get axisCoordinate(): 'x' | 'y' | undefined {
		return this.lineP1Id === 'origin'
			? this.lineP2Id === 'axis_x'
				? 'y'
				: this.lineP2Id === 'axis_y'
					? 'x'
					: undefined
			: undefined;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		if (this.axisCoordinate) return [(paramMap.get(`${this.pointId}.${this.axisCoordinate}`) ?? 0) * this.weight];
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
		if (this.axisCoordinate) {
			const entries: JacobianEntry[] = [];
			this.addJacobianEntry(entries, paramIndices, `${this.pointId}.${this.axisCoordinate}`, baseRow, this.weight);
			return entries;
		}
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override distanceTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): number | null {
		const point = sketch.points.get(this.pointId);
		if (!point) return null;
		const position = viewport.worldToScreen(point);
		return distanceToPoint(screen, new Vec2(position.x, position.y + 14));
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt);
		ctx.renderBadge(this.id, new Vec2(s.x, s.y + 14), '⚲', COLORS.primary);
	}
}

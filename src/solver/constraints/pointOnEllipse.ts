import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

/**
 * Constrains a point to lie on the perimeter of an ellipse or elliptical arc
 */
export class PointOnEllipseConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly ellipseId: string;
	readonly centerId: string;
	readonly majorAxisPointId: string;
	readonly minorAxisPointId: string;

	constructor(
		id: string,
		pointId: string,
		ellipseId: string,
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		weight = 1.0
	) {
		super(
			id,
			'point_on_ellipse',
			'Point on Ellipse',
			[pointId, centerId, majorAxisPointId, minorAxisPointId, ellipseId],
			weight
		);
		this.pointId = pointId;
		this.ellipseId = ellipseId;
		this.centerId = centerId;
		this.majorAxisPointId = majorAxisPointId;
		this.minorAxisPointId = minorAxisPointId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p = readParamPoint(paramMap, this.pointId);
		const center = readParamPoint(paramMap, this.centerId);
		const p1 = readParamPoint(paramMap, this.majorAxisPointId);
		const p2 = readParamPoint(paramMap, this.minorAxisPointId);

		const axisU = new Vec2().subVectors(p1, center);
		const axisV = new Vec2().subVectors(p2, center);

		const rx = Math.max(axisU.length(), 1e-7);
		const ry = Math.max(axisV.length(), 1e-7);
		const avgR = (rx + ry) * 0.5;

		const uHat = axisU.clone().multiplyScalar(1 / rx);
		const vHat = axisV.clone().multiplyScalar(1 / ry);

		const dir = new Vec2().subVectors(p, center);
		const u = dir.dot(uHat);
		const v = dir.dot(vHat);

		const res = ((u * u) / (rx * rx) + (v * v) / (ry * ry) - 1.0) * avgR * this.weight;
		return [res];
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
		ctx.renderBadge(this.id, new Vec2(s.x, s.y + 14), '⚲', COLORS.primary);
	}
}

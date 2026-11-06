import { dot, scale, sub } from '../../math/vector';
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

		const axisU = sub(p1, center);
		const axisV = sub(p2, center);

		const rx = Math.max(Math.hypot(axisU.x, axisU.y), 1e-7);
		const ry = Math.max(Math.hypot(axisV.x, axisV.y), 1e-7);
		const avgR = (rx + ry) * 0.5;

		const uHat = scale(axisU, 1 / rx);
		const vHat = scale(axisV, 1 / ry);

		const dir = sub(p, center);
		const u = dot(dir, uHat);
		const v = dot(dir, vHat);

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
		ctx.renderBadge(this.id, { x: s.x, y: s.y + 14 }, '⚲', COLORS.primary);
	}
}

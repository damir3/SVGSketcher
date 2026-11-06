import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
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
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const x1 = paramMap.get(`${this.majorAxisPointId}.x`) ?? 0;
		const y1 = paramMap.get(`${this.majorAxisPointId}.y`) ?? 0;
		const x2 = paramMap.get(`${this.minorAxisPointId}.x`) ?? 0;
		const y2 = paramMap.get(`${this.minorAxisPointId}.y`) ?? 0;

		const uX = x1 - cx;
		const uY = y1 - cy;
		const vX = x2 - cx;
		const vY = y2 - cy;

		const rx = Math.max(Math.hypot(uX, uY), 1e-7);
		const ry = Math.max(Math.hypot(vX, vY), 1e-7);
		const avgR = (rx + ry) * 0.5;

		const uHatX = uX / rx;
		const uHatY = uY / rx;
		const vHatX = vX / ry;
		const vHatY = vY / ry;

		const dx = px - cx;
		const dy = py - cy;
		const u = dx * uHatX + dy * uHatY;
		const v = dx * vHatX + dy * vHatY;

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

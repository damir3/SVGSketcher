import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains a line (or coordinate axis) to be tangent to a circle/arc
 */
export class TangentLineCircleConstraint extends BaseConstraint {
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly circleCenterId: string;
	readonly circleId: string;
	readonly initialSide: number; // +1 or -1
	readonly lineId?: string;

	constructor(
		id: string,
		lineP1Id: string,
		lineP2Id: string,
		circleCenterId: string,
		circleId: string,
		initialSide = 1,
		weight = 1.0,
		lineId?: string
	) {
		super(
			id,
			'tangent_line_circle',
			'Tangent',
			[lineP1Id, lineP2Id, circleCenterId, circleId, lineId].filter((x): x is string => Boolean(x)),
			weight
		);
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
		this.initialSide = initialSide >= 0 ? 1 : -1;
		this.lineId = lineId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const isAxisX = this.lineId === 'axis_x' || this.lineP1Id === 'axis_x';
		const isAxisY = this.lineId === 'axis_y' || this.lineP1Id === 'axis_y';

		const p1x = isAxisX || isAxisY ? 0 : (paramMap.get(`${this.lineP1Id}.x`) ?? 0);
		const p1y = isAxisX || isAxisY ? 0 : (paramMap.get(`${this.lineP1Id}.y`) ?? 0);
		const p2x = isAxisX ? 1 : isAxisY ? 0 : (paramMap.get(`${this.lineP2Id}.x`) ?? 0);
		const p2y = isAxisX ? 0 : isAxisY ? 1 : (paramMap.get(`${this.lineP2Id}.y`) ?? 0);

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Signed distance from center to line
		const signedDist = ((cx - p1x) * dy - (cy - p1y) * dx) / lineLen;
		return [(signedDist - this.initialSide * r) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const isAxisX = this.lineId === 'axis_x' || this.lineP1Id === 'axis_x';
		const isAxisY = this.lineId === 'axis_y' || this.lineP1Id === 'axis_y';
		const isAxis = isAxisX || isAxisY;

		const p1 = isAxis ? { x: 0, y: 0 } : ctx.sketch.points.get(this.lineP1Id);
		const p2 = isAxisX ? { x: 100, y: 0 } : isAxisY ? { x: 0, y: 100 } : ctx.sketch.points.get(this.lineP2Id);
		const circle = ctx.sketch.circles.get(this.circleId);
		const arc = ctx.sketch.arcs.get(this.circleId);
		const entity = circle ?? arc;
		if (!p1 || !p2 || !entity) return;

		const center = ctx.sketch.points.get(entity.centerId);
		if (!center) return;

		const sCenter = ctx.viewport.worldToScreen(center.x, center.y);
		const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
		const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
		const rScreen = entity.radius * ctx.viewport.zoom;

		const dx = s2.x - s1.x;
		const dy = s2.y - s1.y;
		const lineLen = Math.hypot(dx, dy);
		if (lineLen < 1e-4) return;

		const ux = dx / lineLen;
		const uy = dy / lineLen;

		const vx = sCenter.x - s1.x;
		const vy = sCenter.y - s1.y;
		const t = vx * ux + vy * uy;
		const projX = s1.x + t * ux;
		const projY = s1.y + t * uy;

		const normX = projX - sCenter.x;
		const normY = projY - sCenter.y;
		const normDist = Math.hypot(normX, normY);

		let dirX = 0;
		let dirY = 0;
		if (normDist > 1e-3) {
			dirX = normX / normDist;
			dirY = normY / normDist;
		} else {
			dirX = -uy;
			dirY = ux;
		}

		const circPtX = sCenter.x + dirX * rScreen;
		const circPtY = sCenter.y + dirY * rScreen;
		const tanX = (projX + circPtX) * 0.5;
		const tanY = (projY + circPtY) * 0.5;

		const distToSeg = isAxis ? 0 : t < 0 ? -t : t > lineLen ? t - lineLen : 0;
		const distToCirc = Math.abs(normDist - rScreen);

		const isNearArc = arc && ctx.isAngleNearArc ? ctx.isAngleNearArc(arc, center, tanX, tanY, rScreen) : true;
		const isNear = distToSeg < 60 && distToCirc < 60 && isNearArc;

		if (isNear) {
			const offset = 14;
			const badgeX = tanX - dirX * offset;
			const badgeY = tanY - dirY * offset;
			ctx.renderBadge(this.id, badgeX, badgeY, 'tangent');
			return;
		}

		// Fallback if entities are completely disconnected and far apart
		if (!isAxis) {
			ctx.renderBadgeOnSegment(this.id, this.lineP1Id, this.lineP2Id, 'tangent');
		}
		ctx.renderBadgeOnCircle(this.id, this.circleId, 'tangent');
	}
}

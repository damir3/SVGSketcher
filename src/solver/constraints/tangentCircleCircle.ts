import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';

/**
 * Constrains two circles or arcs to be tangent to each other (either externally or internally)
 */
export class TangentCircleCircleConstraint extends BaseConstraint {
	readonly circle1CenterId: string;
	readonly circle1Id: string;
	readonly circle2CenterId: string;
	readonly circle2Id: string;
	readonly isInternal: boolean;
	readonly outerCircleId: string | null;
	readonly sharedPointId: string | null;

	constructor(
		id: string,
		circle1CenterId: string,
		circle1Id: string,
		circle2CenterId: string,
		circle2Id: string,
		isInternal = false,
		outerCircleId: string | null = null,
		weight = 1.0,
		sharedPointId: string | null = null
	) {
		const entities = sharedPointId
			? [circle1CenterId, circle1Id, circle2CenterId, circle2Id, sharedPointId]
			: [circle1CenterId, circle1Id, circle2CenterId, circle2Id];
		super(id, 'tangent_circle_circle', 'Tangent', entities, weight);
		this.circle1CenterId = circle1CenterId;
		this.circle1Id = circle1Id;
		this.circle2CenterId = circle2CenterId;
		this.circle2Id = circle2Id;
		this.isInternal = isInternal;
		this.outerCircleId = outerCircleId;
		this.sharedPointId = sharedPointId;
	}

	override getEquationsCount(): number {
		return this.sharedPointId ? 2 : 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1x = paramMap.get(`${this.circle1CenterId}.x`) ?? 0;
		const c1y = paramMap.get(`${this.circle1CenterId}.y`) ?? 0;
		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 10;

		const c2x = paramMap.get(`${this.circle2CenterId}.x`) ?? 0;
		const c2y = paramMap.get(`${this.circle2CenterId}.y`) ?? 0;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 10;

		const dx = c2x - c1x;
		const dy = c2y - c1y;
		const dist = Math.max(Math.hypot(dx, dy), 1e-7);

		let targetDist: number;
		if (!this.isInternal || !this.outerCircleId) {
			targetDist = r1 + r2;
		} else if (this.outerCircleId === this.circle1Id) {
			targetDist = r1 - r2;
		} else {
			targetDist = r2 - r1;
		}

		const eq0 = (dist - targetDist) * this.weight;
		if (!this.sharedPointId) {
			return [eq0];
		}

		const px = paramMap.get(`${this.sharedPointId}.x`) ?? 0;
		const py = paramMap.get(`${this.sharedPointId}.y`) ?? 0;
		const cross = ((px - c1x) * dy - (py - c1y) * dx) / dist;
		return [eq0, cross * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		if (!this.sharedPointId) {
			return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		}
		return [
			...computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap),
			...computeNumericJacobianForEquation(this, paramIndices, baseRow + 1, 1, paramMap),
		];
	}

	override render(ctx: ConstraintRenderContext): void {
		const circle1 = ctx.sketch.circles.get(this.circle1Id);
		const arc1 = ctx.sketch.arcs.get(this.circle1Id);
		const entity1 = circle1 ?? arc1;

		const circle2 = ctx.sketch.circles.get(this.circle2Id);
		const arc2 = ctx.sketch.arcs.get(this.circle2Id);
		const entity2 = circle2 ?? arc2;

		if (!entity1 || !entity2) return;

		const center1 = ctx.sketch.points.get(entity1.centerId);
		const center2 = ctx.sketch.points.get(entity2.centerId);
		if (!center1 || !center2) return;

		const sCenter1 = ctx.viewport.worldToScreen(center1.x, center1.y);
		const sCenter2 = ctx.viewport.worldToScreen(center2.x, center2.y);
		const r1Screen = entity1.radius * ctx.viewport.zoom;
		const r2Screen = entity2.radius * ctx.viewport.zoom;

		const dx = sCenter2.x - sCenter1.x;
		const dy = sCenter2.y - sCenter1.y;
		const distScreen = Math.hypot(dx, dy);

		let ux = 1;
		let uy = 0;
		if (distScreen > 1e-4) {
			ux = dx / distScreen;
			uy = dy / distScreen;
		}

		let tanPt1X: number;
		let tanPt1Y: number;
		let tanPt2X: number;
		let tanPt2Y: number;

		const isInternal = this.isInternal;
		const outerId = this.outerCircleId;

		if (!isInternal || !outerId) {
			tanPt1X = sCenter1.x + ux * r1Screen;
			tanPt1Y = sCenter1.y + uy * r1Screen;
			tanPt2X = sCenter2.x - ux * r2Screen;
			tanPt2Y = sCenter2.y - uy * r2Screen;
		} else if (outerId === this.circle1Id) {
			tanPt1X = sCenter1.x + ux * r1Screen;
			tanPt1Y = sCenter1.y + uy * r1Screen;
			tanPt2X = sCenter2.x + ux * r2Screen;
			tanPt2Y = sCenter2.y + uy * r2Screen;
		} else {
			tanPt1X = sCenter1.x - ux * r1Screen;
			tanPt1Y = sCenter1.y - uy * r1Screen;
			tanPt2X = sCenter2.x - ux * r2Screen;
			tanPt2Y = sCenter2.y - uy * r2Screen;
		}

		const tanX = (tanPt1X + tanPt2X) * 0.5;
		const tanY = (tanPt1Y + tanPt2Y) * 0.5;

		const distBetweenContactPts = Math.hypot(tanPt2X - tanPt1X, tanPt2Y - tanPt1Y);

		let isNearArc1 = true;
		if (arc1 && ctx.isAngleNearArc) {
			isNearArc1 = ctx.isAngleNearArc(arc1, center1, tanX, tanY, r1Screen);
		}
		let isNearArc2 = true;
		if (arc2 && ctx.isAngleNearArc) {
			isNearArc2 = ctx.isAngleNearArc(arc2, center2, tanX, tanY, r2Screen);
		}

		const isNear = distBetweenContactPts < 60 && isNearArc1 && isNearArc2;

		if (isNear) {
			const nx = -uy;
			const ny = ux;
			const offset = 14;
			const badgeX = tanX + nx * offset;
			const badgeY = tanY + ny * offset;
			ctx.renderBadge(this.id, badgeX, badgeY, 'tangent');
			return;
		}

		ctx.renderBadgeOnCircle(this.id, this.circle1Id, 'tangent');
		ctx.renderBadgeOnCircle(this.id, this.circle2Id, 'tangent');
	}
}

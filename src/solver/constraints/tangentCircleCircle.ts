import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import { signedDistanceToLine } from './pointOnLine';
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

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1 = readParamPoint(paramMap, this.circle1CenterId);
		const c2 = readParamPoint(paramMap, this.circle2CenterId);

		if (this.sharedPointId) {
			const p = readParamPoint(paramMap, this.sharedPointId);
			return [signedDistanceToLine(p, c1, c2) * this.weight];
		}

		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 10;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 10;
		const dir = new Vec2().subVectors(c2, c1);
		const dist = Math.max(dir.length(), 1e-7);

		let targetDist: number;
		if (!this.isInternal || !this.outerCircleId) {
			targetDist = r1 + r2;
		} else if (this.outerCircleId === this.circle1Id) {
			targetDist = r1 - r2;
		} else {
			targetDist = r2 - r1;
		}

		return [(dist - targetDist) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
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

		const sCenter1 = ctx.viewport.worldToScreen(center1);
		const sCenter2 = ctx.viewport.worldToScreen(center2);
		const r1Screen = entity1.radius * ctx.viewport.zoom;
		const r2Screen = entity2.radius * ctx.viewport.zoom;

		const dir = new Vec2().subVectors(sCenter2, sCenter1);
		const distScreen = dir.length();

		const direction = distScreen > 1e-4 ? dir.divideScalar(distScreen) : new Vec2(1, 0);
		const normal = direction.clone().perpendicular();

		const sharedPoint = this.sharedPointId ? ctx.sketch.points.get(this.sharedPointId) : undefined;
		if (sharedPoint) {
			const badge = ctx.viewport.worldToScreen(sharedPoint).clone().addScaledVector(normal, 14);
			ctx.renderBadge(this.id, badge, 'tangent');
			return;
		}

		const outerId = this.isInternal ? this.outerCircleId : undefined;
		const radius1 = outerId && outerId !== this.circle1Id ? -r1Screen : r1Screen;
		const radius2 = outerId === this.circle1Id ? r2Screen : -r2Screen;
		const contact1 = sCenter1.clone().addScaledVector(direction, radius1);
		const contact2 = sCenter2.clone().addScaledVector(direction, radius2);
		const tan = new Vec2().midpoint(contact1, contact2);
		const distBetweenContactPts = contact1.distanceTo(contact2);

		let isNearArc1 = true;
		if (arc1 && ctx.isAngleNearArc) {
			isNearArc1 = ctx.isAngleNearArc(arc1, center1, tan, r1Screen);
		}
		let isNearArc2 = true;
		if (arc2 && ctx.isAngleNearArc) {
			isNearArc2 = ctx.isAngleNearArc(arc2, center2, tan, r2Screen);
		}

		const isNear = distBetweenContactPts < 60 && isNearArc1 && isNearArc2;

		if (isNear) {
			const offset = 14;
			const badge = tan.clone().addScaledVector(normal, offset);
			ctx.renderBadge(this.id, badge, 'tangent');
			return;
		}

		ctx.renderBadgeOnCircle(this.id, this.circle1Id, 'tangent');
		ctx.renderBadgeOnCircle(this.id, this.circle2Id, 'tangent');
	}
}

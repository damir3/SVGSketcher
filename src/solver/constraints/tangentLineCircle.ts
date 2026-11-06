import { cross, dot, addScaled, vec, scale, sub } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
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
		const axisId =
			lineId === 'axis_x' || lineId === 'axis_y'
				? lineId
				: lineP1Id === 'axis_x' || lineP1Id === 'axis_y'
					? lineP1Id
					: undefined;
		super(
			id,
			'tangent_line_circle',
			'Tangent',
			[...(axisId ? [] : [lineP1Id, lineP2Id]), circleCenterId, circleId, axisId ?? lineId].filter((x): x is string =>
				Boolean(x)
			),
			weight
		);
		this.lineP1Id = axisId ? 'origin' : lineP1Id;
		this.lineP2Id = axisId ? axisId : lineP2Id;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
		this.initialSide = initialSide >= 0 ? 1 : -1;
		this.lineId = axisId ?? lineId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const center = readParamPoint(paramMap, this.circleCenterId);
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const p1 = readParamPoint(paramMap, this.lineP1Id);
		const p2 = readParamPoint(paramMap, this.lineP2Id);

		const dir = sub(p2, p1);
		const lineLen = Math.max(Math.hypot(dir.x, dir.y), 1e-7);

		// Signed distance from center to line
		const signedDist = cross(sub(center, p1), dir) / lineLen;
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
		const isAxis = Boolean(this.lineId && !ctx.sketch.lines.has(this.lineId));

		const p1 = ctx.sketch.points.get(this.lineP1Id);
		const p2 = ctx.sketch.points.get(this.lineP2Id);
		const circle = ctx.sketch.circles.get(this.circleId);
		const arc = ctx.sketch.arcs.get(this.circleId);
		const entity = circle ?? arc;
		if (!p1 || !p2 || !entity) return;

		const center = ctx.sketch.points.get(entity.centerId);
		if (!center) return;

		const sCenter = ctx.viewport.worldToScreen(center);
		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const rScreen = entity.radius * ctx.viewport.zoom;

		const dir = sub(s2, s1);
		const lineLen = Math.hypot(dir.x, dir.y);
		if (lineLen < 1e-4) return;

		const u = scale(dir, 1 / lineLen);

		const v = sub(sCenter, s1);
		const t = dot(v, u);
		const proj = addScaled(s1, u, t);

		const normal = sub(proj, sCenter);
		const normDist = Math.hypot(normal.x, normal.y);

		let dirX = 0;
		let dirY = 0;
		if (normDist > 1e-3) {
			dirX = normal.x / normDist;
			dirY = normal.y / normDist;
		} else {
			dirX = -u.y;
			dirY = u.x;
		}

		const circPt = vec(sCenter.x + dirX * rScreen, sCenter.y + dirY * rScreen);
		const tan = vec((proj.x + circPt.x) * 0.5, (proj.y + circPt.y) * 0.5);

		const distToSeg = isAxis ? 0 : t < 0 ? -t : t > lineLen ? t - lineLen : 0;
		const distToCirc = Math.abs(normDist - rScreen);

		const isNearArc = arc && ctx.isAngleNearArc ? ctx.isAngleNearArc(arc, center, tan, rScreen) : true;
		const isNear = distToSeg < 60 && distToCirc < 60 && isNearArc;

		if (isNear) {
			const offset = 14;
			const badge = vec(tan.x - dirX * offset, tan.y - dirY * offset);
			ctx.renderBadge(this.id, badge, 'tangent');
			return;
		}

		// Fallback if entities are completely disconnected and far apart
		if (!isAxis) {
			ctx.renderBadgeOnSegment(this.id, this.lineP1Id, this.lineP2Id, 'tangent');
		}
		ctx.renderBadgeOnCircle(this.id, this.circleId, 'tangent');
	}
}

import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { computePointToLineDimensionGeometry, formatDimensionValue } from '../../canvas/dimensionGeometry';
import { distanceToLinearDimension } from '../../math/hitTest';

/**
 * Dimensional constraint: distance from a point to a line segment (infinite line extension) equals value
 */
export class PointToLineDistanceConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	targetDistance: number;
	side: number;
	offset?: number;

	constructor(
		id: string,
		pointId: string,
		lineId: string,
		lineP1Id: string,
		lineP2Id: string,
		targetDistance: number,
		side = 1,
		weight = 1.0,
		offset?: number
	) {
		super(
			id,
			'point_to_line_distance',
			'Point-to-Line Distance',
			[pointId, lineP1Id, lineP2Id],
			weight,
			false,
			true,
			targetDistance
		);
		this.pointId = pointId;
		this.lineId = lineId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.targetDistance = targetDistance;
		this.side = side >= 0 ? 1 : -1;
		this.offset = offset;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Signed perpendicular distance from point to line (p1->p2)
		const cross = (px - p1x) * dy - (py - p1y) * dx;
		const h = cross / lineLen;

		return [(h - this.side * this.targetDistance) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		const p1 = ctx.sketch.points.get(this.lineP1Id);
		const p2 = ctx.sketch.points.get(this.lineP2Id);
		if (!pt || !p1 || !p2) return;

		const sp = ctx.viewport.worldToScreen(pt.x, pt.y);
		const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
		const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, offsetScreen);
		if (!geom) return;

		ctx.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: formatDimensionValue(this.targetDistance),
			extensionLines: geom.extensionLines,
			parent: ctx.targetGroup,
			isSelected: ctx.isSelected,
			constraintId: this.id,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pt = sketch.points.get(this.pointId);
		const p1 = sketch.points.get(this.lineP1Id);
		const p2 = sketch.points.get(this.lineP2Id);
		if (!pt || !p1 || !p2) return null;

		const sp = viewport.worldToScreen(pt.x, pt.y);
		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);
		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, offsetScreen);
		if (!geom) return null;

		return distanceToLinearDimension(screen, geom.d1, geom.d2);
	}
}

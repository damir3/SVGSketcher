import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';
import {
	computeDistanceDimensionGeometry,
	computePointToLineDimensionGeometry,
	formatDimensionValue,
} from '../../canvas/dimensionGeometry';
import { distanceToLinearDimension, distanceToPoint } from '../../math/hitTest';

/**
 * Origin & Axis Distance / Coincident Constraint for Points:
 * - isCoincident=true: constrains point to (0,0) (x = 0, y = 0).
 * - orientation='horizontal': constrains point distance to Y-axis (|x| = d; if d=0, point on Y-axis).
 * - orientation='vertical': constrains point distance to X-axis (|y| = d; if d=0, point on X-axis).
 * - orientation='aligned': constrains point distance to (0,0) (hypot(x,y) = d).
 */
export class OriginDistanceConstraint extends BaseConstraint {
	readonly pointId: string;
	targetDistance: number;
	orientation?: 'aligned' | 'horizontal' | 'vertical';
	side: number;
	offset?: number;
	isCoincident?: boolean;

	constructor(
		id: string,
		pointId: string,
		targetDistance: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned',
		offset?: number,
		isCoincident = false,
		side = 1,
		weight = 1.0
	) {
		const isDim = !isCoincident && targetDistance > 0;
		const name = isCoincident
			? 'Coincident with (0,0)'
			: targetDistance === 0
			? orientation === 'horizontal'
				? 'Point on Y-Axis'
				: orientation === 'vertical'
				? 'Point on X-Axis'
				: 'Coincident with (0,0)'
			: orientation === 'horizontal'
			? 'Distance to Y-Axis'
			: orientation === 'vertical'
			? 'Distance to X-Axis'
			: 'Distance to (0,0)';

		super(id, 'origin_distance', name, [pointId], weight, false, isDim, targetDistance);
		this.pointId = pointId;
		this.targetDistance = targetDistance;
		this.orientation = orientation;
		this.side = side >= 0 ? 1 : -1;
		this.offset = offset;
		this.isCoincident = isCoincident;
	}

	override getEquationsCount(): number {
		return this.isCoincident ? 2 : 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;

		if (this.isCoincident) {
			return [px * this.weight, py * this.weight];
		}

		if (this.orientation === 'horizontal') {
			if (this.targetDistance === 0) {
				return [px * this.weight];
			}
			return [(px - this.side * this.targetDistance) * this.weight];
		}

		if (this.orientation === 'vertical') {
			if (this.targetDistance === 0) {
				return [py * this.weight];
			}
			return [(py - this.side * this.targetDistance) * this.weight];
		}

		// Aligned: hypot(px, py) = targetDistance
		const curDist = Math.hypot(px, py);
		return [(curDist - this.targetDistance) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		if (this.isCoincident) {
			this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow + 1, this.weight);
			return res;
		}

		if (this.orientation === 'horizontal') {
			this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, this.weight);
			return res;
		}

		if (this.orientation === 'vertical') {
			this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, this.weight);
			return res;
		}

		// Aligned: d(hypot)/dx = x / hypot, d(hypot)/dy = y / hypot
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const curDist = Math.max(Math.hypot(px, py), 1e-7);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, (px / curDist) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, (py / curDist) * this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;

		const sp = ctx.viewport.worldToScreen(pt.x, pt.y);
		const sOrigin = ctx.viewport.worldToScreen(0, 0);

		if (this.isCoincident) {
			ctx.renderBadge(this.id, sOrigin.x - 12, sOrigin.y - 12, '●', COLORS.primary);
			return;
		}

		if (this.targetDistance === 0) {
			ctx.renderBadge(this.id, sp.x, sp.y + 14, '⚲', COLORS.primary);
			return;
		}

		if (this.orientation === 'vertical') {
			const sAxisX = ctx.viewport.worldToScreen(100, 0);
			const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisX, offsetScreen);
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
			return;
		}

		if (this.orientation === 'horizontal') {
			const sAxisY = ctx.viewport.worldToScreen(0, 100);
			const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisY, offsetScreen);
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
			return;
		}

		// Aligned:
		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 32;
		const geom = computeDistanceDimensionGeometry(sOrigin, sp, 'aligned', offsetScreen);
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
		if (!pt) return null;

		const sp = viewport.worldToScreen(pt.x, pt.y);
		const sOrigin = viewport.worldToScreen(0, 0);

		if (this.isCoincident) {
			return distanceToPoint(screen, { x: sOrigin.x - 12, y: sOrigin.y - 12 });
		}

		if (this.targetDistance === 0) {
			return distanceToPoint(screen, { x: sp.x, y: sp.y + 14 });
		}

		if (this.orientation === 'vertical') {
			const sAxisX = viewport.worldToScreen(100, 0);
			const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisX, offsetScreen);
			if (!geom) return null;
			return distanceToLinearDimension(screen, geom.d1, geom.d2);
		}

		if (this.orientation === 'horizontal') {
			const sAxisY = viewport.worldToScreen(0, 100);
			const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisY, offsetScreen);
			if (!geom) return null;
			return distanceToLinearDimension(screen, geom.d1, geom.d2);
		}

		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 32;
		const geom = computeDistanceDimensionGeometry(sOrigin, sp, 'aligned', offsetScreen);
		if (!geom) return null;
		return distanceToLinearDimension(screen, geom.d1, geom.d2);
	}
}

/**
 * Line To Axis Distance / Line Collinear with Axis Constraint:
 * Constrains a line to be collinear with the X-axis (y1 = 0, y2 = 0) or Y-axis (x1 = 0, x2 = 0) (isCollinear=true),
 * or constrains the distance of a line from the axis (y1 = y2 = side * d or x1 = x2 = side * d).
 */
export class LineToAxisDistanceConstraint extends BaseConstraint {
	readonly lineId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly axis: 'x' | 'y';
	targetDistance: number;
	side: number;
	offset?: number;
	isCollinear?: boolean;

	constructor(
		id: string,
		lineId: string,
		lineP1Id: string,
		lineP2Id: string,
		axis: 'x' | 'y',
		targetDistance: number,
		side = 1,
		offset?: number,
		isCollinear = false,
		weight = 1.0
	) {
		super(
			id,
			'line_to_axis_distance',
			isCollinear ? `Collinear with ${axis.toUpperCase()}-Axis` : `Distance to ${axis.toUpperCase()}-Axis`,
			[lineId, lineP1Id, lineP2Id],
			weight,
			false,
			!isCollinear,
			targetDistance
		);
		this.lineId = lineId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.axis = axis;
		this.targetDistance = targetDistance;
		this.side = side >= 0 ? 1 : -1;
		this.offset = offset;
		this.isCollinear = isCollinear;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		if (this.isCollinear) {
			if (this.axis === 'x') {
				return [p1y * this.weight, p2y * this.weight];
			} else {
				return [p1x * this.weight, p2x * this.weight];
			}
		}

		if (this.axis === 'x') {
			return [
				(p1y - this.side * this.targetDistance) * this.weight,
				(p2y - this.side * this.targetDistance) * this.weight,
			];
		} else {
			return [
				(p1x - this.side * this.targetDistance) * this.weight,
				(p2x - this.side * this.targetDistance) * this.weight,
			];
		}
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const param1 = this.axis === 'x' ? `${this.lineP1Id}.y` : `${this.lineP1Id}.x`;
		const param2 = this.axis === 'x' ? `${this.lineP2Id}.y` : `${this.lineP2Id}.x`;

		this.addJacobianEntry(res, paramIndices, param1, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, param2, baseRow + 1, this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const p1 = ctx.sketch.points.get(this.lineP1Id);
		const p2 = ctx.sketch.points.get(this.lineP2Id);
		if (!p1 || !p2) return;

		const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
		const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
		const sOrigin = ctx.viewport.worldToScreen(0, 0);

		if (this.isCollinear) {
			const midX = (s1.x + s2.x) * 0.5;
			const midY = (s1.y + s2.y) * 0.5;
			ctx.renderBadge(this.id, midX, midY, 'collinear', COLORS.primary);
			return;
		}

		const midPt = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
		const sp = ctx.viewport.worldToScreen(midPt.x, midPt.y);
		const sAxis2 =
			this.axis === 'x' ? ctx.viewport.worldToScreen(100, 0) : ctx.viewport.worldToScreen(0, 100);

		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxis2, offsetScreen);
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
		const p1 = sketch.points.get(this.lineP1Id);
		const p2 = sketch.points.get(this.lineP2Id);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);
		const sOrigin = viewport.worldToScreen(0, 0);

		if (this.isCollinear) {
			const midX = (s1.x + s2.x) * 0.5;
			const midY = (s1.y + s2.y) * 0.5;
			return distanceToPoint(screen, { x: midX, y: midY });
		}

		const midPt = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
		const sp = viewport.worldToScreen(midPt.x, midPt.y);
		const sAxis2 =
			this.axis === 'x' ? viewport.worldToScreen(100, 0) : viewport.worldToScreen(0, 100);

		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxis2, offsetScreen);
		if (!geom) return null;

		return distanceToLinearDimension(screen, geom.d1, geom.d2);
	}
}

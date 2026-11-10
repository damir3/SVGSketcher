import { Vec2, ORIGIN } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
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
		const p = readParamPoint(paramMap, this.pointId);

		if (this.isCoincident) {
			return [p.x * this.weight, p.y * this.weight];
		}

		if (this.orientation === 'horizontal') {
			if (this.targetDistance === 0) {
				return [p.x * this.weight];
			}
			return [(p.x - this.side * this.targetDistance) * this.weight];
		}

		if (this.orientation === 'vertical') {
			if (this.targetDistance === 0) {
				return [p.y * this.weight];
			}
			return [(p.y - this.side * this.targetDistance) * this.weight];
		}

		// Aligned: hypot(px, py) = targetDistance
		const curDist = p.length();
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
		const p = readParamPoint(paramMap, this.pointId);
		const curDist = Math.max(p.length(), 1e-7);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, (p.x / curDist) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, (p.y / curDist) * this.weight);
		return res;
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;

		const sp = ctx.viewport.worldToScreen(pt);
		const sOrigin = ctx.viewport.worldToScreen(ORIGIN);

		if (this.isCoincident) {
			ctx.renderBadge(this.id, sOrigin.clone().subScalar(12), '●', COLORS.primary);
			return;
		}

		if (this.targetDistance === 0) {
			ctx.renderBadge(this.id, new Vec2(sp.x, sp.y + 14), '⚲', COLORS.primary);
			return;
		}

		if (this.orientation === 'vertical') {
			const sAxisX = ctx.viewport.worldToScreen(new Vec2(100, 0));
			const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisX, offsetScreen);
			if (!geom) return;
			ctx.renderLinearDimensionVisual({
				d1: geom.d1,
				d2: geom.d2,
				label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
				extensionLines: geom.extensionLines,
				parent: ctx.targetGroup,
				isSelected: ctx.isSelected,
				constraintId: this.id,
			});
			return;
		}

		if (this.orientation === 'horizontal') {
			const sAxisY = ctx.viewport.worldToScreen(new Vec2(0, 100));
			const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisY, offsetScreen);
			if (!geom) return;
			ctx.renderLinearDimensionVisual({
				d1: geom.d1,
				d2: geom.d2,
				label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
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
			label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
			extensionLines: geom.extensionLines,
			parent: ctx.targetGroup,
			isSelected: ctx.isSelected,
			constraintId: this.id,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pt = sketch.points.get(this.pointId);
		if (!pt) return null;

		const sp = viewport.worldToScreen(pt);
		const sOrigin = viewport.worldToScreen(ORIGIN);

		if (this.isCoincident) {
			return distanceToPoint(screen, sOrigin.clone().subScalar(12));
		}

		if (this.targetDistance === 0) {
			return distanceToPoint(screen, new Vec2(sp.x, sp.y + 14));
		}

		if (this.orientation === 'vertical') {
			const sAxisX = viewport.worldToScreen(new Vec2(100, 0));
			const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
			const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxisX, offsetScreen);
			if (!geom) return null;
			return distanceToLinearDimension(screen, geom.d1, geom.d2);
		}

		if (this.orientation === 'horizontal') {
			const sAxisY = viewport.worldToScreen(new Vec2(0, 100));
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

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () => {
				if (this.isCoincident) {
					return 'Coincident with Origin (0,0)';
				}
				if (this.targetDistance === 0) {
					const axisName = this.orientation === 'vertical' ? 'X-Axis' : 'Y-Axis';
					return `Point on ${axisName}`;
				}
				return this.orientation === 'horizontal'
					? 'Distance to Y-Axis'
					: this.orientation === 'vertical'
						? 'Distance to X-Axis'
						: 'Distance to (0,0)';
			},
			rows: [
				{
					label: 'Position:',
					getValue: () => '(0.00, 0.00)',
					isVisible: () => this.isCoincident,
				},
				{
					label: 'Axis:',
					getValue: () => {
						const axisName = this.orientation === 'vertical' ? 'X-Axis' : 'Y-Axis';
						return `${axisName} (${this.orientation === 'vertical' ? 'Y = 0' : 'X = 0'})`;
					},
					isVisible: () => !this.isCoincident && this.targetDistance === 0,
				},
			],
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
				isVisible: () => !this.isCoincident && this.targetDistance > 0,
			},
		});
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
		const p1 = readParamPoint(paramMap, this.lineP1Id);
		const p2 = readParamPoint(paramMap, this.lineP2Id);

		if (this.isCollinear) {
			if (this.axis === 'x') {
				return [p1.y * this.weight, p2.y * this.weight];
			} else {
				return [p1.x * this.weight, p2.x * this.weight];
			}
		}

		if (this.axis === 'x') {
			return [
				(p1.y - this.side * this.targetDistance) * this.weight,
				(p2.y - this.side * this.targetDistance) * this.weight,
			];
		} else {
			return [
				(p1.x - this.side * this.targetDistance) * this.weight,
				(p2.x - this.side * this.targetDistance) * this.weight,
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

		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const sOrigin = ctx.viewport.worldToScreen(ORIGIN);

		if (this.isCollinear) {
			ctx.renderBadge(this.id, new Vec2().midpoint(s1, s2), 'collinear', COLORS.primary);
			return;
		}

		const midPt = new Vec2().midpoint(p1, p2);
		const sp = ctx.viewport.worldToScreen(midPt);
		const sAxis2 =
			this.axis === 'x' ? ctx.viewport.worldToScreen(new Vec2(100, 0)) : ctx.viewport.worldToScreen(new Vec2(0, 100));

		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxis2, offsetScreen);
		if (!geom) return;

		ctx.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
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

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const sOrigin = viewport.worldToScreen(ORIGIN);

		if (this.isCollinear) {
			return distanceToPoint(screen, new Vec2().midpoint(s1, s2));
		}

		const midPt = new Vec2().midpoint(p1, p2);
		const sp = viewport.worldToScreen(midPt);
		const sAxis2 =
			this.axis === 'x' ? viewport.worldToScreen(new Vec2(100, 0)) : viewport.worldToScreen(new Vec2(0, 100));

		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, sOrigin, sAxis2, offsetScreen);
		if (!geom) return null;

		return distanceToLinearDimension(screen, geom.d1, geom.d2);
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () => {
				const axisName = this.axis === 'x' ? 'X-Axis' : 'Y-Axis';
				return this.isCollinear ? `Line Collinear with ${axisName}` : `Distance to ${axisName}`;
			},
			rows: [
				{
					label: 'Axis:',
					getValue: () => {
						const axisName = this.axis === 'x' ? 'X-Axis' : 'Y-Axis';
						return `${axisName} (${this.axis === 'x' ? 'Y = 0' : 'X = 0'})`;
					},
					isVisible: () => this.isCollinear,
				},
			],
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
				isVisible: () => !this.isCollinear,
			},
		});
	}
}

import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { computeDistanceDimensionGeometry, formatDimensionValue } from '../../canvas/dimensionGeometry';
import { distanceToLinearDimension } from '../../math/hitTest';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { PointToLineDistanceConstraint } from './pointToLineDistance';
import { DEFAULT_DISTANCE_OFFSET } from '../../canvas/distances';

export { DEFAULT_DISTANCE_OFFSET };

/**
 * Dimensional constraint: distance between two points equals value
 */
export class DistanceConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	targetDistance: number;
	offset?: number;
	orientation: 'aligned' | 'horizontal' | 'vertical';
	labelPosition?: number;
	/** Fixed direction for projected distances; omitted means unsigned distance. */
	side?: number;

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		targetDistance: number,
		weight = 1.0,
		offset?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned',
		labelPosition?: number,
		side?: number
	) {
		const prefix =
			orientation === 'horizontal'
				? 'Horizontal Distance'
				: orientation === 'vertical'
					? 'Vertical Distance'
					: 'Distance';
		super(id, 'distance', prefix, [p1Id, p2Id], weight, false, true, targetDistance);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.targetDistance = targetDistance;
		this.offset = offset;
		this.orientation = orientation;
		this.labelPosition = labelPosition;
		this.side = side === undefined ? undefined : side >= 0 ? 1 : -1;
		this.name = this.displayName;
	}

	get displayName(): string {
		if (this.p1Id === 'origin')
			return this.orientation === 'horizontal'
				? 'Distance to Y-Axis'
				: this.orientation === 'vertical'
					? 'Distance to X-Axis'
					: 'Distance to (0,0)';
		return this.orientation === 'horizontal'
			? 'Horizontal Distance'
			: this.orientation === 'vertical'
				? 'Vertical Distance'
				: 'Distance';
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		if (this.orientation === 'horizontal') {
			const dx = p2.x - p1.x;
			const sign = this.side === undefined ? (dx >= 0 ? 1 : -1) : 1;
			return [(dx * sign - (this.side ?? 1) * this.targetDistance) * this.weight];
		}

		if (this.orientation === 'vertical') {
			const dy = p2.y - p1.y;
			const sign = this.side === undefined ? (dy >= 0 ? 1 : -1) : 1;
			return [(dy * sign - (this.side ?? 1) * this.targetDistance) * this.weight];
		}

		const dir = new Vec2().subVectors(p2, p1);
		const cur = dir.length();

		return [(cur - this.targetDistance) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		if (this.orientation === 'horizontal') {
			const dx = p2.x - p1.x;
			const sign = this.side === undefined ? (dx >= 0 ? 1 : -1) : 1;
			this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, sign * this.weight);
			return res;
		}

		if (this.orientation === 'vertical') {
			const dy = p2.y - p1.y;
			const sign = this.side === undefined ? (dy >= 0 ? 1 : -1) : 1;
			this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, sign * this.weight);
			return res;
		}

		const dir = new Vec2().subVectors(p2, p1);
		const cur = Math.max(dir.length(), 1e-7);

		const dP2 = dir.clone().multiplyScalar((this.weight * 1) / cur);

		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -dP2.x);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -dP2.y);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, dP2.x);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, dP2.y);

		return res;
	}

	private axisDimension(): PointToLineDistanceConstraint | undefined {
		if (this.p1Id !== 'origin' || this.orientation === 'aligned') return undefined;
		const axis = this.orientation === 'vertical' ? 'axis_x' : 'axis_y';
		return new PointToLineDistanceConstraint(
			this.id,
			this.p2Id,
			axis,
			'origin',
			axis,
			this.targetDistance,
			this.side,
			this.weight,
			this.offset,
			this.labelPosition
		);
	}

	moveLabelTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		const axis = this.axisDimension();
		if (axis) {
			axis.moveLabelTo(screen, sketch, viewport);
			this.offset = axis.offset;
			this.labelPosition = axis.labelPosition;
			return;
		}
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return;
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const midPoint = new Vec2().midpoint(s1, s2);
		if (this.orientation === 'horizontal') {
			const screenOffset = screen.y - midPoint.y;
			this.offset = screenOffset / viewport.zoom;
			const dx = s2.x - s1.x;
			if (Math.abs(dx) > 1e-4) {
				let t = (screen.x - s1.x) / dx;
				if (Math.abs(t - 0.5) < 0.04) t = 0.5;
				this.labelPosition = t;
			}
		} else if (this.orientation === 'vertical') {
			const screenOffset = screen.x - midPoint.x;
			this.offset = screenOffset / viewport.zoom;
			const dy = s2.y - s1.y;
			if (Math.abs(dy) > 1e-4) {
				let t = (screen.y - s1.y) / dy;
				if (Math.abs(t - 0.5) < 0.04) t = 0.5;
				this.labelPosition = t;
			}
		} else {
			const delta = new Vec2().subVectors(s2, s1);
			const len = delta.length();
			if (len > 1e-4) {
				const dir = delta.clone().multiplyScalar(1 / len);
				const normal = dir.clone().perpendicular();
				const screenOffset = new Vec2().subVectors(screen, midPoint).dot(normal);
				this.offset = screenOffset / viewport.zoom;
				let t = new Vec2().subVectors(screen, s1).dot(dir) / len;
				if (Math.abs(t - 0.5) < 0.04) t = 0.5;
				this.labelPosition = t;
			}
		}
	}

	override render(ctx: ConstraintRenderContext): void {
		const axis = this.axisDimension();
		if (axis) {
			axis.expression = this.expression;
			axis.render(ctx);
			return;
		}
		const p1 = ctx.sketch.points.get(this.p1Id);
		const p2 = ctx.sketch.points.get(this.p2Id);
		if (!p1 || !p2) return;

		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const offsetMm = this.offset ?? DEFAULT_DISTANCE_OFFSET;
		const offsetScreen = offsetMm * ctx.viewport.zoom;
		const geom = computeDistanceDimensionGeometry(s1, s2, this.orientation ?? 'aligned', offsetScreen);
		if (!geom) return;

		ctx.renderLinearDimensionVisual({
			d1: geom.d1,
			d2: geom.d2,
			label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
			extensionLines: geom.extensionLines,
			parent: ctx.targetGroup,
			isSelected: ctx.isSelected,
			constraintId: this.id,
			labelPosition: this.labelPosition,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const axis = this.axisDimension();
		if (axis) return axis.distanceTo(screen, sketch, viewport);
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const offsetMm = this.offset ?? DEFAULT_DISTANCE_OFFSET;
		const offsetScreen = offsetMm * viewport.zoom;
		const geom = computeDistanceDimensionGeometry(s1, s2, this.orientation ?? 'aligned', offsetScreen);
		if (!geom) return null;

		const d1 = geom.d1;
		const d2 = geom.d2;
		const t = this.labelPosition ?? 0.5;
		const basePos = d1.clone().lerp(d2, t);
		const distToLabel = screen.distanceTo(basePos);
		const distToSeg = distanceToLinearDimension(screen, d1, d2);
		let minDist = Math.min(distToLabel, distToSeg);
		if (t < 0) {
			minDist = Math.min(minDist, distanceToLinearDimension(screen, basePos, d1));
		} else if (t > 1) {
			minDist = Math.min(minDist, distanceToLinearDimension(screen, d2, basePos));
		}
		return minDist;
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () => this.displayName,
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
			},
		});
	}
}

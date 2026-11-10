import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { computeDistanceDimensionGeometry, formatDimensionValue } from '../../canvas/dimensionGeometry';
import { distanceToLinearDimension } from '../../math/hitTest';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';

/**
 * Dimensional constraint: distance between two points equals value
 */
export class DistanceConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	targetDistance: number;
	offset?: number;
	orientation: 'aligned' | 'horizontal' | 'vertical';

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		targetDistance: number,
		weight = 1.0,
		offset?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
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
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		if (this.orientation === 'horizontal') {
			const dx = p2.x - p1.x;
			const sign = dx >= 0 ? 1 : -1;
			return [(dx * sign - this.targetDistance) * this.weight];
		}

		if (this.orientation === 'vertical') {
			const dy = p2.y - p1.y;
			const sign = dy >= 0 ? 1 : -1;
			return [(dy * sign - this.targetDistance) * this.weight];
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
			const sign = dx >= 0 ? 1 : -1;
			this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, sign * this.weight);
			return res;
		}

		if (this.orientation === 'vertical') {
			const dy = p2.y - p1.y;
			const sign = dy >= 0 ? 1 : -1;
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

	override render(ctx: ConstraintRenderContext): void {
		const p1 = ctx.sketch.points.get(this.p1Id);
		const p2 = ctx.sketch.points.get(this.p2Id);
		if (!p1 || !p2) return;

		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 32;
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
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 32;
		const geom = computeDistanceDimensionGeometry(s1, s2, this.orientation ?? 'aligned', offsetScreen);
		if (!geom) return null;

		return distanceToLinearDimension(screen, geom.d1, geom.d2);
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () =>
				this.orientation === 'horizontal'
					? 'Horizontal Distance'
					: this.orientation === 'vertical'
						? 'Vertical Distance'
						: 'Distance',
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
			},
		});
	}
}

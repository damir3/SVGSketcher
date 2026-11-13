import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
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
	labelPosition?: number;

	constructor(
		id: string,
		pointId: string,
		lineId: string,
		lineP1Id: string,
		lineP2Id: string,
		targetDistance: number,
		side = 1,
		weight = 1.0,
		offset?: number,
		labelPosition?: number
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
		this.labelPosition = labelPosition;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p = readParamPoint(paramMap, this.pointId);
		const p1 = readParamPoint(paramMap, this.lineP1Id);
		const p2 = readParamPoint(paramMap, this.lineP2Id);

		const dir = new Vec2().subVectors(p2, p1);
		const lineLen = Math.max(dir.length(), 1e-7);

		// Signed perpendicular distance from point to line (p1->p2)
		const h = new Vec2().subVectors(p, p1).cross(dir) / lineLen;

		return [(h - this.side * this.targetDistance) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	moveLabelTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		const pt = sketch.points.get(this.pointId);
		const p1 = sketch.points.get(this.lineP1Id);
		const p2 = sketch.points.get(this.lineP2Id);
		if (!pt || !p1 || !p2) return;
		const sp = viewport.worldToScreen(pt);
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const delta = new Vec2().subVectors(s2, s1);
		const lineLen = delta.length();
		if (lineLen > 1e-4) {
			const dir = delta.clone().multiplyScalar(1.0 / lineLen);
			const tProj = new Vec2().subVectors(sp, s1).dot(dir);
			const tCursor = new Vec2().subVectors(screen, s1).dot(dir);
			this.offset = (tCursor - tProj) / viewport.zoom;
			const normal = dir.clone().perpendicular();
			const pFoot = s1.clone().addScaledVector(dir, tCursor);
			const distToFoot = new Vec2().subVectors(screen, pFoot).dot(normal);
			const totalDist = new Vec2().subVectors(sp, pFoot).dot(normal);
			if (Math.abs(totalDist) > 1e-4) {
				let t = distToFoot / totalDist;
				if (Math.abs(t - 0.5) < 0.04) t = 0.5;
				this.labelPosition = t;
			}
		}
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		const p1 = ctx.sketch.points.get(this.lineP1Id);
		const p2 = ctx.sketch.points.get(this.lineP2Id);
		if (!pt || !p1 || !p2) return;

		const sp = ctx.viewport.worldToScreen(pt);
		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);
		const offsetScreen = this.offset !== undefined ? this.offset * ctx.viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, offsetScreen);
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
		const pt = sketch.points.get(this.pointId);
		const p1 = sketch.points.get(this.lineP1Id);
		const p2 = sketch.points.get(this.lineP2Id);
		if (!pt || !p1 || !p2) return null;

		const sp = viewport.worldToScreen(pt);
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const offsetScreen = this.offset !== undefined ? this.offset * viewport.zoom : 0;
		const geom = computePointToLineDimensionGeometry(sp, s1, s2, offsetScreen);
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
			title: 'Point-to-Line Distance',
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
			},
		});
	}
}

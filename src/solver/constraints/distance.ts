import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import { Vec2 } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import {
	computeDistanceDimensionGeometry,
	computeArcDimensionExtension,
	distanceToArcDimensionExtension,
	type ArcDimensionExtension,
	distanceToLinearDimensionVisual,
	formatDimensionValue,
	renderLinearDimensionVisual,
} from '../../canvas/dimensionGeometry';
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
	/** Radial gap between circles or circular arcs; point IDs identify the centers. */
	circleIds?: [string, string];
	leaderAngle?: number;
	/** Signed radial offset of the label from the outer perimeter. */
	leaderOffset?: number;
	/** Legacy placement, converted to leaderOffset when first displayed. */
	labelRadius?: number;

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
		if (this.isReference) return 'Reference Distance';
		if (this.circleIds) return 'Radial Distance';
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
		if (this.isReference) return 0;
		return this.circleIds && this.p1Id !== this.p2Id ? 3 : 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		if (this.isReference) return [];
		if (this.circleIds) {
			const [a, b] = this.circleIds.map(id => paramMap.get(`${id}.r`) ?? 0);
			const residuals = [(Math.abs(b - a) - this.targetDistance) * this.weight];
			if (this.p1Id !== this.p2Id) {
				const p1 = readParamPoint(paramMap, this.p1Id);
				const p2 = readParamPoint(paramMap, this.p2Id);
				residuals.push((p1.x - p2.x) * this.weight, (p1.y - p2.y) * this.weight);
			}
			return residuals;
		}
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
		if (this.isReference) return [];
		const res: JacobianEntry[] = [];
		if (this.circleIds) {
			const [a, b] = this.circleIds;
			const sign = (paramMap.get(`${b}.r`) ?? 0) >= (paramMap.get(`${a}.r`) ?? 0) ? 1 : -1;
			this.addJacobianEntry(res, paramIndices, `${a}.r`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${b}.r`, baseRow, sign * this.weight);
			if (this.p1Id !== this.p2Id) {
				this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow + 1, this.weight);
				this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow + 1, -this.weight);
				this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 2, this.weight);
				this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 2, -this.weight);
			}
			return res;
		}
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

	updateReferenceValue(paramMap: Map<string, number>): void {
		if (!this.isReference) return;
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);
		this.targetDistance = this.circleIds
			? Math.abs((paramMap.get(`${this.circleIds[1]}.r`) ?? 0) - (paramMap.get(`${this.circleIds[0]}.r`) ?? 0))
			: this.orientation === 'horizontal'
				? Math.abs(p2.x - p1.x)
				: this.orientation === 'vertical'
					? Math.abs(p2.y - p1.y)
					: p1.distanceTo(p2);
		this.value = this.targetDistance;
		this.name = this.displayName;
		this.expression = undefined;
	}

	private dimensionPoints(sketch: SketchDocument): [Vec2 | undefined, Vec2 | undefined] {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!this.circleIds || !p1 || !p2) return [p1, p2];
		const [a, b] = this.circleIds.map(id => sketch.circles.get(id) ?? sketch.arcs.get(id));
		if (!a || !b) return [undefined, undefined];
		const direction = new Vec2(Math.cos(this.leaderAngle ?? 0), Math.sin(this.leaderAngle ?? 0));
		return [p1.clone().addScaledVector(direction, a.radius), p2.clone().addScaledVector(direction, b.radius)];
	}

	private arcExtensions(sketch: SketchDocument, viewport: Viewport, targets: [Vec2, Vec2]): ArcDimensionExtension[] {
		return (this.circleIds ?? []).flatMap((id, i) => {
			const arc = sketch.arcs.get(id);
			if (!arc) return [];
			const center = sketch.points.get(arc.centerId);
			const start = sketch.points.get(arc.startPointId);
			const end = sketch.points.get(arc.endPointId);
			if (!center || !start || !end) return [];
			const extension = computeArcDimensionExtension(
				viewport.worldToScreen(center),
				viewport.worldToScreen(start),
				viewport.worldToScreen(end),
				arc.radius * viewport.zoom,
				!!arc.clockwise,
				targets[i]
			);
			return extension ? [extension] : [];
		});
	}

	private dimensionLabelPosition(sketch: SketchDocument): number {
		if (!this.circleIds) return this.labelPosition ?? 0.5;
		const [a, b] = this.circleIds.map(id => sketch.circles.get(id) ?? sketch.arcs.get(id));
		if (!a || !b || Math.abs(b.radius - a.radius) < 1e-7) return this.labelPosition ?? 0.5;
		const outerRadius = Math.max(a.radius, b.radius);
		this.leaderOffset ??=
			(this.labelRadius ?? a.radius + (b.radius - a.radius) * (this.labelPosition ?? 0.5)) - outerRadius;
		return (outerRadius + this.leaderOffset - a.radius) / (b.radius - a.radius);
	}

	private axisDimension(): PointToLineDistanceConstraint | undefined {
		if (this.p1Id !== 'origin' || this.orientation === 'aligned') return undefined;
		const axis = this.orientation === 'vertical' ? 'axis_x' : 'axis_y';
		const dimension = new PointToLineDistanceConstraint(
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
		dimension.isReference = this.isReference;
		return dimension;
	}

	moveLabelTo(screen: Vec2, sketch: SketchDocument, viewport: Viewport): void {
		if (this.circleIds) {
			const center = sketch.points.get(this.p1Id);
			if (!center) return;
			const world = viewport.screenToWorld(screen);
			this.leaderAngle = Math.atan2(world.y - center.y, world.x - center.x);
			const radii = this.circleIds.map(id => (sketch.circles.get(id) ?? sketch.arcs.get(id))?.radius);
			if (radii[0] === undefined || radii[1] === undefined) return;
			this.leaderOffset = world.distanceTo(center) - Math.max(radii[0], radii[1]);
			this.labelRadius = undefined;
			const [p1, p2] = this.dimensionPoints(sketch);
			if (p1 && p2 && p1.distanceTo(p2) > 1e-7) {
				this.labelPosition =
					new Vec2().subVectors(world, p1).dot(new Vec2().subVectors(p2, p1)) / p1.distanceToSquared(p2);
			}
			return;
		}
		const axis = this.axisDimension();
		if (axis) {
			axis.moveLabelTo(screen, sketch, viewport);
			this.offset = axis.offset;
			this.labelPosition = axis.labelPosition;
			return;
		}
		const [p1, p2] = this.dimensionPoints(sketch);
		if (!p1 || !p2) return;
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const midPoint = new Vec2().midpoint(s1, s2);
		if (this.orientation === 'horizontal') {
			this.offset = (screen.y - midPoint.y) / viewport.zoom;
			this.snapLabelAlongSpan(screen.x - s1.x, s2.x - s1.x);
		} else if (this.orientation === 'vertical') {
			this.offset = (screen.x - midPoint.x) / viewport.zoom;
			this.snapLabelAlongSpan(screen.y - s1.y, s2.y - s1.y);
		} else {
			const delta = new Vec2().subVectors(s2, s1);
			const len = delta.length();
			if (len > 1e-4) {
				const dir = delta.clone().multiplyScalar(1 / len);
				const normal = dir.clone().perpendicular();
				this.offset = new Vec2().subVectors(screen, midPoint).dot(normal) / viewport.zoom;
				this.snapLabelAlongSpan(new Vec2().subVectors(screen, s1).dot(dir), len);
			}
		}
	}

	private snapLabelAlongSpan(proj: number, span: number): void {
		if (Math.abs(span) <= 1e-4) return;
		const t = proj / span;
		this.labelPosition = Math.abs(t - 0.5) < 0.04 ? 0.5 : t;
	}

	getLabelScreenPos(sketch: SketchDocument, viewport: Viewport): Vec2 | null {
		if (!this.circleIds && (this.p1Id === 'origin' || this.p2Id === 'origin')) {
			const userPtId = this.p1Id === 'origin' ? this.p2Id : this.p1Id;
			const pt = sketch.points.get(userPtId);
			return pt ? viewport.worldToScreen(pt) : null;
		}
		const [p1, p2] = this.dimensionPoints(sketch);
		const midPoint =
			p1 && p2
				? this.circleIds
					? p1.clone().addScaledVector(new Vec2().subVectors(p2, p1), this.dimensionLabelPosition(sketch))
					: new Vec2().midpoint(p1, p2)
				: new Vec2(0, 0);
		return viewport.worldToScreen(midPoint);
	}

	override render(ctx: ConstraintRenderContext): void {
		const axis = this.axisDimension();
		if (axis) {
			axis.expression = this.expression;
			axis.render(ctx);
			return;
		}
		this.renderDimension(ctx.sketch, ctx.viewport, ctx.targetGroup, ctx.isSelected, ctx.renderLinearDimensionVisual);
	}

	private resolveDimensionVisual(sketch: SketchDocument, viewport: Viewport) {
		const [p1, p2] = this.dimensionPoints(sketch);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const offsetMm = this.circleIds ? 0 : (this.offset ?? DEFAULT_DISTANCE_OFFSET);
		const geom = computeDistanceDimensionGeometry(
			s1,
			s2,
			this.circleIds ? 'direct' : (this.orientation ?? 'aligned'),
			offsetMm * viewport.zoom
		);
		if (!geom) return null;
		return {
			geom,
			arcExtensions: this.arcExtensions(sketch, viewport, [s1, s2]),
			labelPosition: this.dimensionLabelPosition(sketch),
		};
	}

	renderDimension(
		sketch: SketchDocument,
		viewport: Viewport,
		targetGroup: SVGGElement,
		isSelected = false,
		renderVisual = renderLinearDimensionVisual
	): void {
		this.updateReferenceValue(sketch.paramManager.getCurrentValues());
		const visual = this.resolveDimensionVisual(sketch, viewport);
		if (!visual) return;

		renderVisual({
			d1: visual.geom.d1,
			d2: visual.geom.d2,
			label: this.isReference
				? `(${formatDimensionValue(this.targetDistance)})`
				: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
			extensionLines: visual.geom.extensionLines,
			arcExtensions: visual.arcExtensions,
			parent: targetGroup,
			isSelected,
			constraintId: this.id,
			labelPosition: visual.labelPosition,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const axis = this.axisDimension();
		if (axis) return axis.distanceTo(screen, sketch, viewport);
		const visual = this.resolveDimensionVisual(sketch, viewport);
		if (!visual) return null;

		return Math.min(
			distanceToLinearDimensionVisual(screen, visual.geom.d1, visual.geom.d2, visual.labelPosition),
			...visual.arcExtensions.map(extension => distanceToArcDimensionExtension(screen, extension))
		);
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: () => this.displayName,
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
				isDisabled: () => !!this.isReference,
				disabledContent: () =>
					`<div class="inspector-row"><span>Reference</span><strong>(${formatDimensionValue(this.targetDistance)}) mm</strong></div>`,
			},
		});
	}
}

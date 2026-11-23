import { Vec2, type XY } from '../../math/vector';
import { pointIntersectsAABB } from '../../math/aabb';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';
import { createSvgCircle } from '../../canvas/svg';
import { COLORS, HIT_AREA_POINT_ATTRS, SPLINE_STYLES, STROKE_WIDTH } from '../../canvas/styles';

export class SketchPoint extends Vec2 implements ISketchPrimitive {
	readonly type = 'point' as const;
	id: string;
	fixed: boolean;

	constructor(dataOrId: string | { id: string; x: number; y: number; fixed?: boolean }, x = 0, y = 0, fixed = false) {
		const data = typeof dataOrId === 'string' ? { id: dataOrId, x, y, fixed } : dataOrId;
		super(data.x, data.y);
		this.id = data.id;
		this.fixed = data.fixed ?? false;
	}

	// One argument measures world distance; the primitive hit test supplies a viewport.
	override distanceTo(v: XY): number;
	override distanceTo(
		screen: XY,
		sketch: unknown,
		viewport: { worldToScreen(point: XY): XY },
		thresholdPx?: number
	): number;
	override distanceTo(v: XY, _sketch?: unknown, viewport?: { worldToScreen(point: XY): XY }): number {
		return viewport ? Vec2.from(viewport.worldToScreen(this)).distanceTo(v) : super.distanceTo(v);
	}

	intersectsAABB(min: Vec2, max: Vec2, _sketch?: any): boolean {
		return pointIntersectsAABB(this, min, max);
	}

	toGeoCurve(_sketch?: any): null {
		return null;
	}

	getPointIds(_sketch?: any): string[] {
		return [this.id];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return isPointIdConstrained(this.id, constrainedParams);
	}

	render(ctx: PrimitiveRenderContext): void {
		const splineInfo = ctx.splinePointInfo.get(this.id);
		if (
			splineInfo &&
			!ctx.activeSplineIds.has(splineInfo.splineId) &&
			!ctx.sketch.selection.pointIds.has(this.id) &&
			!ctx.options.showSplineHandles
		) {
			return;
		}

		const s = ctx.viewport.worldToScreen(this);
		const isPatternCenter = ctx.options.patternHighlight?.centerPointId === this.id;
		const ptG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.pointGroup);

		createSvgCircle(s, 14, HIT_AREA_POINT_ATTRS, ptG);

		let strokeColor: string = COLORS.primary;
		if (splineInfo?.isHandleDot) {
			strokeColor = SPLINE_STYLES.handleDot.stroke;
		} else if (this.fixed) {
			strokeColor = COLORS.fixed;
		} else if (!ctx.hasConflict && ctx.isPointConstrained(this.id)) {
			strokeColor = COLORS.constrained;
		}

		if (isPatternCenter) {
			strokeColor = COLORS.patternCenter;
		} else if (ctx.isSelected) {
			strokeColor = COLORS.selected;
		}

		createSvgCircle(
			s,
			ctx.isSelected ? 4 : splineInfo?.isHandleDot ? SPLINE_STYLES.handleDot.r : 3,
			{
				class: 'entity-visible visible-point',
				fill: COLORS.background,
				stroke: strokeColor,
				'stroke-width': STROKE_WIDTH.thin,
				'pointer-events': 'all',
			},
			ptG
		);
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const rp = opts.transformPoint(this.x, this.y);
		if (opts.targetGroup) {
			opts.drawVertex?.(opts.viewport.worldToScreen(rp), rp);
		}
		return [rp];
	}

	snapTo(): null {
		return null;
	}

	drag(sketch: any, _startWorld: Vec2, currentWorld: Vec2): void {
		sketch.dragPoint(this.id, currentWorld.x, currentWorld.y);
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-pt-x',
				label: 'X',
				unit: 'mm',
				getValue: () => Number(this.x.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setPointCoords(this.id, val, this.y),
			},
			{
				id: 'insp-pt-y',
				label: 'Y',
				unit: 'mm',
				getValue: () => Number(this.y.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setPointCoords(this.id, this.x, val),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('point', this.id),
		constraintsLabel: 'this point',
		entityIds: () => [this.id],
	});
}

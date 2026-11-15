import { Vec2 } from '../../math/vector';
import { distanceToCircle } from '../../math/hitTest';
import { circleIntersectsAABB } from '../../math/aabb';
import type { GeoCircle } from '../../math/intersection';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveSnapCandidate,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';
import { createSvgCircle } from '../../canvas/svg';
import { getPrimitiveStrokeAttrs, HIT_AREA_RING_ATTRS } from '../../canvas/styles';

export class SketchCircle implements ISketchPrimitive {
	readonly type = 'circle' as const;
	id: string;
	centerId: string;
	radius: number;
	isConstruction?: boolean;

	constructor(
		dataOrId: string | { id: string; centerId: string; radius: number; isConstruction?: boolean },
		centerId = '',
		radius = 0,
		isConstruction = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.centerId = dataOrId.centerId;
			this.radius = dataOrId.radius;
			this.isConstruction = dataOrId.isConstruction;
		} else {
			this.id = dataOrId;
			this.centerId = centerId;
			this.radius = radius;
			this.isConstruction = isConstruction;
		}
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const center = sketch.points.get(this.centerId);
		if (!center) return null;
		const sc = viewport.worldToScreen(center);
		const sr = this.radius * viewport.zoom;
		return distanceToCircle(screen, sc, sr);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		if (!center) return false;
		return circleIntersectsAABB(center, this.radius, min, max);
	}

	toGeoCurve(sketch: any): GeoCircle | null {
		const center = sketch.points.get(this.centerId);
		if (!center) return null;
		return {
			type: 'circle',
			id: this.id,
			center: new Vec2(center.x, center.y),
			centerId: this.centerId,
			radius: this.radius,
			isConstruction: this.isConstruction,
		};
	}

	getPointIds(_sketch?: any): string[] {
		return [this.centerId];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return isPointIdConstrained(this.centerId, constrainedParams) && !!constrainedParams?.has(`${this.id}.r`);
	}

	render(ctx: PrimitiveRenderContext): void {
		const center = ctx.sketch.points.get(this.centerId);
		if (!center) return;

		const sc = ctx.viewport.worldToScreen(center);
		const sr = this.radius * ctx.viewport.zoom;
		const circleG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.geometryGroup);

		createSvgCircle(sc, sr, HIT_AREA_RING_ATTRS, circleG);
		createSvgCircle(
			sc,
			sr,
			{
				fill: 'none',
				...getPrimitiveStrokeAttrs(ctx.isSelected, !!this.isConstruction, ctx.baseColor),
			},
			circleG
		);
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const origCtr = opts.sketch.points.get(this.centerId);
		if (!origCtr) return [];

		const rc = opts.transformPoint(origCtr.x, origCtr.y);
		if (opts.targetGroup && opts.strokeAttrs) {
			const sc = opts.viewport.worldToScreen(rc);
			const sr = this.radius * opts.viewport.zoom * (opts.transformScale ?? 1);
			createSvgCircle(sc, sr, opts.strokeAttrs, opts.targetGroup);
			opts.drawVertex?.(sc, rc);
		}
		return [rc];
	}

	snapTo(screenPos: Vec2, sketch: any, viewport: any, maxDistPx: number): PrimitiveSnapCandidate | null {
		const center = sketch.points.get(this.centerId);
		if (!center) return null;

		const sc = viewport.worldToScreen(center);
		const sr = this.radius * viewport.zoom;
		const dToCenter = screenPos.distanceTo(sc);
		const dToPerimeter = Math.abs(dToCenter - sr);
		if (dToPerimeter >= maxDistPx) return null;

		const dir = new Vec2().subVectors(screenPos, sc);
		const d = Math.max(dir.length(), 1e-6);
		const snappedScreen = sc.clone().addScaledVector(dir, sr / d);
		return {
			type: 'circle',
			id: this.id,
			dist: dToPerimeter,
			worldPos: viewport.screenToWorld(snappedScreen),
			screenPos: snappedScreen,
		};
	}

	drag(
		sketch: any,
		startWorld: Vec2,
		currentWorld: Vec2,
		initialPoints: ReadonlyMap<string, Vec2>,
		event: { shiftKey?: boolean; altKey?: boolean }
	): void {
		const centerStart = initialPoints.get(this.centerId);
		if (!centerStart) return;
		const center = sketch.points.get(this.centerId);
		const isFixed = center ? sketch.isPointFixed(center.id) : false;
		const hasRadConst = sketch.hasRadiusConstraint(this.id);

		if ((event.shiftKey || event.altKey || (isFixed && !hasRadConst)) && center) {
			sketch.dragCircleRadius(this.id, center.distanceTo(currentWorld));
		} else {
			const dir = new Vec2().subVectors(currentWorld, startWorld);
			sketch.dragCircle(this.id, centerStart.x + dir.x, centerStart.y + dir.y);
		}
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-circle-radius',
				label: 'Radius',
				unit: 'mm',
				getValue: () => Number(this.radius.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setCircleOrArcRadius(this.id, val),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-circle-diameter',
				label: 'Diameter',
				unit: 'mm',
				getValue: () => Number((this.radius * 2).toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setCircleOrArcRadius(this.id, val / 2),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('circle', this.id),
		constraintsLabel: 'this circle',
		entityIds: () => [this.id],
	});
}

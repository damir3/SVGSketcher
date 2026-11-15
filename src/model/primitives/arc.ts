import { Vec2 } from '../../math/vector';
import { distanceToArc } from '../../math/hitTest';
import { arcIntersectsAABB } from '../../math/aabb';
import type { GeoArc } from '../../math/intersection';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	translatePrimitivePoints,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveSnapCandidate,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';
import { createSvgLine, createSvgPath, getArcSvgPath } from '../../canvas/svg';
import { AUX_AXIS_ATTRS, getPrimitiveStrokeAttrs, HIT_AREA_STROKE_ATTRS } from '../../canvas/styles';

export class SketchArc implements ISketchPrimitive {
	readonly type = 'arc' as const;
	id: string;
	centerId: string;
	startPointId: string;
	endPointId: string;
	radius: number;
	clockwise?: boolean;
	isConstruction?: boolean;

	constructor(
		dataOrId:
			| string
			| {
					id: string;
					centerId: string;
					startPointId: string;
					endPointId: string;
					radius: number;
					clockwise?: boolean;
					isConstruction?: boolean;
			  },
		centerId = '',
		startPointId = '',
		endPointId = '',
		radius = 0,
		clockwise = false,
		isConstruction = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.centerId = dataOrId.centerId;
			this.startPointId = dataOrId.startPointId;
			this.endPointId = dataOrId.endPointId;
			this.radius = dataOrId.radius;
			this.clockwise = dataOrId.clockwise;
			this.isConstruction = dataOrId.isConstruction;
		} else {
			this.id = dataOrId;
			this.centerId = centerId;
			this.startPointId = startPointId;
			this.endPointId = endPointId;
			this.radius = radius;
			this.clockwise = clockwise;
			this.isConstruction = isConstruction;
		}
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, thresholdPx = 18): number | null {
		const center = sketch.points.get(this.centerId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !start || !end) return null;

		const sc = viewport.worldToScreen(center);
		const ss = viewport.worldToScreen(start);
		const se = viewport.worldToScreen(end);
		const sr = this.radius * viewport.zoom;

		return distanceToArc(screen, sc, sr, ss, se, !!this.clockwise, thresholdPx);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !start || !end) return false;
		return arcIntersectsAABB(center, this.radius, start, end, !!this.clockwise, min, max);
	}

	toGeoCurve(sketch: any): GeoArc | null {
		const center = sketch.points.get(this.centerId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !start || !end) return null;
		return {
			type: 'arc',
			id: this.id,
			center: new Vec2(center.x, center.y),
			centerId: this.centerId,
			startPointId: this.startPointId,
			endPointId: this.endPointId,
			radius: this.radius,
			start: new Vec2(start.x, start.y),
			end: new Vec2(end.x, end.y),
			clockwise: !!this.clockwise,
			isConstruction: this.isConstruction,
		};
	}

	getPointIds(_sketch?: any): string[] {
		return [this.centerId, this.startPointId, this.endPointId];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return (
			this.getPointIds().every(id => isPointIdConstrained(id, constrainedParams)) &&
			!!constrainedParams?.has(`${this.id}.r`)
		);
	}

	render(ctx: PrimitiveRenderContext): void {
		const center = ctx.sketch.points.get(this.centerId);
		const start = ctx.sketch.points.get(this.startPointId);
		const end = ctx.sketch.points.get(this.endPointId);
		if (!center || !start || !end) return;

		const sc = ctx.viewport.worldToScreen(center);
		const ss = ctx.viewport.worldToScreen(start);
		const se = ctx.viewport.worldToScreen(end);
		const sr = this.radius * ctx.viewport.zoom;
		const clockwise = !!this.clockwise;
		const d = getArcSvgPath(sc, ss, se, sr, clockwise);
		const trim = ctx.filletTrims.get(this.id);
		const previewD = trim
			? trim.start && trim.end && trim.start.param >= trim.end.param
				? ''
				: getArcSvgPath(
						sc,
						trim.start ? ctx.viewport.worldToScreen(trim.start.point) : ss,
						trim.end ? ctx.viewport.worldToScreen(trim.end.point) : se,
						sr,
						clockwise
					)
			: d;

		const arcG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.geometryGroup);
		createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);
		createSvgPath(
			previewD,
			{
				fill: 'none',
				...getPrimitiveStrokeAttrs(ctx.isSelected, !!this.isConstruction, ctx.baseColor, true),
			},
			arcG
		);

		if (ctx.isSelected) {
			createSvgLine(sc, ss, AUX_AXIS_ATTRS, arcG);
			createSvgLine(sc, se, AUX_AXIS_ATTRS, arcG);
		}
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const origCtr = opts.sketch.points.get(this.centerId);
		const origStart = opts.sketch.points.get(this.startPointId);
		const origEnd = opts.sketch.points.get(this.endPointId);
		if (!origCtr || !origStart || !origEnd) return [];

		const rc = opts.transformPoint(origCtr.x, origCtr.y);
		const rs = opts.transformPoint(origStart.x, origStart.y);
		const re = opts.transformPoint(origEnd.x, origEnd.y);

		if (opts.targetGroup && opts.strokeAttrs) {
			const sc = opts.viewport.worldToScreen(rc);
			const ss = opts.viewport.worldToScreen(rs);
			const se = opts.viewport.worldToScreen(re);
			const sr = this.radius * opts.viewport.zoom * (opts.transformScale ?? 1);
			const clockwise = opts.invertWinding ? !this.clockwise : !!this.clockwise;
			const d = getArcSvgPath(sc, ss, se, sr, clockwise);
			createSvgPath(d, opts.strokeAttrs, opts.targetGroup);
			opts.drawVertex?.(sc, rc);
			opts.drawVertex?.(ss, rs);
			opts.drawVertex?.(se, re);
		}
		return [rc, rs, re];
	}

	snapTo(
		screenPos: Vec2,
		sketch: any,
		viewport: any,
		maxDistPx: number,
		tolerancePx = maxDistPx
	): PrimitiveSnapCandidate | null {
		const center = sketch.points.get(this.centerId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !start || !end) return null;

		const sc = viewport.worldToScreen(center);
		const ss = viewport.worldToScreen(start);
		const se = viewport.worldToScreen(end);
		const sr = this.radius * viewport.zoom;

		const dToCenter = screenPos.distanceTo(sc);
		const dToPerimeter = Math.abs(dToCenter - sr);
		if (dToPerimeter >= maxDistPx) return null;

		const as = sc.angleToPoint(ss);
		const ae = sc.angleToPoint(se);
		const ap = sc.angleToPoint(screenPos);
		const clockwise = !!this.clockwise;
		const TWO_PI = 2 * Math.PI;

		let sweepAngle = 0;
		let pAngle = 0;
		if (clockwise) {
			sweepAngle = (ae - as) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
			pAngle = (ap - as) % TWO_PI;
			if (pAngle < 0) pAngle += TWO_PI;
		} else {
			sweepAngle = (as - ae) % TWO_PI;
			if (sweepAngle < 0) sweepAngle += TWO_PI;
			pAngle = (as - ap) % TWO_PI;
			if (pAngle < 0) pAngle += TWO_PI;
		}

		const angTolerance = tolerancePx / Math.max(sr, 1);
		if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
			const clampedPAngle = Math.max(0, Math.min(sweepAngle, pAngle));
			const actualAng = clockwise ? as + clampedPAngle : as - clampedPAngle;
			const snappedScreen = Vec2.fromPolar(sr, actualAng).add(sc);
			return {
				type: 'circle',
				id: this.id,
				dist: dToPerimeter,
				worldPos: viewport.screenToWorld(snappedScreen),
				screenPos: snappedScreen,
			};
		}
		return null;
	}

	drag(sketch: any, startWorld: Vec2, currentWorld: Vec2, initialPoints: ReadonlyMap<string, Vec2>): void {
		translatePrimitivePoints(sketch, startWorld, currentWorld, initialPoints);
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-arc-radius',
				label: 'Radius',
				unit: 'mm',
				getValue: () => Number(this.radius.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setCircleOrArcRadius(this.id, val),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-arc-angle',
				label: 'Angle',
				unit: '°',
				getValue: ctx => {
					const center = ctx.sketch.points.get(this.centerId);
					const start = ctx.sketch.points.get(this.startPointId);
					const end = ctx.sketch.points.get(this.endPointId);
					if (center && start && end) {
						const as = center.angleToPoint(start);
						const ae = center.angleToPoint(end);
						let sweep = this.clockwise ? (as - ae) % (2 * Math.PI) : (ae - as) % (2 * Math.PI);
						if (sweep < 0) sweep += 2 * Math.PI;
						return Number(((sweep * 180) / Math.PI).toFixed(2));
					}
					return 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setArcAngle(this.id, val),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('arc', this.id),
		constraintsLabel: 'this arc',
		entityIds: () => [this.id],
	});
}

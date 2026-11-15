import { Vec2 } from '../../math/vector';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../../math/ellipse';
import { distanceToEllipticalArc } from '../../math/hitTest';
import { ellipticalArcIntersectsAABB } from '../../math/aabb';
import type { GeoEllipticalArc } from '../../math/intersection';
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
import { createSvgLine, createSvgPath, getEllipticalArcSvgPath } from '../../canvas/svg';
import { AUX_AXIS_ATTRS, AUX_RAY_ATTRS, getPrimitiveStrokeAttrs, HIT_AREA_STROKE_ATTRS } from '../../canvas/styles';

export class SketchEllipticalArc implements ISketchPrimitive {
	readonly type = 'elliptical_arc' as const;
	id: string;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	startPointId: string;
	endPointId: string;
	clockwise?: boolean;
	isConstruction?: boolean;

	constructor(
		dataOrId:
			| string
			| {
					id: string;
					centerId: string;
					majorAxisPointId: string;
					minorAxisPointId: string;
					startPointId: string;
					endPointId: string;
					clockwise?: boolean;
					isConstruction?: boolean;
			  },
		centerId = '',
		majorAxisPointId = '',
		minorAxisPointId = '',
		startPointId = '',
		endPointId = '',
		clockwise = false,
		isConstruction = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.centerId = dataOrId.centerId;
			this.majorAxisPointId = dataOrId.majorAxisPointId;
			this.minorAxisPointId = dataOrId.minorAxisPointId;
			this.startPointId = dataOrId.startPointId;
			this.endPointId = dataOrId.endPointId;
			this.clockwise = dataOrId.clockwise;
			this.isConstruction = dataOrId.isConstruction;
		} else {
			this.id = dataOrId;
			this.centerId = centerId;
			this.majorAxisPointId = majorAxisPointId;
			this.minorAxisPointId = minorAxisPointId;
			this.startPointId = startPointId;
			this.endPointId = endPointId;
			this.clockwise = clockwise;
			this.isConstruction = isConstruction;
		}
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, thresholdPx = 18): number | null {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		const startPt = sketch.points.get(this.startPointId);
		const endPt = sketch.points.get(this.endPointId);
		if (!center || !majorPt || !minorPt || !startPt || !endPt) return null;

		const sc = viewport.worldToScreen(center);
		const smaj = viewport.worldToScreen(majorPt);
		const smin = viewport.worldToScreen(minorPt);
		const ss = viewport.worldToScreen(startPt);
		const se = viewport.worldToScreen(endPt);

		return distanceToEllipticalArc(screen, sc, smaj, smin, ss, se, !!this.clockwise, thresholdPx);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		const startPt = sketch.points.get(this.startPointId);
		const endPt = sketch.points.get(this.endPointId);
		if (!center || !majorPt || !minorPt || !startPt || !endPt) return false;
		return ellipticalArcIntersectsAABB(center, majorPt, minorPt, startPt, endPt, !!this.clockwise, min, max);
	}

	toGeoCurve(sketch: any): GeoEllipticalArc | null {
		const center = sketch.points.get(this.centerId);
		const maj = sketch.points.get(this.majorAxisPointId);
		const min = sketch.points.get(this.minorAxisPointId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !maj || !min || !start || !end) return null;
		return {
			type: 'elliptical_arc',
			id: this.id,
			center: new Vec2(center.x, center.y),
			centerId: this.centerId,
			majorAxisPointId: this.majorAxisPointId,
			minorAxisPointId: this.minorAxisPointId,
			startPointId: this.startPointId,
			endPointId: this.endPointId,
			majorAxisPoint: new Vec2(maj.x, maj.y),
			minorAxisPoint: new Vec2(min.x, min.y),
			start: new Vec2(start.x, start.y),
			end: new Vec2(end.x, end.y),
			clockwise: !!this.clockwise,
			isConstruction: this.isConstruction,
		};
	}

	getPointIds(_sketch?: any): string[] {
		return [this.centerId, this.majorAxisPointId, this.minorAxisPointId, this.startPointId, this.endPointId];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return this.getPointIds().every(id => isPointIdConstrained(id, constrainedParams));
	}

	render(ctx: PrimitiveRenderContext): void {
		const center = ctx.sketch.points.get(this.centerId);
		const majorPt = ctx.sketch.points.get(this.majorAxisPointId);
		const minorPt = ctx.sketch.points.get(this.minorAxisPointId);
		const startPt = ctx.sketch.points.get(this.startPointId);
		const endPt = ctx.sketch.points.get(this.endPointId);
		if (!center || !majorPt || !minorPt || !startPt || !endPt) return;

		const sc = ctx.viewport.worldToScreen(center);
		const smaj = ctx.viewport.worldToScreen(majorPt);
		const smin = ctx.viewport.worldToScreen(minorPt);
		const ss = ctx.viewport.worldToScreen(startPt);
		const se = ctx.viewport.worldToScreen(endPt);

		const d = getEllipticalArcSvgPath(sc, smaj, smin, ss, se, !!this.clockwise);
		const arcG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.geometryGroup);

		createSvgPath(d, HIT_AREA_STROKE_ATTRS, arcG);
		createSvgPath(
			d,
			{
				fill: 'none',
				...getPrimitiveStrokeAttrs(ctx.isSelected, !!this.isConstruction, ctx.baseColor, true),
			},
			arcG
		);

		if (ctx.isSelected) {
			createSvgLine(sc, ss, AUX_AXIS_ATTRS, arcG);
			createSvgLine(sc, se, AUX_AXIS_ATTRS, arcG);
			createSvgLine(sc, smaj, AUX_RAY_ATTRS, arcG);
			createSvgLine(sc, smin, AUX_RAY_ATTRS, arcG);
		}
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const origCtr = opts.sketch.points.get(this.centerId);
		const origMajor = opts.sketch.points.get(this.majorAxisPointId);
		const origMinor = opts.sketch.points.get(this.minorAxisPointId);
		const origStart = opts.sketch.points.get(this.startPointId);
		const origEnd = opts.sketch.points.get(this.endPointId);
		if (!origCtr || !origMajor || !origMinor || !origStart || !origEnd) return [];

		const rc = opts.transformPoint(origCtr.x, origCtr.y);
		const rmaj = opts.transformPoint(origMajor.x, origMajor.y);
		const rmin = opts.transformPoint(origMinor.x, origMinor.y);
		const rs = opts.transformPoint(origStart.x, origStart.y);
		const re = opts.transformPoint(origEnd.x, origEnd.y);

		if (opts.targetGroup && opts.strokeAttrs) {
			const src = opts.viewport.worldToScreen(rc);
			const srmaj = opts.viewport.worldToScreen(rmaj);
			const srmin = opts.viewport.worldToScreen(rmin);
			const srs = opts.viewport.worldToScreen(rs);
			const sre = opts.viewport.worldToScreen(re);
			const clockwise = opts.invertWinding ? !this.clockwise : !!this.clockwise;
			const d = getEllipticalArcSvgPath(src, srmaj, srmin, srs, sre, clockwise);

			createSvgPath(d, opts.strokeAttrs, opts.targetGroup);
			opts.drawVertex?.(srs, rs);
			opts.drawVertex?.(sre, re);
			opts.drawVertex?.(src, rc);
		}
		return [rc, rmaj, rmin, rs, re];
	}

	snapTo(
		screenPos: Vec2,
		sketch: any,
		viewport: any,
		maxDistPx: number,
		tolerancePx = maxDistPx
	): PrimitiveSnapCandidate | null {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		const startPt = sketch.points.get(this.startPointId);
		const endPt = sketch.points.get(this.endPointId);
		if (!center || !majorPt || !minorPt || !startPt || !endPt) return null;

		const sc = viewport.worldToScreen(center);
		const smaj = viewport.worldToScreen(majorPt);
		const smin = viewport.worldToScreen(minorPt);

		const r = sc.distancesTo(smaj, smin);
		if (r.x < 1 || r.y < 1) return null;

		const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));

		const t = ellipseParameterAtPoint(screenPos, sc, r, axisU, axisV);

		const ss = viewport.worldToScreen(startPt);
		const se = viewport.worldToScreen(endPt);

		const ts = ellipseParameterAtPoint(ss, sc, r, axisU, axisV);
		const te = ellipseParameterAtPoint(se, sc, r, axisU, axisV);
		const clockwise = !!this.clockwise;
		const TWO_PI = 2 * Math.PI;

		let sweepAngle = clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweepAngle < 0) sweepAngle += TWO_PI;
		let pAngle = clockwise ? (t - ts) % TWO_PI : (ts - t) % TWO_PI;
		if (pAngle < 0) pAngle += TWO_PI;

		const angTolerance = tolerancePx / Math.max(Math.min(r.x, r.y), 1);
		if (pAngle <= sweepAngle + angTolerance || pAngle >= TWO_PI - angTolerance) {
			const clampedPAngle = pAngle >= TWO_PI - angTolerance ? 0 : Math.min(sweepAngle, Math.max(0, pAngle));
			const actualT = clockwise ? ts + clampedPAngle : ts - clampedPAngle;
			const snappedScreen = ellipsePointAtParameter(actualT, sc, r, axisU, axisV);
			const dToPerimeter = screenPos.distanceTo(snappedScreen);

			if (dToPerimeter < maxDistPx) {
				return {
					type: 'ellipse',
					id: this.id,
					dist: dToPerimeter,
					worldPos: viewport.screenToWorld(snappedScreen),
					screenPos: snappedScreen,
				};
			}
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
				id: 'insp-ellipse-rx',
				label: 'Major Radius (Rx)',
				unit: 'mm',
				getValue: ctx => {
					const center = ctx.sketch.points.get(this.centerId);
					const majorPt = ctx.sketch.points.get(this.majorAxisPointId);
					return center && majorPt ? Number(center.distanceTo(majorPt).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setEllipseParams(this.id, { rx: val }),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-ellipse-ry',
				label: 'Minor Radius (Ry)',
				unit: 'mm',
				getValue: ctx => {
					const center = ctx.sketch.points.get(this.centerId);
					const minorPt = ctx.sketch.points.get(this.minorAxisPointId);
					return center && minorPt ? Number(center.distanceTo(minorPt).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setEllipseParams(this.id, { ry: val }),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-ellipse-rot',
				label: 'Rotation',
				unit: '°',
				getValue: ctx => {
					const center = ctx.sketch.points.get(this.centerId);
					const majorPt = ctx.sketch.points.get(this.majorAxisPointId);
					return center && majorPt ? Number(center.angleToPointDeg(majorPt).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setEllipseParams(this.id, { rotationDeg: val }),
			},
		],
		rows: [
			{
				label: 'Direction:',
				getValue: () => (this.clockwise ? 'Clockwise' : 'Counter-Clockwise'),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('elliptical_arc', this.id),
		constraintsLabel: 'this elliptical arc',
		entityIds: () => [this.id],
	});
}

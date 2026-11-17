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
import { createEllipseSidebarFields } from './ellipse';
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

	private resolvePoints(sketch: any) {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		const startPt = sketch.points.get(this.startPointId);
		const endPt = sketch.points.get(this.endPointId);
		return center && majorPt && minorPt && startPt && endPt
			? ([center, majorPt, minorPt, startPt, endPt] as const)
			: null;
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, thresholdPx = 18): number | null {
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;
		const [sc, smaj, smin, ss, se] = pts.map(p => viewport.worldToScreen(p));
		return distanceToEllipticalArc(screen, sc, smaj, smin, ss, se, !!this.clockwise, thresholdPx);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const pts = this.resolvePoints(sketch);
		return pts
			? ellipticalArcIntersectsAABB(pts[0], pts[1], pts[2], pts[3], pts[4], !!this.clockwise, min, max)
			: false;
	}

	toGeoCurve(sketch: any): GeoEllipticalArc | null {
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;
		const [center, maj, min, start, end] = pts;
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
		const pts = this.resolvePoints(ctx.sketch);
		if (!pts) return;

		const [sc, smaj, smin, ss, se] = pts.map(p => ctx.viewport.worldToScreen(p));

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
		const pts = this.resolvePoints(opts.sketch);
		if (!pts) return [];

		const [rc, rmaj, rmin, rs, re] = pts.map(p => opts.transformPoint(p.x, p.y));

		if (opts.targetGroup && opts.strokeAttrs) {
			const [src, srmaj, srmin, srs, sre] = [rc, rmaj, rmin, rs, re].map(p => opts.viewport.worldToScreen(p));
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
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;

		const [sc, smaj, smin, ss, se] = pts.map(p => viewport.worldToScreen(p));

		const r = sc.distancesTo(smaj, smin);
		if (r.x < 1 || r.y < 1) return null;

		const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));

		const t = ellipseParameterAtPoint(screenPos, sc, r, axisU, axisV);

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
		fields: createEllipseSidebarFields(this),
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

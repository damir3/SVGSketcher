import { Vec2 } from '../../math/vector';
import { ellipseParameterAtPoint, ellipsePointAtParameter } from '../../math/ellipse';
import { distanceToEllipse } from '../../math/hitTest';
import { ellipseIntersectsAABB } from '../../math/aabb';
import type { GeoEllipse } from '../../math/intersection';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	translatePrimitivePoints,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveSnapCandidate,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel, type PrimitiveFieldConfig } from '../../ui/panels/primitives';
import { createSvgEllipse, createSvgLine } from '../../canvas/svg';
import { AUX_AXIS_ATTRS, getPrimitiveStrokeAttrs, HIT_AREA_RING_ATTRS } from '../../canvas/styles';

export function createEllipseSidebarFields(entity: {
	id: string;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
}): PrimitiveFieldConfig[] {
	const axisDist = (ctx: { sketch: any }, targetId: string) => {
		const center = ctx.sketch.points.get(entity.centerId);
		const target = ctx.sketch.points.get(targetId);
		return center && target ? Number(center.distanceTo(target).toFixed(2)) : 0;
	};
	return [
		{
			id: 'insp-ellipse-rx',
			label: 'Major Radius (Rx)',
			unit: 'mm',
			getValue: ctx => axisDist(ctx, entity.majorAxisPointId),
			onCommit: (val, ctx) => ctx.sketch.setEllipseParams(entity.id, { rx: val }),
			validate: val => !isNaN(val) && isFinite(val) && val > 0,
		},
		{
			id: 'insp-ellipse-ry',
			label: 'Minor Radius (Ry)',
			unit: 'mm',
			getValue: ctx => axisDist(ctx, entity.minorAxisPointId),
			onCommit: (val, ctx) => ctx.sketch.setEllipseParams(entity.id, { ry: val }),
			validate: val => !isNaN(val) && isFinite(val) && val > 0,
		},
		{
			id: 'insp-ellipse-rot',
			label: 'Rotation',
			unit: '°',
			getValue: ctx => {
				const center = ctx.sketch.points.get(entity.centerId);
				const majorPt = ctx.sketch.points.get(entity.majorAxisPointId);
				return center && majorPt ? Number(center.angleToPointDeg(majorPt).toFixed(2)) : 0;
			},
			onCommit: (val, ctx) => ctx.sketch.setEllipseParams(entity.id, { rotationDeg: val }),
		},
	];
}

export class SketchEllipse implements ISketchPrimitive {
	readonly type = 'ellipse' as const;
	id: string;
	centerId: string;
	majorAxisPointId: string;
	minorAxisPointId: string;
	isConstruction?: boolean;

	constructor(
		dataOrId:
			| string
			| {
					id: string;
					centerId: string;
					majorAxisPointId: string;
					minorAxisPointId: string;
					isConstruction?: boolean;
			  },
		centerId = '',
		majorAxisPointId = '',
		minorAxisPointId = '',
		isConstruction = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.centerId = dataOrId.centerId;
			this.majorAxisPointId = dataOrId.majorAxisPointId;
			this.minorAxisPointId = dataOrId.minorAxisPointId;
			this.isConstruction = dataOrId.isConstruction;
		} else {
			this.id = dataOrId;
			this.centerId = centerId;
			this.majorAxisPointId = majorAxisPointId;
			this.minorAxisPointId = minorAxisPointId;
			this.isConstruction = isConstruction;
		}
	}

	private resolvePoints(sketch: any) {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		return center && majorPt && minorPt ? ([center, majorPt, minorPt] as const) : null;
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;
		const [sc, smaj, smin] = pts.map(p => viewport.worldToScreen(p));
		return distanceToEllipse(screen, sc, smaj, smin);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const pts = this.resolvePoints(sketch);
		return pts ? ellipseIntersectsAABB(pts[0], pts[1], pts[2], min, max) : false;
	}

	toGeoCurve(sketch: any): GeoEllipse | null {
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;
		const [center, maj, min] = pts;
		return {
			type: 'ellipse',
			id: this.id,
			center: new Vec2(center.x, center.y),
			centerId: this.centerId,
			majorAxisPointId: this.majorAxisPointId,
			minorAxisPointId: this.minorAxisPointId,
			majorAxisPoint: new Vec2(maj.x, maj.y),
			minorAxisPoint: new Vec2(min.x, min.y),
			isConstruction: this.isConstruction,
		};
	}

	getPointIds(_sketch?: any): string[] {
		return [this.centerId, this.majorAxisPointId, this.minorAxisPointId];
	}

	isConstrained(_sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return this.getPointIds().every(id => isPointIdConstrained(id, constrainedParams));
	}

	render(ctx: PrimitiveRenderContext): void {
		const pts = this.resolvePoints(ctx.sketch);
		if (!pts) return;

		const [sc, smaj, smin] = pts.map(p => ctx.viewport.worldToScreen(p));

		const r = sc.distancesTo(smaj, smin);
		if (r.x < 0.1 || r.y < 0.1) return;

		const thetaDeg = sc.angleToPointDeg(smaj);
		const transform = `rotate(${thetaDeg.toFixed(2)} ${sc.x.toFixed(1)} ${sc.y.toFixed(1)})`;
		const ellipseG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.geometryGroup);

		createSvgEllipse(sc, r, { transform, ...HIT_AREA_RING_ATTRS }, ellipseG);
		createSvgEllipse(
			sc,
			r,
			{
				transform,
				fill: 'none',
				...getPrimitiveStrokeAttrs(ctx.isSelected, !!this.isConstruction, ctx.baseColor),
			},
			ellipseG
		);

		if (ctx.isSelected) {
			createSvgLine(sc, smaj, AUX_AXIS_ATTRS, ellipseG);
			createSvgLine(sc, smin, AUX_AXIS_ATTRS, ellipseG);
		}
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const pts = this.resolvePoints(opts.sketch);
		if (!pts) return [];

		const [rc, rmaj, rmin] = pts.map(p => opts.transformPoint(p.x, p.y));

		if (opts.targetGroup && opts.strokeAttrs) {
			const [src, srmaj, srmin] = [rc, rmaj, rmin].map(p => opts.viewport.worldToScreen(p));
			const r = src.distancesTo(srmaj, srmin);
			const thetaDeg = src.angleToPointDeg(srmaj);

			createSvgEllipse(
				src,
				r,
				{
					transform: `rotate(${thetaDeg.toFixed(2)} ${src.x.toFixed(1)} ${src.y.toFixed(1)})`,
					...opts.strokeAttrs,
				},
				opts.targetGroup
			);

			opts.drawVertex?.(src, rc);
			if (!opts.invertWinding) {
				opts.drawVertex?.(srmaj, rmaj);
				opts.drawVertex?.(srmin, rmin);
			}
		}
		return [rc, rmaj, rmin];
	}

	snapTo(screenPos: Vec2, sketch: any, viewport: any, maxDistPx: number): PrimitiveSnapCandidate | null {
		const pts = this.resolvePoints(sketch);
		if (!pts) return null;

		const [sc, smaj, smin] = pts.map(p => viewport.worldToScreen(p));

		const axisU = new Vec2().subVectors(smaj, sc);
		const axisV = new Vec2().subVectors(smin, sc);

		const r = sc.distancesTo(smaj, smin);
		if (r.x < 1 || r.y < 1) return null;

		const uHat = axisU.clone().multiplyScalar(1 / r.x);
		const vHat = axisV.clone().multiplyScalar(1 / r.y);

		const t = ellipseParameterAtPoint(screenPos, sc, r, uHat, vHat);
		const snappedScreen = ellipsePointAtParameter(t, sc, r, uHat, vHat);
		const dToPerimeter = screenPos.distanceTo(snappedScreen);
		if (dToPerimeter >= maxDistPx) return null;

		return {
			type: 'ellipse',
			id: this.id,
			dist: dToPerimeter,
			worldPos: viewport.screenToWorld(snappedScreen),
			screenPos: snappedScreen,
		};
	}

	drag(sketch: any, startWorld: Vec2, currentWorld: Vec2, initialPoints: ReadonlyMap<string, Vec2>): void {
		translatePrimitivePoints(sketch, startWorld, currentWorld, initialPoints);
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: createEllipseSidebarFields(this),
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('ellipse', this.id),
		constraintsLabel: 'this ellipse',
		entityIds: () => [this.id],
	});
}

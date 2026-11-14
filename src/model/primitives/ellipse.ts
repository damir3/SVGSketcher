import { Vec2 } from '../../math/vector';
import { ellipseParameterAtPoint, ellipsePointAtParameter } from '../../math/ellipse';
import { distanceToEllipse } from '../../math/hitTest';
import { ellipseIntersectsAABB } from '../../math/aabb';
import type { GeoEllipse } from '../../math/intersection';
import { translatePrimitivePoints, type ISketchPrimitive, type PrimitiveSnapCandidate } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

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

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		if (!center || !majorPt || !minorPt) return null;

		const sc = viewport.worldToScreen(center);
		const smaj = viewport.worldToScreen(majorPt);
		const smin = viewport.worldToScreen(minorPt);

		return distanceToEllipse(screen, sc, smaj, smin);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		if (!center || !majorPt || !minorPt) return false;
		return ellipseIntersectsAABB(center, majorPt, minorPt, min, max);
	}

	toGeoCurve(sketch: any): GeoEllipse | null {
		const center = sketch.points.get(this.centerId);
		const maj = sketch.points.get(this.majorAxisPointId);
		const min = sketch.points.get(this.minorAxisPointId);
		if (!center || !maj || !min) return null;
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

	snapTo(screenPos: Vec2, sketch: any, viewport: any, maxDistPx: number): PrimitiveSnapCandidate | null {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		if (!center || !majorPt || !minorPt) return null;

		const sc = viewport.worldToScreen(center);
		const smaj = viewport.worldToScreen(majorPt);
		const smin = viewport.worldToScreen(minorPt);

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
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('ellipse', this.id),
		constraintsLabel: 'this ellipse',
		entityIds: () => [this.id],
	});
}

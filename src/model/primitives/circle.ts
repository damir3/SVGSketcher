import type { Vec2 } from '../../math/vector';
import { distanceToCircle } from '../../math/hitTest';
import { circleIntersectsAABB } from '../../math/aabb';
import type { GeoCircle } from '../../math/intersection';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

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
		const sc = viewport.worldToScreen(center.x, center.y);
		const sr = this.radius * viewport.zoom;
		return distanceToCircle(screen, sc, sr);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		if (!center) return false;
		return circleIntersectsAABB(center.x, center.y, this.radius, minX, minY, maxX, maxY);
	}

	toGeoCurve(sketch: any): GeoCircle | null {
		const center = sketch.points.get(this.centerId);
		if (!center) return null;
		return {
			type: 'circle',
			id: this.id,
			center: { x: center.x, y: center.y },
			centerId: this.centerId,
			radius: this.radius,
			isConstruction: this.isConstruction,
		};
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

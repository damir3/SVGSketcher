import type { Vec2 } from '../../math/vector';
import { distanceToArc } from '../../math/hitTest';
import { arcIntersectsAABB } from '../../math/aabb';
import type { GeoArc } from '../../math/intersection';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

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

		const sc = viewport.worldToScreen(center.x, center.y);
		const ss = viewport.worldToScreen(start.x, start.y);
		const se = viewport.worldToScreen(end.x, end.y);
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
			center: { x: center.x, y: center.y },
			centerId: this.centerId,
			startPointId: this.startPointId,
			endPointId: this.endPointId,
			radius: this.radius,
			start: { x: start.x, y: start.y },
			end: { x: end.x, y: end.y },
			clockwise: !!this.clockwise,
			isConstruction: this.isConstruction,
		};
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
						const as = Math.atan2(start.y - center.y, start.x - center.x);
						const ae = Math.atan2(end.y - center.y, end.x - center.x);
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

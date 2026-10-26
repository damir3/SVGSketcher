import type { Vec2 } from '../../math/vector';
import { distanceToArc } from '../../math/hitTest';
import { arcIntersectsAABB } from '../../math/aabb';
import type { GeoArc } from '../../math/intersection';
import type { ISketchPrimitive } from './base';

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

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const start = sketch.points.get(this.startPointId);
		const end = sketch.points.get(this.endPointId);
		if (!center || !start || !end) return false;
		return arcIntersectsAABB(center, this.radius, start, end, !!this.clockwise, minX, minY, maxX, maxY);
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
}

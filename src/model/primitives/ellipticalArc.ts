import type { Vec2 } from '../../math/vector';
import { distanceToEllipticalArc } from '../../math/hitTest';
import { ellipticalArcIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';

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

		const sc = viewport.worldToScreen(center.x, center.y);
		const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
		const smin = viewport.worldToScreen(minorPt.x, minorPt.y);
		const ss = viewport.worldToScreen(startPt.x, startPt.y);
		const se = viewport.worldToScreen(endPt.x, endPt.y);

		return distanceToEllipticalArc(screen, sc, smaj, smin, ss, se, !!this.clockwise, thresholdPx);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		const startPt = sketch.points.get(this.startPointId);
		const endPt = sketch.points.get(this.endPointId);
		if (!center || !majorPt || !minorPt || !startPt || !endPt) return false;
		return ellipticalArcIntersectsAABB(
			center,
			majorPt,
			minorPt,
			startPt,
			endPt,
			!!this.clockwise,
			minX,
			minY,
			maxX,
			maxY
		);
	}
}

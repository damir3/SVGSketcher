import type { Vec2 } from '../../math/vector';
import { distanceToEllipse } from '../../math/hitTest';
import { ellipseIntersectsAABB } from '../../math/aabb';
import type { GeoEllipse } from '../../math/intersection';
import type { ISketchPrimitive } from './base';

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

		const sc = viewport.worldToScreen(center.x, center.y);
		const smaj = viewport.worldToScreen(majorPt.x, majorPt.y);
		const smin = viewport.worldToScreen(minorPt.x, minorPt.y);

		return distanceToEllipse(screen, sc, smaj, smin);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const center = sketch.points.get(this.centerId);
		const majorPt = sketch.points.get(this.majorAxisPointId);
		const minorPt = sketch.points.get(this.minorAxisPointId);
		if (!center || !majorPt || !minorPt) return false;
		return ellipseIntersectsAABB(center, majorPt, minorPt, minX, minY, maxX, maxY);
	}

	toGeoCurve(sketch: any): GeoEllipse | null {
		const center = sketch.points.get(this.centerId);
		const maj = sketch.points.get(this.majorAxisPointId);
		const min = sketch.points.get(this.minorAxisPointId);
		if (!center || !maj || !min) return null;
		return {
			type: 'ellipse',
			id: this.id,
			center: { x: center.x, y: center.y },
			centerId: this.centerId,
			majorAxisPointId: this.majorAxisPointId,
			minorAxisPointId: this.minorAxisPointId,
			majorAxisPoint: { x: maj.x, y: maj.y },
			minorAxisPoint: { x: min.x, y: min.y },
			isConstruction: this.isConstruction,
		};
	}
}

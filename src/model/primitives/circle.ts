import type { Vec2 } from '../../math/vector';
import { distanceToCircle } from '../../math/hitTest';
import { circleIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';

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
}

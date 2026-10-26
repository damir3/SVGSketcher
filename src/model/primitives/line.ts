import type { Vec2 } from '../../math/vector';
import { distanceToSegment } from '../../math/hitTest';
import { segmentIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';

export class SketchLine implements ISketchPrimitive {
	readonly type = 'line' as const;
	id: string;
	p1Id: string;
	p2Id: string;
	isConstruction?: boolean;
	isSplineHandle?: boolean;
	parentSplineId?: string;

	constructor(
		dataOrId:
			| string
			| {
					id: string;
					p1Id: string;
					p2Id: string;
					isConstruction?: boolean;
					isSplineHandle?: boolean;
					parentSplineId?: string;
			  },
		p1Id = '',
		p2Id = '',
		isConstruction = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.p1Id = dataOrId.p1Id;
			this.p2Id = dataOrId.p2Id;
			this.isConstruction = dataOrId.isConstruction;
			this.isSplineHandle = dataOrId.isSplineHandle;
			this.parentSplineId = dataOrId.parentSplineId;
		} else {
			this.id = dataOrId;
			this.p1Id = p1Id;
			this.p2Id = p2Id;
			this.isConstruction = isConstruction;
		}
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;
		const s1 = viewport.worldToScreen(p1.x, p1.y);
		const s2 = viewport.worldToScreen(p2.x, p2.y);
		return distanceToSegment(screen, s1, s2);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return false;
		return segmentIntersectsAABB(p1.x, p1.y, p2.x, p2.y, minX, minY, maxX, maxY);
	}
}

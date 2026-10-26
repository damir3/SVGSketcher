import type { Vec2 } from '../../math/vector';
import { distanceToPoint } from '../../math/hitTest';
import { pointIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';

export class SketchPoint implements ISketchPrimitive {
	readonly type = 'point' as const;
	id: string;
	x: number;
	y: number;
	fixed: boolean;

	constructor(
		dataOrId: string | { id: string; x: number; y: number; fixed?: boolean },
		x = 0,
		y = 0,
		fixed = false
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.x = dataOrId.x;
			this.y = dataOrId.y;
			this.fixed = dataOrId.fixed ?? false;
		} else {
			this.id = dataOrId;
			this.x = x;
			this.y = y;
			this.fixed = fixed;
		}
	}

	distanceTo(screen: Vec2, _sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const s = viewport.worldToScreen(this.x, this.y);
		return distanceToPoint(screen, s);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, _sketch?: any): boolean {
		return pointIntersectsAABB(this.x, this.y, minX, minY, maxX, maxY);
	}

	toGeoCurve(_sketch?: any): null {
		return null;
	}
}

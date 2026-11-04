import type { Vec2 } from '../../math/vector';
import { distanceToPoint } from '../../math/hitTest';
import { pointIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

export class SketchPoint implements ISketchPrimitive {
	readonly type = 'point' as const;
	id: string;
	x: number;
	y: number;
	fixed: boolean;

	constructor(dataOrId: string | { id: string; x: number; y: number; fixed?: boolean }, x = 0, y = 0, fixed = false) {
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

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-pt-x',
				label: 'X',
				unit: 'mm',
				getValue: () => Number(this.x.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setPointCoords(this.id, val, this.y),
			},
			{
				id: 'insp-pt-y',
				label: 'Y',
				unit: 'mm',
				getValue: () => Number(this.y.toFixed(2)),
				onCommit: (val, ctx) => ctx.sketch.setPointCoords(this.id, this.x, val),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('point', this.id),
		constraintsLabel: 'this point',
		entityIds: () => [this.id],
	});
}

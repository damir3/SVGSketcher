import { Vec2, type XY } from '../../math/vector';
import { pointIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

export class SketchPoint extends Vec2 implements ISketchPrimitive {
	readonly type = 'point' as const;
	id: string;
	fixed: boolean;

	constructor(dataOrId: string | { id: string; x: number; y: number; fixed?: boolean }, x = 0, y = 0, fixed = false) {
		const data = typeof dataOrId === 'string' ? { id: dataOrId, x, y, fixed } : dataOrId;
		super(data.x, data.y);
		this.id = data.id;
		this.fixed = data.fixed ?? false;
	}

	// One argument measures world distance; the primitive hit test supplies a viewport.
	override distanceTo(v: XY): number;
	override distanceTo(
		screen: XY,
		sketch: unknown,
		viewport: { worldToScreen(point: XY): XY },
		thresholdPx?: number
	): number;
	override distanceTo(v: XY, _sketch?: unknown, viewport?: { worldToScreen(point: XY): XY }): number {
		return viewport ? Vec2.from(viewport.worldToScreen(this)).distanceTo(v) : super.distanceTo(v);
	}

	intersectsAABB(min: Vec2, max: Vec2, _sketch?: any): boolean {
		return pointIntersectsAABB(this, min, max);
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

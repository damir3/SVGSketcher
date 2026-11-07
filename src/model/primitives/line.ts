import { angleFromToDeg, dist, type Vec2 } from '../../math/vector';
import { distanceToSegment } from '../../math/hitTest';
import { segmentIntersectsAABB } from '../../math/aabb';
import type { GeoSegment } from '../../math/intersection';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

export class SketchLine implements ISketchPrimitive {
	readonly type = 'line' as const;
	id: string;
	p1Id: string;
	p2Id: string;
	isConstruction?: boolean;
	isSplineHandle?: boolean;
	parentSplineId?: string;
	isAutomaticSplineHandle?: boolean;

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
					isAutomaticSplineHandle?: boolean;
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
			this.isAutomaticSplineHandle = dataOrId.isAutomaticSplineHandle;
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
		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		return distanceToSegment(screen, s1, s2);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return false;
		return segmentIntersectsAABB(p1, p2, min, max);
	}

	toGeoCurve(sketch: any): GeoSegment | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;
		return {
			type: 'segment',
			id: this.id,
			p1: { x: p1.x, y: p1.y },
			p2: { x: p2.x, y: p2.y },
			isConstruction: this.isConstruction,
		};
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		fields: [
			{
				id: 'insp-line-length',
				label: 'Length',
				unit: 'mm',
				getValue: ctx => {
					const p1 = ctx.sketch.points.get(this.p1Id);
					const p2 = ctx.sketch.points.get(this.p2Id);
					return p1 && p2 ? Number(dist(p1, p2).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setLineLength(this.id, val),
				validate: val => !isNaN(val) && isFinite(val) && val > 0,
			},
			{
				id: 'insp-line-angle',
				label: 'Angle',
				unit: '°',
				getValue: ctx => {
					const p1 = ctx.sketch.points.get(this.p1Id);
					const p2 = ctx.sketch.points.get(this.p2Id);
					return p1 && p2 ? Number(angleFromToDeg(p1, p2).toFixed(2)) : 0;
				},
				onCommit: (val, ctx) => ctx.sketch.setLineAngle(this.id, val),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('line', this.id),
		constraintsLabel: 'this line',
		entityIds: () => [this.id],
	});
}

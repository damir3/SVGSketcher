import type { Vec2 } from '../../math/vector';
import { bsplineToBezier, fitPointsToBezier, type BezierSegment } from '../../math/spline';
import { distanceToSpline } from '../../math/hitTest';
import { intersectSplineCurve, type GeoSpline } from '../../math/intersection';
import { pointIntersectsAABB } from '../../math/aabb';
import type { ISketchPrimitive } from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';

export class SketchSpline implements ISketchPrimitive {
	readonly type = 'spline' as const;
	id: string;
	splineType: 'fit' | 'control';
	pointIds: string[];
	tangentLineIds?: string[];
	knots?: number[];
	isClosed?: boolean;
	isConstruction?: boolean;

	constructor(
		dataOrId:
			| string
			| {
					id: string;
					splineType: 'fit' | 'control';
					pointIds: string[];
					tangentLineIds?: string[];
					knots?: number[];
					isClosed?: boolean;
					isConstruction?: boolean;
			  },
		splineType: 'fit' | 'control' = 'fit',
		pointIds: string[] = []
	) {
		if (typeof dataOrId === 'object') {
			this.id = dataOrId.id;
			this.splineType = dataOrId.splineType;
			this.pointIds = [...dataOrId.pointIds];
			this.tangentLineIds = dataOrId.tangentLineIds ? [...dataOrId.tangentLineIds] : undefined;
			this.knots = dataOrId.knots ? [...dataOrId.knots] : undefined;
			this.isClosed = dataOrId.isClosed;
			this.isConstruction = dataOrId.isConstruction;
		} else {
			this.id = dataOrId;
			this.splineType = splineType;
			this.pointIds = [...pointIds];
		}
	}

	toGeoCurve(sketch: any): GeoSpline | null {
		const pts: Vec2[] = [];
		for (const pid of this.pointIds) {
			const p = sketch.points.get(pid);
			if (!p) return null;
			pts.push({ x: p.x, y: p.y });
		}
		if (pts.length < 2) return null;

		let bezierSegments: BezierSegment[] = [];
		if (this.splineType === 'control') {
			bezierSegments = bsplineToBezier(pts, this.knots);
		} else {
			const handles = (this.tangentLineIds || []).map((lid: string) => {
				const line = sketch.lines.get(lid);
				if (!line) return null;
				const p1 = sketch.points.get(line.p1Id);
				const p2 = sketch.points.get(line.p2Id);
				if (!p1 || !p2) return null;
				return {
					h1: p1,
					h2: p2,
				};
			});
			bezierSegments = fitPointsToBezier(pts, handles);
		}

		return {
			type: 'spline',
			id: this.id,
			splineType: this.splineType,
			pointIds: [...this.pointIds],
			points: pts,
			tangentLineIds: this.tangentLineIds ? [...this.tangentLineIds] : undefined,
			bezierSegments,
			isClosed: this.splineType === 'control' ? false : this.isClosed,
			isConstruction: this.isConstruction,
		};
	}

	getScreenSegments(sketch: any, viewport: any): BezierSegment[] | null {
		const geo = this.toGeoCurve(sketch);
		if (!geo) return null;

		return geo.bezierSegments.map(seg => [
			viewport.worldToScreen(seg[0]),
			viewport.worldToScreen(seg[1]),
			viewport.worldToScreen(seg[2]),
			viewport.worldToScreen(seg[3]),
		]);
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const segments = this.getScreenSegments(sketch, viewport);
		if (!segments) return null;
		return distanceToSpline(screen, segments);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const curve = this.toGeoCurve(sketch);
		if (!curve) return false;
		if (
			curve.bezierSegments.some(
				([start, , , end]) => pointIntersectsAABB(start, min, max) || pointIntersectsAABB(end, min, max)
			)
		)
			return true;
		const corners = [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
		return corners.some(
			(p1, index) =>
				intersectSplineCurve(curve, {
					type: 'segment',
					id: '',
					p1,
					p2: corners[(index + 1) % corners.length],
				}).length > 0
		);
	}

	readonly sidebarPanel: IPrimitivePanel = new PrimitivePanel({
		title: () => this.id,
		rows: [
			{
				label: 'Type:',
				getValue: () => (this.splineType === 'fit' ? 'Fit Point Spline' : 'Control Point Spline'),
			},
			{
				label: 'Points:',
				getValue: () => `${this.pointIds.length} points`,
			},
			{
				label: 'Closed:',
				getValue: () => (this.isClosed ? 'Yes' : 'No'),
			},
		],
		getConstraints: ctx => ctx.sketch.getConstraintsForEntity('spline', this.id),
		constraintsLabel: 'this spline',
		entityIds: () => [this.id],
	});
}

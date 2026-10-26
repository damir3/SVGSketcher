import type { Vec2 } from '../../math/vector';
import {
	bsplineToBezier,
	fitPointsToBezier,
	type BezierSegment,
} from '../../math/spline';
import { distanceToSpline } from '../../math/hitTest';
import type { GeoSpline } from '../../math/intersection';
import type { ISketchPrimitive } from './base';
import type { SketchPoint } from './point';

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
					h1: { x: p1.x, y: p1.y },
					h2: { x: p2.x, y: p2.y },
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
			viewport.worldToScreen(seg[0].x, seg[0].y),
			viewport.worldToScreen(seg[1].x, seg[1].y),
			viewport.worldToScreen(seg[2].x, seg[2].y),
			viewport.worldToScreen(seg[3].x, seg[3].y),
		]);
	}

	distanceTo(screen: Vec2, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const segments = this.getScreenSegments(sketch, viewport);
		if (!segments) return null;
		return distanceToSpline(screen, segments);
	}

	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch: any): boolean {
		const pts = this.pointIds.map(id => sketch.points.get(id)).filter((p: any): p is SketchPoint => !!p);
		for (const pt of pts) {
			if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) return true;
		}
		return false;
	}
}

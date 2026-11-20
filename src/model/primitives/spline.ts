import { Vec2 } from '../../math/vector';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineParamAtPoint,
	getSplineSvgPath,
	type BezierSegment,
} from '../../math/spline';
import { filletSplinePreview } from '../../math/filletPreview';
import { distanceToSpline } from '../../math/hitTest';
import { type GeoSpline } from '../../math/intersection';
import { curvesIntersectAABB } from '../../math/aabb';
import {
	createPrimitiveSvgGroup,
	isPointIdConstrained,
	translatePrimitivePoints,
	type ISketchPrimitive,
	type PrimitiveRenderContext,
	type PrimitiveSnapCandidate,
	type PrimitiveTransformRenderOptions,
} from './base';
import { PrimitivePanel, type IPrimitivePanel } from '../../ui/panels/primitives';
import { createSvgPath } from '../../canvas/svg';
import { getPrimitiveStrokeAttrs, HIT_AREA_STROKE_ATTRS, SPLINE_STYLES } from '../../canvas/styles';

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
			if (p) pts.push(new Vec2(p.x, p.y));
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

	getPointIds(sketch?: any): string[] {
		const pts = [...this.pointIds];
		if (sketch && this.tangentLineIds) {
			for (const lid of this.tangentLineIds) {
				const l = sketch.lines.get(lid);
				if (l) pts.push(l.p1Id, l.p2Id);
			}
		}
		return pts;
	}

	isConstrained(sketch: any, constrainedParams?: ReadonlySet<string>): boolean {
		return (
			this.pointIds.every(pid => !sketch.points.has(pid) || isPointIdConstrained(pid, constrainedParams)) &&
			(this.splineType !== 'fit' ||
				!this.tangentLineIds ||
				this.tangentLineIds.every(id => {
					const line = sketch.lines.get(id);
					return (
						!line ||
						(isPointIdConstrained(line.p1Id, constrainedParams) && isPointIdConstrained(line.p2Id, constrainedParams))
					);
				}))
		);
	}

	render(ctx: PrimitiveRenderContext): void {
		const geo = this.toGeoCurve(ctx.sketch);
		if (!geo) return;

		const d = getSplineSvgPath(geo.bezierSegments, p => ctx.viewport.worldToScreen(p), !!this.isClosed);
		const trim = ctx.filletTrims.get(this.id);
		const closed = !!this.isClosed && !trim;
		const previewD = trim
			? getSplineSvgPath(
					filletSplinePreview(geo.bezierSegments, this.splineType, trim),
					p => ctx.viewport.worldToScreen(p),
					closed
				)
			: d;

		const splineG = createPrimitiveSvgGroup(this, ctx.isSelected, ctx.geometryGroup);
		createSvgPath(d, HIT_AREA_STROKE_ATTRS, splineG);
		createSvgPath(
			previewD,
			{
				fill: closed ? SPLINE_STYLES.closedFill : 'none',
				...getPrimitiveStrokeAttrs(ctx.isSelected, !!this.isConstruction, ctx.baseColor, true),
			},
			splineG
		);
	}

	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }> {
		const spline = opts.geometry === undefined ? this.toGeoCurve(opts.sketch) : opts.geometry;
		if (!spline) return [];
		if (spline.type !== 'spline') return [];

		const points = spline.points.map(point => opts.transformPoint(point.x, point.y));
		if (opts.targetGroup && opts.strokeAttrs) {
			const d = getSplineSvgPath(
				spline.bezierSegments,
				point => opts.viewport.worldToScreen(opts.transformPoint(point.x, point.y)),
				!!spline.isClosed
			);
			createSvgPath(d, opts.strokeAttrs, opts.targetGroup);
			for (const point of points) {
				opts.drawVertex?.(opts.viewport.worldToScreen(point), point);
			}
		}
		return spline.isClosed ? points.slice(0, -1) : points;
	}

	snapTo(screenPos: Vec2, sketch: any, viewport: any, maxDistPx: number): PrimitiveSnapCandidate | null {
		const screenSegments = this.getScreenSegments(sketch, viewport);
		if (!screenSegments) return null;

		const proj = getSplineParamAtPoint(screenSegments, screenPos);
		if (proj.distance >= maxDistPx) return null;

		return {
			type: 'spline',
			id: this.id,
			dist: proj.distance,
			worldPos: viewport.screenToWorld(proj.point),
			screenPos: proj.point,
		};
	}

	drag(sketch: any, startWorld: Vec2, currentWorld: Vec2, initialPoints: ReadonlyMap<string, Vec2>): void {
		translatePrimitivePoints(sketch, startWorld, currentWorld, initialPoints);
	}

	intersectsAABB(min: Vec2, max: Vec2, sketch: any): boolean {
		const curve = this.toGeoCurve(sketch);
		if (!curve) return false;
		return curvesIntersectAABB([curve], min, max)[0];
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

import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';
import type { Vec2 } from '../../math/vector';
import {
	bsplineToBezier,
	fitPointsToBezier,
	getSplineParamAtPoint,
	getSplineTangentAtParam,
	type BezierSegment,
} from '../../math/spline';

export interface SplineHandlePointPair {
	p1Id: string;
	p2Id: string;
}

/**
 * Constrains a point to lie on the curve of a spline (fit spline or B-spline)
 */
export class PointOnSplineConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly splineId: string;
	readonly splineType: 'fit' | 'control';
	readonly splinePointIds: string[];
	readonly handlePoints?: SplineHandlePointPair[];
	readonly tangentLineIds?: string[];
	readonly knots?: number[];
	readonly isClosed?: boolean;

	constructor(
		id: string,
		pointId: string,
		splineId: string,
		splineType: 'fit' | 'control',
		splinePointIds: string[],
		handlePoints?: SplineHandlePointPair[],
		tangentLineIds?: string[],
		knots?: number[],
		isClosed?: boolean,
		weight = 1.0
	) {
		const handlePointIds: string[] = [];
		if (handlePoints) {
			for (const hp of handlePoints) {
				handlePointIds.push(hp.p1Id, hp.p2Id);
			}
		}
		const allEntityIds = Array.from(
			new Set([
				pointId,
				splineId,
				...splinePointIds,
				...(tangentLineIds || []),
				...handlePointIds,
			])
		);

		super(id, 'point_on_spline', 'Point on Spline', allEntityIds, weight);
		this.pointId = pointId;
		this.splineId = splineId;
		this.splineType = splineType;
		this.splinePointIds = [...splinePointIds];
		this.handlePoints = handlePoints ? [...handlePoints] : undefined;
		this.tangentLineIds = tangentLineIds ? [...tangentLineIds] : undefined;
		this.knots = knots ? [...knots] : undefined;
		this.isClosed = isClosed;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const pts: Vec2[] = [];
		for (const pid of this.splinePointIds) {
			const x = paramMap.get(`${pid}.x`);
			const y = paramMap.get(`${pid}.y`);
			if (x === undefined || y === undefined) return [0];
			pts.push({ x, y });
		}
		if (pts.length < 2) return [0];

		let bezierSegments: BezierSegment[] = [];
		if (this.splineType === 'control') {
			bezierSegments = bsplineToBezier(pts, this.knots);
		} else {
			let handles: Array<{ h1: Vec2; h2: Vec2 } | null> | undefined;
			if (this.handlePoints && this.handlePoints.length > 0) {
				handles = this.handlePoints.map(hp => {
					if (!hp) return null;
					const h1x = paramMap.get(`${hp.p1Id}.x`);
					const h1y = paramMap.get(`${hp.p1Id}.y`);
					const h2x = paramMap.get(`${hp.p2Id}.x`);
					const h2y = paramMap.get(`${hp.p2Id}.y`);
					if (h1x === undefined || h1y === undefined || h2x === undefined || h2y === undefined) return null;
					return {
						h1: { x: h1x, y: h1y },
						h2: { x: h2x, y: h2y },
					};
				});
			}
			bezierSegments = fitPointsToBezier(pts, handles);
		}
		if (bezierSegments.length === 0) return [0];

		const px = paramMap.get(`${this.pointId}.x`);
		const py = paramMap.get(`${this.pointId}.y`);
		if (px === undefined || py === undefined) return [0];

		const proj = getSplineParamAtPoint(bezierSegments, { x: px, y: py });
		const tangent = getSplineTangentAtParam(bezierSegments, proj.param);
		const tLen = Math.max(Math.hypot(tangent.x, tangent.y), 1e-7);
		const nx = -tangent.y / tLen;
		const ny = tangent.x / tLen;

		const signedDist = (px - proj.point.x) * nx + (py - proj.point.y) * ny;
		return [signedDist * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}

	override render(ctx: ConstraintRenderContext): void {
		const pt = ctx.sketch.points.get(this.pointId);
		if (!pt) return;
		const s = ctx.viewport.worldToScreen(pt.x, pt.y);
		ctx.renderBadge(this.id, s.x, s.y + 14, '⚲', COLORS.primary);
	}
}

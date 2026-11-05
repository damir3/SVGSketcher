import type { IConstraint } from '../types';
import {
	BaseConstraint,
	FixedConstraint,
	CoincidentConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	DistanceConstraint,
	RadiusConstraint,
	EqualLengthConstraint,
	EqualRadiusConstraint,
	ParallelConstraint,
	CollinearConstraint,
	PerpendicularConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	PointOnEllipseConstraint,
	PointOnSplineConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	DragPointConstraint,
	AngleConstraint,
	ArcEndpointsConstraint,
	EllipseAxisConstraint,
	EllipticalArcEndpointsConstraint,
	PointToLineDistanceConstraint,
	OffsetConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	type PatternCopyData,
	RectangularPatternConstraint,
	type RectangularPatternCopyData,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
} from '.';
interface ConstraintSnapshotBase {
	id: string;
	name: string;
	entityIds: string[];
	weight: number;
	isSoft?: boolean;
	isDimensional?: boolean;
	value?: number;
	expression?: string;
}

type ConstraintSnapshotData =
	| { type: 'fixed' | 'drag_point'; pointId: string; targetX: number; targetY: number }
	| { type: 'coincident' | 'horizontal' | 'vertical'; p1Id: string; p2Id: string }
	| {
			type: 'distance';
			p1Id: string;
			p2Id: string;
			targetDistance: number;
			offset?: number;
			orientation: 'aligned' | 'horizontal' | 'vertical';
	  }
	| {
			type: 'point_to_line_distance';
			pointId: string;
			lineId: string;
			lineP1Id: string;
			lineP2Id: string;
			targetDistance: number;
			side: number;
			offset?: number;
	  }
	| {
			type: 'angle';
			line1Id: string;
			line2Id: string;
			l1P1: string;
			l1P2: string;
			l2P1: string;
			l2P2: string;
			targetAngle: number;
			arcRadius: number;
			s1: number;
			s2: number;
			sign: number;
	  }
	| {
			type: 'radius';
			circleId: string;
			targetRadius: number;
			leaderAngle?: number;
			displayMode: 'radius' | 'diameter';
	  }
	| { type: 'equal_length'; line1P1: string; line1P2: string; line2P1: string; line2P2: string }
	| {
			type: 'parallel' | 'collinear' | 'perpendicular';
			l1P1: string;
			l1P2: string;
			l2P1: string;
			l2P2: string;
	  }
	| { type: 'equal_radius'; circle1Id: string; circle2Id: string }
	| {
			type: 'symmetry';
			p1Id: string;
			p2Id: string;
			lineP1Id: string;
			lineP2Id: string;
			lineId?: string;
	  }
	| {
			type: 'circular_pattern';
			centerPtId: string;
			sourceObjectIds: string[];
			distribution: 'full' | 'partial' | 'symmetric';
			totalAngle: number;
			angleDeg?: number;
			quantity: number;
			suppression: boolean;
			suppressedIndices: number[];
			copies: PatternCopyData[];
			totalAngleExpression?: string;
			isReadOnly?: boolean;
	  }
	| {
			type: 'rectangular_pattern';
			sourceObjectIds: string[];
			line1Id: string | null;
			line1P1Id?: string;
			line1P2Id?: string;
			line2Id: string | null;
			line2P1Id?: string;
			line2P2Id?: string;
			quantity1: number;
			distance1: number;
			direction1: 'one_direction' | 'symmetric';
			quantity2: number;
			distance2: number;
			direction2: 'one_direction' | 'symmetric';
			suppression: boolean;
			suppressedIndices: number[];
			copies: RectangularPatternCopyData[];
			distance1Expression?: string;
			distance2Expression?: string;
	  }
	| { type: 'point_on_line'; pointId: string; lineP1Id: string; lineP2Id: string }
	| { type: 'point_on_circle'; pointId: string; circleCenterId: string; circleId: string }
	| {
			type: 'point_on_ellipse';
			pointId: string;
			ellipseId: string;
			centerId: string;
			majorAxisPointId: string;
			minorAxisPointId: string;
	  }
	| {
			type: 'point_on_spline';
			pointId: string;
			splineId: string;
			splineType: 'fit' | 'control';
			splinePointIds: string[];
			handlePoints?: any[];
			tangentLineIds?: string[];
			knots?: number[];
			isClosed?: boolean;
	  }
	| {
			type: 'tangent_line_circle';
			lineP1Id: string;
			lineP2Id: string;
			circleCenterId: string;
			circleId: string;
			initialSide: number;
			lineId?: string;
	  }
	| {
			type: 'tangent_circle_circle';
			circle1CenterId: string;
			circle1Id: string;
			circle2CenterId: string;
			circle2Id: string;
			isInternal: boolean;
			outerCircleId: string | null;
			sharedPointId: string | null;
	  }
	| { type: 'concentric'; c1CenterId: string; c2CenterId: string }
	| { type: 'midpoint'; midId: string; p1Id: string; p2Id: string; ratio: number }
	| {
			type: 'arc_endpoints';
			arcId: string;
			centerId: string;
			startPointId: string;
			endPointId: string;
	  }
	| {
			type: 'ellipse_axis';
			ellipseId: string;
			centerId: string;
			majorAxisPointId: string;
			minorAxisPointId: string;
	  }
	| {
			type: 'elliptical_arc_endpoints';
			arcId: string;
			centerId: string;
			majorAxisPointId: string;
			minorAxisPointId: string;
			startPointId: string;
			endPointId: string;
	  }
	| {
			type: 'offset';
			targetDistance: number;
			pairs: any[];
			dimPairIndex: number;
			sourceChain?: any;
			direction?: any;
			flip?: boolean;
			cornerPointIds?: string[];
	  }
	| {
			type: 'origin_distance';
			pointId: string;
			targetDistance: number;
			orientation: 'aligned' | 'horizontal' | 'vertical';
			side: number;
			offset?: number;
			isCoincident: boolean;
	  }
	| {
			type: 'line_to_axis_distance';
			lineId: string;
			lineP1Id: string;
			lineP2Id: string;
			axis: 'x' | 'y';
			targetDistance: number;
			side: number;
			offset?: number;
			isCollinear: boolean;
	  };

export type ConstraintSnapshot = ConstraintSnapshotBase & ConstraintSnapshotData;

const constraintClasses: Record<string, { prototype: BaseConstraint }> = {
	fixed: FixedConstraint,
	coincident: CoincidentConstraint,
	horizontal: HorizontalConstraint,
	vertical: VerticalConstraint,
	distance: DistanceConstraint,
	radius: RadiusConstraint,
	equal_length: EqualLengthConstraint,
	equal_radius: EqualRadiusConstraint,
	parallel: ParallelConstraint,
	collinear: CollinearConstraint,
	perpendicular: PerpendicularConstraint,
	point_on_line: PointOnLineConstraint,
	point_on_circle: PointOnCircleConstraint,
	point_on_ellipse: PointOnEllipseConstraint,
	point_on_spline: PointOnSplineConstraint,
	tangent_line_circle: TangentLineCircleConstraint,
	tangent_circle_circle: TangentCircleCircleConstraint,
	concentric: ConcentricConstraint,
	midpoint: MidpointConstraint,
	drag_point: DragPointConstraint,
	angle: AngleConstraint,
	arc_endpoints: ArcEndpointsConstraint,
	ellipse_axis: EllipseAxisConstraint,
	elliptical_arc_endpoints: EllipticalArcEndpointsConstraint,
	point_to_line_distance: PointToLineDistanceConstraint,
	offset: OffsetConstraint,
	symmetry: SymmetryConstraint,
	circular_pattern: CircularPatternConstraint,
	rectangular_pattern: RectangularPatternConstraint,
	origin_distance: OriginDistanceConstraint,
	line_to_axis_distance: LineToAxisDistanceConstraint,
};

/** Copies data fields only; runtime UI state and methods stay on the class instance. */
export function serializeConstraint(constraint: IConstraint): ConstraintSnapshot {
	const data = Object.fromEntries(
		Object.entries(constraint)
			.filter(([key]) => key !== 'sidebarPanel')
			.map(([key, value]) => [key, structuredClone(value)])
	);
	return data as ConstraintSnapshot;
}

export function deserializeConstraint(snapshot: ConstraintSnapshot): IConstraint | null {
	const constraintClass = constraintClasses[snapshot.type];
	if (!constraintClass) return null;

	const data: Record<string, unknown> = {
		...Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, structuredClone(value)])),
		type: snapshot.type,
		name: snapshot.name ?? snapshot.type,
		entityIds: snapshot.entityIds ?? [],
		weight: snapshot.weight ?? 1,
	};
	return BaseConstraint.restoreFromSnapshot(constraintClass, data);
}

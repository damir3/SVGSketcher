import type { IConstraint, ConstraintType } from '../solver/types';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc, SketchSpline } from './types';
import {
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
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	AngleConstraint,
	ArcEndpointsConstraint,
	EllipseAxisConstraint,
	EllipticalArcEndpointsConstraint,
	PointToLineDistanceConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	type PatternCopyData,
	RectangularPatternConstraint,
	type RectangularPatternCopyData,
} from '../solver/constraints';

export interface SerializedConstraint {
	id: string;
	type: ConstraintType;
	name: string;
	entityIds: string[];
	weight: number;
	isSoft?: boolean;
	isDimensional?: boolean;
	value?: number;

	// Specific constraint properties
	pointId?: string;
	targetX?: number;
	targetY?: number;

	p1Id?: string;
	p2Id?: string;
	targetDistance?: number;
	offset?: number;
	orientation?: 'aligned' | 'horizontal' | 'vertical';
	targetAngle?: number;
	arcRadius?: number;
	line1Id?: string | null;
	line2Id?: string | null;
	lineId?: string;
	side?: number;
	s1?: number;
	s2?: number;
	sign?: number;

	circleId?: string;
	circle1Id?: string;
	circle2Id?: string;
	circleCenterId?: string;
	circle1CenterId?: string;
	circle2CenterId?: string;
	isInternal?: boolean;
	outerCircleId?: string | null;
	targetRadius?: number;
	leaderAngle?: number;
	displayMode?: 'radius' | 'diameter';

	line1P1?: string;
	line1P2?: string;
	line2P1?: string;
	line2P2?: string;

	l1P1?: string;
	l1P2?: string;
	l2P1?: string;
	l2P2?: string;

	lineP1Id?: string;
	lineP2Id?: string;
	initialSide?: number;

	c1CenterId?: string;
	c2CenterId?: string;

	midId?: string;
	ratio?: number;

	arcId?: string;
	centerId?: string;
	startPointId?: string;
	endPointId?: string;

	ellipseId?: string;
	majorAxisPointId?: string;
	minorAxisPointId?: string;

	sourcePtId?: string;
	patternPtId?: string;
	centerPtId?: string;
	angleDeg?: number;
	sourceObjectIds?: string[];
	distribution?: 'full' | 'partial' | 'symmetric';
	totalAngle?: number;
	quantity?: number;
	suppression?: boolean;
	suppressedIndices?: number[];
	copies?: PatternCopyData[] | RectangularPatternCopyData[];
	line1P1Id?: string | null;
	line1P2Id?: string | null;
	line2P1Id?: string | null;
	line2P2Id?: string | null;
	quantity1?: number;
	distance1?: number;
	direction1?: 'one_direction' | 'symmetric';
	quantity2?: number;
	distance2?: number;
	direction2?: 'one_direction' | 'symmetric';
}

export interface SketchSnapshot {
	points: SketchPoint[];
	lines: SketchLine[];
	circles: SketchCircle[];
	arcs: SketchArc[];
	ellipses: SketchEllipse[];
	ellipticalArcs: SketchEllipticalArc[];
	splines?: SketchSpline[];
	constraints: SerializedConstraint[];
	idCounter: number;
}

export function serializeConstraint(c: IConstraint): SerializedConstraint {
	const base: SerializedConstraint = {
		id: c.id,
		type: c.type,
		name: c.name,
		entityIds: [...c.entityIds],
		weight: c.weight,
		isSoft: c.isSoft,
		isDimensional: c.isDimensional,
		value: c.value,
	};

	if (c instanceof FixedConstraint) {
		base.pointId = c.pointId;
		base.targetX = c.targetX;
		base.targetY = c.targetY;
	} else if (c instanceof CoincidentConstraint) {
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
	} else if (c instanceof HorizontalConstraint) {
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
	} else if (c instanceof VerticalConstraint) {
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
	} else if (c instanceof DistanceConstraint) {
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
		base.targetDistance = c.targetDistance;
		base.offset = c.offset;
		base.orientation = c.orientation;
	} else if (c instanceof PointToLineDistanceConstraint) {
		base.pointId = c.pointId;
		base.lineId = c.lineId;
		base.lineP1Id = c.lineP1Id;
		base.lineP2Id = c.lineP2Id;
		base.targetDistance = c.targetDistance;
		base.side = c.side;
		base.offset = c.offset;
	} else if (c instanceof AngleConstraint) {
		base.line1Id = c.line1Id;
		base.line2Id = c.line2Id;
		base.l1P1 = c.l1P1;
		base.l1P2 = c.l1P2;
		base.l2P1 = c.l2P1;
		base.l2P2 = c.l2P2;
		base.targetAngle = c.targetAngle;
		base.arcRadius = c.arcRadius;
		base.s1 = c.s1;
		base.s2 = c.s2;
		base.sign = c.sign;
	} else if (c instanceof RadiusConstraint) {
		base.circleId = c.circleId;
		base.targetRadius = c.targetRadius;
		base.leaderAngle = c.leaderAngle;
		base.displayMode = c.displayMode;
	} else if (c instanceof EqualLengthConstraint) {
		base.line1P1 = c.line1P1;
		base.line1P2 = c.line1P2;
		base.line2P1 = c.line2P1;
		base.line2P2 = c.line2P2;
	} else if (c instanceof EqualRadiusConstraint) {
		base.circle1Id = c.circle1Id;
		base.circle2Id = c.circle2Id;
	} else if (c instanceof ParallelConstraint) {
		base.l1P1 = c.l1P1;
		base.l1P2 = c.l1P2;
		base.l2P1 = c.l2P1;
		base.l2P2 = c.l2P2;
	} else if (c instanceof CollinearConstraint) {
		base.l1P1 = c.l1P1;
		base.l1P2 = c.l1P2;
		base.l2P1 = c.l2P1;
		base.l2P2 = c.l2P2;
	} else if (c instanceof SymmetryConstraint) {
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
		base.lineP1Id = c.lineP1Id;
		base.lineP2Id = c.lineP2Id;
		base.lineId = c.lineId;
	} else if (c instanceof CircularPatternConstraint) {
		base.centerPtId = c.centerPtId;
		base.sourceObjectIds = [...c.sourceObjectIds];
		base.distribution = c.distribution;
		base.totalAngle = c.totalAngle;
		base.quantity = c.quantity;
		base.suppression = c.suppression;
		base.suppressedIndices = [...c.suppressedIndices];
		base.copies = JSON.parse(JSON.stringify(c.copies));
	} else if (c instanceof RectangularPatternConstraint) {
		base.sourceObjectIds = [...c.sourceObjectIds];
		base.line1Id = c.line1Id;
		base.line1P1Id = c.line1P1Id;
		base.line1P2Id = c.line1P2Id;
		base.line2Id = c.line2Id;
		base.line2P1Id = c.line2P1Id;
		base.line2P2Id = c.line2P2Id;
		base.quantity1 = c.quantity1;
		base.distance1 = c.distance1;
		base.direction1 = c.direction1;
		base.quantity2 = c.quantity2;
		base.distance2 = c.distance2;
		base.direction2 = c.direction2;
		base.suppression = c.suppression;
		base.suppressedIndices = [...c.suppressedIndices];
		base.copies = JSON.parse(JSON.stringify(c.copies));
	} else if (c instanceof PerpendicularConstraint) {
		base.l1P1 = c.l1P1;
		base.l1P2 = c.l1P2;
		base.l2P1 = c.l2P1;
		base.l2P2 = c.l2P2;
	} else if (c instanceof PointOnLineConstraint) {
		base.pointId = c.pointId;
		base.lineP1Id = c.lineP1Id;
		base.lineP2Id = c.lineP2Id;
	} else if (c instanceof PointOnCircleConstraint) {
		base.pointId = c.pointId;
		base.circleCenterId = c.circleCenterId;
		base.circleId = c.circleId;
	} else if (c instanceof TangentLineCircleConstraint) {
		base.lineP1Id = c.lineP1Id;
		base.lineP2Id = c.lineP2Id;
		base.circleCenterId = c.circleCenterId;
		base.circleId = c.circleId;
		base.initialSide = c.initialSide;
	} else if (c instanceof TangentCircleCircleConstraint) {
		base.circle1CenterId = c.circle1CenterId;
		base.circle1Id = c.circle1Id;
		base.circle2CenterId = c.circle2CenterId;
		base.circle2Id = c.circle2Id;
		base.isInternal = c.isInternal;
		base.outerCircleId = c.outerCircleId;
	} else if (c instanceof ConcentricConstraint) {
		base.c1CenterId = c.c1CenterId;
		base.c2CenterId = c.c2CenterId;
	} else if (c instanceof MidpointConstraint) {
		base.midId = c.midId;
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
		base.ratio = c.ratio;
	} else if (c instanceof ArcEndpointsConstraint) {
		base.arcId = c.arcId;
		base.centerId = c.centerId;
		base.startPointId = c.startPointId;
		base.endPointId = c.endPointId;
	} else if (c instanceof EllipseAxisConstraint) {
		base.ellipseId = c.ellipseId;
		base.centerId = c.centerId;
		base.majorAxisPointId = c.majorAxisPointId;
		base.minorAxisPointId = c.minorAxisPointId;
	} else if (c instanceof EllipticalArcEndpointsConstraint) {
		base.arcId = c.arcId;
		base.centerId = c.centerId;
		base.majorAxisPointId = c.majorAxisPointId;
		base.minorAxisPointId = c.minorAxisPointId;
		base.startPointId = c.startPointId;
		base.endPointId = c.endPointId;
	}

	return base;
}

export function deserializeConstraint(d: SerializedConstraint): IConstraint | null {
	let c: IConstraint | null = null;
	switch (d.type) {
		case 'fixed':
			c = new FixedConstraint(d.id, d.pointId!, d.targetX ?? 0, d.targetY ?? 0, d.weight);
			break;
		case 'coincident':
			c = new CoincidentConstraint(d.id, d.p1Id!, d.p2Id!, d.weight);
			break;
		case 'horizontal':
			c = new HorizontalConstraint(d.id, d.p1Id!, d.p2Id!, d.weight);
			break;
		case 'vertical':
			c = new VerticalConstraint(d.id, d.p1Id!, d.p2Id!, d.weight);
			break;
		case 'distance':
			c = new DistanceConstraint(
				d.id,
				d.p1Id!,
				d.p2Id!,
				d.targetDistance ?? d.value ?? 10,
				d.weight,
				d.offset,
				d.orientation ?? 'aligned'
			);
			break;
		case 'point_to_line_distance':
			c = new PointToLineDistanceConstraint(
				d.id,
				d.pointId!,
				d.lineId ?? d.entityIds[0],
				d.lineP1Id ?? d.entityIds[1],
				d.lineP2Id ?? d.entityIds[2],
				d.targetDistance ?? d.value ?? 10,
				d.side ?? 1,
				d.weight,
				d.offset
			);
			break;
		case 'angle':
			c = new AngleConstraint(
				d.id,
				d.line1Id ?? d.entityIds[0],
				d.line2Id ?? d.entityIds[1],
				d.l1P1!,
				d.l1P2!,
				d.l2P1!,
				d.l2P2!,
				d.targetAngle ?? d.value ?? 60,
				d.arcRadius ?? 40,
				d.s1 ?? 1,
				d.s2 ?? 1,
				d.sign ?? 1,
				d.weight
			);
			break;
		case 'radius':
			c = new RadiusConstraint(d.id, d.circleId!, d.targetRadius ?? d.value ?? 10, d.weight, d.leaderAngle, d.displayMode ?? 'radius');
			break;
		case 'equal_length':
			c = new EqualLengthConstraint(d.id, d.line1P1!, d.line1P2!, d.line2P1!, d.line2P2!, d.weight);
			break;
		case 'equal_radius':
			c = new EqualRadiusConstraint(d.id, d.circle1Id!, d.circle2Id!, d.weight);
			break;
		case 'parallel':
			c = new ParallelConstraint(d.id, d.l1P1!, d.l1P2!, d.l2P1!, d.l2P2!, d.weight);
			break;
		case 'collinear':
			c = new CollinearConstraint(d.id, d.l1P1!, d.l1P2!, d.l2P1!, d.l2P2!, d.weight);
			break;
		case 'symmetry':
			c = new SymmetryConstraint(d.id, d.p1Id!, d.p2Id!, d.lineP1Id!, d.lineP2Id!, d.weight, d.lineId);
			break;
		case 'circular_pattern':
			c = new CircularPatternConstraint(
				d.id,
				d.centerPtId!,
				d.sourceObjectIds || [],
				d.distribution || 'full',
				d.totalAngle ?? d.angleDeg ?? 180,
				d.quantity || 3,
				d.suppression ?? false,
				d.suppressedIndices || [],
				(d.copies as PatternCopyData[]) || [],
				d.weight
			);
			break;
		case 'rectangular_pattern':
			c = new RectangularPatternConstraint(
				d.id,
				d.sourceObjectIds || [],
				d.line1Id ?? null,
				d.line1P1Id,
				d.line1P2Id,
				d.line2Id ?? null,
				d.line2P1Id,
				d.line2P2Id,
				d.quantity1 || 3,
				d.distance1 ?? 0,
				d.direction1 || 'one_direction',
				d.quantity2 || 3,
				d.distance2 ?? 0,
				d.direction2 || 'one_direction',
				d.suppression ?? false,
				d.suppressedIndices || [],
				(d.copies as RectangularPatternCopyData[]) || [],
				d.weight
			);
			break;
		case 'perpendicular':
			c = new PerpendicularConstraint(d.id, d.l1P1!, d.l1P2!, d.l2P1!, d.l2P2!, d.weight);
			break;
		case 'point_on_line':
			c = new PointOnLineConstraint(d.id, d.pointId!, d.lineP1Id!, d.lineP2Id!, d.weight);
			break;
		case 'point_on_circle':
			c = new PointOnCircleConstraint(d.id, d.pointId!, d.circleCenterId!, d.circleId!, d.weight);
			break;
		case 'tangent_line_circle':
			c = new TangentLineCircleConstraint(
				d.id,
				d.lineP1Id!,
				d.lineP2Id!,
				d.circleCenterId!,
				d.circleId!,
				d.initialSide ?? 1,
				d.weight
			);
			break;
		case 'tangent_circle_circle':
			c = new TangentCircleCircleConstraint(
				d.id,
				d.circle1CenterId!,
				d.circle1Id!,
				d.circle2CenterId!,
				d.circle2Id!,
				d.isInternal ?? false,
				d.outerCircleId ?? null,
				d.weight
			);
			break;
		case 'concentric':
			c = new ConcentricConstraint(d.id, d.c1CenterId!, d.c2CenterId!, d.weight);
			break;
		case 'midpoint':
			c = new MidpointConstraint(d.id, d.midId!, d.p1Id!, d.p2Id!, d.weight, d.ratio ?? 0.5);
			break;
		case 'arc_endpoints':
			c = new ArcEndpointsConstraint(
				d.id,
				d.arcId!,
				d.centerId!,
				d.startPointId!,
				d.endPointId!,
				d.weight
			);
			break;
		case 'ellipse_axis':
			c = new EllipseAxisConstraint(
				d.id,
				d.ellipseId ?? d.entityIds[0],
				d.centerId!,
				d.majorAxisPointId!,
				d.minorAxisPointId!,
				d.weight
			);
			break;
		case 'elliptical_arc_endpoints':
			c = new EllipticalArcEndpointsConstraint(
				d.id,
				d.arcId ?? d.entityIds[0],
				d.centerId!,
				d.majorAxisPointId!,
				d.minorAxisPointId!,
				d.startPointId!,
				d.endPointId!,
				d.weight
			);
			break;
		default:
			return null;
	}
	if (c && d.name) {
		(c as any).name = d.name;
	}
	return c;
}

export class HistoryManager {
	private undoStack: SketchSnapshot[] = [];
	private redoStack: SketchSnapshot[] = [];
	private maxHistory = 60;

	pushState(snapshot: SketchSnapshot): void {
		this.undoStack.push(snapshot);
		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(currentSnapshot: SketchSnapshot): SketchSnapshot | null {
		if (this.undoStack.length === 0) return null;
		const prev = this.undoStack.pop()!;
		this.redoStack.push(currentSnapshot);
		return prev;
	}

	redo(currentSnapshot: SketchSnapshot): SketchSnapshot | null {
		if (this.redoStack.length === 0) return null;
		const next = this.redoStack.pop()!;
		this.undoStack.push(currentSnapshot);
		return next;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}

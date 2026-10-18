import type { IConstraint, ConstraintType } from '../solver/types';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc } from './types';
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
	PerpendicularConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	TangentLineCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	AngleConstraint,
	ArcEndpointsConstraint,
	EllipseAxisConstraint,
	EllipticalArcEndpointsConstraint,
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
	line1Id?: string;
	line2Id?: string;
	s1?: number;
	s2?: number;
	sign?: number;

	circleId?: string;
	circle1Id?: string;
	circle2Id?: string;
	circleCenterId?: string;
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

	arcId?: string;
	centerId?: string;
	startPointId?: string;
	endPointId?: string;

	ellipseId?: string;
	majorAxisPointId?: string;
	minorAxisPointId?: string;
}

export interface SketchSnapshot {
	points: SketchPoint[];
	lines: SketchLine[];
	circles: SketchCircle[];
	arcs: SketchArc[];
	ellipses: SketchEllipse[];
	ellipticalArcs: SketchEllipticalArc[];
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
	} else if (c instanceof ConcentricConstraint) {
		base.c1CenterId = c.c1CenterId;
		base.c2CenterId = c.c2CenterId;
	} else if (c instanceof MidpointConstraint) {
		base.midId = c.midId;
		base.p1Id = c.p1Id;
		base.p2Id = c.p2Id;
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
		case 'concentric':
			c = new ConcentricConstraint(d.id, d.c1CenterId!, d.c2CenterId!, d.weight);
			break;
		case 'midpoint':
			c = new MidpointConstraint(d.id, d.midId!, d.p1Id!, d.p2Id!, d.weight);
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

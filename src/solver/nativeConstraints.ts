import {
	FixedConstraint,
	DragPointConstraint,
	CoincidentConstraint,
	ConcentricConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	RadiusConstraint,
	EqualRadiusConstraint,
	DistanceConstraint,
	EqualLengthConstraint,
	MidpointConstraint,
	PointOnCircleConstraint,
	PointOnLineConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	AngleConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	EllipseAxisConstraint,
	PointOnEllipseConstraint,
	ArcEndpointsConstraint,
	EllipticalArcEndpointsConstraint,
	PointToLineDistanceConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
	OffsetConstraint,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
	PointOnSplineConstraint,
} from './constraints';
import type { IConstraint } from './types';
import { type Description, point, scalar, constant } from './nativeConstraintData';
import { describePatternConstraint } from './nativePatterns';
import { describeSplineConstraint } from './nativeSplines';
import { AutomaticSplineHandlesConstraint } from './constraints/automaticSplineHandles';
export interface ConstraintRow {
	constraint: IConstraint;
	row: number;
}
export interface CompiledConstraints {
	data: Float64Array;
	fallbackAll: ConstraintRow[];
	fallbackHard: ConstraintRow[];
	nativeCount: number;
}

const classes = new Set<Function>([
	FixedConstraint,
	DragPointConstraint,
	CoincidentConstraint,
	ConcentricConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	RadiusConstraint,
	EqualRadiusConstraint,
	DistanceConstraint,
	EqualLengthConstraint,
	MidpointConstraint,
	PointOnCircleConstraint,
	PointOnLineConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	AngleConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	EllipseAxisConstraint,
	PointOnEllipseConstraint,
	ArcEndpointsConstraint,
	EllipticalArcEndpointsConstraint,
	PointToLineDistanceConstraint,
	SymmetryConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
	OffsetConstraint,
	OriginDistanceConstraint,
	LineToAxisDistanceConstraint,
	PointOnSplineConstraint,
	AutomaticSplineHandlesConstraint,
]);
const isAxis = (id: string) => id === 'axis_x' || id === 'axis_y';

function describe(c: IConstraint): Description | Description[] | null {
	const constructor = c.constructor as Function & { prototype: IConstraint };
	// Overridden methods and custom/subclassed constraints retain their JS semantics.
	if (
		!classes.has(constructor) ||
		c.evaluate !== constructor.prototype.evaluate ||
		c.jacobian !== constructor.prototype.jacobian ||
		c.getEquationsCount !== constructor.prototype.getEquationsCount
	)
		return null;
	if (c instanceof FixedConstraint || c instanceof DragPointConstraint) {
		return {
			kind: 0,
			refs: [scalar(`${c.pointId}.x`, c.targetX), scalar(`${c.pointId}.y`, c.targetY)],
			a: c.targetX,
			b: c.targetY,
		};
	}
	if (c instanceof CoincidentConstraint) return { kind: 1, refs: [...point(c.p1Id), ...point(c.p2Id)], a: 0, b: 0 };
	if (c instanceof ConcentricConstraint)
		return { kind: 1, refs: [...point(c.c1CenterId), ...point(c.c2CenterId)], a: 0, b: 0 };
	if (c instanceof HorizontalConstraint || c instanceof VerticalConstraint) {
		return { kind: c instanceof HorizontalConstraint ? 2 : 3, refs: [...point(c.p1Id), ...point(c.p2Id)], a: 0, b: 0 };
	}
	if (c instanceof RadiusConstraint)
		return { kind: 4, refs: [scalar(`${c.circleId}.r`, c.targetRadius)], a: c.targetRadius, b: 0 };
	if (c instanceof EqualRadiusConstraint)
		return { kind: 5, refs: [scalar(`${c.circle1Id}.r`), scalar(`${c.circle2Id}.r`)], a: 0, b: 0 };
	if (c instanceof DistanceConstraint)
		return {
			kind: 6,
			refs: [...point(c.p1Id), ...point(c.p2Id)],
			a: c.targetDistance,
			b: c.orientation === 'horizontal' ? 1 : c.orientation === 'vertical' ? 2 : 0,
		};
	if (c instanceof EqualLengthConstraint)
		return {
			kind: 7,
			refs: [...point(c.line1P1), ...point(c.line1P2), ...point(c.line2P1), ...point(c.line2P2)],
			a: 0,
			b: 0,
		};
	if (c instanceof MidpointConstraint)
		return { kind: 8, refs: [...point(c.midId), ...point(c.p1Id), ...point(c.p2Id)], a: c.ratio, b: 0 };
	if (c instanceof PointOnCircleConstraint)
		return {
			kind: 9,
			refs: [...point(c.pointId), ...point(c.circleCenterId), scalar(`${c.circleId}.r`, 10)],
			a: 0,
			b: 0,
		};
	if (c instanceof PointOnLineConstraint)
		return {
			kind: 10,
			refs: [...point(c.pointId), ...point(c.lineP1Id), ...point(c.lineP2Id)],
			a: 0,
			b: 0,
			numeric: true,
		};
	if (c instanceof ParallelConstraint || c instanceof PerpendicularConstraint || c instanceof CollinearConstraint) {
		if (c instanceof CollinearConstraint && c.isThreePoint !== CollinearConstraint.prototype.isThreePoint) return null;
		return {
			kind: c instanceof ParallelConstraint ? 11 : c instanceof PerpendicularConstraint ? 12 : 13,
			refs: [...point(c.l1P1), ...point(c.l1P2), ...point(c.l2P1), ...point(c.l2P2)],
			a: c instanceof CollinearConstraint && c.isThreePoint() ? 1 : 0,
			b: 0,
			numeric: true,
		};
	}
	if (c instanceof AngleConstraint)
		return {
			kind: 14,
			refs: [
				...point(c.l1P1),
				...point(c.l1P2),
				...point(c.l2P1),
				...point(c.l2P2),
				constant(c.s1),
				constant(c.s2),
				constant(c.sign),
			],
			a: c.targetAngle,
			b: isAxis(c.line1Id) ? 1 : isAxis(c.line2Id) ? 2 : 0,
			numeric: true,
		};
	if (c instanceof TangentLineCircleConstraint)
		return {
			kind: 15,
			refs: [...point(c.circleCenterId), ...point(c.lineP1Id), ...point(c.lineP2Id), scalar(`${c.circleId}.r`, 10)],
			a: c.initialSide,
			b: 0,
			numeric: true,
		};
	if (c instanceof TangentCircleCircleConstraint) {
		if (c.sharedPointId)
			return {
				kind: 10,
				refs: [...point(c.sharedPointId), ...point(c.circle1CenterId), ...point(c.circle2CenterId)],
				a: 0,
				b: 0,
				numeric: true,
			};
		return {
			kind: 16,
			refs: [
				...point(c.circle1CenterId),
				...point(c.circle2CenterId),
				scalar(`${c.circle1Id}.r`, 10),
				scalar(`${c.circle2Id}.r`, 10),
			],
			a: !c.isInternal || !c.outerCircleId ? 0 : c.outerCircleId === c.circle1Id ? 1 : 2,
			b: 0,
			numeric: true,
		};
	}
	if (c instanceof EllipseAxisConstraint)
		return {
			kind: 12,
			refs: [...point(c.centerId), ...point(c.majorAxisPointId), ...point(c.centerId), ...point(c.minorAxisPointId)],
			a: 0,
			b: 0,
			numeric: true,
		};
	if (c instanceof PointOnEllipseConstraint)
		return {
			kind: 17,
			refs: [...point(c.centerId), ...point(c.majorAxisPointId), ...point(c.minorAxisPointId), ...point(c.pointId)],
			a: 0,
			b: 0,
			numeric: true,
		};
	if (c instanceof EllipticalArcEndpointsConstraint)
		return {
			kind: 18,
			refs: [
				...point(c.centerId),
				...point(c.majorAxisPointId),
				...point(c.minorAxisPointId),
				...point(c.startPointId),
				...point(c.endPointId),
			],
			a: 0,
			b: 0,
			numeric: true,
		};
	if (c instanceof ArcEndpointsConstraint)
		return {
			kind: 19,
			refs: [...point(c.centerId), ...point(c.startPointId), ...point(c.endPointId), scalar(`${c.arcId}.r`, 10)],
			a: 0,
			b: 0,
		};
	if (c instanceof PointToLineDistanceConstraint)
		return {
			kind: 20,
			refs: [...point(c.pointId), ...point(c.lineP1Id), ...point(c.lineP2Id)],
			a: c.targetDistance,
			b: c.side,
			numeric: true,
		};
	if (c instanceof OriginDistanceConstraint) {
		const mode = c.isCoincident ? 3 : c.orientation === 'horizontal' ? 1 : c.orientation === 'vertical' ? 2 : 0;
		return {
			kind: 27,
			refs: [...point(c.pointId), constant((mode === 1 || mode === 2) && c.targetDistance !== 0 ? c.side : 1)],
			a: c.isCoincident ? 0 : c.targetDistance,
			b: mode,
		};
	}
	if (c instanceof LineToAxisDistanceConstraint) {
		const axis = c.axis === 'x' ? 'y' : 'x';
		return {
			kind: 28,
			refs: [scalar(`${c.lineP1Id}.${axis}`), scalar(`${c.lineP2Id}.${axis}`), constant(c.isCollinear ? 1 : c.side)],
			a: c.isCollinear ? 0 : c.targetDistance,
			b: c.isCollinear ? 1 : 0,
		};
	}
	return describePatternConstraint(c) ?? describeSplineConstraint(c);
}

/** Records: [kind, allRow, hardRow/-1, weight, a, b, refCount, ...[freeIndex/-1, constant]]. */
export function compileNativeConstraints(
	constraints: IConstraint[],
	values: ReadonlyMap<string, number>,
	indices: ReadonlyMap<string, number>
): CompiledConstraints {
	const data: number[] = [],
		fallbackAll: ConstraintRow[] = [],
		fallbackHard: ConstraintRow[] = [];
	let row = 0,
		hardRow = 0,
		nativeCount = 0;
	for (const constraint of constraints) {
		const description = describe(constraint);
		const count = constraint.getEquationsCount();
		const parts = Array.isArray(description) ? description : description ? [description] : null;
		const records: number[][] = [];
		let offset = 0;
		const valid = parts?.every(part => {
			if (
				part.numeric &&
				part.refs.some(
					ref =>
						ref.id !== null &&
						indices.has(ref.id) &&
						!constraint.entityIds.some(entity => ref.id!.startsWith(`${entity}.`))
				)
			)
				return false;
			const record = [
				part.kind,
				row + offset,
				constraint.isSoft ? -1 : hardRow + offset,
				constraint.weight,
				part.a,
				part.b,
				part.refs.length,
				...part.refs.flatMap(ref =>
					ref.id === null ? [-1, ref.fallback] : [indices.get(ref.id) ?? -1, values.get(ref.id) ?? ref.fallback]
				),
			];
			offset += part.equations ?? count;
			records.push(record);
			return record.every(Number.isFinite);
		});
		if (valid && offset === count) {
			for (const record of records) for (const value of record) data.push(value);
			nativeCount++;
		} else {
			fallbackAll.push({ constraint, row });
			if (!constraint.isSoft) fallbackHard.push({ constraint, row: hardRow });
		}
		row += count;
		if (!constraint.isSoft) hardRow += count;
	}
	return { data: new Float64Array(data), fallbackAll, fallbackHard, nativeCount };
}

import type { IConstraint, ConstraintType, JacobianEntry } from './types';

export class BaseConstraint implements IConstraint {
	readonly id: string;
	readonly type: ConstraintType;
	name: string;
	weight: number;
	isSoft: boolean;
	isDimensional: boolean;
	value?: number;
	entityIds: string[];

	constructor(
		id: string,
		type: ConstraintType,
		name: string,
		entityIds: string[],
		weight = 1.0,
		isSoft = false,
		isDimensional = false,
		value?: number
	) {
		this.id = id;
		this.type = type;
		this.name = name;
		this.entityIds = entityIds;
		this.weight = weight;
		this.isSoft = isSoft;
		this.isDimensional = isDimensional;
		this.value = value;
	}

	getEquationsCount(): number {
		return 1;
	}

	evaluate(_paramMap: Map<string, number>): number[] {
		return [0];
	}

	jacobian(_paramIndices: Map<string, number>, _baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		return [];
	}

	protected addJacobianEntry(
		entries: JacobianEntry[],
		paramIndices: Map<string, number>,
		paramId: string,
		row: number,
		val: number
	): void {
		const col = paramIndices.get(paramId);
		if (col !== undefined && Math.abs(val) > 1e-12) {
			entries.push({ row, col, val });
		}
	}
}

/**
 * Fixes a point to specific world coordinates (X0, Y0)
 */
export class FixedConstraint extends BaseConstraint {
	readonly pointId: string;
	targetX: number;
	targetY: number;

	constructor(id: string, pointId: string, targetX: number, targetY: number, weight = 1.0) {
		super(id, 'fixed', 'Fixed Point', [pointId], weight, false, false);
		this.pointId = pointId;
		this.targetX = targetX;
		this.targetY = targetY;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? this.targetX;
		const py = paramMap.get(`${this.pointId}.y`) ?? this.targetY;
		return [(px - this.targetX) * this.weight, (py - this.targetY) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow + 1, this.weight);
		return res;
	}
}

/**
 * Makes two points coincide
 */
export class CoincidentConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'coincident', 'Coincident', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		return [(p1x - p2x) * this.weight, (p1y - p2y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -this.weight);
		return res;
	}
}

/**
 * Constrains a line segment or two points to be horizontal (y1 = y2)
 */
export class HorizontalConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'horizontal', 'Horizontal', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;
		return [(p2y - p1y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, this.weight);
		return res;
	}
}

/**
 * Constrains a line segment or two points to be vertical (x1 = x2)
 */
export class VerticalConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;

	constructor(id: string, p1Id: string, p2Id: string, weight = 1.0) {
		super(id, 'vertical', 'Vertical', [p1Id, p2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		return [(p2x - p1x) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, this.weight);
		return res;
	}
}

/**
 * Dimensional constraint: distance between two points equals value
 */
export class DistanceConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	targetDistance: number;
	offset?: number;
	orientation: 'aligned' | 'horizontal' | 'vertical';

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		targetDistance: number,
		weight = 1.0,
		offset?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
	) {
		const prefix =
			orientation === 'horizontal'
				? 'Horizontal Distance'
				: orientation === 'vertical'
				? 'Vertical Distance'
				: 'Distance';
		super(
			id,
			'distance',
			prefix,
			[p1Id, p2Id],
			weight,
			false,
			true,
			targetDistance
		);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.targetDistance = targetDistance;
		this.offset = offset;
		this.orientation = orientation;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		if (this.orientation === 'horizontal') {
			const dx = p2x - p1x;
			const sign = dx >= 0 ? 1 : -1;
			return [(dx * sign - this.targetDistance) * this.weight];
		}

		if (this.orientation === 'vertical') {
			const dy = p2y - p1y;
			const sign = dy >= 0 ? 1 : -1;
			return [(dy * sign - this.targetDistance) * this.weight];
		}

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const cur = Math.hypot(dx, dy);

		return [(cur - this.targetDistance) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		if (this.orientation === 'horizontal') {
			const dx = p2x - p1x;
			const sign = dx >= 0 ? 1 : -1;
			this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, sign * this.weight);
			return res;
		}

		if (this.orientation === 'vertical') {
			const dy = p2y - p1y;
			const sign = dy >= 0 ? 1 : -1;
			this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -sign * this.weight);
			this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, sign * this.weight);
			return res;
		}

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const cur = Math.max(Math.hypot(dx, dy), 1e-7);

		const dP2x = (dx / cur) * this.weight;
		const dP2y = (dy / cur) * this.weight;

		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -dP2x);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow, -dP2y);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, dP2x);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow, dP2y);

		return res;
	}
}

/**
 * Dimensional constraint: distance from a point to a line segment (infinite line extension) equals value
 */
export class PointToLineDistanceConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	targetDistance: number;
	side: number;
	offset?: number;

	constructor(
		id: string,
		pointId: string,
		lineId: string,
		lineP1Id: string,
		lineP2Id: string,
		targetDistance: number,
		side = 1,
		weight = 1.0,
		offset?: number
	) {
		super(
			id,
			'point_to_line_distance',
			'Point-to-Line Distance',
			[pointId, lineP1Id, lineP2Id],
			weight,
			false,
			true,
			targetDistance
		);
		this.pointId = pointId;
		this.lineId = lineId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.targetDistance = targetDistance;
		this.side = side >= 0 ? 1 : -1;
		this.offset = offset;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Signed perpendicular distance from point to line (p1->p2)
		const cross = (px - p1x) * dy - (py - p1y) * dx;
		const h = cross / lineLen;

		return [(h - this.side * this.targetDistance) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Dimensional constraint: circle radius equals value
 */
export class RadiusConstraint extends BaseConstraint {
	readonly circleId: string;
	targetRadius: number;
	leaderAngle?: number;
	displayMode: 'radius' | 'diameter';

	constructor(
		id: string,
		circleId: string,
		targetRadius: number,
		weight = 1.0,
		leaderAngle?: number,
		displayMode: 'radius' | 'diameter' = 'radius'
	) {
		const valStr = displayMode === 'diameter'
			? Number((targetRadius * 2).toFixed(2))
			: Number(targetRadius.toFixed(2));
		const label = displayMode === 'diameter'
			? `Diameter (${valStr})`
			: `Radius (${valStr})`;
		super(id, 'radius', label, [circleId], weight, false, true, targetRadius);
		this.circleId = circleId;
		this.targetRadius = targetRadius;
		this.leaderAngle = leaderAngle;
		this.displayMode = displayMode;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const r = paramMap.get(`${this.circleId}.r`) ?? this.targetRadius;
		return [(r - this.targetRadius) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, this.weight);
		return res;
	}
}

/**
 * Constrains two line segments to have equal length
 */
export class EqualLengthConstraint extends BaseConstraint {
	readonly line1P1: string;
	readonly line1P2: string;
	readonly line2P1: string;
	readonly line2P2: string;

	constructor(
		id: string,
		line1P1: string,
		line1P2: string,
		line2P1: string,
		line2P2: string,
		weight = 1.0
	) {
		super(id, 'equal_length', 'Equal Length', [line1P1, line1P2, line2P1, line2P2], weight);
		this.line1P1 = line1P1;
		this.line1P2 = line1P2;
		this.line2P1 = line2P1;
		this.line2P2 = line2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const l1 = Math.hypot(
			(paramMap.get(`${this.line1P2}.x`) ?? 0) - (paramMap.get(`${this.line1P1}.x`) ?? 0),
			(paramMap.get(`${this.line1P2}.y`) ?? 0) - (paramMap.get(`${this.line1P1}.y`) ?? 0)
		);
		const l2 = Math.hypot(
			(paramMap.get(`${this.line2P2}.x`) ?? 0) - (paramMap.get(`${this.line2P1}.x`) ?? 0),
			(paramMap.get(`${this.line2P2}.y`) ?? 0) - (paramMap.get(`${this.line2P1}.y`) ?? 0)
		);
		return [(l1 - l2) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];

		const dx1 = (paramMap.get(`${this.line1P2}.x`) ?? 0) - (paramMap.get(`${this.line1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.line1P2}.y`) ?? 0) - (paramMap.get(`${this.line1P1}.y`) ?? 0);
		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);

		const dx2 = (paramMap.get(`${this.line2P2}.x`) ?? 0) - (paramMap.get(`${this.line2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.line2P2}.y`) ?? 0) - (paramMap.get(`${this.line2P1}.y`) ?? 0);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);

		// d(l1)/dx
		this.addJacobianEntry(res, paramIndices, `${this.line1P1}.x`, baseRow, (-dx1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P1}.y`, baseRow, (-dy1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P2}.x`, baseRow, (dx1 / l1) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line1P2}.y`, baseRow, (dy1 / l1) * this.weight);

		// -d(l2)/dx
		this.addJacobianEntry(res, paramIndices, `${this.line2P1}.x`, baseRow, (dx2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P1}.y`, baseRow, (dy2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P2}.x`, baseRow, (-dx2 / l2) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.line2P2}.y`, baseRow, (-dy2 / l2) * this.weight);

		return res;
	}
}

/**
 * Constrains two circles to have equal radius
 */
export class EqualRadiusConstraint extends BaseConstraint {
	readonly circle1Id: string;
	readonly circle2Id: string;

	constructor(id: string, circle1Id: string, circle2Id: string, weight = 1.0) {
		super(id, 'equal_radius', 'Equal Radius', [circle1Id, circle2Id], weight);
		this.circle1Id = circle1Id;
		this.circle2Id = circle2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 0;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 0;
		return [(r1 - r2) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.circle1Id}.r`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.circle2Id}.r`, baseRow, -this.weight);
		return res;
	}
}

/**
 * Constrains two lines to be parallel (cross product of unit vectors = 0)
 */
export class ParallelConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'parallel', 'Parallel', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const dx1 = (paramMap.get(`${this.l1P2}.x`) ?? 0) - (paramMap.get(`${this.l1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.l1P2}.y`) ?? 0) - (paramMap.get(`${this.l1P1}.y`) ?? 0);
		const dx2 = (paramMap.get(`${this.l2P2}.x`) ?? 0) - (paramMap.get(`${this.l2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.l2P2}.y`) ?? 0) - (paramMap.get(`${this.l2P1}.y`) ?? 0);

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Cross product normalized to dimensional scale
		const cross = (dx1 * dy2 - dy1 * dx2) / (l1 * l2);
		return [cross * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Constrains two lines to be collinear (parallel and lying on the same line)
 */
export class CollinearConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'collinear', 'Collinear', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p11x = paramMap.get(`${this.l1P1}.x`) ?? 0;
		const p11y = paramMap.get(`${this.l1P1}.y`) ?? 0;
		const p12x = paramMap.get(`${this.l1P2}.x`) ?? 0;
		const p12y = paramMap.get(`${this.l1P2}.y`) ?? 0;

		const p21x = paramMap.get(`${this.l2P1}.x`) ?? 0;
		const p21y = paramMap.get(`${this.l2P1}.y`) ?? 0;
		const p22x = paramMap.get(`${this.l2P2}.x`) ?? 0;
		const p22y = paramMap.get(`${this.l2P2}.y`) ?? 0;

		const dx1 = p12x - p11x;
		const dy1 = p12y - p11y;
		const dx2 = p22x - p21x;
		const dy2 = p22y - p21y;

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		// Equation 0: Direction parallel (cross product of unit vectors)
		const cross = (dx1 * dy2 - dy1 * dx2) / (l1 * l2);
		const eq0 = cross * avgL * this.weight;

		// Equation 1: Perpendicular distance from midpoint of line 2 to infinite line 1
		const mid2x = (p21x + p22x) * 0.5;
		const mid2y = (p21y + p22y) * 0.5;
		const ptCross = (mid2x - p11x) * dy1 - (mid2y - p11y) * dx1;
		const eq1 = (ptCross / l1) * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}
}

/**
 * Constrains two points to be symmetric with respect to an infinite line (lineP1 to lineP2)
 */
export class SymmetryConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly lineId?: string;

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		lineP1Id: string,
		lineP2Id: string,
		weight = 1.0,
		lineId?: string
	) {
		super(id, 'symmetry', 'Symmetry', [p1Id, p2Id, lineP1Id, lineP2Id], weight);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.lineId = lineId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		const ax = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const ay = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const bx = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const by = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = bx - ax;
		const dy = by - ay;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Equation 0: Midpoint of (P1, P2) lies on the line AB
		const mx = (p1x + p2x) * 0.5;
		const my = (p1y + p2y) * 0.5;
		const cross = (mx - ax) * dy - (my - ay) * dx;
		const eq0 = (cross / lineLen) * this.weight;

		// Equation 1: Chord vector (P2 - P1) is perpendicular to line AB
		const cx = p2x - p1x;
		const cy = p2y - p1y;
		const dot = (cx * dx + cy * dy) / lineLen;
		const eq1 = dot * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}
}

export interface PatternPointPair {
	sourcePtId: string;
	patternPtId: string;
}

export interface PatternRadiusPair {
	sourceCircleId: string;
	patternCircleId: string;
}

export interface PatternCopyData {
	copyIndex: number;
	pointPairs: PatternPointPair[];
	radiusPairs?: PatternRadiusPair[];
	createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}>;
}

export function computePatternCopyAngle(
	k: number,
	quantity: number,
	distribution: 'full' | 'partial' | 'symmetric',
	totalAngle: number
): number {
	const N = Math.max(2, Math.round(quantity));
	if (distribution === 'full') {
		return (k * 360) / N;
	} else if (distribution === 'partial') {
		const step = totalAngle / (N - 1);
		return k * step;
	} else if (distribution === 'symmetric') {
		const step = totalAngle / (N - 1);
		if (k % 2 === 1) {
			return ((k + 1) / 2) * step;
		} else {
			return -(k / 2) * step;
		}
	}
	return 0;
}

/**
 * Constrains patterned entities around a rotation center point.
 * Holds all pattern copies and point correspondences in a single constraint.
 */
export class CircularPatternConstraint extends BaseConstraint {
	readonly centerPtId: string;
	readonly sourceObjectIds: string[];
	distribution: 'full' | 'partial' | 'symmetric';
	totalAngle: number;
	quantity: number;
	suppression: boolean;
	suppressedIndices: number[];
	copies: PatternCopyData[];
	isReadOnly?: boolean;

	constructor(
		id: string,
		centerPtId: string,
		sourceObjectIds: string[],
		distribution: 'full' | 'partial' | 'symmetric',
		totalAngle: number,
		quantity: number,
		suppression: boolean,
		suppressedIndices: number[],
		copies: PatternCopyData[],
		weight = 1.0,
		isReadOnly = false
	) {
		const entityIdSet = new Set<string>();
		entityIdSet.add(centerPtId);
		for (const copy of copies) {
			for (const pair of copy.pointPairs) {
				entityIdSet.add(pair.sourcePtId);
				entityIdSet.add(pair.patternPtId);
			}
			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					entityIdSet.add(pair.sourceCircleId);
					entityIdSet.add(pair.patternCircleId);
				}
			}
		}
		super(id, 'circular_pattern', 'Circular Pattern', Array.from(entityIdSet), weight);

		this.centerPtId = centerPtId;
		this.sourceObjectIds = [...sourceObjectIds];
		this.distribution = distribution;
		this.totalAngle = totalAngle;
		this.quantity = quantity;
		this.suppression = suppression;
		this.suppressedIndices = [...suppressedIndices];
		this.copies = copies;
		this.isReadOnly = !!isReadOnly;
	}

	override getEquationsCount(): number {
		let count = 0;
		const suppressedSet = new Set(this.suppressedIndices);
		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;
			count += copy.pointPairs.length * 2;
			if (copy.radiusPairs) {
				count += copy.radiusPairs.length;
			}
		}
		return count;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const errors: number[] = [];
		const cx = paramMap.get(`${this.centerPtId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerPtId}.y`) ?? 0;
		const suppressedSet = new Set(this.suppressedIndices);

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const angleDeg = computePatternCopyAngle(
				copy.copyIndex,
				this.quantity,
				this.distribution,
				this.totalAngle
			);
			const rad = (angleDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);

			for (const pair of copy.pointPairs) {
				const sx = paramMap.get(`${pair.sourcePtId}.x`) ?? 0;
				const sy = paramMap.get(`${pair.sourcePtId}.y`) ?? 0;
				const px = paramMap.get(`${pair.patternPtId}.x`) ?? 0;
				const py = paramMap.get(`${pair.patternPtId}.y`) ?? 0;

				const dx = sx - cx;
				const dy = sy - cy;
				const targetX = cx + dx * cosA - dy * sinA;
				const targetY = cy + dx * sinA + dy * cosA;

				errors.push((px - targetX) * this.weight);
				errors.push((py - targetY) * this.weight);
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const rSource = paramMap.get(`${pair.sourceCircleId}.r`) ?? 0;
					const rPattern = paramMap.get(`${pair.patternCircleId}.r`) ?? 0;
					errors.push((rPattern - rSource) * this.weight);
				}
			}
		}

		return errors;
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const entries: JacobianEntry[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		let eqIdx = 0;

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const angleDeg = computePatternCopyAngle(
				copy.copyIndex,
				this.quantity,
				this.distribution,
				this.totalAngle
			);
			const rad = (angleDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);

			for (const pair of copy.pointPairs) {
				const rowX = baseRow + eqIdx;
				const rowY = baseRow + eqIdx + 1;
				eqIdx += 2;

				const colPx = paramIndices.get(`${pair.patternPtId}.x`);
				const colPy = paramIndices.get(`${pair.patternPtId}.y`);
				const colSx = paramIndices.get(`${pair.sourcePtId}.x`);
				const colSy = paramIndices.get(`${pair.sourcePtId}.y`);
				const colCx = paramIndices.get(`${this.centerPtId}.x`);
				const colCy = paramIndices.get(`${this.centerPtId}.y`);

				// Row X: px - targetX = px - [cx(1 - cosA) + cy*sinA + sx*cosA - sy*sinA]
				if (colPx !== undefined) entries.push({ row: rowX, col: colPx, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowX, col: colSx, val: -cosA * this.weight });
				if (colSy !== undefined) entries.push({ row: rowX, col: colSy, val: sinA * this.weight });
				if (colCx !== undefined) entries.push({ row: rowX, col: colCx, val: -(1 - cosA) * this.weight });
				if (colCy !== undefined) entries.push({ row: rowX, col: colCy, val: -sinA * this.weight });

				// Row Y: py - targetY = py - [-cx*sinA + cy(1 - cosA) + sx*sinA + sy*cosA]
				if (colPy !== undefined) entries.push({ row: rowY, col: colPy, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowY, col: colSx, val: -sinA * this.weight });
				if (colSy !== undefined) entries.push({ row: rowY, col: colSy, val: -cosA * this.weight });
				if (colCx !== undefined) entries.push({ row: rowY, col: colCx, val: sinA * this.weight });
				if (colCy !== undefined) entries.push({ row: rowY, col: colCy, val: -(1 - cosA) * this.weight });
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const row = baseRow + eqIdx;
					eqIdx += 1;
					this.addJacobianEntry(entries, paramIndices, `${pair.patternCircleId}.r`, row, this.weight);
					this.addJacobianEntry(entries, paramIndices, `${pair.sourceCircleId}.r`, row, -this.weight);
				}
			}
		}

		return entries;
	}
}

export interface RectangularPatternCopyData {
	copyIndex: number;
	i: number;
	j: number;
	pointPairs: PatternPointPair[];
	radiusPairs?: PatternRadiusPair[];
	createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}>;
}

export function computeAxisOffset(
	index: number,
	distance: number,
	direction: 'one_direction' | 'symmetric'
): number {
	if (index === 0) return 0;
	if (direction === 'one_direction') {
		return index * distance;
	} else {
		if (index % 2 === 1) {
			return Math.ceil(index / 2) * distance;
		} else {
			return -(index / 2) * distance;
		}
	}
}

export function computeRectangularPatternOffset(
	i: number,
	j: number,
	distance1: number,
	direction1: 'one_direction' | 'symmetric',
	distance2: number,
	direction2: 'one_direction' | 'symmetric',
	u1: { x: number; y: number },
	u2: { x: number; y: number }
): { dx: number; dy: number } {
	const o1 = computeAxisOffset(i, distance1, direction1);
	const o2 = computeAxisOffset(j, distance2, direction2);
	return {
		dx: o1 * u1.x + o2 * u2.x,
		dy: o1 * u1.y + o2 * u2.y,
	};
}

export function computeRectangularPatternDirections(
	paramMap: Map<string, number>,
	line1?: { p1Id: string; p2Id: string } | null,
	line2?: { p1Id: string; p2Id: string } | null
): { u1: { x: number; y: number }; u2: { x: number; y: number } } {
	let u1 = { x: 1, y: 0 };
	if (line1) {
		const x1a = paramMap.get(`${line1.p1Id}.x`) ?? 0;
		const y1a = paramMap.get(`${line1.p1Id}.y`) ?? 0;
		const x1b = paramMap.get(`${line1.p2Id}.x`) ?? 0;
		const y1b = paramMap.get(`${line1.p2Id}.y`) ?? 0;
		const dx1 = x1b - x1a;
		const dy1 = y1b - y1a;
		const len1 = Math.hypot(dx1, dy1);
		if (len1 > 1e-6) {
			u1 = { x: dx1 / len1, y: dy1 / len1 };
		}
	}

	let u2 = { x: -u1.y, y: u1.x };
	if (line2) {
		const x2a = paramMap.get(`${line2.p1Id}.x`) ?? 0;
		const y2a = paramMap.get(`${line2.p1Id}.y`) ?? 0;
		const x2b = paramMap.get(`${line2.p2Id}.x`) ?? 0;
		const y2b = paramMap.get(`${line2.p2Id}.y`) ?? 0;
		const dx2 = x2b - x2a;
		const dy2 = y2b - y2a;
		const len2 = Math.hypot(dx2, dy2);
		if (len2 > 1e-6) {
			u2 = { x: dx2 / len2, y: dy2 / len2 };
		}
	}

	return { u1, u2 };
}

/**
 * Constrains patterned entities in a 2D linear array along 1 or 2 direction axes.
 * Holds all pattern copies and point correspondences in a single constraint.
 */
export class RectangularPatternConstraint extends BaseConstraint {
	readonly sourceObjectIds: string[];
	line1Id: string | null;
	line1P1Id?: string | null;
	line1P2Id?: string | null;
	line2Id: string | null;
	line2P1Id?: string | null;
	line2P2Id?: string | null;
	quantity1: number;
	distance1: number;
	direction1: 'one_direction' | 'symmetric';
	quantity2: number;
	distance2: number;
	direction2: 'one_direction' | 'symmetric';
	suppression: boolean;
	suppressedIndices: number[];
	copies: RectangularPatternCopyData[];

	constructor(
		id: string,
		sourceObjectIds: string[],
		line1Id: string | null,
		line1P1Id: string | null | undefined,
		line1P2Id: string | null | undefined,
		line2Id: string | null,
		line2P1Id: string | null | undefined,
		line2P2Id: string | null | undefined,
		quantity1: number,
		distance1: number,
		direction1: 'one_direction' | 'symmetric',
		quantity2: number,
		distance2: number,
		direction2: 'one_direction' | 'symmetric',
		suppression: boolean,
		suppressedIndices: number[],
		copies: RectangularPatternCopyData[],
		weight = 1.0
	) {
		const entityIdSet = new Set<string>();
		if (line1P1Id) entityIdSet.add(line1P1Id);
		if (line1P2Id) entityIdSet.add(line1P2Id);
		if (line2P1Id) entityIdSet.add(line2P1Id);
		if (line2P2Id) entityIdSet.add(line2P2Id);

		for (const copy of copies) {
			for (const pair of copy.pointPairs) {
				entityIdSet.add(pair.sourcePtId);
				entityIdSet.add(pair.patternPtId);
			}
			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					entityIdSet.add(pair.sourceCircleId);
					entityIdSet.add(pair.patternCircleId);
				}
			}
		}

		super(id, 'rectangular_pattern', 'Rectangular Pattern', Array.from(entityIdSet), weight);

		this.sourceObjectIds = [...sourceObjectIds];
		this.line1Id = line1Id;
		this.line1P1Id = line1P1Id;
		this.line1P2Id = line1P2Id;
		this.line2Id = line2Id;
		this.line2P1Id = line2P1Id;
		this.line2P2Id = line2P2Id;
		this.quantity1 = quantity1;
		this.distance1 = distance1;
		this.direction1 = direction1;
		this.quantity2 = quantity2;
		this.distance2 = distance2;
		this.direction2 = direction2;
		this.suppression = suppression;
		this.suppressedIndices = [...suppressedIndices];
		this.copies = copies;
	}

	override getEquationsCount(): number {
		let count = 0;
		const suppressedSet = new Set(this.suppressedIndices);
		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;
			count += copy.pointPairs.length * 2;
			if (copy.radiusPairs) {
				count += copy.radiusPairs.length;
			}
		}
		return count;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const errors: number[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const offset = computeRectangularPatternOffset(
				copy.i,
				copy.j,
				this.distance1,
				this.direction1,
				this.distance2,
				this.direction2,
				u1,
				u2
			);

			for (const pair of copy.pointPairs) {
				const sx = paramMap.get(`${pair.sourcePtId}.x`) ?? 0;
				const sy = paramMap.get(`${pair.sourcePtId}.y`) ?? 0;
				const px = paramMap.get(`${pair.patternPtId}.x`) ?? 0;
				const py = paramMap.get(`${pair.patternPtId}.y`) ?? 0;

				const targetX = sx + offset.dx;
				const targetY = sy + offset.dy;

				errors.push((px - targetX) * this.weight);
				errors.push((py - targetY) * this.weight);
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const rSource = paramMap.get(`${pair.sourceCircleId}.r`) ?? 0;
					const rPattern = paramMap.get(`${pair.patternCircleId}.r`) ?? 0;
					errors.push((rPattern - rSource) * this.weight);
				}
			}
		}

		return errors;
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const entries: JacobianEntry[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);

		let du1_dx1b = 0, du1_dy1b = 0, du1_dx1b_y = 0, du1_dy1b_y = 0;
		let hasL1 = false;
		if (line1) {
			const x1a = paramMap.get(`${line1.p1Id}.x`) ?? 0;
			const y1a = paramMap.get(`${line1.p1Id}.y`) ?? 0;
			const x1b = paramMap.get(`${line1.p2Id}.x`) ?? 0;
			const y1b = paramMap.get(`${line1.p2Id}.y`) ?? 0;
			const dx1 = x1b - x1a;
			const dy1 = y1b - y1a;
			const L1 = Math.hypot(dx1, dy1);
			if (L1 > 1e-6) {
				hasL1 = true;
				const invL = 1 / L1;
				du1_dx1b = (1 - u1.x * u1.x) * invL;
				du1_dy1b = (-u1.x * u1.y) * invL;
				du1_dx1b_y = (-u1.x * u1.y) * invL;
				du1_dy1b_y = (1 - u1.y * u1.y) * invL;
			}
		}

		let du2_dx2b = 0, du2_dy2b = 0, du2_dx2b_y = 0, du2_dy2b_y = 0;
		let hasL2 = false;
		if (line2) {
			const x2a = paramMap.get(`${line2.p1Id}.x`) ?? 0;
			const y2a = paramMap.get(`${line2.p1Id}.y`) ?? 0;
			const x2b = paramMap.get(`${line2.p2Id}.x`) ?? 0;
			const y2b = paramMap.get(`${line2.p2Id}.y`) ?? 0;
			const dx2 = x2b - x2a;
			const dy2 = y2b - y2a;
			const L2 = Math.hypot(dx2, dy2);
			if (L2 > 1e-6) {
				hasL2 = true;
				const invL = 1 / L2;
				du2_dx2b = (1 - u2.x * u2.x) * invL;
				du2_dy2b = (-u2.x * u2.y) * invL;
				du2_dx2b_y = (-u2.x * u2.y) * invL;
				du2_dy2b_y = (1 - u2.y * u2.y) * invL;
			}
		}

		let eqIdx = 0;

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const o1 = computeAxisOffset(copy.i, this.distance1, this.direction1);
			const o2 = computeAxisOffset(copy.j, this.distance2, this.direction2);

			for (const pair of copy.pointPairs) {
				const rowX = baseRow + eqIdx;
				const rowY = baseRow + eqIdx + 1;
				eqIdx += 2;

				const colPx = paramIndices.get(`${pair.patternPtId}.x`);
				const colPy = paramIndices.get(`${pair.patternPtId}.y`);
				const colSx = paramIndices.get(`${pair.sourcePtId}.x`);
				const colSy = paramIndices.get(`${pair.sourcePtId}.y`);

				if (colPx !== undefined) entries.push({ row: rowX, col: colPx, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowX, col: colSx, val: -this.weight });
				if (colPy !== undefined) entries.push({ row: rowY, col: colPy, val: this.weight });
				if (colSy !== undefined) entries.push({ row: rowY, col: colSy, val: -this.weight });

				if (hasL1 && line1) {
					const dDeltaX_dx1b = o1 * du1_dx1b + (!hasL2 ? o2 * (-du1_dx1b_y) : 0);
					const dDeltaX_dy1b = o1 * du1_dy1b + (!hasL2 ? o2 * (-du1_dy1b_y) : 0);
					const dDeltaY_dx1b = o1 * du1_dx1b_y + (!hasL2 ? o2 * du1_dx1b : 0);
					const dDeltaY_dy1b = o1 * du1_dy1b_y + (!hasL2 ? o2 * du1_dy1b : 0);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowX, -dDeltaX_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowX, -dDeltaX_dy1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowX, dDeltaX_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowX, dDeltaX_dy1b * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowY, -dDeltaY_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowY, -dDeltaY_dy1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowY, dDeltaY_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowY, dDeltaY_dy1b * this.weight);
				}

				if (hasL2 && line2) {
					const dDeltaX_dx2b = o2 * du2_dx2b;
					const dDeltaX_dy2b = o2 * du2_dy2b;
					const dDeltaY_dx2b = o2 * du2_dx2b_y;
					const dDeltaY_dy2b = o2 * du2_dy2b_y;

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowX, -dDeltaX_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowX, -dDeltaX_dy2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowX, dDeltaX_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowX, dDeltaX_dy2b * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowY, -dDeltaY_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowY, -dDeltaY_dy2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowY, dDeltaY_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowY, dDeltaY_dy2b * this.weight);
				}
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const row = baseRow + eqIdx;
					eqIdx += 1;
					this.addJacobianEntry(entries, paramIndices, `${pair.patternCircleId}.r`, row, this.weight);
					this.addJacobianEntry(entries, paramIndices, `${pair.sourceCircleId}.r`, row, -this.weight);
				}
			}
		}

		return entries;
	}
}

/**
 * Constrains two lines to be perpendicular (dot product of unit vectors = 0)
 */
export class PerpendicularConstraint extends BaseConstraint {
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;

	constructor(id: string, l1P1: string, l1P2: string, l2P1: string, l2P2: string, weight = 1.0) {
		super(id, 'perpendicular', 'Perpendicular', [l1P1, l1P2, l2P1, l2P2], weight);
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const dx1 = (paramMap.get(`${this.l1P2}.x`) ?? 0) - (paramMap.get(`${this.l1P1}.x`) ?? 0);
		const dy1 = (paramMap.get(`${this.l1P2}.y`) ?? 0) - (paramMap.get(`${this.l1P1}.y`) ?? 0);
		const dx2 = (paramMap.get(`${this.l2P2}.x`) ?? 0) - (paramMap.get(`${this.l2P1}.x`) ?? 0);
		const dy2 = (paramMap.get(`${this.l2P2}.y`) ?? 0) - (paramMap.get(`${this.l2P1}.y`) ?? 0);

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const dotProd = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
		return [dotProd * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Dimensional constraint: angle between two lines equals targetAngle (in degrees)
 */
export class AngleConstraint extends BaseConstraint {
	readonly line1Id: string;
	readonly line2Id: string;
	readonly l1P1: string;
	readonly l1P2: string;
	readonly l2P1: string;
	readonly l2P2: string;
	targetAngle: number; // in degrees
	arcRadius?: number; // visual radius in world units
	s1: number; // orientation factor for line 1 (+1 or -1)
	s2: number; // orientation factor for line 2 (+1 or -1)
	sign: number; // cross direction factor (+1 or -1)

	constructor(
		id: string,
		line1Id: string,
		line2Id: string,
		l1P1: string,
		l1P2: string,
		l2P1: string,
		l2P2: string,
		targetAngle: number,
		arcRadius = 40,
		s1 = 1,
		s2 = 1,
		sign = 1,
		weight = 1.0
	) {
		super(
			id,
			'angle',
			'Angle',
			[line1Id, line2Id, l1P1, l1P2, l2P1, l2P2],
			weight,
			false,
			true,
			targetAngle
		);
		this.line1Id = line1Id;
		this.line2Id = line2Id;
		this.l1P1 = l1P1;
		this.l1P2 = l1P2;
		this.l2P1 = l2P1;
		this.l2P2 = l2P2;
		this.targetAngle = targetAngle;
		this.arcRadius = arcRadius;
		this.s1 = s1;
		this.s2 = s2;
		this.sign = sign;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1x = paramMap.get(`${this.l1P1}.x`) ?? 0;
		const p1y = paramMap.get(`${this.l1P1}.y`) ?? 0;
		const p2x = paramMap.get(`${this.l1P2}.x`) ?? 0;
		const p2y = paramMap.get(`${this.l1P2}.y`) ?? 0;
		const p3x = paramMap.get(`${this.l2P1}.x`) ?? 0;
		const p3y = paramMap.get(`${this.l2P1}.y`) ?? 0;
		const p4x = paramMap.get(`${this.l2P2}.x`) ?? 0;
		const p4y = paramMap.get(`${this.l2P2}.y`) ?? 0;

		const dx1 = (p2x - p1x) * this.s1;
		const dy1 = (p2y - p1y) * this.s1;
		const dx2 = (p4x - p3x) * this.s2;
		const dy2 = (p4y - p3y) * this.s2;

		const l1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const l2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgL = (l1 + l2) * 0.5;

		const u1x = dx1 / l1;
		const u1y = dy1 / l1;
		const u2x = dx2 / l2;
		const u2y = dy2 / l2;

		const targetRad = (this.targetAngle * Math.PI) / 180;
		const rotAngle = this.sign * targetRad;
		const cosA = Math.cos(rotAngle);
		const sinA = Math.sin(rotAngle);

		// Rotate u1 by rotAngle
		const rx = u1x * cosA - u1y * sinA;
		const ry = u1x * sinA + u1y * cosA;

		// Cross product between rotated u1 and u2
		const cross = rx * u2y - ry * u2x;
		return [cross * avgL * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Constrains a point to lie on the infinite line passing through lineP1 and lineP2
 */
export class PointOnLineConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;

	constructor(id: string, pointId: string, lineP1Id: string, lineP2Id: string, weight = 1.0) {
		super(id, 'point_on_line', 'Point on Line', [pointId, lineP1Id, lineP2Id], weight);
		this.pointId = pointId;
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Perpendicular distance from point to line
		const cross = (px - p1x) * dy - (py - p1y) * dx;
		return [(cross / lineLen) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Constrains a point to lie on the circumference of a circle or arc
 */
export class PointOnCircleConstraint extends BaseConstraint {
	readonly pointId: string;
	readonly circleCenterId: string;
	readonly circleId: string;

	constructor(
		id: string,
		pointId: string,
		circleCenterId: string,
		circleId: string,
		weight = 1.0
	) {
		super(id, 'point_on_circle', 'Point on Circle', [pointId, circleCenterId, circleId], weight);
		this.pointId = pointId;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const dx = px - cx;
		const dy = py - cy;
		const cur = Math.hypot(dx, dy);

		return [(cur - r) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const px = paramMap.get(`${this.pointId}.x`) ?? 0;
		const py = paramMap.get(`${this.pointId}.y`) ?? 0;
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;

		const dx = px - cx;
		const dy = py - cy;
		const cur = Math.max(Math.hypot(dx, dy), 1e-7);

		const dPx = (dx / cur) * this.weight;
		const dPy = (dy / cur) * this.weight;

		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, dPx);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow, dPy);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.x`, baseRow, -dPx);
		this.addJacobianEntry(res, paramIndices, `${this.circleCenterId}.y`, baseRow, -dPy);
		this.addJacobianEntry(res, paramIndices, `${this.circleId}.r`, baseRow, -1.0 * this.weight);

		return res;
	}
}

/**
 * Constrains a line to be tangent to a circle
 */
export class TangentLineCircleConstraint extends BaseConstraint {
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly circleCenterId: string;
	readonly circleId: string;
	readonly initialSide: number; // +1 or -1

	constructor(
		id: string,
		lineP1Id: string,
		lineP2Id: string,
		circleCenterId: string,
		circleId: string,
		initialSide = 1,
		weight = 1.0
	) {
		super(id, 'tangent_line_circle', 'Tangent', [lineP1Id, lineP2Id, circleCenterId, circleId], weight);
		this.lineP1Id = lineP1Id;
		this.lineP2Id = lineP2Id;
		this.circleCenterId = circleCenterId;
		this.circleId = circleId;
		this.initialSide = initialSide >= 0 ? 1 : -1;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.circleCenterId}.x`) ?? 0;
		const cy = paramMap.get(`${this.circleCenterId}.y`) ?? 0;
		const r = paramMap.get(`${this.circleId}.r`) ?? 10;

		const p1x = paramMap.get(`${this.lineP1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.lineP1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.lineP2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.lineP2Id}.y`) ?? 0;

		const dx = p2x - p1x;
		const dy = p2y - p1y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);

		// Signed distance from center to line
		const signedDist = ((cx - p1x) * dy - (cy - p1y) * dx) / lineLen;
		return [(signedDist - this.initialSide * r) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Constrains two circles or arcs to be tangent to each other (either externally or internally)
 */
export class TangentCircleCircleConstraint extends BaseConstraint {
	readonly circle1CenterId: string;
	readonly circle1Id: string;
	readonly circle2CenterId: string;
	readonly circle2Id: string;
	readonly isInternal: boolean;
	readonly outerCircleId: string | null;

	constructor(
		id: string,
		circle1CenterId: string,
		circle1Id: string,
		circle2CenterId: string,
		circle2Id: string,
		isInternal = false,
		outerCircleId: string | null = null,
		weight = 1.0
	) {
		super(id, 'tangent_circle_circle', 'Tangent', [circle1CenterId, circle1Id, circle2CenterId, circle2Id], weight);
		this.circle1CenterId = circle1CenterId;
		this.circle1Id = circle1Id;
		this.circle2CenterId = circle2CenterId;
		this.circle2Id = circle2Id;
		this.isInternal = isInternal;
		this.outerCircleId = outerCircleId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1x = paramMap.get(`${this.circle1CenterId}.x`) ?? 0;
		const c1y = paramMap.get(`${this.circle1CenterId}.y`) ?? 0;
		const r1 = paramMap.get(`${this.circle1Id}.r`) ?? 10;

		const c2x = paramMap.get(`${this.circle2CenterId}.x`) ?? 0;
		const c2y = paramMap.get(`${this.circle2CenterId}.y`) ?? 0;
		const r2 = paramMap.get(`${this.circle2Id}.r`) ?? 10;

		const dx = c2x - c1x;
		const dy = c2y - c1y;
		const dist = Math.max(Math.hypot(dx, dy), 1e-7);

		let targetDist: number;
		if (!this.isInternal || !this.outerCircleId) {
			targetDist = r1 + r2;
		} else if (this.outerCircleId === this.circle1Id) {
			targetDist = r1 - r2;
		} else {
			targetDist = r2 - r1;
		}

		return [(dist - targetDist) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, paramMap: Map<string, number>): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Concentric circles: centers coincide
 */
export class ConcentricConstraint extends BaseConstraint {
	readonly c1CenterId: string;
	readonly c2CenterId: string;

	constructor(id: string, c1CenterId: string, c2CenterId: string, weight = 1.0) {
		super(id, 'concentric', 'Concentric', [c1CenterId, c2CenterId], weight);
		this.c1CenterId = c1CenterId;
		this.c2CenterId = c2CenterId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const c1x = paramMap.get(`${this.c1CenterId}.x`) ?? 0;
		const c1y = paramMap.get(`${this.c1CenterId}.y`) ?? 0;
		const c2x = paramMap.get(`${this.c2CenterId}.x`) ?? 0;
		const c2y = paramMap.get(`${this.c2CenterId}.y`) ?? 0;

		return [(c1x - c2x) * this.weight, (c1y - c2y) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.x`, baseRow, -this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.c1CenterId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.c2CenterId}.y`, baseRow + 1, -this.weight);
		return res;
	}
}

/**
 * Midpoint constraint: midpoint equals 0.5 * (p1 + p2)
 */
export class MidpointConstraint extends BaseConstraint {
	readonly midId: string;
	readonly p1Id: string;
	readonly p2Id: string;
	readonly ratio: number;

	constructor(id: string, midId: string, p1Id: string, p2Id: string, weight = 1.0, ratio = 0.5) {
		super(id, 'midpoint', 'Midpoint', [midId, p1Id, p2Id], weight);
		this.midId = midId;
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.ratio = ratio;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const mx = paramMap.get(`${this.midId}.x`) ?? 0;
		const my = paramMap.get(`${this.midId}.y`) ?? 0;
		const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
		const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
		const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
		const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

		const alpha = this.ratio;
		return [
			(mx - ((1 - alpha) * p1x + alpha * p2x)) * this.weight,
			(my - ((1 - alpha) * p1y + alpha * p2y)) * this.weight,
		];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const alpha = this.ratio;
		this.addJacobianEntry(res, paramIndices, `${this.midId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -alpha * this.weight);

		this.addJacobianEntry(res, paramIndices, `${this.midId}.y`, baseRow + 1, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, -(1 - alpha) * this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -alpha * this.weight);
		return res;
	}
}

/**
 * Soft spring constraint for interactive real-time mouse dragging
 */
export class DragPointConstraint extends BaseConstraint {
	readonly pointId: string;
	targetX: number;
	targetY: number;

	constructor(pointId: string, targetX: number, targetY: number, softWeight = 0.05) {
		super(`drag_${pointId}`, 'drag_point', 'Drag', [pointId], softWeight, true, false);
		this.pointId = pointId;
		this.targetX = targetX;
		this.targetY = targetY;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const px = paramMap.get(`${this.pointId}.x`) ?? this.targetX;
		const py = paramMap.get(`${this.pointId}.y`) ?? this.targetY;
		return [(px - this.targetX) * this.weight, (py - this.targetY) * this.weight];
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.x`, baseRow, this.weight);
		this.addJacobianEntry(res, paramIndices, `${this.pointId}.y`, baseRow + 1, this.weight);
		return res;
	}
}

/**
 * Helper to compute high-precision numerical derivative for complex geometrical constraints
 */
function computeNumericJacobianForEquation(
	constraint: IConstraint,
	paramIndices: Map<string, number>,
	baseRow: number,
	eqIndex: number,
	paramMap: Map<string, number>
): JacobianEntry[] {
	const res: JacobianEntry[] = [];
	const eps = 1e-5;
	const f0 = constraint.evaluate(paramMap)[eqIndex];

	for (const [paramId, col] of paramIndices.entries()) {
		const orig = paramMap.get(paramId);
		if (orig === undefined) continue;

		// Check if this param is actually relevant to this constraint
		let isRelevant = false;
		for (const ent of constraint.entityIds) {
			if (paramId.startsWith(`${ent}.`)) {
				isRelevant = true;
				break;
			}
		}
		if (!isRelevant) continue;

		paramMap.set(paramId, orig + eps);
		const fPlus = constraint.evaluate(paramMap)[eqIndex];
		paramMap.set(paramId, orig);

		const deriv = (fPlus - f0) / eps;
		if (Math.abs(deriv) > 1e-11) {
			res.push({ row: baseRow + eqIndex, col, val: deriv });
		}
	}

	return res;
}

/**
 * Structural constraint ensuring arc start and end points remain at distance r from center
 */
export class ArcEndpointsConstraint extends BaseConstraint {
	readonly arcId: string;
	readonly centerId: string;
	readonly startPointId: string;
	readonly endPointId: string;

	constructor(
		id: string,
		arcId: string,
		centerId: string,
		startPointId: string,
		endPointId: string,
		weight = 1.0
	) {
		super(
			id,
			'arc_endpoints',
			'Arc Endpoints',
			[arcId, centerId, startPointId, endPointId],
			weight,
			false,
			false
		);
		this.arcId = arcId;
		this.centerId = centerId;
		this.startPointId = startPointId;
		this.endPointId = endPointId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;
		const r = paramMap.get(`${this.arcId}.r`) ?? 10;

		const ds = Math.hypot(sx - cx, sy - cy);
		const de = Math.hypot(ex - cx, ey - cy);

		return [(ds - r) * this.weight, (de - r) * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;

		const ds = Math.max(Math.hypot(sx - cx, sy - cy), 1e-7);
		const de = Math.max(Math.hypot(ex - cx, ey - cy), 1e-7);

		// Row 0: dist(C, S) - r = 0
		const dS_x = ((sx - cx) / ds) * this.weight;
		const dS_y = ((sy - cy) / ds) * this.weight;
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.x`, baseRow, dS_x);
		this.addJacobianEntry(res, paramIndices, `${this.startPointId}.y`, baseRow, dS_y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow, -dS_x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow, -dS_y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow, -1.0 * this.weight);

		// Row 1: dist(C, E) - r = 0
		const dE_x = ((ex - cx) / de) * this.weight;
		const dE_y = ((ey - cy) / de) * this.weight;
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.x`, baseRow + 1, dE_x);
		this.addJacobianEntry(res, paramIndices, `${this.endPointId}.y`, baseRow + 1, dE_y);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.x`, baseRow + 1, -dE_x);
		this.addJacobianEntry(res, paramIndices, `${this.centerId}.y`, baseRow + 1, -dE_y);
		this.addJacobianEntry(res, paramIndices, `${this.arcId}.r`, baseRow + 1, -1.0 * this.weight);

		return res;
	}
}

/**
 * Constrains the major axis and minor axis of an ellipse / elliptical arc to be perpendicular
 */
export class EllipseAxisConstraint extends BaseConstraint {
	readonly ellipseId: string;
	readonly centerId: string;
	readonly majorAxisPointId: string;
	readonly minorAxisPointId: string;

	constructor(
		id: string,
		ellipseId: string,
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		weight = 1.0
	) {
		super(id, 'ellipse_axis', 'Ellipse Axis Perpendicularity', [centerId, majorAxisPointId, minorAxisPointId], weight);
		this.ellipseId = ellipseId;
		this.centerId = centerId;
		this.majorAxisPointId = majorAxisPointId;
		this.minorAxisPointId = minorAxisPointId;
	}

	override getEquationsCount(): number {
		return 1;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const x1 = paramMap.get(`${this.majorAxisPointId}.x`) ?? 0;
		const y1 = paramMap.get(`${this.majorAxisPointId}.y`) ?? 0;
		const x2 = paramMap.get(`${this.minorAxisPointId}.x`) ?? 0;
		const y2 = paramMap.get(`${this.minorAxisPointId}.y`) ?? 0;

		const dx1 = x1 - cx;
		const dy1 = y1 - cy;
		const dx2 = x2 - cx;
		const dy2 = y2 - cy;

		const r1 = Math.max(Math.hypot(dx1, dy1), 1e-7);
		const r2 = Math.max(Math.hypot(dx2, dy2), 1e-7);
		const avgR = (r1 + r2) * 0.5;

		const dot = (dx1 * dx2 + dy1 * dy2) / (r1 * r2);
		return [dot * avgR * this.weight];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		return computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
	}
}

/**
 * Constrains endpoints of an elliptical arc to lie on the ellipse defined by center, major axis, and minor axis
 */
export class EllipticalArcEndpointsConstraint extends BaseConstraint {
	readonly arcId: string;
	readonly centerId: string;
	readonly majorAxisPointId: string;
	readonly minorAxisPointId: string;
	readonly startPointId: string;
	readonly endPointId: string;

	constructor(
		id: string,
		arcId: string,
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		startPointId: string,
		endPointId: string,
		weight = 1.0
	) {
		super(
			id,
			'elliptical_arc_endpoints',
			'Elliptical Arc Endpoints',
			[centerId, majorAxisPointId, minorAxisPointId, startPointId, endPointId],
			weight
		);
		this.arcId = arcId;
		this.centerId = centerId;
		this.majorAxisPointId = majorAxisPointId;
		this.minorAxisPointId = minorAxisPointId;
		this.startPointId = startPointId;
		this.endPointId = endPointId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const cx = paramMap.get(`${this.centerId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerId}.y`) ?? 0;
		const x1 = paramMap.get(`${this.majorAxisPointId}.x`) ?? 0;
		const y1 = paramMap.get(`${this.majorAxisPointId}.y`) ?? 0;
		const x2 = paramMap.get(`${this.minorAxisPointId}.x`) ?? 0;
		const y2 = paramMap.get(`${this.minorAxisPointId}.y`) ?? 0;
		const sx = paramMap.get(`${this.startPointId}.x`) ?? 0;
		const sy = paramMap.get(`${this.startPointId}.y`) ?? 0;
		const ex = paramMap.get(`${this.endPointId}.x`) ?? 0;
		const ey = paramMap.get(`${this.endPointId}.y`) ?? 0;

		const uX = x1 - cx;
		const uY = y1 - cy;
		const vX = x2 - cx;
		const vY = y2 - cy;

		const rx = Math.max(Math.hypot(uX, uY), 1e-7);
		const ry = Math.max(Math.hypot(vX, vY), 1e-7);
		const avgR = (rx + ry) * 0.5;

		// Unit axis vectors
		const uHatX = uX / rx;
		const uHatY = uY / rx;
		const vHatX = vX / ry;
		const vHatY = vY / ry;

		// Start point local coords
		const dsX = sx - cx;
		const dsY = sy - cy;
		const uS = dsX * uHatX + dsY * uHatY;
		const vS = dsX * vHatX + dsY * vHatY;
		const resS = ((uS * uS) / (rx * rx) + (vS * vS) / (ry * ry) - 1.0) * avgR * this.weight;

		// End point local coords
		const deX = ex - cx;
		const deY = ey - cy;
		const uE = deX * uHatX + deY * uHatY;
		const vE = deX * vHatX + deY * vHatY;
		const resE = ((uE * uE) / (rx * rx) + (vE * vE) / (ry * ry) - 1.0) * avgR * this.weight;

		return [resS, resE];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}
}


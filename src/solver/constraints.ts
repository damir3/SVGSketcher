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

  constructor(id: string, p1Id: string, p2Id: string, targetDistance: number, weight = 1.0, offset?: number) {
    super(id, 'distance', `Distance (${Number(targetDistance.toFixed(2))})`, [p1Id, p2Id], weight, false, true, targetDistance);
    this.p1Id = p1Id;
    this.p2Id = p2Id;
    this.targetDistance = targetDistance;
    this.offset = offset;
  }

  override getEquationsCount(): number {
    return 1;
  }

  override evaluate(paramMap: Map<string, number>): number[] {
    const p1x = paramMap.get(`${this.p1Id}.x`) ?? 0;
    const p1y = paramMap.get(`${this.p1Id}.y`) ?? 0;
    const p2x = paramMap.get(`${this.p2Id}.x`) ?? 0;
    const p2y = paramMap.get(`${this.p2Id}.y`) ?? 0;

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
      `Angle (${targetAngle.toFixed(1)}°)`,
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

  constructor(id: string, midId: string, p1Id: string, p2Id: string, weight = 1.0) {
    super(id, 'midpoint', 'Midpoint', [midId, p1Id, p2Id], weight);
    this.midId = midId;
    this.p1Id = p1Id;
    this.p2Id = p2Id;
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

    return [
      (mx - 0.5 * (p1x + p2x)) * this.weight,
      (my - 0.5 * (p1y + p2y)) * this.weight,
    ];
  }

  override jacobian(paramIndices: Map<string, number>, baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
    const res: JacobianEntry[] = [];
    this.addJacobianEntry(res, paramIndices, `${this.midId}.x`, baseRow, this.weight);
    this.addJacobianEntry(res, paramIndices, `${this.p1Id}.x`, baseRow, -0.5 * this.weight);
    this.addJacobianEntry(res, paramIndices, `${this.p2Id}.x`, baseRow, -0.5 * this.weight);

    this.addJacobianEntry(res, paramIndices, `${this.midId}.y`, baseRow + 1, this.weight);
    this.addJacobianEntry(res, paramIndices, `${this.p1Id}.y`, baseRow + 1, -0.5 * this.weight);
    this.addJacobianEntry(res, paramIndices, `${this.p2Id}.y`, baseRow + 1, -0.5 * this.weight);
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
      if (paramId.startsWith(ent)) {
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
    const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow + 1, 1, paramMap);
    return [...j0, ...j1];
  }
}


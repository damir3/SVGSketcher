import { ParamManager, NumericalSolver } from '../solver/solver';
import type { IConstraint, SolverResult } from '../solver/types';
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
  DragPointConstraint,
  AngleConstraint,
  ArcEndpointsConstraint,
  EllipseAxisConstraint,
  EllipticalArcEndpointsConstraint,
} from '../solver/constraints';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc, SelectionState } from './types';
import { dist } from '../math/vector';
import {
  HistoryManager,
  type SketchSnapshot,
  serializeConstraint,
  deserializeConstraint,
} from './history';

export class SketchDocument {
  points = new Map<string, SketchPoint>();
  lines = new Map<string, SketchLine>();
  circles = new Map<string, SketchCircle>();
  arcs = new Map<string, SketchArc>();
  ellipses = new Map<string, SketchEllipse>();
  ellipticalArcs = new Map<string, SketchEllipticalArc>();
  constraints = new Map<string, IConstraint>();

  selection: SelectionState = {
    pointIds: new Set(),
    lineIds: new Set(),
    circleIds: new Set(),
    arcIds: new Set(),
    ellipseIds: new Set(),
    ellipticalArcIds: new Set(),
    constraintIds: new Set(),
  };

  private idCounter = 1;
  private paramManager = new ParamManager();
  private solver = new NumericalSolver();
  lastSolverResult: SolverResult | null = null;

  // History & Transactions
  private history = new HistoryManager();
  private batchDepth = 0;
  private batchSnapshot: SketchSnapshot | null = null;

  // Listeners for UI reactivity
  private changeListeners: Array<() => void> = [];

  onChange(listener: () => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== listener);
    };
  }

  notify(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  nextId(prefix: string): string {
    return `${prefix}_${this.idCounter++}`;
  }

  // --- Transaction & History Management ---
  beginTransaction(): void {
    this.batchDepth++;
    if (this.batchDepth === 1) {
      this.batchSnapshot = this.takeSnapshot();
    }
  }

  beginTransactionWithSnapshot(snapshot: SketchSnapshot): void {
    this.batchDepth++;
    if (this.batchDepth === 1) {
      this.batchSnapshot = snapshot;
    }
  }

  commitTransaction(): void {
    if (this.batchDepth <= 0) return;
    this.batchDepth--;
    if (this.batchDepth === 0) {
      if (this.batchSnapshot) {
        this.history.pushState(this.batchSnapshot);
        this.batchSnapshot = null;
      }
      this.notify();
    }
  }

  rollbackTransaction(): void {
    if (this.batchDepth <= 0) return;
    this.batchDepth = 0;
    if (this.batchSnapshot) {
      const snap = this.batchSnapshot;
      this.batchSnapshot = null;
      this.restoreSnapshot(snap);
    }
  }

  pushHistory(): void {
    if (this.batchDepth > 0) return;
    this.history.pushState(this.takeSnapshot());
  }

  pushSnapshot(snapshot: SketchSnapshot): void {
    if (this.batchDepth > 0) return;
    this.history.pushState(snapshot);
    this.notify();
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  undo(): boolean {
    if (this.batchDepth > 0) {
      this.rollbackTransaction();
    }
    if (!this.history.canUndo()) return false;
    const current = this.takeSnapshot();
    const prev = this.history.undo(current);
    if (prev) {
      this.restoreSnapshot(prev);
      return true;
    }
    return false;
  }

  redo(): boolean {
    if (this.batchDepth > 0) {
      this.rollbackTransaction();
    }
    if (!this.history.canRedo()) return false;
    const current = this.takeSnapshot();
    const next = this.history.redo(current);
    if (next) {
      this.restoreSnapshot(next);
      return true;
    }
    return false;
  }

  clearHistory(): void {
    this.history.clear();
    this.notify();
  }

  takeSnapshot(): SketchSnapshot {
    return {
      points: Array.from(this.points.values()).map(p => ({ ...p })),
      lines: Array.from(this.lines.values()).map(l => ({ ...l })),
      circles: Array.from(this.circles.values()).map(c => ({ ...c })),
      arcs: Array.from(this.arcs.values()).map(a => ({ ...a })),
      ellipses: Array.from(this.ellipses.values()).map(e => ({ ...e })),
      ellipticalArcs: Array.from(this.ellipticalArcs.values()).map(a => ({ ...a })),
      constraints: Array.from(this.constraints.values()).map(c => serializeConstraint(c)),
      idCounter: this.idCounter,
    };
  }

  restoreSnapshot(snapshot: SketchSnapshot): void {
    this.points.clear();
    for (const pt of snapshot.points) {
      this.points.set(pt.id, { ...pt });
    }

    this.lines.clear();
    for (const l of snapshot.lines) {
      this.lines.set(l.id, { ...l });
    }

    this.circles.clear();
    for (const c of snapshot.circles) {
      this.circles.set(c.id, { ...c });
    }

    this.arcs.clear();
    for (const a of snapshot.arcs) {
      this.arcs.set(a.id, { ...a });
    }

    this.ellipses.clear();
    for (const e of snapshot.ellipses ?? []) {
      this.ellipses.set(e.id, { ...e });
    }

    this.ellipticalArcs.clear();
    for (const a of snapshot.ellipticalArcs ?? []) {
      this.ellipticalArcs.set(a.id, { ...a });
    }

    this.constraints.clear();
    for (const sc of snapshot.constraints) {
      const c = deserializeConstraint(sc);
      if (c) {
        this.constraints.set(c.id, c);
      }
    }

    this.idCounter = snapshot.idCounter;
    this.clearSelection();
    this.rebuildParamManager();
    this.solve();
    this.notify();
  }

  // --- Point methods ---
  addPoint(x: number, y: number, fixed = false, isConstruction = false): SketchPoint {
    this.pushHistory();
    const id = this.nextId('pt');
    const pt: SketchPoint = { id, x, y, fixed, isConstruction };
    this.points.set(id, pt);
    this.rebuildParamManager();
    this.solve();
    return pt;
  }

  getPoint(id: string): SketchPoint | undefined {
    return this.points.get(id);
  }

  // --- Line methods ---
  addLine(p1Id: string, p2Id: string, isConstruction = false): SketchLine {
    this.pushHistory();
    const id = this.nextId('line');
    const line: SketchLine = { id, p1Id, p2Id, isConstruction };
    this.lines.set(id, line);
    this.rebuildParamManager();
    this.solve();
    return line;
  }

  // --- Circle methods ---
  addCircle(centerId: string, radius: number, isConstruction = false): SketchCircle {
    this.pushHistory();
    const id = this.nextId('circ');
    const circle: SketchCircle = { id, centerId, radius, isConstruction };
    this.circles.set(id, circle);
    this.rebuildParamManager();
    this.solve();
    return circle;
  }

  // --- Arc methods ---
  addArc(
    centerId: string,
    startPointId: string,
    endPointId: string,
    radius: number,
    clockwise = false,
    isConstruction = false
  ): SketchArc {
    this.pushHistory();
    const id = this.nextId('arc');
    const arc: SketchArc = { id, centerId, startPointId, endPointId, radius, clockwise, isConstruction };
    this.arcs.set(id, arc);
    this.rebuildParamManager();
    const c = new ArcEndpointsConstraint(
      this.nextId('c_arcept'),
      id,
      centerId,
      startPointId,
      endPointId
    );
    this.constraints.set(c.id, c);
    this.solve();
    return arc;
  }

  // --- Ellipse methods ---
  addEllipse(
    centerId: string,
    majorAxisPointId: string,
    minorAxisPointId: string,
    isConstruction = false
  ): SketchEllipse {
    this.pushHistory();
    const id = this.nextId('el');
    const ellipse: SketchEllipse = {
      id,
      centerId,
      majorAxisPointId,
      minorAxisPointId,
      isConstruction,
    };
    this.ellipses.set(id, ellipse);
    this.rebuildParamManager();
    const c = new EllipseAxisConstraint(
      this.nextId('c_elaxis'),
      id,
      centerId,
      majorAxisPointId,
      minorAxisPointId
    );
    this.constraints.set(c.id, c);
    this.solve();
    return ellipse;
  }

  // --- Elliptical Arc methods ---
  addEllipticalArc(
    centerId: string,
    majorAxisPointId: string,
    minorAxisPointId: string,
    startPointId: string,
    endPointId: string,
    clockwise = false,
    isConstruction = false
  ): SketchEllipticalArc {
    this.pushHistory();
    const id = this.nextId('elarc');
    const arc: SketchEllipticalArc = {
      id,
      centerId,
      majorAxisPointId,
      minorAxisPointId,
      startPointId,
      endPointId,
      clockwise,
      isConstruction,
    };
    this.ellipticalArcs.set(id, arc);
    this.rebuildParamManager();
    const cAxis = new EllipseAxisConstraint(
      this.nextId('c_elaxis'),
      id,
      centerId,
      majorAxisPointId,
      minorAxisPointId
    );
    this.constraints.set(cAxis.id, cAxis);
    const cEndpoints = new EllipticalArcEndpointsConstraint(
      this.nextId('c_elarcept'),
      id,
      centerId,
      majorAxisPointId,
      minorAxisPointId,
      startPointId,
      endPointId
    );
    this.constraints.set(cEndpoints.id, cEndpoints);
    this.solve();
    return arc;
  }

  // --- Constraint methods ---
  addConstraint(constraint: IConstraint): void {
    this.pushHistory();
    this.constraints.set(constraint.id, constraint);
    this.solve();
  }

  removeConstraint(id: string): void {
    const c = this.constraints.get(id);
    if (!c) return;
    this.pushHistory();
    if (c instanceof FixedConstraint) {
      const pt = this.points.get(c.pointId);
      if (pt) pt.fixed = false;
      this.rebuildParamManager();
    }
    this.constraints.delete(id);
    this.selection.constraintIds.delete(id);
    this.solve();
  }

  addFixedConstraint(pointId: string): FixedConstraint | null {
    const pt = this.points.get(pointId);
    if (!pt) return null;
    this.pushHistory();
    pt.fixed = true;
    const c = new FixedConstraint(this.nextId('c_fix'), pointId, pt.x, pt.y);
    this.constraints.set(c.id, c);
    this.rebuildParamManager();
    this.solve();
    return c;
  }

  addCoincidentConstraint(p1Id: string, p2Id: string): CoincidentConstraint | null {
    if (p1Id === p2Id) return null;
    if (!this.points.has(p1Id) || !this.points.has(p2Id)) return null;

    // Do not constrain endpoints of the same line segment (would collapse length to 0)
    const sameLine = [...this.lines.values()].some(
      l => (l.p1Id === p1Id && l.p2Id === p2Id) || (l.p1Id === p2Id && l.p2Id === p1Id)
    );
    if (sameLine) return null;

    // Check if coincident constraint already exists between these two points
    const existing = [...this.constraints.values()].find(
      c =>
        c instanceof CoincidentConstraint &&
        ((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
    );
    if (existing) return null;

    const c = new CoincidentConstraint(this.nextId('c_coinc'), p1Id, p2Id);
    this.addConstraint(c);
    return c;
  }

  addHorizontalConstraint(p1Id: string, p2Id: string): HorizontalConstraint {
    const c = new HorizontalConstraint(this.nextId('c_horiz'), p1Id, p2Id);
    this.addConstraint(c);
    return c;
  }

  addVerticalConstraint(p1Id: string, p2Id: string): VerticalConstraint {
    const c = new VerticalConstraint(this.nextId('c_vert'), p1Id, p2Id);
    this.addConstraint(c);
    return c;
  }

  addDistanceConstraint(
    p1Id: string,
    p2Id: string,
    targetDist?: number,
    offset?: number,
    orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
  ): DistanceConstraint | null {
    const p1 = this.points.get(p1Id);
    const p2 = this.points.get(p2Id);
    if (!p1 || !p2) return null;

    let measured = dist(p1, p2);
    if (orientation === 'horizontal') {
      measured = Math.abs(p2.x - p1.x);
    } else if (orientation === 'vertical') {
      measured = Math.abs(p2.y - p1.y);
    }

    const currentDist = targetDist ?? Math.max(0.01, Number(measured.toFixed(2)));
    const c = new DistanceConstraint(this.nextId('c_dist'), p1Id, p2Id, currentDist, 1.0, offset, orientation);
    this.addConstraint(c);
    return c;
  }

  calculateLinesAngleGeometry(
    p1: SketchPoint,
    p2: SketchPoint,
    p3: SketchPoint,
    p4: SketchPoint,
    cursorPos?: { x: number; y: number }
  ): {
    pInt: { x: number; y: number };
    u1: { x: number; y: number };
    u2: { x: number; y: number };
    s1: number;
    s2: number;
    initialAngleDeg: number;
    sign: number;
  } {
    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const v2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const l1 = Math.max(Math.hypot(v1.x, v1.y), 1e-7);
    const l2 = Math.max(Math.hypot(v2.x, v2.y), 1e-7);

    // Direction unit vectors along the raw segments (p1->p2, p3->p4)
    const e1 = { x: v1.x / l1, y: v1.y / l1 };
    const e2 = { x: v2.x / l2, y: v2.y / l2 };

    let pInt: { x: number; y: number };
    let defS1 = 1;
    let defS2 = 1;

    if (p1.id === p3.id || (Math.abs(p1.x - p3.x) < 1e-4 && Math.abs(p1.y - p3.y) < 1e-4)) {
      pInt = { x: p1.x, y: p1.y };
      defS1 = 1;
      defS2 = 1;
    } else if (p1.id === p4.id || (Math.abs(p1.x - p4.x) < 1e-4 && Math.abs(p1.y - p4.y) < 1e-4)) {
      pInt = { x: p1.x, y: p1.y };
      defS1 = 1;
      defS2 = -1;
    } else if (p2.id === p3.id || (Math.abs(p2.x - p3.x) < 1e-4 && Math.abs(p2.y - p3.y) < 1e-4)) {
      pInt = { x: p2.x, y: p2.y };
      defS1 = -1;
      defS2 = 1;
    } else if (p2.id === p4.id || (Math.abs(p2.x - p4.x) < 1e-4 && Math.abs(p2.y - p4.y) < 1e-4)) {
      pInt = { x: p2.x, y: p2.y };
      defS1 = -1;
      defS2 = -1;
    } else {
      const det = v1.x * v2.y - v1.y * v2.x;
      if (Math.abs(det) < 1e-6) {
        pInt = { x: (p1.x + p3.x) * 0.5, y: (p1.y + p3.y) * 0.5 };
        defS1 = 1;
        defS2 = 1;
      } else {
        const t = ((p3.x - p1.x) * v2.y - (p3.y - p1.y) * v2.x) / det;
        pInt = { x: p1.x + t * v1.x, y: p1.y + t * v1.y };
        const m1 = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
        const m2 = { x: (p3.x + p4.x) * 0.5, y: (p3.y + p4.y) * 0.5 };
        const w1 = { x: m1.x - pInt.x, y: m1.y - pInt.y };
        const w2 = { x: m2.x - pInt.x, y: m2.y - pInt.y };
        defS1 = w1.x * v1.x + w1.y * v1.y >= 0 ? 1 : -1;
        defS2 = w2.x * v2.x + w2.y * v2.y >= 0 ? 1 : -1;
      }
    }

    // Default rays pointing along the physical segments from pInt:
    const u1Seg = { x: defS1 * e1.x, y: defS1 * e1.y };
    const u2Seg = { x: defS2 * e2.x, y: defS2 * e2.y };

    let s1 = defS1;
    let s2 = defS2;

    if (cursorPos) {
      const w = { x: cursorPos.x - pInt.x, y: cursorPos.y - pInt.y };
      const wLen = Math.hypot(w.x, w.y);
      if (wLen > 1e-3) {
        // Decompose w in the basis of (u1Seg, u2Seg):
        // w = alpha * u1Seg + beta * u2Seg
        const detSeg = u1Seg.x * u2Seg.y - u1Seg.y * u2Seg.x;
        if (Math.abs(detSeg) > 1e-6) {
          const alpha = (w.x * u2Seg.y - w.y * u2Seg.x) / detSeg;
          const beta = (u1Seg.x * w.y - u1Seg.y * w.x) / detSeg;
          const signAlpha = alpha >= 0 ? 1 : -1;
          const signBeta = beta >= 0 ? 1 : -1;
          s1 = signAlpha * defS1;
          s2 = signBeta * defS2;
        }
      }
    }

    const u1 = { x: (s1 * v1.x) / l1, y: (s1 * v1.y) / l1 };
    const u2 = { x: (s2 * v2.x) / l2, y: (s2 * v2.y) / l2 };

    const dotVal = Math.min(1, Math.max(-1, u1.x * u2.x + u1.y * u2.y));
    const initialAngleDeg = (Math.acos(dotVal) * 180) / Math.PI;
    const crossVal = u1.x * u2.y - u1.y * u2.x;
    const sign = crossVal >= 0 ? 1 : -1;

    return { pInt, u1, u2, s1, s2, initialAngleDeg, sign };
  }

  addAngleConstraint(
    line1Id: string,
    line2Id: string,
    targetAngleDeg?: number,
    arcRadius?: number,
    cursorPosOrS1?: { x: number; y: number } | number,
    s2Param?: number,
    signParam?: number
  ): AngleConstraint | null {
    const l1 = this.lines.get(line1Id);
    const l2 = this.lines.get(line2Id);
    if (!l1 || !l2) return null;

    const p1 = this.points.get(l1.p1Id);
    const p2 = this.points.get(l1.p2Id);
    const p3 = this.points.get(l2.p1Id);
    const p4 = this.points.get(l2.p2Id);
    if (!p1 || !p2 || !p3 || !p4) return null;

    const cursorPos = typeof cursorPosOrS1 === 'object' && cursorPosOrS1 !== null ? cursorPosOrS1 : undefined;
    const geom = this.calculateLinesAngleGeometry(p1, p2, p3, p4, cursorPos);

    const s1 = typeof cursorPosOrS1 === 'number' ? cursorPosOrS1 : geom.s1;
    const s2 = typeof s2Param === 'number' ? s2Param : geom.s2;
    const sign = typeof signParam === 'number' ? signParam : geom.sign;

    const angleVal =
      targetAngleDeg ?? Math.max(0.1, Math.min(179.9, Math.round(geom.initialAngleDeg * 10) / 10));
    const radiusVal = arcRadius ?? 40;

    const c = new AngleConstraint(
      this.nextId('c_ang'),
      line1Id,
      line2Id,
      l1.p1Id,
      l1.p2Id,
      l2.p1Id,
      l2.p2Id,
      angleVal,
      radiusVal,
      s1,
      s2,
      sign
    );
    this.addConstraint(c);
    return c;
  }

  addRadiusConstraint(
    circleOrArcId: string,
    targetRadius?: number,
    displayMode?: 'radius' | 'diameter'
  ): RadiusConstraint | null {
    const isCircle = this.circles.has(circleOrArcId);
    const entity = this.circles.get(circleOrArcId) ?? this.arcs.get(circleOrArcId);
    if (!entity) return null;

    const defaultMode: 'radius' | 'diameter' = displayMode ?? (isCircle ? 'diameter' : 'radius');

    // Check if a radius constraint already exists on this circle or arc
    const existing = [...this.constraints.values()].find(
      c => c instanceof RadiusConstraint && c.circleId === circleOrArcId
    ) as RadiusConstraint | undefined;

    if (existing) {
      if (displayMode !== undefined) {
        existing.displayMode = displayMode;
      } else if (!existing.displayMode) {
        existing.displayMode = defaultMode;
      }

      if (targetRadius !== undefined) {
        this.pushHistory();
        existing.targetRadius = targetRadius;
        existing.value = targetRadius;
        const mode = existing.displayMode ?? defaultMode;
        const valStr = mode === 'diameter' ? Number((targetRadius * 2).toFixed(2)) : Number(targetRadius.toFixed(2));
        existing.name = mode === 'diameter'
          ? `Diameter (${valStr})`
          : `Radius (${valStr})`;
        this.solve();
      }
      return existing;
    }

    const r = targetRadius ?? Math.max(0.01, Number(entity.radius.toFixed(2)));
    const c = new RadiusConstraint(
      this.nextId('c_rad'),
      circleOrArcId,
      r,
      1.0,
      undefined,
      defaultMode
    );
    this.addConstraint(c);
    return c;
  }

  addEqualLengthConstraint(line1Id: string, line2Id: string): EqualLengthConstraint | null {
    const l1 = this.lines.get(line1Id);
    const l2 = this.lines.get(line2Id);
    if (!l1 || !l2) return null;

    const c = new EqualLengthConstraint(
      this.nextId('c_eqlen'),
      l1.p1Id,
      l1.p2Id,
      l2.p1Id,
      l2.p2Id
    );
    this.addConstraint(c);
    return c;
  }

  addEqualRadiusConstraint(circle1Id: string, circle2Id: string): EqualRadiusConstraint {
    const c = new EqualRadiusConstraint(this.nextId('c_eqrad'), circle1Id, circle2Id);
    this.addConstraint(c);
    return c;
  }

  addParallelConstraint(line1Id: string, line2Id: string): ParallelConstraint | null {
    const l1 = this.lines.get(line1Id);
    const l2 = this.lines.get(line2Id);
    if (!l1 || !l2) return null;

    const c = new ParallelConstraint(this.nextId('c_par'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
    this.addConstraint(c);
    return c;
  }

  addPerpendicularConstraint(line1Id: string, line2Id: string): PerpendicularConstraint | null {
    const l1 = this.lines.get(line1Id);
    const l2 = this.lines.get(line2Id);
    if (!l1 || !l2) return null;

    const c = new PerpendicularConstraint(this.nextId('c_perp'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
    this.addConstraint(c);
    return c;
  }

  addPointOnLineConstraint(pointId: string, lineId: string): PointOnLineConstraint | null {
    const line = this.lines.get(lineId);
    if (!line) return null;

    // Do not constrain an endpoint of the line to the line itself
    if (pointId === line.p1Id || pointId === line.p2Id) return null;

    // Check if constraint already exists
    const existing = [...this.constraints.values()].find(
      c =>
        c instanceof PointOnLineConstraint &&
        c.pointId === pointId &&
        ((c.lineP1Id === line.p1Id && c.lineP2Id === line.p2Id) ||
         (c.lineP1Id === line.p2Id && c.lineP2Id === line.p1Id))
    );
    if (existing) return null;

    const c = new PointOnLineConstraint(this.nextId('c_ptline'), pointId, line.p1Id, line.p2Id);
    this.addConstraint(c);
    return c;
  }

  addPointOnCircleConstraint(pointId: string, circleOrArcId: string): PointOnCircleConstraint | null {
    const circle = this.circles.get(circleOrArcId) ?? this.arcs.get(circleOrArcId);
    if (!circle) return null;

    if (pointId === circle.centerId) return null;
    const arc = this.arcs.get(circleOrArcId);
    if (arc && (pointId === arc.startPointId || pointId === arc.endPointId)) {
      return null;
    }

    const existing = [...this.constraints.values()].find(
      c =>
        c instanceof PointOnCircleConstraint &&
        c.pointId === pointId &&
        c.circleId === circleOrArcId
    );
    if (existing) return null;

    const c = new PointOnCircleConstraint(
      this.nextId('c_ptcirc'),
      pointId,
      circle.centerId,
      circleOrArcId
    );
    this.addConstraint(c);
    return c;
  }

  addTangentConstraint(lineId: string, circleOrArcId: string): TangentLineCircleConstraint | null {
    const line = this.lines.get(lineId);
    const circle = this.circles.get(circleOrArcId) ?? this.arcs.get(circleOrArcId);
    if (!line || !circle) return null;

    const c = new TangentLineCircleConstraint(
      this.nextId('c_tang'),
      line.p1Id,
      line.p2Id,
      circle.centerId,
      circleOrArcId,
      this.getTangentSide(line, circle.centerId)
    );
    this.addConstraint(c);
    return c;
  }

  /**
   * Returns on which side (+1 / -1) of the directed line p1->p2 the given center
   * currently lies, using the same sign convention as TangentLineCircleConstraint.
   * This keeps the circle on its current side when the tangent constraint is applied.
   */
  private getTangentSide(line: SketchLine, centerId: string): number {
    const p1 = this.points.get(line.p1Id);
    const p2 = this.points.get(line.p2Id);
    const center = this.points.get(centerId);
    if (!p1 || !p2 || !center) return 1;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const cross = (center.x - p1.x) * dy - (center.y - p1.y) * dx;
    return cross >= 0 ? 1 : -1;
  }

  addConcentricConstraint(c1Id: string, c2Id: string): ConcentricConstraint | null {
    const circ1 = this.circles.get(c1Id) ?? this.arcs.get(c1Id);
    const circ2 = this.circles.get(c2Id) ?? this.arcs.get(c2Id);
    if (!circ1 || !circ2) return null;

    const c = new ConcentricConstraint(this.nextId('c_concen'), circ1.centerId, circ2.centerId);
    this.addConstraint(c);
    return c;
  }

  addMidpointConstraint(pointId: string, lineId: string): MidpointConstraint | null {
    const line = this.lines.get(lineId);
    if (!line) return null;

    const c = new MidpointConstraint(this.nextId('c_mid'), pointId, line.p1Id, line.p2Id);
    this.addConstraint(c);
    return c;
  }

  // --- Deletion with cascade ---
  removeEntity(id: string): void {
    if (this.constraints.has(id)) {
      this.removeConstraint(id);
      return;
    }
    if (
      !this.points.has(id) &&
      !this.lines.has(id) &&
      !this.circles.has(id) &&
      !this.arcs.has(id) &&
      !this.ellipses.has(id) &&
      !this.ellipticalArcs.has(id)
    ) {
      return;
    }

    this.beginTransaction();

    if (this.points.has(id)) {
      this.points.delete(id);
      this.selection.pointIds.delete(id);
      // Remove lines referencing this point
      for (const [lid, line] of this.lines.entries()) {
        if (line.p1Id === id || line.p2Id === id) {
          this.lines.delete(lid);
          this.selection.lineIds.delete(lid);
        }
      }
      // Remove circles referencing this center
      for (const [cid, circle] of this.circles.entries()) {
        if (circle.centerId === id) {
          this.circles.delete(cid);
          this.selection.circleIds.delete(cid);
        }
      }
      // Remove arcs referencing this point
      for (const [aid, arc] of this.arcs.entries()) {
        if (arc.centerId === id || arc.startPointId === id || arc.endPointId === id) {
          this.arcs.delete(aid);
          this.selection.arcIds.delete(aid);
        }
      }
      // Remove ellipses referencing this point
      for (const [eid, el] of this.ellipses.entries()) {
        if (el.centerId === id || el.majorAxisPointId === id || el.minorAxisPointId === id) {
          this.ellipses.delete(eid);
          this.selection.ellipseIds.delete(eid);
        }
      }
      // Remove elliptical arcs referencing this point
      for (const [eaid, elarc] of this.ellipticalArcs.entries()) {
        if (
          elarc.centerId === id ||
          elarc.majorAxisPointId === id ||
          elarc.minorAxisPointId === id ||
          elarc.startPointId === id ||
          elarc.endPointId === id
        ) {
          this.ellipticalArcs.delete(eaid);
          this.selection.ellipticalArcIds.delete(eaid);
        }
      }
    } else if (this.lines.has(id)) {
      this.lines.delete(id);
      this.selection.lineIds.delete(id);
    } else if (this.circles.has(id)) {
      this.circles.delete(id);
      this.selection.circleIds.delete(id);
    } else if (this.arcs.has(id)) {
      this.arcs.delete(id);
      this.selection.arcIds.delete(id);
    } else if (this.ellipses.has(id)) {
      this.ellipses.delete(id);
      this.selection.ellipseIds.delete(id);
    } else if (this.ellipticalArcs.has(id)) {
      this.ellipticalArcs.delete(id);
      this.selection.ellipticalArcIds.delete(id);
    }

    // Clean up orphan constraints
    for (const [cid, constraint] of this.constraints.entries()) {
      const hasMissingEntity = constraint.entityIds.some(
        entId =>
          !this.points.has(entId) &&
          !this.lines.has(entId) &&
          !this.circles.has(entId) &&
          !this.arcs.has(entId) &&
          !this.ellipses.has(entId) &&
          !this.ellipticalArcs.has(entId)
      );
      if (hasMissingEntity) {
        this.constraints.delete(cid);
        this.selection.constraintIds.delete(cid);
      }
    }

    this.rebuildParamManager();
    this.solve();
    this.commitTransaction();
  }

  toggleConstruction(id: string): void {
    this.pushHistory();
    const pt = this.points.get(id);
    if (pt) {
      pt.isConstruction = !pt.isConstruction;
      this.notify();
      return;
    }
    const line = this.lines.get(id);
    if (line) {
      line.isConstruction = !line.isConstruction;
      this.notify();
      return;
    }
    const circle = this.circles.get(id);
    if (circle) {
      circle.isConstruction = !circle.isConstruction;
      this.notify();
      return;
    }
    const arc = this.arcs.get(id);
    if (arc) {
      arc.isConstruction = !arc.isConstruction;
      this.notify();
      return;
    }
    const el = this.ellipses.get(id);
    if (el) {
      el.isConstruction = !el.isConstruction;
      this.notify();
      return;
    }
    const elarc = this.ellipticalArcs.get(id);
    if (elarc) {
      elarc.isConstruction = !elarc.isConstruction;
      this.notify();
      return;
    }
  }

  // --- Real-time Solver Synchronization ---
  rebuildParamManager(): void {
    this.paramManager.clear();

    for (const pt of this.points.values()) {
      this.paramManager.register({
        id: `${pt.id}.x`,
        get: () => pt.x,
        set: val => {
          pt.x = val;
        },
        isFixed: pt.fixed,
      });
      this.paramManager.register({
        id: `${pt.id}.y`,
        get: () => pt.y,
        set: val => {
          pt.y = val;
        },
        isFixed: pt.fixed,
      });
    }

    for (const circle of this.circles.values()) {
      this.paramManager.register({
        id: `${circle.id}.r`,
        get: () => circle.radius,
        set: val => {
          circle.radius = Math.max(1, val);
        },
        isFixed: false,
        min: 1,
      });
    }

    for (const arc of this.arcs.values()) {
      this.paramManager.register({
        id: `${arc.id}.r`,
        get: () => arc.radius,
        set: val => {
          arc.radius = Math.max(1, val);
        },
        isFixed: false,
        min: 1,
      });
    }
  }

  /**
   * Radii driven by a radius/diameter constraint are applied directly and locked,
   * so the solver never changes them to satisfy other constraints.
   */
  private collectDrivenRadii(): Set<string> {
    const locked = new Set<string>();
    for (const c of this.constraints.values()) {
      if (!(c instanceof RadiusConstraint)) continue;
      const entity = this.circles.get(c.circleId) ?? this.arcs.get(c.circleId);
      if (!entity) continue;
      entity.radius = Math.max(1, c.targetRadius);
      locked.add(`${c.circleId}.r`);
    }
    return locked;
  }

  solve(extraConstraints: IConstraint[] = []): SolverResult {
    const activeConstraints = [...this.constraints.values(), ...extraConstraints];
    const drivenRadii = this.collectDrivenRadii();

    // Interactive drags keep the regular behaviour (radius may follow the drag)
    if (extraConstraints.length > 0) {
      const res = this.solver.solve(this.paramManager, activeConstraints, { lockedParams: drivenRadii });
      this.lastSolverResult = res;
      this.notify();
      return res;
    }

    // Radii are changed only as a last resort:
    // Stage 1: try to satisfy all constraints with every radius locked.
    const allRadii = new Set<string>(drivenRadii);
    for (const id of this.circles.keys()) allRadii.add(`${id}.r`);
    for (const id of this.arcs.keys()) allRadii.add(`${id}.r`);

    let stage1Ok = false;
    if (allRadii.size > drivenRadii.size) {
      const initialValues = this.paramManager.getCurrentValues();
      const stage1 = this.solver.solve(this.paramManager, activeConstraints, {
        lockedParams: allRadii,
        skipDoF: true,
      });
      stage1Ok = stage1.status !== 'OVER_CONSTRAINED' && stage1.finalError < 1e-8;
      if (!stage1Ok) {
        // Discard the least-squares compromise and start over from the original state
        this.paramManager.restoreValues(initialValues);
      }
    }

    // Stage 2: free (non-driven) radii, but make them much stiffer than positions so
    // that the solver prefers moving geometry over resizing circles. When stage 1
    // succeeded this is a no-op / polish step that also computes the DoF.
    const stiffness = new Map<string, number>();
    for (const id of allRadii) stiffness.set(id, 1000);
    const res = this.solver.solve(this.paramManager, activeConstraints, {
      lockedParams: drivenRadii,
      paramStiffness: stiffness,
    });
    this.lastSolverResult = res;
    this.notify();
    return res;
  }

  dragPoint(pointId: string, targetX: number, targetY: number): SolverResult {
    const pt = this.points.get(pointId);
    if (!pt) {
      return this.solve();
    }

    // Soft spring constraint pulls point to mouse position while strictly preserving hard constraints
    const dragConstraint = new DragPointConstraint(pointId, targetX, targetY, 0.005);
    return this.solve([dragConstraint]);
  }

  dragLine(
    lineId: string,
    p1TargetX: number,
    p1TargetY: number,
    p2TargetX: number,
    p2TargetY: number
  ): SolverResult {
    const line = this.lines.get(lineId);
    if (!line) return this.solve();

    const c1 = new DragPointConstraint(line.p1Id, p1TargetX, p1TargetY, 0.005);
    const c2 = new DragPointConstraint(line.p2Id, p2TargetX, p2TargetY, 0.005);
    return this.solve([c1, c2]);
  }

  dragCircle(
    circleId: string,
    targetCenterX: number,
    targetCenterY: number
  ): SolverResult {
    const circle = this.circles.get(circleId);
    if (!circle) return this.solve();

    const c = new DragPointConstraint(circle.centerId, targetCenterX, targetCenterY, 0.005);
    return this.solve([c]);
  }

  dragCircleRadius(
    circleOrArcId: string,
    targetRadius: number
  ): SolverResult {
    const entity = this.circles.get(circleOrArcId) ?? this.arcs.get(circleOrArcId);
    if (!entity) return this.solve();

    entity.radius = Math.max(1, targetRadius);
    return this.solve();
  }

  hasRadiusConstraint(circleId: string): boolean {
    for (const c of this.constraints.values()) {
      if (c instanceof RadiusConstraint && c.circleId === circleId) {
        return true;
      }
    }
    return false;
  }

  isPointFixed(pointId: string): boolean {
    const pt = this.points.get(pointId);
    if (pt?.fixed) return true;
    for (const c of this.constraints.values()) {
      if (c instanceof FixedConstraint && c.pointId === pointId) {
        return true;
      }
    }
    return false;
  }

  private matchesEndpoints(pA: string, pB: string, end1: string, end2: string): boolean {
    return (pA === end1 && pB === end2) || (pA === end2 && pB === end1);
  }

  getLineBetween(p1Id: string, p2Id: string): SketchLine | undefined {
    for (const line of this.lines.values()) {
      if (
        (line.p1Id === p1Id && line.p2Id === p2Id) ||
        (line.p1Id === p2Id && line.p2Id === p1Id)
      ) {
        return line;
      }
    }
    return undefined;
  }

  getConstraintsForEntity(
    type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc',
    id: string
  ): IConstraint[] {
    const res: IConstraint[] = [];
    if (type === 'point') {
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (c.type === 'fixed') {
          if (anyC.pointId === id) res.push(c);
        } else if (c.type === 'coincident') {
          if (anyC.p1Id === id || anyC.p2Id === id) res.push(c);
        } else if (c.type === 'point_on_line') {
          if (anyC.pointId === id) res.push(c);
        } else if (c.type === 'point_on_circle') {
          if (anyC.pointId === id) res.push(c);
        } else if (c.type === 'midpoint') {
          if (anyC.midId === id) res.push(c);
        } else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
          if (anyC.p1Id === id || anyC.p2Id === id) {
            // Only associate if there is no line between these points (i.e. not a line constraint)
            if (!this.getLineBetween(anyC.p1Id, anyC.p2Id)) {
              res.push(c);
            }
          }
        } else if (
          c.type !== 'equal_length' &&
          c.type !== 'parallel' &&
          c.type !== 'perpendicular' &&
          c.type !== 'tangent_line_circle'
        ) {
          if (c.entityIds.includes(id)) {
            res.push(c);
          }
        }
      }
    } else if (type === 'line') {
      const line = this.lines.get(id);
      if (!line) return [];
      const { p1Id, p2Id } = line;
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (c.entityIds.includes(id)) {
          res.push(c);
          continue;
        }
        if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
          if (this.matchesEndpoints(anyC.p1Id, anyC.p2Id, p1Id, p2Id)) {
            res.push(c);
          }
        } else if (c.type === 'equal_length') {
          if (
            this.matchesEndpoints(anyC.line1P1, anyC.line1P2, p1Id, p2Id) ||
            this.matchesEndpoints(anyC.line2P1, anyC.line2P2, p1Id, p2Id)
          ) {
            res.push(c);
          }
        } else if (c.type === 'parallel' || c.type === 'perpendicular') {
          if (
            this.matchesEndpoints(anyC.l1P1, anyC.l1P2, p1Id, p2Id) ||
            this.matchesEndpoints(anyC.l2P1, anyC.l2P2, p1Id, p2Id)
          ) {
            res.push(c);
          }
        } else if (c.type === 'point_on_line' || c.type === 'tangent_line_circle') {
          if (this.matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
            res.push(c);
          }
        } else if (c.type === 'midpoint') {
          if (this.matchesEndpoints(anyC.p1Id, anyC.p2Id, p1Id, p2Id)) {
            res.push(c);
          }
        }
      }
    } else if (type === 'circle') {
      const circ = this.circles.get(id);
      if (!circ) return [];
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (c.type === 'radius') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.type === 'equal_radius') {
          if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
        } else if (c.type === 'concentric') {
          if (anyC.c1CenterId === circ.centerId || anyC.c2CenterId === circ.centerId) {
            res.push(c);
          }
        } else if (c.type === 'tangent_line_circle') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.type === 'point_on_circle') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.entityIds.includes(id)) {
          res.push(c);
        }
      }
    } else if (type === 'arc') {
      const arc = this.arcs.get(id);
      if (!arc) return [];
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (c.type === 'radius') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.type === 'equal_radius') {
          if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
        } else if (c.type === 'concentric') {
          if (anyC.c1CenterId === arc.centerId || anyC.c2CenterId === arc.centerId) {
            res.push(c);
          }
        } else if (c.type === 'tangent_line_circle') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.type === 'point_on_circle') {
          if (anyC.circleId === id) res.push(c);
        } else if (c.entityIds.includes(id)) {
          res.push(c);
        }
      }
    } else if (type === 'ellipse') {
      const el = this.ellipses.get(id);
      if (!el) return [];
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (anyC.ellipseId === id || c.entityIds.includes(id)) {
          res.push(c);
        }
      }
    } else if (type === 'elliptical_arc') {
      const elarc = this.ellipticalArcs.get(id);
      if (!elarc) return [];
      for (const c of this.constraints.values()) {
        const anyC = c as any;
        if (anyC.arcId === id || anyC.ellipseId === id || c.entityIds.includes(id)) {
          res.push(c);
        }
      }
    }
    return res;
  }

  selectEntity(
    id: string,
    type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'constraint',
    multiSelect = false
  ): void {
    if (!multiSelect) {
      this.clearSelection();
    }

    if (type === 'point') {
      this.selection.pointIds.add(id);
      for (const c of this.getConstraintsForEntity('point', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'line') {
      this.selection.lineIds.add(id);
      for (const c of this.getConstraintsForEntity('line', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'circle') {
      this.selection.circleIds.add(id);
      for (const c of this.getConstraintsForEntity('circle', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'arc') {
      this.selection.arcIds.add(id);
      for (const c of this.getConstraintsForEntity('arc', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'ellipse') {
      this.selection.ellipseIds.add(id);
      for (const c of this.getConstraintsForEntity('ellipse', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'elliptical_arc') {
      this.selection.ellipticalArcIds.add(id);
      for (const c of this.getConstraintsForEntity('elliptical_arc', id)) {
        this.selection.constraintIds.add(c.id);
      }
    } else if (type === 'constraint') {
      this.selection.constraintIds.add(id);
    }

    this.notify();
  }

  clear(): void {
    this.pushHistory();
    this.points.clear();
    this.lines.clear();
    this.circles.clear();
    this.arcs.clear();
    this.ellipses.clear();
    this.ellipticalArcs.clear();
    this.constraints.clear();
    this.selection.pointIds.clear();
    this.selection.lineIds.clear();
    this.selection.circleIds.clear();
    this.selection.arcIds.clear();
    this.selection.ellipseIds.clear();
    this.selection.ellipticalArcIds.clear();
    this.selection.constraintIds.clear();
    this.rebuildParamManager();
    this.solve();
  }

  clearSelection(): void {
    this.selection.pointIds.clear();
    this.selection.lineIds.clear();
    this.selection.circleIds.clear();
    this.selection.arcIds.clear();
    this.selection.ellipseIds.clear();
    this.selection.ellipticalArcIds.clear();
    this.selection.constraintIds.clear();
    this.notify();
  }

  deleteSelected(): void {
    const hasSelection =
      this.selection.pointIds.size > 0 ||
      this.selection.lineIds.size > 0 ||
      this.selection.circleIds.size > 0 ||
      this.selection.arcIds.size > 0 ||
      this.selection.ellipseIds.size > 0 ||
      this.selection.ellipticalArcIds.size > 0 ||
      this.selection.constraintIds.size > 0;

    if (!hasSelection) return;

    this.beginTransaction();
    const selectedPoints = [...this.selection.pointIds];
    const selectedLines = [...this.selection.lineIds];
    const selectedCircles = [...this.selection.circleIds];
    const selectedArcs = [...this.selection.arcIds];
    const selectedEllipses = [...this.selection.ellipseIds];
    const selectedEllipticalArcs = [...this.selection.ellipticalArcIds];
    const selectedConstraints = [...this.selection.constraintIds];

    for (const id of selectedConstraints) this.removeConstraint(id);
    for (const id of selectedLines) this.removeEntity(id);
    for (const id of selectedCircles) this.removeEntity(id);
    for (const id of selectedArcs) this.removeEntity(id);
    for (const id of selectedEllipses) this.removeEntity(id);
    for (const id of selectedEllipticalArcs) this.removeEntity(id);
    for (const id of selectedPoints) this.removeEntity(id);

    this.clearSelection();
    this.commitTransaction();
  }

  exportSVG(): string {
    // Generate clean SVG markup for CAD export
    const elements: string[] = [];
    for (const line of this.lines.values()) {
      const p1 = this.points.get(line.p1Id);
      const p2 = this.points.get(line.p2Id);
      if (p1 && p2) {
        const dash = line.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
        elements.push(
          `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}"${dash} stroke-width="2" />`
        );
      }
    }
    for (const circ of this.circles.values()) {
      const center = this.points.get(circ.centerId);
      if (center) {
        const dash = circ.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
        elements.push(
          `<circle cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="${circ.radius.toFixed(2)}"${dash} stroke-width="2" fill="none" />`
        );
      }
    }
    for (const arc of this.arcs.values()) {
      const center = this.points.get(arc.centerId);
      const start = this.points.get(arc.startPointId);
      const end = this.points.get(arc.endPointId);
      if (center && start && end) {
        const as = Math.atan2(start.y - center.y, start.x - center.x);
        const ae = Math.atan2(end.y - center.y, end.x - center.x);
        const clockwise = !!arc.clockwise;
        let sweepAngle = clockwise ? (as - ae) % (2 * Math.PI) : (ae - as) % (2 * Math.PI);
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;
        const sweepFlag = clockwise ? 1 : 0;
        const dash = arc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
        elements.push(
          `<path d="M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}"${dash} stroke-width="2" fill="none" />`
        );
      }
    }
    for (const el of this.ellipses.values()) {
      const center = this.points.get(el.centerId);
      const maj = this.points.get(el.majorAxisPointId);
      const min = this.points.get(el.minorAxisPointId);
      if (center && maj && min) {
        const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
        const ry = Math.hypot(min.x - center.x, min.y - center.y);
        const deg = (Math.atan2(maj.y - center.y, maj.x - center.x) * 180) / Math.PI;
        const dash = el.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
        elements.push(
          `<ellipse cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})"${dash} stroke-width="2" fill="none" />`
        );
      }
    }
    for (const elarc of this.ellipticalArcs.values()) {
      const center = this.points.get(elarc.centerId);
      const maj = this.points.get(elarc.majorAxisPointId);
      const min = this.points.get(elarc.minorAxisPointId);
      const start = this.points.get(elarc.startPointId);
      const end = this.points.get(elarc.endPointId);
      if (center && maj && min && start && end) {
        const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
        const ry = Math.hypot(min.x - center.x, min.y - center.y);
        const phi = (Math.atan2(maj.y - center.y, maj.x - center.x) * 180) / Math.PI;
        const ux = (maj.x - center.x) / rx;
        const uy = (maj.y - center.y) / rx;
        const vx = (min.x - center.x) / ry;
        const vy = (min.y - center.y) / ry;
        const us = (start.x - center.x) * ux + (start.y - center.y) * uy;
        const vs = (start.x - center.x) * vx + (start.y - center.y) * vy;
        const ue = (end.x - center.x) * ux + (end.y - center.y) * uy;
        const ve = (end.x - center.x) * vx + (end.y - center.y) * vy;
        const ts = Math.atan2(vs / ry, us / rx);
        const te = Math.atan2(ve / ry, ue / rx);
        const clockwise = !!elarc.clockwise;
        let sweep = clockwise ? (ts - te) % (2 * Math.PI) : (te - ts) % (2 * Math.PI);
        if (sweep < 0) sweep += 2 * Math.PI;
        const largeArc = sweep > Math.PI ? 1 : 0;
        const sweepFlag = clockwise ? 0 : 1;
        const dash = elarc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
        elements.push(
          `<path d="M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${phi.toFixed(2)} ${largeArc} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}"${dash} stroke-width="2" fill="none" />`
        );
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="-500 -500 1000 1000">\n  ${elements.join('\n  ')}\n</svg>`;
  }

  getBoundingBox(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (this.points.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of this.points.values()) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    for (const c of this.circles.values()) {
      const center = this.points.get(c.centerId);
      if (center) {
        if (center.x - c.radius < minX) minX = center.x - c.radius;
        if (center.x + c.radius > maxX) maxX = center.x + c.radius;
        if (center.y - c.radius < minY) minY = center.y - c.radius;
        if (center.y + c.radius > maxY) maxY = center.y + c.radius;
      }
    }

    for (const a of this.arcs.values()) {
      const center = this.points.get(a.centerId);
      if (center) {
        if (center.x - a.radius < minX) minX = center.x - a.radius;
        if (center.x + a.radius > maxX) maxX = center.x + a.radius;
        if (center.y - a.radius < minY) minY = center.y - a.radius;
        if (center.y + a.radius > maxY) maxY = center.y + a.radius;
      }
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }
}


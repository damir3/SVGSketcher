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
  TangentLineCircleConstraint,
  ConcentricConstraint,
  MidpointConstraint,
  DragPointConstraint,
} from '../solver/constraints';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SelectionState } from './types';
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
  constraints = new Map<string, IConstraint>();

  selection: SelectionState = {
    pointIds: new Set(),
    lineIds: new Set(),
    circleIds: new Set(),
    arcIds: new Set(),
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
    isConstruction = false
  ): SketchArc {
    this.pushHistory();
    const id = this.nextId('arc');
    const arc: SketchArc = { id, centerId, startPointId, endPointId, radius, isConstruction };
    this.arcs.set(id, arc);
    this.rebuildParamManager();
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

  addCoincidentConstraint(p1Id: string, p2Id: string): CoincidentConstraint {
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

  addDistanceConstraint(p1Id: string, p2Id: string, targetDist?: number): DistanceConstraint | null {
    const p1 = this.points.get(p1Id);
    const p2 = this.points.get(p2Id);
    if (!p1 || !p2) return null;

    const currentDist = targetDist ?? Math.max(1, Math.round(dist(p1, p2)));
    const c = new DistanceConstraint(this.nextId('c_dist'), p1Id, p2Id, currentDist);
    this.addConstraint(c);
    return c;
  }

  addRadiusConstraint(circleId: string, targetRadius?: number): RadiusConstraint | null {
    const circle = this.circles.get(circleId);
    if (!circle) return null;

    const r = targetRadius ?? Math.max(1, Math.round(circle.radius));
    const c = new RadiusConstraint(this.nextId('c_rad'), circleId, r);
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

    const c = new PointOnLineConstraint(this.nextId('c_ptline'), pointId, line.p1Id, line.p2Id);
    this.addConstraint(c);
    return c;
  }

  addTangentConstraint(lineId: string, circleId: string): TangentLineCircleConstraint | null {
    const line = this.lines.get(lineId);
    const circle = this.circles.get(circleId);
    if (!line || !circle) return null;

    const c = new TangentLineCircleConstraint(
      this.nextId('c_tang'),
      line.p1Id,
      line.p2Id,
      circle.centerId,
      circleId
    );
    this.addConstraint(c);
    return c;
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
      !this.arcs.has(id)
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
    } else if (this.lines.has(id)) {
      this.lines.delete(id);
      this.selection.lineIds.delete(id);
    } else if (this.circles.has(id)) {
      this.circles.delete(id);
      this.selection.circleIds.delete(id);
    } else if (this.arcs.has(id)) {
      this.arcs.delete(id);
      this.selection.arcIds.delete(id);
    }

    // Clean up orphan constraints
    for (const [cid, constraint] of this.constraints.entries()) {
      const hasMissingEntity = constraint.entityIds.some(
        entId =>
          !this.points.has(entId) &&
          !this.lines.has(entId) &&
          !this.circles.has(entId) &&
          !this.arcs.has(entId)
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
      });
    }
  }

  solve(extraConstraints: IConstraint[] = []): SolverResult {
    const activeConstraints = [...this.constraints.values(), ...extraConstraints];
    const res = this.solver.solve(this.paramManager, activeConstraints);
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
    circleId: string,
    targetRadius: number
  ): SolverResult {
    const circle = this.circles.get(circleId);
    if (!circle) return this.solve();

    circle.radius = Math.max(1, targetRadius);
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

  getConstraintsForEntity(type: 'point' | 'line' | 'circle', id: string): IConstraint[] {
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
        } else if (c.entityIds.includes(id)) {
          res.push(c);
        }
      }
    }
    return res;
  }

  selectEntity(
    id: string,
    type: 'point' | 'line' | 'circle' | 'constraint',
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
    this.constraints.clear();
    this.selection.pointIds.clear();
    this.selection.lineIds.clear();
    this.selection.circleIds.clear();
    this.selection.arcIds.clear();
    this.selection.constraintIds.clear();
    this.rebuildParamManager();
    this.solve();
  }

  clearSelection(): void {
    this.selection.pointIds.clear();
    this.selection.lineIds.clear();
    this.selection.circleIds.clear();
    this.selection.arcIds.clear();
    this.selection.constraintIds.clear();
    this.notify();
  }

  deleteSelected(): void {
    const hasSelection =
      this.selection.pointIds.size > 0 ||
      this.selection.lineIds.size > 0 ||
      this.selection.circleIds.size > 0 ||
      this.selection.arcIds.size > 0 ||
      this.selection.constraintIds.size > 0;

    if (!hasSelection) return;

    this.beginTransaction();
    const selectedPoints = [...this.selection.pointIds];
    const selectedLines = [...this.selection.lineIds];
    const selectedCircles = [...this.selection.circleIds];
    const selectedArcs = [...this.selection.arcIds];
    const selectedConstraints = [...this.selection.constraintIds];

    for (const id of selectedConstraints) this.removeConstraint(id);
    for (const id of selectedLines) this.removeEntity(id);
    for (const id of selectedCircles) this.removeEntity(id);
    for (const id of selectedArcs) this.removeEntity(id);
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


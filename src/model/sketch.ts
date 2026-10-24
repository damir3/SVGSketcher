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
	CollinearConstraint,
	PerpendicularConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
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
	SymmetryConstraint,
	CircularPatternConstraint,
	computePatternCopyAngle,
	type PatternCopyData,
	type PatternPointPair,
	type PatternRadiusPair,
	RectangularPatternConstraint,
	computeRectangularPatternOffset,
	computeRectangularPatternDirections,
	type RectangularPatternCopyData,
} from '../solver/constraints';
import type { SketchPoint, SketchLine, SketchCircle, SketchArc, SketchEllipse, SketchEllipticalArc, SketchSpline, SelectionState } from './types';
import { dist, type Vec2 } from '../math/vector';
import { bsplineToBezier, fitPointsToBezier, computeNaturalFitHandles, getSplineSvgPath, type BezierSegment } from '../math/spline';
import {
	HistoryManager,
	type SketchSnapshot,
	serializeConstraint,
	deserializeConstraint,
} from './history';

export interface SketchFileMetadata {
	format: 'svg-sketcher';
	version: number;
	generator?: string;
	createdAt?: string;
	viewport?: {
		panX: number;
		panY: number;
		zoom: number;
	};
	snapshot: SketchSnapshot;
}

export class SketchDocument {
	points = new Map<string, SketchPoint>();
	lines = new Map<string, SketchLine>();
	circles = new Map<string, SketchCircle>();
	arcs = new Map<string, SketchArc>();
	ellipses = new Map<string, SketchEllipse>();
	ellipticalArcs = new Map<string, SketchEllipticalArc>();
	splines = new Map<string, SketchSpline>();
	constraints = new Map<string, IConstraint>();

	selection: SelectionState = {
		pointIds: new Set(),
		lineIds: new Set(),
		circleIds: new Set(),
		arcIds: new Set(),
		ellipseIds: new Set(),
		ellipticalArcIds: new Set(),
		splineIds: new Set(),
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

	private counters: Map<string, number> = new Map();

	nextId(prefix: string): string {
		const isTaken = (id: string) =>
			this.points.has(id) ||
			this.lines.has(id) ||
			this.circles.has(id) ||
			this.arcs.has(id) ||
			this.ellipses.has(id) ||
			this.ellipticalArcs.has(id) ||
			this.splines.has(id) ||
			this.constraints.has(id);

		let next = (this.counters.get(prefix) ?? 0) + 1;
		while (isTaken(`${prefix}-${next}`)) {
			next++;
		}
		this.counters.set(prefix, next);
		this.idCounter++;
		return `${prefix}-${next}`;
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
			splines: Array.from(this.splines.values()).map(s => ({
				...s,
				pointIds: [...s.pointIds],
				tangentLineIds: s.tangentLineIds ? [...s.tangentLineIds] : undefined,
				knots: s.knots ? [...s.knots] : undefined,
			})),
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

		this.splines.clear();
		for (const s of snapshot.splines ?? []) {
			this.splines.set(s.id, {
				...s,
				pointIds: [...s.pointIds],
				tangentLineIds: s.tangentLineIds ? [...s.tangentLineIds] : undefined,
				knots: s.knots ? [...s.knots] : undefined,
			});
		}

		this.constraints.clear();
		for (const sc of snapshot.constraints) {
			const c = deserializeConstraint(sc);
			if (c) {
				this.constraints.set(c.id, c);
			}
		}

		this.counters.clear();
		const allIds = [
			...snapshot.points.map(p => p.id),
			...snapshot.lines.map(l => l.id),
			...snapshot.circles.map(c => c.id),
			...snapshot.arcs.map(a => a.id),
			...(snapshot.ellipses ?? []).map(e => e.id),
			...(snapshot.ellipticalArcs ?? []).map(a => a.id),
			...snapshot.constraints.map(c => c.id),
		];
		for (const id of allIds) {
			const match = id.match(/^([A-Za-z0-9_]+)[-_](\d+)$/);
			if (match) {
				const prefix = match[1];
				const num = parseInt(match[2], 10);
				const cur = this.counters.get(prefix) ?? 0;
				if (num > cur) {
					this.counters.set(prefix, num);
				}
			}
		}

		this.idCounter = snapshot.idCounter;
		this.clearSelection();
		this.rebuildParamManager();
		this.solve();
		this.notify();
	}

	// --- Point methods ---
	addPoint(x: number, y: number, fixed = false): SketchPoint {
		this.pushHistory();
		const id = this.nextId('Point');
		const pt: SketchPoint = { id, x, y, fixed };
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
		const id = this.nextId('Line');
		const line: SketchLine = { id, p1Id, p2Id, isConstruction };
		this.lines.set(id, line);
		this.rebuildParamManager();
		this.solve();
		return line;
	}

	// --- Circle methods ---
	addCircle(centerId: string, radius: number, isConstruction = false): SketchCircle {
		this.pushHistory();
		const id = this.nextId('Circle');
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
		const id = this.nextId('Arc');
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
		const id = this.nextId('Ellipse');
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
		const id = this.nextId('EllipticalArc');
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

	// --- Spline methods ---
	addFitSpline(
		pointIds: string[],
		tangentLineIds?: string[],
		isConstruction = false,
		id?: string,
		isClosed?: boolean,
		explicitHandles?: Array<{ h1: Vec2; h2: Vec2 }>
	): SketchSpline {
		this.pushHistory();
		const sid = id || this.nextId('Spline');

		const closed = isClosed ?? (
			pointIds.length >= 4 &&
			(pointIds[0] === pointIds[pointIds.length - 1] ||
				(this.points.has(pointIds[0]) &&
					this.points.has(pointIds[pointIds.length - 1]) &&
					Math.hypot(
						this.points.get(pointIds[0])!.x - this.points.get(pointIds[pointIds.length - 1])!.x,
						this.points.get(pointIds[0])!.y - this.points.get(pointIds[pointIds.length - 1])!.y
					) < 1e-4))
		);

		const actualPointIds = [...pointIds];
		if (closed && actualPointIds[0] !== actualPointIds[actualPointIds.length - 1]) {
			actualPointIds.push(actualPointIds[0]);
		}

		let actualTangentLineIds = tangentLineIds ? [...tangentLineIds] : undefined;

		// Automatically construct tangent handle lines with midpoint constraints if not provided
		if (!actualTangentLineIds || actualTangentLineIds.length === 0) {
			const pts = actualPointIds.map(pid => this.points.get(pid)).filter((p): p is SketchPoint => !!p);
			if (pts.length >= 2) {
				const handles = explicitHandles || computeNaturalFitHandles(pts);
				actualTangentLineIds = [];
				const count = closed ? pts.length - 1 : pts.length;
				for (let i = 0; i < count; i++) {
					const h = handles[i];
					const pFit = pts[i];
					const p1Id = this.nextId('Point');
					this.points.set(p1Id, { id: p1Id, x: h.h1.x, y: h.h1.y, fixed: false });
					const p2Id = this.nextId('Point');
					this.points.set(p2Id, { id: p2Id, x: h.h2.x, y: h.h2.y, fixed: false });
					const lineId = this.nextId('Line');
					const hLine: SketchLine = {
						id: lineId,
						p1Id,
						p2Id,
						isConstruction: true,
						isSplineHandle: true,
						parentSplineId: sid,
					};
					this.lines.set(lineId, hLine);
					const d1 = Math.hypot(pFit.x - h.h1.x, pFit.y - h.h1.y);
					const d2 = Math.hypot(h.h2.x - pFit.x, h.h2.y - pFit.y);
					const ratio = (d1 + d2) > 1e-6 ? d1 / (d1 + d2) : 0.5;
					const midC = new MidpointConstraint(this.nextId('c_midpoint'), pFit.id, p1Id, p2Id, 1.0, ratio);
					this.constraints.set(midC.id, midC);
					actualTangentLineIds.push(lineId);
				}
				if (closed && actualTangentLineIds.length > 0) {
					actualTangentLineIds.push(actualTangentLineIds[0]);
				}
				this.rebuildParamManager();
			}
		}

		const spline: SketchSpline = {
			id: sid,
			splineType: 'fit',
			pointIds: actualPointIds,
			tangentLineIds: actualTangentLineIds,
			isClosed: closed,
			isConstruction,
		};
		this.splines.set(sid, spline);

		if (actualTangentLineIds) {
			for (const lid of actualTangentLineIds) {
				const line = this.lines.get(lid);
				if (line) {
					line.parentSplineId = sid;
					line.isSplineHandle = true;
				}
			}
		}

		this.notify();
		return spline;
	}

	addControlSpline(
		pointIds: string[],
		isConstruction = false,
		id?: string,
		_isClosed?: boolean,
		knots?: number[]
	): SketchSpline {
		this.pushHistory();
		const sid = id || this.nextId('Spline');

		const actualPointIds = [...pointIds];

		const spline: SketchSpline = {
			id: sid,
			splineType: 'control',
			pointIds: actualPointIds,
			knots: knots ? [...knots] : undefined,
			isClosed: false,
			isConstruction,
		};
		this.splines.set(sid, spline);
		this.notify();
		return spline;
	}

	getSpline(id: string): SketchSpline | undefined {
		return this.splines.get(id);
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
		if (this.isSplineInternalConstraint(c)) return;
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
		for (const c of this.constraints.values()) {
			if (c instanceof FixedConstraint && c.pointId === pointId) {
				pt.fixed = true;
				return c;
			}
		}
		this.pushHistory();
		pt.fixed = true;
		const c = new FixedConstraint(this.nextId('c_fix'), pointId, pt.x, pt.y);
		this.constraints.set(c.id, c);
		this.rebuildParamManager();
		this.solve();
		return c;
	}

	removeFixedConstraint(pointId: string): boolean {
		const pt = this.points.get(pointId);
		let hasFix = false;
		for (const c of this.constraints.values()) {
			if (c instanceof FixedConstraint && c.pointId === pointId) {
				hasFix = true;
				break;
			}
		}
		if (!hasFix && (!pt || !pt.fixed)) {
			return false;
		}

		this.pushHistory();
		for (const [id, c] of [...this.constraints.entries()]) {
			if (c instanceof FixedConstraint && c.pointId === pointId) {
				this.constraints.delete(id);
				this.selection.constraintIds.delete(id);
			}
		}
		if (pt) {
			pt.fixed = false;
		}
		this.rebuildParamManager();
		this.solve();
		return true;
	}

	toggleFixedConstraint(pointId: string): boolean {
		if (this.isPointFixed(pointId)) {
			this.removeFixedConstraint(pointId);
			return false;
		} else {
			this.addFixedConstraint(pointId);
			return true;
		}
	}

	toggleFixedConstraints(pointIds: string[]): boolean {
		const validPointIds = pointIds.filter(pid => this.points.has(pid));
		if (validPointIds.length === 0) return false;

		this.beginTransaction();
		const allFixed = validPointIds.every(pid => this.isPointFixed(pid));
		if (allFixed) {
			for (const pid of validPointIds) {
				this.removeFixedConstraint(pid);
			}
		} else {
			for (const pid of validPointIds) {
				if (!this.isPointFixed(pid)) {
					this.addFixedConstraint(pid);
				}
			}
		}
		this.commitTransaction();
		return !allFixed;
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
		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof HorizontalConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
		);
		if (existing) return existing as HorizontalConstraint;

		const c = new HorizontalConstraint(this.nextId('c_horiz'), p1Id, p2Id);
		this.addConstraint(c);
		return c;
	}

	addVerticalConstraint(p1Id: string, p2Id: string): VerticalConstraint {
		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof VerticalConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
		);
		if (existing) return existing as VerticalConstraint;

		const c = new VerticalConstraint(this.nextId('c_vert'), p1Id, p2Id);
		this.addConstraint(c);
		return c;
	}

	getDistanceConstraint(
		p1Id: string,
		p2Id: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): DistanceConstraint | undefined {
		for (const c of this.constraints.values()) {
			if (
				c instanceof DistanceConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id))
			) {
				if (!orientation || (c.orientation ?? 'aligned') === orientation) {
					return c;
				}
			}
		}
		return undefined;
	}

	hasDistanceConstraint(
		p1Id: string,
		p2Id: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): boolean {
		return this.getDistanceConstraint(p1Id, p2Id, orientation) !== undefined;
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

		const effectiveOrientation = orientation ?? 'aligned';

		// Prevent duplicate identical distance constraints
		const existing = this.getDistanceConstraint(p1Id, p2Id, effectiveOrientation);
		if (existing) {
			let changed = false;
			if (offset !== undefined && existing.offset !== offset) {
				existing.offset = offset;
			}
			if (targetDist !== undefined && existing.targetDistance !== targetDist) {
				this.pushHistory();
				existing.targetDistance = targetDist;
				existing.value = targetDist;
				changed = true;
			}
			if (changed) {
				this.solve();
			}
			return existing;
		}

		let measured = dist(p1, p2);
		if (effectiveOrientation === 'horizontal') {
			measured = Math.abs(p2.x - p1.x);
		} else if (effectiveOrientation === 'vertical') {
			measured = Math.abs(p2.y - p1.y);
		}

		const currentDist = targetDist ?? Math.max(0.01, Number(measured.toFixed(2)));
		const c = new DistanceConstraint(this.nextId('c_dist'), p1Id, p2Id, currentDist, 1.0, offset, effectiveOrientation);
		this.addConstraint(c);
		return c;
	}

	getPointToLineDistanceConstraint(pointId: string, lineId: string): PointToLineDistanceConstraint | undefined {
		for (const c of this.constraints.values()) {
			if (c instanceof PointToLineDistanceConstraint && c.pointId === pointId && c.lineId === lineId) {
				return c;
			}
		}
		return undefined;
	}

	hasPointToLineDistanceConstraint(pointId: string, lineId: string): boolean {
		return this.getPointToLineDistanceConstraint(pointId, lineId) !== undefined;
	}

	addPointToLineDistanceConstraint(
		pointId: string,
		lineId: string,
		targetDist?: number,
		offset?: number
	): PointToLineDistanceConstraint | null {
		const pt = this.points.get(pointId);
		const line = this.lines.get(lineId);
		if (!pt || !line) return null;
		if (pointId === line.p1Id || pointId === line.p2Id) return null;

		const p1 = this.points.get(line.p1Id);
		const p2 = this.points.get(line.p2Id);
		if (!p1 || !p2) return null;

		const existing = this.getPointToLineDistanceConstraint(pointId, lineId);
		if (existing) {
			let changed = false;
			if (offset !== undefined && existing.offset !== offset) {
				existing.offset = offset;
			}
			if (targetDist !== undefined && existing.targetDistance !== targetDist) {
				this.pushHistory();
				existing.targetDistance = targetDist;
				existing.value = targetDist;
				changed = true;
			}
			if (changed) {
				this.solve();
			}
			return existing;
		}

		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const lineLen = Math.max(Math.hypot(dx, dy), 1e-7);
		const cross = (pt.x - p1.x) * dy - (pt.y - p1.y) * dx;
		const measured = Math.abs(cross) / lineLen;
		const side = cross >= 0 ? 1 : -1;

		const currentDist = targetDist ?? Math.max(0.01, Number(measured.toFixed(2)));
		const c = new PointToLineDistanceConstraint(
			this.nextId('c_pt_line_dist'),
			pointId,
			lineId,
			line.p1Id,
			line.p2Id,
			currentDist,
			side,
			1.0,
			offset
		);
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

		// Check if an angle constraint already exists between these two lines
		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof AngleConstraint &&
				((c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id))
		) as AngleConstraint | undefined;
		if (existing) {
			if (arcRadius !== undefined && existing.arcRadius !== arcRadius) {
				existing.arcRadius = arcRadius;
			}
			if (targetAngleDeg !== undefined && existing.targetAngle !== targetAngleDeg) {
				this.pushHistory();
				existing.targetAngle = targetAngleDeg;
				existing.value = targetAngleDeg;
				this.solve();
			}
			return existing;
		}

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

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof EqualLengthConstraint &&
				((this.matchesEndpoints(c.line1P1, c.line1P2, l1.p1Id, l1.p2Id) && this.matchesEndpoints(c.line2P1, c.line2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.line1P1, c.line1P2, l2.p1Id, l2.p2Id) && this.matchesEndpoints(c.line2P1, c.line2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as EqualLengthConstraint;

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
		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof EqualRadiusConstraint &&
				((c.circle1Id === circle1Id && c.circle2Id === circle2Id) ||
					(c.circle1Id === circle2Id && c.circle2Id === circle1Id))
		);
		if (existing) return existing as EqualRadiusConstraint;

		const c = new EqualRadiusConstraint(this.nextId('c_eqrad'), circle1Id, circle2Id);
		this.addConstraint(c);
		return c;
	}

	addParallelConstraint(line1Id: string, line2Id: string): ParallelConstraint | null {
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof ParallelConstraint &&
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as ParallelConstraint;

		const c = new ParallelConstraint(this.nextId('c_par'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
		this.addConstraint(c);
		return c;
	}

	addCollinearConstraint(line1Id: string, line2Id: string): CollinearConstraint | null {
		if (line1Id === line2Id) return null;
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof CollinearConstraint &&
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as CollinearConstraint;

		const c = new CollinearConstraint(this.nextId('c_collin'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
		this.addConstraint(c);
		return c;
	}

	addSymmetryConstraint(p1Id: string, p2Id: string, lineId: string): SymmetryConstraint | null {
		if (p1Id === p2Id) return null;
		if (!this.points.has(p1Id) || !this.points.has(p2Id)) return null;
		const line = this.lines.get(lineId);
		if (!line) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof SymmetryConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id)) &&
				this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id)
		);
		if (existing) return existing as SymmetryConstraint;

		const c = new SymmetryConstraint(
			this.nextId('c_symm'),
			p1Id,
			p2Id,
			line.p1Id,
			line.p2Id,
			1.0,
			line.id
		);
		this.addConstraint(c);
		return c;
	}

	generatePatternCopy(
		centerPtId: string,
		sourceObjectIds: string[],
		copyIndex: number,
		quantity: number,
		distribution: 'full' | 'partial' | 'symmetric',
		totalAngle: number
	): PatternCopyData | null {
		const centerPt = this.points.get(centerPtId);
		if (!centerPt) return null;

		const angleDeg = computePatternCopyAngle(copyIndex, quantity, distribution, totalAngle);
		const rad = (angleDeg * Math.PI) / 180;
		const cosA = Math.cos(rad);
		const sinA = Math.sin(rad);

		const pointMap = new Map<string, string>();
		const pointPairs: PatternPointPair[] = [];
		const radiusPairs: PatternRadiusPair[] = [];
		const createdEntityIds: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
		}> = [];

		const getOrRotatePoint = (origPtId: string): string => {
			if (pointMap.has(origPtId)) return pointMap.get(origPtId)!;
			if (origPtId === centerPtId) {
				pointMap.set(origPtId, centerPtId);
				return centerPtId;
			}
			const pt = this.points.get(origPtId);
			if (!pt) return origPtId;

			const distToCenter = Math.hypot(pt.x - centerPt.x, pt.y - centerPt.y);
			if (distToCenter < 1e-3) {
				pointMap.set(origPtId, centerPtId);
				return centerPtId;
			}

			const dx = pt.x - centerPt.x;
			const dy = pt.y - centerPt.y;
			const rx = centerPt.x + dx * cosA - dy * sinA;
			const ry = centerPt.y + dx * sinA + dy * cosA;

			const newPt = this.addPoint(rx, ry, false);
			pointMap.set(origPtId, newPt.id);
			pointPairs.push({ sourcePtId: origPtId, patternPtId: newPt.id });
			createdEntityIds.push({ id: newPt.id, type: 'point' });
			return newPt.id;
		};

		for (const objId of sourceObjectIds) {
			const line = this.lines.get(objId);
			if (line) {
				const np1Id = getOrRotatePoint(line.p1Id);
				const np2Id = getOrRotatePoint(line.p2Id);
				if (np1Id !== np2Id) {
					const newLine = this.addLine(np1Id, np2Id, line.isConstruction);
					createdEntityIds.push({ id: newLine.id, type: 'line' });
				}
				continue;
			}

			const circle = this.circles.get(objId);
			if (circle) {
				const nCenterId = getOrRotatePoint(circle.centerId);
				const newCircle = this.addCircle(nCenterId, circle.radius, circle.isConstruction);
				radiusPairs.push({ sourceCircleId: circle.id, patternCircleId: newCircle.id });
				createdEntityIds.push({ id: newCircle.id, type: 'circle' });
				continue;
			}

			const arc = this.arcs.get(objId);
			if (arc) {
				const nCenterId = getOrRotatePoint(arc.centerId);
				const nStartId = getOrRotatePoint(arc.startPointId);
				const nEndId = getOrRotatePoint(arc.endPointId);
				const newArc = this.addArc(
					nCenterId,
					nStartId,
					nEndId,
					arc.radius,
					arc.clockwise,
					arc.isConstruction
				);
				radiusPairs.push({ sourceCircleId: arc.id, patternCircleId: newArc.id });
				createdEntityIds.push({ id: newArc.id, type: 'arc' });
				continue;
			}

			const ellipse = this.ellipses.get(objId);
			if (ellipse) {
				const nCenterId = getOrRotatePoint(ellipse.centerId);
				const nMajorId = getOrRotatePoint(ellipse.majorAxisPointId);
				const nMinorId = getOrRotatePoint(ellipse.minorAxisPointId);
				const newEllipse = this.addEllipse(
					nCenterId,
					nMajorId,
					nMinorId,
					ellipse.isConstruction
				);
				createdEntityIds.push({ id: newEllipse.id, type: 'ellipse' });
				continue;
			}

			const elArc = this.ellipticalArcs.get(objId);
			if (elArc) {
				const nCenterId = getOrRotatePoint(elArc.centerId);
				const nMajorId = getOrRotatePoint(elArc.majorAxisPointId);
				const nMinorId = getOrRotatePoint(elArc.minorAxisPointId);
				const nStartId = getOrRotatePoint(elArc.startPointId);
				const nEndId = getOrRotatePoint(elArc.endPointId);
				const newElArc = this.addEllipticalArc(
					nCenterId,
					nMajorId,
					nMinorId,
					nStartId,
					nEndId,
					elArc.clockwise,
					elArc.isConstruction
				);
				createdEntityIds.push({ id: newElArc.id, type: 'elliptical_arc' });
				continue;
			}

			const pt = this.points.get(objId);
			if (pt) {
				getOrRotatePoint(pt.id);
				continue;
			}
		}

		return {
			copyIndex,
			pointPairs,
			radiusPairs,
			createdEntityIds,
		};
	}

	deletePatternCopy(copy: PatternCopyData): void {
		for (const item of copy.createdEntityIds) {
			if (item.type === 'line') this.lines.delete(item.id);
			else if (item.type === 'circle') this.circles.delete(item.id);
			else if (item.type === 'arc') this.arcs.delete(item.id);
			else if (item.type === 'ellipse') this.ellipses.delete(item.id);
			else if (item.type === 'elliptical_arc') this.ellipticalArcs.delete(item.id);
			else if (item.type === 'point') this.points.delete(item.id);

			this.selection.pointIds.delete(item.id);
			this.selection.lineIds.delete(item.id);
			this.selection.circleIds.delete(item.id);
			this.selection.arcIds.delete(item.id);
			this.selection.ellipseIds.delete(item.id);
			this.selection.ellipticalArcIds.delete(item.id);
		}
	}

	addCircularPatternConstraint(
		centerPtId: string,
		sourceObjectIds: string[],
		distribution: 'full' | 'partial' | 'symmetric',
		totalAngle: number,
		quantity: number,
		suppression: boolean,
		suppressedIndices: number[],
		copies: PatternCopyData[],
		id?: string,
		isReadOnly?: boolean
	): CircularPatternConstraint | null {
		if (!this.points.has(centerPtId)) return null;

		const cid = id || this.nextId('c_cpat');
		const c = new CircularPatternConstraint(
			cid,
			centerPtId,
			sourceObjectIds,
			distribution,
			totalAngle,
			quantity,
			suppression,
			suppressedIndices,
			copies,
			1.0,
			isReadOnly
		);
		this.addConstraint(c);
		return c;
	}

	updateCircularPattern(
		constraintId: string,
		updates: {
			distribution?: 'full' | 'partial' | 'symmetric';
			totalAngle?: number;
			quantity?: number;
			suppression?: boolean;
			suppressedIndices?: number[];
		}
	): boolean {
		const c = this.constraints.get(constraintId);
		if (!c || !(c instanceof CircularPatternConstraint) || c.isReadOnly) return false;

		this.beginTransaction();

		const oldDist = c.distribution;
		const oldAngle = c.totalAngle;
		const oldQty = c.quantity;
		const oldSuppression = c.suppression;
		const oldSuppressed = new Set(c.suppressedIndices);

		const newDist = updates.distribution ?? oldDist;
		const newAngle = updates.totalAngle !== undefined ? updates.totalAngle : oldAngle;
		const newQty = updates.quantity !== undefined ? Math.max(2, Math.round(updates.quantity)) : oldQty;
		const newSuppression = updates.suppression !== undefined ? updates.suppression : oldSuppression;
		const newSuppressed = updates.suppressedIndices !== undefined ? new Set(updates.suppressedIndices) : oldSuppressed;

		c.distribution = newDist;
		c.totalAngle = newAngle;
		c.quantity = newQty;
		c.suppression = newSuppression;
		c.suppressedIndices = Array.from(newSuppressed);

		// 1. Delete excess copies if quantity decreased
		for (let i = c.copies.length - 1; i >= 0; i--) {
			const copy = c.copies[i];
			if (copy.copyIndex >= newQty) {
				this.deletePatternCopy(copy);
				c.copies.splice(i, 1);
			}
		}

		// 2. Add or remove copies based on quantity and suppression
		for (let k = 1; k < newQty; k++) {
			const shouldBeSuppressed = newSuppression && newSuppressed.has(k);
			const existingIndex = c.copies.findIndex(cp => cp.copyIndex === k);

			if (shouldBeSuppressed) {
				if (existingIndex >= 0) {
					this.deletePatternCopy(c.copies[existingIndex]);
					c.copies.splice(existingIndex, 1);
				}
			} else {
				if (existingIndex < 0) {
					const newCopy = this.generatePatternCopy(
						c.centerPtId,
						c.sourceObjectIds,
						k,
						newQty,
						newDist,
						newAngle
					);
					if (newCopy) {
						c.copies.push(newCopy);
					}
				}
			}
		}

		// 3. Update coordinates of existing copies to new angle/distribution positions
		const centerPt = this.points.get(c.centerPtId);
		if (centerPt) {
			for (const copy of c.copies) {
				const aDeg = computePatternCopyAngle(copy.copyIndex, newQty, newDist, newAngle);
				const rad = (aDeg * Math.PI) / 180;
				const cosA = Math.cos(rad);
				const sinA = Math.sin(rad);

				for (const pair of copy.pointPairs) {
					const sPt = this.points.get(pair.sourcePtId);
					const pPt = this.points.get(pair.patternPtId);
					if (sPt && pPt) {
						const dx = sPt.x - centerPt.x;
						const dy = sPt.y - centerPt.y;
						pPt.x = centerPt.x + dx * cosA - dy * sinA;
						pPt.y = centerPt.y + dx * sinA + dy * cosA;
					}
				}
			}
		}

		// 4. Update pointIds on BaseConstraint
		const pointIdSet = new Set<string>();
		pointIdSet.add(c.centerPtId);
		for (const copy of c.copies) {
			for (const pair of copy.pointPairs) {
				pointIdSet.add(pair.sourcePtId);
				pointIdSet.add(pair.patternPtId);
			}
		}
		(c as any).entityIds = Array.from(pointIdSet);

		this.rebuildParamManager();
		this.solve();
		this.commitTransaction();
		return true;
	}

	addPolygon(
		centerPointId: string,
		inradius: number,
		sides: number,
		angleRad: number,
		isConstruction = false,
		addDistanceConstraint = false
	): {
		centerPoint: SketchPoint;
		vertices: SketchPoint[];
		lines: SketchLine[];
		constraint: CircularPatternConstraint;
		distanceConstraint?: PointToLineDistanceConstraint;
	} | null {
		const centerPt = this.points.get(centerPointId);
		if (!centerPt) return null;

		const N = Math.max(3, Math.round(sides));
		if (inradius <= 1e-4) return null;

		this.beginTransaction();

		const R = inradius / Math.cos(Math.PI / N);
		const baseAngle = angleRad - Math.PI / N;
		const step = (2 * Math.PI) / N;

		const vertices: SketchPoint[] = [];
		for (let k = 0; k < N; k++) {
			const a = baseAngle + k * step;
			const vx = centerPt.x + R * Math.cos(a);
			const vy = centerPt.y + R * Math.sin(a);
			const pt = this.addPoint(vx, vy, false);
			vertices.push(pt);
		}

		const lines: SketchLine[] = [];
		for (let k = 0; k < N; k++) {
			const nextK = (k + 1) % N;
			const line = this.addLine(vertices[k].id, vertices[nextK].id, isConstruction);
			lines.push(line);
		}

		const copies: PatternCopyData[] = [];
		for (let k = 1; k < N; k++) {
			copies.push({
				copyIndex: k,
				pointPairs: [{ sourcePtId: vertices[0].id, patternPtId: vertices[k].id }],
				createdEntityIds: [{ id: vertices[k].id, type: 'point' }],
			});
		}

		const constraint = this.addCircularPatternConstraint(
			centerPointId,
			[vertices[0].id],
			'full',
			360,
			N,
			false,
			[],
			copies,
			undefined,
			true // isReadOnly
		);

		let distanceConstraint: PointToLineDistanceConstraint | undefined;
		if (addDistanceConstraint && lines.length > 0) {
			const distC = this.addPointToLineDistanceConstraint(centerPointId, lines[0].id, inradius);
			if (distC) distanceConstraint = distC;
		}

		this.commitTransaction();
		this.solve();

		if (!constraint) return null;

		return {
			centerPoint: centerPt,
			vertices,
			lines,
			constraint,
			distanceConstraint,
		};
	}

	generateRectangularPatternCopy(
		sourceObjectIds: string[],
		i: number,
		j: number,
		distance1: number,
		direction1: 'one_direction' | 'symmetric',
		distance2: number,
		direction2: 'one_direction' | 'symmetric',
		u1: { x: number; y: number },
		u2: { x: number; y: number }
	): RectangularPatternCopyData | null {
		const offset = computeRectangularPatternOffset(i, j, distance1, direction1, distance2, direction2, u1, u2);
		const pointMap = new Map<string, string>();
		const pointPairs: PatternPointPair[] = [];
		const radiusPairs: PatternRadiusPair[] = [];
		const createdEntityIds: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
		}> = [];

		const getOrTranslatePoint = (origPtId: string): string => {
			if (pointMap.has(origPtId)) return pointMap.get(origPtId)!;
			const pt = this.points.get(origPtId);
			if (!pt) return origPtId;

			const tx = pt.x + offset.dx;
			const ty = pt.y + offset.dy;

			const newPt = this.addPoint(tx, ty, false);
			pointMap.set(origPtId, newPt.id);
			pointPairs.push({ sourcePtId: origPtId, patternPtId: newPt.id });
			createdEntityIds.push({ id: newPt.id, type: 'point' });
			return newPt.id;
		};

		for (const objId of sourceObjectIds) {
			const line = this.lines.get(objId);
			if (line) {
				const np1Id = getOrTranslatePoint(line.p1Id);
				const np2Id = getOrTranslatePoint(line.p2Id);
				if (np1Id !== np2Id) {
					const newLine = this.addLine(np1Id, np2Id, line.isConstruction);
					createdEntityIds.push({ id: newLine.id, type: 'line' });
				}
				continue;
			}

			const circle = this.circles.get(objId);
			if (circle) {
				const nCenterId = getOrTranslatePoint(circle.centerId);
				const newCircle = this.addCircle(nCenterId, circle.radius, circle.isConstruction);
				radiusPairs.push({ sourceCircleId: circle.id, patternCircleId: newCircle.id });
				createdEntityIds.push({ id: newCircle.id, type: 'circle' });
				continue;
			}

			const arc = this.arcs.get(objId);
			if (arc) {
				const nCenterId = getOrTranslatePoint(arc.centerId);
				const nStartId = getOrTranslatePoint(arc.startPointId);
				const nEndId = getOrTranslatePoint(arc.endPointId);
				const newArc = this.addArc(
					nCenterId,
					nStartId,
					nEndId,
					arc.radius,
					arc.clockwise,
					arc.isConstruction
				);
				radiusPairs.push({ sourceCircleId: arc.id, patternCircleId: newArc.id });
				createdEntityIds.push({ id: newArc.id, type: 'arc' });
				continue;
			}

			const ellipse = this.ellipses.get(objId);
			if (ellipse) {
				const nCenterId = getOrTranslatePoint(ellipse.centerId);
				const nMajorId = getOrTranslatePoint(ellipse.majorAxisPointId);
				const nMinorId = getOrTranslatePoint(ellipse.minorAxisPointId);
				const newEllipse = this.addEllipse(
					nCenterId,
					nMajorId,
					nMinorId,
					ellipse.isConstruction
				);
				createdEntityIds.push({ id: newEllipse.id, type: 'ellipse' });
				continue;
			}

			const elArc = this.ellipticalArcs.get(objId);
			if (elArc) {
				const nCenterId = getOrTranslatePoint(elArc.centerId);
				const nMajorId = getOrTranslatePoint(elArc.majorAxisPointId);
				const nMinorId = getOrTranslatePoint(elArc.minorAxisPointId);
				const nStartId = getOrTranslatePoint(elArc.startPointId);
				const nEndId = getOrTranslatePoint(elArc.endPointId);
				const newElArc = this.addEllipticalArc(
					nCenterId,
					nMajorId,
					nMinorId,
					nStartId,
					nEndId,
					elArc.clockwise,
					elArc.isConstruction
				);
				createdEntityIds.push({ id: newElArc.id, type: 'elliptical_arc' });
				continue;
			}

			const pt = this.points.get(objId);
			if (pt) {
				getOrTranslatePoint(pt.id);
				continue;
			}
		}

		return {
			copyIndex: i * 1000 + j,
			i,
			j,
			pointPairs,
			radiusPairs,
			createdEntityIds,
		};
	}

	addRectangularPatternConstraint(
		sourceObjectIds: string[],
		line1Id: string | null,
		line2Id: string | null,
		quantity1: number,
		distance1: number,
		direction1: 'one_direction' | 'symmetric',
		quantity2: number,
		distance2: number,
		direction2: 'one_direction' | 'symmetric',
		suppression: boolean,
		suppressedIndices: number[],
		copies: RectangularPatternCopyData[],
		id?: string
	): RectangularPatternConstraint | null {
		const line1 = line1Id ? this.lines.get(line1Id) : null;
		const line2 = line2Id ? this.lines.get(line2Id) : null;

		const cid = id || this.nextId('c_rpat');
		const c = new RectangularPatternConstraint(
			cid,
			sourceObjectIds,
			line1Id,
			line1?.p1Id,
			line1?.p2Id,
			line2Id,
			line2?.p1Id,
			line2?.p2Id,
			quantity1,
			distance1,
			direction1,
			quantity2,
			distance2,
			direction2,
			suppression,
			suppressedIndices,
			copies,
			1.0
		);
		this.addConstraint(c);
		return c;
	}

	updateRectangularPattern(
		constraintId: string,
		updates: {
			line1Id?: string | null;
			line2Id?: string | null;
			quantity1?: number;
			distance1?: number;
			direction1?: 'one_direction' | 'symmetric';
			quantity2?: number;
			distance2?: number;
			direction2?: 'one_direction' | 'symmetric';
			suppression?: boolean;
			suppressedIndices?: number[];
		}
	): boolean {
		const c = this.constraints.get(constraintId);
		if (!c || !(c instanceof RectangularPatternConstraint)) return false;

		this.beginTransaction();

		const newLine1Id = updates.line1Id !== undefined ? updates.line1Id : c.line1Id;
		const newLine2Id = updates.line2Id !== undefined ? updates.line2Id : c.line2Id;
		const newQty1 = updates.quantity1 !== undefined ? Math.max(1, Math.round(updates.quantity1)) : c.quantity1;
		const newDist1 = updates.distance1 !== undefined ? updates.distance1 : c.distance1;
		const newDir1 = updates.direction1 !== undefined ? updates.direction1 : c.direction1;
		const newQty2 = updates.quantity2 !== undefined ? Math.max(1, Math.round(updates.quantity2)) : c.quantity2;
		const newDist2 = updates.distance2 !== undefined ? updates.distance2 : c.distance2;
		const newDir2 = updates.direction2 !== undefined ? updates.direction2 : c.direction2;
		const newSuppression = updates.suppression !== undefined ? updates.suppression : c.suppression;
		const newSuppressed = updates.suppressedIndices !== undefined ? new Set(updates.suppressedIndices) : new Set(c.suppressedIndices);

		const line1 = newLine1Id ? this.lines.get(newLine1Id) : null;
		const line2 = newLine2Id ? this.lines.get(newLine2Id) : null;

		c.line1Id = newLine1Id;
		c.line1P1Id = line1?.p1Id ?? null;
		c.line1P2Id = line1?.p2Id ?? null;
		c.line2Id = newLine2Id;
		c.line2P1Id = line2?.p1Id ?? null;
		c.line2P2Id = line2?.p2Id ?? null;
		c.quantity1 = newQty1;
		c.distance1 = newDist1;
		c.direction1 = newDir1;
		c.quantity2 = newQty2;
		c.distance2 = newDist2;
		c.direction2 = newDir2;
		c.suppression = newSuppression;
		c.suppressedIndices = Array.from(newSuppressed);

		const paramMap = new Map<string, number>();
		for (const [pid, pt] of this.points.entries()) {
			paramMap.set(`${pid}.x`, pt.x);
			paramMap.set(`${pid}.y`, pt.y);
		}
		const { u1, u2 } = computeRectangularPatternDirections(
			paramMap,
			line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
			line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
		);

		const maxI = Math.abs(newDist1) > 1e-6 ? newQty1 : 1;
		const maxJ = Math.abs(newDist2) > 1e-6 ? newQty2 : 1;

		const neededKeys = new Map<number, { i: number; j: number }>();
		for (let i = 0; i < maxI; i++) {
			for (let j = 0; j < maxJ; j++) {
				if (i === 0 && j === 0) continue;
				const key = i * 1000 + j;
				if (newSuppression && newSuppressed.has(key)) continue;
				neededKeys.set(key, { i, j });
			}
		}

		// 1. Remove copies that are no longer needed
		for (let idx = c.copies.length - 1; idx >= 0; idx--) {
			const copy = c.copies[idx];
			if (!neededKeys.has(copy.copyIndex)) {
				this.deletePatternCopy(copy);
				c.copies.splice(idx, 1);
			}
		}

		// 2. Add newly needed copies
		for (const [key, coords] of neededKeys.entries()) {
			const existingIndex = c.copies.findIndex(cp => cp.copyIndex === key);
			if (existingIndex < 0) {
				const newCopy = this.generateRectangularPatternCopy(
					c.sourceObjectIds,
					coords.i,
					coords.j,
					newDist1,
					newDir1,
					newDist2,
					newDir2,
					u1,
					u2
				);
				if (newCopy) {
					c.copies.push(newCopy);
				}
			}
		}

		// 3. Update coordinates of existing copies
		for (const copy of c.copies) {
			const offset = computeRectangularPatternOffset(
				copy.i,
				copy.j,
				newDist1,
				newDir1,
				newDist2,
				newDir2,
				u1,
				u2
			);
			for (const pair of copy.pointPairs) {
				const sPt = this.points.get(pair.sourcePtId);
				const pPt = this.points.get(pair.patternPtId);
				if (sPt && pPt) {
					pPt.x = sPt.x + offset.dx;
					pPt.y = sPt.y + offset.dy;
				}
			}
		}

		// 4. Update entityIds on BaseConstraint
		const entityIdSet = new Set<string>();
		if (c.line1P1Id) entityIdSet.add(c.line1P1Id);
		if (c.line1P2Id) entityIdSet.add(c.line1P2Id);
		if (c.line2P1Id) entityIdSet.add(c.line2P1Id);
		if (c.line2P2Id) entityIdSet.add(c.line2P2Id);
		for (const copy of c.copies) {
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
		(c as any).entityIds = Array.from(entityIdSet);

		this.rebuildParamManager();
		this.solve();
		this.commitTransaction();
		return true;
	}

	addPerpendicularConstraint(line1Id: string, line2Id: string): PerpendicularConstraint | null {
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof PerpendicularConstraint &&
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) && this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as PerpendicularConstraint;

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

	addTangentConstraint(
		entity1Id: string,
		entity2Id: string
	): TangentLineCircleConstraint | TangentCircleCircleConstraint | null {
		const line1 = this.lines.get(entity1Id);
		const line2 = this.lines.get(entity2Id);
		const circ1 = this.circles.get(entity1Id) ?? this.arcs.get(entity1Id);
		const circ2 = this.circles.get(entity2Id) ?? this.arcs.get(entity2Id);

		// Case 1: Line and Circle/Arc
		if ((line1 && circ2) || (line2 && circ1)) {
			const line = line1 ?? line2!;
			const circ = circ2 ?? circ1!;

			const existing = [...this.constraints.values()].find(
				c =>
					c instanceof TangentLineCircleConstraint &&
					c.circleId === circ.id &&
					this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id)
			);
			if (existing) return existing as TangentLineCircleConstraint;

			const c = new TangentLineCircleConstraint(
				this.nextId('c_tang'),
				line.p1Id,
				line.p2Id,
				circ.centerId,
				circ.id,
				this.getTangentSide(line, circ.centerId)
			);
			this.addConstraint(c);
			return c;
		}

		// Case 2: Circle/Arc and Circle/Arc
		if (circ1 && circ2 && circ1.id !== circ2.id) {
			const existing = [...this.constraints.values()].find(
				c =>
					c instanceof TangentCircleCircleConstraint &&
					((c.circle1Id === circ1.id && c.circle2Id === circ2.id) ||
						(c.circle1Id === circ2.id && c.circle2Id === circ1.id))
			);
			if (existing) return existing as TangentCircleCircleConstraint;

			const center1 = this.points.get(circ1.centerId);
			const center2 = this.points.get(circ2.centerId);
			if (!center1 || !center2) return null;

			const d = dist(center1, center2);
			const r1 = circ1.radius;
			const r2 = circ2.radius;

			const errExt = Math.abs(d - (r1 + r2));
			const errInt = Math.abs(d - Math.abs(r1 - r2));

			const isInternal = errInt < errExt;
			let outerCircleId: string | null = null;
			if (isInternal) {
				outerCircleId = r1 >= r2 ? circ1.id : circ2.id;
			}

			const c = new TangentCircleCircleConstraint(
				this.nextId('c_tang'),
				circ1.centerId,
				circ1.id,
				circ2.centerId,
				circ2.id,
				isInternal,
				outerCircleId
			);
			this.addConstraint(c);
			return c;
		}

		return null;
	}

	addCircleTangentConstraint(c1Id: string, c2Id: string): TangentCircleCircleConstraint | null {
		const res = this.addTangentConstraint(c1Id, c2Id);
		return res instanceof TangentCircleCircleConstraint ? res : null;
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

	// Helper: check if a point is used by any remaining primitive
	isPointUsed(pointId: string): boolean {
		for (const line of this.lines.values()) {
			if (line.p1Id === pointId || line.p2Id === pointId) return true;
		}
		for (const circle of this.circles.values()) {
			if (circle.centerId === pointId) return true;
		}
		for (const arc of this.arcs.values()) {
			if (arc.centerId === pointId || arc.startPointId === pointId || arc.endPointId === pointId) return true;
		}
		for (const el of this.ellipses.values()) {
			if (el.centerId === pointId || el.majorAxisPointId === pointId || el.minorAxisPointId === pointId) return true;
		}
		for (const elarc of this.ellipticalArcs.values()) {
			if (
				elarc.centerId === pointId ||
				elarc.majorAxisPointId === pointId ||
				elarc.minorAxisPointId === pointId ||
				elarc.startPointId === pointId ||
				elarc.endPointId === pointId
			) {
				return true;
			}
		}
		for (const spline of this.splines.values()) {
			if (spline.pointIds.includes(pointId)) return true;
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const line = this.lines.get(lid);
					if (line && (line.p1Id === pointId || line.p2Id === pointId)) return true;
				}
			}
		}
		return false;
	}

	isSplineHandleLine(lineId: string): boolean {
		const line = this.lines.get(lineId);
		return !!line?.isSplineHandle;
	}

	isSplineHandlePoint(pointId: string): boolean {
		for (const line of this.lines.values()) {
			if (line.isSplineHandle && (line.p1Id === pointId || line.p2Id === pointId)) {
				return true;
			}
		}
		return false;
	}

	isSplineInternalConstraint(c: IConstraint): boolean {
		if (c instanceof MidpointConstraint || c.type === 'midpoint') {
			const anyC = c as any;
			for (const line of this.lines.values()) {
				if (
					line.isSplineHandle &&
					((line.p1Id === anyC.p1Id && line.p2Id === anyC.p2Id) ||
						(line.p1Id === anyC.p2Id && line.p2Id === anyC.p1Id))
				) {
					return true;
				}
			}
		}
		return false;
	}

	getPrimitivePointIds(primitiveId: string): string[] {
		const line = this.lines.get(primitiveId);
		if (line) return [line.p1Id, line.p2Id];

		const circle = this.circles.get(primitiveId);
		if (circle) return [circle.centerId];

		const arc = this.arcs.get(primitiveId);
		if (arc) return [arc.centerId, arc.startPointId, arc.endPointId];

		const el = this.ellipses.get(primitiveId);
		if (el) return [el.centerId, el.majorAxisPointId, el.minorAxisPointId];

		const elarc = this.ellipticalArcs.get(primitiveId);
		if (elarc) return [elarc.centerId, elarc.majorAxisPointId, elarc.minorAxisPointId, elarc.startPointId, elarc.endPointId];

		const spline = this.splines.get(primitiveId);
		if (spline) {
			const pts = [...spline.pointIds];
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const l = this.lines.get(lid);
					if (l) pts.push(l.p1Id, l.p2Id);
				}
			}
			return pts;
		}

		return [];
	}

	cleanOrphanConstraints(): void {
		for (const [cid, constraint] of this.constraints.entries()) {
			if (constraint instanceof CircularPatternConstraint) {
				if (!this.points.has(constraint.centerPtId)) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
					continue;
				}
				const hasAnySource = constraint.sourceObjectIds.some(
					id =>
						this.lines.has(id) ||
						this.circles.has(id) ||
						this.arcs.has(id) ||
						this.ellipses.has(id) ||
						this.ellipticalArcs.has(id) ||
						this.points.has(id)
				);
				if (!hasAnySource) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
					continue;
				}
				const hasMissingPoint = constraint.copies.some(copy =>
					copy.pointPairs.some(
						pair => !this.points.has(pair.sourcePtId) || !this.points.has(pair.patternPtId)
					)
				);
				if (hasMissingPoint) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
					continue;
				}
				continue;
			}
			if (constraint instanceof RectangularPatternConstraint) {
				if (constraint.line1Id && !this.lines.has(constraint.line1Id)) {
					constraint.line1Id = null;
					constraint.line1P1Id = null;
					constraint.line1P2Id = null;
				}
				if (constraint.line2Id && !this.lines.has(constraint.line2Id)) {
					constraint.line2Id = null;
					constraint.line2P1Id = null;
					constraint.line2P2Id = null;
				}
				const hasAnySource = constraint.sourceObjectIds.some(
					id =>
						this.lines.has(id) ||
						this.circles.has(id) ||
						this.arcs.has(id) ||
						this.ellipses.has(id) ||
						this.ellipticalArcs.has(id) ||
						this.points.has(id)
				);
				if (!hasAnySource) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
					continue;
				}
				continue;
			}
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
				continue;
			}
			if (constraint instanceof SymmetryConstraint) {
				if (constraint.lineId && !this.lines.has(constraint.lineId) && !this.getLineBetween(constraint.lineP1Id, constraint.lineP2Id)) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
				}
			}
		}
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
			!this.ellipticalArcs.has(id) &&
			!this.splines.has(id)
		) {
			return;
		}

		// Tangent lines and their handle endpoints cannot be deleted directly!
		if (this.lines.has(id) && this.isSplineHandleLine(id)) {
			return;
		}
		if (this.points.has(id) && this.isSplineHandlePoint(id)) {
			return;
		}

		this.beginTransaction();

		const candidatePointIds = new Set<string>();

		if (this.points.has(id)) {
			this.points.delete(id);
			this.selection.pointIds.delete(id);
			// Remove lines referencing this point
			for (const [lid, line] of this.lines.entries()) {
				if (line.p1Id === id || line.p2Id === id) {
					candidatePointIds.add(line.p1Id);
					candidatePointIds.add(line.p2Id);
					this.lines.delete(lid);
					this.selection.lineIds.delete(lid);
				}
			}
			// Remove circles referencing this center
			for (const [cid, circle] of this.circles.entries()) {
				if (circle.centerId === id) {
					candidatePointIds.add(circle.centerId);
					this.circles.delete(cid);
					this.selection.circleIds.delete(cid);
				}
			}
			// Remove arcs referencing this point
			for (const [aid, arc] of this.arcs.entries()) {
				if (arc.centerId === id || arc.startPointId === id || arc.endPointId === id) {
					candidatePointIds.add(arc.centerId);
					candidatePointIds.add(arc.startPointId);
					candidatePointIds.add(arc.endPointId);
					this.arcs.delete(aid);
					this.selection.arcIds.delete(aid);
				}
			}
			// Remove ellipses referencing this point
			for (const [eid, el] of this.ellipses.entries()) {
				if (el.centerId === id || el.majorAxisPointId === id || el.minorAxisPointId === id) {
					candidatePointIds.add(el.centerId);
					candidatePointIds.add(el.majorAxisPointId);
					candidatePointIds.add(el.minorAxisPointId);
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
					candidatePointIds.add(elarc.centerId);
					candidatePointIds.add(elarc.majorAxisPointId);
					candidatePointIds.add(elarc.minorAxisPointId);
					candidatePointIds.add(elarc.startPointId);
					candidatePointIds.add(elarc.endPointId);
					this.ellipticalArcs.delete(eaid);
					this.selection.ellipticalArcIds.delete(eaid);
				}
			}
			// Update splines referencing this point
			for (const [sid, spline] of this.splines.entries()) {
				if (spline.pointIds.includes(id)) {
					if (spline.splineType === 'control') {
						const remaining = spline.pointIds.filter(pid => pid !== id);
						if (remaining.length >= 4) {
							spline.pointIds = remaining;
							delete spline.knots;
						} else {
							for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
							this.splines.delete(sid);
							this.selection.splineIds.delete(sid);
						}
					} else if (spline.splineType === 'fit') {
						if (spline.isClosed) {
							const unique = spline.pointIds.slice(0, -1);
							if (unique.length <= 3) {
								for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
								if (spline.tangentLineIds) {
									for (const lid of spline.tangentLineIds) {
										const line = this.lines.get(lid);
										if (line) {
											candidatePointIds.add(line.p1Id);
											candidatePointIds.add(line.p2Id);
											this.lines.delete(lid);
											this.selection.lineIds.delete(lid);
										}
									}
								}
								this.splines.delete(sid);
								this.selection.splineIds.delete(sid);
							} else {
								const idx = unique.indexOf(id);
								if (idx !== -1) {
									if (spline.tangentLineIds && spline.tangentLineIds[idx]) {
										const lid = spline.tangentLineIds[idx];
										const line = this.lines.get(lid);
										if (line) {
											candidatePointIds.add(line.p1Id);
											candidatePointIds.add(line.p2Id);
											this.lines.delete(lid);
											this.selection.lineIds.delete(lid);
										}
									}
									const newUnique = unique.filter((_, i) => i !== idx);
									spline.pointIds = [...newUnique, newUnique[0]];
									if (spline.tangentLineIds) {
										const uniqueTangents = spline.tangentLineIds.slice(0, -1).filter((_, i) => i !== idx);
										spline.tangentLineIds = [...uniqueTangents, uniqueTangents[0]];
									}
								}
							}
						} else {
							const remaining = spline.pointIds.filter(pid => pid !== id);
							if (remaining.length < 2) {
								for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
								if (spline.tangentLineIds) {
									for (const lid of spline.tangentLineIds) {
										const line = this.lines.get(lid);
										if (line) {
											candidatePointIds.add(line.p1Id);
											candidatePointIds.add(line.p2Id);
											this.lines.delete(lid);
											this.selection.lineIds.delete(lid);
										}
									}
								}
								this.splines.delete(sid);
								this.selection.splineIds.delete(sid);
							} else {
								const idx = spline.pointIds.indexOf(id);
								if (idx !== -1 && spline.tangentLineIds && spline.tangentLineIds[idx]) {
									const lid = spline.tangentLineIds[idx];
									const line = this.lines.get(lid);
									if (line) {
										candidatePointIds.add(line.p1Id);
										candidatePointIds.add(line.p2Id);
										this.lines.delete(lid);
										this.selection.lineIds.delete(lid);
									}
									spline.tangentLineIds.splice(idx, 1);
								}
								spline.pointIds = remaining;
							}
						}
					}
				}
			}
		} else if (this.lines.has(id)) {
			const line = this.lines.get(id)!;
			candidatePointIds.add(line.p1Id);
			candidatePointIds.add(line.p2Id);
			this.lines.delete(id);
			this.selection.lineIds.delete(id);
		} else if (this.circles.has(id)) {
			const circle = this.circles.get(id)!;
			candidatePointIds.add(circle.centerId);
			this.circles.delete(id);
			this.selection.circleIds.delete(id);
		} else if (this.arcs.has(id)) {
			const arc = this.arcs.get(id)!;
			candidatePointIds.add(arc.centerId);
			candidatePointIds.add(arc.startPointId);
			candidatePointIds.add(arc.endPointId);
			this.arcs.delete(id);
			this.selection.arcIds.delete(id);
		} else if (this.ellipses.has(id)) {
			const el = this.ellipses.get(id)!;
			candidatePointIds.add(el.centerId);
			candidatePointIds.add(el.majorAxisPointId);
			candidatePointIds.add(el.minorAxisPointId);
			this.ellipses.delete(id);
			this.selection.ellipseIds.delete(id);
		} else if (this.ellipticalArcs.has(id)) {
			const elarc = this.ellipticalArcs.get(id)!;
			candidatePointIds.add(elarc.centerId);
			candidatePointIds.add(elarc.majorAxisPointId);
			candidatePointIds.add(elarc.minorAxisPointId);
			candidatePointIds.add(elarc.startPointId);
			candidatePointIds.add(elarc.endPointId);
			this.ellipticalArcs.delete(id);
			this.selection.ellipticalArcIds.delete(id);
		} else if (this.splines.has(id)) {
			const spline = this.splines.get(id)!;
			for (const ptId of spline.pointIds) {
				candidatePointIds.add(ptId);
			}
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const line = this.lines.get(lid);
					if (line) {
						candidatePointIds.add(line.p1Id);
						candidatePointIds.add(line.p2Id);
						this.lines.delete(lid);
						this.selection.lineIds.delete(lid);
					}
				}
			}
			this.splines.delete(id);
			this.selection.splineIds.delete(id);
		}

		// Remove candidate points if they are no longer used by any remaining primitive
		for (const ptId of candidatePointIds) {
			if (this.points.has(ptId) && !this.isPointUsed(ptId)) {
				this.points.delete(ptId);
				this.selection.pointIds.delete(ptId);
			}
		}

		this.cleanOrphanConstraints();

		this.rebuildParamManager();
		this.solve();
		this.commitTransaction();
	}

	toggleConstruction(id: string): void {
		this.pushHistory();
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
		const spline = this.splines.get(id);
		if (spline) {
			spline.isConstruction = !spline.isConstruction;
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

	hasAngleConstraint(line1Id: string, line2Id: string): boolean {
		for (const c of this.constraints.values()) {
			if (
				c instanceof AngleConstraint &&
				((c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id))
			) {
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
				if (this.isSplineInternalConstraint(c)) continue;
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
				} else if (c.type === 'symmetry') {
					if (anyC.p1Id === id || anyC.p2Id === id) res.push(c);
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
					c.type !== 'collinear' &&
					c.type !== 'perpendicular' &&
					c.type !== 'tangent_line_circle' &&
					c.type !== 'angle'
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
				if (this.isSplineInternalConstraint(c)) continue;
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
				} else if (c.type === 'parallel' || c.type === 'collinear' || c.type === 'perpendicular') {
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
				} else if (c.type === 'symmetry') {
					if (anyC.lineId === id || this.matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
						res.push(c);
					}
				} else if (c.type === 'angle') {
					if (
						anyC.line1Id === id ||
						anyC.line2Id === id ||
						this.matchesEndpoints(anyC.l1P1, anyC.l1P2, p1Id, p2Id) ||
						this.matchesEndpoints(anyC.l2P1, anyC.l2P2, p1Id, p2Id)
					) {
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
				} else if (c.type === 'tangent_circle_circle') {
					if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
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
				} else if (c.type === 'tangent_circle_circle') {
					if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
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

	getEntitiesForConstraint(c: IConstraint): Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}> {
		const res: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
		}> = [];
		const seen = new Set<string>();

		const add = (id: string, type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc') => {
			const key = `${type}:${id}`;
			if (!seen.has(key)) {
				seen.add(key);
				res.push({ id, type });
			}
		};

		const anyC = c as any;

		if (c.type === 'fixed') {
			if (anyC.pointId && this.points.has(anyC.pointId)) {
				add(anyC.pointId, 'point');
			}
		} else if (c.type === 'coincident') {
			if (anyC.p1Id && this.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
			if (anyC.p2Id && this.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
		} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
			const line = this.getLineBetween(anyC.p1Id, anyC.p2Id);
			if (line) {
				add(line.id, 'line');
			} else {
				if (anyC.p1Id && this.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
				if (anyC.p2Id && this.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
			}
		} else if (c.type === 'radius') {
			const cid = anyC.circleId;
			if (this.circles.has(cid)) add(cid, 'circle');
			else if (this.arcs.has(cid)) add(cid, 'arc');
		} else if (c.type === 'equal_radius') {
			const c1 = anyC.circle1Id;
			const c2 = anyC.circle2Id;
			if (this.circles.has(c1)) add(c1, 'circle');
			else if (this.arcs.has(c1)) add(c1, 'arc');
			if (this.circles.has(c2)) add(c2, 'circle');
			else if (this.arcs.has(c2)) add(c2, 'arc');
		} else if (c.type === 'equal_length') {
			const l1 = this.getLineBetween(anyC.line1P1, anyC.line1P2);
			const l2 = this.getLineBetween(anyC.line2P1, anyC.line2P2);
			if (l1) add(l1.id, 'line');
			if (l2) add(l2.id, 'line');
		} else if (c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'collinear') {
			const l1 = this.getLineBetween(anyC.l1P1, anyC.l1P2);
			const l2 = this.getLineBetween(anyC.l2P1, anyC.l2P2);
			if (l1) add(l1.id, 'line');
			if (l2) add(l2.id, 'line');
		} else if (c.type === 'symmetry') {
			if (anyC.p1Id && this.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
			if (anyC.p2Id && this.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
			if (anyC.lineId && this.lines.has(anyC.lineId)) {
				add(anyC.lineId, 'line');
			} else {
				const line = this.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
				if (line) add(line.id, 'line');
			}
		} else if (c.type === 'circular_pattern') {
			const cpat = c as CircularPatternConstraint;
			if (cpat.centerPtId && this.points.has(cpat.centerPtId)) add(cpat.centerPtId, 'point');
			if (cpat.sourceObjectIds) {
				for (const id of cpat.sourceObjectIds) {
					if (this.lines.has(id)) add(id, 'line');
					else if (this.circles.has(id)) add(id, 'circle');
					else if (this.arcs.has(id)) add(id, 'arc');
					else if (this.ellipses.has(id)) add(id, 'ellipse');
					else if (this.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
					else if (this.points.has(id)) add(id, 'point');
				}
			}
			if (cpat.copies) {
				for (const copy of cpat.copies) {
					for (const item of copy.createdEntityIds) {
						if (item.type === 'line' && this.lines.has(item.id)) add(item.id, 'line');
						else if (item.type === 'circle' && this.circles.has(item.id)) add(item.id, 'circle');
						else if (item.type === 'arc' && this.arcs.has(item.id)) add(item.id, 'arc');
						else if (item.type === 'ellipse' && this.ellipses.has(item.id)) add(item.id, 'ellipse');
						else if (item.type === 'elliptical_arc' && this.ellipticalArcs.has(item.id)) add(item.id, 'elliptical_arc');
						else if (item.type === 'point' && this.points.has(item.id)) add(item.id, 'point');
					}
				}
			}
		} else if (c.type === 'rectangular_pattern') {
			const rpat = c as RectangularPatternConstraint;
			if (rpat.line1Id && this.lines.has(rpat.line1Id)) add(rpat.line1Id, 'line');
			if (rpat.line2Id && this.lines.has(rpat.line2Id)) add(rpat.line2Id, 'line');
			if (rpat.sourceObjectIds) {
				for (const id of rpat.sourceObjectIds) {
					if (this.lines.has(id)) add(id, 'line');
					else if (this.circles.has(id)) add(id, 'circle');
					else if (this.arcs.has(id)) add(id, 'arc');
					else if (this.ellipses.has(id)) add(id, 'ellipse');
					else if (this.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
					else if (this.points.has(id)) add(id, 'point');
				}
			}
			if (rpat.copies) {
				for (const copy of rpat.copies) {
					for (const item of copy.createdEntityIds) {
						if (item.type === 'line' && this.lines.has(item.id)) add(item.id, 'line');
						else if (item.type === 'circle' && this.circles.has(item.id)) add(item.id, 'circle');
						else if (item.type === 'arc' && this.arcs.has(item.id)) add(item.id, 'arc');
						else if (item.type === 'ellipse' && this.ellipses.has(item.id)) add(item.id, 'ellipse');
						else if (item.type === 'elliptical_arc' && this.ellipticalArcs.has(item.id)) add(item.id, 'elliptical_arc');
						else if (item.type === 'point' && this.points.has(item.id)) add(item.id, 'point');
					}
				}
			}
		} else if (c.type === 'angle') {
			if (anyC.line1Id && this.lines.has(anyC.line1Id)) {
				add(anyC.line1Id, 'line');
			} else {
				const l1 = this.getLineBetween(anyC.l1P1, anyC.l1P2);
				if (l1) add(l1.id, 'line');
			}
			if (anyC.line2Id && this.lines.has(anyC.line2Id)) {
				add(anyC.line2Id, 'line');
			} else {
				const l2 = this.getLineBetween(anyC.l2P1, anyC.l2P2);
				if (l2) add(l2.id, 'line');
			}
		} else if (c.type === 'point_on_line') {
			if (anyC.pointId && this.points.has(anyC.pointId)) add(anyC.pointId, 'point');
			const line = this.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
			if (line) add(line.id, 'line');
		} else if (c.type === 'point_on_circle') {
			if (anyC.pointId && this.points.has(anyC.pointId)) add(anyC.pointId, 'point');
			const cid = anyC.circleId;
			if (this.circles.has(cid)) add(cid, 'circle');
			else if (this.arcs.has(cid)) add(cid, 'arc');
		} else if (c.type === 'tangent_line_circle') {
			const line = this.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
			if (line) add(line.id, 'line');
			const cid = anyC.circleId;
			if (this.circles.has(cid)) add(cid, 'circle');
			else if (this.arcs.has(cid)) add(cid, 'arc');
		} else if (c.type === 'tangent_circle_circle') {
			const c1 = anyC.circle1Id;
			if (this.circles.has(c1)) add(c1, 'circle');
			else if (this.arcs.has(c1)) add(c1, 'arc');
			const c2 = anyC.circle2Id;
			if (this.circles.has(c2)) add(c2, 'circle');
			else if (this.arcs.has(c2)) add(c2, 'arc');
		} else if (c.type === 'concentric') {
			const e1 =
				[...this.circles.values()].find(circ => circ.centerId === anyC.c1CenterId) ??
				[...this.arcs.values()].find(arc => arc.centerId === anyC.c1CenterId);
			if (e1) {
				add(e1.id, this.circles.has(e1.id) ? 'circle' : 'arc');
			} else if (anyC.c1CenterId && this.points.has(anyC.c1CenterId)) {
				add(anyC.c1CenterId, 'point');
			}

			const e2 =
				[...this.circles.values()].find(circ => circ.centerId === anyC.c2CenterId) ??
				[...this.arcs.values()].find(arc => arc.centerId === anyC.c2CenterId);
			if (e2) {
				add(e2.id, this.circles.has(e2.id) ? 'circle' : 'arc');
			} else if (anyC.c2CenterId && this.points.has(anyC.c2CenterId)) {
				add(anyC.c2CenterId, 'point');
			}
		} else if (c.type === 'midpoint') {
			if (anyC.midId && this.points.has(anyC.midId)) add(anyC.midId, 'point');
			const line = this.getLineBetween(anyC.p1Id, anyC.p2Id);
			if (line) {
				add(line.id, 'line');
			} else {
				if (anyC.p1Id && this.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
				if (anyC.p2Id && this.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
			}
		} else if (c.type === 'ellipse_axis') {
			if (anyC.ellipseId) {
				if (this.ellipses.has(anyC.ellipseId)) add(anyC.ellipseId, 'ellipse');
				else if (this.ellipticalArcs.has(anyC.ellipseId)) add(anyC.ellipseId, 'elliptical_arc');
			}
		} else if (c.type === 'elliptical_arc_endpoints') {
			if (anyC.arcId && this.ellipticalArcs.has(anyC.arcId)) {
				add(anyC.arcId, 'elliptical_arc');
			}
		}

		// Safety net: check if any primitive in the sketch considers this constraint related
		for (const l of this.lines.values()) {
			if (this.getConstraintsForEntity('line', l.id).some(sc => sc.id === c.id)) add(l.id, 'line');
		}
		for (const circ of this.circles.values()) {
			if (this.getConstraintsForEntity('circle', circ.id).some(sc => sc.id === c.id)) add(circ.id, 'circle');
		}
		for (const a of this.arcs.values()) {
			if (this.getConstraintsForEntity('arc', a.id).some(sc => sc.id === c.id)) add(a.id, 'arc');
		}
		for (const el of this.ellipses.values()) {
			if (this.getConstraintsForEntity('ellipse', el.id).some(sc => sc.id === c.id)) add(el.id, 'ellipse');
		}
		for (const ea of this.ellipticalArcs.values()) {
			if (this.getConstraintsForEntity('elliptical_arc', ea.id).some(sc => sc.id === c.id)) add(ea.id, 'elliptical_arc');
		}
		for (const pt of this.points.values()) {
			if (this.getConstraintsForEntity('point', pt.id).some(sc => sc.id === c.id)) add(pt.id, 'point');
		}

		return res;
	}

	isEntitySelected(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint'
	): boolean {
		switch (type) {
			case 'point': return this.selection.pointIds.has(id);
			case 'line': return this.selection.lineIds.has(id);
			case 'circle': return this.selection.circleIds.has(id);
			case 'arc': return this.selection.arcIds.has(id);
			case 'ellipse': return this.selection.ellipseIds.has(id);
			case 'elliptical_arc': return this.selection.ellipticalArcIds.has(id);
			case 'spline': return this.selection.splineIds.has(id);
			case 'constraint': return this.selection.constraintIds.has(id);
			default: return false;
		}
	}

	deselectEntity(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint'
	): void {
		switch (type) {
			case 'point':
				this.selection.pointIds.delete(id);
				break;
			case 'line':
				this.selection.lineIds.delete(id);
				break;
			case 'circle':
				this.selection.circleIds.delete(id);
				break;
			case 'arc':
				this.selection.arcIds.delete(id);
				break;
			case 'ellipse':
				this.selection.ellipseIds.delete(id);
				break;
			case 'elliptical_arc':
				this.selection.ellipticalArcIds.delete(id);
				break;
			case 'spline':
				this.selection.splineIds.delete(id);
				break;
			case 'constraint':
				this.selection.constraintIds.delete(id);
				break;
		}

		if (type !== 'constraint') {
			for (const c of this.getConstraintsForEntity(type as any, id)) {
				const otherEntities = this.getEntitiesForConstraint(c);
				const stillSelected = otherEntities.some(ent => this.isEntitySelected(ent.id, ent.type));
				if (!stillSelected) {
					this.selection.constraintIds.delete(c.id);
				}
			}
		}

		this.notify();
	}

	toggleEntitySelection(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint'
	): void {
		if (this.isEntitySelected(id, type)) {
			this.deselectEntity(id, type);
		} else {
			this.selectEntity(id, type, true);
		}
	}

	selectEntities(
		items: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
		}>,
		multiSelect = false
	): void {
		if (!multiSelect) {
			this.selection.pointIds.clear();
			this.selection.lineIds.clear();
			this.selection.circleIds.clear();
			this.selection.arcIds.clear();
			this.selection.ellipseIds.clear();
			this.selection.ellipticalArcIds.clear();
			this.selection.splineIds.clear();
			this.selection.constraintIds.clear();
		}

		for (const item of items) {
			if (item.type === 'point') {
				this.selection.pointIds.add(item.id);
				for (const c of this.getConstraintsForEntity('point', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'line') {
				this.selection.lineIds.add(item.id);
				for (const c of this.getConstraintsForEntity('line', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'circle') {
				this.selection.circleIds.add(item.id);
				for (const c of this.getConstraintsForEntity('circle', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'arc') {
				this.selection.arcIds.add(item.id);
				for (const c of this.getConstraintsForEntity('arc', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'ellipse') {
				this.selection.ellipseIds.add(item.id);
				for (const c of this.getConstraintsForEntity('ellipse', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'elliptical_arc') {
				this.selection.ellipticalArcIds.add(item.id);
				for (const c of this.getConstraintsForEntity('elliptical_arc', item.id)) {
					this.selection.constraintIds.add(c.id);
				}
			} else if (item.type === 'spline') {
				this.selection.splineIds.add(item.id);
			} else if (item.type === 'constraint') {
				this.selection.constraintIds.add(item.id);
			}
		}

		this.notify();
	}

	selectEntity(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint',
		multiSelect = false
	): void {
		this.selectEntities([{ id, type }], multiSelect);
	}

	clear(): void {
		this.pushHistory();
		this.points.clear();
		this.lines.clear();
		this.circles.clear();
		this.arcs.clear();
		this.ellipses.clear();
		this.ellipticalArcs.clear();
		this.splines.clear();
		this.constraints.clear();
		this.selection.pointIds.clear();
		this.selection.lineIds.clear();
		this.selection.circleIds.clear();
		this.selection.arcIds.clear();
		this.selection.ellipseIds.clear();
		this.selection.ellipticalArcIds.clear();
		this.selection.splineIds.clear();
		this.selection.constraintIds.clear();
		this.counters.clear();
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
		this.selection.splineIds.clear();
		this.selection.constraintIds.clear();
		this.notify();
	}

	getSelectedPrimitives(): Array<{ id: string; isConstruction?: boolean }> {
		const list: Array<{ id: string; isConstruction?: boolean }> = [];
		for (const id of this.selection.lineIds) {
			const l = this.lines.get(id);
			if (l) list.push(l);
		}
		for (const id of this.selection.circleIds) {
			const c = this.circles.get(id);
			if (c) list.push(c);
		}
		for (const id of this.selection.arcIds) {
			const a = this.arcs.get(id);
			if (a) list.push(a);
		}
		for (const id of this.selection.ellipseIds) {
			const el = this.ellipses.get(id);
			if (el) list.push(el);
		}
		for (const id of this.selection.ellipticalArcIds) {
			const ea = this.ellipticalArcs.get(id);
			if (ea) list.push(ea);
		}
		for (const id of this.selection.splineIds) {
			const s = this.splines.get(id);
			if (s) list.push(s);
		}
		for (const id of this.selection.pointIds) {
			const p = this.points.get(id);
			if (p) list.push(p);
		}
		return list;
	}

	getSelectedConstructionState(): boolean | null {
		const primitives = this.getSelectedPrimitives();
		if (primitives.length === 0) return null;
		return primitives.every(p => !!p.isConstruction);
	}

	deleteSelected(): void {
		const hasSelection =
			this.selection.pointIds.size > 0 ||
			this.selection.lineIds.size > 0 ||
			this.selection.circleIds.size > 0 ||
			this.selection.arcIds.size > 0 ||
			this.selection.ellipseIds.size > 0 ||
			this.selection.ellipticalArcIds.size > 0 ||
			this.selection.splineIds.size > 0 ||
			this.selection.constraintIds.size > 0;

		if (!hasSelection) return;

		this.beginTransaction();
		const selectedPoints = [...this.selection.pointIds];
		const selectedLines = [...this.selection.lineIds];
		const selectedCircles = [...this.selection.circleIds];
		const selectedArcs = [...this.selection.arcIds];
		const selectedEllipses = [...this.selection.ellipseIds];
		const selectedEllipticalArcs = [...this.selection.ellipticalArcIds];
		const selectedSplines = [...this.selection.splineIds];
		const selectedConstraints = [...this.selection.constraintIds].filter(cid => {
			const c = this.constraints.get(cid);
			return c ? !this.isSplineInternalConstraint(c) : true;
		});

		const selectedSplinesSet = new Set(selectedSplines);

		// Do not delete tangent lines directly unless parent spline is also being deleted
		const filteredLines = selectedLines.filter(lid => {
			const line = this.lines.get(lid);
			if (line?.isSplineHandle) {
				if (!line.parentSplineId || !selectedSplinesSet.has(line.parentSplineId)) {
					this.selection.lineIds.delete(lid);
					return false;
				}
			}
			return true;
		});

		// Do not delete tangent handle points directly unless parent spline is also being deleted
		const filteredPoints = selectedPoints.filter(pid => {
			if (this.isSplineHandlePoint(pid)) {
				let parentSplineSelected = false;
				for (const line of this.lines.values()) {
					if (line.isSplineHandle && (line.p1Id === pid || line.p2Id === pid)) {
						if (line.parentSplineId && selectedSplinesSet.has(line.parentSplineId)) {
							parentSplineSelected = true;
							break;
						}
					}
				}
				if (!parentSplineSelected) {
					this.selection.pointIds.delete(pid);
					return false;
				}
			}
			return true;
		});

		// Collect all candidate points from all selected primitives before deleting
		const candidatePointIds = new Set<string>();
		for (const id of filteredLines) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
		for (const id of selectedCircles) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
		for (const id of selectedArcs) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
		for (const id of selectedEllipses) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
		for (const id of selectedEllipticalArcs) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}
		for (const id of selectedSplines) {
			for (const ptId of this.getPrimitivePointIds(id)) candidatePointIds.add(ptId);
		}

		for (const id of selectedConstraints) this.removeConstraint(id);
		for (const id of filteredLines) this.removeEntity(id);
		for (const id of selectedCircles) this.removeEntity(id);
		for (const id of selectedArcs) this.removeEntity(id);
		for (const id of selectedEllipses) this.removeEntity(id);
		for (const id of selectedEllipticalArcs) this.removeEntity(id);
		for (const id of selectedSplines) this.removeEntity(id);
		for (const id of filteredPoints) this.removeEntity(id);

		// Final sweep for any candidate points that became unused across the batch
		for (const ptId of candidatePointIds) {
			if (this.points.has(ptId) && !this.isPointUsed(ptId)) {
				this.points.delete(ptId);
				this.selection.pointIds.delete(ptId);
			}
		}

		this.cleanOrphanConstraints();

		this.clearSelection();
		this.rebuildParamManager();
		this.solve();
		this.commitTransaction();
	}

	exportSVG(viewportState?: { panX: number; panY: number; zoom: number }): string {
		const metadataPayload: SketchFileMetadata = {
			format: 'svg-sketcher',
			version: 1,
			generator: 'SVG Sketcher',
			createdAt: new Date().toISOString(),
			viewport: viewportState,
			snapshot: this.takeSnapshot(),
		};

		const jsonString = JSON.stringify(metadataPayload, null, 2).replace(/]]>/g, ']]]]><![CDATA[>');

		// Generate clean SVG markup for CAD export (CAD Y-up converted to standard SVG Y-down)
		const elements: string[] = [];

		const usedPoints = new Set<string>();

		for (const line of this.lines.values()) {
			if (line.isSplineHandle) continue;
			usedPoints.add(line.p1Id);
			usedPoints.add(line.p2Id);
			const p1 = this.points.get(line.p1Id);
			const p2 = this.points.get(line.p2Id);
			if (p1 && p2) {
				const dash = line.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<line x1="${p1.x.toFixed(2)}" y1="${(-p1.y).toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${(-p2.y).toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" />`
				);
			}
		}

		for (const circ of this.circles.values()) {
			usedPoints.add(circ.centerId);
			const center = this.points.get(circ.centerId);
			if (center) {
				const dash = circ.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<circle cx="${center.x.toFixed(2)}" cy="${(-center.y).toFixed(2)}" r="${circ.radius.toFixed(2)}"${dash} stroke-width="2" fill="none" />`
				);
			}
		}

		for (const arc of this.arcs.values()) {
			usedPoints.add(arc.centerId);
			usedPoints.add(arc.startPointId);
			usedPoints.add(arc.endPointId);
			const center = this.points.get(arc.centerId);
			const start = this.points.get(arc.startPointId);
			const end = this.points.get(arc.endPointId);
			if (center && start && end) {
				// Convert to SVG coordinates (Y-down)
				const sc = { x: center.x, y: -center.y };
				const ss = { x: start.x, y: -start.y };
				const se = { x: end.x, y: -end.y };

				const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
				const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
				const clockwise = !!arc.clockwise;

				let sweepAngle = 0;
				let sweepFlag = 0;
				if (clockwise) {
					sweepAngle = (ae - as) % (2 * Math.PI);
					if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
					sweepFlag = 1;
				} else {
					sweepAngle = (as - ae) % (2 * Math.PI);
					if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
					sweepFlag = 0;
				}
				const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;
				const dash = arc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 ${largeArcFlag} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
				);
			}
		}

		for (const el of this.ellipses.values()) {
			usedPoints.add(el.centerId);
			usedPoints.add(el.majorAxisPointId);
			usedPoints.add(el.minorAxisPointId);
			const center = this.points.get(el.centerId);
			const maj = this.points.get(el.majorAxisPointId);
			const min = this.points.get(el.minorAxisPointId);
			if (center && maj && min) {
				const sc = { x: center.x, y: -center.y };
				const smaj = { x: maj.x, y: -maj.y };
				const smin = { x: min.x, y: -min.y };
				const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
				const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
				const deg = (Math.atan2(smaj.y - sc.y, smaj.x - sc.x) * 180) / Math.PI;
				const dash = el.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<ellipse cx="${sc.x.toFixed(2)}" cy="${sc.y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${sc.x.toFixed(2)} ${sc.y.toFixed(2)})"${dash} stroke-width="2" fill="none" />`
				);
			}
		}

		for (const elarc of this.ellipticalArcs.values()) {
			usedPoints.add(elarc.centerId);
			usedPoints.add(elarc.majorAxisPointId);
			usedPoints.add(elarc.minorAxisPointId);
			usedPoints.add(elarc.startPointId);
			usedPoints.add(elarc.endPointId);
			const center = this.points.get(elarc.centerId);
			const maj = this.points.get(elarc.majorAxisPointId);
			const min = this.points.get(elarc.minorAxisPointId);
			const start = this.points.get(elarc.startPointId);
			const end = this.points.get(elarc.endPointId);
			if (center && maj && min && start && end) {
				const sc = { x: center.x, y: -center.y };
				const smaj = { x: maj.x, y: -maj.y };
				const smin = { x: min.x, y: -min.y };
				const ss = { x: start.x, y: -start.y };
				const se = { x: end.x, y: -end.y };

				const rx = Math.hypot(smaj.x - sc.x, smaj.y - sc.y);
				const ry = Math.hypot(smin.x - sc.x, smin.y - sc.y);
				const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
				const thetaDeg = (theta * 180) / Math.PI;

				const ux = Math.cos(theta);
				const uy = Math.sin(theta);
				const vx = -Math.sin(theta);
				const vy = Math.cos(theta);

				const us = (ss.x - sc.x) * ux + (ss.y - sc.y) * uy;
				const vs = (ss.x - sc.x) * vx + (ss.y - sc.y) * vy;
				const ue = (se.x - sc.x) * ux + (se.y - sc.y) * uy;
				const ve = (se.x - sc.x) * vx + (se.y - sc.y) * vy;

				const ts = Math.atan2(vs / ry, us / rx);
				const te = Math.atan2(ve / ry, ue / rx);

				const clockwise = !!elarc.clockwise;
				let sweepAngle = 0;
				let sweepFlag = 0;
				if (clockwise) {
					sweepAngle = (te - ts) % (2 * Math.PI);
					if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
					sweepFlag = 1;
				} else {
					sweepAngle = (ts - te) % (2 * Math.PI);
					if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
					sweepFlag = 0;
				}
				const largeArc = sweepAngle > Math.PI ? 1 : 0;
				const dash = elarc.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<path d="M ${ss.x.toFixed(2)} ${ss.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} ${thetaDeg.toFixed(2)} ${largeArc} ${sweepFlag} ${se.x.toFixed(2)} ${se.y.toFixed(2)}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
				);
			}
		}

		for (const spline of this.splines.values()) {
			for (const pid of spline.pointIds) usedPoints.add(pid);
			if (spline.tangentLineIds) {
				for (const lid of spline.tangentLineIds) {
					const l = this.lines.get(lid);
					if (l) {
						usedPoints.add(l.p1Id);
						usedPoints.add(l.p2Id);
					}
				}
			}
			const pts = spline.pointIds.map(id => this.points.get(id)).filter(Boolean) as SketchPoint[];
			if (pts.length >= 2) {
				let segments: BezierSegment[] = [];
				if (spline.splineType === 'control') {
					segments = bsplineToBezier(pts.map(p => ({ x: p.x, y: -p.y })), spline.knots);
				} else {
					const handles = (spline.tangentLineIds || []).map(lid => {
						const line = this.lines.get(lid);
						if (!line) return null;
						const p1 = this.points.get(line.p1Id);
						const p2 = this.points.get(line.p2Id);
						if (!p1 || !p2) return null;
						return {
							h1: { x: p1.x, y: -p1.y },
							h2: { x: p2.x, y: -p2.y },
						};
					});
					segments = fitPointsToBezier(pts.map(p => ({ x: p.x, y: -p.y })), handles);
				}
				const d = getSplineSvgPath(segments, p => p, !!spline.isClosed);
				const dash = spline.isConstruction ? ' stroke-dasharray="4,4" stroke="#64748b"' : ' stroke="#0f172a"';
				elements.push(
					`<path d="${d}"${dash} stroke-width="2" stroke-linecap="round" fill="none" />`
				);
			}
		}

		// Export isolated points
		for (const pt of this.points.values()) {
			if (!usedPoints.has(pt.id)) {
				const fill = '#0f172a';
				elements.push(
					`<circle cx="${pt.x.toFixed(2)}" cy="${(-pt.y).toFixed(2)}" r="2" fill="${fill}" />`
				);
			}
		}

		const bbox = this.getBoundingBox();
		let viewBox = '-100 -100 200 200';

		if (bbox) {
			const w = bbox.maxX - bbox.minX;
			const h = bbox.maxY - bbox.minY;
			const padding = Math.max(10, Math.max(w, h) * 0.05);
			const minX = bbox.minX - padding;
			const minY = -bbox.maxY - padding;
			const vbWidth = Math.max(w + padding * 2, 20);
			const vbHeight = Math.max(h + padding * 2, 20);
			viewBox = `${minX.toFixed(2)} ${minY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}`;
		}

		return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  <metadata id="sketcher-metadata">\n    <![CDATA[\n${jsonString}\n    ]]>\n  </metadata>\n  ${elements.join('\n  ')}\n</svg>`;
	}

	importSVG(svgString: string): {
		success: boolean;
		viewport?: { panX: number; panY: number; zoom: number };
		error?: string;
	} {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(svgString, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');
			if (parserError) {
				return { success: false, error: 'Invalid SVG XML structure' };
			}

			// Find sketcher metadata element
			let metaEl: Element | null = doc.getElementById('sketcher-metadata') || doc.querySelector('metadata#sketcher-metadata');
			if (!metaEl) {
				const allMetadata = doc.querySelectorAll('metadata');
				for (let i = 0; i < allMetadata.length; i++) {
					const el = allMetadata[i];
					if (el.textContent && el.textContent.includes('"format"') && el.textContent.includes('svg-sketcher')) {
						metaEl = el;
						break;
					}
				}
			}

			if (!metaEl || !metaEl.textContent) {
				return { success: false, error: 'No parametric CAD metadata found in SVG' };
			}

			const rawText = metaEl.textContent.trim();
			const data = JSON.parse(rawText) as SketchFileMetadata;

			if (data.format !== 'svg-sketcher' || !data.snapshot) {
				return { success: false, error: 'Unsupported sketch metadata format' };
			}

			this.restoreSnapshot(data.snapshot);
			this.clearHistory();

			return {
				success: true,
				viewport: data.viewport,
			};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Failed to parse SVG metadata',
			};
		}
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

		for (const e of this.ellipses.values()) {
			const center = this.points.get(e.centerId);
			const maj = this.points.get(e.majorAxisPointId);
			const min = this.points.get(e.minorAxisPointId);
			if (center && maj && min) {
				const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
				const ry = Math.hypot(min.x - center.x, min.y - center.y);
				const rMax = Math.max(rx, ry);
				if (center.x - rMax < minX) minX = center.x - rMax;
				if (center.x + rMax > maxX) maxX = center.x + rMax;
				if (center.y - rMax < minY) minY = center.y - rMax;
				if (center.y + rMax > maxY) maxY = center.y + rMax;
			}
		}

		for (const ea of this.ellipticalArcs.values()) {
			const center = this.points.get(ea.centerId);
			const maj = this.points.get(ea.majorAxisPointId);
			const min = this.points.get(ea.minorAxisPointId);
			if (center && maj && min) {
				const rx = Math.hypot(maj.x - center.x, maj.y - center.y);
				const ry = Math.hypot(min.x - center.x, min.y - center.y);
				const rMax = Math.max(rx, ry);
				if (center.x - rMax < minX) minX = center.x - rMax;
				if (center.x + rMax > maxX) maxX = center.x + rMax;
				if (center.y - rMax < minY) minY = center.y - rMax;
				if (center.y + rMax > maxY) maxY = center.y + rMax;
			}
		}

		if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
			return null;
		}
		return { minX, minY, maxX, maxY };
	}
}


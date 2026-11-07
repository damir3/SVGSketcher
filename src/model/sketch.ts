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
} from '../solver/constraints';
import {
	generateCircularPatternCopy,
	deletePatternCopy,
	addCircularPatternConstraint,
	updateCircularPattern,
	generateRectangularPatternCopy,
	addRectangularPatternConstraint,
	updateRectangularPattern,
} from './patterns';
import {
	setPointCoords,
	setLineLength,
	setLineAngle,
	setLinesRelativeAngle,
	setCircleOrArcRadius,
	setArcAngle,
	setEllipseParams,
} from './inspectorOperations';
import {
	isEntitySelected,
	deselectEntity,
	toggleEntitySelection,
	selectEntities,
	selectEntity,
	clearSelection,
	getSelectedPrimitives,
	getSelectedConstructionState,
	deleteSelected,
	getBoundingBox,
	getSelectionBoundingBox,
	type SelectableEntityType,
} from './selection';
import {
	hasRadiusConstraint,
	hasAngleConstraint,
	hasThreePointAngleConstraint,
	isPointFixed,
	matchesEndpoints,
	getLineBetween,
	isPointUsed,
	getConstraintsForEntity,
	getEntitiesForConstraint,
} from './constraintLinks';
import {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
	SketchText,
	type TextSnapshot,
	type ISketchPrimitive,
	type SelectionState,
} from './types';
import type { GeoCurve } from '../math/intersection';
import {
	add,
	angleFromTo,
	addScaled,
	cross,
	dist,
	dot,
	mid,
	mix,
	reflectPoint,
	scale,
	sub,
	vec,
	type Vec2,
} from '../math/vector';
import type { AABB } from '../math/aabb';
import { computeNaturalFitHandles } from '../math/spline';
import { AutomaticSplineHandlesConstraint } from '../solver/constraints/automaticSplineHandles';
import { calculateOffsetGeometry } from '../math/offset';
import { serializePrimitive } from './primitives/serialization';
import { HistoryManager, type SketchSnapshot } from './history';
import { serializeConstraint, deserializeConstraint } from '../solver/constraints/serialization';
import {
	evaluateExpression,
	validateExpression,
	evaluateParameterGraph,
	isValidParameterName,
	renameParameterInExpression,
	type SketchParameter,
	type ParameterGraphResult,
} from '../math/expression';
import { exportSketchToSVG, importSketchFromSVG, type SketchFileMetadata } from './io/svgIO';

export type { SketchFileMetadata };

const BUILT_IN_POINTS = new Map<string, SketchPoint>([
	['origin', Object.freeze(new SketchPoint({ id: 'origin', x: 0, y: 0, fixed: true }))],
	['axis_x', Object.freeze(new SketchPoint({ id: 'axis_x', x: 1, y: 0, fixed: true }))],
	['axis_y', Object.freeze(new SketchPoint({ id: 'axis_y', x: 0, y: 1, fixed: true }))],
]);

const BUILT_IN_LINES = new Map<string, SketchLine>([
	['axis_x', Object.freeze(new SketchLine({ id: 'axis_x', p1Id: 'origin', p2Id: 'axis_x', isConstruction: true }))],
	['axis_y', Object.freeze(new SketchLine({ id: 'axis_y', p1Id: 'origin', p2Id: 'axis_y', isConstruction: true }))],
]);

export class PointMap extends Map<string, SketchPoint> {
	override get(key: string): SketchPoint | undefined {
		return super.get(key) ?? BUILT_IN_POINTS.get(key);
	}
}

export class SketchDocument {
	points: Map<string, SketchPoint> = new PointMap();
	lines = new Map<string, SketchLine>();
	circles = new Map<string, SketchCircle>();
	arcs = new Map<string, SketchArc>();
	ellipses = new Map<string, SketchEllipse>();
	ellipticalArcs = new Map<string, SketchEllipticalArc>();
	splines = new Map<string, SketchSpline>();
	texts = new Map<string, SketchText>();
	constraints = new Map<string, IConstraint>();
	parameters = new Map<string, SketchParameter>();

	selection: SelectionState = {
		pointIds: new Set(),
		lineIds: new Set(),
		circleIds: new Set(),
		arcIds: new Set(),
		ellipseIds: new Set(),
		ellipticalArcIds: new Set(),
		splineIds: new Set(),
		textIds: new Set(),
		constraintIds: new Set(),
	};

	private idCounter = 1;
	paramManager = new ParamManager();
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
			this.texts.has(id) ||
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
		return this.history.canUndo(this.takeSnapshot());
	}

	canRedo(): boolean {
		return this.history.canRedo();
	}

	undo(): boolean {
		if (this.batchDepth > 0) {
			this.rollbackTransaction();
		}
		const current = this.takeSnapshot();
		if (!this.history.canUndo(current)) return false;
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
			points: [...this.points.values()].map(point => serializePrimitive(point)),
			lines: [...this.lines.values()].map(line => serializePrimitive(line)),
			circles: [...this.circles.values()].map(circle => serializePrimitive(circle)),
			arcs: [...this.arcs.values()].map(arc => serializePrimitive(arc)),
			ellipses: [...this.ellipses.values()].map(ellipse => serializePrimitive(ellipse)),
			ellipticalArcs: [...this.ellipticalArcs.values()].map(arc => serializePrimitive(arc)),
			splines: [...this.splines.values()].map(spline => serializePrimitive(spline)),
			texts: [...this.texts.values()].map(text => text.serialize()),
			constraints: Array.from(this.constraints.values()).map(c => serializeConstraint(c)),
			parameters: Array.from(this.parameters.values()).map(p => ({ ...p })),
			idCounter: this.idCounter,
		};
	}

	restoreSnapshot(snapshot: SketchSnapshot): void {
		this.points.clear();
		for (const pt of snapshot.points) {
			this.points.set(pt.id, new SketchPoint(pt));
		}

		this.lines.clear();
		for (const l of snapshot.lines) {
			this.lines.set(l.id, new SketchLine(l));
		}

		this.circles.clear();
		for (const c of snapshot.circles) {
			this.circles.set(c.id, new SketchCircle(c));
		}

		this.arcs.clear();
		for (const a of snapshot.arcs) {
			this.arcs.set(a.id, new SketchArc(a));
		}

		this.ellipses.clear();
		for (const e of snapshot.ellipses ?? []) {
			this.ellipses.set(e.id, new SketchEllipse(e));
		}

		this.ellipticalArcs.clear();
		for (const a of snapshot.ellipticalArcs ?? []) {
			this.ellipticalArcs.set(a.id, new SketchEllipticalArc(a));
		}

		this.splines.clear();
		for (const s of snapshot.splines ?? []) {
			this.splines.set(s.id, new SketchSpline(s));
		}

		this.texts.clear();
		for (const t of snapshot.texts ?? []) {
			this.texts.set(t.id, new SketchText(t));
		}

		this.constraints.clear();
		for (const sc of snapshot.constraints) {
			const c = deserializeConstraint(sc);
			if (c) {
				this.constraints.set(c.id, c);
			}
		}

		this.restoreAutomaticSplineHandles();

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

		this.parameters.clear();
		if (snapshot.parameters) {
			for (const p of snapshot.parameters) {
				this.parameters.set(p.name, { ...p });
			}
		}

		this.recomputeParametersAndConstraints(false);
		this.rebuildParamManager();
		this.solve();
		this.notify();
	}

	// --- Point methods ---
	addPoint(point: Vec2, fixed = false): SketchPoint {
		this.pushHistory();
		const id = this.nextId('Point');
		const pt = new SketchPoint({ id, x: point.x, y: point.y, fixed });
		this.points.set(id, pt);
		this.rebuildParamManager();
		this.solve();
		return pt;
	}

	getPoint(id: string): SketchPoint | undefined {
		return this.points.get(id);
	}

	getLine(id: string): SketchLine | undefined {
		return this.lines.get(id) ?? BUILT_IN_LINES.get(id);
	}

	getPrimitive(
		id: string,
		type?: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): ISketchPrimitive | undefined {
		if (type) {
			switch (type) {
				case 'line':
					return this.lines.get(id);
				case 'point':
					return this.points.get(id);
				case 'circle':
					return this.circles.get(id);
				case 'arc':
					return this.arcs.get(id);
				case 'ellipse':
					return this.ellipses.get(id);
				case 'elliptical_arc':
					return this.ellipticalArcs.get(id);
				case 'spline':
					return this.splines.get(id);
			}
		}
		return (
			this.lines.get(id) ??
			this.points.get(id) ??
			this.circles.get(id) ??
			this.arcs.get(id) ??
			this.ellipses.get(id) ??
			this.ellipticalArcs.get(id) ??
			this.splines.get(id)
		);
	}

	toGeoCurve(
		id: string,
		type?: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): GeoCurve | null {
		const prim = this.getPrimitive(id, type);
		return prim ? prim.toGeoCurve(this) : null;
	}

	// --- Line methods ---
	addLine(p1Id: string, p2Id: string, isConstruction = false): SketchLine {
		this.pushHistory();
		const id = this.nextId('Line');
		const line = new SketchLine({ id, p1Id, p2Id, isConstruction });
		this.lines.set(id, line);
		this.rebuildParamManager();
		this.solve();
		return line;
	}

	// --- Circle methods ---
	addCircle(centerId: string, radius: number, isConstruction = false): SketchCircle {
		this.pushHistory();
		const id = this.nextId('Circle');
		const circle = new SketchCircle({ id, centerId, radius, isConstruction });
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
		const arc = new SketchArc({
			id,
			centerId,
			startPointId,
			endPointId,
			radius,
			clockwise,
			isConstruction,
		});
		this.arcs.set(id, arc);
		this.rebuildParamManager();
		const c = new ArcEndpointsConstraint(this.nextId('c_arcept'), id, centerId, startPointId, endPointId);
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
		const ellipse = new SketchEllipse({
			id,
			centerId,
			majorAxisPointId,
			minorAxisPointId,
			isConstruction,
		});
		this.ellipses.set(id, ellipse);
		this.rebuildParamManager();
		const c = new EllipseAxisConstraint(this.nextId('c_elaxis'), id, centerId, majorAxisPointId, minorAxisPointId);
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
		const arc = new SketchEllipticalArc({
			id,
			centerId,
			majorAxisPointId,
			minorAxisPointId,
			startPointId,
			endPointId,
			clockwise,
			isConstruction,
		});
		this.ellipticalArcs.set(id, arc);
		this.rebuildParamManager();
		const cAxis = new EllipseAxisConstraint(this.nextId('c_elaxis'), id, centerId, majorAxisPointId, minorAxisPointId);
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

		const closed =
			isClosed ??
			(pointIds.length >= 4 &&
				(pointIds[0] === pointIds[pointIds.length - 1] ||
					(this.points.has(pointIds[0]) &&
						this.points.has(pointIds[pointIds.length - 1]) &&
						Math.hypot(
							this.points.get(pointIds[0])!.x - this.points.get(pointIds[pointIds.length - 1])!.x,
							this.points.get(pointIds[0])!.y - this.points.get(pointIds[pointIds.length - 1])!.y
						) < 1e-4)));

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
					this.points.set(p1Id, new SketchPoint(p1Id, h.h1.x, h.h1.y, false));
					const p2Id = this.nextId('Point');
					this.points.set(p2Id, new SketchPoint(p2Id, h.h2.x, h.h2.y, false));
					const lineId = this.nextId('Line');
					const hLine = new SketchLine({
						id: lineId,
						p1Id,
						p2Id,
						isConstruction: true,
						isSplineHandle: true,
						parentSplineId: sid,
						isAutomaticSplineHandle: !explicitHandles,
					});
					this.lines.set(lineId, hLine);
					const d1 = dist(pFit, h.h1);
					const d2 = dist(pFit, h.h2);
					const ratio = d1 + d2 > 1e-6 ? d1 / (d1 + d2) : 0.5;
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

		const spline = new SketchSpline({
			id: sid,
			splineType: 'fit',
			pointIds: actualPointIds,
			tangentLineIds: actualTangentLineIds,
			isClosed: closed,
			isConstruction,
		});
		this.splines.set(sid, spline);

		if (actualTangentLineIds) {
			for (const lid of actualTangentLineIds) {
				const line = this.lines.get(lid);
				if (line) {
					line.parentSplineId = sid;
					line.isAutomaticSplineHandle ??= false;
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
		knots?: number[],
		tangentLineIds?: string[]
	): SketchSpline {
		this.pushHistory();
		const sid = id || this.nextId('Spline');

		const actualPointIds = [...pointIds];
		let actualTangentLineIds = tangentLineIds ? [...tangentLineIds] : undefined;

		if (!actualTangentLineIds) {
			actualTangentLineIds = [];
			for (let i = 0; i < actualPointIds.length - 1; i++) {
				const p1Id = actualPointIds[i];
				const p2Id = actualPointIds[i + 1];
				const lineId = this.nextId('Line');
				const hLine = new SketchLine({
					id: lineId,
					p1Id,
					p2Id,
					isConstruction: true,
					isSplineHandle: true,
					parentSplineId: sid,
				});
				this.lines.set(lineId, hLine);
				actualTangentLineIds.push(lineId);
			}
		} else {
			for (const lid of actualTangentLineIds) {
				const line = this.lines.get(lid);
				if (line) {
					line.parentSplineId = sid;
					line.isSplineHandle = true;
				}
			}
		}

		const spline = new SketchSpline({
			id: sid,
			splineType: 'control',
			pointIds: actualPointIds,
			tangentLineIds: actualTangentLineIds,
			knots: knots ? [...knots] : undefined,
			isClosed: false,
			isConstruction,
		});
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
		if (c instanceof ArcEndpointsConstraint || c.type === 'arc_endpoints') return;
		if (c instanceof EllipticalArcEndpointsConstraint || c.type === 'elliptical_arc_endpoints') return;
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

	addCoincidentConstraints(pointIds: Iterable<string>): boolean {
		const ids = new Set(pointIds);
		const hasOrigin = ids.delete('origin');
		const [anchor, ...others] = ids;
		if (!anchor || (!hasOrigin && others.length === 0)) return false;
		if ([...ids].some(id => !this.points.has(id))) return false;

		// Coincidence is transitive, so any selected segment endpoints would collapse the segment.
		if ([...this.lines.values()].some(line => ids.has(line.p1Id) && ids.has(line.p2Id))) return false;

		this.beginTransaction();
		if (hasOrigin) {
			for (const id of ids) this.addOriginCoincidentConstraint(id);
		} else {
			for (const id of others) this.addCoincidentConstraint(anchor, id);
		}
		this.commitTransaction();
		return true;
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

	hasDistanceConstraint(p1Id: string, p2Id: string, orientation?: 'aligned' | 'horizontal' | 'vertical'): boolean {
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

		const dir = sub(p2, p1);
		const lineLen = Math.max(Math.hypot(dir.x, dir.y), 1e-7);
		const signedArea = cross(sub(pt, p1), dir);
		const measured = Math.abs(signedArea) / lineLen;
		const side = signedArea >= 0 ? 1 : -1;

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

	getOriginConstraint(
		pointId: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): OriginDistanceConstraint | undefined {
		for (const c of this.constraints.values()) {
			if (c instanceof OriginDistanceConstraint && c.pointId === pointId) {
				if (orientation === undefined || c.orientation === orientation) {
					return c;
				}
			}
		}
		return undefined;
	}

	hasOriginConstraint(pointId: string, orientation?: 'aligned' | 'horizontal' | 'vertical'): boolean {
		return this.getOriginConstraint(pointId, orientation) !== undefined;
	}

	addOriginDistanceConstraint(
		pointId: string,
		targetDist?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned',
		offset?: number
	): OriginDistanceConstraint | null {
		const pt = this.points.get(pointId);
		if (!pt) return null;

		const existing = this.getOriginConstraint(pointId, orientation);
		if (existing && !existing.isCoincident) {
			let changed = false;
			if (offset !== undefined && existing.offset !== offset) {
				existing.offset = offset;
			}
			if (orientation !== undefined && existing.orientation !== orientation) {
				existing.orientation = orientation;
				changed = true;
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

		let measured = Math.hypot(pt.x, pt.y);
		let side = 1;
		if (orientation === 'horizontal') {
			measured = Math.abs(pt.x);
			side = pt.x >= 0 ? 1 : -1;
		} else if (orientation === 'vertical') {
			measured = Math.abs(pt.y);
			side = pt.y >= 0 ? 1 : -1;
		}

		const currentDist = targetDist ?? Math.max(0.01, Number(measured.toFixed(2)));
		const c = new OriginDistanceConstraint(
			this.nextId('c_origin_dist'),
			pointId,
			currentDist,
			orientation,
			offset,
			false,
			side
		);
		this.addConstraint(c);
		return c;
	}

	addOriginCoincidentConstraint(pointId: string): OriginDistanceConstraint | null {
		const pt = this.points.get(pointId);
		if (!pt) return null;

		const existing = this.getOriginConstraint(pointId, 'aligned');
		if (existing && existing.isCoincident) {
			return existing;
		}

		const c = new OriginDistanceConstraint(this.nextId('c_origin_coinc'), pointId, 0, 'aligned', undefined, true);
		this.addConstraint(c);
		return c;
	}

	getPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): OriginDistanceConstraint | undefined {
		const orientation = axis === 'x' ? 'vertical' : 'horizontal';
		return this.getOriginConstraint(pointId, orientation);
	}

	hasPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): boolean {
		return this.getPointToAxisConstraint(pointId, axis) !== undefined;
	}

	addPointToAxisDistanceConstraint(
		pointId: string,
		axis: 'x' | 'y',
		targetDist?: number,
		offset?: number
	): OriginDistanceConstraint | null {
		return this.addOriginDistanceConstraint(pointId, targetDist, axis === 'x' ? 'vertical' : 'horizontal', offset);
	}

	addPointOnAxisConstraint(pointId: string, axis: 'x' | 'y'): OriginDistanceConstraint | null {
		const pt = this.points.get(pointId);
		if (!pt) return null;

		const existing = this.getPointToAxisConstraint(pointId, axis);
		if (existing && existing.targetDistance === 0) {
			return existing;
		}

		const orientation = axis === 'x' ? 'vertical' : 'horizontal';
		const c = new OriginDistanceConstraint(this.nextId('c_pt_axis_on'), pointId, 0, orientation, undefined, false, 1);
		this.addConstraint(c);
		return c;
	}

	getLineToAxisConstraint(lineId: string, axis: 'x' | 'y'): LineToAxisDistanceConstraint | undefined {
		for (const c of this.constraints.values()) {
			if (c instanceof LineToAxisDistanceConstraint && c.lineId === lineId && c.axis === axis) {
				return c;
			}
		}
		return undefined;
	}

	hasLineToAxisConstraint(lineId: string, axis: 'x' | 'y'): boolean {
		return this.getLineToAxisConstraint(lineId, axis) !== undefined;
	}

	addLineToAxisDistanceConstraint(
		lineId: string,
		axis: 'x' | 'y',
		targetDist?: number,
		offset?: number
	): LineToAxisDistanceConstraint | null {
		const line = this.lines.get(lineId);
		if (!line) return null;
		const p1 = this.points.get(line.p1Id);
		const p2 = this.points.get(line.p2Id);
		if (!p1 || !p2) return null;

		const existing = this.getLineToAxisConstraint(lineId, axis);
		if (existing && !existing.isCollinear) {
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

		const midVal = axis === 'x' ? (p1.y + p2.y) * 0.5 : (p1.x + p2.x) * 0.5;
		const side = midVal >= 0 ? 1 : -1;
		const measured = Math.abs(midVal);
		const currentDist = targetDist ?? Math.max(0.01, Number(measured.toFixed(2)));

		const c = new LineToAxisDistanceConstraint(
			this.nextId('c_line_axis_dist'),
			lineId,
			line.p1Id,
			line.p2Id,
			axis,
			currentDist,
			side,
			offset,
			false
		);
		this.addConstraint(c);
		return c;
	}

	addLineCollinearWithAxisConstraint(lineId: string, axis: 'x' | 'y'): LineToAxisDistanceConstraint | null {
		const line = this.lines.get(lineId);
		if (!line) return null;
		const p1 = this.points.get(line.p1Id);
		const p2 = this.points.get(line.p2Id);
		if (!p1 || !p2) return null;

		const existing = this.getLineToAxisConstraint(lineId, axis);
		if (existing && existing.isCollinear) {
			return existing;
		}

		const c = new LineToAxisDistanceConstraint(
			this.nextId('c_line_axis_collinear'),
			lineId,
			line.p1Id,
			line.p2Id,
			axis,
			0,
			1,
			undefined,
			true
		);
		this.addConstraint(c);
		return c;
	}

	calculateLinesAngleGeometry(
		p1: SketchPoint,
		p2: SketchPoint,
		p3: SketchPoint,
		p4: SketchPoint,
		cursorPos?: { x: number; y: number },
		line1Id?: string,
		line2Id?: string
	): {
		pInt: { x: number; y: number };
		u1: { x: number; y: number };
		u2: { x: number; y: number };
		s1: number;
		s2: number;
		initialAngleDeg: number;
		sign: number;
	} {
		const isAxis1 = Boolean(
			(line1Id && BUILT_IN_LINES.has(line1Id)) || BUILT_IN_LINES.has(p1.id) || BUILT_IN_LINES.has(p2.id)
		);
		const isAxis2 = Boolean(
			(line2Id && BUILT_IN_LINES.has(line2Id)) || BUILT_IN_LINES.has(p3.id) || BUILT_IN_LINES.has(p4.id)
		);

		const v1 = sub(p2, p1);
		const v2 = sub(p4, p3);
		const l1 = Math.max(Math.hypot(v1.x, v1.y), 1e-7);
		const l2 = Math.max(Math.hypot(v2.x, v2.y), 1e-7);

		// Direction unit vectors along the raw segments (p1->p2, p3->p4)
		const e1 = scale(v1, 1.0 / l1);
		const e2 = scale(v2, 1.0 / l2);

		let pInt: { x: number; y: number };
		let defS1 = 1;
		let defS2 = 1;

		if (!isAxis1 && !isAxis2 && (p1.id === p3.id || (Math.abs(p1.x - p3.x) < 1e-4 && Math.abs(p1.y - p3.y) < 1e-4))) {
			pInt = { x: p1.x, y: p1.y };
			defS1 = 1;
			defS2 = 1;
		} else if (
			!isAxis1 &&
			!isAxis2 &&
			(p1.id === p4.id || (Math.abs(p1.x - p4.x) < 1e-4 && Math.abs(p1.y - p4.y) < 1e-4))
		) {
			pInt = { x: p1.x, y: p1.y };
			defS1 = 1;
			defS2 = -1;
		} else if (
			!isAxis1 &&
			!isAxis2 &&
			(p2.id === p3.id || (Math.abs(p2.x - p3.x) < 1e-4 && Math.abs(p2.y - p3.y) < 1e-4))
		) {
			pInt = { x: p2.x, y: p2.y };
			defS1 = -1;
			defS2 = 1;
		} else if (
			!isAxis1 &&
			!isAxis2 &&
			(p2.id === p4.id || (Math.abs(p2.x - p4.x) < 1e-4 && Math.abs(p2.y - p4.y) < 1e-4))
		) {
			pInt = { x: p2.x, y: p2.y };
			defS1 = -1;
			defS2 = -1;
		} else {
			const det = cross(v1, v2);
			if (Math.abs(det) < 1e-6) {
				if (isAxis2) {
					const m1 = mid(p1, p2);
					pInt = { x: m1.x * Math.abs(e2.x), y: m1.y * Math.abs(e2.y) };
					defS1 = 1;
					defS2 = dot(v1, e2) >= 0 ? 1 : -1;
				} else if (isAxis1) {
					const m2 = mid(p3, p4);
					pInt = { x: m2.x * Math.abs(e1.x), y: m2.y * Math.abs(e1.y) };
					defS2 = 1;
					defS1 = dot(v2, e1) >= 0 ? 1 : -1;
				} else {
					pInt = mid(p1, p3);
					defS1 = 1;
					defS2 = 1;
				}
			} else {
				const t = cross(sub(p3, p1), v2) / det;
				pInt = addScaled(p1, v1, t);
				let m1 = mid(p1, p2);
				let m2 = mid(p3, p4);
				if (isAxis2) {
					m2 = { x: m1.x * Math.abs(e2.x), y: m1.y * Math.abs(e2.y) };
				} else if (isAxis1) {
					m1 = { x: m2.x * Math.abs(e1.x), y: m2.y * Math.abs(e1.y) };
				}
				const w1 = sub(m1, pInt);
				const w2 = sub(m2, pInt);
				defS1 = dot(w1, v1) >= 0 ? 1 : -1;
				defS2 = dot(w2, v2) >= 0 ? 1 : -1;
			}
		}

		// Default rays pointing along the physical segments from pInt:
		const u1Seg = scale(e1, defS1);
		const u2Seg = scale(e2, defS2);

		let s1 = defS1;
		let s2 = defS2;

		if (cursorPos) {
			const w = sub(cursorPos, pInt);
			const wLen = Math.hypot(w.x, w.y);
			if (wLen > 1e-3) {
				// Decompose w in the basis of (u1Seg, u2Seg):
				// w = alpha * u1Seg + beta * u2Seg
				const detSeg = cross(u1Seg, u2Seg);
				if (Math.abs(detSeg) > 1e-6) {
					const alpha = cross(w, u2Seg) / detSeg;
					const beta = cross(u1Seg, w) / detSeg;
					const signAlpha = alpha >= 0 ? 1 : -1;
					const signBeta = beta >= 0 ? 1 : -1;
					s1 = signAlpha * defS1;
					s2 = signBeta * defS2;
				}
			}
		}

		const u1 = scale(v1, s1 / l1);
		const u2 = scale(v2, s2 / l2);

		const dotVal = Math.min(1, Math.max(-1, dot(u1, u2)));
		const initialAngleDeg = (Math.acos(dotVal) * 180) / Math.PI;
		const crossVal = cross(u1, u2);
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
		const l1 = this.getLine(line1Id);
		const l2 = this.getLine(line2Id);
		if (!l1 || !l2 || (!this.lines.has(line1Id) && !this.lines.has(line2Id))) return null;

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
		const geom = this.calculateLinesAngleGeometry(p1, p2, p3, p4, cursorPos, line1Id, line2Id);

		const s1 = typeof cursorPosOrS1 === 'number' ? cursorPosOrS1 : geom.s1;
		const s2 = typeof s2Param === 'number' ? s2Param : geom.s2;
		const sign = typeof signParam === 'number' ? signParam : geom.sign;

		const angleVal = targetAngleDeg ?? Math.max(0.1, Math.min(179.9, Math.round(geom.initialAngleDeg * 10) / 10));
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

	addThreePointAngleConstraint(
		p1Id: string,
		p2Id: string,
		p3Id: string,
		targetAngleDeg?: number,
		arcRadius?: number,
		s1Param?: number,
		s2Param?: number,
		signParam?: number
	): AngleConstraint | null {
		if (p1Id === p2Id || p2Id === p3Id || p1Id === p3Id) return null;
		const p1 = this.points.get(p1Id);
		const p2 = this.points.get(p2Id);
		const p3 = this.points.get(p3Id);
		if (!p1 || !p2 || !p3) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof AngleConstraint &&
				!c.line1Id &&
				!c.line2Id &&
				c.l1P1 === p2Id &&
				c.l2P1 === p2Id &&
				((c.l1P2 === p1Id && c.l2P2 === p3Id) || (c.l1P2 === p3Id && c.l2P2 === p1Id))
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

		const geom = this.calculateLinesAngleGeometry(p2, p1, p2, p3);
		const s1 = typeof s1Param === 'number' ? s1Param : 1;
		const s2 = typeof s2Param === 'number' ? s2Param : 1;
		const sign = typeof signParam === 'number' ? signParam : geom.sign;

		const angleVal = targetAngleDeg ?? Math.max(0.1, Math.min(179.9, Math.round(geom.initialAngleDeg * 10) / 10));
		const radiusVal = arcRadius ?? 40;

		const c = new AngleConstraint(
			this.nextId('c_ang'),
			'',
			'',
			p2Id,
			p1Id,
			p2Id,
			p3Id,
			angleVal,
			radiusVal,
			s1,
			s2,
			sign
		);
		this.addConstraint(c);
		return c;
	}

	addArcAngleConstraint(arcId: string, targetAngleDeg: number, arcRadius = 40, sweepSign = 1): AngleConstraint | null {
		const arc = this.arcs.get(arcId);
		if (!arc) return null;
		const pCenter = this.points.get(arc.centerId);
		const pStart = this.points.get(arc.startPointId);
		const pEnd = this.points.get(arc.endPointId);
		if (!pCenter || !pStart || !pEnd) return null;

		const c = new AngleConstraint(
			this.nextId('c_ang'),
			arc.id,
			arc.id,
			arc.centerId,
			arc.startPointId,
			arc.centerId,
			arc.endPointId,
			targetAngleDeg,
			arcRadius,
			1,
			1,
			sweepSign >= 0 ? 1 : -1
		);
		this.addConstraint(c);
		return c;
	}

	addRadiusConstraint(
		circleOrArcId: string,
		targetRadius?: number,
		displayMode?: 'radius' | 'diameter',
		placement?: Pick<RadiusConstraint, 'leaderAngle' | 'leaderOffset'>
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
				existing.name = mode === 'diameter' ? `Diameter (${valStr})` : `Radius (${valStr})`;
				this.solve();
			}
			return existing;
		}

		const r = targetRadius ?? Math.max(0.01, Number(entity.radius.toFixed(2)));
		const c = new RadiusConstraint(this.nextId('c_rad'), circleOrArcId, r, 1.0, placement?.leaderAngle, defaultMode);
		c.leaderOffset = placement?.leaderOffset;
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
				((this.matchesEndpoints(c.line1P1, c.line1P2, l1.p1Id, l1.p2Id) &&
					this.matchesEndpoints(c.line2P1, c.line2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.line1P1, c.line1P2, l2.p1Id, l2.p2Id) &&
						this.matchesEndpoints(c.line2P1, c.line2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as EqualLengthConstraint;

		const c = new EqualLengthConstraint(this.nextId('c_eqlen'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
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
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) &&
					this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) &&
						this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as ParallelConstraint;

		const c = new ParallelConstraint(this.nextId('c_par'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
		this.addConstraint(c);
		return c;
	}

	private partitionThreePointsByMiddle(
		p1Id: string,
		p2Id: string,
		p3Id: string
	): { midId: string; end1Id: string; end2Id: string } | null {
		if (p1Id === p2Id || p2Id === p3Id || p1Id === p3Id) return null;
		const p1 = this.points.get(p1Id);
		const p2 = this.points.get(p2Id);
		const p3 = this.points.get(p3Id);
		if (!p1 || !p2 || !p3) return null;

		const d1 = Math.hypot(p1.x - 0.5 * (p2.x + p3.x), p1.y - 0.5 * (p2.y + p3.y));
		const d2 = Math.hypot(p2.x - 0.5 * (p1.x + p3.x), p2.y - 0.5 * (p1.y + p3.y));
		const d3 = Math.hypot(p3.x - 0.5 * (p1.x + p2.x), p3.y - 0.5 * (p1.y + p2.y));

		if (d1 <= d2 && d1 <= d3) {
			return { midId: p1Id, end1Id: p2Id, end2Id: p3Id };
		}
		if (d2 <= d1 && d2 <= d3) {
			return { midId: p2Id, end1Id: p1Id, end2Id: p3Id };
		}
		return { midId: p3Id, end1Id: p1Id, end2Id: p2Id };
	}

	addThreePointCollinearConstraint(p1Id: string, p2Id: string, p3Id: string): CollinearConstraint | null {
		const part = this.partitionThreePointsByMiddle(p1Id, p2Id, p3Id);
		if (!part) return null;
		const { midId, end1Id, end2Id } = part;

		const targetSet = new Set([p1Id, p2Id, p3Id]);
		const existing = [...this.constraints.values()].find(c => {
			if (!(c instanceof CollinearConstraint) || !c.isThreePoint()) return false;
			const cSet = new Set([c.l1P1, c.l1P2, c.l2P1, c.l2P2]);
			return cSet.size === 3 && [...targetSet].every(id => cSet.has(id));
		});
		if (existing) return existing as CollinearConstraint;

		const c = new CollinearConstraint(this.nextId('c_collin'), end1Id, midId, midId, end2Id);
		this.addConstraint(c);
		return c;
	}

	addCollinearConstraint(
		line1Id: string,
		line2Id: string,
		p3Id?: string
	): CollinearConstraint | LineToAxisDistanceConstraint | null {
		if (p3Id !== undefined) {
			return this.addThreePointCollinearConstraint(line1Id, line2Id, p3Id);
		}
		if (line1Id === line2Id) return null;
		const isAxis1 = line1Id === 'axis_x' || line1Id === 'axis_y';
		const isAxis2 = line2Id === 'axis_x' || line2Id === 'axis_y';
		if (isAxis1 && isAxis2) return null;
		if (isAxis1 || isAxis2) {
			const axis = isAxis1 ? (line1Id === 'axis_x' ? 'x' : 'y') : line2Id === 'axis_x' ? 'x' : 'y';
			const userLineId = isAxis1 ? line2Id : line1Id;
			return this.addLineCollinearWithAxisConstraint(userLineId, axis);
		}

		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof CollinearConstraint &&
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) &&
					this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) &&
						this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
		);
		if (existing) return existing as CollinearConstraint;

		const c = new CollinearConstraint(this.nextId('c_collin'), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id);
		this.addConstraint(c);
		return c;
	}

	addSymmetryConstraint(p1Id: string, p2Id: string, lineId: string): SymmetryConstraint | null {
		if (p1Id === p2Id) return null;
		if (!this.points.get(p1Id) || !this.points.get(p2Id)) return null;

		const isOriginAxis = lineId === 'origin';
		const isBuiltIn = isOriginAxis || BUILT_IN_LINES.has(lineId);
		if (isBuiltIn && (p1Id === 'origin' || p2Id === 'origin')) {
			return null;
		}
		const line = isOriginAxis ? null : this.getLine(lineId);
		if (!isOriginAxis && !line) return null;
		if (line && (p1Id === line.p1Id || p1Id === line.p2Id || p2Id === line.p1Id || p2Id === line.p2Id)) {
			// If one of the points is an endpoint of the symmetry line itself, cannot be symmetric to a distinct point
			if (p1Id === line.p1Id && p2Id === line.p2Id) return null;
			if (p1Id === line.p2Id && p2Id === line.p1Id) return null;
		}

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof SymmetryConstraint &&
				((c.p1Id === p1Id && c.p2Id === p2Id) || (c.p1Id === p2Id && c.p2Id === p1Id)) &&
				(isOriginAxis
					? c.lineId === 'origin'
					: c.lineId === line!.id || this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line!.p1Id, line!.p2Id))
		);
		if (existing) return existing as SymmetryConstraint;

		const c = new SymmetryConstraint(
			this.nextId('c_symm'),
			p1Id,
			p2Id,
			line ? line.p1Id : '',
			line ? line.p2Id : '',
			1.0,
			isOriginAxis ? 'origin' : line!.id
		);
		this.addConstraint(c);
		return c;
	}

	addLineSymmetryConstraints(line1Id: string, line2Id: string, axisId: string): IConstraint[] {
		if (line1Id === line2Id || line1Id === axisId || line2Id === axisId) return [];
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return [];

		const p11 = this.points.get(l1.p1Id);
		const p12 = this.points.get(l1.p2Id);
		const p21 = this.points.get(l2.p1Id);
		const p22 = this.points.get(l2.p2Id);
		if (!p11 || !p12 || !p21 || !p22) return [];

		const reflectAcrossAxis = (p: Vec2): Vec2 => {
			if (axisId === 'origin') {
				return scale(p, -1);
			}
			const axisLine = this.getLine(axisId);
			if (axisLine) {
				const a = this.points.get(axisLine.p1Id);
				const b = this.points.get(axisLine.p2Id);
				if (a && b) {
					const dir = sub(b, a);
					const lenSq = dot(dir, dir);
					if (lenSq > 1e-12) {
						const len = Math.sqrt(lenSq);
						const normal = vec(-dir.y / len, dir.x / len);
						return reflectPoint(p, a, normal);
					}
				}
			}
			return p;
		};

		let swap = false;
		if (l1.p1Id === l2.p2Id || l1.p2Id === l2.p1Id) {
			swap = true;
		} else if (l1.p1Id === l2.p1Id || l1.p2Id === l2.p2Id) {
			swap = false;
		} else {
			const r1 = reflectAcrossAxis(p11);
			const r2 = reflectAcrossAxis(p12);
			const costDirect = (r1.x - p21.x) ** 2 + (r1.y - p21.y) ** 2 + (r2.x - p22.x) ** 2 + (r2.y - p22.y) ** 2;
			const costSwapped = (r1.x - p22.x) ** 2 + (r1.y - p22.y) ** 2 + (r2.x - p21.x) ** 2 + (r2.y - p21.y) ** 2;
			swap = costSwapped < costDirect;
		}

		const pairs: [string, string][] = swap
			? [
					[l1.p1Id, l2.p2Id],
					[l1.p2Id, l2.p1Id],
				]
			: [
					[l1.p1Id, l2.p1Id],
					[l1.p2Id, l2.p2Id],
				];

		const created: IConstraint[] = [];
		this.beginTransaction();
		for (const [paId, pbId] of pairs) {
			if (paId === pbId) {
				let c: IConstraint | null = null;
				if (axisId === 'axis_x') {
					c = this.addPointOnAxisConstraint(paId, 'x');
				} else if (axisId === 'axis_y') {
					c = this.addPointOnAxisConstraint(paId, 'y');
				} else if (axisId === 'origin') {
					c = this.addOriginCoincidentConstraint(paId);
				} else {
					c = this.addPointOnLineConstraint(paId, axisId);
				}
				if (c) created.push(c);
			} else {
				const c = this.addSymmetryConstraint(paId, pbId, axisId);
				if (c) created.push(c);
			}
		}
		this.commitTransaction();
		return created;
	}

	generatePatternCopy(
		centerPtId: string,
		sourceObjectIds: string[],
		copyIndex: number,
		quantity: number,
		distribution: 'full' | 'partial' | 'symmetric',
		totalAngle: number
	): PatternCopyData | null {
		return generateCircularPatternCopy(
			this,
			centerPtId,
			sourceObjectIds,
			copyIndex,
			quantity,
			distribution,
			totalAngle
		);
	}

	deletePatternCopy(copy: PatternCopyData): void {
		deletePatternCopy(this, copy);
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
		isReadOnly?: boolean,
		totalAngleExpression?: string
	): CircularPatternConstraint | null {
		return addCircularPatternConstraint(
			this,
			centerPtId,
			sourceObjectIds,
			distribution,
			totalAngle,
			quantity,
			suppression,
			suppressedIndices,
			copies,
			id,
			isReadOnly,
			totalAngleExpression
		);
	}

	updateCircularPattern(
		constraintId: string,
		updates: {
			distribution?: 'full' | 'partial' | 'symmetric';
			totalAngle?: number;
			totalAngleExpression?: string;
			quantity?: number;
			suppression?: boolean;
			suppressedIndices?: number[];
		}
	): boolean {
		return updateCircularPattern(this, constraintId, updates);
	}

	addPolygon(
		centerPointId: string,
		radius: number,
		sides: number,
		angleRad: number,
		isConstruction = false,
		addDistanceConstraint = false,
		options: { radiusToVertex?: boolean; vertexIds?: readonly string[]; radiusExpression?: string } = {}
	): {
		centerPoint: SketchPoint;
		vertices: SketchPoint[];
		lines: SketchLine[];
		constraint: CircularPatternConstraint;
		distanceConstraint?: PointToLineDistanceConstraint;
		vertexDistanceConstraint?: DistanceConstraint;
	} | null {
		const centerPt = this.points.get(centerPointId);
		if (!centerPt) return null;

		const N = Math.max(3, Math.round(sides));
		if (!Number.isFinite(radius) || radius <= 1e-4) return null;
		const existingVertices = (options.vertexIds ?? []).map(id => this.points.get(id));
		if (existingVertices.some(point => !point)) return null;

		this.beginTransaction();

		const R = options.radiusToVertex ? radius : radius / Math.cos(Math.PI / N);
		const baseAngle = options.radiusToVertex ? angleRad : angleRad - Math.PI / N;
		const step = (2 * Math.PI) / N;

		const vertices: SketchPoint[] = [];
		for (let k = 0; k < N; k++) {
			const a = baseAngle + k * step;
			const v = vec(centerPt.x + R * Math.cos(a), centerPt.y + R * Math.sin(a));
			const pt = existingVertices[k] ?? this.addPoint(v, false);
			vertices.push(pt);
		}

		const lines: SketchLine[] = [];
		for (let k = 0; k < N; k++) {
			const nextK = (k + 1) % N;
			const p1Id = vertices[k].id;
			const p2Id = vertices[nextK].id;
			const existingEdge =
				k === 0 && existingVertices.length === 2
					? [...this.lines.values()].find(
							line =>
								line.isConstruction === isConstruction &&
								((line.p1Id === p1Id && line.p2Id === p2Id) || (line.p1Id === p2Id && line.p2Id === p1Id))
						)
					: undefined;
			lines.push(existingEdge ?? this.addLine(p1Id, p2Id, isConstruction));
		}

		const copies: PatternCopyData[] = [];
		for (let k = 1; k < N; k++) {
			copies.push({
				copyIndex: k,
				pointPairs: [{ sourcePtId: vertices[0].id, patternPtId: vertices[k].id }],
				createdEntityIds: existingVertices[k] ? [] : [{ id: vertices[k].id, type: 'point' }],
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
		let vertexDistanceConstraint: DistanceConstraint | undefined;
		if (addDistanceConstraint) {
			if (options.radiusToVertex) {
				vertexDistanceConstraint = this.addDistanceConstraint(centerPointId, vertices[0].id, radius) ?? undefined;
			} else {
				distanceConstraint = this.addPointToLineDistanceConstraint(centerPointId, lines[0].id, radius) ?? undefined;
			}
			const radiusConstraint = vertexDistanceConstraint ?? distanceConstraint;
			if (radiusConstraint && options.radiusExpression) radiusConstraint.expression = options.radiusExpression;
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
			vertexDistanceConstraint,
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
		return generateRectangularPatternCopy(
			this,
			sourceObjectIds,
			i,
			j,
			distance1,
			direction1,
			distance2,
			direction2,
			u1,
			u2
		);
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
		id?: string,
		distance1Expression?: string,
		distance2Expression?: string
	): RectangularPatternConstraint | null {
		return addRectangularPatternConstraint(
			this,
			sourceObjectIds,
			line1Id,
			line2Id,
			quantity1,
			distance1,
			direction1,
			quantity2,
			distance2,
			direction2,
			suppression,
			suppressedIndices,
			copies,
			id,
			distance1Expression,
			distance2Expression
		);
	}

	updateRectangularPattern(
		constraintId: string,
		updates: {
			line1Id?: string | null;
			line2Id?: string | null;
			quantity1?: number;
			distance1?: number;
			distance1Expression?: string;
			direction1?: 'one_direction' | 'symmetric';
			quantity2?: number;
			distance2?: number;
			distance2Expression?: string;
			direction2?: 'one_direction' | 'symmetric';
			suppression?: boolean;
			suppressedIndices?: number[];
		}
	): boolean {
		return updateRectangularPattern(this, constraintId, updates);
	}

	addPerpendicularConstraint(line1Id: string, line2Id: string): PerpendicularConstraint | null {
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof PerpendicularConstraint &&
				((this.matchesEndpoints(c.l1P1, c.l1P2, l1.p1Id, l1.p2Id) &&
					this.matchesEndpoints(c.l2P1, c.l2P2, l2.p1Id, l2.p2Id)) ||
					(this.matchesEndpoints(c.l1P1, c.l1P2, l2.p1Id, l2.p2Id) &&
						this.matchesEndpoints(c.l2P1, c.l2P2, l1.p1Id, l1.p2Id)))
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
			c => c instanceof PointOnCircleConstraint && c.pointId === pointId && c.circleId === circleOrArcId
		);
		if (existing) return null;

		const c = new PointOnCircleConstraint(this.nextId('c_ptcirc'), pointId, circle.centerId, circleOrArcId);
		this.addConstraint(c);
		return c;
	}

	addPointOnEllipseConstraint(pointId: string, ellipseOrArcId: string): PointOnEllipseConstraint | null {
		const el = this.ellipses.get(ellipseOrArcId) ?? this.ellipticalArcs.get(ellipseOrArcId);
		if (!el) return null;

		if (pointId === el.centerId || pointId === el.majorAxisPointId || pointId === el.minorAxisPointId) {
			return null;
		}
		if (el instanceof SketchEllipticalArc && (pointId === el.startPointId || pointId === el.endPointId)) {
			return null;
		}

		const existing = [...this.constraints.values()].find(
			c => c instanceof PointOnEllipseConstraint && c.pointId === pointId && c.ellipseId === ellipseOrArcId
		);
		if (existing) return null;

		const c = new PointOnEllipseConstraint(
			this.nextId('c_ptel'),
			pointId,
			ellipseOrArcId,
			el.centerId,
			el.majorAxisPointId,
			el.minorAxisPointId
		);
		this.addConstraint(c);
		return c;
	}

	addPointOnSplineConstraint(pointId: string, splineId: string): PointOnSplineConstraint | null {
		const spline = this.splines.get(splineId);
		if (!spline) return null;

		if (spline.pointIds.includes(pointId)) return null;
		if (this.isSplineHandlePoint(pointId)) return null;

		const existing = [...this.constraints.values()].find(
			c => c instanceof PointOnSplineConstraint && c.pointId === pointId && c.splineId === splineId
		);
		if (existing) return null;

		const handlePoints: Array<{ p1Id: string; p2Id: string }> = [];
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				const l = this.lines.get(lid);
				if (l) handlePoints.push({ p1Id: l.p1Id, p2Id: l.p2Id });
			}
		}

		const c = new PointOnSplineConstraint(
			this.nextId('c_ptspline'),
			pointId,
			spline.id,
			spline.splineType,
			[...spline.pointIds],
			handlePoints.length > 0 ? handlePoints : undefined,
			spline.tangentLineIds ? [...spline.tangentLineIds] : undefined,
			spline.knots ? [...spline.knots] : undefined,
			spline.isClosed
		);
		this.addConstraint(c);
		return c;
	}

	addTangentConstraint(
		entity1Id: string,
		entity2Id: string
	): TangentLineCircleConstraint | TangentCircleCircleConstraint | null {
		const line1 = this.getLine(entity1Id);
		const line2 = this.getLine(entity2Id);
		const circ1 = this.circles.get(entity1Id) ?? this.arcs.get(entity1Id);
		const circ2 = this.circles.get(entity2Id) ?? this.arcs.get(entity2Id);

		// Case 1: Line (or Coordinate Axis) and Circle/Arc
		if ((line1 && circ2) || (line2 && circ1)) {
			const line = line1 ?? line2!;
			const circ = circ2 ?? circ1!;

			const existing = [...this.constraints.values()].find(
				c =>
					c instanceof TangentLineCircleConstraint &&
					c.circleId === circ.id &&
					(c.lineId === line.id || this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id))
			);
			if (existing) return existing as TangentLineCircleConstraint;

			const c = new TangentLineCircleConstraint(
				this.nextId('c_tang'),
				line.p1Id,
				line.p2Id,
				circ.centerId,
				circ.id,
				this.getTangentSide(line, circ.centerId),
				1.0,
				line.id
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

			let sharedPointId: string | null = null;
			const arc1 = this.arcs.get(circ1.id);
			const arc2 = this.arcs.get(circ2.id);
			if (arc1 && arc2) {
				if (arc1.startPointId === arc2.startPointId || arc1.startPointId === arc2.endPointId) {
					sharedPointId = arc1.startPointId;
				} else if (arc1.endPointId === arc2.startPointId || arc1.endPointId === arc2.endPointId) {
					sharedPointId = arc1.endPointId;
				}
			}

			const c = new TangentCircleCircleConstraint(
				this.nextId('c_tang'),
				circ1.centerId,
				circ1.id,
				circ2.centerId,
				circ2.id,
				isInternal,
				outerCircleId,
				1.0,
				sharedPointId
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
		const dir = sub(p2, p1);
		return cross(sub(center, p1), dir) >= 0 ? 1 : -1;
	}

	addConcentricConstraint(c1Id: string, c2Id: string): ConcentricConstraint | null {
		const circ1 = this.circles.get(c1Id) ?? this.arcs.get(c1Id);
		const circ2 = this.circles.get(c2Id) ?? this.arcs.get(c2Id);
		if (!circ1 || !circ2) return null;

		const c = new ConcentricConstraint(this.nextId('c_concen'), circ1.centerId, circ2.centerId);
		this.addConstraint(c);
		return c;
	}

	addMidpointConstraint(pointId: string, lineOrP1Id: string, p2Id?: string): MidpointConstraint | null {
		if (!this.points.get(pointId)) return null;

		let end1Id: string;
		let end2Id: string;
		if (p2Id !== undefined) {
			if (lineOrP1Id === p2Id) return null;
			if (!this.points.get(lineOrP1Id) || !this.points.get(p2Id)) return null;
			end1Id = lineOrP1Id;
			end2Id = p2Id;
		} else {
			const line = this.lines.get(lineOrP1Id);
			if (!line) return null;
			end1Id = line.p1Id;
			end2Id = line.p2Id;
		}

		if (pointId === end1Id || pointId === end2Id) return null;

		const existing = [...this.constraints.values()].find(
			c =>
				c instanceof MidpointConstraint && c.midId === pointId && this.matchesEndpoints(c.p1Id, c.p2Id, end1Id, end2Id)
		);
		if (existing) return existing as MidpointConstraint;

		const c = new MidpointConstraint(this.nextId('c_mid'), pointId, end1Id, end2Id);
		this.addConstraint(c);
		return c;
	}

	addThreePointMidpointConstraint(p1Id: string, p2Id: string, p3Id: string): MidpointConstraint | null {
		const part = this.partitionThreePointsByMiddle(p1Id, p2Id, p3Id);
		if (!part) return null;
		return this.addMidpointConstraint(part.midId, part.end1Id, part.end2Id);
	}

	// Helper: check if a point is used by any remaining primitive
	isPointUsed(pointId: string): boolean {
		return isPointUsed(this, pointId);
	}

	isSplineHandleLine(lineId: string): boolean {
		const line = this.lines.get(lineId);
		return !!line?.isSplineHandle;
	}

	isSplineHandlePoint(pointId: string): boolean {
		for (const line of this.lines.values()) {
			if (line.isSplineHandle && (line.p1Id === pointId || line.p2Id === pointId)) {
				const parentSpline = line.parentSplineId ? this.splines.get(line.parentSplineId) : undefined;
				if (parentSpline && parentSpline.pointIds.includes(pointId)) {
					return false;
				}
				return true;
			}
		}
		return false;
	}

	resetFitSplineTangents(selectedLines: string[], selectedPoints: string[]): void {
		for (const spline of this.splines.values()) {
			if (spline.splineType !== 'fit' || !spline.tangentLineIds) continue;
			for (const id of new Set(spline.tangentLineIds)) {
				const line = this.lines.get(id);
				if (
					!line ||
					line.isAutomaticSplineHandle ||
					(!selectedLines.includes(id) && !selectedPoints.includes(line.p1Id) && !selectedPoints.includes(line.p2Id))
				) {
					continue;
				}

				const midpoint = [...this.constraints.values()].find(
					c => c instanceof MidpointConstraint && c.p1Id === line.p1Id && c.p2Id === line.p2Id
				);
				if (!(midpoint instanceof MidpointConstraint)) continue;

				const constrained = [...this.constraints.values()].some(
					c =>
						c !== midpoint &&
						!(c instanceof PointOnSplineConstraint) &&
						c.entityIds.some(entityId => entityId === id || entityId === line.p1Id || entityId === line.p2Id)
				);
				if (constrained || this.points.get(line.p1Id)?.fixed || this.points.get(line.p2Id)?.fixed) continue;

				// Explicit handles can have unequal lengths. The automatic handles are symmetric.
				if (midpoint.ratio !== 0.5) {
					this.constraints.set(
						midpoint.id,
						new MidpointConstraint(midpoint.id, midpoint.midId, midpoint.p1Id, midpoint.p2Id, midpoint.weight)
					);
				}
				line.isAutomaticSplineHandle = true;
			}
		}
	}

	isSplineInternalConstraint(c: IConstraint): boolean {
		if (c instanceof MidpointConstraint || c.type === 'midpoint') {
			const anyC = c as any;
			for (const line of this.lines.values()) {
				if (
					line.isSplineHandle &&
					((line.p1Id === anyC.p1Id && line.p2Id === anyC.p2Id) || (line.p1Id === anyC.p2Id && line.p2Id === anyC.p1Id))
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
		if (elarc)
			return [elarc.centerId, elarc.majorAxisPointId, elarc.minorAxisPointId, elarc.startPointId, elarc.endPointId];

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
				if (!this.points.get(constraint.centerPtId)) {
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
					copy.pointPairs.some(pair => !this.points.has(pair.sourcePtId) || !this.points.has(pair.patternPtId))
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
					!this.points.get(entId) &&
					!this.getLine(entId) &&
					!this.circles.has(entId) &&
					!this.arcs.has(entId) &&
					!this.ellipses.has(entId) &&
					!this.ellipticalArcs.has(entId) &&
					!this.splines.has(entId)
			);
			if (hasMissingEntity) {
				this.constraints.delete(cid);
				this.selection.constraintIds.delete(cid);
				continue;
			}
			if (constraint instanceof SymmetryConstraint) {
				if (
					constraint.lineId &&
					constraint.lineId !== 'origin' &&
					!this.getLine(constraint.lineId) &&
					!this.getLineBetween(constraint.lineP1Id, constraint.lineP2Id)
				) {
					this.constraints.delete(cid);
					this.selection.constraintIds.delete(cid);
				}
			}
		}
	}

	// --- Deletion with cascade ---
	removeEntity(id: string): void {
		if (this.texts.has(id)) {
			this.texts.delete(id);
			this.selection.textIds.delete(id);
			this.notify();
			return;
		}
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
			!this.splines.has(id) &&
			!this.texts.has(id)
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
						if (remaining.length >= 2) {
							spline.pointIds = remaining;
							delete spline.knots;
							if (spline.tangentLineIds) {
								for (const lid of spline.tangentLineIds) {
									this.lines.delete(lid);
									this.selection.lineIds.delete(lid);
								}
							}
							spline.tangentLineIds = [];
							for (let i = 0; i < remaining.length - 1; i++) {
								const lineId = this.nextId('Line');
								const hLine = new SketchLine({
									id: lineId,
									p1Id: remaining[i],
									p2Id: remaining[i + 1],
									isConstruction: true,
									isSplineHandle: true,
									parentSplineId: sid,
								});
								this.lines.set(lineId, hLine);
								spline.tangentLineIds.push(lineId);
							}
						} else {
							for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
							if (spline.tangentLineIds) {
								for (const lid of spline.tangentLineIds) {
									const line = this.lines.get(lid);
									if (line) {
										this.lines.delete(lid);
										this.selection.lineIds.delete(lid);
									}
								}
							}
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
		// Cascade deletion of any text bound to the deleted entity or its rectangle
		for (const [tId, text] of this.texts.entries()) {
			if (text.mode === 'text') {
				if (text.rectanglePointIds?.includes(id) || text.rectangleLineIds?.includes(id)) {
					this.texts.delete(tId);
					this.selection.textIds.delete(tId);
				}
			} else if (text.mode === 'text_on_path') {
				if (text.targetPrimitiveId === id) {
					this.texts.delete(tId);
					this.selection.textIds.delete(tId);
				}
			}
		}
		this.cleanOrphanTexts();

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

	private restoreAutomaticSplineHandles(): void {
		for (const spline of this.splines.values()) {
			if (spline.splineType !== 'fit' || !spline.tangentLineIds) continue;
			const points = spline.pointIds.map(id => this.points.get(id));
			if (points.some(point => !point)) continue;
			const natural = computeNaturalFitHandles(points as SketchPoint[]);
			for (const [index, lineId] of spline.tangentLineIds.entries()) {
				const line = this.lines.get(lineId);
				const handle = natural[index];
				if (!line || line.isAutomaticSplineHandle !== undefined || !handle) continue;
				const p1 = this.points.get(line.p1Id);
				const p2 = this.points.get(line.p2Id);
				// Older snapshots only stored the handle geometry.
				line.isAutomaticSplineHandle = !!p1 && !!p2 && dist(p1, handle.h1) < 1e-5 && dist(p2, handle.h2) < 1e-5;
			}
		}
	}

	private prepareSplineConstraints(
		extraConstraints: IConstraint[],
		lockedParams: Set<string>,
		editedHandles: SketchLine[]
	): IConstraint[] {
		const constraints = [...this.constraints.values(), ...extraConstraints];
		if (this.splines.size === 0) return constraints;
		const splineConstraints: IConstraint[] = [];
		const replaced = new Set<IConstraint>();
		const midpoints = new Map<string, MidpointConstraint>();
		const editedPoints = new Set<string>();
		const constrained = new Set<string>();
		for (const c of constraints) {
			if (c instanceof MidpointConstraint) {
				midpoints.set(c.p1Id, c);
			} else if (!(c instanceof PointOnSplineConstraint)) {
				if (extraConstraints.includes(c) && (c instanceof DragPointConstraint || c instanceof FixedConstraint)) {
					editedPoints.add(c.pointId);
				} else {
					for (const id of c.entityIds) constrained.add(id);
				}
			}
		}

		for (const spline of this.splines.values()) {
			if (spline.splineType !== 'fit' || !spline.tangentLineIds || spline.pointIds.length < 2) continue;
			const points = spline.pointIds.map(id => this.points.get(id));
			if (points.some(point => !point)) continue;
			const natural = computeNaturalFitHandles(points as SketchPoint[]);
			const automatic: { index: number; midpoint: MidpointConstraint }[] = [];
			for (const [index, lineId] of spline.tangentLineIds.entries()) {
				// Closed splines reuse the first tangent at the closing point.
				if (index === spline.pointIds.length - 1 && index > 0 && lineId === spline.tangentLineIds[0]) continue;
				const line = this.lines.get(lineId);
				const fit = points[index];
				if (!line || !fit) continue;
				const midpoint = midpoints.get(line.p1Id);
				const p1 = this.points.get(line.p1Id);
				const p2 = this.points.get(line.p2Id);
				if (!midpoint || midpoint.midId !== fit.id || midpoint.p2Id !== line.p2Id || !p1 || !p2) continue;

				const editP1 = editedPoints.has(p1.id);
				const editP2 = editedPoints.has(p2.id);
				if (editP1 || editP2) {
					editedHandles.push(line);
					lockedParams.add(`${fit.id}.x`);
					lockedParams.add(`${fit.id}.y`);
				}

				if (constrained.has(lineId) || constrained.has(p1.id) || constrained.has(p2.id) || p1.fixed || p2.fixed) {
					continue;
				}

				const ratio = midpoint.ratio;
				const dir: Vec2 = sub(fit, mix(p1, p2, ratio));
				if (editP1 && !editP2 && ratio > 1e-6) {
					Object.assign(p2, addScaled(p2, dir, 1 / ratio));
				} else if (editP2 && !editP1 && 1 - ratio > 1e-6) {
					Object.assign(p1, addScaled(p1, dir, 1 / (1 - ratio)));
				} else if (!editP1 && !editP2 && line.isAutomaticSplineHandle) {
					Object.assign(p1, natural[index].h1);
					Object.assign(p2, natural[index].h2);
					automatic.push({ index, midpoint });
					replaced.add(midpoint);
				} else if (editedPoints.has(fit.id)) {
					Object.assign(p1, add(p1, dir));
					Object.assign(p2, add(p2, dir));
				}
			}
			if (automatic.length > 0) {
				splineConstraints.push(new AutomaticSplineHandlesConstraint(spline.id, spline.pointIds, automatic));
			}
		}
		return [...constraints.filter(c => !replaced.has(c)), ...splineConstraints];
	}

	solve(extraConstraints: IConstraint[] = []): SolverResult {
		const drivenRadii = this.collectDrivenRadii();
		const editedHandles: SketchLine[] = [];
		const activeConstraints = this.prepareSplineConstraints(extraConstraints, drivenRadii, editedHandles);
		for (const line of editedHandles) line.isAutomaticSplineHandle = false;

		// Interactive drags keep the regular behaviour (radius may follow the drag)
		if (extraConstraints.length > 0) {
			const res = this.solver.solve(this.paramManager, activeConstraints, {
				lockedParams: drivenRadii,
			});
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

	getPointDragTarget(pointId: string, target: Vec2): Vec2 {
		return {
			x: this.getPointToAxisConstraint(pointId, 'y')?.targetDistance === 0 ? 0 : target.x,
			y: this.getPointToAxisConstraint(pointId, 'x')?.targetDistance === 0 ? 0 : target.y,
		};
	}

	dragPoint(pointId: string, targetX: number, targetY: number): SolverResult {
		const pt = this.points.get(pointId);
		if (!pt || this.isPointFixed(pointId)) {
			return this.solve();
		}

		// Apply axis locks before automatic spline tangents are seeded for the solve.
		const target = this.getPointDragTarget(pointId, { x: targetX, y: targetY });
		pt.x = target.x;
		pt.y = target.y;

		// Soft spring constraint pulls point to mouse position while preserving hard constraints.
		const dragConstraint = new DragPointConstraint(pointId, target.x, target.y, 0.005);
		return this.solve([dragConstraint]);
	}

	dragLine(lineId: string, p1TargetX: number, p1TargetY: number, p2TargetX: number, p2TargetY: number): SolverResult {
		const line = this.lines.get(lineId);
		if (!line) return this.solve();

		const spline = line.parentSplineId ? this.splines.get(line.parentSplineId) : undefined;
		if (spline?.splineType === 'fit') {
			// Drag one end of the tangent so the other end can pivot around the fit point.
			return this.isPointFixed(line.p2Id)
				? this.dragPoint(line.p1Id, p1TargetX, p1TargetY)
				: this.dragPoint(line.p2Id, p2TargetX, p2TargetY);
		}

		const p1 = this.points.get(line.p1Id);
		const p2 = this.points.get(line.p2Id);
		if (p1 && !this.isPointFixed(line.p1Id)) {
			p1.x = p1TargetX;
			p1.y = p1TargetY;
		}
		if (p2 && !this.isPointFixed(line.p2Id)) {
			p2.x = p2TargetX;
			p2.y = p2TargetY;
		}

		const c1 = new DragPointConstraint(line.p1Id, p1TargetX, p1TargetY, 0.005);
		const c2 = new DragPointConstraint(line.p2Id, p2TargetX, p2TargetY, 0.005);
		return this.solve([c1, c2]);
	}

	dragCircle(circleId: string, targetCenterX: number, targetCenterY: number): SolverResult {
		const circle = this.circles.get(circleId);
		if (!circle) return this.solve();

		const center = this.points.get(circle.centerId);
		if (center && !this.isPointFixed(circle.centerId)) {
			center.x = targetCenterX;
			center.y = targetCenterY;
		}

		const c = new DragPointConstraint(circle.centerId, targetCenterX, targetCenterY, 0.005);
		return this.solve([c]);
	}

	dragCircleRadius(circleOrArcId: string, targetRadius: number): SolverResult {
		const entity = this.circles.get(circleOrArcId) ?? this.arcs.get(circleOrArcId);
		if (!entity) return this.solve();

		entity.radius = Math.max(1, targetRadius);
		return this.solve();
	}

	applyConstraintValueDirectly(c: IConstraint, newValue: number, displayMode?: 'radius' | 'diameter'): boolean {
		if (!isFinite(newValue) || newValue <= 0) return false;

		if (c instanceof DistanceConstraint) {
			c.targetDistance = newValue;
			c.value = newValue;
			c.name =
				c.orientation === 'horizontal'
					? 'Horizontal Distance'
					: c.orientation === 'vertical'
						? 'Vertical Distance'
						: 'Distance';
			return true;
		}

		if (c instanceof PointToLineDistanceConstraint) {
			c.targetDistance = newValue;
			c.value = newValue;
			c.name = 'Point-to-Line Distance';
			return true;
		}

		if (c instanceof OriginDistanceConstraint && !c.isCoincident) {
			c.targetDistance = newValue;
			c.value = newValue;
			return true;
		}

		if (c instanceof LineToAxisDistanceConstraint && !c.isCollinear) {
			c.targetDistance = newValue;
			c.value = newValue;
			return true;
		}

		if (c instanceof OffsetConstraint) {
			c.targetDistance = Math.abs(newValue);
			c.value = Math.abs(newValue);
			c.name = 'Offset';

			if (c.sourceChain) {
				const newGeom = calculateOffsetGeometry(
					this,
					c.sourceChain,
					c.direction || 'one_side',
					c.targetDistance,
					c.targetDistance,
					c.flip || false
				);
				if (newGeom.isValid && newGeom.sides.length > 0) {
					this.applyOffsetGeometryUpdate(c, newGeom);
				}
			} else {
				for (const pair of c.pairs) {
					if (pair.kind === 'spline') {
						for (const sp of pair.points) {
							const pt = this.points.get(sp.pointId);
							if (pt && !this.isPointFixed(sp.pointId)) {
								pt.x = sp.basePos.x + sp.side * c.targetDistance * sp.normal.x;
								pt.y = sp.basePos.y + sp.side * c.targetDistance * sp.normal.y;
							}
						}
					}
				}
			}
			return true;
		}

		if (c instanceof AngleConstraint) {
			const isArcAngle = c.line1Id === c.line2Id && this.arcs.has(c.line1Id);
			const maxAngle = isArcAngle ? 359.9 : 179.9;
			const clampedAngle = Math.min(maxAngle, Math.max(0.1, newValue));
			c.targetAngle = clampedAngle;
			c.value = clampedAngle;
			c.name = 'Angle';
			if (isArcAngle) {
				const arc = this.arcs.get(c.line1Id);
				if (arc) {
					const center = this.points.get(arc.centerId);
					const start = this.points.get(arc.startPointId);
					const end = this.points.get(arc.endPointId);
					if (center && start && end && !this.isPointFixed(arc.endPointId)) {
						const as = angleFromTo(center, start);
						const sweepRad = (clampedAngle * Math.PI) / 180;
						const newAe = arc.clockwise ? as - sweepRad : as + sweepRad;
						end.x = center.x + Math.cos(newAe) * arc.radius;
						end.y = center.y + Math.sin(newAe) * arc.radius;
					}
				}
			}
			return true;
		}

		if (c instanceof RadiusConstraint) {
			const mode = displayMode ?? c.displayMode;
			const targetRad = mode === 'diameter' ? newValue / 2 : newValue;
			c.targetRadius = targetRad;
			c.value = targetRad;
			c.displayMode = mode;
			const dispVal = mode === 'diameter' ? Number((targetRad * 2).toFixed(2)) : Number(targetRad.toFixed(2));
			c.name = mode === 'diameter' ? `Diameter (${dispVal})` : `Radius (${dispVal})`;

			const arc = this.arcs.get(c.circleId);
			if (arc) {
				const center = this.points.get(arc.centerId);
				const start = this.points.get(arc.startPointId);
				const end = this.points.get(arc.endPointId);
				if (center && start && end) {
					if (!this.isPointFixed(arc.startPointId)) {
						const as = angleFromTo(center, start);
						start.x = center.x + Math.cos(as) * targetRad;
						start.y = center.y + Math.sin(as) * targetRad;
					}
					if (!this.isPointFixed(arc.endPointId)) {
						const ae = angleFromTo(center, end);
						end.x = center.x + Math.cos(ae) * targetRad;
						end.y = center.y + Math.sin(ae) * targetRad;
					}
				}
			}
			return true;
		}

		return false;
	}

	updateDimensionalConstraint(
		constraintId: string,
		newValue: number | string,
		displayMode?: 'radius' | 'diameter'
	): boolean {
		const c = this.constraints.get(constraintId);
		if (!c) return false;

		let val: number;
		let expr: string | undefined;

		if (typeof newValue === 'string') {
			const trimmed = newValue.trim();
			const evalRes = this.evaluateExpression(trimmed);
			if (!evalRes.isValid || !evalRes.value || !isFinite(evalRes.value) || evalRes.value <= 0) {
				return false;
			}
			val = evalRes.value;
			if (evalRes.referencedVars.length > 0 || isNaN(Number(trimmed.replace(',', '.')))) {
				expr = trimmed;
			}
		} else {
			if (!isFinite(newValue) || newValue <= 0) return false;
			val = newValue;
			expr = undefined;
		}

		c.expression = expr;
		const applied = this.applyConstraintValueDirectly(c, val, displayMode);
		if (applied) {
			this.solve();
			return true;
		}
		return false;
	}

	getParameterValuesMap(): Map<string, number> {
		const map = new Map<string, number>();
		for (const [name, p] of this.parameters) {
			map.set(name, p.value);
		}
		return map;
	}

	evaluateExpression(expr: string): {
		value?: number;
		isValid: boolean;
		error?: string;
		referencedVars: string[];
	} {
		return validateExpression(expr, this.getParameterValuesMap());
	}

	getParameter(name: string): SketchParameter | undefined {
		return this.parameters.get(name);
	}

	getAllParameters(): SketchParameter[] {
		return Array.from(this.parameters.values());
	}

	getParameterMap(): ReadonlyMap<string, SketchParameter> {
		return this.parameters;
	}

	evaluateParameterGraph(): ParameterGraphResult {
		return evaluateParameterGraph(this.parameters);
	}

	addParameter(
		name: string,
		expression: string,
		comment?: string
	): { success: boolean; error?: string; parameter?: SketchParameter } {
		const nameCheck = isValidParameterName(name);
		if (!nameCheck.isValid) {
			return { success: false, error: nameCheck.error };
		}
		if (this.parameters.has(name)) {
			return { success: false, error: `Parameter '${name}' already exists` };
		}
		this.pushHistory();
		const p: SketchParameter = {
			id: this.nextId('Param'),
			name,
			expression,
			value: 0,
			comment,
		};
		this.parameters.set(name, p);
		this.recomputeParametersAndConstraints(false);
		return { success: true, parameter: p };
	}

	updateParameter(
		name: string,
		newName: string,
		newExpr: string,
		comment?: string
	): { success: boolean; error?: string } {
		const existing = this.parameters.get(name);
		if (!existing) {
			return { success: false, error: `Parameter '${name}' not found` };
		}
		if (newName !== name) {
			const nameCheck = isValidParameterName(newName);
			if (!nameCheck.isValid) {
				return { success: false, error: nameCheck.error };
			}
			if (this.parameters.has(newName)) {
				return { success: false, error: `Parameter '${newName}' already exists` };
			}
		}
		this.pushHistory();
		existing.expression = newExpr;
		existing.comment = comment;
		if (newName !== name) {
			this.parameters.delete(name);
			existing.name = newName;
			this.parameters.set(newName, existing);

			// Rename in other parameters and constraint expressions
			for (const other of this.parameters.values()) {
				if (other.name !== newName) {
					other.expression = renameParameterInExpression(other.expression, name, newName);
				}
			}
			for (const c of this.constraints.values()) {
				if (c.expression) {
					c.expression = renameParameterInExpression(c.expression, name, newName);
				}
				if (c instanceof RectangularPatternConstraint) {
					if (c.distance1Expression) {
						c.distance1Expression = renameParameterInExpression(c.distance1Expression, name, newName);
					}
					if (c.distance2Expression) {
						c.distance2Expression = renameParameterInExpression(c.distance2Expression, name, newName);
					}
				}
				if (c instanceof CircularPatternConstraint && c.totalAngleExpression) {
					c.totalAngleExpression = renameParameterInExpression(c.totalAngleExpression, name, newName);
				}
			}
		}
		this.recomputeParametersAndConstraints(false);
		return { success: true };
	}

	deleteParameter(name: string): { success: boolean; error?: string } {
		if (!this.parameters.has(name)) {
			return { success: false, error: `Parameter '${name}' not found` };
		}
		this.pushHistory();
		this.parameters.delete(name);
		this.recomputeParametersAndConstraints(false);
		return { success: true };
	}

	recomputeParametersAndConstraints(pushHistory = false): {
		success: boolean;
		errors: Map<string, string>;
	} {
		if (pushHistory) {
			this.pushHistory();
		}
		const graphRes = evaluateParameterGraph(this.parameters);
		for (const [pName, val] of graphRes.values) {
			const p = this.parameters.get(pName);
			if (p) p.value = val;
		}

		for (const c of this.constraints.values()) {
			if (c instanceof RectangularPatternConstraint) {
				let updated = false;
				const updates: any = {};
				if (c.distance1Expression) {
					try {
						const val = evaluateExpression(c.distance1Expression, graphRes.values);
						if (Number.isFinite(val)) {
							updates.distance1 = val;
							updated = true;
						}
					} catch {}
				}
				if (c.distance2Expression) {
					try {
						const val = evaluateExpression(c.distance2Expression, graphRes.values);
						if (Number.isFinite(val)) {
							updates.distance2 = val;
							updated = true;
						}
					} catch {}
				}
				if (updated) {
					this.updateRectangularPattern(c.id, updates);
				}
				continue;
			}
			if (c instanceof CircularPatternConstraint) {
				if (c.totalAngleExpression) {
					try {
						const val = evaluateExpression(c.totalAngleExpression, graphRes.values);
						if (Number.isFinite(val) && Math.abs(val) > 1e-3) {
							this.updateCircularPattern(c.id, { totalAngle: val });
						}
					} catch {}
				}
				continue;
			}
			if (!c.expression) continue;
			try {
				const val = evaluateExpression(c.expression, graphRes.values);
				if (Number.isFinite(val) && val > 0) {
					this.applyConstraintValueDirectly(c, val);
				}
			} catch {
				// Expression failed to evaluate, keep previous value
			}
		}

		this.solve();
		this.notify();
		return { success: graphRes.errors.size === 0, errors: graphRes.errors };
	}

	private applyOffsetGeometryUpdate(c: OffsetConstraint, geom: any): void {
		if (!geom.sides || !geom.sides.length) return;
		const side = geom.sides[0];
		const numPrims = side.primitives.length;

		// 1. Update corner points if present
		if (c.cornerPointIds && c.cornerPointIds.length > 0) {
			for (let i = 0; i < c.cornerPointIds.length; i++) {
				const pt = this.points.get(c.cornerPointIds[i]);
				if (!pt || this.isPointFixed(pt.id)) continue;
				const prim = side.primitives[i % numPrims];
				const pos = prim.type === 'line' ? prim.p1 : prim.type === 'arc' ? prim.start : prim.fitPoints?.[0];
				if (pos) {
					pt.x = pos.x;
					pt.y = pos.y;
				}
			}
		}

		// 2. Update primitives
		for (let i = 0; i < numPrims; i++) {
			const prim = side.primitives[i];
			const pair = c.pairs[i];
			if (!pair) continue;

			if (pair.kind === 'line') {
				if (numPrims === 1 && prim.p1 && prim.p2) {
					const p1 = this.points.get(pair.offP1Id);
					const p2 = this.points.get(pair.offP2Id);
					if (p1 && !this.isPointFixed(p1.id)) {
						p1.x = prim.p1.x;
						p1.y = prim.p1.y;
					}
					if (p2 && !this.isPointFixed(p2.id)) {
						p2.x = prim.p2.x;
						p2.y = prim.p2.y;
					}
				}
			} else if (pair.kind === 'circle') {
				const circ = this.circles.get(pair.offId);
				if (circ && prim.circleRadius) circ.radius = prim.circleRadius;
				const arc = this.arcs.get(pair.offId);
				if (arc && prim.radius) arc.radius = prim.radius;
			} else if (pair.kind === 'spline') {
				const spline = this.splines.get(pair.offSplineId);
				if (spline && prim.fitPoints) {
					const ptsCount = spline.pointIds.length;
					const startIdx = numPrims > 1 ? 1 : 0;
					const endIdx = numPrims > 1 ? ptsCount - 1 : ptsCount;
					for (let k = startIdx; k < endIdx; k++) {
						const pt = this.points.get(spline.pointIds[k]);
						if (pt && !this.isPointFixed(pt.id) && prim.fitPoints[k]) {
							pt.x = prim.fitPoints[k].x;
							pt.y = prim.fitPoints[k].y;
						}
					}
					// Update tangent handle points
					const fitPts = spline.pointIds.map(pid => this.points.get(pid)).filter((p): p is SketchPoint => !!p);
					if (fitPts.length >= 2 && spline.tangentLineIds && spline.tangentLineIds.length > 0) {
						const handles = prim.handles || computeNaturalFitHandles(fitPts);
						for (let h = 0; h < spline.tangentLineIds.length; h++) {
							const tLine = this.lines.get(spline.tangentLineIds[h]);
							if (tLine && handles[h]) {
								const h1 = this.points.get(tLine.p1Id);
								const h2 = this.points.get(tLine.p2Id);
								if (h1 && !this.isPointFixed(h1.id)) {
									h1.x = handles[h].h1.x;
									h1.y = handles[h].h1.y;
								}
								if (h2 && !this.isPointFixed(h2.id)) {
									h2.x = handles[h].h2.x;
									h2.y = handles[h].h2.y;
								}
							}
						}
					}
				}
			}
		}
	}

	tryHardSolve(tempHardConstraints: IConstraint[], extraValidator?: () => boolean): boolean {
		const initialValues = this.paramManager.getCurrentValues();
		const drivenRadii = this.collectDrivenRadii();
		const editedHandles: SketchLine[] = [];
		const activeConstraints = this.prepareSplineConstraints(tempHardConstraints, drivenRadii, editedHandles);
		for (const c of tempHardConstraints) {
			if (c instanceof RadiusConstraint) {
				const entity = this.circles.get(c.circleId) ?? this.arcs.get(c.circleId);
				if (entity) {
					entity.radius = Math.max(0.01, c.targetRadius);
					drivenRadii.add(`${c.circleId}.r`);
				}
			}
		}

		const allRadii = new Set<string>(drivenRadii);
		for (const id of this.circles.keys()) allRadii.add(`${id}.r`);
		for (const id of this.arcs.keys()) allRadii.add(`${id}.r`);

		let solvedOk = false;
		if (allRadii.size > drivenRadii.size) {
			const stage1 = this.solver.solve(this.paramManager, activeConstraints, {
				lockedParams: allRadii,
				skipDoF: true,
			});
			solvedOk =
				stage1.status !== 'OVER_CONSTRAINED' && stage1.finalError < 1e-6 && (extraValidator ? extraValidator() : true);
			if (!solvedOk) {
				this.paramManager.restoreValues(initialValues);
			}
		}

		if (!solvedOk) {
			const stiffness = new Map<string, number>();
			for (const id of allRadii) stiffness.set(id, 1000);
			const stage2 = this.solver.solve(this.paramManager, activeConstraints, {
				lockedParams: drivenRadii,
				paramStiffness: stiffness,
				skipDoF: true,
			});
			solvedOk =
				stage2.status !== 'OVER_CONSTRAINED' && stage2.finalError < 1e-4 && (extraValidator ? extraValidator() : true);
			if (!solvedOk) {
				this.paramManager.restoreValues(initialValues);
			}
		}

		if (solvedOk) {
			for (const line of editedHandles) line.isAutomaticSplineHandle = false;
		}
		return solvedOk;
	}

	solveWithTemporaryHardConstraints(
		tempHardConstraints: IConstraint[],
		fallbackSoftConstraints: IConstraint[] = [],
		extraValidator?: () => boolean
	): void {
		const solvedOk = this.tryHardSolve(tempHardConstraints, extraValidator);
		if (!solvedOk && fallbackSoftConstraints.length > 0) {
			this.solve(fallbackSoftConstraints);
		}
		this.solve();
	}

	setPointCoords(pointId: string, targetX: number, targetY: number): boolean {
		return setPointCoords(this, pointId, targetX, targetY);
	}

	setLineLength(lineId: string, newLength: number): boolean {
		return setLineLength(this, lineId, newLength);
	}

	setLineAngle(lineId: string, newAngleDeg: number): boolean {
		return setLineAngle(this, lineId, newAngleDeg);
	}

	setLinesRelativeAngle(line1Id: string, line2Id: string, newAngleDeg: number): boolean {
		return setLinesRelativeAngle(this, line1Id, line2Id, newAngleDeg);
	}

	setCircleOrArcRadius(entityId: string, newRadius: number): boolean {
		return setCircleOrArcRadius(this, entityId, newRadius);
	}

	setArcAngle(arcId: string, newSweepDeg: number): boolean {
		return setArcAngle(this, arcId, newSweepDeg);
	}

	setEllipseParams(id: string, params: { rx?: number; ry?: number; rotationDeg?: number }): boolean {
		return setEllipseParams(this, id, params);
	}

	hasRadiusConstraint(circleId: string): boolean {
		return hasRadiusConstraint(this, circleId);
	}

	hasAngleConstraint(line1Id: string, line2Id: string): boolean {
		return hasAngleConstraint(this, line1Id, line2Id);
	}

	hasThreePointAngleConstraint(p1Id: string, p2Id: string, p3Id: string): boolean {
		return hasThreePointAngleConstraint(this, p1Id, p2Id, p3Id);
	}

	isPointFixed(pointId: string): boolean {
		return isPointFixed(this, pointId);
	}

	matchesEndpoints(pA: string, pB: string, end1: string, end2: string): boolean {
		return matchesEndpoints(pA, pB, end1, end2);
	}

	getLineBetween(p1Id: string, p2Id: string): SketchLine | undefined {
		return getLineBetween(this, p1Id, p2Id);
	}

	getConstraintsForEntity(
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline',
		id: string
	): IConstraint[] {
		return getConstraintsForEntity(this, type, id);
	}

	getEntitiesForConstraint(c: IConstraint): Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
	}> {
		return getEntitiesForConstraint(this, c);
	}

	isEntitySelected(id: string, type: SelectableEntityType): boolean {
		return isEntitySelected(this, id, type);
	}

	deselectEntity(id: string, type: SelectableEntityType): void {
		deselectEntity(this, id, type);
	}

	toggleEntitySelection(id: string, type: SelectableEntityType): void {
		toggleEntitySelection(this, id, type);
	}

	selectEntities(
		items: Array<{
			id: string;
			type: SelectableEntityType;
		}>,
		multiSelect = false
	): void {
		selectEntities(this, items, multiSelect);
	}

	selectEntity(id: string, type: SelectableEntityType, multiSelect = false): void {
		selectEntity(this, id, type, multiSelect);
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
		this.texts.clear();
		this.constraints.clear();
		this.parameters.clear();
		this.selection.pointIds.clear();
		this.selection.lineIds.clear();
		this.selection.circleIds.clear();
		this.selection.arcIds.clear();
		this.selection.ellipseIds.clear();
		this.selection.ellipticalArcIds.clear();
		this.selection.splineIds.clear();
		this.selection.textIds.clear();
		this.selection.constraintIds.clear();
		this.counters.clear();
		this.rebuildParamManager();
		this.solve();
	}

	clearSelection(): void {
		clearSelection(this);
	}

	getSelectedPrimitives(): Array<{ id: string; isConstruction?: boolean }> {
		return getSelectedPrimitives(this);
	}

	getSelectedConstructionState(): boolean | null {
		return getSelectedConstructionState(this);
	}

	deleteSelected(): void {
		deleteSelected(this);
	}

	addText(options: Omit<TextSnapshot, 'type' | 'id'>): SketchText {
		this.pushHistory();
		const id = this.nextId('Text');
		const text = new SketchText({
			id,
			...options,
		});
		this.texts.set(id, text);
		this.notify();
		return text;
	}

	cleanOrphanTexts(): void {
		for (const [tId, text] of this.texts.entries()) {
			if (text.mode === 'text') {
				if (text.rectanglePointIds) {
					const hasAllPoints = text.rectanglePointIds.every(pid => this.points.has(pid));
					const hasAllLines = text.rectangleLineIds ? text.rectangleLineIds.every(lid => this.lines.has(lid)) : true;
					if (!hasAllPoints || !hasAllLines) {
						this.texts.delete(tId);
						this.selection.textIds.delete(tId);
					}
				}
			} else if (text.mode === 'text_on_path' && text.targetPrimitiveId) {
				const prim = this.getPrimitive(text.targetPrimitiveId, text.targetPrimitiveType);
				if (!prim) {
					this.texts.delete(tId);
					this.selection.textIds.delete(tId);
				}
			}
		}
	}

	exportSVG(viewportState?: { panX: number; panY: number; zoom: number }): string {
		return exportSketchToSVG(this, viewportState);
	}

	importSVG(svgString: string): {
		success: boolean;
		viewport?: { panX: number; panY: number; zoom: number };
		error?: string;
	} {
		return importSketchFromSVG(this, svgString);
	}

	getBoundingBox(): AABB | null {
		return getBoundingBox(this);
	}

	getSelectionBoundingBox(): AABB | null {
		return getSelectionBoundingBox(this);
	}
}

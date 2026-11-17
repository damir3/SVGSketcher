import type { SketchImage } from './image';
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
	clearSelectionSets,
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
	type PatternLinks,
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
	type PrimitiveType,
	type SelectionState,
} from './types';
import type { GeoCurve } from '../math/intersection';
import { Vec2, type XY } from '../math/vector';
import type { AABB } from '../math/aabb';
import { MIN_OFFSET_RADIUS as MIN_SOLVER_RADIUS } from '../kernel/offsetTypes';
import { serializePrimitive } from './primitives/serialization';
import { HistoryManager, type SketchSnapshot } from './history';
import { serializeConstraint, deserializeConstraint } from '../solver/constraints/serialization';
import { evaluateParameterGraph, type SketchParameter, type ParameterGraphResult } from '../math/expression';
import {
	getParameterValuesMap,
	evaluateSketchExpression,
	addSketchParameter,
	updateSketchParameter,
	deleteSketchParameter,
	recomputeParametersAndConstraints,
} from './parameterOperations';
import {
	createControlSplineHandleLines,
	addFitSpline,
	addControlSpline,
	copySpline,
	isSplineHandleLine,
	isSplineHandlePoint,
	resetFitSplineTangents,
	isSplineInternalConstraint,
	restoreAutomaticSplineHandles,
	prepareSplineConstraints,
} from './splineOperations';
import { syncOffsetSources, applyOffsetConstraintValue } from './offsetSync';
import {
	exportSketchToSVG,
	importSketchFromSVG,
	type SketchFileMetadata,
	type SvgExportOptions,
	type SvgExportSettings,
	type SvgExportDimensions,
} from './io/svgIO';

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
	images = new Map<string, SketchImage>();
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

	// Order preserves getPrimitive(id) lookup priority: lines before points (for built-in axes).
	private readonly primitiveCollections: Array<{
		type: PrimitiveType;
		map: Map<string, ISketchPrimitive>;
		selectionKey: keyof SelectionState;
		isCurve: boolean;
	}> = [
		{ type: 'line', map: this.lines, selectionKey: 'lineIds', isCurve: true },
		{ type: 'point', map: this.points, selectionKey: 'pointIds', isCurve: false },
		{ type: 'circle', map: this.circles, selectionKey: 'circleIds', isCurve: true },
		{ type: 'arc', map: this.arcs, selectionKey: 'arcIds', isCurve: true },
		{ type: 'ellipse', map: this.ellipses, selectionKey: 'ellipseIds', isCurve: true },
		{ type: 'elliptical_arc', map: this.ellipticalArcs, selectionKey: 'ellipticalArcIds', isCurve: true },
		{ type: 'spline', map: this.splines, selectionKey: 'splineIds', isCurve: true },
	];

	private readonly primitiveCollectionMap = new Map(this.primitiveCollections.map(col => [col.type, col]));

	private idCounter = 1;
	paramManager = new ParamManager();
	private solver = new NumericalSolver({ gradRelTolerance: 1e-6 });
	lastSolverResult: SolverResult | null = null;
	lastSolveTimeMs = 0;

	// History & Transactions
	private history = new HistoryManager();
	private batchDepth = 0;
	private batchSnapshot: SketchSnapshot | null = null;
	private solveDeferred = 0;
	private updatingOffsets = false;

	isInTransaction(): boolean {
		return this.batchDepth > 0;
	}

	runSilentDerivedUpdate(fn: () => void): void {
		// Derived edits belong to the caller's history entry. Suppress nested solves,
		// snapshots and notifications while topology is being reconciled.
		this.updatingOffsets = true;
		this.solveDeferred++;
		this.batchDepth++;
		try {
			fn();
		} finally {
			this.batchDepth--;
			this.solveDeferred--;
			this.updatingOffsets = false;
		}
	}

	// Listeners for UI reactivity
	private changeListeners: Array<() => void> = [];

	onChange(listener: () => void): () => void {
		this.changeListeners.push(listener);
		return () => {
			this.changeListeners = this.changeListeners.filter(l => l !== listener);
		};
	}

	notify(): void {
		if (this.updatingOffsets) return;
		for (const listener of this.changeListeners) {
			listener();
		}
	}

	private counters: Map<string, number> = new Map();

	nextId(prefix: string): string {
		const isTaken = (id: string) =>
			this.primitiveCollections.some(col => col.map.has(id)) ||
			this.texts.has(id) ||
			this.images.has(id) ||
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

	commitTransaction(coalesce = true): void {
		if (this.batchDepth <= 0) return;
		this.batchDepth--;
		if (this.batchDepth === 0) {
			if (this.batchSnapshot) {
				this.history.pushState(this.batchSnapshot, coalesce);
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

	pushHistory(coalesce = true): void {
		if (this.batchDepth > 0) return;
		this.history.pushState(this.takeSnapshot(), coalesce);
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

	private restoreMap<T extends { id: string }, S>(
		target: Map<string, T>,
		items: readonly S[] | undefined,
		Ctor: new (snapshot: S) => T
	): void {
		target.clear();
		for (const item of items ?? []) {
			const instance = new Ctor(item);
			target.set(instance.id, instance);
		}
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
			images: [...this.images.values()].map(image => ({ ...image })),
			constraints: Array.from(this.constraints.values()).map(c => serializeConstraint(c)),
			parameters: Array.from(this.parameters.values()).map(p => ({ ...p })),
			idCounter: this.idCounter,
		};
	}

	restoreSnapshot(snapshot: SketchSnapshot): void {
		this.restoreMap(this.points, snapshot.points, SketchPoint);
		this.restoreMap(this.lines, snapshot.lines, SketchLine);
		this.restoreMap(this.circles, snapshot.circles, SketchCircle);
		this.restoreMap(this.arcs, snapshot.arcs, SketchArc);
		this.restoreMap(this.ellipses, snapshot.ellipses, SketchEllipse);
		this.restoreMap(this.ellipticalArcs, snapshot.ellipticalArcs, SketchEllipticalArc);
		this.restoreMap(this.splines, snapshot.splines, SketchSpline);
		this.restoreMap(this.texts, snapshot.texts, SketchText);

		this.images.clear();
		for (const image of snapshot.images ?? []) {
			this.images.set(image.id, { ...image });
		}

		this.constraints.clear();
		for (const sc of snapshot.constraints) {
			const c = deserializeConstraint(sc);
			if (c) {
				this.constraints.set(c.id, c);
			}
		}

		restoreAutomaticSplineHandles(this);

		this.counters.clear();
		const idMaps: Array<Map<string, unknown>> = [
			...this.primitiveCollections.map(col => col.map),
			this.texts,
			this.images,
			this.constraints,
		];
		for (const map of idMaps) {
			for (const id of map.keys()) {
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
		}

		this.idCounter = snapshot.idCounter;
		const arcEndpoints = new Map<string, ArcEndpointsConstraint>();
		for (const c of this.constraints.values()) {
			if (c instanceof ArcEndpointsConstraint) arcEndpoints.set(c.arcId, c);
		}
		for (const arc of this.arcs.values()) {
			this.syncArcEndpoints(arc, arcEndpoints.get(arc.id));
		}
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

	private registerPrimitive<T extends ISketchPrimitive>(
		map: Map<string, T>,
		primitive: T,
		afterRegister?: () => void
	): T {
		this.pushHistory();
		map.set(primitive.id, primitive);
		this.rebuildParamManager();
		afterRegister?.();
		this.solve();
		return primitive;
	}

	// --- Point methods ---
	addPoint(point: XY, fixed = false): SketchPoint {
		return this.registerPrimitive(
			this.points,
			new SketchPoint({ id: this.nextId('Point'), x: point.x, y: point.y, fixed })
		);
	}

	getPoint(id: string): SketchPoint | undefined {
		return this.points.get(id);
	}

	getLine(id: string): SketchLine | undefined {
		return this.lines.get(id) ?? BUILT_IN_LINES.get(id);
	}

	getPrimitive(id: string, type?: PrimitiveType): ISketchPrimitive | undefined {
		const byType = type ? this.primitiveCollectionMap.get(type) : undefined;
		if (byType) {
			return byType.map.get(id);
		}
		for (const col of this.primitiveCollections) {
			const prim = col.map.get(id);
			if (prim) return prim;
		}
		return undefined;
	}

	toGeoCurve(id: string, type?: PrimitiveType): GeoCurve | null {
		const prim = this.getPrimitive(id, type);
		return prim ? prim.toGeoCurve(this) : null;
	}

	*getCurvePrimitives(): IterableIterator<ISketchPrimitive> {
		for (const col of this.primitiveCollections) {
			if (col.isCurve) yield* col.map.values();
		}
	}

	// --- Line methods ---
	addLine(p1Id: string, p2Id: string, isConstruction = false): SketchLine {
		return this.registerPrimitive(this.lines, new SketchLine({ id: this.nextId('Line'), p1Id, p2Id, isConstruction }));
	}

	// --- Circle methods ---
	addCircle(centerId: string, radius: number, isConstruction = false): SketchCircle {
		return this.registerPrimitive(
			this.circles,
			new SketchCircle({ id: this.nextId('Circle'), centerId, radius, isConstruction })
		);
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
		const arc = new SketchArc({
			id: this.nextId('Arc'),
			centerId,
			startPointId,
			endPointId,
			radius,
			clockwise,
			isConstruction,
		});
		return this.registerPrimitive(this.arcs, arc, () => this.syncArcEndpoints(arc));
	}

	replaceArcEndpoint(arc: SketchArc, edge: 'start' | 'end', pointId: string): void {
		if (edge === 'start') arc.startPointId = pointId;
		else arc.endPointId = pointId;

		const endpoints = [...this.constraints.values()].find(
			(c): c is ArcEndpointsConstraint => c instanceof ArcEndpointsConstraint && c.arcId === arc.id
		);
		this.syncArcEndpoints(arc, endpoints);
	}

	private syncArcEndpoints(arc: SketchArc, existing?: ArcEndpointsConstraint): void {
		if (
			existing?.centerId === arc.centerId &&
			existing.startPointId === arc.startPointId &&
			existing.endPointId === arc.endPointId
		) {
			return;
		}
		const c = new ArcEndpointsConstraint(
			existing?.id ?? this.nextId('c_arcept'),
			arc.id,
			arc.centerId,
			arc.startPointId,
			arc.endPointId,
			existing?.weight
		);
		this.constraints.set(c.id, c);
	}

	// --- Ellipse methods ---
	addEllipse(
		centerId: string,
		majorAxisPointId: string,
		minorAxisPointId: string,
		isConstruction = false
	): SketchEllipse {
		const id = this.nextId('Ellipse');
		const ellipse = new SketchEllipse({ id, centerId, majorAxisPointId, minorAxisPointId, isConstruction });
		return this.registerPrimitive(this.ellipses, ellipse, () => {
			const c = new EllipseAxisConstraint(this.nextId('c_elaxis'), id, centerId, majorAxisPointId, minorAxisPointId);
			this.constraints.set(c.id, c);
		});
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
		return this.registerPrimitive(this.ellipticalArcs, arc, () => {
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
		});
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
		return addFitSpline(this, pointIds, tangentLineIds, isConstruction, id, isClosed, explicitHandles);
	}

	addControlSpline(
		pointIds: string[],
		isConstruction = false,
		id?: string,
		isClosed?: boolean,
		knots?: number[],
		tangentLineIds?: string[]
	): SketchSpline {
		return addControlSpline(this, pointIds, isConstruction, id, isClosed, knots, tangentLineIds);
	}

	getSpline(id: string): SketchSpline | undefined {
		return this.splines.get(id);
	}

	copySpline(source: SketchSpline, mapPoint: (id: string) => string): SketchSpline {
		return copySpline(this, source, mapPoint);
	}

	// --- Constraint methods ---
	private getRadial(id: string): SketchCircle | SketchArc | undefined {
		return this.circles.get(id) ?? this.arcs.get(id);
	}

	private findConstraint<T extends IConstraint>(
		Ctor: abstract new (...args: never[]) => T,
		predicate: (constraint: T) => boolean
	): T | undefined {
		for (const c of this.constraints.values()) {
			if (c instanceof Ctor && predicate(c)) return c;
		}
		return undefined;
	}

	private addUniqueConstraint<T extends IConstraint>(
		Ctor: abstract new (...args: never[]) => T,
		predicate: (constraint: T) => boolean,
		create: () => T,
		onExisting: 'return' | 'null' = 'return'
	): T | null {
		const existing = this.findConstraint(Ctor, predicate);
		if (existing) return onExisting === 'return' ? existing : null;
		const c = create();
		this.addConstraint(c);
		return c;
	}

	private roundDimensionDefault(measured: number, min = 0.01): number {
		return Math.max(min, Number(measured.toFixed(2)));
	}

	private updateExistingDistanceConstraint<T extends DistanceConstraint | PointToLineDistanceConstraint>(
		existing: T,
		targetDist?: number,
		offset?: number
	): T {
		if (offset !== undefined && existing.offset !== offset) {
			existing.offset = offset;
		}
		if (targetDist !== undefined && existing.targetDistance !== targetDist) {
			this.pushHistory();
			existing.targetDistance = targetDist;
			existing.value = targetDist;
			this.solve();
		}
		return existing;
	}

	private upsertPointDistance(
		p1Id: string,
		p2Id: string,
		measured: number,
		orientation: 'aligned' | 'horizontal' | 'vertical',
		targetDist?: number,
		offset?: number,
		sign?: number
	): DistanceConstraint {
		const existing = this.getDistanceConstraint(p1Id, p2Id, orientation);
		if (existing) return this.updateExistingDistanceConstraint(existing, targetDist, offset);
		const dist = targetDist ?? this.roundDimensionDefault(measured);
		const c = new DistanceConstraint(
			this.nextId('c_dist'),
			p1Id,
			p2Id,
			dist,
			1.0,
			offset,
			orientation,
			undefined,
			sign
		);
		this.addConstraint(c);
		return c;
	}

	private addOrientationConstraint<T extends HorizontalConstraint | VerticalConstraint>(
		Ctor: new (id: string, p1Id: string, p2Id: string) => T,
		prefix: string,
		p1Id: string,
		p2Id: string
	): T {
		return this.addUniqueConstraint(
			Ctor,
			c => this.matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id),
			() => new Ctor(this.nextId(prefix), p1Id, p2Id)
		)!;
	}

	private matchesLinePair(a1: string, a2: string, b1: string, b2: string, l1: SketchLine, l2: SketchLine): boolean {
		return (
			(this.matchesEndpoints(a1, a2, l1.p1Id, l1.p2Id) && this.matchesEndpoints(b1, b2, l2.p1Id, l2.p2Id)) ||
			(this.matchesEndpoints(a1, a2, l2.p1Id, l2.p2Id) && this.matchesEndpoints(b1, b2, l1.p1Id, l1.p2Id))
		);
	}

	private addTwoLineConstraint<T extends IConstraint>(
		line1Id: string,
		line2Id: string,
		Ctor: new (id: string, p1: string, p2: string, p3: string, p4: string) => T,
		prefix: string,
		endpointsOf: (c: T) => [string, string, string, string]
	): T | null {
		const l1 = this.lines.get(line1Id);
		const l2 = this.lines.get(line2Id);
		if (!l1 || !l2) return null;

		return this.addUniqueConstraint(
			Ctor,
			c => this.matchesLinePair(...endpointsOf(c), l1, l2),
			() => new Ctor(this.nextId(prefix), l1.p1Id, l1.p2Id, l2.p1Id, l2.p2Id)
		);
	}

	private updateExistingAngleConstraint(
		existing: AngleConstraint,
		targetAngleDeg?: number,
		arcRadius?: number
	): AngleConstraint {
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

	private createAngleConstraint(
		line1Id: string,
		line2Id: string,
		p1: SketchPoint,
		p2: SketchPoint,
		p3: SketchPoint,
		p4: SketchPoint,
		targetAngleDeg?: number,
		arcRadius?: number,
		cursorPos?: { x: number; y: number },
		s1Override?: number,
		s2Override?: number,
		signOverride?: number
	): AngleConstraint {
		const geom = this.calculateLinesAngleGeometry(
			p1,
			p2,
			p3,
			p4,
			cursorPos,
			line1Id || undefined,
			line2Id || undefined
		);
		const angleVal = targetAngleDeg ?? Math.max(0.1, Math.min(179.9, Math.round(geom.initialAngleDeg * 10) / 10));
		const c = new AngleConstraint(
			this.nextId('c_ang'),
			line1Id,
			line2Id,
			p1.id,
			p2.id,
			p3.id,
			p4.id,
			angleVal,
			arcRadius ?? 40,
			s1Override ?? geom.s1,
			s2Override ?? geom.s2,
			signOverride ?? geom.sign
		);
		this.addConstraint(c);
		return c;
	}

	private formatRadiusConstraintName(radius: number, mode: 'radius' | 'diameter'): string {
		const dispVal = mode === 'diameter' ? Number((radius * 2).toFixed(2)) : Number(radius.toFixed(2));
		return mode === 'diameter' ? `Diameter (${dispVal})` : `Radius (${dispVal})`;
	}

	addConstraint(constraint: IConstraint): void {
		this.pushHistory();
		this.constraints.set(constraint.id, constraint);
		this.solve();
	}

	removeConstraint(id: string): void {
		const c = this.constraints.get(id);
		if (!c) return;
		if (
			c.isInternalConstraint?.(this) ||
			this.isSplineInternalConstraint(c) ||
			c.type === 'arc_endpoints' ||
			c.type === 'elliptical_arc_endpoints'
		) {
			return;
		}
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
		const existing = this.findConstraint(FixedConstraint, c => c.pointId === pointId);
		if (existing) {
			pt.fixed = true;
			return existing;
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
		const hasFix = !!this.findConstraint(FixedConstraint, c => c.pointId === pointId);
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
		if (p1Id === p2Id || !this.points.has(p1Id) || !this.points.has(p2Id)) return null;
		// Do not constrain endpoints of the same line segment (would collapse length to 0)
		if (this.getLineBetween(p1Id, p2Id)) return null;
		return this.addUniqueConstraint(
			CoincidentConstraint,
			c => this.matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id),
			() => new CoincidentConstraint(this.nextId('c_coinc'), p1Id, p2Id),
			'null'
		);
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
		return this.addOrientationConstraint(HorizontalConstraint, 'c_horiz', p1Id, p2Id);
	}

	addVerticalConstraint(p1Id: string, p2Id: string): VerticalConstraint {
		return this.addOrientationConstraint(VerticalConstraint, 'c_vert', p1Id, p2Id);
	}

	getDistanceConstraint(
		p1Id: string,
		p2Id: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): DistanceConstraint | undefined {
		return this.findConstraint(
			DistanceConstraint,
			c =>
				!c.circleIds &&
				this.matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id) &&
				(!orientation || (c.orientation ?? 'aligned') === orientation)
		);
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

		const eff = orientation ?? 'aligned';
		const measured =
			eff === 'horizontal' ? Math.abs(p2.x - p1.x) : eff === 'vertical' ? Math.abs(p2.y - p1.y) : p1.distanceTo(p2);
		return this.upsertPointDistance(p1Id, p2Id, measured, eff, targetDist, offset);
	}

	canAddCircleDistanceConstraint(circle1Id: string, circle2Id: string): boolean {
		if (circle1Id === circle2Id) return false;
		const a = this.getRadial(circle1Id);
		const b = this.getRadial(circle2Id);
		const p1 = a && this.points.get(a.centerId);
		const p2 = b && this.points.get(b.centerId);
		return !!p1 && !!p2 && p1.distanceTo(p2) < 1e-5;
	}

	addCircleDistanceConstraint(
		circle1Id: string,
		circle2Id: string,
		targetDistance?: number
	): DistanceConstraint | null {
		const existing = this.findConstraint(
			DistanceConstraint,
			c =>
				!!c.circleIds && c.circleIds.includes(circle1Id) && c.circleIds.includes(circle2Id) && circle1Id !== circle2Id
		);
		if (existing) {
			return this.updateExistingDistanceConstraint(existing, targetDistance);
		}
		if (!this.canAddCircleDistanceConstraint(circle1Id, circle2Id)) return null;
		const a = this.getRadial(circle1Id)!;
		const b = this.getRadial(circle2Id)!;
		const distance = targetDistance ?? this.roundDimensionDefault(Math.abs(a.radius - b.radius));
		const c = new DistanceConstraint(this.nextId('c_dist'), a.centerId, b.centerId, distance);
		c.circleIds = [circle1Id, circle2Id];
		c.leaderOffset = -Math.abs(a.radius - b.radius) / 2;
		c.entityIds = [...new Set([a.centerId, b.centerId, circle1Id, circle2Id])];
		c.name = c.displayName;
		this.addConstraint(c);
		return c;
	}

	canAddCircleToLineDistanceConstraint(radialId: string, lineId: string): boolean {
		const radial = this.getRadial(radialId);
		const line = this.getLine(lineId);
		return !!radial && !!line && radial.centerId !== line.p1Id && radial.centerId !== line.p2Id;
	}

	addCircleToLineDistanceConstraint(
		radialId: string,
		lineId: string,
		targetDistance?: number
	): DistanceConstraint | PointToLineDistanceConstraint | null {
		if (!this.canAddCircleToLineDistanceConstraint(radialId, lineId)) return null;
		const radial = this.getRadial(radialId)!;
		const c =
			lineId === 'axis_x' || lineId === 'axis_y'
				? this.addPointToAxisDistanceConstraint(radial.centerId, lineId === 'axis_x' ? 'x' : 'y', targetDistance)
				: this.addPointToLineDistanceConstraint(radial.centerId, lineId, targetDistance);
		if (c && !c.entityIds.includes(radialId)) c.entityIds.push(radialId);
		return c;
	}

	getPointToLineDistanceConstraint(pointId: string, lineId: string): PointToLineDistanceConstraint | undefined {
		return this.findConstraint(PointToLineDistanceConstraint, c => c.pointId === pointId && c.lineId === lineId);
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
			return this.updateExistingDistanceConstraint(existing, targetDist, offset);
		}

		const dir = new Vec2().subVectors(p2, p1);
		const lineLen = Math.max(dir.length(), 1e-7);
		const signedArea = new Vec2().subVectors(pt, p1).cross(dir);
		const measured = Math.abs(signedArea) / lineLen;
		const side = signedArea >= 0 ? 1 : -1;

		const currentDist = targetDist ?? this.roundDimensionDefault(measured);
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
	): DistanceConstraint | CoincidentConstraint | undefined {
		for (const c of this.constraints.values()) {
			if (
				((c instanceof DistanceConstraint && !c.circleIds) || c instanceof CoincidentConstraint) &&
				this.matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId) &&
				(orientation === undefined ||
					(c instanceof DistanceConstraint ? c.orientation === orientation : orientation === 'aligned'))
			) {
				return c;
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
	): DistanceConstraint | null {
		const pt = this.points.get(pointId);
		if (!pt) return null;
		const signed = orientation === 'horizontal' ? pt.x : orientation === 'vertical' ? pt.y : pt.length();
		return this.upsertPointDistance(
			'origin',
			pointId,
			Math.abs(signed),
			orientation,
			targetDist,
			offset,
			orientation === 'aligned' ? undefined : signed >= 0 ? 1 : -1
		);
	}

	addOriginCoincidentConstraint(pointId: string): CoincidentConstraint | null {
		if (!this.points.get(pointId) || pointId === 'origin') return null;
		return this.addUniqueConstraint(
			CoincidentConstraint,
			c => this.matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId),
			() => new CoincidentConstraint(this.nextId('c_coinc'), 'origin', pointId)
		);
	}

	getPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): DistanceConstraint | PointOnLineConstraint | undefined {
		const axisId = `axis_${axis}`;
		for (const c of this.constraints.values()) {
			if (
				(c instanceof DistanceConstraint &&
					this.matchesEndpoints(c.p1Id, c.p2Id, 'origin', pointId) &&
					c.orientation === (axis === 'x' ? 'vertical' : 'horizontal')) ||
				(c instanceof PointOnLineConstraint &&
					c.pointId === pointId &&
					c.lineP1Id === 'origin' &&
					c.lineP2Id === axisId)
			) {
				return c;
			}
		}
		return undefined;
	}

	hasPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): boolean {
		return this.getPointToAxisConstraint(pointId, axis) !== undefined;
	}

	addPointToAxisDistanceConstraint(
		pointId: string,
		axis: 'x' | 'y',
		targetDist?: number,
		offset?: number
	): DistanceConstraint | null {
		return this.addOriginDistanceConstraint(pointId, targetDist, axis === 'x' ? 'vertical' : 'horizontal', offset);
	}

	addPointOnAxisConstraint(pointId: string, axis: 'x' | 'y'): PointOnLineConstraint | null {
		if (!this.points.get(pointId)) return null;
		return this.addUniqueConstraint(
			PointOnLineConstraint,
			c => c.pointId === pointId && c.lineP1Id === 'origin' && c.lineP2Id === `axis_${axis}`,
			() => new PointOnLineConstraint(this.nextId('c_ptline'), pointId, 'origin', `axis_${axis}`)
		);
	}

	getLineToAxisConstraint(
		lineId: string,
		axis: 'x' | 'y'
	): PointToLineDistanceConstraint | CollinearConstraint | undefined {
		const line = this.lines.get(lineId);
		if (!line) return undefined;
		for (const c of this.constraints.values()) {
			if (
				(c instanceof PointToLineDistanceConstraint && c.constrainedLineId === lineId && c.lineId === `axis_${axis}`) ||
				(c instanceof CollinearConstraint &&
					c.l1P1 === 'origin' &&
					c.l1P2 === `axis_${axis}` &&
					this.matchesEndpoints(c.l2P1, c.l2P2, line.p1Id, line.p2Id))
			) {
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
	): PointToLineDistanceConstraint | null {
		const line = this.lines.get(lineId);
		if (!line) return null;
		const p1 = this.points.get(line.p1Id),
			p2 = this.points.get(line.p2Id);
		if (!p1 || !p2) return null;
		const existing = this.getLineToAxisConstraint(lineId, axis);
		if (existing instanceof PointToLineDistanceConstraint) {
			return this.updateExistingDistanceConstraint(existing, targetDist, offset);
		}
		const mid = axis === 'x' ? (p1.y + p2.y) / 2 : (p1.x + p2.x) / 2;
		const c = new PointToLineDistanceConstraint(
			this.nextId('c_pt_line_dist'),
			line.p1Id,
			`axis_${axis}`,
			'origin',
			`axis_${axis}`,
			targetDist ?? this.roundDimensionDefault(Math.abs(mid)),
			(mid >= 0 ? 1 : -1) * (axis === 'x' ? -1 : 1),
			1,
			offset,
			undefined,
			line.p2Id,
			lineId
		);
		this.addConstraint(c);
		return c;
	}

	addLineCollinearWithAxisConstraint(lineId: string, axis: 'x' | 'y'): CollinearConstraint | null {
		const line = this.lines.get(lineId);
		if (!line) return null;
		return this.addUniqueConstraint(
			CollinearConstraint,
			c =>
				c.l1P1 === 'origin' && c.l1P2 === `axis_${axis}` && this.matchesEndpoints(c.l2P1, c.l2P2, line.p1Id, line.p2Id),
			() => new CollinearConstraint(this.nextId('c_collin'), 'origin', `axis_${axis}`, line.p1Id, line.p2Id)
		);
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
		pInt: Vec2;
		u1: Vec2;
		u2: Vec2;
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

		const v1 = new Vec2().subVectors(p2, p1);
		const v2 = new Vec2().subVectors(p4, p3);
		const l1 = Math.max(v1.length(), 1e-7);
		const l2 = Math.max(v2.length(), 1e-7);

		// Direction unit vectors along the raw segments (p1->p2, p3->p4)
		const e1 = v1.clone().multiplyScalar(1.0 / l1);
		const e2 = v2.clone().multiplyScalar(1.0 / l2);

		let pInt: Vec2;
		let defS1 = 1;
		let defS2 = 1;

		const sharedEnd =
			!isAxis1 && !isAxis2
				? (
						[
							[p1, p3, 1, 1],
							[p1, p4, 1, -1],
							[p2, p3, -1, 1],
							[p2, p4, -1, -1],
						] as const
					).find(([a, b]) => a.id === b.id || (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4))
				: undefined;

		if (sharedEnd) {
			pInt = sharedEnd[0].clone();
			defS1 = sharedEnd[2];
			defS2 = sharedEnd[3];
		} else {
			const det = v1.cross(v2);
			if (Math.abs(det) < 1e-6) {
				if (isAxis2) {
					const m1 = new Vec2().midpoint(p1, p2);
					pInt = m1.multiply(new Vec2(Math.abs(e2.x), Math.abs(e2.y)));
					defS1 = 1;
					defS2 = v1.dot(e2) >= 0 ? 1 : -1;
				} else if (isAxis1) {
					const m2 = new Vec2().midpoint(p3, p4);
					pInt = m2.multiply(new Vec2(Math.abs(e1.x), Math.abs(e1.y)));
					defS2 = 1;
					defS1 = v2.dot(e1) >= 0 ? 1 : -1;
				} else {
					pInt = new Vec2().midpoint(p1, p3);
					defS1 = 1;
					defS2 = 1;
				}
			} else {
				const t = new Vec2().subVectors(p3, p1).cross(v2) / det;
				pInt = p1.clone().addScaledVector(v1, t);
				let m1 = new Vec2().midpoint(p1, p2);
				let m2 = new Vec2().midpoint(p3, p4);
				if (isAxis2) {
					m2 = m1.clone().multiply(new Vec2(Math.abs(e2.x), Math.abs(e2.y)));
				} else if (isAxis1) {
					m1 = m2.clone().multiply(new Vec2(Math.abs(e1.x), Math.abs(e1.y)));
				}
				const w1 = new Vec2().subVectors(m1, pInt);
				const w2 = new Vec2().subVectors(m2, pInt);
				defS1 = w1.dot(v1) >= 0 ? 1 : -1;
				defS2 = w2.dot(v2) >= 0 ? 1 : -1;
			}
		}

		// Default rays pointing along the physical segments from pInt:
		const u1Seg = e1.clone().multiplyScalar(defS1);
		const u2Seg = e2.clone().multiplyScalar(defS2);

		let s1 = defS1;
		let s2 = defS2;

		if (cursorPos) {
			const w = new Vec2().subVectors(cursorPos, pInt);
			const wLen = w.length();
			if (wLen > 1e-3) {
				// Decompose w in the basis of (u1Seg, u2Seg):
				// w = alpha * u1Seg + beta * u2Seg
				const detSeg = u1Seg.cross(u2Seg);
				if (Math.abs(detSeg) > 1e-6) {
					const alpha = w.cross(u2Seg) / detSeg;
					const beta = u1Seg.cross(w) / detSeg;
					const signAlpha = alpha >= 0 ? 1 : -1;
					const signBeta = beta >= 0 ? 1 : -1;
					s1 = signAlpha * defS1;
					s2 = signBeta * defS2;
				}
			}
		}

		const u1 = v1.clone().multiplyScalar(s1 / l1);
		const u2 = v2.clone().multiplyScalar(s2 / l2);

		const dotVal = Math.min(1, Math.max(-1, u1.dot(u2)));
		const initialAngleDeg = (Math.acos(dotVal) * 180) / Math.PI;
		const crossVal = u1.cross(u2);
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

		const existing = this.findConstraint(
			AngleConstraint,
			c => (c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id)
		);
		if (existing) return this.updateExistingAngleConstraint(existing, targetAngleDeg, arcRadius);

		return this.createAngleConstraint(
			line1Id,
			line2Id,
			p1,
			p2,
			p3,
			p4,
			targetAngleDeg,
			arcRadius,
			typeof cursorPosOrS1 === 'object' && cursorPosOrS1 !== null ? cursorPosOrS1 : undefined,
			typeof cursorPosOrS1 === 'number' ? cursorPosOrS1 : undefined,
			typeof s2Param === 'number' ? s2Param : undefined,
			typeof signParam === 'number' ? signParam : undefined
		);
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

		const existing = this.findConstraint(
			AngleConstraint,
			c =>
				!c.line1Id &&
				!c.line2Id &&
				c.l1P1 === p2Id &&
				c.l2P1 === p2Id &&
				this.matchesEndpoints(c.l1P2, c.l2P2, p1Id, p3Id)
		);
		if (existing) return this.updateExistingAngleConstraint(existing, targetAngleDeg, arcRadius);

		return this.createAngleConstraint(
			'',
			'',
			p2,
			p1,
			p2,
			p3,
			targetAngleDeg,
			arcRadius,
			undefined,
			typeof s1Param === 'number' ? s1Param : 1,
			typeof s2Param === 'number' ? s2Param : 1,
			typeof signParam === 'number' ? signParam : undefined
		);
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
		const entity = this.getRadial(circleOrArcId);
		if (!entity) return null;

		const defaultMode: 'radius' | 'diameter' = displayMode ?? (isCircle ? 'diameter' : 'radius');

		// Check if a radius constraint already exists on this circle or arc
		const existing = this.findConstraint(RadiusConstraint, c => c.circleId === circleOrArcId);

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
				existing.name = this.formatRadiusConstraintName(targetRadius, existing.displayMode ?? defaultMode);
				this.withStableCircleCenters(() => this.solve());
			}
			return existing;
		}

		const r = targetRadius ?? this.roundDimensionDefault(entity.radius, MIN_SOLVER_RADIUS);
		const c = new RadiusConstraint(this.nextId('c_rad'), circleOrArcId, r, 1.0, placement?.leaderAngle, defaultMode);
		c.leaderOffset = placement?.leaderOffset;
		this.withStableCircleCenters(() => this.addConstraint(c));
		return c;
	}

	addEqualLengthConstraint(line1Id: string, line2Id: string): EqualLengthConstraint | null {
		return this.addTwoLineConstraint(line1Id, line2Id, EqualLengthConstraint, 'c_eqlen', c => [
			c.line1P1,
			c.line1P2,
			c.line2P1,
			c.line2P2,
		]);
	}

	addEqualRadiusConstraint(circle1Id: string, circle2Id: string): EqualRadiusConstraint {
		return this.addUniqueConstraint(
			EqualRadiusConstraint,
			c => this.matchesEndpoints(c.circle1Id, c.circle2Id, circle1Id, circle2Id),
			() => new EqualRadiusConstraint(this.nextId('c_eqrad'), circle1Id, circle2Id)
		)!;
	}

	addParallelConstraint(line1Id: string, line2Id: string): ParallelConstraint | null {
		return this.addTwoLineConstraint(line1Id, line2Id, ParallelConstraint, 'c_par', c => [
			c.l1P1,
			c.l1P2,
			c.l2P1,
			c.l2P2,
		]);
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
		return this.addUniqueConstraint(
			CollinearConstraint,
			c => {
				if (!c.isThreePoint()) return false;
				const cSet = new Set([c.l1P1, c.l1P2, c.l2P1, c.l2P2]);
				return cSet.size === 3 && [...targetSet].every(id => cSet.has(id));
			},
			() => new CollinearConstraint(this.nextId('c_collin'), end1Id, midId, midId, end2Id)
		);
	}

	addCollinearConstraint(line1Id: string, line2Id: string, p3Id?: string): CollinearConstraint | null {
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

		return this.addTwoLineConstraint(line1Id, line2Id, CollinearConstraint, 'c_collin', c => [
			c.l1P1,
			c.l1P2,
			c.l2P1,
			c.l2P2,
		]);
	}

	addSymmetryConstraint(p1Id: string, p2Id: string, lineId: string, isMirrorCopy?: boolean): SymmetryConstraint | null {
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

		return this.addUniqueConstraint(
			SymmetryConstraint,
			c =>
				this.matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id) &&
				(isOriginAxis
					? c.lineId === 'origin'
					: c.lineId === line!.id || this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line!.p1Id, line!.p2Id)),
			() =>
				new SymmetryConstraint(
					this.nextId('c_symm'),
					p1Id,
					p2Id,
					line ? line.p1Id : '',
					line ? line.p2Id : '',
					1.0,
					isOriginAxis ? 'origin' : line!.id,
					isMirrorCopy
				)
		);
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
				return p.clone().multiplyScalar(-1);
			}
			const axisLine = this.getLine(axisId);
			if (axisLine) {
				const a = this.points.get(axisLine.p1Id);
				const b = this.points.get(axisLine.p2Id);
				if (a && b) {
					const dir = new Vec2().subVectors(b, a);
					const lenSq = dir.lengthSq();
					if (lenSq > 1e-12) {
						const len = Math.sqrt(lenSq);
						const normal = dir.clone().perpendicular().divideScalar(len);
						return p.clone().reflectAcrossLine(a, normal);
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
			const v = Vec2.fromPolar(R, a).add(centerPt);
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
		return this.addTwoLineConstraint(line1Id, line2Id, PerpendicularConstraint, 'c_perp', c => [
			c.l1P1,
			c.l1P2,
			c.l2P1,
			c.l2P2,
		]);
	}

	addPointOnLineConstraint(pointId: string, lineId: string): PointOnLineConstraint | null {
		const line = this.lines.get(lineId);
		if (!line || pointId === line.p1Id || pointId === line.p2Id) return null;
		return this.addUniqueConstraint(
			PointOnLineConstraint,
			c => c.pointId === pointId && this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id),
			() => new PointOnLineConstraint(this.nextId('c_ptline'), pointId, line.p1Id, line.p2Id),
			'null'
		);
	}

	addPointOnCircleConstraint(pointId: string, circleOrArcId: string): PointOnCircleConstraint | null {
		const circle = this.getRadial(circleOrArcId);
		if (!circle || pointId === circle.centerId) return null;
		const arc = this.arcs.get(circleOrArcId);
		if (arc && (pointId === arc.startPointId || pointId === arc.endPointId)) return null;
		return this.addUniqueConstraint(
			PointOnCircleConstraint,
			c => c.pointId === pointId && c.circleId === circleOrArcId,
			() => new PointOnCircleConstraint(this.nextId('c_ptcirc'), pointId, circle.centerId, circleOrArcId),
			'null'
		);
	}

	addPointOnEllipseConstraint(pointId: string, ellipseOrArcId: string): PointOnEllipseConstraint | null {
		const el = this.ellipses.get(ellipseOrArcId) ?? this.ellipticalArcs.get(ellipseOrArcId);
		if (!el || pointId === el.centerId || pointId === el.majorAxisPointId || pointId === el.minorAxisPointId) {
			return null;
		}
		if (el instanceof SketchEllipticalArc && (pointId === el.startPointId || pointId === el.endPointId)) {
			return null;
		}
		return this.addUniqueConstraint(
			PointOnEllipseConstraint,
			c => c.pointId === pointId && c.ellipseId === ellipseOrArcId,
			() =>
				new PointOnEllipseConstraint(
					this.nextId('c_ptel'),
					pointId,
					ellipseOrArcId,
					el.centerId,
					el.majorAxisPointId,
					el.minorAxisPointId
				),
			'null'
		);
	}

	addPointOnSplineConstraint(pointId: string, splineId: string): PointOnSplineConstraint | null {
		const spline = this.splines.get(splineId);
		if (!spline || spline.pointIds.includes(pointId) || this.isSplineHandlePoint(pointId)) return null;
		return this.addUniqueConstraint(
			PointOnSplineConstraint,
			c => c.pointId === pointId && c.splineId === splineId,
			() => {
				const handlePoints: Array<{ p1Id: string; p2Id: string }> = [];
				for (const lid of spline.tangentLineIds ?? []) {
					const l = this.lines.get(lid);
					if (l) handlePoints.push({ p1Id: l.p1Id, p2Id: l.p2Id });
				}
				return new PointOnSplineConstraint(
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
			},
			'null'
		);
	}

	addTangentConstraint(
		entity1Id: string,
		entity2Id: string
	): TangentLineCircleConstraint | TangentCircleCircleConstraint | null {
		const line1 = this.getLine(entity1Id);
		const line2 = this.getLine(entity2Id);
		const circ1 = this.getRadial(entity1Id);
		const circ2 = this.getRadial(entity2Id);

		// Case 1: Line (or Coordinate Axis) and Circle/Arc
		if ((line1 && circ2) || (line2 && circ1)) {
			const line = line1 ?? line2!;
			const circ = circ2 ?? circ1!;
			return this.addUniqueConstraint(
				TangentLineCircleConstraint,
				c =>
					c.circleId === circ.id &&
					(c.lineId === line.id || this.matchesEndpoints(c.lineP1Id, c.lineP2Id, line.p1Id, line.p2Id)),
				() =>
					new TangentLineCircleConstraint(
						this.nextId('c_tang'),
						line.p1Id,
						line.p2Id,
						circ.centerId,
						circ.id,
						this.getTangentSide(line, circ.centerId),
						1.0,
						line.id
					)
			);
		}

		// Case 2: Circle/Arc and Circle/Arc
		if (circ1 && circ2 && circ1.id !== circ2.id) {
			const existing = this.findConstraint(TangentCircleCircleConstraint, c =>
				this.matchesEndpoints(c.circle1Id, c.circle2Id, circ1.id, circ2.id)
			);
			if (existing) return existing;

			const center1 = this.points.get(circ1.centerId);
			const center2 = this.points.get(circ2.centerId);
			if (!center1 || !center2) return null;

			const d = center1.distanceTo(center2);
			const isInternal =
				Math.abs(d - Math.abs(circ1.radius - circ2.radius)) < Math.abs(d - (circ1.radius + circ2.radius));
			const outerCircleId = isInternal ? (circ1.radius >= circ2.radius ? circ1.id : circ2.id) : null;
			const arc1 = this.arcs.get(circ1.id);
			const arc2 = this.arcs.get(circ2.id);
			const sharedPointId =
				arc1 && arc2
					? ([arc1.startPointId, arc1.endPointId].find(id => id === arc2.startPointId || id === arc2.endPointId) ??
						null)
					: null;
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
		const dir = new Vec2().subVectors(p2, p1);
		return new Vec2().subVectors(center, p1).cross(dir) >= 0 ? 1 : -1;
	}

	addConcentricConstraint(c1Id: string, c2Id: string): ConcentricConstraint | null {
		const circ1 = this.getRadial(c1Id);
		const circ2 = this.getRadial(c2Id);
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
			if (lineOrP1Id === p2Id || !this.points.get(lineOrP1Id) || !this.points.get(p2Id)) return null;
			end1Id = lineOrP1Id;
			end2Id = p2Id;
		} else {
			const line = this.lines.get(lineOrP1Id);
			if (!line) return null;
			end1Id = line.p1Id;
			end2Id = line.p2Id;
		}

		if (pointId === end1Id || pointId === end2Id) return null;
		return this.addUniqueConstraint(
			MidpointConstraint,
			c => c.midId === pointId && this.matchesEndpoints(c.p1Id, c.p2Id, end1Id, end2Id),
			() => new MidpointConstraint(this.nextId('c_mid'), pointId, end1Id, end2Id)
		);
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
		return isSplineHandleLine(this, lineId);
	}

	isSplineHandlePoint(pointId: string): boolean {
		return isSplineHandlePoint(this, pointId);
	}

	resetFitSplineTangents(selectedLines: string[], selectedPoints: string[]): void {
		resetFitSplineTangents(this, selectedLines, selectedPoints);
	}

	isSplineInternalConstraint(c: IConstraint): boolean {
		return isSplineInternalConstraint(this, c);
	}

	private hasUserPrimitive(id: string): boolean {
		return this.primitiveCollections.some(col => col.map.has(id));
	}

	private hasConstraintEntity(id: string): boolean {
		return (
			!!this.points.get(id) ||
			!!this.getLine(id) ||
			this.primitiveCollections.some(col => col.type !== 'point' && col.type !== 'line' && col.map.has(id))
		);
	}

	private deleteSplineTangentLine(lid: string, candidatePointIds?: Set<string>): void {
		const line = this.lines.get(lid);
		if (!line) return;
		if (candidatePointIds) {
			candidatePointIds.add(line.p1Id);
			candidatePointIds.add(line.p2Id);
		}
		this.lines.delete(lid);
		this.selection.lineIds.delete(lid);
	}

	private deleteSplineWithHandles(sid: string, spline: SketchSpline, candidatePointIds: Set<string>): void {
		for (const ptId of spline.pointIds) candidatePointIds.add(ptId);
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				this.deleteSplineTangentLine(lid, spline.splineType === 'fit' ? candidatePointIds : undefined);
			}
		}
		this.splines.delete(sid);
		this.selection.splineIds.delete(sid);
	}

	getPrimitivePointIds(primitiveId: string): string[] {
		for (const col of this.primitiveCollections) {
			if (!col.isCurve) continue;
			const prim = col.map.get(primitiveId);
			if (prim) return prim.getPointIds(this);
		}
		return [];
	}

	cleanOrphanConstraints(): void {
		const dropConstraint = (cid: string) => {
			this.constraints.delete(cid);
			this.selection.constraintIds.delete(cid);
		};
		for (const [cid, constraint] of this.constraints.entries()) {
			if (constraint instanceof CircularPatternConstraint || constraint instanceof RectangularPatternConstraint) {
				// A trimmed/deleted arc may leave its center and endpoints in use. Keep the
				// remaining pattern, but never evaluate a radius equation against a missing
				// entity: the solver would read its radius as zero and collapse its source.
				const hasRadius = (id: string) => this.circles.has(id) || this.arcs.has(id);
				const missingRadiusIds = new Set<string>();
				for (const copy of constraint.copies) {
					if (!copy.radiusPairs) continue;
					copy.radiusPairs = copy.radiusPairs.filter(pair => {
						const sourceExists = hasRadius(pair.sourceCircleId);
						const copyExists = hasRadius(pair.patternCircleId);
						if (!sourceExists) missingRadiusIds.add(pair.sourceCircleId);
						if (!copyExists) missingRadiusIds.add(pair.patternCircleId);
						return sourceExists && copyExists;
					});
				}
				if (missingRadiusIds.size) constraint.entityIds = constraint.entityIds.filter(id => !missingRadiusIds.has(id));
			}
			if (constraint instanceof CircularPatternConstraint) {
				if (!this.points.get(constraint.centerPtId)) {
					dropConstraint(cid);
					continue;
				}
				const hasAnySource = constraint.sourceObjectIds.some(id => this.hasUserPrimitive(id));
				const hasMissingSpline = constraint.copies.some(copy =>
					copy.createdEntityIds.some(item => item.type === 'spline' && !this.splines.has(item.id))
				);
				const hasMissingPoint = constraint.copies.some(copy =>
					copy.pointPairs.some(pair => !this.points.get(pair.sourcePtId) || !this.points.get(pair.patternPtId))
				);
				if (!hasAnySource || hasMissingSpline || hasMissingPoint) {
					dropConstraint(cid);
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
				const hasAnySource = constraint.sourceObjectIds.some(id => this.hasUserPrimitive(id));
				const hasBrokenSplineCopy = constraint.copies.some(copy => {
					const splines = copy.createdEntityIds.filter(item => item.type === 'spline');
					return (
						splines.length > 0 &&
						(splines.some(item => !this.splines.has(item.id)) ||
							copy.pointPairs.some(pair => !this.points.get(pair.sourcePtId) || !this.points.get(pair.patternPtId)))
					);
				});
				if (!hasAnySource || hasBrokenSplineCopy) {
					dropConstraint(cid);
				}
				continue;
			}
			if (constraint.entityIds.some(entId => !this.hasConstraintEntity(entId))) {
				dropConstraint(cid);
				continue;
			}
			if (
				constraint instanceof SymmetryConstraint &&
				constraint.lineId &&
				constraint.lineId !== 'origin' &&
				!this.getLine(constraint.lineId) &&
				!this.getLineBetween(constraint.lineP1Id, constraint.lineP2Id)
			) {
				dropConstraint(cid);
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
		const targetCol = this.primitiveCollections.find(col => col.map.has(id));
		if (!targetCol) {
			return;
		}

		// Tangent lines and their handle endpoints cannot be deleted directly!
		if (targetCol.type === 'line' && this.isSplineHandleLine(id)) {
			return;
		}
		if (targetCol.type === 'point' && this.isSplineHandlePoint(id)) {
			return;
		}

		this.beginTransaction();

		const candidatePointIds = new Set<string>();

		if (targetCol.type === 'point') {
			this.points.delete(id);
			this.selection.pointIds.delete(id);

			// Remove non-spline primitives referencing this point
			for (const col of this.primitiveCollections) {
				if (col.type === 'point' || col.type === 'spline') continue;
				for (const [primId, prim] of col.map.entries()) {
					const ptIds = prim.getPointIds(this);
					if (ptIds.includes(id)) {
						for (const ptId of ptIds) candidatePointIds.add(ptId);
						col.map.delete(primId);
						this.selection[col.selectionKey].delete(primId);
					}
				}
			}

			// Update splines referencing this point
			for (const [sid, spline] of this.splines.entries()) {
				if (!spline.pointIds.includes(id)) continue;
				if (spline.splineType === 'control') {
					const remaining = spline.pointIds.filter(pid => pid !== id);
					if (remaining.length >= 2) {
						spline.pointIds = remaining;
						delete spline.knots;
						if (spline.tangentLineIds) {
							for (const lid of spline.tangentLineIds) this.deleteSplineTangentLine(lid);
						}
						spline.tangentLineIds = createControlSplineHandleLines(this, sid, remaining);
					} else {
						this.deleteSplineWithHandles(sid, spline, candidatePointIds);
					}
				} else if (spline.splineType === 'fit') {
					const unique = spline.isClosed ? spline.pointIds.slice(0, -1) : spline.pointIds;
					if (unique.length <= (spline.isClosed ? 3 : 2)) {
						this.deleteSplineWithHandles(sid, spline, candidatePointIds);
					} else {
						const idx = unique.indexOf(id);
						if (idx !== -1) {
							if (spline.tangentLineIds?.[idx]) {
								this.deleteSplineTangentLine(spline.tangentLineIds[idx], candidatePointIds);
							}
							const nextUnique = unique.filter((_, i) => i !== idx);
							spline.pointIds = spline.isClosed ? [...nextUnique, nextUnique[0]] : nextUnique;
							if (spline.tangentLineIds) {
								const baseTangents = spline.isClosed ? spline.tangentLineIds.slice(0, -1) : spline.tangentLineIds;
								const nextTangents = baseTangents.filter((_, i) => i !== idx);
								spline.tangentLineIds = spline.isClosed ? [...nextTangents, nextTangents[0]] : nextTangents;
							}
						}
					}
				}
			}
		} else if (targetCol.type === 'spline') {
			this.deleteSplineWithHandles(id, this.splines.get(id)!, candidatePointIds);
		} else {
			const prim = targetCol.map.get(id)!;
			for (const ptId of prim.getPointIds(this)) {
				candidatePointIds.add(ptId);
			}
			targetCol.map.delete(id);
			this.selection[targetCol.selectionKey].delete(id);
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
		const prim = this.getPrimitive(id);
		if (!prim || prim.type === 'point' || !this.primitiveCollectionMap.get(prim.type)?.map.has(id)) {
			return;
		}
		this.pushHistory();
		prim.isConstruction = !prim.isConstruction;
		this.notify();
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

		for (const entity of [...this.circles.values(), ...this.arcs.values()]) {
			this.paramManager.register({
				id: `${entity.id}.r`,
				get: () => entity.radius,
				set: val => {
					entity.radius = Math.max(MIN_SOLVER_RADIUS, val);
				},
				isFixed: false,
				min: MIN_SOLVER_RADIUS,
			});
		}
	}

	/**
	 * Radii driven by a radius/diameter constraint are applied directly and locked,
	 * so the solver never changes them to satisfy other constraints.
	 */
	private collectDrivenRadii(
		constraints: Iterable<IConstraint> = this.constraints.values(),
		locked = new Set<string>()
	): Set<string> {
		for (const c of constraints) {
			if (!(c instanceof RadiusConstraint)) continue;
			const entity = this.getRadial(c.circleId);
			if (!entity) continue;
			entity.radius = Math.max(MIN_SOLVER_RADIUS, c.targetRadius);
			locked.add(`${c.circleId}.r`);
		}
		return locked;
	}

	private getAllRadiusParams(base?: Iterable<string>): Set<string> {
		const all = new Set<string>(base);
		for (const id of this.circles.keys()) all.add(`${id}.r`);
		for (const id of this.arcs.keys()) all.add(`${id}.r`);
		return all;
	}

	private forEachActivePatternRadiusPair(
		c: CircularPatternConstraint | RectangularPatternConstraint,
		fn: (sourceRadiusParam: string, patternRadiusParam: string) => void
	): void {
		const suppressed = new Set(c.suppressedIndices);
		for (const copy of c.copies) {
			if (c.suppression && suppressed.has(copy.copyIndex)) continue;
			for (const pair of copy.radiusPairs ?? []) {
				fn(`${pair.sourceCircleId}.r`, `${pair.patternCircleId}.r`);
			}
		}
	}

	private lockedRadiusError(constraints: IConstraint[], values: Map<string, number>, limit: number): number {
		let sumSq = 0;
		for (const c of constraints) {
			if (c instanceof EqualRadiusConstraint || (c instanceof DistanceConstraint && c.circleIds)) {
				const [residual] = c.evaluate(values);
				sumSq += residual * residual;
			} else if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
				this.forEachActivePatternRadiusPair(c, (sourceParam, patternParam) => {
					const source = values.get(sourceParam) ?? 0;
					const destination = values.get(patternParam) ?? 0;
					const residual = (destination - source) * c.weight;
					sumSq += residual * residual;
				});
			}
			if (sumSq * 0.5 >= limit) break;
		}
		return sumSq * 0.5;
	}

	private buildRadiusStiffness(
		constraints: IConstraint[],
		allRadii: Set<string>,
		drivenRadii: Set<string>
	): Map<string, number> {
		const linked = new Set<string>(drivenRadii);
		const edges = new Map<string, string[]>();
		const link = (a: string, b: string) => {
			let listA = edges.get(a);
			if (!listA) edges.set(a, (listA = []));
			listA.push(b);
			let listB = edges.get(b);
			if (!listB) edges.set(b, (listB = []));
			listB.push(a);
		};
		for (const c of constraints) {
			if (c instanceof EqualRadiusConstraint) {
				link(`${c.circle1Id}.r`, `${c.circle2Id}.r`);
			} else if (c instanceof DistanceConstraint && c.circleIds) {
				link(`${c.circleIds[0]}.r`, `${c.circleIds[1]}.r`);
			} else if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
				this.forEachActivePatternRadiusPair(c, link);
			}
		}
		const queue = [...linked];
		for (let i = 0; i < queue.length; i++) {
			for (const next of edges.get(queue[i]) ?? []) {
				if (!linked.has(next)) {
					linked.add(next);
					queue.push(next);
				}
			}
		}
		const stiffness = new Map<string, number>();
		for (const id of allRadii) {
			if (!linked.has(id)) stiffness.set(id, 1000);
		}
		if (this.stableCenterEditDepth) {
			for (const id of this.circularCenterParams()) stiffness.set(id, 1e6);
		}
		return stiffness;
	}

	/**
	 * Runs `fn` without solving after each individual edit, then solves once.
	 * Use for bulk creation of many primitives and constraints.
	 */
	withDeferredSolve<T>(fn: () => T): T {
		this.solveDeferred++;
		try {
			return fn();
		} finally {
			this.solveDeferred--;
			if (this.solveDeferred === 0) this.solve();
		}
	}

	solve(extraConstraints: IConstraint[] = []): SolverResult {
		if (this.preserveCentersOnNextSolve && this.solveDeferred === 0) {
			this.preserveCentersOnNextSolve = false;
			return this.withStableCircleCenters(() => this.solve(extraConstraints));
		}
		if (this.solveDeferred > 0) {
			return (
				this.lastSolverResult ?? {
					status: 'UNDER_CONSTRAINED',
					iterations: 0,
					initialError: 0,
					finalError: 0,
					degreesOfFreedom: 0,
					constrainedParams: new Set<string>(),
					freeParametersCount: 0,
					equationsCount: 0,
				}
			);
		}
		const start = performance.now();
		const offsets = [...this.constraints.values()].filter(
			(c): c is OffsetConstraint => c instanceof OffsetConstraint && !!c.sourceChain
		);
		let res!: SolverResult;
		syncOffsetSources(this, offsets, () => {
			res = this.solveConstraints(extraConstraints);
		});
		this.lastSolverResult = res;
		this.lastSolveTimeMs = performance.now() - start;
		this.notify();
		return res;
	}

	private stableCenterEditDepth = 0;
	private preserveCentersOnNextSolve = false;

	/** Editing radii/endpoints should move circular centers only if constraints require it. */
	withStableCircleCenters<T>(edit: () => T): T {
		this.stableCenterEditDepth++;
		try {
			return edit();
		} finally {
			this.stableCenterEditDepth--;
		}
	}

	private circularCenterParams(): Set<string> {
		return new Set(
			[...this.circles.values(), ...this.arcs.values()].flatMap(entity => [
				`${entity.centerId}.x`,
				`${entity.centerId}.y`,
			])
		);
	}

	private tryStableCenterSolve(
		constraints: IConstraint[],
		drivenRadii: Set<string>,
		skipDoF = false,
		validator?: () => boolean
	): SolverResult | null {
		if (!this.stableCenterEditDepth) return null;
		// Radius-only relations and pattern copies do not couple radius edits to center motion.
		if (
			!constraints.some(
				c =>
					c instanceof ArcEndpointsConstraint ||
					c instanceof PointOnCircleConstraint ||
					c instanceof TangentLineCircleConstraint ||
					c instanceof TangentCircleCircleConstraint ||
					c instanceof OffsetConstraint
			)
		)
			return null;
		const centers = this.circularCenterParams();
		if (!centers.size) return null;
		const initial = this.paramManager.getCurrentValues();
		const trial = this.solver.solve(this.paramManager, constraints, {
			lockedParams: new Set([...drivenRadii, ...centers]),
			skipDoF: true,
		});
		// A solve with no free parameters can return without evaluating constant residuals.
		const error =
			this.paramManager.getFreeCount() > 0
				? trial.finalError
				: constraints.reduce(
						(sum, c) =>
							sum +
							c.evaluate(this.paramManager.getCurrentValues()).reduce((total, value) => total + (value * value) / 2, 0),
						0
					);
		if (trial.status !== 'OVER_CONSTRAINED' && error < 1e-8 && (!validator || validator())) {
			// Restore the real free-parameter set for DoF; a satisfied system needs no further motion.
			if (skipDoF) return trial;
			return this.solver.solve(this.paramManager, constraints, {
				lockedParams: drivenRadii,
				paramStiffness: new Map([...centers].map(id => [id, 1e6])),
			});
		}
		this.paramManager.restoreValues(initial);
		return null;
	}

	private isSolveAccepted(res: SolverResult, maxError: number, validator?: () => boolean): boolean {
		return res.status !== 'OVER_CONSTRAINED' && res.finalError < maxError && (!validator || validator());
	}

	private tryLockedRadiusSolve(
		constraints: IConstraint[],
		allRadii: Set<string>,
		drivenRadii: Set<string>,
		initialValues: Map<string, number>,
		maxError: number,
		validator?: () => boolean
	): boolean {
		if (allRadii.size <= drivenRadii.size || this.lockedRadiusError(constraints, initialValues, maxError) >= maxError) {
			return false;
		}
		const stage1 = this.solver.solve(this.paramManager, constraints, {
			lockedParams: allRadii,
			skipDoF: true,
		});
		const ok = this.isSolveAccepted(stage1, maxError, validator);
		if (!ok) {
			// Discard the least-squares compromise and start over from the original state.
			this.paramManager.restoreValues(initialValues);
		}
		return ok;
	}

	private solveConstraints(extraConstraints: IConstraint[]): SolverResult {
		const drivenRadii = this.collectDrivenRadii();
		const editedHandles: SketchLine[] = [];
		const activeConstraints = prepareSplineConstraints(this, extraConstraints, drivenRadii, editedHandles);
		for (const line of editedHandles) line.isAutomaticSplineHandle = false;
		const stable = this.tryStableCenterSolve(activeConstraints, drivenRadii);
		if (stable) return stable;

		// Interactive drags keep the regular behaviour (radius may follow the drag)
		if (extraConstraints.length > 0) {
			return this.solver.solve(this.paramManager, activeConstraints, {
				lockedParams: drivenRadii,
			});
		}

		// Radii are changed only as a last resort:
		// Stage 1: try to satisfy all constraints with every radius locked.
		const allRadii = this.getAllRadiusParams(drivenRadii);
		this.tryLockedRadiusSolve(activeConstraints, allRadii, drivenRadii, this.paramManager.getCurrentValues(), 1e-8);

		// Stage 2: free (non-driven) radii, but make them much stiffer than positions so
		// that the solver prefers moving geometry over resizing circles. When stage 1
		// succeeded this is a no-op / polish step that also computes the DoF.
		const stiffness = this.buildRadiusStiffness(activeConstraints, allRadii, drivenRadii);
		return this.solver.solve(this.paramManager, activeConstraints, {
			lockedParams: drivenRadii,
			paramStiffness: stiffness,
		});
	}

	getPointDragTarget(pointId: string, target: Vec2): Vec2 {
		const onAxis = (axis: 'x' | 'y') => {
			const c = this.getPointToAxisConstraint(pointId, axis);
			return c instanceof PointOnLineConstraint || (c instanceof DistanceConstraint && c.targetDistance === 0);
		};
		return new Vec2(onAxis('y') ? 0 : target.x, onAxis('x') ? 0 : target.y);
	}

	private moveUnfixedPoint(pointId: string, targetX: number, targetY: number): DragPointConstraint {
		const pt = this.points.get(pointId);
		if (pt && !this.isPointFixed(pointId)) {
			pt.x = targetX;
			pt.y = targetY;
		}
		return new DragPointConstraint(pointId, targetX, targetY, 0.005);
	}

	dragPoint(pointId: string, targetX: number, targetY: number): SolverResult {
		const pt = this.points.get(pointId);
		if (!pt || this.isPointFixed(pointId)) {
			return this.solve();
		}

		// Apply axis locks before automatic spline tangents are seeded for the solve.
		const target = this.getPointDragTarget(pointId, new Vec2(targetX, targetY));
		pt.x = target.x;
		pt.y = target.y;

		// Soft spring constraint pulls point to mouse position while preserving hard constraints.
		const dragConstraint = new DragPointConstraint(pointId, target.x, target.y, 0.005);
		const editsArcEndpoint = [...this.arcs.values()].some(
			arc => arc.centerId !== pointId && (arc.startPointId === pointId || arc.endPointId === pointId)
		);
		return editsArcEndpoint
			? this.withStableCircleCenters(() => this.solve([dragConstraint]))
			: this.solve([dragConstraint]);
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

		return this.solve([
			this.moveUnfixedPoint(line.p1Id, p1TargetX, p1TargetY),
			this.moveUnfixedPoint(line.p2Id, p2TargetX, p2TargetY),
		]);
	}

	dragCircle(circleId: string, targetCenterX: number, targetCenterY: number): SolverResult {
		const circle = this.circles.get(circleId);
		if (!circle) return this.solve();

		return this.solve([this.moveUnfixedPoint(circle.centerId, targetCenterX, targetCenterY)]);
	}

	dragCircleRadius(circleOrArcId: string, targetRadius: number): SolverResult {
		const entity = this.getRadial(circleOrArcId);
		if (!entity) return this.solve();

		entity.radius = Math.max(MIN_SOLVER_RADIUS, targetRadius);
		return this.withStableCircleCenters(() => {
			this.tryHardSolve([new RadiusConstraint('__temp_drag_radius', circleOrArcId, entity.radius)]);
			return this.solve();
		});
	}

	applyConstraintValueDirectly(c: IConstraint, newValue: number, displayMode?: 'radius' | 'diameter'): boolean {
		if (!isFinite(newValue) || newValue <= 0) return false;

		if (c instanceof DistanceConstraint || c instanceof PointToLineDistanceConstraint) {
			c.targetDistance = newValue;
			c.value = newValue;
			c.name = c.displayName;
			return true;
		}

		if (c instanceof OffsetConstraint) {
			return applyOffsetConstraintValue(this, c, newValue);
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
						const as = center.angleToPoint(start);
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
			c.name = this.formatRadiusConstraintName(targetRad, mode);
			this.preserveCentersOnNextSolve = true;

			const arc = this.arcs.get(c.circleId);
			if (arc) {
				const center = this.points.get(arc.centerId);
				if (center) {
					for (const ptId of [arc.startPointId, arc.endPointId]) {
						const pt = this.points.get(ptId);
						if (pt && !this.isPointFixed(ptId)) {
							const angle = center.angleToPoint(pt);
							pt.x = center.x + Math.cos(angle) * targetRad;
							pt.y = center.y + Math.sin(angle) * targetRad;
						}
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

		const offsetTransaction = c instanceof OffsetConstraint;
		if (offsetTransaction) this.beginTransaction();
		try {
			const applied = this.applyConstraintValueDirectly(c, val, displayMode);
			if (applied) {
				c.expression = expr;
				this.solve();
				return true;
			}
			return false;
		} finally {
			if (offsetTransaction) this.commitTransaction(false);
		}
	}

	getParameterValuesMap(): Map<string, number> {
		return getParameterValuesMap(this);
	}

	evaluateExpression(expr: string): {
		value?: number;
		isValid: boolean;
		error?: string;
		referencedVars: string[];
	} {
		return evaluateSketchExpression(this, expr);
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
		return addSketchParameter(this, name, expression, comment);
	}

	updateParameter(
		name: string,
		newName: string,
		newExpr: string,
		comment?: string
	): { success: boolean; error?: string } {
		return updateSketchParameter(this, name, newName, newExpr, comment);
	}

	deleteParameter(name: string): { success: boolean; error?: string } {
		return deleteSketchParameter(this, name);
	}

	recomputeParametersAndConstraints(pushHistory = false): {
		success: boolean;
		errors: Map<string, string>;
	} {
		return recomputeParametersAndConstraints(this, pushHistory);
	}

	tryHardSolve(tempHardConstraints: IConstraint[], extraValidator?: () => boolean): boolean {
		const initialValues = this.paramManager.getCurrentValues();
		const drivenRadii = this.collectDrivenRadii();
		const editedHandles: SketchLine[] = [];
		const activeConstraints = prepareSplineConstraints(this, tempHardConstraints, drivenRadii, editedHandles);
		this.collectDrivenRadii(tempHardConstraints, drivenRadii);

		const stable = this.tryStableCenterSolve(activeConstraints, drivenRadii, true, extraValidator);
		if (stable) {
			for (const line of editedHandles) line.isAutomaticSplineHandle = false;
			return true;
		}

		const allRadii = this.getAllRadiusParams(drivenRadii);
		const maxError = 1e-8;
		let solvedOk = this.tryLockedRadiusSolve(
			activeConstraints,
			allRadii,
			drivenRadii,
			initialValues,
			maxError,
			extraValidator
		);

		if (!solvedOk) {
			const stiffness = this.buildRadiusStiffness(activeConstraints, allRadii, drivenRadii);
			const solveStiff = () =>
				this.solver.solve(this.paramManager, activeConstraints, {
					lockedParams: drivenRadii,
					paramStiffness: stiffness,
					skipDoF: true,
				});
			let stage2 = solveStiff();
			if (
				stage2.status !== 'OVER_CONSTRAINED' &&
				stage2.finalError >= 1e-10 &&
				stage2.iterations >= this.solver.maxIterations
			) {
				stage2 = solveStiff();
			}
			solvedOk = this.isSolveAccepted(stage2, maxError, extraValidator);
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

	getEntitiesForConstraint(
		c: IConstraint,
		patternLinks?: PatternLinks
	): Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
	}> {
		return getEntitiesForConstraint(this, c, patternLinks);
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
		mode: boolean | 'toggle' = false
	): void {
		selectEntities(this, items, mode);
	}

	selectEntity(id: string, type: SelectableEntityType, multiSelect = false): void {
		selectEntity(this, id, type, multiSelect);
	}

	addImage(data: Omit<SketchImage, 'id'>): SketchImage {
		this.pushHistory(false);
		const image = { ...data, id: this.nextId('Image') };
		this.images.set(image.id, image);
		this.notify();
		return image;
	}

	updateImage(id: string, changes: Partial<Omit<SketchImage, 'id'>>): void {
		const image = this.images.get(id);
		if (!image || Object.entries(changes).every(([key, value]) => image[key as keyof SketchImage] === value)) return;
		this.pushHistory(false);
		this.images.set(id, { ...image, ...changes });
		this.notify();
	}

	removeImage(id: string): void {
		if (!this.images.has(id)) return;
		this.pushHistory(false);
		this.images.delete(id);
		this.notify();
	}

	clear(): void {
		this.pushHistory();
		for (const col of this.primitiveCollections) col.map.clear();
		this.texts.clear();
		this.images.clear();
		this.constraints.clear();
		this.parameters.clear();
		clearSelectionSets(this);
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

	exportSVG(
		viewportState?: { panX: number; panY: number; zoom: number },
		scale = 1,
		layers?: SvgExportOptions,
		dimensions?: SvgExportDimensions
	): string {
		return exportSketchToSVG(this, viewportState, scale, layers, dimensions);
	}

	importSVG(svgString: string): {
		success: boolean;
		viewport?: { panX: number; panY: number; zoom: number };
		exportSettings?: SvgExportSettings;
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

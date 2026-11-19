import type { SketchImage } from './image';
import type { NumericalSolver, ParamManager } from '../solver/solver';
import type { IConstraint, SolverResult } from '../solver/types';
import {
	ArcEndpointsConstraint,
	EllipseAxisConstraint,
	EllipticalArcEndpointsConstraint,
	type FixedConstraint,
	type CoincidentConstraint,
	type HorizontalConstraint,
	type VerticalConstraint,
	type DistanceConstraint,
	type RadiusConstraint,
	type EqualLengthConstraint,
	type EqualRadiusConstraint,
	type ParallelConstraint,
	type CollinearConstraint,
	type PerpendicularConstraint,
	type PointOnLineConstraint,
	type PointOnCircleConstraint,
	type PointOnEllipseConstraint,
	type PointOnSplineConstraint,
	type TangentLineCircleConstraint,
	type TangentCircleCircleConstraint,
	type ConcentricConstraint,
	type MidpointConstraint,
	type AngleConstraint,
	type PointToLineDistanceConstraint,
	type SymmetryConstraint,
	type CircularPatternConstraint,
	type PatternCopyData,
	type RectangularPatternConstraint,
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
	addPolygon,
} from './patterns';
import {
	addConstraint,
	removeConstraint,
	addFixedConstraint,
	removeFixedConstraint,
	toggleFixedConstraint,
	toggleFixedConstraints,
	addCoincidentConstraint,
	addCoincidentConstraints,
	addOriginCoincidentConstraint,
	addHorizontalConstraint,
	addVerticalConstraint,
	addEqualLengthConstraint,
	addEqualRadiusConstraint,
	addParallelConstraint,
	addPerpendicularConstraint,
	addLineCollinearWithAxisConstraint,
	addThreePointCollinearConstraint,
	addCollinearConstraint,
	addSymmetryConstraint,
	addLineSymmetryConstraints,
	addPointOnAxisConstraint,
	addPointOnLineConstraint,
	addPointOnCircleConstraint,
	addPointOnEllipseConstraint,
	addPointOnSplineConstraint,
	addTangentConstraint,
	addCircleTangentConstraint,
	addConcentricConstraint,
	addMidpointConstraint,
	addThreePointMidpointConstraint,
	cleanOrphanConstraints,
} from './constraintOperations';
import {
	getDistanceConstraint,
	hasDistanceConstraint,
	addDistanceConstraint,
	canAddCircleDistanceConstraint,
	addCircleDistanceConstraint,
	canAddCircleToLineDistanceConstraint,
	addCircleToLineDistanceConstraint,
	getPointToLineDistanceConstraint,
	hasPointToLineDistanceConstraint,
	addPointToLineDistanceConstraint,
	getLineToLineDistanceConstraint,
	canAddLineToLineDistanceConstraint,
	addLineToLineDistanceConstraint,
	getOriginConstraint,
	hasOriginConstraint,
	addOriginDistanceConstraint,
	getPointToAxisConstraint,
	hasPointToAxisConstraint,
	addPointToAxisDistanceConstraint,
	getLineToAxisConstraint,
	hasLineToAxisConstraint,
	addLineToAxisDistanceConstraint,
	calculateLinesAngleGeometry,
	addAngleConstraint,
	addThreePointAngleConstraint,
	addArcAngleConstraint,
	addRadiusConstraint,
	applyConstraintValueDirectly,
	updateDimensionalConstraint,
} from './dimensionOperations';
import { SolveCoordinator } from './solveCoordinator';
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
import type { Vec2, XY } from '../math/vector';
import type { AABB } from '../math/aabb';
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
	addFitSpline,
	addControlSpline,
	copySpline,
	isSplineHandleLine,
	isSplineHandlePoint,
	resetFitSplineTangents,
	isSplineInternalConstraint,
	restoreAutomaticSplineHandles,
	deleteSplineWithHandles,
	removePointFromSplines,
} from './splineOperations';
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

export interface SketchDocumentOptions {
	solver?: NumericalSolver;
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
	readonly solverCoordinator: SolveCoordinator;

	constructor(options?: SketchDocumentOptions) {
		this.solverCoordinator = new SolveCoordinator(this, options?.solver);
	}

	get paramManager(): ParamManager {
		return this.solverCoordinator.paramManager;
	}

	get lastSolverResult(): SolverResult | null {
		return this.solverCoordinator.lastSolverResult;
	}

	get lastSolveTimeMs(): number {
		return this.solverCoordinator.lastSolveTimeMs;
	}

	// History & Transactions
	private history = new HistoryManager();
	private batchDepth = 0;
	private batchSnapshot: SketchSnapshot | null = null;
	private updatingOffsets = false;

	isInTransaction(): boolean {
		return this.batchDepth > 0;
	}

	runSilentDerivedUpdate(fn: () => void): void {
		// Derived edits belong to the caller's history entry. Suppress nested solves,
		// snapshots and notifications while topology is being reconciled.
		this.updatingOffsets = true;
		this.batchDepth++;
		try {
			this.solverCoordinator.runWithSuppressedSolve(fn);
		} finally {
			this.batchDepth--;
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
		this.solverCoordinator.refreshReferenceDimensions();
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

	/** Discard the initial driving dimension's edits while retaining its measured replacement. */
	restoreReferenceCreation(reference: IConstraint): void {
		if (!this.batchSnapshot || !reference.isReference) return;
		const snapshot = this.batchSnapshot;
		this.runSilentDerivedUpdate(() => {
			this.restoreSnapshot(snapshot);
			this.constraints.set(reference.id, reference);
		});
		this.notify();
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
		this.solverCoordinator.refreshReferenceDimensions();
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

	getPrimitiveCollections(): ReadonlyArray<{
		readonly type: PrimitiveType;
		readonly map: Map<string, ISketchPrimitive>;
		readonly selectionKey: keyof SelectionState;
		readonly isCurve: boolean;
	}> {
		return this.primitiveCollections;
	}

	getPrimitiveMap(type: PrimitiveType): Map<string, ISketchPrimitive> | undefined {
		return this.primitiveCollectionMap.get(type)?.map;
	}

	hasOwnPrimitive(id: string, type?: PrimitiveType): boolean {
		if (type) return this.primitiveCollectionMap.get(type)?.map.has(id) ?? false;
		return this.primitiveCollections.some(col => col.map.has(id));
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
	addConstraint(constraint: IConstraint): boolean {
		return addConstraint(this, constraint);
	}

	removeConstraint(id: string): void {
		removeConstraint(this, id);
	}

	addFixedConstraint(pointId: string): FixedConstraint | null {
		return addFixedConstraint(this, pointId);
	}

	removeFixedConstraint(pointId: string): boolean {
		return removeFixedConstraint(this, pointId);
	}

	toggleFixedConstraint(pointId: string): boolean {
		return toggleFixedConstraint(this, pointId);
	}

	toggleFixedConstraints(pointIds: string[]): boolean {
		return toggleFixedConstraints(this, pointIds);
	}

	addCoincidentConstraint(p1Id: string, p2Id: string): CoincidentConstraint | null {
		return addCoincidentConstraint(this, p1Id, p2Id);
	}

	addCoincidentConstraints(pointIds: Iterable<string>): boolean {
		return addCoincidentConstraints(this, pointIds);
	}

	addHorizontalConstraint(p1Id: string, p2Id: string): HorizontalConstraint | null {
		return addHorizontalConstraint(this, p1Id, p2Id);
	}

	addVerticalConstraint(p1Id: string, p2Id: string): VerticalConstraint | null {
		return addVerticalConstraint(this, p1Id, p2Id);
	}

	getDistanceConstraint(
		p1Id: string,
		p2Id: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): DistanceConstraint | undefined {
		return getDistanceConstraint(this, p1Id, p2Id, orientation);
	}

	hasDistanceConstraint(p1Id: string, p2Id: string, orientation?: 'aligned' | 'horizontal' | 'vertical'): boolean {
		return hasDistanceConstraint(this, p1Id, p2Id, orientation);
	}

	addDistanceConstraint(
		p1Id: string,
		p2Id: string,
		targetDist?: number,
		offset?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned'
	): DistanceConstraint | null {
		return addDistanceConstraint(this, p1Id, p2Id, targetDist, offset, orientation);
	}

	canAddCircleDistanceConstraint(circle1Id: string, circle2Id: string): boolean {
		return canAddCircleDistanceConstraint(this, circle1Id, circle2Id);
	}

	addCircleDistanceConstraint(
		circle1Id: string,
		circle2Id: string,
		targetDistance?: number
	): DistanceConstraint | null {
		return addCircleDistanceConstraint(this, circle1Id, circle2Id, targetDistance);
	}

	canAddCircleToLineDistanceConstraint(radialId: string, lineId: string): boolean {
		return canAddCircleToLineDistanceConstraint(this, radialId, lineId);
	}

	addCircleToLineDistanceConstraint(
		radialId: string,
		lineId: string,
		targetDistance?: number
	): DistanceConstraint | PointToLineDistanceConstraint | null {
		return addCircleToLineDistanceConstraint(this, radialId, lineId, targetDistance);
	}

	getPointToLineDistanceConstraint(pointId: string, lineId: string): PointToLineDistanceConstraint | undefined {
		return getPointToLineDistanceConstraint(this, pointId, lineId);
	}

	hasPointToLineDistanceConstraint(pointId: string, lineId: string): boolean {
		return hasPointToLineDistanceConstraint(this, pointId, lineId);
	}

	addPointToLineDistanceConstraint(
		pointId: string,
		lineId: string,
		targetDist?: number,
		offset?: number
	): PointToLineDistanceConstraint | null {
		return addPointToLineDistanceConstraint(this, pointId, lineId, targetDist, offset);
	}

	getLineToLineDistanceConstraint(line1Id: string, line2Id: string): PointToLineDistanceConstraint | undefined {
		return getLineToLineDistanceConstraint(this, line1Id, line2Id);
	}

	canAddLineToLineDistanceConstraint(line1Id: string, line2Id: string): boolean {
		return canAddLineToLineDistanceConstraint(this, line1Id, line2Id);
	}

	addLineToLineDistanceConstraint(
		line1Id: string,
		line2Id: string,
		targetDist?: number,
		offset?: number
	): PointToLineDistanceConstraint | null {
		return addLineToLineDistanceConstraint(this, line1Id, line2Id, targetDist, offset);
	}

	getOriginConstraint(
		pointId: string,
		orientation?: 'aligned' | 'horizontal' | 'vertical'
	): DistanceConstraint | CoincidentConstraint | undefined {
		return getOriginConstraint(this, pointId, orientation);
	}

	hasOriginConstraint(pointId: string, orientation?: 'aligned' | 'horizontal' | 'vertical'): boolean {
		return hasOriginConstraint(this, pointId, orientation);
	}

	addOriginDistanceConstraint(
		pointId: string,
		targetDist?: number,
		orientation: 'aligned' | 'horizontal' | 'vertical' = 'aligned',
		offset?: number
	): DistanceConstraint | null {
		return addOriginDistanceConstraint(this, pointId, targetDist, orientation, offset);
	}

	addOriginCoincidentConstraint(pointId: string): CoincidentConstraint | null {
		return addOriginCoincidentConstraint(this, pointId);
	}

	getPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): DistanceConstraint | PointOnLineConstraint | undefined {
		return getPointToAxisConstraint(this, pointId, axis);
	}

	hasPointToAxisConstraint(pointId: string, axis: 'x' | 'y'): boolean {
		return hasPointToAxisConstraint(this, pointId, axis);
	}

	addPointToAxisDistanceConstraint(
		pointId: string,
		axis: 'x' | 'y',
		targetDist?: number,
		offset?: number
	): DistanceConstraint | null {
		return addPointToAxisDistanceConstraint(this, pointId, axis, targetDist, offset);
	}

	addPointOnAxisConstraint(pointId: string, axis: 'x' | 'y'): PointOnLineConstraint | null {
		return addPointOnAxisConstraint(this, pointId, axis);
	}

	getLineToAxisConstraint(
		lineId: string,
		axis: 'x' | 'y'
	): PointToLineDistanceConstraint | CollinearConstraint | undefined {
		return getLineToAxisConstraint(this, lineId, axis);
	}

	hasLineToAxisConstraint(lineId: string, axis: 'x' | 'y'): boolean {
		return hasLineToAxisConstraint(this, lineId, axis);
	}

	addLineToAxisDistanceConstraint(
		lineId: string,
		axis: 'x' | 'y',
		targetDist?: number,
		offset?: number
	): PointToLineDistanceConstraint | null {
		return addLineToAxisDistanceConstraint(this, lineId, axis, targetDist, offset);
	}

	addLineCollinearWithAxisConstraint(lineId: string, axis: 'x' | 'y'): CollinearConstraint | null {
		return addLineCollinearWithAxisConstraint(this, lineId, axis);
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
		return calculateLinesAngleGeometry(this, p1, p2, p3, p4, cursorPos, line1Id, line2Id);
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
		return addAngleConstraint(this, line1Id, line2Id, targetAngleDeg, arcRadius, cursorPosOrS1, s2Param, signParam);
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
		return addThreePointAngleConstraint(this, p1Id, p2Id, p3Id, targetAngleDeg, arcRadius, s1Param, s2Param, signParam);
	}

	addArcAngleConstraint(arcId: string, targetAngleDeg: number, arcRadius = 40, sweepSign = 1): AngleConstraint | null {
		return addArcAngleConstraint(this, arcId, targetAngleDeg, arcRadius, sweepSign);
	}

	addRadiusConstraint(
		circleOrArcId: string,
		targetRadius?: number,
		displayMode?: 'radius' | 'diameter',
		placement?: Pick<RadiusConstraint, 'leaderAngle' | 'leaderOffset'>
	): RadiusConstraint | null {
		return addRadiusConstraint(this, circleOrArcId, targetRadius, displayMode, placement);
	}

	addEqualLengthConstraint(line1Id: string, line2Id: string): EqualLengthConstraint | null {
		return addEqualLengthConstraint(this, line1Id, line2Id);
	}

	addEqualRadiusConstraint(circle1Id: string, circle2Id: string): EqualRadiusConstraint | null {
		return addEqualRadiusConstraint(this, circle1Id, circle2Id);
	}

	addParallelConstraint(line1Id: string, line2Id: string): ParallelConstraint | null {
		return addParallelConstraint(this, line1Id, line2Id);
	}

	addThreePointCollinearConstraint(p1Id: string, p2Id: string, p3Id: string): CollinearConstraint | null {
		return addThreePointCollinearConstraint(this, p1Id, p2Id, p3Id);
	}

	addCollinearConstraint(line1Id: string, line2Id: string, p3Id?: string): CollinearConstraint | null {
		return addCollinearConstraint(this, line1Id, line2Id, p3Id);
	}

	addSymmetryConstraint(p1Id: string, p2Id: string, lineId: string, isMirrorCopy?: boolean): SymmetryConstraint | null {
		return addSymmetryConstraint(this, p1Id, p2Id, lineId, isMirrorCopy);
	}

	addLineSymmetryConstraints(line1Id: string, line2Id: string, axisId: string): IConstraint[] {
		return addLineSymmetryConstraints(this, line1Id, line2Id, axisId);
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
		return addPolygon(this, centerPointId, radius, sides, angleRad, isConstruction, addDistanceConstraint, options);
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
		return addPerpendicularConstraint(this, line1Id, line2Id);
	}

	addPointOnLineConstraint(pointId: string, lineId: string): PointOnLineConstraint | null {
		return addPointOnLineConstraint(this, pointId, lineId);
	}

	addPointOnCircleConstraint(pointId: string, circleOrArcId: string): PointOnCircleConstraint | null {
		return addPointOnCircleConstraint(this, pointId, circleOrArcId);
	}

	addPointOnEllipseConstraint(pointId: string, ellipseOrArcId: string): PointOnEllipseConstraint | null {
		return addPointOnEllipseConstraint(this, pointId, ellipseOrArcId);
	}

	addPointOnSplineConstraint(pointId: string, splineId: string): PointOnSplineConstraint | null {
		return addPointOnSplineConstraint(this, pointId, splineId);
	}

	addTangentConstraint(
		entity1Id: string,
		entity2Id: string
	): TangentLineCircleConstraint | TangentCircleCircleConstraint | null {
		return addTangentConstraint(this, entity1Id, entity2Id);
	}

	addCircleTangentConstraint(c1Id: string, c2Id: string): TangentCircleCircleConstraint | null {
		return addCircleTangentConstraint(this, c1Id, c2Id);
	}

	addConcentricConstraint(c1Id: string, c2Id: string): ConcentricConstraint | null {
		return addConcentricConstraint(this, c1Id, c2Id);
	}

	addMidpointConstraint(pointId: string, lineOrP1Id: string, p2Id?: string): MidpointConstraint | null {
		return addMidpointConstraint(this, pointId, lineOrP1Id, p2Id);
	}

	addThreePointMidpointConstraint(p1Id: string, p2Id: string, p3Id: string): MidpointConstraint | null {
		return addThreePointMidpointConstraint(this, p1Id, p2Id, p3Id);
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

	getPrimitivePointIds(primitiveId: string): string[] {
		for (const col of this.primitiveCollections) {
			if (!col.isCurve) continue;
			const prim = col.map.get(primitiveId);
			if (prim) return prim.getPointIds(this);
		}
		return [];
	}

	cleanOrphanConstraints(): void {
		cleanOrphanConstraints(this);
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

			removePointFromSplines(this, id, candidatePointIds);
		} else if (targetCol.type === 'spline') {
			deleteSplineWithHandles(this, id, this.splines.get(id)!, candidatePointIds);
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
		this.solverCoordinator.rebuildParamManager();
	}

	/**
	 * Runs `fn` without solving after each individual edit, then solves once.
	 * Use for bulk creation of many primitives and constraints.
	 */
	withDeferredSolve<T>(fn: () => T): T {
		return this.solverCoordinator.withDeferredSolve(fn);
	}

	solve(extraConstraints: IConstraint[] = []): SolverResult {
		return this.solverCoordinator.solve(extraConstraints);
	}

	/** Editing radii/endpoints should move circular centers only if constraints require it. */
	withStableCircleCenters<T>(edit: () => T): T {
		return this.solverCoordinator.withStableCircleCenters(edit);
	}

	getPointDragTarget(pointId: string, target: Vec2): Vec2 {
		return this.solverCoordinator.getPointDragTarget(pointId, target);
	}

	dragPoint(pointId: string, targetX: number, targetY: number): SolverResult {
		return this.solverCoordinator.dragPoint(pointId, targetX, targetY);
	}

	dragLine(lineId: string, p1TargetX: number, p1TargetY: number, p2TargetX: number, p2TargetY: number): SolverResult {
		return this.solverCoordinator.dragLine(lineId, p1TargetX, p1TargetY, p2TargetX, p2TargetY);
	}

	dragCircle(circleId: string, targetCenterX: number, targetCenterY: number): SolverResult {
		return this.solverCoordinator.dragCircle(circleId, targetCenterX, targetCenterY);
	}

	dragCircleRadius(circleOrArcId: string, targetRadius: number): SolverResult {
		return this.solverCoordinator.dragCircleRadius(circleOrArcId, targetRadius);
	}

	applyConstraintValueDirectly(c: IConstraint, newValue: number, displayMode?: 'radius' | 'diameter'): boolean {
		return applyConstraintValueDirectly(this, c, newValue, displayMode);
	}

	updateDimensionalConstraint(
		constraintId: string,
		newValue: number | string,
		displayMode?: 'radius' | 'diameter'
	): boolean {
		return updateDimensionalConstraint(this, constraintId, newValue, displayMode);
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
		return this.solverCoordinator.tryHardSolve(tempHardConstraints, extraValidator);
	}

	solveWithTemporaryHardConstraints(
		tempHardConstraints: IConstraint[],
		fallbackSoftConstraints: IConstraint[] = [],
		extraValidator?: () => boolean
	): void {
		this.solverCoordinator.solveWithTemporaryHardConstraints(
			tempHardConstraints,
			fallbackSoftConstraints,
			extraValidator
		);
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

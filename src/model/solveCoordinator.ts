import type { SketchDocument } from './sketch';
import { getRadial } from './constraintOperations';
import { syncOffsetSources } from './offsetSync';
import { prepareSplineConstraints } from './splineOperations';
import { ParamManager, NumericalSolver } from '../solver/solver';
import type { IConstraint, SolverResult } from '../solver/types';
import {
	RadiusConstraint,
	DistanceConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	DragPointConstraint,
	ArcEndpointsConstraint,
	OffsetConstraint,
	EqualRadiusConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import type { SketchLine } from './types';
import { Vec2 } from '../math/vector';
import { MIN_OFFSET_RADIUS as MIN_SOLVER_RADIUS } from '../kernel/offsetTypes';

export class SolveCoordinator {
	private readonly sketch: SketchDocument;
	readonly paramManager = new ParamManager();
	private solver = new NumericalSolver({ gradRelTolerance: 1e-6 });
	lastSolverResult: SolverResult | null = null;
	lastSolveTimeMs = 0;

	private solveDeferred = 0;
	private stableCenterEditDepth = 0;
	private preserveCentersOnNextSolve = false;

	constructor(sketch: SketchDocument) {
		this.sketch = sketch;
	}

	markPreserveCentersOnNextSolve(): void {
		this.preserveCentersOnNextSolve = true;
	}

	runWithSuppressedSolve(fn: () => void): void {
		this.solveDeferred++;
		try {
			fn();
		} finally {
			this.solveDeferred--;
		}
	}

	rebuildParamManager(): void {
		this.paramManager.clear();

		for (const pt of this.sketch.points.values()) {
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

		for (const entity of [...this.sketch.circles.values(), ...this.sketch.arcs.values()]) {
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
		constraints: Iterable<IConstraint> = this.sketch.constraints.values(),
		locked = new Set<string>()
	): Set<string> {
		for (const c of constraints) {
			if (!(c instanceof RadiusConstraint)) continue;
			const entity = getRadial(this.sketch, c.circleId);
			if (!entity) continue;
			entity.radius = Math.max(MIN_SOLVER_RADIUS, c.targetRadius);
			locked.add(`${c.circleId}.r`);
		}
		return locked;
	}

	private getAllRadiusParams(base?: Iterable<string>): Set<string> {
		const all = new Set<string>(base);
		for (const id of this.sketch.circles.keys()) all.add(`${id}.r`);
		for (const id of this.sketch.arcs.keys()) all.add(`${id}.r`);
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
		const offsets = [...this.sketch.constraints.values()].filter(
			(c): c is OffsetConstraint => c instanceof OffsetConstraint && !!c.sourceChain
		);
		let res!: SolverResult;
		syncOffsetSources(this.sketch, offsets, () => {
			res = this.solveConstraints(extraConstraints);
		});
		this.lastSolverResult = res;
		this.lastSolveTimeMs = performance.now() - start;
		this.sketch.notify();
		return res;
	}

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
			[...this.sketch.circles.values(), ...this.sketch.arcs.values()].flatMap(entity => [
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
		const activeConstraints = prepareSplineConstraints(this.sketch, extraConstraints, drivenRadii, editedHandles);
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

	tryHardSolve(tempHardConstraints: IConstraint[], extraValidator?: () => boolean): boolean {
		const initialValues = this.paramManager.getCurrentValues();
		const drivenRadii = this.collectDrivenRadii();
		const editedHandles: SketchLine[] = [];
		const activeConstraints = prepareSplineConstraints(this.sketch, tempHardConstraints, drivenRadii, editedHandles);
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

	getPointDragTarget(pointId: string, target: Vec2): Vec2 {
		const onAxis = (axis: 'x' | 'y') => {
			const c = this.sketch.getPointToAxisConstraint(pointId, axis);
			return c instanceof PointOnLineConstraint || (c instanceof DistanceConstraint && c.targetDistance === 0);
		};
		return new Vec2(onAxis('y') ? 0 : target.x, onAxis('x') ? 0 : target.y);
	}

	private moveUnfixedPoint(pointId: string, targetX: number, targetY: number): DragPointConstraint {
		const pt = this.sketch.points.get(pointId);
		if (pt && !this.sketch.isPointFixed(pointId)) {
			pt.x = targetX;
			pt.y = targetY;
		}
		return new DragPointConstraint(pointId, targetX, targetY, 0.005);
	}

	dragPoint(pointId: string, targetX: number, targetY: number): SolverResult {
		const pt = this.sketch.points.get(pointId);
		if (!pt || this.sketch.isPointFixed(pointId)) {
			return this.solve();
		}

		// Apply axis locks before automatic spline tangents are seeded for the solve.
		const target = this.getPointDragTarget(pointId, new Vec2(targetX, targetY));
		pt.x = target.x;
		pt.y = target.y;

		// Soft spring constraint pulls point to mouse position while preserving hard constraints.
		const dragConstraint = new DragPointConstraint(pointId, target.x, target.y, 0.005);
		const editsArcEndpoint = [...this.sketch.arcs.values()].some(
			arc => arc.centerId !== pointId && (arc.startPointId === pointId || arc.endPointId === pointId)
		);
		return editsArcEndpoint
			? this.withStableCircleCenters(() => this.solve([dragConstraint]))
			: this.solve([dragConstraint]);
	}

	dragLine(lineId: string, p1TargetX: number, p1TargetY: number, p2TargetX: number, p2TargetY: number): SolverResult {
		const line = this.sketch.lines.get(lineId);
		if (!line) return this.solve();

		const spline = line.parentSplineId ? this.sketch.splines.get(line.parentSplineId) : undefined;
		if (spline?.splineType === 'fit') {
			// Drag one end of the tangent so the other end can pivot around the fit point.
			return this.sketch.isPointFixed(line.p2Id)
				? this.dragPoint(line.p1Id, p1TargetX, p1TargetY)
				: this.dragPoint(line.p2Id, p2TargetX, p2TargetY);
		}

		return this.solve([
			this.moveUnfixedPoint(line.p1Id, p1TargetX, p1TargetY),
			this.moveUnfixedPoint(line.p2Id, p2TargetX, p2TargetY),
		]);
	}

	dragCircle(circleId: string, targetCenterX: number, targetCenterY: number): SolverResult {
		const circle = this.sketch.circles.get(circleId);
		if (!circle) return this.solve();

		return this.solve([this.moveUnfixedPoint(circle.centerId, targetCenterX, targetCenterY)]);
	}

	dragCircleRadius(circleOrArcId: string, targetRadius: number): SolverResult {
		const entity = getRadial(this.sketch, circleOrArcId);
		if (!entity) return this.solve();

		entity.radius = Math.max(MIN_SOLVER_RADIUS, targetRadius);
		return this.withStableCircleCenters(() => {
			this.tryHardSolve([new RadiusConstraint('__temp_drag_radius', circleOrArcId, entity.radius)]);
			return this.solve();
		});
	}
}

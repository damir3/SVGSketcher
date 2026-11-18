import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { distanceToLinearDimensionVisual, formatDimensionValue } from '../../canvas/dimensionGeometry';
import { Vec2, projectPointOntoSegment, projectPointOntoLine, type XY } from '../../math/vector';
import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import type { QueryCurve } from '../../kernel/queryTypes';
import { getQueryKernel } from '../../math/queries';
import { createSvgElement } from '../../canvas/svg';

/**
 * Line pair: both endpoints of the offset line lie at signed distance `side * d`
 * from the infinite original line (positive = left of origP1 -> origP2).
 */
export interface OffsetLinePair {
	kind: 'line';
	origLineId: string;
	origP1Id: string;
	origP2Id: string;
	offLineId: string;
	offP1Id: string;
	offP2Id: string;
	side: number;
}

/**
 * Circle/arc pair: concentric centers and offRadius - origRadius = side * d.
 */
export interface OffsetCirclePair {
	kind: 'circle';
	origId: string;
	origCenterId: string;
	offId: string;
	offCenterId: string;
	side: number;
}

export interface OffsetSplinePoint {
	pointId: string;
	basePos: XY;
	normal: XY;
	side: number;
}

export interface OffsetSplinePair {
	kind: 'spline';
	origSplineId: string;
	offSplineId: string;
	points: OffsetSplinePoint[];
}

export type OffsetPair = (OffsetLinePair | OffsetCirclePair | OffsetSplinePair) & { contourIndex?: number };

/**
 * Dimensional offset constraint: ties a chain of offset lines / arcs / circles / splines to their
 * originals with one shared offset distance.
 */
export class OffsetConstraint extends BaseConstraint {
	targetDistance: number;
	pairs: OffsetPair[];
	/** Index of the pair used to place the visual dimension */
	dimPairIndex: number;
	declare labelWorld?: XY;
	sourceChain?: any;
	direction?: any;
	flip?: boolean;
	cornerPointIds?: string[];
	junctionConstraintIds?: string[];
	/** Keeps the distance editable while an inward contour has no surviving geometry. */
	declare emptyDimension?: { anchor: XY; normal: XY };

	constructor(
		id: string,
		pairs: OffsetPair[],
		targetDistance: number,
		dimPairIndex = 0,
		weight = 1.0,
		sourceChain?: any,
		direction?: any,
		flip?: boolean,
		cornerPointIds?: string[]
	) {
		const ids = new Set<string>();
		for (const item of sourceChain?.items ?? []) ids.add(item.id);
		for (const p of pairs) {
			if (p.kind === 'line') {
				[p.origLineId, p.origP1Id, p.origP2Id, p.offLineId, p.offP1Id, p.offP2Id].forEach(i => ids.add(i));
			} else if (p.kind === 'circle') {
				[p.origId, p.origCenterId, p.offId, p.offCenterId].forEach(i => ids.add(i));
			} else if (p.kind === 'spline') {
				ids.add(p.origSplineId);
				ids.add(p.offSplineId);
				p.points.forEach(sp => ids.add(sp.pointId));
			}
		}
		super(id, 'offset', 'Offset', Array.from(ids), weight, false, true, Math.abs(targetDistance));
		this.pairs = pairs.map(p => {
			if (p.kind === 'spline') {
				return {
					...p,
					points: p.points.map(sp => ({ ...sp, side: sp.side >= 0 ? 1 : -1 })),
				};
			}
			return { ...p, side: p.side >= 0 ? 1 : -1 };
		});
		this.targetDistance = Math.abs(targetDistance);
		this.dimPairIndex = Math.max(0, Math.min(dimPairIndex, pairs.length - 1));
		this.sourceChain = sourceChain;
		this.direction = direction;
		this.flip = flip;
		this.cornerPointIds = cornerPointIds;
	}

	override getEquationsCount(): number {
		let n = 0;
		for (const p of this.pairs) {
			if (p.kind === 'line') n += 2;
			else if (p.kind === 'circle') n += 3;
			else if (p.kind === 'spline') n += 2 * p.points.length;
		}
		return n;
	}

	private lineResidual(pm: Map<string, number>, p: OffsetLinePair, ptId: string): number {
		const point = readParamPoint(pm, ptId);
		const p1 = readParamPoint(pm, p.origP1Id);
		const p2 = readParamPoint(pm, p.origP2Id);
		const dir = new Vec2().subVectors(p2, p1);
		const len = Math.max(dir.length(), 1e-9);
		const hLeft = dir.cross(new Vec2().subVectors(point, p1)) / len;
		return (hLeft - p.side * this.targetDistance) * this.weight;
	}

	override evaluate(pm: Map<string, number>): number[] {
		const res: number[] = [];
		for (const p of this.pairs) {
			if (p.kind === 'line') {
				res.push(this.lineResidual(pm, p, p.offP1Id));
				res.push(this.lineResidual(pm, p, p.offP2Id));
			} else if (p.kind === 'circle') {
				const o = readParamPoint(pm, p.origCenterId);
				const f = readParamPoint(pm, p.offCenterId);
				const ro = pm.get(`${p.origId}.r`) ?? 0;
				const rf = pm.get(`${p.offId}.r`) ?? 0;
				res.push((f.x - o.x) * this.weight);
				res.push((f.y - o.y) * this.weight);
				res.push((rf - ro - p.side * this.targetDistance) * this.weight);
			} else if (p.kind === 'spline') {
				for (const sp of p.points) {
					const point = readParamPoint(pm, sp.pointId);
					const target = Vec2.from(sp.basePos).addScaledVector(sp.normal, sp.side * this.targetDistance);
					res.push((point.x - target.x) * this.weight);
					res.push((point.y - target.y) * this.weight);
				}
			}
		}
		return res;
	}

	override jacobian(paramIndices: Map<string, number>, baseRow: number, pm: Map<string, number>): JacobianEntry[] {
		const res: JacobianEntry[] = [];
		let row = baseRow;
		const eps = 1e-6;
		for (const p of this.pairs) {
			if (p.kind === 'line') {
				for (const ptId of [p.offP1Id, p.offP2Id]) {
					const f0 = this.lineResidual(pm, p, ptId);
					// Differentiate ONLY with respect to offset geometry parameters so that
					// OffsetConstraint drives the offset children without pushing/distorting the master parent geometry.
					const params = [`${ptId}.x`, `${ptId}.y`];
					for (const pid of params) {
						if (!paramIndices.has(pid)) continue;
						const orig = pm.get(pid);
						if (orig === undefined) continue;
						pm.set(pid, orig + eps);
						const f1 = this.lineResidual(pm, p, ptId);
						pm.set(pid, orig);
						this.addJacobianEntry(res, paramIndices, pid, row, (f1 - f0) / eps);
					}
					row++;
				}
			} else if (p.kind === 'circle') {
				const w = this.weight;
				this.addJacobianEntry(res, paramIndices, `${p.offCenterId}.x`, row, w);
				row++;
				this.addJacobianEntry(res, paramIndices, `${p.offCenterId}.y`, row, w);
				row++;
				this.addJacobianEntry(res, paramIndices, `${p.offId}.r`, row, w);
				row++;
			} else if (p.kind === 'spline') {
				const w = this.weight;
				for (const sp of p.points) {
					this.addJacobianEntry(res, paramIndices, `${sp.pointId}.x`, row, w);
					row++;
					this.addJacobianEntry(res, paramIndices, `${sp.pointId}.y`, row, w);
					row++;
				}
			}
		}
		return res;
	}

	moveLabelTo(screen: Vec2, _sketch: SketchDocument, viewport: Viewport): void {
		this.labelWorld = viewport.screenToWorld(screen);
	}

	/** Closest point on a finite curve, including arc endpoints outside its sweep. */
	private closestPoint(curve: QueryCurve, world: Vec2): Vec2 | null {
		if (curve.type === 'segment') return projectPointOntoSegment(world, curve.p1, curve.p2).point;
		if (curve.type === 'arc' || curve.type === 'circle') {
			const center = Vec2.from(curve.center);
			let angle = center.angleToPoint(world);
			if (curve.type === 'arc') {
				const start = center.angleToPoint(curve.start);
				const end = center.angleToPoint(curve.end);
				const sign = curve.clockwise ? -1 : 1;
				const positive = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
				if (positive(sign * (angle - start)) > positive(sign * (end - start))) {
					return Vec2.from(world.distanceTo(curve.start) <= world.distanceTo(curve.end) ? curve.start : curve.end);
				}
			}
			return center.add(Vec2.fromPolar(curve.radius, angle));
		}
		const match = getQueryKernel().closest([curve], world, Number.MAX_VALUE, true, 0);
		return match?.point ? Vec2.from(match.point) : null;
	}

	/** Restrict the normal to the span shared by both finite sides of a corner. */
	private lineDimensionPoints(
		original: Extract<QueryCurve, { type: 'segment' }>,
		offset: Extract<QueryCurve, { type: 'segment' }>,
		world: Vec2
	): { a: Vec2; b: Vec2 } | null {
		const tangent = Vec2.from(original.p2).sub(original.p1);
		const length = tangent.length();
		if (length < 1e-9) return null;
		tangent.divideScalar(length);
		const along = (p: XY) => Vec2.from(p).sub(original.p1).dot(tangent);
		const offStart = along(offset.p1);
		const offEnd = along(offset.p2);
		const start = Math.max(0, Math.min(offStart, offEnd));
		const end = Math.min(length, Math.max(offStart, offEnd));
		if (start > end + 1e-9) return null;
		const a = Vec2.from(original.p1).addScaledVector(tangent, Math.max(start, Math.min(end, along(world))));
		const b = projectPointOntoLine(a, offset.p1, offset.p2).point;
		return { a, b };
	}

	private nearestDimensionPoints(sketch: SketchDocument): { a: Vec2; b: Vec2 } | null {
		if (!this.labelWorld) return null;
		const world = Vec2.from(this.labelWorld);
		let best: { a: Vec2; b: Vec2 } | null = null;
		let distance = Infinity;
		let lineDistance = Infinity;
		for (const pair of this.pairs) {
			const origId = pair.kind === 'line' ? pair.origLineId : pair.kind === 'circle' ? pair.origId : pair.origSplineId;
			const offId = pair.kind === 'line' ? pair.offLineId : pair.kind === 'circle' ? pair.offId : pair.offSplineId;
			const original = sketch.getPrimitive(origId)?.toGeoCurve(sketch);
			const offset = sketch.getPrimitive(offId)?.toGeoCurve(sketch);
			if (!original || !offset) continue;
			let points: { a: Vec2; b: Vec2 } | null;
			if (original.type === 'segment' && offset.type === 'segment') {
				points = this.lineDimensionPoints(original, offset, world);
			} else {
				const b = this.closestPoint(offset, world);
				const a = b && this.closestPoint(original, b);
				points = a && b ? { a, b } : null;
			}
			if (!points) continue;
			const { a, b } = points;
			const d = projectPointOntoSegment(world, a, b).dist;
			const ld = projectPointOntoLine(world, a, b).dist;
			if (d < distance - 1e-9 || (Math.abs(d - distance) <= 1e-9 && ld < lineDistance)) {
				distance = d;
				lineDistance = ld;
				best = points;
			}
		}
		return best;
	}

	/** World-space endpoints of the visual dimension (on original and on offset curve) */
	getDimensionWorldPoints(sketch: any): { a: Vec2; b: Vec2 } | null {
		const nearest = this.nearestDimensionPoints(sketch);
		if (nearest) return nearest;
		const p = this.pairs[this.dimPairIndex] ?? this.pairs[0];
		if (!p) {
			if (!this.emptyDimension) return null;
			const a = Vec2.from(this.emptyDimension.anchor);
			return { a, b: a.clone().addScaledVector(this.emptyDimension.normal, this.targetDistance) };
		}
		if (p.kind === 'line') {
			const o1 = sketch.points.get(p.origP1Id);
			const o2 = sketch.points.get(p.origP2Id);
			const f1 = sketch.points.get(p.offP1Id);
			const f2 = sketch.points.get(p.offP2Id);
			if (!o1 || !o2 || !f1 || !f2) return null;
			const fm = new Vec2().midpoint(f1, f2);
			const dir = new Vec2().subVectors(o2, o1);
			const l2 = dir.lengthSq();
			if (l2 < 1e-12) return null;
			const t = new Vec2().subVectors(fm, o1).dot(dir) / l2;
			return { a: Vec2.from(o1).addScaledVector(dir, t), b: fm };
		}
		if (p.kind === 'spline') {
			const midSp = p.points[Math.floor(p.points.length / 2)];
			if (!midSp) return null;
			const pt = sketch.points.get(midSp.pointId);
			if (!pt) return null;
			return {
				a: Vec2.from(midSp.basePos),
				b: new Vec2(pt.x, pt.y),
			};
		}
		const orig = sketch.circles.get(p.origId) ?? sketch.arcs.get(p.origId);
		const off = sketch.circles.get(p.offId) ?? sketch.arcs.get(p.offId);
		if (!orig || !off) return null;
		const c = sketch.points.get(p.origCenterId);
		const cOff = sketch.points.get(p.offCenterId);
		if (!c || !cOff) return null;
		let ang = Math.PI / 4;
		if (sketch.arcs.has(p.offId)) {
			const s = sketch.points.get(off.startPointId);
			const e = sketch.points.get(off.endPointId);
			if (s && e) {
				const as = Vec2.from(cOff).angleToPoint(s);
				const ae = Vec2.from(cOff).angleToPoint(e);
				let sweep = off.clockwise ? as - ae : ae - as;
				while (sweep < 0) sweep += 2 * Math.PI;
				ang = off.clockwise ? as - sweep / 2 : as + sweep / 2;
			}
		}
		const u = Vec2.fromPolar(1, ang);
		return {
			a: Vec2.from(c).addScaledVector(u, orig.radius),
			b: Vec2.from(cOff).addScaledVector(u, off.radius),
		};
	}

	getLabelScreenPos(sketch: any, viewport: any): Vec2 | null {
		const pts = this.getDimensionWorldPoints(sketch);
		if (!pts) return null;
		const d1 = viewport.worldToScreen(pts.a);
		const d2 = viewport.worldToScreen(pts.b);
		const angle = this.labelAngle(d1, d2);
		return d1
			.clone()
			.lerp(d2, this.labelPosition(d1, d2, viewport))
			.add(new Vec2(Math.sin(angle) * 8.5, -Math.cos(angle) * 8.5));
	}

	private labelPosition(d1: Vec2, d2: Vec2, viewport: Viewport): number {
		if (!this.labelWorld) return 0.5;
		const delta = new Vec2().subVectors(d2, d1);
		if (delta.lengthSq() < 1e-12) return 0.5;
		return viewport.worldToScreen(this.labelWorld).sub(d1).dot(delta) / delta.lengthSq();
	}

	private labelAngle(d1: Vec2, d2: Vec2): number {
		let angle = Math.atan2(d2.y - d1.y, d2.x - d1.x);
		if (angle > Math.PI / 2 - 1e-4) angle -= Math.PI;
		else if (angle <= -Math.PI / 2) angle += Math.PI;
		return angle;
	}

	private renderLabelHitArea(parent: SVGElement, center: Vec2, angle: number): void {
		const text = (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance);
		const halfWidth = Math.max(12, text.length * 3.75 + 6);
		createSvgElement(
			'polygon',
			{
				class: 'dimension-item',
				points: `${-halfWidth},-10 ${halfWidth},-10 ${halfWidth},10 ${-halfWidth},10`,
				fill: 'transparent',
				'pointer-events': 'all',
				'data-id': this.id,
				'data-type': 'constraint',
				transform: `translate(${center.x}, ${center.y}) rotate(${(angle * 180) / Math.PI})`,
			},
			parent
		);
	}

	override render(ctx: ConstraintRenderContext): void {
		const pts = this.getDimensionWorldPoints(ctx.sketch);
		if (!pts) return;
		const d1 = ctx.viewport.worldToScreen(pts.a);
		const d2 = ctx.viewport.worldToScreen(pts.b);
		if (d1.distanceTo(d2) < 1e-3) return;
		ctx.renderLinearDimensionVisual({
			d1,
			d2,
			label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
			extensionLines: [],
			parent: ctx.targetGroup,
			isSelected: ctx.isSelected,
			constraintId: this.id,
			labelPosition: this.labelPosition(d1, d2, ctx.viewport),
		});
		this.renderLabelHitArea(
			ctx.targetGroup,
			this.getLabelScreenPos(ctx.sketch, ctx.viewport)!,
			this.labelAngle(d1, d2)
		);
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pts = this.getDimensionWorldPoints(sketch);
		if (!pts) return null;
		const d1 = viewport.worldToScreen(pts.a);
		const d2 = viewport.worldToScreen(pts.b);
		const center = this.getLabelScreenPos(sketch, viewport)!;
		const local = Vec2.from(screen).sub(center).rotateAround(new Vec2(), -this.labelAngle(d1, d2));
		const text = (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance);
		const halfWidth = Math.max(12, text.length * 3.75 + 6);
		const textDistance = Math.hypot(Math.max(0, Math.abs(local.x) - halfWidth), Math.max(0, Math.abs(local.y) - 10));
		const distance = Math.min(
			textDistance,
			distanceToLinearDimensionVisual(screen, d1, d2, this.labelPosition(d1, d2, viewport))
		);
		return distance;
	}

	/** Ids of all curves (original + offset) referenced by this constraint */
	getCurveIds(): Array<{ id: string; kind: 'line' | 'circle' | 'spline' }> {
		const res: Array<{ id: string; kind: 'line' | 'circle' | 'spline' }> = [];
		for (const p of this.pairs) {
			if (p.kind === 'line') {
				res.push({ id: p.origLineId, kind: 'line' }, { id: p.offLineId, kind: 'line' });
			} else if (p.kind === 'circle') {
				res.push({ id: p.origId, kind: 'circle' }, { id: p.offId, kind: 'circle' });
			} else if (p.kind === 'spline') {
				res.push({ id: p.origSplineId, kind: 'spline' }, { id: p.offSplineId, kind: 'spline' });
			}
		}
		return res;
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: 'Offset Distance',
			dimension: {
				label: 'Distance',
				getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
			},
		});
	}
}

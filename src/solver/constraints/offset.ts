import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { formatDimensionValue } from '../../canvas/dimensionGeometry';
import { distanceToLinearDimension } from '../../math/hitTest';
import { angleFromTo, cross, dot, vec, addScaled, mid, sub, type Vec2 } from '../../math/vector';

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
	basePos: Vec2;
	normal: Vec2;
	side: number;
}

export interface OffsetSplinePair {
	kind: 'spline';
	origSplineId: string;
	offSplineId: string;
	points: OffsetSplinePoint[];
}

export type OffsetPair = OffsetLinePair | OffsetCirclePair | OffsetSplinePair;

/**
 * Dimensional offset constraint: ties a chain of offset lines / arcs / circles / splines to their
 * originals with one shared offset distance.
 */
export class OffsetConstraint extends BaseConstraint {
	targetDistance: number;
	pairs: OffsetPair[];
	/** Index of the pair used to place the visual dimension */
	dimPairIndex: number;
	sourceChain?: any;
	direction?: any;
	flip?: boolean;
	cornerPointIds?: string[];

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
		const dir = sub(p2, p1);
		const len = Math.max(Math.hypot(dir.x, dir.y), 1e-9);
		const hLeft = cross(dir, sub(point, p1)) / len;
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
					const target = vec(
						sp.basePos.x + sp.side * this.targetDistance * sp.normal.x,
						sp.basePos.y + sp.side * this.targetDistance * sp.normal.y
					);
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

	/** World-space endpoints of the visual dimension (on original and on offset curve) */
	getDimensionWorldPoints(sketch: any): { a: Vec2; b: Vec2 } | null {
		const p = this.pairs[this.dimPairIndex] ?? this.pairs[0];
		if (!p) return null;
		if (p.kind === 'line') {
			const o1 = sketch.points.get(p.origP1Id);
			const o2 = sketch.points.get(p.origP2Id);
			const f1 = sketch.points.get(p.offP1Id);
			const f2 = sketch.points.get(p.offP2Id);
			if (!o1 || !o2 || !f1 || !f2) return null;
			const fm = mid(f1, f2);
			const dir = sub(o2, o1);
			const l2 = dot(dir, dir);
			if (l2 < 1e-12) return null;
			const t = dot(sub(fm, o1), dir) / l2;
			return { a: addScaled(o1, dir, t), b: fm };
		}
		if (p.kind === 'spline') {
			const midSp = p.points[Math.floor(p.points.length / 2)];
			if (!midSp) return null;
			const pt = sketch.points.get(midSp.pointId);
			if (!pt) return null;
			return {
				a: midSp.basePos,
				b: { x: pt.x, y: pt.y },
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
				const as = angleFromTo(cOff, s);
				const ae = angleFromTo(cOff, e);
				let sweep = off.clockwise ? as - ae : ae - as;
				while (sweep < 0) sweep += 2 * Math.PI;
				ang = off.clockwise ? as - sweep / 2 : as + sweep / 2;
			}
		}
		const u = { x: Math.cos(ang), y: Math.sin(ang) };
		return {
			a: addScaled(c, u, orig.radius),
			b: addScaled(cOff, u, off.radius),
		};
	}

	override render(ctx: ConstraintRenderContext): void {
		const pts = this.getDimensionWorldPoints(ctx.sketch);
		if (!pts) return;
		const d1 = ctx.viewport.worldToScreen(pts.a);
		const d2 = ctx.viewport.worldToScreen(pts.b);
		if (Math.hypot(d2.x - d1.x, d2.y - d1.y) < 1e-3) return;
		ctx.renderLinearDimensionVisual({
			d1,
			d2,
			label: (this.expression ? 'fx: ' : '') + formatDimensionValue(this.targetDistance),
			extensionLines: [],
			parent: ctx.targetGroup,
			isSelected: ctx.isSelected,
			constraintId: this.id,
		});
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const pts = this.getDimensionWorldPoints(sketch);
		if (!pts) return null;
		const d1 = viewport.worldToScreen(pts.a);
		const d2 = viewport.worldToScreen(pts.b);
		return distanceToLinearDimension(screen, d1, d2);
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

	override readonly sidebarPanel: ConstraintPanel = new ConstraintPanel({
		constraint: this,
		title: 'Offset Distance',
		dimension: {
			label: 'Distance',
			getValue: () => `${Number(this.targetDistance.toFixed(2))} mm`,
		},
	});
}

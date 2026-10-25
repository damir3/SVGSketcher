import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { PatternPointPair, PatternRadiusPair } from './circularPattern';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

export interface RectangularPatternCopyData {
	copyIndex: number;
	i: number;
	j: number;
	pointPairs: PatternPointPair[];
	radiusPairs?: PatternRadiusPair[];
	createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}>;
}

export function computeAxisOffset(
	index: number,
	distance: number,
	direction: 'one_direction' | 'symmetric'
): number {
	if (index === 0) return 0;
	if (direction === 'one_direction') {
		return index * distance;
	} else {
		if (index % 2 === 1) {
			return Math.ceil(index / 2) * distance;
		} else {
			return -(index / 2) * distance;
		}
	}
}

export function computeRectangularPatternOffset(
	i: number,
	j: number,
	distance1: number,
	direction1: 'one_direction' | 'symmetric',
	distance2: number,
	direction2: 'one_direction' | 'symmetric',
	u1: { x: number; y: number },
	u2: { x: number; y: number }
): { dx: number; dy: number } {
	const o1 = computeAxisOffset(i, distance1, direction1);
	const o2 = computeAxisOffset(j, distance2, direction2);
	return {
		dx: o1 * u1.x + o2 * u2.x,
		dy: o1 * u1.y + o2 * u2.y,
	};
}

export function computeRectangularPatternDirections(
	paramMap: Map<string, number>,
	line1?: { p1Id: string; p2Id: string } | null,
	line2?: { p1Id: string; p2Id: string } | null
): { u1: { x: number; y: number }; u2: { x: number; y: number } } {
	let u1 = { x: 1, y: 0 };
	if (line1) {
		const x1a = paramMap.get(`${line1.p1Id}.x`) ?? 0;
		const y1a = paramMap.get(`${line1.p1Id}.y`) ?? 0;
		const x1b = paramMap.get(`${line1.p2Id}.x`) ?? 0;
		const y1b = paramMap.get(`${line1.p2Id}.y`) ?? 0;
		const dx1 = x1b - x1a;
		const dy1 = y1b - y1a;
		const len1 = Math.hypot(dx1, dy1);
		if (len1 > 1e-6) {
			u1 = { x: dx1 / len1, y: dy1 / len1 };
		}
	}

	let u2 = { x: -u1.y, y: u1.x };
	if (line2) {
		const x2a = paramMap.get(`${line2.p1Id}.x`) ?? 0;
		const y2a = paramMap.get(`${line2.p1Id}.y`) ?? 0;
		const x2b = paramMap.get(`${line2.p2Id}.x`) ?? 0;
		const y2b = paramMap.get(`${line2.p2Id}.y`) ?? 0;
		const dx2 = x2b - x2a;
		const dy2 = y2b - y2a;
		const len2 = Math.hypot(dx2, dy2);
		if (len2 > 1e-6) {
			u2 = { x: dx2 / len2, y: dy2 / len2 };
		}
	}

	return { u1, u2 };
}

/**
 * Constrains patterned entities in a 2D linear array along 1 or 2 direction axes.
 * Holds all pattern copies and point correspondences in a single constraint.
 */
export class RectangularPatternConstraint extends BaseConstraint {
	readonly sourceObjectIds: string[];
	line1Id: string | null;
	line1P1Id?: string | null;
	line1P2Id?: string | null;
	line2Id: string | null;
	line2P1Id?: string | null;
	line2P2Id?: string | null;
	quantity1: number;
	distance1: number;
	direction1: 'one_direction' | 'symmetric';
	quantity2: number;
	distance2: number;
	direction2: 'one_direction' | 'symmetric';
	suppression: boolean;
	suppressedIndices: number[];
	copies: RectangularPatternCopyData[];

	constructor(
		id: string,
		sourceObjectIds: string[],
		line1Id: string | null,
		line1P1Id: string | null | undefined,
		line1P2Id: string | null | undefined,
		line2Id: string | null,
		line2P1Id: string | null | undefined,
		line2P2Id: string | null | undefined,
		quantity1: number,
		distance1: number,
		direction1: 'one_direction' | 'symmetric',
		quantity2: number,
		distance2: number,
		direction2: 'one_direction' | 'symmetric',
		suppression: boolean,
		suppressedIndices: number[],
		copies: RectangularPatternCopyData[],
		weight = 1.0
	) {
		const entityIdSet = new Set<string>();
		if (line1P1Id) entityIdSet.add(line1P1Id);
		if (line1P2Id) entityIdSet.add(line1P2Id);
		if (line2P1Id) entityIdSet.add(line2P1Id);
		if (line2P2Id) entityIdSet.add(line2P2Id);

		for (const copy of copies) {
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

		super(id, 'rectangular_pattern', 'Rectangular Pattern', Array.from(entityIdSet), weight);

		this.sourceObjectIds = [...sourceObjectIds];
		this.line1Id = line1Id;
		this.line1P1Id = line1P1Id;
		this.line1P2Id = line1P2Id;
		this.line2Id = line2Id;
		this.line2P1Id = line2P1Id;
		this.line2P2Id = line2P2Id;
		this.quantity1 = quantity1;
		this.distance1 = distance1;
		this.direction1 = direction1;
		this.quantity2 = quantity2;
		this.distance2 = distance2;
		this.direction2 = direction2;
		this.suppression = suppression;
		this.suppressedIndices = [...suppressedIndices];
		this.copies = copies;
	}

	override getEquationsCount(): number {
		let count = 0;
		const suppressedSet = new Set(this.suppressedIndices);
		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;
			count += copy.pointPairs.length * 2;
			if (copy.radiusPairs) {
				count += copy.radiusPairs.length;
			}
		}
		return count;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const errors: number[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const offset = computeRectangularPatternOffset(
				copy.i,
				copy.j,
				this.distance1,
				this.direction1,
				this.distance2,
				this.direction2,
				u1,
				u2
			);

			for (const pair of copy.pointPairs) {
				const sx = paramMap.get(`${pair.sourcePtId}.x`) ?? 0;
				const sy = paramMap.get(`${pair.sourcePtId}.y`) ?? 0;
				const px = paramMap.get(`${pair.patternPtId}.x`) ?? 0;
				const py = paramMap.get(`${pair.patternPtId}.y`) ?? 0;

				const targetX = sx + offset.dx;
				const targetY = sy + offset.dy;

				errors.push((px - targetX) * this.weight);
				errors.push((py - targetY) * this.weight);
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const rSource = paramMap.get(`${pair.sourceCircleId}.r`) ?? 0;
					const rPattern = paramMap.get(`${pair.patternCircleId}.r`) ?? 0;
					errors.push((rPattern - rSource) * this.weight);
				}
			}
		}

		return errors;
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const entries: JacobianEntry[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);

		let du1_dx1b = 0, du1_dy1b = 0, du1_dx1b_y = 0, du1_dy1b_y = 0;
		let hasL1 = false;
		if (line1) {
			const x1a = paramMap.get(`${line1.p1Id}.x`) ?? 0;
			const y1a = paramMap.get(`${line1.p1Id}.y`) ?? 0;
			const x1b = paramMap.get(`${line1.p2Id}.x`) ?? 0;
			const y1b = paramMap.get(`${line1.p2Id}.y`) ?? 0;
			const dx1 = x1b - x1a;
			const dy1 = y1b - y1a;
			const L1 = Math.hypot(dx1, dy1);
			if (L1 > 1e-6) {
				hasL1 = true;
				const invL = 1 / L1;
				du1_dx1b = (1 - u1.x * u1.x) * invL;
				du1_dy1b = (-u1.x * u1.y) * invL;
				du1_dx1b_y = (-u1.x * u1.y) * invL;
				du1_dy1b_y = (1 - u1.y * u1.y) * invL;
			}
		}

		let du2_dx2b = 0, du2_dy2b = 0, du2_dx2b_y = 0, du2_dy2b_y = 0;
		let hasL2 = false;
		if (line2) {
			const x2a = paramMap.get(`${line2.p1Id}.x`) ?? 0;
			const y2a = paramMap.get(`${line2.p1Id}.y`) ?? 0;
			const x2b = paramMap.get(`${line2.p2Id}.x`) ?? 0;
			const y2b = paramMap.get(`${line2.p2Id}.y`) ?? 0;
			const dx2 = x2b - x2a;
			const dy2 = y2b - y2a;
			const L2 = Math.hypot(dx2, dy2);
			if (L2 > 1e-6) {
				hasL2 = true;
				const invL = 1 / L2;
				du2_dx2b = (1 - u2.x * u2.x) * invL;
				du2_dy2b = (-u2.x * u2.y) * invL;
				du2_dx2b_y = (-u2.x * u2.y) * invL;
				du2_dy2b_y = (1 - u2.y * u2.y) * invL;
			}
		}

		let eqIdx = 0;

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const o1 = computeAxisOffset(copy.i, this.distance1, this.direction1);
			const o2 = computeAxisOffset(copy.j, this.distance2, this.direction2);

			for (const pair of copy.pointPairs) {
				const rowX = baseRow + eqIdx;
				const rowY = baseRow + eqIdx + 1;
				eqIdx += 2;

				const colPx = paramIndices.get(`${pair.patternPtId}.x`);
				const colPy = paramIndices.get(`${pair.patternPtId}.y`);
				const colSx = paramIndices.get(`${pair.sourcePtId}.x`);
				const colSy = paramIndices.get(`${pair.sourcePtId}.y`);

				if (colPx !== undefined) entries.push({ row: rowX, col: colPx, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowX, col: colSx, val: -this.weight });
				if (colPy !== undefined) entries.push({ row: rowY, col: colPy, val: this.weight });
				if (colSy !== undefined) entries.push({ row: rowY, col: colSy, val: -this.weight });

				if (hasL1 && line1) {
					const dDeltaX_dx1b = o1 * du1_dx1b + (!hasL2 ? o2 * (-du1_dx1b_y) : 0);
					const dDeltaX_dy1b = o1 * du1_dy1b + (!hasL2 ? o2 * (-du1_dy1b_y) : 0);
					const dDeltaY_dx1b = o1 * du1_dx1b_y + (!hasL2 ? o2 * du1_dx1b : 0);
					const dDeltaY_dy1b = o1 * du1_dy1b_y + (!hasL2 ? o2 * du1_dy1b : 0);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowX, -dDeltaX_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowX, -dDeltaX_dy1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowX, dDeltaX_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowX, dDeltaX_dy1b * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowY, -dDeltaY_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowY, -dDeltaY_dy1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowY, dDeltaY_dx1b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowY, dDeltaY_dy1b * this.weight);
				}

				if (hasL2 && line2) {
					const dDeltaX_dx2b = o2 * du2_dx2b;
					const dDeltaX_dy2b = o2 * du2_dy2b;
					const dDeltaY_dx2b = o2 * du2_dx2b_y;
					const dDeltaY_dy2b = o2 * du2_dy2b_y;

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowX, -dDeltaX_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowX, -dDeltaX_dy2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowX, dDeltaX_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowX, dDeltaX_dy2b * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowY, -dDeltaY_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowY, -dDeltaY_dy2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowY, dDeltaY_dx2b * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowY, dDeltaY_dy2b * this.weight);
				}
			}

			if (copy.radiusPairs) {
				for (const pair of copy.radiusPairs) {
					const row = baseRow + eqIdx;
					eqIdx += 1;
					this.addJacobianEntry(entries, paramIndices, `${pair.patternCircleId}.r`, row, this.weight);
					this.addJacobianEntry(entries, paramIndices, `${pair.sourceCircleId}.r`, row, -this.weight);
				}
			}
		}

		return entries;
	}

	override render(ctx: ConstraintRenderContext): void {
		let sumX = 0, sumY = 0, ptCount = 0;
		for (const objId of this.sourceObjectIds) {
			const pt = ctx.sketch.points.get(objId);
			if (pt) { sumX += pt.x; sumY += pt.y; ptCount++; continue; }
			const l = ctx.sketch.lines.get(objId);
			if (l) {
				const p1 = ctx.sketch.points.get(l.p1Id);
				const p2 = ctx.sketch.points.get(l.p2Id);
				if (p1) { sumX += p1.x; sumY += p1.y; ptCount++; }
				if (p2) { sumX += p2.x; sumY += p2.y; ptCount++; }
				continue;
			}
			const c = ctx.sketch.circles.get(objId);
			if (c) {
				const cp = ctx.sketch.points.get(c.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const a = ctx.sketch.arcs.get(objId);
			if (a) {
				const cp = ctx.sketch.points.get(a.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const el = ctx.sketch.ellipses.get(objId);
			if (el) {
				const cp = ctx.sketch.points.get(el.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
			const ea = ctx.sketch.ellipticalArcs.get(objId);
			if (ea) {
				const cp = ctx.sketch.points.get(ea.centerId);
				if (cp) { sumX += cp.x; sumY += cp.y; ptCount++; }
				continue;
			}
		}

		if (ptCount === 0) return;
		const centroidWorld = { x: sumX / ptCount, y: sumY / ptCount };
		const sCtr = ctx.viewport.worldToScreen(centroidWorld.x, centroidWorld.y);

		const paramMap = new Map<string, number>();
		for (const [pid, pt] of ctx.sketch.points.entries()) {
			paramMap.set(`${pid}.x`, pt.x);
			paramMap.set(`${pid}.y`, pt.y);
		}
		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);
		const isConstraintActive = ctx.isConstraintOnlySelected ? ctx.isConstraintOnlySelected(this.id) : false;

		if (isConstraintActive) {
			if (ctx.renderRectangularPatternGizmos) {
				ctx.renderRectangularPatternGizmos(ctx.viewport, centroidWorld, u1, u2, this.distance1, this.distance2, {
					targetGroup: ctx.targetGroup,
					constraintId: this.id,
				});
			}

			if (this.suppression) {
				const suppressedSet = new Set(this.suppressedIndices);
				const isFullyConstrained = ctx.sketch.lastSolverResult?.status === 'CONVERGED';
				const hasConflict = ctx.sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
				const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

				const maxI = Math.abs(this.distance1) > 1e-6 ? this.quantity1 : 1;
				const maxJ = Math.abs(this.distance2) > 1e-6 ? this.quantity2 : 1;

				for (let i = 0; i < maxI; i++) {
					for (let j = 0; j < maxJ; j++) {
						if (i === 0 && j === 0) continue;
						const copyIndex = i * 1000 + j;
						const isSuppressed = suppressedSet.has(copyIndex);
						const offset = computeRectangularPatternOffset(i, j, this.distance1, this.direction1, this.distance2, this.direction2, u1, u2);

						let centroid: { x: number; y: number };
						const copy = this.copies.find(cp => cp.copyIndex === copyIndex);

						if (copy && copy.pointPairs.length > 0 && !isSuppressed) {
							let cSumX = 0, cSumY = 0, cCount = 0;
							for (const pair of copy.pointPairs) {
								const pt = ctx.sketch.points.get(pair.patternPtId);
								if (pt) {
									cSumX += pt.x;
									cSumY += pt.y;
									cCount++;
								}
							}
							centroid = cCount > 0
								? ctx.viewport.worldToScreen(cSumX / cCount, cSumY / cCount)
								: ctx.viewport.worldToScreen(centroidWorld.x + offset.dx, centroidWorld.y + offset.dy);
						} else if (ctx.renderTransformedObjects) {
							const copyWorldPoints = ctx.renderTransformedObjects(
								this.sourceObjectIds,
								offset,
								{
									targetGroup: ctx.targetGroup,
									baseColor,
									opacity: 0.25,
									drawVertices: true,
									skipRender: !isSuppressed,
								}
							);
							if (copyWorldPoints.length > 0) {
								let cSumX = 0, cSumY = 0;
								for (const p of copyWorldPoints) {
									cSumX += p.x;
									cSumY += p.y;
								}
								centroid = ctx.viewport.worldToScreen(cSumX / copyWorldPoints.length, cSumY / copyWorldPoints.length);
							} else {
								centroid = ctx.viewport.worldToScreen(centroidWorld.x + offset.dx, centroidWorld.y + offset.dy);
							}
						} else {
							centroid = ctx.viewport.worldToScreen(centroidWorld.x + offset.dx, centroidWorld.y + offset.dy);
						}

						if (ctx.patternCheckboxPositions) {
							ctx.patternCheckboxPositions.set(`c-${this.id}-${copyIndex}`, {
								x: centroid.x,
								y: centroid.y,
								copyIndex,
								constraintId: this.id,
							});
						}

						if (ctx.renderPatternSuppressionCheckbox) {
							ctx.renderPatternSuppressionCheckbox(centroid, copyIndex, isSuppressed, this.id);
						}
					}
				}
			}
		}

		ctx.renderBadge(this.id, sCtr.x + 14, sCtr.y - 14, 'rectangular_pattern', COLORS.primary);
	}
}

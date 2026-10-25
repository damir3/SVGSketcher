import type { JacobianEntry } from '../types';
import { BaseConstraint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';

export interface PatternPointPair {
	sourcePtId: string;
	patternPtId: string;
}

export interface PatternRadiusPair {
	sourceCircleId: string;
	patternCircleId: string;
}

export interface PatternCopyData {
	copyIndex: number;
	pointPairs: PatternPointPair[];
	radiusPairs?: PatternRadiusPair[];
	createdEntityIds: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc';
	}>;
}

export function computePatternCopyAngle(
	k: number,
	quantity: number,
	distribution: 'full' | 'partial' | 'symmetric',
	totalAngle: number
): number {
	const N = Math.max(2, Math.round(quantity));
	if (distribution === 'full') {
		return (k * 360) / N;
	} else if (distribution === 'partial') {
		const step = totalAngle / (N - 1);
		return k * step;
	} else if (distribution === 'symmetric') {
		const step = totalAngle / (N - 1);
		if (k % 2 === 1) {
			return ((k + 1) / 2) * step;
		} else {
			return -(k / 2) * step;
		}
	}
	return 0;
}

/**
 * Constrains patterned entities around a rotation center point.
 * Holds all pattern copies and point correspondences in a single constraint.
 */
export class CircularPatternConstraint extends BaseConstraint {
	readonly centerPtId: string;
	readonly sourceObjectIds: string[];
	distribution: 'full' | 'partial' | 'symmetric';
	totalAngle: number;
	quantity: number;
	suppression: boolean;
	suppressedIndices: number[];
	copies: PatternCopyData[];
	isReadOnly?: boolean;

	constructor(
		id: string,
		centerPtId: string,
		sourceObjectIds: string[],
		distribution: 'full' | 'partial' | 'symmetric',
		totalAngle: number,
		quantity: number,
		suppression: boolean,
		suppressedIndices: number[],
		copies: PatternCopyData[],
		weight = 1.0,
		isReadOnly = false
	) {
		const entityIdSet = new Set<string>();
		entityIdSet.add(centerPtId);
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
		super(id, 'circular_pattern', 'Circular Pattern', Array.from(entityIdSet), weight);

		this.centerPtId = centerPtId;
		this.sourceObjectIds = [...sourceObjectIds];
		this.distribution = distribution;
		this.totalAngle = totalAngle;
		this.quantity = quantity;
		this.suppression = suppression;
		this.suppressedIndices = [...suppressedIndices];
		this.copies = copies;
		this.isReadOnly = !!isReadOnly;
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
		const cx = paramMap.get(`${this.centerPtId}.x`) ?? 0;
		const cy = paramMap.get(`${this.centerPtId}.y`) ?? 0;
		const suppressedSet = new Set(this.suppressedIndices);

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const angleDeg = computePatternCopyAngle(
				copy.copyIndex,
				this.quantity,
				this.distribution,
				this.totalAngle
			);
			const rad = (angleDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);

			for (const pair of copy.pointPairs) {
				const sx = paramMap.get(`${pair.sourcePtId}.x`) ?? 0;
				const sy = paramMap.get(`${pair.sourcePtId}.y`) ?? 0;
				const px = paramMap.get(`${pair.patternPtId}.x`) ?? 0;
				const py = paramMap.get(`${pair.patternPtId}.y`) ?? 0;

				const dx = sx - cx;
				const dy = sy - cy;
				const targetX = cx + dx * cosA - dy * sinA;
				const targetY = cy + dx * sinA + dy * cosA;

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
		_paramMap: Map<string, number>
	): JacobianEntry[] {
		const entries: JacobianEntry[] = [];
		const suppressedSet = new Set(this.suppressedIndices);

		let eqIdx = 0;

		for (const copy of this.copies) {
			if (this.suppression && suppressedSet.has(copy.copyIndex)) continue;

			const angleDeg = computePatternCopyAngle(
				copy.copyIndex,
				this.quantity,
				this.distribution,
				this.totalAngle
			);
			const rad = (angleDeg * Math.PI) / 180;
			const cosA = Math.cos(rad);
			const sinA = Math.sin(rad);

			for (const pair of copy.pointPairs) {
				const rowX = baseRow + eqIdx;
				const rowY = baseRow + eqIdx + 1;
				eqIdx += 2;

				const colPx = paramIndices.get(`${pair.patternPtId}.x`);
				const colPy = paramIndices.get(`${pair.patternPtId}.y`);
				const colSx = paramIndices.get(`${pair.sourcePtId}.x`);
				const colSy = paramIndices.get(`${pair.sourcePtId}.y`);
				const colCx = paramIndices.get(`${this.centerPtId}.x`);
				const colCy = paramIndices.get(`${this.centerPtId}.y`);

				// Row X: px - targetX = px - [cx(1 - cosA) + cy*sinA + sx*cosA - sy*sinA]
				if (colPx !== undefined) entries.push({ row: rowX, col: colPx, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowX, col: colSx, val: -cosA * this.weight });
				if (colSy !== undefined) entries.push({ row: rowX, col: colSy, val: sinA * this.weight });
				if (colCx !== undefined) entries.push({ row: rowX, col: colCx, val: -(1 - cosA) * this.weight });
				if (colCy !== undefined) entries.push({ row: rowX, col: colCy, val: -sinA * this.weight });

				// Row Y: py - targetY = py - [-cx*sinA + cy(1 - cosA) + sx*sinA + sy*cosA]
				if (colPy !== undefined) entries.push({ row: rowY, col: colPy, val: this.weight });
				if (colSx !== undefined) entries.push({ row: rowY, col: colSx, val: -sinA * this.weight });
				if (colSy !== undefined) entries.push({ row: rowY, col: colSy, val: -cosA * this.weight });
				if (colCx !== undefined) entries.push({ row: rowY, col: colCx, val: sinA * this.weight });
				if (colCy !== undefined) entries.push({ row: rowY, col: colCy, val: -(1 - cosA) * this.weight });
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
		const pCtr = ctx.sketch.points.get(this.centerPtId);
		if (!pCtr) return;

		const sCtr = ctx.viewport.worldToScreen(pCtr.x, pCtr.y);
		const isConstraintActive = ctx.isConstraintOnlySelected ? ctx.isConstraintOnlySelected(this.id) : false;

		// Render suppression checkboxes and suppressed objects only when constraint itself is selected
		if (this.suppression && isConstraintActive && !this.isReadOnly) {
			const N = this.quantity;
			const suppressedSet = new Set(this.suppressedIndices);
			const isFullyConstrained = ctx.sketch.lastSolverResult?.status === 'CONVERGED';
			const hasConflict = ctx.sketch.lastSolverResult?.status === 'OVER_CONSTRAINED';
			const baseColor = hasConflict ? COLORS.conflict : isFullyConstrained ? COLORS.constrained : COLORS.unconstrained;

			for (let k = 1; k < N; k++) {
				const isSuppressed = suppressedSet.has(k);
				const aDeg = computePatternCopyAngle(k, N, this.distribution, this.totalAngle);
				const rad = (aDeg * Math.PI) / 180;

				let centroid: { x: number; y: number };
				const copy = this.copies.find(cp => cp.copyIndex === k);

				if (copy && copy.pointPairs.length > 0 && !isSuppressed) {
					let sumX = 0, sumY = 0, count = 0;
					for (const pair of copy.pointPairs) {
						const pt = ctx.sketch.points.get(pair.patternPtId);
						if (pt) {
							sumX += pt.x;
							sumY += pt.y;
							count++;
						}
					}
					centroid = count > 0
						? ctx.viewport.worldToScreen(sumX / count, sumY / count)
						: { x: sCtr.x + 40 * Math.cos(rad), y: sCtr.y + 40 * Math.sin(rad) };
				} else if (ctx.renderTransformedObjects) {
					// Copy is suppressed or points not yet populated: render suppressed geometry in same style with opacity=0.25 & compute centroid
					const copyWorldPoints = ctx.renderTransformedObjects(
						this.sourceObjectIds,
						{ center: pCtr, angleDeg: aDeg },
						{
							targetGroup: ctx.targetGroup,
							baseColor,
							opacity: 0.25,
							drawVertices: true,
							skipRender: !isSuppressed,
						}
					);

					if (copyWorldPoints.length > 0) {
						let sumX = 0, sumY = 0;
						for (const p of copyWorldPoints) {
							sumX += p.x;
							sumY += p.y;
						}
						centroid = ctx.viewport.worldToScreen(sumX / copyWorldPoints.length, sumY / copyWorldPoints.length);
					} else {
						centroid = {
							x: sCtr.x + 40 * Math.cos(rad),
							y: sCtr.y + 40 * Math.sin(rad),
						};
					}
				} else {
					centroid = {
						x: sCtr.x + 40 * Math.cos(rad),
						y: sCtr.y + 40 * Math.sin(rad),
					};
				}

				// Register screen position for hit-testing
				if (ctx.patternCheckboxPositions) {
					ctx.patternCheckboxPositions.set(`c-${this.id}-${k}`, {
						x: centroid.x,
						y: centroid.y,
						copyIndex: k,
						constraintId: this.id,
					});
				}

				// Render suppression checkbox over copy
				if (ctx.renderPatternSuppressionCheckbox) {
					ctx.renderPatternSuppressionCheckbox(centroid, k, isSuppressed, this.id);
				}
			}
		}

		ctx.renderBadge(this.id, sCtr.x + 14, sCtr.y - 14, 'circular_pattern', COLORS.primary);
	}
}

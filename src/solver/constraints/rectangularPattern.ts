import { calculateObjectsCentroid } from '../../canvas/tools/modify/utils';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { PatternCopyData, PatternPointPair, PatternRadiusPair } from './circularPattern';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS } from '../../canvas/styles';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { parseNumericOrExpression, getExpressionIfValid } from '../../math/expression';
import { Vec2 } from '../../math/vector';

export interface RectangularPatternCopyData {
	copyIndex: number;
	i: number;
	j: number;
	pointPairs: PatternPointPair[];
	radiusPairs?: PatternRadiusPair[];
	createdEntityIds: PatternCopyData['createdEntityIds'];
}

export function computeAxisOffset(index: number, distance: number, direction: 'one_direction' | 'symmetric'): number {
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
): Vec2 {
	const o1 = computeAxisOffset(i, distance1, direction1);
	const o2 = computeAxisOffset(j, distance2, direction2);
	return Vec2.from(u1).multiplyScalar(o1).addScaledVector(u2, o2);
}

export function computeRectangularPatternDirections(
	paramMap: Map<string, number>,
	line1?: { p1Id: string; p2Id: string } | null,
	line2?: { p1Id: string; p2Id: string } | null
): { u1: Vec2; u2: Vec2 } {
	let u1 = new Vec2(1, 0);
	if (line1) {
		const p1a = readParamPoint(paramMap, line1.p1Id);
		const p1b = readParamPoint(paramMap, line1.p2Id);
		const dir1 = new Vec2().subVectors(p1b, p1a);
		const len1 = dir1.length();
		if (len1 > 1e-6) {
			u1 = dir1.clone().multiplyScalar(1.0 / len1);
		}
	}

	let u2 = u1.clone().perpendicular();
	if (line2) {
		const p2a = readParamPoint(paramMap, line2.p1Id);
		const p2b = readParamPoint(paramMap, line2.p2Id);
		const dir2 = new Vec2().subVectors(p2b, p2a);
		const len2 = dir2.length();
		if (len2 > 1e-6) {
			u2 = dir2.clone().multiplyScalar(1.0 / len2);
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
	distance1Expression?: string;
	distance2Expression?: string;

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
		weight = 1.0,
		distance1Expression?: string,
		distance2Expression?: string
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
		this.distance1Expression = distance1Expression;
		this.distance2Expression = distance2Expression;
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
				const s = readParamPoint(paramMap, pair.sourcePtId);
				const p = readParamPoint(paramMap, pair.patternPtId);

				const target = s.add(offset);

				errors.push((p.x - target.x) * this.weight);
				errors.push((p.y - target.y) * this.weight);
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

		let du1_dx1b = 0,
			du1_dy1b = 0,
			du1_dx1b_y = 0,
			du1_dy1b_y = 0;
		let hasL1 = false;
		if (line1) {
			const p1a = readParamPoint(paramMap, line1.p1Id);
			const p1b = readParamPoint(paramMap, line1.p2Id);
			const dir1 = new Vec2().subVectors(p1b, p1a);
			const L1 = dir1.length();
			if (L1 > 1e-6) {
				hasL1 = true;
				const invL = 1 / L1;
				du1_dx1b = (1 - u1.x * u1.x) * invL;
				du1_dy1b = -u1.x * u1.y * invL;
				du1_dx1b_y = -u1.x * u1.y * invL;
				du1_dy1b_y = (1 - u1.y * u1.y) * invL;
			}
		}

		let du2_dx2b = 0,
			du2_dy2b = 0,
			du2_dx2b_y = 0,
			du2_dy2b_y = 0;
		let hasL2 = false;
		if (line2) {
			const p2a = readParamPoint(paramMap, line2.p1Id);
			const p2b = readParamPoint(paramMap, line2.p2Id);
			const dir2 = new Vec2().subVectors(p2b, p2a);
			const L2 = dir2.length();
			if (L2 > 1e-6) {
				hasL2 = true;
				const invL = 1 / L2;
				du2_dx2b = (1 - u2.x * u2.x) * invL;
				du2_dy2b = -u2.x * u2.y * invL;
				du2_dx2b_y = -u2.x * u2.y * invL;
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
					const dDeltaX_d1b = new Vec2(
						o1 * du1_dx1b + (!hasL2 ? o2 * -du1_dx1b_y : 0),
						o1 * du1_dy1b + (!hasL2 ? o2 * -du1_dy1b_y : 0)
					);
					const dDeltaY_d1b = new Vec2(
						o1 * du1_dx1b_y + (!hasL2 ? o2 * du1_dx1b : 0),
						o1 * du1_dy1b_y + (!hasL2 ? o2 * du1_dy1b : 0)
					);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowX, -dDeltaX_d1b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowX, -dDeltaX_d1b.y * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowX, dDeltaX_d1b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowX, dDeltaX_d1b.y * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.x`, rowY, -dDeltaY_d1b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p2Id}.y`, rowY, -dDeltaY_d1b.y * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.x`, rowY, dDeltaY_d1b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line1.p1Id}.y`, rowY, dDeltaY_d1b.y * this.weight);
				}

				if (hasL2 && line2) {
					const dDeltaX_d2b = new Vec2(o2 * du2_dx2b, o2 * du2_dy2b);
					const dDeltaY_d2b = new Vec2(o2 * du2_dx2b_y, o2 * du2_dy2b_y);

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowX, -dDeltaX_d2b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowX, -dDeltaX_d2b.y * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowX, dDeltaX_d2b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowX, dDeltaX_d2b.y * this.weight);

					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.x`, rowY, -dDeltaY_d2b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p2Id}.y`, rowY, -dDeltaY_d2b.y * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.x`, rowY, dDeltaY_d2b.x * this.weight);
					this.addJacobianEntry(entries, paramIndices, `${line2.p1Id}.y`, rowY, dDeltaY_d2b.y * this.weight);
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
		const centroidWorld = calculateObjectsCentroid(ctx.sketch, this.sourceObjectIds);
		if (!centroidWorld) return;
		const sCtr = ctx.viewport.worldToScreen(centroidWorld);

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
				const baseColor = hasConflict
					? COLORS.conflict
					: isFullyConstrained
						? COLORS.constrained
						: COLORS.unconstrained;

				const maxI = Math.abs(this.distance1) > 1e-6 ? this.quantity1 : 1;
				const maxJ = Math.abs(this.distance2) > 1e-6 ? this.quantity2 : 1;

				for (let i = 0; i < maxI; i++) {
					for (let j = 0; j < maxJ; j++) {
						if (i === 0 && j === 0) continue;
						const copyIndex = i * 1000 + j;
						const isSuppressed = suppressedSet.has(copyIndex);
						const offset = computeRectangularPatternOffset(
							i,
							j,
							this.distance1,
							this.direction1,
							this.distance2,
							this.direction2,
							u1,
							u2
						);

						let copyCentroid: { x: number; y: number };
						const copy = this.copies.find(cp => cp.copyIndex === copyIndex);

						if (copy && copy.pointPairs.length > 0 && !isSuppressed) {
							const copyPts: Vec2[] = [];
							for (const pair of copy.pointPairs) {
								const pt = ctx.sketch.points.get(pair.patternPtId);
								if (pt) copyPts.push(pt);
							}
							copyCentroid =
								copyPts.length > 0
									? ctx.viewport.worldToScreen(Vec2.centroid(copyPts))
									: ctx.viewport.worldToScreen(new Vec2().addVectors(centroidWorld, offset));
						} else if (ctx.renderTransformedObjects) {
							const copyWorldPoints = ctx.renderTransformedObjects(this.sourceObjectIds, offset, {
								targetGroup: ctx.targetGroup,
								baseColor,
								opacity: 0.25,
								drawVertices: true,
								skipRender: !isSuppressed,
							});
							if (copyWorldPoints.length > 0) {
								copyCentroid = ctx.viewport.worldToScreen(Vec2.centroid(copyWorldPoints));
							} else {
								copyCentroid = ctx.viewport.worldToScreen(new Vec2().addVectors(centroidWorld, offset));
							}
						} else {
							copyCentroid = ctx.viewport.worldToScreen(new Vec2().addVectors(centroidWorld, offset));
						}

						if (ctx.patternCheckboxPositions) {
							ctx.patternCheckboxPositions.set(`c-${this.id}-${copyIndex}`, {
								x: copyCentroid.x,
								y: copyCentroid.y,
								copyIndex,
								constraintId: this.id,
							});
						}

						if (ctx.renderPatternSuppressionCheckbox) {
							ctx.renderPatternSuppressionCheckbox(copyCentroid, copyIndex, isSuppressed, this.id);
						}
					}
				}
			}
		}

		ctx.renderBadge(this.id, new Vec2(sCtr.x + 14, sCtr.y - 14), 'rectangular_pattern', COLORS.primary);
	}

	protected override createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel({
			constraint: this,
			title: 'Rectangular Pattern',
			iconName: 'rectangular_pattern',
			sections: [
				{
					title: 'AXIS 1',
					segmentedControls: [
						{
							label: 'Direction',
							options: [
								{ id: 'one_direction', label: 'One Direction' },
								{ id: 'symmetric', label: 'Symmetric' },
							],
							getCurrent: () => this.direction1,
							onSelect: (dir, context) => {
								context.sketch.updateRectangularPattern(this.id, {
									direction1: dir as 'one_direction' | 'symmetric',
								});
								context.requestRender?.();
							},
						},
					],
					fields: [
						{
							id: `insp-rpat-dist1-${this.id}`,
							label: 'Distance',
							unit: 'mm',
							type: 'text',
							step: 0.5,
							getValue: () => this.distance1Expression ?? Number(this.distance1.toFixed(2)),
							onChange: (val, context) => {
								const text = String(val).trim();
								const parsed = parseNumericOrExpression(text, this.distance1, context.sketch.getParameterValuesMap());
								const expr = getExpressionIfValid(text, context.sketch.getParameterValuesMap());
								if (!isNaN(parsed) && isFinite(parsed)) {
									context.sketch.updateRectangularPattern(this.id, {
										distance1: parsed,
										distance1Expression: expr,
									});
									context.requestRender?.();
								}
							},
						},
						{
							id: `insp-rpat-qty1-${this.id}`,
							label: 'Quantity',
							type: 'number',
							min: 1,
							max: 100,
							step: 1,
							getValue: () => this.quantity1,
							onInput: (val, context) => {
								if (!isNaN(val) && val >= 1) {
									context.sketch.updateRectangularPattern(this.id, {
										quantity1: val,
									});
									context.requestRender?.();
								}
							},
						},
					],
				},
				{
					title: 'AXIS 2',
					segmentedControls: [
						{
							label: 'Direction',
							options: [
								{ id: 'one_direction', label: 'One Direction' },
								{ id: 'symmetric', label: 'Symmetric' },
							],
							getCurrent: () => this.direction2,
							onSelect: (dir, context) => {
								context.sketch.updateRectangularPattern(this.id, {
									direction2: dir as 'one_direction' | 'symmetric',
								});
								context.requestRender?.();
							},
						},
					],
					fields: [
						{
							id: `insp-rpat-dist2-${this.id}`,
							label: 'Distance',
							unit: 'mm',
							type: 'text',
							step: 0.5,
							getValue: () => this.distance2Expression ?? Number(this.distance2.toFixed(2)),
							onChange: (val, context) => {
								const text = String(val).trim();
								const parsed = parseNumericOrExpression(text, this.distance2, context.sketch.getParameterValuesMap());
								const expr = getExpressionIfValid(text, context.sketch.getParameterValuesMap());
								if (!isNaN(parsed) && isFinite(parsed)) {
									context.sketch.updateRectangularPattern(this.id, {
										distance2: parsed,
										distance2Expression: expr,
									});
									context.requestRender?.();
								}
							},
						},
						{
							id: `insp-rpat-qty2-${this.id}`,
							label: 'Quantity',
							type: 'number',
							min: 1,
							max: 100,
							step: 1,
							getValue: () => this.quantity2,
							onInput: (val, context) => {
								if (!isNaN(val) && val >= 1) {
									context.sketch.updateRectangularPattern(this.id, {
										quantity2: val,
									});
									context.requestRender?.();
								}
							},
						},
					],
				},
			],
			checkboxes: [
				{
					id: `insp-rpat-suppression-${this.id}`,
					label: 'Suppression',
					isChecked: () => this.suppression,
					hint: () => {
						const maxI = Math.abs(this.distance1) > 1e-6 ? this.quantity1 : 1;
						const maxJ = Math.abs(this.distance2) > 1e-6 ? this.quantity2 : 1;
						let totalCopies = 0;
						let suppressedCount = 0;
						const suppressedSet = new Set(this.suppressedIndices);
						for (let i = 0; i < maxI; i++) {
							for (let j = 0; j < maxJ; j++) {
								if (i === 0 && j === 0) continue;
								totalCopies++;
								if (this.suppression && suppressedSet.has(i * 1000 + j)) {
									suppressedCount++;
								}
							}
						}
						const activeCopies = totalCopies - suppressedCount;
						return `${activeCopies} of ${totalCopies} enabled`;
					},
					onChange: (checked, context) => {
						context.sketch.updateRectangularPattern(this.id, { suppression: checked });
						context.requestRender?.();
					},
				},
			],
		});
	}
}

import { calculateObjectsCentroid } from '../../canvas/tools/modify/utils';
import type { JacobianEntry } from '../types';
import { readParamPoint } from './base';
import {
	BasePatternConstraint,
	collectPatternEntityIds,
	type PatternCopyData,
	type PatternPointPair,
	type PatternRadiusPair,
} from './circularPattern';
import {
	getPatternBaseColor,
	isConstraintOnlySelected,
	renderPatternConstraintCopy,
	type ConstraintRenderContext,
} from './renderContext';
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

function lineUnitDirection(
	paramMap: ReadonlyMap<string, number>,
	line: { p1Id: string; p2Id: string } | null | undefined,
	fallback: Vec2
): Vec2 {
	if (!line) return fallback;
	const dir = new Vec2().subVectors(readParamPoint(paramMap, line.p2Id), readParamPoint(paramMap, line.p1Id));
	const len = dir.length();
	return len > 1e-6 ? dir.multiplyScalar(1 / len) : fallback;
}

export function buildPointParamMap(sketch: {
	points: ReadonlyMap<string, { x: number; y: number }>;
}): Map<string, number> {
	const paramMap = new Map<string, number>();
	for (const [pid, pt] of sketch.points.entries()) {
		paramMap.set(`${pid}.x`, pt.x);
		paramMap.set(`${pid}.y`, pt.y);
	}
	return paramMap;
}

export function computeRectangularPatternDirections(
	paramMap: Map<string, number>,
	line1?: { p1Id: string; p2Id: string } | null,
	line2?: { p1Id: string; p2Id: string } | null
): { u1: Vec2; u2: Vec2 } {
	const u1 = lineUnitDirection(paramMap, line1, new Vec2(1, 0));
	const u2 = lineUnitDirection(paramMap, line2, u1.clone().perpendicular());
	return { u1, u2 };
}

/**
 * Constrains patterned entities in a 2D linear array along 1 or 2 direction axes.
 * Holds all pattern copies and point correspondences in a single constraint.
 */
export class RectangularPatternConstraint extends BasePatternConstraint<RectangularPatternCopyData> {
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
		super(
			id,
			'rectangular_pattern',
			'Rectangular Pattern',
			collectPatternEntityIds(copies, [line1P1Id, line1P2Id, line2P1Id, line2P2Id]),
			weight
		);

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

	protected override applySuppressedIndices(sketch: any, suppressedIndices: number[]): void {
		sketch.updateRectangularPattern(this.id, { suppressedIndices });
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

			this.evaluateRadiusPairs(copy, paramMap, errors);
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

		const computeLineDeriv = (line: { p1Id: string; p2Id: string } | null, u: Vec2) => {
			if (!line) return null;
			const L = new Vec2()
				.subVectors(readParamPoint(paramMap, line.p2Id), readParamPoint(paramMap, line.p1Id))
				.length();
			if (L <= 1e-6) return null;
			const invL = 1 / L;
			return { xx: (1 - u.x * u.x) * invL, xy: -u.x * u.y * invL, yy: (1 - u.y * u.y) * invL };
		};
		const pushLineDeriv = (line: { p1Id: string; p2Id: string }, row: number, d: Vec2) => {
			this.addJacobianEntry(entries, paramIndices, `${line.p2Id}.x`, row, -d.x * this.weight);
			this.addJacobianEntry(entries, paramIndices, `${line.p2Id}.y`, row, -d.y * this.weight);
			this.addJacobianEntry(entries, paramIndices, `${line.p1Id}.x`, row, d.x * this.weight);
			this.addJacobianEntry(entries, paramIndices, `${line.p1Id}.y`, row, d.y * this.weight);
		};

		const d1 = computeLineDeriv(line1, u1);
		const d2 = computeLineDeriv(line2, u2);
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

				if (d1 && line1) {
					pushLineDeriv(
						line1,
						rowX,
						new Vec2(o1 * d1.xx + (!d2 ? o2 * -d1.xy : 0), o1 * d1.xy + (!d2 ? o2 * -d1.yy : 0))
					);
					pushLineDeriv(
						line1,
						rowY,
						new Vec2(o1 * d1.xy + (!d2 ? o2 * d1.xx : 0), o1 * d1.yy + (!d2 ? o2 * d1.xy : 0))
					);
				}

				if (d2 && line2) {
					pushLineDeriv(line2, rowX, new Vec2(o2 * d2.xx, o2 * d2.xy));
					pushLineDeriv(line2, rowY, new Vec2(o2 * d2.xy, o2 * d2.yy));
				}
			}

			eqIdx = this.addRadiusPairJacobian(copy, entries, paramIndices, baseRow, eqIdx);
		}

		return entries;
	}

	override render(ctx: ConstraintRenderContext): void {
		const centroidWorld = calculateObjectsCentroid(ctx.sketch, this.sourceObjectIds);
		if (!centroidWorld) return;
		const sCtr = ctx.viewport.worldToScreen(centroidWorld);

		const paramMap = buildPointParamMap(ctx.sketch);
		const line1 = this.line1P1Id && this.line1P2Id ? { p1Id: this.line1P1Id, p2Id: this.line1P2Id } : null;
		const line2 = this.line2P1Id && this.line2P2Id ? { p1Id: this.line2P1Id, p2Id: this.line2P2Id } : null;
		const { u1, u2 } = computeRectangularPatternDirections(paramMap, line1, line2);
		const isConstraintActive = isConstraintOnlySelected(this.id, ctx.sketch);

		if (isConstraintActive) {
			if (ctx.renderRectangularPatternGizmos) {
				ctx.renderRectangularPatternGizmos(ctx.viewport, centroidWorld, u1, u2, this.distance1, this.distance2, {
					targetGroup: ctx.targetGroup,
					constraintId: this.id,
				});
			}

			if (this.suppression) {
				const suppressedSet = new Set(this.suppressedIndices);
				const baseColor = getPatternBaseColor(ctx.sketch);
				const maxI = Math.abs(this.distance1) > 1e-6 ? this.quantity1 : 1;
				const maxJ = Math.abs(this.distance2) > 1e-6 ? this.quantity2 : 1;

				for (let i = 0; i < maxI; i++) {
					for (let j = 0; j < maxJ; j++) {
						if (i === 0 && j === 0) continue;
						const copyIndex = i * 1000 + j;
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
						renderPatternConstraintCopy({
							ctx,
							constraintId: this.id,
							copyIndex,
							isSuppressed: suppressedSet.has(copyIndex),
							copy: this.copies.find(cp => cp.copyIndex === copyIndex),
							sourceObjectIds: this.sourceObjectIds,
							transform: offset,
							baseColor,
							fallbackScreenCentroid: () => ctx.viewport.worldToScreen(new Vec2().addVectors(centroidWorld, offset)),
						});
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
			sections: ([1, 2] as const).map(axis => {
				const dirKey = axis === 1 ? 'direction1' : 'direction2';
				const distKey = axis === 1 ? 'distance1' : 'distance2';
				const exprKey = axis === 1 ? 'distance1Expression' : 'distance2Expression';
				const qtyKey = axis === 1 ? 'quantity1' : 'quantity2';
				return {
					title: `AXIS ${axis}`,
					segmentedControls: [
						{
							label: 'Direction',
							options: [
								{ id: 'one_direction', label: 'One Direction' },
								{ id: 'symmetric', label: 'Symmetric' },
							],
							getCurrent: () => this[dirKey],
							onSelect: (dir: string, context: any) => {
								context.sketch.updateRectangularPattern(this.id, {
									[dirKey]: dir as 'one_direction' | 'symmetric',
								});
								context.requestRender?.();
							},
						},
					],
					fields: [
						{
							id: `insp-rpat-dist${axis}-${this.id}`,
							label: 'Distance',
							unit: 'mm',
							type: 'text',
							step: 0.5,
							getValue: () => this[exprKey] ?? Number(this[distKey].toFixed(2)),
							onChange: (val: string | number, context: any) => {
								const text = String(val).trim();
								const parsed = parseNumericOrExpression(text, this[distKey], context.sketch.getParameterValuesMap());
								const expr = getExpressionIfValid(text, context.sketch.getParameterValuesMap());
								if (!isNaN(parsed) && isFinite(parsed)) {
									context.sketch.updateRectangularPattern(this.id, {
										[distKey]: parsed,
										[exprKey]: expr,
									});
									context.requestRender?.();
								}
							},
						},
						{
							id: `insp-rpat-qty${axis}-${this.id}`,
							label: 'Quantity',
							type: 'number',
							min: 1,
							max: 100,
							step: 1,
							getValue: () => this[qtyKey],
							onInput: (val: number, context: any) => {
								if (!isNaN(val) && val >= 1) {
									context.sketch.updateRectangularPattern(this.id, { [qtyKey]: val });
									context.requestRender?.();
								}
							},
						},
					],
				};
			}),
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

	createGizmoDragState(
		sketch: import('../../model/sketch').SketchDocument,
		axis: 1 | 2,
		startMouseWorld: Vec2
	): {
		axis: 1 | 2;
		startMouseWorld: Vec2;
		centroidWorld: Vec2;
		u: Vec2;
		startDistance: number;
		constraintId: string;
	} | null {
		const paramMap = buildPointParamMap(sketch);
		const line1 = this.line1Id ? sketch.lines.get(this.line1Id) : null;
		const line2 = this.line2Id ? sketch.lines.get(this.line2Id) : null;
		const dirs = computeRectangularPatternDirections(
			paramMap,
			line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
			line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
		);
		const u = axis === 1 ? dirs.u1 : dirs.u2;
		const centroidWorld = calculateObjectsCentroid(sketch, this.sourceObjectIds);
		if (!centroidWorld || !u) return null;
		return {
			axis,
			startMouseWorld,
			centroidWorld,
			u,
			startDistance: axis === 1 ? this.distance1 : this.distance2,
			constraintId: this.id,
		};
	}

	applyGizmoDrag(
		sketch: import('../../model/sketch').SketchDocument,
		state: {
			axis: 1 | 2;
			startMouseWorld: Vec2;
			centroidWorld: Vec2;
			u: Vec2;
			startDistance: number;
		},
		world: Vec2
	): boolean {
		const { axis, centroidWorld, u, startMouseWorld, startDistance } = state;
		const startProj = new Vec2().subVectors(startMouseWorld, centroidWorld).dot(u);
		const currentProj = new Vec2().subVectors(world, centroidWorld).dot(u);
		let newDist = startDistance + (currentProj - startProj);
		newDist = Math.abs(newDist) < 0.25 ? 0 : Math.round(newDist * 2) / 2;

		if (axis === 1) {
			if (this.distance1 !== newDist) {
				sketch.updateRectangularPattern(this.id, { distance1: newDist });
			}
		} else {
			if (this.distance2 !== newDist) {
				sketch.updateRectangularPattern(this.id, { distance2: newDist });
			}
		}
		return true;
	}
}

import { cross, dot, mid, sub } from '../../math/vector';
import type { JacobianEntry } from '../types';
import { BaseConstraint, computeNumericJacobianForEquation, readParamPoint } from './base';
import type { ConstraintRenderContext } from './renderContext';
import { COLORS, SYMMETRY_CHORD_ATTRS } from '../../canvas/styles';
import { createSvgLine } from '../../canvas/svg';
import { distanceToPoint } from '../../math/hitTest';

/**
 * Constrains two points to be symmetric with respect to an infinite line (lineP1 to lineP2, axis_x, axis_y) or origin
 */
export class SymmetryConstraint extends BaseConstraint {
	readonly p1Id: string;
	readonly p2Id: string;
	readonly lineP1Id: string;
	readonly lineP2Id: string;
	readonly lineId?: string;

	constructor(
		id: string,
		p1Id: string,
		p2Id: string,
		lineP1Id: string,
		lineP2Id: string,
		weight = 1.0,
		lineId?: string
	) {
		const axisId =
			lineId === 'axis_x' || lineId === 'axis_y'
				? lineId
				: lineP1Id === 'axis_x' || lineP1Id === 'axis_y'
					? lineP1Id
					: undefined;
		super(
			id,
			'symmetry',
			'Symmetry',
			[p1Id, p2Id, ...(axisId ? [] : [lineP1Id, lineP2Id]), axisId ?? lineId].filter((x): x is string => Boolean(x)),
			weight
		);
		this.p1Id = p1Id;
		this.p2Id = p2Id;
		this.lineP1Id = axisId ? 'origin' : lineP1Id;
		this.lineP2Id = axisId ? axisId : lineP2Id;
		this.lineId = axisId ?? lineId;
	}

	override getEquationsCount(): number {
		return 2;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const p1 = readParamPoint(paramMap, this.p1Id);
		const p2 = readParamPoint(paramMap, this.p2Id);

		if (this.lineId === 'origin' || (this.lineP1Id === 'origin' && !this.lineP2Id)) {
			return [(p1.x + p2.x) * 0.5 * this.weight, (p1.y + p2.y) * 0.5 * this.weight];
		}

		const a = readParamPoint(paramMap, this.lineP1Id);
		const b = readParamPoint(paramMap, this.lineP2Id);

		const dir = sub(b, a);
		const lineLen = Math.max(Math.hypot(dir.x, dir.y), 1e-7);

		// Equation 0: Midpoint of (P1, P2) lies on the line AB
		const midpoint = mid(p1, p2);
		const eq0 = (cross(sub(midpoint, a), dir) / lineLen) * this.weight;

		// Equation 1: Chord vector (P2 - P1) is perpendicular to line AB
		const chord = sub(p2, p1);
		const eq1 = (dot(chord, dir) / lineLen) * this.weight;

		return [eq0, eq1];
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const j0 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 0, paramMap);
		const j1 = computeNumericJacobianForEquation(this, paramIndices, baseRow, 1, paramMap);
		return [...j0, ...j1];
	}

	override render(ctx: ConstraintRenderContext): void {
		const p1 = ctx.sketch.points.get(this.p1Id);
		const p2 = ctx.sketch.points.get(this.p2Id);
		if (!p1 || !p2) return;

		const s1 = ctx.viewport.worldToScreen(p1);
		const s2 = ctx.viewport.worldToScreen(p2);

		if (ctx.isSelected) {
			createSvgLine(s1, s2, SYMMETRY_CHORD_ATTRS, ctx.targetGroup);
		}

		ctx.renderBadge(this.id, { x: s1.x + 12, y: s1.y - 12 }, 'symmetry', COLORS.primary);
		ctx.renderBadge(this.id, { x: s2.x + 12, y: s2.y - 12 }, 'symmetry', COLORS.primary);
	}

	override distanceTo(screen: any, sketch: any, viewport: any, _thresholdPx?: number): number | null {
		const p1 = sketch.points.get(this.p1Id);
		const p2 = sketch.points.get(this.p2Id);
		if (!p1 || !p2) return null;

		const s1 = viewport.worldToScreen(p1);
		const s2 = viewport.worldToScreen(p2);
		const d1 = distanceToPoint(screen, { x: s1.x + 12, y: s1.y - 12 });
		const d2 = distanceToPoint(screen, { x: s2.x + 12, y: s2.y - 12 });
		return Math.min(d1, d2);
	}
}

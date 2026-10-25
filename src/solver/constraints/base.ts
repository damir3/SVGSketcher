import type { IConstraint, ConstraintType, JacobianEntry } from '../types';
import type { ConstraintRenderContext } from './renderContext';
export * from './renderContext';

export class BaseConstraint implements IConstraint {
	readonly id: string;
	readonly type: ConstraintType;
	name: string;
	weight: number;
	isSoft: boolean;
	isDimensional: boolean;
	value?: number;
	entityIds: string[];

	constructor(
		id: string,
		type: ConstraintType,
		name: string,
		entityIds: string[],
		weight = 1.0,
		isSoft = false,
		isDimensional = false,
		value?: number
	) {
		this.id = id;
		this.type = type;
		this.name = name;
		this.entityIds = entityIds;
		this.weight = weight;
		this.isSoft = isSoft;
		this.isDimensional = isDimensional;
		this.value = value;
	}

	getEquationsCount(): number {
		return 1;
	}

	evaluate(_paramMap: Map<string, number>): number[] {
		return [0];
	}

	jacobian(_paramIndices: Map<string, number>, _baseRow: number, _paramMap: Map<string, number>): JacobianEntry[] {
		return [];
	}

	render(_context: ConstraintRenderContext): void {
		// Default: no visual representation
	}

	protected addJacobianEntry(
		entries: JacobianEntry[],
		paramIndices: Map<string, number>,
		paramId: string,
		row: number,
		val: number
	): void {
		const col = paramIndices.get(paramId);
		if (col !== undefined && Math.abs(val) > 1e-12) {
			entries.push({ row, col, val });
		}
	}
}

/**
 * Helper to compute high-precision numerical derivative for complex geometrical constraints
 */
export function computeNumericJacobianForEquation(
	constraint: IConstraint,
	paramIndices: Map<string, number>,
	baseRow: number,
	eqIndex: number,
	paramMap: Map<string, number>
): JacobianEntry[] {
	const res: JacobianEntry[] = [];
	const eps = 1e-5;
	const f0 = constraint.evaluate(paramMap)[eqIndex];

	for (const [paramId, col] of paramIndices.entries()) {
		const orig = paramMap.get(paramId);
		if (orig === undefined) continue;

		// Check if this param is actually relevant to this constraint
		let isRelevant = false;
		for (const ent of constraint.entityIds) {
			if (paramId.startsWith(`${ent}.`)) {
				isRelevant = true;
				break;
			}
		}
		if (!isRelevant) continue;

		paramMap.set(paramId, orig + eps);
		const fPlus = constraint.evaluate(paramMap)[eqIndex];
		paramMap.set(paramId, orig);

		const deriv = (fPlus - f0) / eps;
		if (Math.abs(deriv) > 1e-11) {
			res.push({ row: baseRow + eqIndex, col, val: deriv });
		}
	}

	return res;
}

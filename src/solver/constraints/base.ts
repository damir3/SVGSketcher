import type { IConstraint, ConstraintType, JacobianEntry } from '../types';
import type { ConstraintRenderContext } from './renderContext';
import { ConstraintPanel } from '../../ui/panels/constraints/constraintPanel';
import { vec, type Vec2 } from '../../math/vector';
export * from './renderContext';

export function readParamPoint(paramMap: ReadonlyMap<string, number>, pointId: string): Vec2 {
	return vec(paramMap.get(`${pointId}.x`) ?? 0, paramMap.get(`${pointId}.y`) ?? 0);
}

export class BaseConstraint implements IConstraint {
	readonly id: string;
	readonly type: ConstraintType;
	name: string;
	weight: number;
	isSoft: boolean;
	isDimensional: boolean;
	value?: number;
	expression?: string;
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

	distanceTo(_screen: any, _sketch: any, _viewport: any, _thresholdPx?: number): number | null {
		return null;
	}

	get sidebarPanel(): ConstraintPanel {
		const panel = this.createSidebarPanel();
		Object.defineProperty(this, 'sidebarPanel', { value: panel });
		return panel;
	}

	protected createSidebarPanel(): ConstraintPanel {
		return new ConstraintPanel(this);
	}

	static restoreFromSnapshot<T extends BaseConstraint>(
		constraintClass: { prototype: T },
		data: Record<string, unknown>
	): T {
		const { sidebarPanel: _sidebarPanel, ...fields } = data;
		return Object.assign(Object.create(constraintClass.prototype), fields) as T;
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

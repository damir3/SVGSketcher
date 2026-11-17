import type { SketchDocument } from './sketch';
import { CircularPatternConstraint, RectangularPatternConstraint } from '../solver/constraints';
import {
	evaluateExpression,
	validateExpression,
	evaluateParameterGraph,
	isValidParameterName,
	renameParameterInExpression,
	type SketchParameter,
	type ParameterGraphResult,
} from '../math/expression';

export function getParameterValuesMap(sketch: SketchDocument): Map<string, number> {
	const map = new Map<string, number>();
	for (const [name, p] of sketch.parameters) {
		map.set(name, p.value);
	}
	return map;
}

export function evaluateSketchExpression(
	sketch: SketchDocument,
	expr: string
): {
	value?: number;
	isValid: boolean;
	error?: string;
	referencedVars: string[];
} {
	return validateExpression(expr, getParameterValuesMap(sketch));
}

export function addSketchParameter(
	sketch: SketchDocument,
	name: string,
	expression: string,
	comment?: string
): { success: boolean; error?: string; parameter?: SketchParameter } {
	const nameCheck = isValidParameterName(name);
	if (!nameCheck.isValid) {
		return { success: false, error: nameCheck.error };
	}
	if (sketch.parameters.has(name)) {
		return { success: false, error: `Parameter '${name}' already exists` };
	}
	sketch.beginTransaction();
	try {
		const p: SketchParameter = {
			id: sketch.nextId('Param'),
			name,
			expression,
			value: 0,
			comment,
		};
		sketch.parameters.set(name, p);
		recomputeParametersAndConstraints(sketch, false);
		return { success: true, parameter: p };
	} finally {
		sketch.commitTransaction(false);
	}
}

export function updateSketchParameter(
	sketch: SketchDocument,
	name: string,
	newName: string,
	newExpr: string,
	comment?: string
): { success: boolean; error?: string } {
	const existing = sketch.parameters.get(name);
	if (!existing) {
		return { success: false, error: `Parameter '${name}' not found` };
	}
	if (newName !== name) {
		const nameCheck = isValidParameterName(newName);
		if (!nameCheck.isValid) {
			return { success: false, error: nameCheck.error };
		}
		if (sketch.parameters.has(newName)) {
			return { success: false, error: `Parameter '${newName}' already exists` };
		}
	}
	sketch.beginTransaction();
	try {
		existing.expression = newExpr;
		existing.comment = comment;
		if (newName !== name) {
			sketch.parameters.delete(name);
			existing.name = newName;
			sketch.parameters.set(newName, existing);

			// Rename in other parameters and constraint expressions
			for (const other of sketch.parameters.values()) {
				if (other.name !== newName) {
					other.expression = renameParameterInExpression(other.expression, name, newName);
				}
			}
			for (const c of sketch.constraints.values()) {
				if (c.expression) {
					c.expression = renameParameterInExpression(c.expression, name, newName);
				}
				if (c instanceof RectangularPatternConstraint) {
					if (c.distance1Expression) {
						c.distance1Expression = renameParameterInExpression(c.distance1Expression, name, newName);
					}
					if (c.distance2Expression) {
						c.distance2Expression = renameParameterInExpression(c.distance2Expression, name, newName);
					}
				}
				if (c instanceof CircularPatternConstraint && c.totalAngleExpression) {
					c.totalAngleExpression = renameParameterInExpression(c.totalAngleExpression, name, newName);
				}
			}
		}
		recomputeParametersAndConstraints(sketch, false);
		return { success: true };
	} finally {
		sketch.commitTransaction(false);
	}
}

export function deleteSketchParameter(sketch: SketchDocument, name: string): { success: boolean; error?: string } {
	if (!sketch.parameters.has(name)) {
		return { success: false, error: `Parameter '${name}' not found` };
	}
	sketch.beginTransaction();
	try {
		sketch.parameters.delete(name);
		recomputeParametersAndConstraints(sketch, false);
		return { success: true };
	} finally {
		sketch.commitTransaction(false);
	}
}

export function recomputeParametersAndConstraints(
	sketch: SketchDocument,
	pushHistory = false
): {
	success: boolean;
	errors: Map<string, string>;
} {
	if (pushHistory) {
		sketch.pushHistory();
	}
	const graphRes: ParameterGraphResult = evaluateParameterGraph(sketch.parameters);
	for (const [pName, val] of graphRes.values) {
		const p = sketch.parameters.get(pName);
		if (p) p.value = val;
	}

	for (const c of sketch.constraints.values()) {
		if (c instanceof RectangularPatternConstraint) {
			let updated = false;
			const updates: { distance1?: number; distance2?: number } = {};
			if (c.distance1Expression) {
				try {
					const val = evaluateExpression(c.distance1Expression, graphRes.values);
					if (Number.isFinite(val)) {
						updates.distance1 = val;
						updated = true;
					}
				} catch {}
			}
			if (c.distance2Expression) {
				try {
					const val = evaluateExpression(c.distance2Expression, graphRes.values);
					if (Number.isFinite(val)) {
						updates.distance2 = val;
						updated = true;
					}
				} catch {}
			}
			if (updated) {
				sketch.updateRectangularPattern(c.id, updates);
			}
			continue;
		}
		if (c instanceof CircularPatternConstraint) {
			if (c.totalAngleExpression) {
				try {
					const val = evaluateExpression(c.totalAngleExpression, graphRes.values);
					if (Number.isFinite(val) && Math.abs(val) > 1e-3) {
						sketch.updateCircularPattern(c.id, { totalAngle: val });
					}
				} catch {}
			}
			continue;
		}
		if (!c.expression) continue;
		try {
			const val = evaluateExpression(c.expression, graphRes.values);
			if (Number.isFinite(val) && val > 0) {
				sketch.applyConstraintValueDirectly(c, val);
			}
		} catch {
			// Expression failed to evaluate, keep previous value
		}
	}

	sketch.solve();
	if (!sketch.isInTransaction()) sketch.notify();
	return { success: graphRes.errors.size === 0, errors: graphRes.errors };
}

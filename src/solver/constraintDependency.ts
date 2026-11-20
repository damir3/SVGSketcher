import { getGeometryKernel } from '../kernel';
import { checkConstraints } from './constraintInspection';
import { isDependentDimension as reference } from './constraintDependencyReference';
import type { SketchDocument } from '../model/sketch';
import type { ParamManager } from './solver';
import type { IConstraint } from './types';
import type { DependencyInput, DependencyRule } from '../kernel/dependencyTypes';
import { compileNativeConstraints, describeNativeConstraint } from './nativeConstraints';
import { serializeConstraint } from './constraints/serialization';
import { AngleConstraint } from './constraints/angle';
import {
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	PointOnLineConstraint,
	PointToLineDistanceConstraint,
	EllipseAxisConstraint,
	PointOnEllipseConstraint,
	EllipticalArcEndpointsConstraint,
	SymmetryConstraint,
	OffsetConstraint,
} from './constraints';
const numericalConstraints = new Set<Function>([
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	PointOnLineConstraint,
	PointToLineDistanceConstraint,
	EllipseAxisConstraint,
	PointOnEllipseConstraint,
	EllipticalArcEndpointsConstraint,
	SymmetryConstraint,
]);

/** Preserve document rules in TS; evaluate built-in Jacobians and both rank tests in Rust. */
export function isDependentDimension(
	manager: ParamManager,
	constraints: Iterable<IConstraint>,
	candidate: IConstraint,
	sketch: SketchDocument
): boolean {
	const kernel = getGeometryKernel().dependency;
	if (!kernel) return reference(manager, constraints, candidate, sketch);
	if (!candidate.isDimensional || !candidate.updateReferenceValue || candidate.isSoft) return false;
	const values = manager.getCurrentValues();
	const previousFree = new Set(manager.getIndices().keys());
	manager.prepare();
	try {
		const items = [...constraints];
		const indices = manager.getIndices();
		const hard = items.filter(c => c !== candidate && !c.isReference && !c.isSoft);
		const descriptions = new Map([...hard, candidate].map(c => [c, describeNativeConstraint(c)] as const));
		if ([...descriptions.values()].some(d => !d)) return reference(manager, items, candidate, sketch);
		const { error, satisfied } = checkConstraints(hard, values, true);
		if (!satisfied || !Number.isFinite(error) || error > 1e-2) return false;
		const measurement: IConstraint = Object.assign(
			Object.create(Object.getPrototypeOf(candidate)),
			serializeConstraint(candidate)
		);
		measurement.isReference = true;
		measurement.updateReferenceValue!(values, sketch);
		measurement.isReference = false;
		if (measurement instanceof AngleConstraint && !measurement.isSatisfied(values)) measurement.sign *= -1;
		if (measurement.isSatisfied && !measurement.isSatisfied(values)) return false;
		if (!indices.size) return true;
		const all = [...hard, measurement];
		descriptions.set(measurement, describeNativeConstraint(measurement));
		const compiled = compileNativeConstraints(all, values, indices, descriptions);
		const state = Float64Array.from(indices.keys(), id => values.get(id)!);
		// Custom equations, method overrides and unsupported spline representations keep their TS semantics.
		if (compiled.fallbackAll.length || !state.every(Number.isFinite))
			return reference(manager, items, candidate, sketch);
		// Most dimensions use analytic rows and need no parameter-to-entity index at all.
		let entityColumns: Map<string, number[]> | undefined;
		const relevantColumns = (entities: readonly string[]) => {
			if (!entityColumns) {
				entityColumns = new Map();
				for (const [id, column] of indices) {
					if (!values.has(id)) continue;
					for (let dot = id.indexOf('.'); dot >= 0; dot = id.indexOf('.', dot + 1)) {
						const entity = id.slice(0, dot);
						let columns = entityColumns.get(entity);
						if (!columns) entityColumns.set(entity, (columns = []));
						columns.push(column);
					}
				}
			}
			return [...new Set(entities.flatMap(id => entityColumns!.get(id) ?? []))].sort((a, b) => a - b);
		};
		const rules: DependencyRule[] = all.flatMap(c => {
			const rows = c.getEquationsCount();
			const mode =
				c instanceof OffsetConstraint ? 'offset' : numericalConstraints.has(c.constructor) ? 'central' : 'solver';
			const columns = mode === 'solver' ? [] : relevantColumns(c.entityIds);
			return rows ? [{ rows, mode, columns }] : [];
		});
		const input: DependencyInput = {
			values: state,
			nativeConstraints: compiled.data,
			rules,
			hardRows: hard.reduce((sum, c) => sum + c.getEquationsCount(), 0),
			checkGeometricOffsets: hard.some(c => c instanceof OffsetConstraint),
			candidateHasFreeParameters: [...indices.keys()].some(id =>
				candidate.entityIds.some(entity => id.startsWith(`${entity}.`))
			),
		};
		return kernel(input);
	} finally {
		manager.prepare(new Set([...values.keys()].filter(id => !previousFree.has(id))));
	}
}

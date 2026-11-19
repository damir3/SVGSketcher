import { analyzeNullspaceSparse, finalizeSparseRows } from '../math/matrix';
import type { SketchDocument } from '../model/sketch';
import { AngleConstraint } from './constraints/angle';
import { computeNumericJacobianForEquation } from './constraints/base';
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
import { serializeConstraint } from './constraints/serialization';
import type { ParamManager } from './solver';
import type { IConstraint } from './types';

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

/** A measured value is dependent when its rows add no independent geometric equation. */
export function isDependentDimension(
	manager: ParamManager,
	constraints: Iterable<IConstraint>,
	candidate: IConstraint,
	sketch: SketchDocument
): boolean {
	if (!candidate.isDimensional || !candidate.updateReferenceValue || candidate.isSoft) return false;
	const values = manager.getCurrentValues();
	const previousFree = new Set(manager.getIndices().keys());
	manager.prepare();
	try {
		const indices = manager.getIndices();
		const hard = [...constraints].filter(c => c !== candidate && !c.isReference && !c.isSoft);
		if (hard.some(c => c.isSatisfied && !c.isSatisfied(values))) return false;
		const error = hard.reduce((sum, c) => sum + c.evaluate(values).reduce((total, r) => total + (r * r) / 2, 0), 0);
		if (!Number.isFinite(error) || error > 1e-2) return false;

		// Test the measurement at the current geometry, independently of the requested value.
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

		const dependent = (geometricOffsets: boolean) => {
			const columns: number[][] = [],
				rows: number[][] = [];
			const append = (constraint: IConstraint) => {
				const offset = columns.length;
				for (let i = 0; i < constraint.getEquationsCount(); i++) {
					columns.push([]);
					rows.push([]);
				}
				const entries =
					numericalConstraints.has(constraint.constructor) ||
					(geometricOffsets && constraint instanceof OffsetConstraint)
						? Array.from({ length: constraint.getEquationsCount() }, (_, row) =>
								computeNumericJacobianForEquation(constraint, indices, offset, row, values, true)
							).flat()
						: constraint.jacobian(indices, offset, values);
				for (const e of entries) {
					columns[e.row].push(e.col);
					rows[e.row].push(e.val);
				}
			};
			for (const constraint of hard) append(constraint);
			const boundary = columns.length;
			append(measurement);
			finalizeSparseRows(columns, rows);
			if (
				columns.slice(boundary).every(row => !row.length) &&
				[...indices.keys()].some(id => candidate.entityIds.some(entity => id.startsWith(`${entity}.`)))
			) {
				return false; // At a singular geometry a zero derivative does not prove a constant value.
			}
			for (const row of rows) {
				const scale = row.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
				if (!Number.isFinite(scale)) return false;
				if (scale) for (let i = 0; i < row.length; i++) row[i] /= scale;
			}
			const rank = (end: number) =>
				analyzeNullspaceSparse(
					columns.slice(0, end).map(row => [...row]),
					rows.slice(0, end).map(row => [...row]),
					indices.size
				).rank;
			return columns.length > boundary && rank(boundary) === rank(columns.length);
		};
		// Keep child-only solver dependencies, and also test the full offset
		// relation: its source may move while the source/child gap stays fixed.
		return dependent(false) || (hard.some(c => c instanceof OffsetConstraint) && dependent(true));
	} finally {
		manager.prepare(new Set([...values.keys()].filter(id => !previousFree.has(id))));
	}
}

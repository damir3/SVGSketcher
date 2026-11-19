import { readFileSync } from 'node:fs';
import { analyzeNullspaceSparse, finalizeSparseRows } from '../../src/math/matrix';
import { compileNativeConstraints } from '../../src/solver/nativeConstraints';
import { deserializeConstraint } from '../../src/solver/constraints/serialization';
import { AutomaticSplineHandlesConstraint } from '../../src/solver/constraints/automaticSplineHandles';
import { computeNumericJacobianForEquation } from '../../src/solver/constraints/base';
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
	DistanceConstraint,
} from '../../src/solver/constraints';
import type { IConstraint } from '../../src/solver/types';
import type { DependencyInput, DependencyRule } from '../../src/kernel/dependencyTypes';
const numerical = new Set<Function>([
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

/** Independently reproduce the frozen numeric phase, retaining TS formulas and sparse rank arithmetic. */
export function dependencyCase(
	name: string,
	hard: IConstraint[],
	measurement: IConstraint,
	values: Map<string, number>,
	indices: Map<string, number>
) {
	const cs = [...hard, measurement],
		compiled = compileNativeConstraints(cs, values, indices);
	if (compiled.fallbackAll.length) return null;
	const rule = (c: IConstraint): DependencyRule => ({
		rows: c.getEquationsCount(),
		mode: c instanceof OffsetConstraint ? 'offset' : numerical.has(c.constructor) ? 'central' : 'solver',
		columns: [...indices].filter(([id]) => c.entityIds.some(e => id.startsWith(`${e}.`))).map(([, col]) => col),
	});
	const relevant = [...indices.keys()].some(id => measurement.entityIds.some(e => id.startsWith(`${e}.`)));
	const boundary = hard.reduce((sum, c) => sum + c.getEquationsCount(), 0);
	const ranks = (geometric: boolean) => {
		const columns: number[][] = [],
			rows: number[][] = [];
		for (const c of cs) {
			const offset = rows.length;
			for (let i = 0; i < c.getEquationsCount(); i++) {
				columns.push([]);
				rows.push([]);
			}
			const entries =
				numerical.has(c.constructor) || (geometric && c instanceof OffsetConstraint)
					? Array.from({ length: c.getEquationsCount() }, (_, r) =>
							computeNumericJacobianForEquation(c, indices, offset, r, values, true)
						).flat()
					: c.jacobian(indices, offset, values);
			for (const e of entries) {
				columns[e.row].push(e.col);
				rows[e.row].push(e.val);
			}
		}
		finalizeSparseRows(columns, rows);
		if (relevant && columns.slice(boundary).every(r => !r.length)) return { dependent: false, ranks: null };
		for (const row of rows) {
			const scale = row.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
			if (!Number.isFinite(scale)) return { dependent: false, ranks: null };
			if (scale) for (let i = 0; i < row.length; i++) row[i] /= scale;
		}
		const rank = (end: number) =>
			analyzeNullspaceSparse(
				columns.slice(0, end).map(r => [...r]),
				rows.slice(0, end).map(r => [...r]),
				indices.size
			).rank;
		const pair = [rank(boundary), rank(rows.length)];
		return { dependent: rows.length > boundary && pair[0] === pair[1], ranks: pair };
	};
	const first = ranks(false),
		second = !first.dependent && hard.some(c => c instanceof OffsetConstraint) ? ranks(true) : null;
	const input: DependencyInput = {
		values: Float64Array.from(indices.keys(), id => values.get(id)!),
		nativeConstraints: compiled.data,
		rules: cs.map(rule).filter(r => r.rows),
		hardRows: boundary,
		candidateHasFreeParameters: relevant,
		checkGeometricOffsets: hard.some(c => c instanceof OffsetConstraint),
	};
	return {
		name,
		input,
		expected: first.dependent || !!second?.dependent,
		solverRanks: first.ranks,
		geometricRanks: second?.ranks ?? null,
	};
}
export function dependencyCases() {
	const out: NonNullable<ReturnType<typeof dependencyCase>>[] = [];
	for (const file of [
		'kernelConstraints',
		'kernelAxisConstraints',
		'kernelCurvedConstraints',
		'kernelPatternConstraints',
		'kernelSplineConstraints',
	]) {
		const source = JSON.parse(readFileSync(new URL(`../fixtures/${file}.json`, import.meta.url), 'utf8'));
		for (const f of source.cases) {
			const c: IConstraint =
				f.kind === 'automatic'
					? Object.assign(
							new AutomaticSplineHandlesConstraint(
								'spline',
								f.constraint.fitPointIds,
								f.constraint.handles.map((h: any) => ({ index: h.index, midpoint: deserializeConstraint(h.midpoint) }))
							),
							{ weight: f.constraint.weight ?? 1 }
						)
					: deserializeConstraint(f.constraint)!;
			if (!c) continue;
			const values = new Map<string, number>(Object.entries(f.params)),
				indices = new Map<string, number>(f.freeIds.map((id: string, i: number) => [id, i]));
			for (const [mode, hard] of [
				['single', []],
				['duplicate', [c]],
			] as const) {
				const entry = dependencyCase(`${file}/${f.name}/${mode}`, [...hard], c, values, indices);
				if (entry) out.push(entry);
			}
			const independent = new DistanceConstraint('probe', 'probeA', 'probeB', 10);
			const expanded = new Map(values),
				free = new Map(indices);
			for (const [id, value] of [
				['probeA.x', 0],
				['probeA.y', 0],
				['probeB.x', 10],
				['probeB.y', 0],
			] as const) {
				expanded.set(id, value);
				free.set(id, free.size);
			}
			const entry = dependencyCase(`${file}/${f.name}/independent`, [c], independent, expanded, free);
			if (entry) out.push(entry);
			if (c instanceof OffsetConstraint) {
				const pair = c.pairs.find(p => p.kind === 'line');
				if (pair?.kind === 'line') {
					const measured = new PointToLineDistanceConstraint(
						'gap',
						pair.offP1Id,
						pair.origLineId,
						pair.origP1Id,
						pair.origP2Id,
						10,
						pair.side
					);
					const gap = dependencyCase(`${file}/${f.name}/geometric-gap`, [c], measured, values, indices);
					if (gap) out.push(gap);
				}
			}
		}
	}
	return out;
}

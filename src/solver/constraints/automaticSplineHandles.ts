import { computeNaturalFitHandles } from '../../math/spline';
import type { JacobianEntry } from '../types';
import { BaseConstraint, readParamPoint } from './base';
import type { MidpointConstraint } from './midpoint';

type AutomaticHandle = { index: number; midpoint: MidpointConstraint };

/** Replaces the midpoint equations of automatic tangents for the duration of a solve. */
export class AutomaticSplineHandlesConstraint extends BaseConstraint {
	private readonly fitPointIds: string[];
	private readonly handles: AutomaticHandle[];
	constructor(splineId: string, fitPointIds: string[], handles: AutomaticHandle[]) {
		super(`automatic_handles_${splineId}`, 'midpoint', 'Automatic spline handles', [
			...new Set([...fitPointIds, ...handles.flatMap(({ midpoint }) => [midpoint.p1Id, midpoint.p2Id])]),
		]);
		this.fitPointIds = fitPointIds;
		this.handles = handles;
	}

	override getEquationsCount(): number {
		return this.handles.length * 4;
	}

	override evaluate(paramMap: Map<string, number>): number[] {
		const natural = this.naturalHandles(paramMap);
		return this.handles.flatMap(({ index, midpoint }) => {
			const { h1, h2 } = natural[index];
			const p1 = readParamPoint(paramMap, midpoint.p1Id);
			const p2 = readParamPoint(paramMap, midpoint.p2Id);
			return [p1.x - h1.x, p1.y - h1.y, p2.x - h2.x, p2.y - h2.y];
		});
	}

	override jacobian(
		paramIndices: Map<string, number>,
		baseRow: number,
		paramMap: Map<string, number>
	): JacobianEntry[] {
		const entries: JacobianEntry[] = [];
		for (const [i, { midpoint }] of this.handles.entries()) {
			const row = baseRow + 4 * i;
			this.addJacobianEntry(entries, paramIndices, `${midpoint.p1Id}.x`, row, 1);
			this.addJacobianEntry(entries, paramIndices, `${midpoint.p1Id}.y`, row + 1, 1);
			this.addJacobianEntry(entries, paramIndices, `${midpoint.p2Id}.x`, row + 2, 1);
			this.addJacobianEntry(entries, paramIndices, `${midpoint.p2Id}.y`, row + 3, 1);
		}

		const original = this.evaluate(paramMap);
		const step = 1e-5;
		for (const pointId of new Set(this.fitPointIds)) {
			for (const axis of ['x', 'y']) {
				const id = `${pointId}.${axis}`;
				const col = paramIndices.get(id);
				const value = paramMap.get(id);
				if (col === undefined || value === undefined) continue;
				paramMap.set(id, value + step);
				const shifted = this.evaluate(paramMap);
				paramMap.set(id, value);
				for (let i = 0; i < original.length; i++) {
					const val = (shifted[i] - original[i]) / step;
					if (Math.abs(val) > 1e-11) entries.push({ row: baseRow + i, col, val });
				}
			}
		}
		return entries;
	}

	private naturalHandles(paramMap: Map<string, number>) {
		return computeNaturalFitHandles(this.fitPointIds.map(id => readParamPoint(paramMap, id)));
	}
}

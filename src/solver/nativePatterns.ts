import {
	CircularPatternConstraint,
	RectangularPatternConstraint,
	OffsetConstraint,
	SymmetryConstraint,
} from './constraints';
import type { IConstraint } from './types';
import { type Description, point, scalar, constant } from './nativeConstraintData';

/** Expand copies and chains into ordered records while leaving all geometry calculations in Rust. */
export function describePatternConstraint(c: IConstraint): Description[] | null {
	if (c instanceof SymmetryConstraint) {
		const origin = c.lineId === 'origin' || (c.lineP1Id === 'origin' && !c.lineP2Id);
		return [
			{
				kind: 21,
				refs: [
					...point(c.p1Id),
					...point(c.p2Id),
					...(origin ? Array.from({ length: 4 }, () => constant(0)) : [...point(c.lineP1Id), ...point(c.lineP2Id)]),
				],
				a: origin ? 1 : 0,
				b: 0,
				numeric: true,
				equations: 2,
			},
		];
	}
	if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
		const records: Description[] = [];
		const suppressed = new Set(c.suppressedIndices);
		for (const copy of c.copies) {
			if (c.suppression && suppressed.has(copy.copyIndex)) continue;
			for (const pair of copy.pointPairs) {
				if (c instanceof CircularPatternConstraint) {
					const distribution = ['full', 'partial', 'symmetric'].indexOf(c.distribution);
					if (distribution < 0) return null;
					records.push({
						kind: 22,
						refs: [
							...point(c.centerPtId),
							...point(pair.sourcePtId),
							...point(pair.patternPtId),
							constant(copy.copyIndex),
							constant(c.quantity),
						],
						a: c.totalAngle,
						b: distribution,
						equations: 2,
					});
				} else {
					const rectangularCopy = copy as RectangularPatternConstraint['copies'][number];
					const line1 = !!(c.line1P1Id && c.line1P2Id),
						line2 = !!(c.line2P1Id && c.line2P2Id);
					const emptyLine = () => Array.from({ length: 4 }, () => constant(0));
					records.push({
						kind: 23,
						refs: [
							...point(pair.sourcePtId),
							...point(pair.patternPtId),
							...(line1 ? [...point(c.line1P1Id!), ...point(c.line1P2Id!)] : emptyLine()),
							...(line2 ? [...point(c.line2P1Id!), ...point(c.line2P2Id!)] : emptyLine()),
							constant(rectangularCopy.i),
							constant(rectangularCopy.j),
							constant(c.direction1 === 'one_direction' ? 0 : 1),
							constant(c.direction2 === 'one_direction' ? 0 : 1),
							constant(+line1),
							constant(+line2),
						],
						a: c.distance1,
						b: c.distance2,
						equations: 2,
					});
				}
			}
			for (const pair of copy.radiusPairs ?? [])
				records.push({
					kind: 5,
					refs: [scalar(`${pair.patternCircleId}.r`), scalar(`${pair.sourceCircleId}.r`)],
					a: 0,
					b: 0,
					equations: 1,
				});
		}
		return records;
	}
	if (c instanceof OffsetConstraint) {
		// The TS helper is private at compile time but may still be customized at runtime.
		if (Reflect.get(c, 'lineResidual') !== Reflect.get(OffsetConstraint.prototype, 'lineResidual')) return null;
		const records: Description[] = [];
		for (const pair of c.pairs) {
			if (pair.kind === 'line') {
				for (const id of [pair.offP1Id, pair.offP2Id])
					records.push({
						kind: 24,
						refs: [...point(id), ...point(pair.origP1Id), ...point(pair.origP2Id)],
						a: c.targetDistance,
						b: pair.side,
						equations: 1,
					});
			} else if (pair.kind === 'circle') {
				records.push({
					kind: 25,
					refs: [
						...point(pair.offCenterId),
						...point(pair.origCenterId),
						scalar(`${pair.offId}.r`),
						scalar(`${pair.origId}.r`),
					],
					a: c.targetDistance,
					b: pair.side,
					equations: 3,
				});
			} else if (pair.kind === 'spline') {
				for (const p of pair.points)
					records.push({
						kind: 26,
						refs: [
							...point(p.pointId),
							constant(p.basePos.x),
							constant(p.basePos.y),
							constant(p.normal.x),
							constant(p.normal.y),
							constant(p.side),
						],
						a: c.targetDistance,
						b: 0,
						equations: 2,
					});
			}
		}
		return records;
	}
	return null;
}

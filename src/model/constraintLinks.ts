import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import type { SketchLine } from './types';
import {
	RadiusConstraint,
	AngleConstraint,
	FixedConstraint,
	OffsetConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../solver/constraints/serialization';

function lineFromPoints(sketch: SketchDocument, p1Id: string, p2Id: string): SketchLine | undefined {
	const endpoint = p1Id === 'origin' ? p2Id : p2Id === 'origin' ? p1Id : undefined;
	return endpoint === 'axis_x' || endpoint === 'axis_y' ? sketch.getLine(endpoint) : sketch.getLineBetween(p1Id, p2Id);
}

export function hasRadiusConstraint(sketch: SketchDocument, circleId: string): boolean {
	for (const c of sketch.constraints.values()) {
		if (c instanceof RadiusConstraint && c.circleId === circleId) {
			return true;
		}
	}
	return false;
}

export function hasAngleConstraint(sketch: SketchDocument, line1Id: string, line2Id: string): boolean {
	for (const c of sketch.constraints.values()) {
		if (
			c instanceof AngleConstraint &&
			((c.line1Id === line1Id && c.line2Id === line2Id) || (c.line1Id === line2Id && c.line2Id === line1Id))
		) {
			return true;
		}
	}
	return false;
}

export function hasThreePointAngleConstraint(
	sketch: SketchDocument,
	p1Id: string,
	p2Id: string,
	p3Id: string
): boolean {
	for (const c of sketch.constraints.values()) {
		if (
			c instanceof AngleConstraint &&
			!c.line1Id &&
			!c.line2Id &&
			c.l1P1 === p2Id &&
			c.l2P1 === p2Id &&
			((c.l1P2 === p1Id && c.l2P2 === p3Id) || (c.l1P2 === p3Id && c.l2P2 === p1Id))
		) {
			return true;
		}
	}
	return false;
}

export function isPointFixed(sketch: SketchDocument, pointId: string): boolean {
	const pt = sketch.points.get(pointId);
	if (pt?.fixed) return true;
	for (const c of sketch.constraints.values()) {
		if (c instanceof FixedConstraint && c.pointId === pointId) {
			return true;
		}
	}
	return false;
}

export function matchesEndpoints(pA: string, pB: string, end1: string, end2: string): boolean {
	return (pA === end1 && pB === end2) || (pA === end2 && pB === end1);
}

export function remapLineConstraints(
	sketch: SketchDocument,
	line: SketchLine,
	oldPointId: string,
	newPointId: string
): void {
	for (const constraint of sketch.constraints.values()) {
		if (constraint.type === 'circular_pattern' || !constraint.entityIds.includes(oldPointId)) continue;
		const data = serializeConstraint(constraint);
		let changed = false;
		const remapPair = <T>(record: T, first: keyof T, second: keyof T) => {
			const a = record[first];
			const b = record[second];
			if (typeof a !== 'string' || typeof b !== 'string' || !matchesEndpoints(a, b, line.p1Id, line.p2Id)) {
				return;
			}
			Object.assign(record, { [a === oldPointId ? first : second]: newPointId });
			changed = true;
		};

		switch (data.type) {
			case 'horizontal':
			case 'vertical':
			case 'midpoint':
				remapPair(data, 'p1Id', 'p2Id');
				break;
			case 'angle':
				if (data.line1Id === line.id) remapPair(data, 'l1P1', 'l1P2');
				if (data.line2Id === line.id) remapPair(data, 'l2P1', 'l2P2');
				break;
			case 'parallel':
			case 'perpendicular':
			case 'collinear':
				remapPair(data, 'l1P1', 'l1P2');
				remapPair(data, 'l2P1', 'l2P2');
				break;
			case 'equal_length':
				remapPair(data, 'line1P1', 'line1P2');
				remapPair(data, 'line2P1', 'line2P2');
				break;
			case 'symmetry':
			case 'tangent_line_circle':
			case 'point_to_line_distance':
				if (data.type === 'point_to_line_distance' && data.constrainedLineId === line.id)
					remapPair(data, 'pointId', 'secondPointId');
				if (data.lineId && data.lineId !== line.id) break;
				remapPair(data, 'lineP1Id', 'lineP2Id');
				break;
			case 'point_on_line':
				remapPair(data, 'lineP1Id', 'lineP2Id');
				break;
			case 'offset': {
				const pairs = data.pairs as OffsetConstraint['pairs'];
				for (const pair of pairs) {
					if (pair.kind !== 'line') continue;
					if (pair.origLineId === line.id) remapPair(pair, 'origP1Id', 'origP2Id');
					if (pair.offLineId === line.id) remapPair(pair, 'offP1Id', 'offP2Id');
				}
				if (changed) {
					data.entityIds = new OffsetConstraint(data.id, pairs, data.targetDistance).entityIds;
				}
				break;
			}
			case 'rectangular_pattern':
				if (data.line1Id === line.id) remapPair(data, 'line1P1Id', 'line1P2Id');
				if (data.line2Id === line.id) remapPair(data, 'line2P1Id', 'line2P2Id');
				break;
		}

		if (!changed) continue;
		if (data.type !== 'offset') {
			// A point can also play a second role, for example as the endpoint of another line.
			const { entityIds, ...fields } = data;
			const stillUsesOldPoint =
				Object.values(fields).includes(oldPointId) ||
				(data.type === 'rectangular_pattern' &&
					data.copies.some(copy =>
						copy.pointPairs.some(pair => pair.sourcePtId === oldPointId || pair.patternPtId === oldPointId)
					));
			data.entityIds = [...new Set([...entityIds.filter(id => id !== oldPointId || stillUsesOldPoint), newPointId])];
		}
		const updated = deserializeConstraint(data);
		if (updated) sketch.constraints.set(updated.id, updated);
	}
}

export function getLineBetween(sketch: SketchDocument, p1Id: string, p2Id: string): SketchLine | undefined {
	for (const line of sketch.lines.values()) {
		if ((line.p1Id === p1Id && line.p2Id === p2Id) || (line.p1Id === p2Id && line.p2Id === p1Id)) {
			return line;
		}
	}
	return undefined;
}

export function isPointUsed(sketch: SketchDocument, pointId: string): boolean {
	for (const prim of sketch.getCurvePrimitives()) {
		if (prim.getPointIds(sketch).includes(pointId)) return true;
	}
	return false;
}

export function getConstraintsForEntity(
	sketch: SketchDocument,
	type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline',
	id: string
): IConstraint[] {
	const res: IConstraint[] = [];
	if (type === 'point') {
		const isPointOnCurveType = (t: string) =>
			t === 'point_on_line' || t === 'point_on_circle' || t === 'point_on_ellipse' || t === 'point_on_spline';
		const usesPointEndpoint = (c: any, targetId: string) =>
			c.l1P1 === targetId || c.l1P2 === targetId || c.l2P1 === targetId || c.l2P2 === targetId;

		if (id === 'origin') {
			for (const c of sketch.constraints.values()) {
				const anyC = c as any;
				if (c.type === 'midpoint') {
					if (anyC.midId === 'origin' || anyC.p1Id === 'origin' || anyC.p2Id === 'origin') res.push(c);
				} else if (c.type === 'symmetry') {
					if (anyC.p1Id === 'origin' || anyC.p2Id === 'origin' || anyC.lineId === 'origin') res.push(c);
				} else if (isPointOnCurveType(c.type) || c.type === 'point_to_line_distance') {
					if (anyC.pointId === 'origin') res.push(c);
				} else if (
					c.type === 'coincident' ||
					c.type === 'horizontal' ||
					c.type === 'vertical' ||
					c.type === 'distance'
				) {
					if (
						(anyC.p1Id === 'origin' || anyC.p2Id === 'origin') &&
						!(c.type === 'distance' && anyC.orientation !== 'aligned')
					) {
						res.push(c);
					}
				} else if (c.type === 'circular_pattern') {
					if ((c as CircularPatternConstraint).centerPtId === 'origin') res.push(c);
				} else if (c.type === 'collinear') {
					const l1 = lineFromPoints(sketch, anyC.l1P1, anyC.l1P2);
					const l2 = lineFromPoints(sketch, anyC.l2P1, anyC.l2P2);
					if ((!l1 || !l2) && usesPointEndpoint(anyC, 'origin')) res.push(c);
				} else if (c.type === 'angle') {
					if (!anyC.line1Id && !anyC.line2Id && usesPointEndpoint(anyC, 'origin')) res.push(c);
				}
			}
			return res;
		}
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
			const anyC = c as any;
			if (c.type === 'fixed' || isPointOnCurveType(c.type)) {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'coincident' || c.type === 'symmetry') {
				if (anyC.p1Id === id || anyC.p2Id === id) res.push(c);
			} else if (c.type === 'point_to_line_distance') {
				if (anyC.pointId === id || anyC.secondPointId === id) res.push(c);
			} else if (c.type === 'midpoint') {
				if (
					anyC.midId === id ||
					((anyC.p1Id === id || anyC.p2Id === id) && !sketch.getLineBetween(anyC.p1Id, anyC.p2Id))
				) {
					res.push(c);
				}
			} else if (c.type === 'collinear') {
				const l1 = lineFromPoints(sketch, anyC.l1P1, anyC.l1P2);
				const l2 = lineFromPoints(sketch, anyC.l2P1, anyC.l2P2);
				if ((!l1 || !l2) && usesPointEndpoint(anyC, id)) res.push(c);
			} else if (c.type === 'angle') {
				if (!anyC.line1Id && !anyC.line2Id && usesPointEndpoint(anyC, id)) res.push(c);
			} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
				if ((anyC.p1Id === id || anyC.p2Id === id) && !sketch.getLineBetween(anyC.p1Id, anyC.p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'circular_pattern' || c.type === 'rectangular_pattern') {
				const pat = c as CircularPatternConstraint | RectangularPatternConstraint;
				if (
					(c instanceof CircularPatternConstraint && c.centerPtId === id) ||
					pat.sourceObjectIds?.includes(id) ||
					pat.copies?.some(cp => cp.createdEntityIds.some(e => e.type === 'point' && e.id === id))
				) {
					res.push(c);
				}
			}
		}
	} else if (type === 'line') {
		if (id === 'axis_x' || id === 'axis_y') {
			const axis = id === 'axis_x' ? 'x' : 'y';
			for (const c of sketch.constraints.values()) {
				const anyC = c as any;
				if (
					((c.type === 'point_on_line' || c.type === 'point_to_line_distance') &&
						anyC.lineP1Id === 'origin' &&
						anyC.lineP2Id === id) ||
					((c.type === 'collinear' || c.type === 'parallel' || c.type === 'perpendicular') &&
						((anyC.l1P1 === 'origin' && anyC.l1P2 === id) || (anyC.l2P1 === 'origin' && anyC.l2P2 === id))) ||
					(c.type === 'distance' &&
						anyC.p1Id === 'origin' &&
						anyC.orientation === (axis === 'x' ? 'vertical' : 'horizontal'))
				) {
					res.push(c);
				} else if (c.type === 'angle') {
					const ac = c as AngleConstraint;
					if (ac.line1Id === id || ac.line2Id === id) res.push(c);
				} else if (c.type === 'symmetry' || c.type === 'tangent_line_circle') {
					if (anyC.lineId === id || anyC.lineP1Id === id) res.push(c);
				}
			}
			return res;
		}
		const line = sketch.lines.get(id);
		if (!line) return [];
		const { p1Id, p2Id } = line;
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
			const anyC = c as any;
			if (c.entityIds.includes(id)) {
				res.push(c);
				continue;
			}
			if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
				if (
					c.sourceObjectIds.includes(id) ||
					c.copies.some(copy => copy.createdEntityIds.some(entity => entity.type === 'line' && entity.id === id))
				) {
					res.push(c);
				}
			} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
				if (matchesEndpoints(anyC.p1Id, anyC.p2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'point_to_line_distance') {
				if (anyC.constrainedLineId === id) res.push(c);
				if (anyC.lineId === id || matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'equal_length') {
				if (
					matchesEndpoints(anyC.line1P1, anyC.line1P2, p1Id, p2Id) ||
					matchesEndpoints(anyC.line2P1, anyC.line2P2, p1Id, p2Id)
				) {
					res.push(c);
				}
			} else if (c.type === 'parallel' || c.type === 'perpendicular') {
				if (matchesEndpoints(anyC.l1P1, anyC.l1P2, p1Id, p2Id) || matchesEndpoints(anyC.l2P1, anyC.l2P2, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'collinear') {
				const l1 = lineFromPoints(sketch, anyC.l1P1, anyC.l1P2);
				const l2 = lineFromPoints(sketch, anyC.l2P1, anyC.l2P2);
				if (
					l1 &&
					l2 &&
					(matchesEndpoints(anyC.l1P1, anyC.l1P2, p1Id, p2Id) || matchesEndpoints(anyC.l2P1, anyC.l2P2, p1Id, p2Id))
				) {
					res.push(c);
				}
			} else if (c.type === 'point_on_line' || c.type === 'tangent_line_circle') {
				if (matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'midpoint') {
				if (matchesEndpoints(anyC.p1Id, anyC.p2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'symmetry') {
				if (anyC.lineId === id || matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'angle') {
				if (
					anyC.line1Id === id ||
					anyC.line2Id === id ||
					(Boolean(anyC.line1Id) && matchesEndpoints(anyC.l1P1, anyC.l1P2, p1Id, p2Id)) ||
					(Boolean(anyC.line2Id) && matchesEndpoints(anyC.l2P1, anyC.l2P2, p1Id, p2Id))
				) {
					res.push(c);
				}
			}
		}
	} else if (type === 'circle' || type === 'arc') {
		const radial = type === 'circle' ? sketch.circles.get(id) : sketch.arcs.get(id);
		if (!radial) return [];
		for (const c of sketch.constraints.values()) {
			const anyC = c as any;
			if (c.type === 'radius' || c.type === 'tangent_line_circle' || c.type === 'point_on_circle') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'equal_radius' || c.type === 'tangent_circle_circle') {
				if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
			} else if (c.type === 'concentric') {
				if (anyC.c1CenterId === radial.centerId || anyC.c2CenterId === radial.centerId) res.push(c);
			} else if (type === 'arc' && c.type === 'angle') {
				if (anyC.line1Id === id || anyC.line2Id === id) res.push(c);
			} else if (c.entityIds.includes(id)) {
				res.push(c);
			}
		}
	} else if (type === 'ellipse') {
		const el = sketch.ellipses.get(id);
		if (!el) return [];
		for (const c of sketch.constraints.values()) {
			const anyC = c as any;
			if (anyC.ellipseId === id || c.entityIds.includes(id)) {
				res.push(c);
			}
		}
	} else if (type === 'elliptical_arc') {
		const elarc = sketch.ellipticalArcs.get(id);
		if (!elarc) return [];
		for (const c of sketch.constraints.values()) {
			const anyC = c as any;
			if (anyC.arcId === id || anyC.ellipseId === id || c.entityIds.includes(id)) {
				res.push(c);
			}
		}
	} else if (type === 'spline') {
		const spline = sketch.splines.get(id);
		if (!spline) return [];
		const seenIds = new Set<string>();
		const pushUnique = (c: IConstraint) => {
			if (!seenIds.has(c.id)) {
				seenIds.add(c.id);
				res.push(c);
			}
		};
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				for (const c of sketch.getConstraintsForEntity('line', lid)) {
					pushUnique(c);
				}
			}
		}
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
			const anyC = c as any;
			if (anyC.splineId === id || c.entityIds.includes(id)) {
				pushUnique(c);
			} else if (c.type === 'circular_pattern') {
				const cpat = c as CircularPatternConstraint;
				if (cpat.sourceObjectIds?.includes(id)) pushUnique(c);
			} else if (c.type === 'rectangular_pattern') {
				const rpat = c as RectangularPatternConstraint;
				if (rpat.sourceObjectIds?.includes(id)) pushUnique(c);
			}
		}
	}
	return res;
}

export type PatternLinks = 'all' | 'sources';

export function getEntitiesForConstraint(
	sketch: SketchDocument,
	c: IConstraint,
	patternLinks: PatternLinks = 'all'
): Array<{
	id: string;
	type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
}> {
	const res: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
	}> = [];
	const seen = new Set<string>();
	const collections = [
		['line', sketch.lines],
		['circle', sketch.circles],
		['arc', sketch.arcs],
		['ellipse', sketch.ellipses],
		['elliptical_arc', sketch.ellipticalArcs],
		['spline', sketch.splines],
		['point', sketch.points],
	] as const;
	const collectionByType = new Map<string, Map<string, unknown>>(collections);

	const add = (id: string, type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline') => {
		if (type === 'line') {
			const l = sketch.lines.get(id);
			if (l?.isSplineHandle && l.parentSplineId && sketch.splines.has(l.parentSplineId)) {
				id = l.parentSplineId;
				type = 'spline';
			}
		}
		const key = `${type}:${id}`;
		if (!seen.has(key)) {
			seen.add(key);
			res.push({ id, type });
		}
	};

	const addAny = (id: string) => {
		for (const [primType, map] of collections) {
			if (map.has(id)) {
				add(id, primType);
				return;
			}
		}
	};

	const addRadial = (id: string) => {
		if (sketch.circles.has(id)) add(id, 'circle');
		else if (sketch.arcs.has(id)) add(id, 'arc');
	};

	const addConcentricEnd = (centerId: string) => {
		const entity =
			[...sketch.circles.values()].find(circ => circ.centerId === centerId) ??
			[...sketch.arcs.values()].find(arc => arc.centerId === centerId);
		if (entity) {
			add(entity.id, sketch.circles.has(entity.id) ? 'circle' : 'arc');
		} else if (centerId && sketch.points.has(centerId)) {
			add(centerId, 'point');
		}
	};

	const addPatternEntities = (
		pattern: CircularPatternConstraint | RectangularPatternConstraint,
		links: PatternLinks
	): boolean => {
		for (const id of pattern.sourceObjectIds ?? []) addAny(id);
		if (links === 'sources') return true;
		for (const copy of pattern.copies ?? []) {
			for (const item of copy.createdEntityIds) {
				if (collectionByType.get(item.type)?.has(item.id)) add(item.id, item.type);
			}
		}
		return false;
	};

	const addPoint = (id?: string) => {
		if (id && sketch.points.get(id)) add(id, 'point');
	};
	const addResolvedLine = (line: SketchLine | undefined) => {
		if (line) add(line.id, 'line');
	};
	const addLineOrPoints = (p1Id: string, p2Id: string) => {
		const line = sketch.getLineBetween(p1Id, p2Id);
		if (line) add(line.id, 'line');
		else {
			addPoint(p1Id);
			addPoint(p2Id);
		}
	};
	const addEllipseLike = (id?: string) => {
		if (!id) return;
		if (sketch.ellipses.has(id)) add(id, 'ellipse');
		else if (sketch.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
	};

	const anyC = c as any;

	if (c.type === 'fixed') {
		addPoint(anyC.pointId);
	} else if (c.type === 'coincident') {
		addPoint(anyC.p1Id);
		addPoint(anyC.p2Id);
	} else if (c.type === 'distance' && anyC.circleIds) {
		for (const id of anyC.circleIds) addRadial(id);
	} else if (c.type === 'distance' && anyC.p1Id === 'origin' && anyC.orientation !== 'aligned') {
		add(anyC.p2Id, 'point');
		add(anyC.orientation === 'vertical' ? 'axis_x' : 'axis_y', 'line');
	} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
		addLineOrPoints(anyC.p1Id, anyC.p2Id);
	} else if (c.type === 'point_to_line_distance') {
		if (anyC.constrainedLineId) add(anyC.constrainedLineId, 'line');
		addPoint(anyC.pointId);
		addResolvedLine(
			anyC.lineId && sketch.lines.has(anyC.lineId)
				? sketch.lines.get(anyC.lineId)
				: lineFromPoints(sketch, anyC.lineP1Id, anyC.lineP2Id)
		);
	} else if (c.type === 'radius') {
		addRadial(anyC.circleId);
	} else if (c.type === 'equal_radius' || c.type === 'tangent_circle_circle') {
		addRadial(anyC.circle1Id);
		addRadial(anyC.circle2Id);
	} else if (c.type === 'equal_length') {
		addResolvedLine(sketch.getLineBetween(anyC.line1P1, anyC.line1P2));
		addResolvedLine(sketch.getLineBetween(anyC.line2P1, anyC.line2P2));
	} else if (c.type === 'parallel' || c.type === 'perpendicular') {
		addResolvedLine(lineFromPoints(sketch, anyC.l1P1, anyC.l1P2));
		addResolvedLine(lineFromPoints(sketch, anyC.l2P1, anyC.l2P2));
	} else if (c.type === 'collinear') {
		const l1 = lineFromPoints(sketch, anyC.l1P1, anyC.l1P2);
		const l2 = lineFromPoints(sketch, anyC.l2P1, anyC.l2P2);
		if (l1 && l2) {
			add(l1.id, 'line');
			add(l2.id, 'line');
		} else {
			for (const pid of [anyC.l1P1, anyC.l1P2, anyC.l2P1, anyC.l2P2]) addPoint(pid);
		}
	} else if (c.type === 'symmetry') {
		addPoint(anyC.p1Id);
		addPoint(anyC.p2Id);
		if (anyC.lineId === 'origin') add('origin', 'point');
		else
			addResolvedLine(
				(anyC.lineId ? sketch.getLine(anyC.lineId) : undefined) ?? lineFromPoints(sketch, anyC.lineP1Id, anyC.lineP2Id)
			);
	} else if (c.type === 'circular_pattern') {
		const cpat = c as CircularPatternConstraint;
		const links = cpat.isReadOnly ? 'all' : patternLinks;
		if (links !== 'sources') addPoint(cpat.centerPtId);
		// The fallback below would add copies back to the inspector list.
		if (addPatternEntities(cpat, links)) return res;
	} else if (c.type === 'rectangular_pattern') {
		const rpat = c as RectangularPatternConstraint;
		if (patternLinks === 'all') {
			if (rpat.line1Id && sketch.lines.has(rpat.line1Id)) add(rpat.line1Id, 'line');
			if (rpat.line2Id && sketch.lines.has(rpat.line2Id)) add(rpat.line2Id, 'line');
		}
		if (addPatternEntities(rpat, patternLinks)) return res;
	} else if (c.type === 'angle') {
		if (!anyC.line1Id && !anyC.line2Id) {
			for (const pid of [anyC.l1P1, anyC.l1P2, anyC.l2P1, anyC.l2P2]) addPoint(pid);
		} else {
			for (const [lineId, pA, pB] of [
				[anyC.line1Id, anyC.l1P1, anyC.l1P2],
				[anyC.line2Id, anyC.l2P1, anyC.l2P2],
			] as const) {
				if (lineId && sketch.arcs.has(lineId)) add(lineId, 'arc');
				else addResolvedLine(sketch.getLine(lineId) ?? lineFromPoints(sketch, pA, pB));
			}
		}
	} else if (c.type === 'point_on_line') {
		addPoint(anyC.pointId);
		addResolvedLine(lineFromPoints(sketch, anyC.lineP1Id, anyC.lineP2Id));
	} else if (c.type === 'point_on_circle') {
		addPoint(anyC.pointId);
		addRadial(anyC.circleId);
	} else if (c.type === 'point_on_ellipse') {
		addPoint(anyC.pointId);
		addEllipseLike(anyC.ellipseId);
	} else if (c.type === 'point_on_spline') {
		addPoint(anyC.pointId);
		if (sketch.splines.has(anyC.splineId)) add(anyC.splineId, 'spline');
	} else if (c.type === 'tangent_line_circle') {
		addResolvedLine(
			(anyC.lineId ? sketch.getLine(anyC.lineId) : undefined) ?? lineFromPoints(sketch, anyC.lineP1Id, anyC.lineP2Id)
		);
		addRadial(anyC.circleId);
	} else if (c.type === 'concentric') {
		addConcentricEnd(anyC.c1CenterId);
		addConcentricEnd(anyC.c2CenterId);
	} else if (c.type === 'midpoint') {
		addPoint(anyC.midId);
		addLineOrPoints(anyC.p1Id, anyC.p2Id);
	} else if (c.type === 'ellipse_axis') {
		addEllipseLike(anyC.ellipseId);
	} else if (c.type === 'elliptical_arc_endpoints') {
		if (anyC.arcId && sketch.ellipticalArcs.has(anyC.arcId)) add(anyC.arcId, 'elliptical_arc');
	} else if (c.type === 'offset') {
		for (const id of c.entityIds) addAny(id);
	}

	// Safety net: check if any primitive in the sketch considers this constraint related
	for (const [primType, map] of collections) {
		for (const id of map.keys()) {
			if (sketch.getConstraintsForEntity(primType, id).some(sc => sc.id === c.id)) add(id, primType);
		}
	}

	return res;
}

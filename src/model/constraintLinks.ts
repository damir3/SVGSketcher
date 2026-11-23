import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import type { PrimitiveType, SketchLine } from './types';
import {
	FixedConstraint,
	CoincidentConstraint,
	HorizontalConstraint,
	VerticalConstraint,
	DistanceConstraint,
	PointToLineDistanceConstraint,
	RadiusConstraint,
	EqualLengthConstraint,
	EqualRadiusConstraint,
	ParallelConstraint,
	PerpendicularConstraint,
	CollinearConstraint,
	SymmetryConstraint,
	AngleConstraint,
	PointOnLineConstraint,
	PointOnCircleConstraint,
	PointOnEllipseConstraint,
	PointOnSplineConstraint,
	TangentLineCircleConstraint,
	TangentCircleCircleConstraint,
	ConcentricConstraint,
	MidpointConstraint,
	EllipseAxisConstraint,
	EllipticalArcEndpointsConstraint,
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

function isPointOnCurveConstraint(
	c: IConstraint
): c is PointOnLineConstraint | PointOnCircleConstraint | PointOnEllipseConstraint | PointOnSplineConstraint {
	return (
		c instanceof PointOnLineConstraint ||
		c instanceof PointOnCircleConstraint ||
		c instanceof PointOnEllipseConstraint ||
		c instanceof PointOnSplineConstraint
	);
}

export function isPointAttachedToCurve(sketch: SketchDocument, pointId: string): boolean {
	if (sketch.isPointUsed(pointId)) return true;
	return sketch.getConstraintsForEntity('point', pointId).some(c => {
		if (c instanceof PointOnLineConstraint) return !!sketch.getLineBetween(c.lineP1Id, c.lineP2Id);
		if (isPointOnCurveConstraint(c)) return true;
		if (c instanceof MidpointConstraint) return c.midId === pointId && !!sketch.getLineBetween(c.p1Id, c.p2Id);
		if (c instanceof CoincidentConstraint) return sketch.isPointUsed(c.p1Id === pointId ? c.p2Id : c.p1Id);
		return false;
	});
}

function usesLineEndpoint(c: CollinearConstraint | AngleConstraint, targetId: string): boolean {
	return c.l1P1 === targetId || c.l1P2 === targetId || c.l2P1 === targetId || c.l2P2 === targetId;
}

export function getConstraintsForEntity(sketch: SketchDocument, type: PrimitiveType, id: string): IConstraint[] {
	const res: IConstraint[] = [];
	if (type === 'point') {
		if (id === 'origin') {
			for (const c of sketch.constraints.values()) {
				if (c instanceof MidpointConstraint) {
					if (c.midId === 'origin' || c.p1Id === 'origin' || c.p2Id === 'origin') res.push(c);
				} else if (c instanceof SymmetryConstraint) {
					if (c.p1Id === 'origin' || c.p2Id === 'origin' || c.lineId === 'origin') res.push(c);
				} else if (isPointOnCurveConstraint(c) || c instanceof PointToLineDistanceConstraint) {
					if (c.pointId === 'origin') res.push(c);
				} else if (
					c instanceof CoincidentConstraint ||
					c instanceof HorizontalConstraint ||
					c instanceof VerticalConstraint ||
					c instanceof DistanceConstraint
				) {
					if (
						(c.p1Id === 'origin' || c.p2Id === 'origin') &&
						!(c instanceof DistanceConstraint && c.orientation !== 'aligned')
					) {
						res.push(c);
					}
				} else if (c instanceof CircularPatternConstraint) {
					if (c.centerPtId === 'origin') res.push(c);
				} else if (c instanceof CollinearConstraint) {
					const l1 = lineFromPoints(sketch, c.l1P1, c.l1P2);
					const l2 = lineFromPoints(sketch, c.l2P1, c.l2P2);
					if ((!l1 || !l2) && usesLineEndpoint(c, 'origin')) res.push(c);
				} else if (c instanceof AngleConstraint) {
					if (!c.line1Id && !c.line2Id && usesLineEndpoint(c, 'origin')) res.push(c);
				}
			}
			return res;
		}
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
			if (c instanceof FixedConstraint || isPointOnCurveConstraint(c)) {
				if (c.pointId === id) res.push(c);
			} else if (c instanceof CoincidentConstraint || c instanceof SymmetryConstraint) {
				if (c.p1Id === id || c.p2Id === id) res.push(c);
			} else if (c instanceof PointToLineDistanceConstraint) {
				if (c.pointId === id || c.secondPointId === id) res.push(c);
			} else if (c instanceof MidpointConstraint) {
				if (c.midId === id || ((c.p1Id === id || c.p2Id === id) && !sketch.getLineBetween(c.p1Id, c.p2Id))) {
					res.push(c);
				}
			} else if (c instanceof CollinearConstraint) {
				const l1 = lineFromPoints(sketch, c.l1P1, c.l1P2);
				const l2 = lineFromPoints(sketch, c.l2P1, c.l2P2);
				if ((!l1 || !l2) && usesLineEndpoint(c, id)) res.push(c);
			} else if (c instanceof AngleConstraint) {
				if (!c.line1Id && !c.line2Id && usesLineEndpoint(c, id)) res.push(c);
			} else if (
				c instanceof HorizontalConstraint ||
				c instanceof VerticalConstraint ||
				c instanceof DistanceConstraint
			) {
				if ((c.p1Id === id || c.p2Id === id) && !sketch.getLineBetween(c.p1Id, c.p2Id)) {
					res.push(c);
				}
			} else if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
				if (
					(c instanceof CircularPatternConstraint && c.centerPtId === id) ||
					c.sourceObjectIds?.includes(id) ||
					c.copies?.some(cp => cp.createdEntityIds.some(e => e.type === 'point' && e.id === id))
				) {
					res.push(c);
				}
			}
		}
	} else if (type === 'line') {
		if (id === 'axis_x' || id === 'axis_y') {
			const axis = id === 'axis_x' ? 'x' : 'y';
			for (const c of sketch.constraints.values()) {
				if (
					((c instanceof PointOnLineConstraint || c instanceof PointToLineDistanceConstraint) &&
						c.lineP1Id === 'origin' &&
						c.lineP2Id === id) ||
					((c instanceof CollinearConstraint ||
						c instanceof ParallelConstraint ||
						c instanceof PerpendicularConstraint) &&
						((c.l1P1 === 'origin' && c.l1P2 === id) || (c.l2P1 === 'origin' && c.l2P2 === id))) ||
					(c instanceof DistanceConstraint &&
						c.p1Id === 'origin' &&
						c.orientation === (axis === 'x' ? 'vertical' : 'horizontal'))
				) {
					res.push(c);
				} else if (c instanceof AngleConstraint) {
					if (c.line1Id === id || c.line2Id === id) res.push(c);
				} else if (c instanceof SymmetryConstraint || c instanceof TangentLineCircleConstraint) {
					if (c.lineId === id || c.lineP1Id === id) res.push(c);
				}
			}
			return res;
		}
		const line = sketch.lines.get(id);
		if (!line) return [];
		const { p1Id, p2Id } = line;
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
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
			} else if (
				c instanceof HorizontalConstraint ||
				c instanceof VerticalConstraint ||
				c instanceof DistanceConstraint
			) {
				if (matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof PointToLineDistanceConstraint) {
				if (c.constrainedLineId === id || c.lineId === id || matchesEndpoints(c.lineP1Id, c.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof EqualLengthConstraint) {
				if (matchesEndpoints(c.line1P1, c.line1P2, p1Id, p2Id) || matchesEndpoints(c.line2P1, c.line2P2, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof ParallelConstraint || c instanceof PerpendicularConstraint) {
				if (matchesEndpoints(c.l1P1, c.l1P2, p1Id, p2Id) || matchesEndpoints(c.l2P1, c.l2P2, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof CollinearConstraint) {
				const l1 = lineFromPoints(sketch, c.l1P1, c.l1P2);
				const l2 = lineFromPoints(sketch, c.l2P1, c.l2P2);
				if (
					l1 &&
					l2 &&
					(matchesEndpoints(c.l1P1, c.l1P2, p1Id, p2Id) || matchesEndpoints(c.l2P1, c.l2P2, p1Id, p2Id))
				) {
					res.push(c);
				}
			} else if (c instanceof PointOnLineConstraint || c instanceof TangentLineCircleConstraint) {
				if (matchesEndpoints(c.lineP1Id, c.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof MidpointConstraint) {
				if (matchesEndpoints(c.p1Id, c.p2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof SymmetryConstraint) {
				if (c.lineId === id || matchesEndpoints(c.lineP1Id, c.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c instanceof AngleConstraint) {
				if (
					c.line1Id === id ||
					c.line2Id === id ||
					(Boolean(c.line1Id) && matchesEndpoints(c.l1P1, c.l1P2, p1Id, p2Id)) ||
					(Boolean(c.line2Id) && matchesEndpoints(c.l2P1, c.l2P2, p1Id, p2Id))
				) {
					res.push(c);
				}
			}
		}
	} else if (type === 'circle' || type === 'arc') {
		const radial = type === 'circle' ? sketch.circles.get(id) : sketch.arcs.get(id);
		if (!radial) return [];
		for (const c of sketch.constraints.values()) {
			if (
				c instanceof RadiusConstraint ||
				c instanceof TangentLineCircleConstraint ||
				c instanceof PointOnCircleConstraint
			) {
				if (c.circleId === id) res.push(c);
			} else if (c instanceof EqualRadiusConstraint || c instanceof TangentCircleCircleConstraint) {
				if (c.circle1Id === id || c.circle2Id === id) res.push(c);
			} else if (c instanceof ConcentricConstraint) {
				if (c.c1CenterId === radial.centerId || c.c2CenterId === radial.centerId) res.push(c);
			} else if (type === 'arc' && c instanceof AngleConstraint) {
				if (c.line1Id === id || c.line2Id === id) res.push(c);
			} else if (c.entityIds.includes(id)) {
				res.push(c);
			}
		}
	} else if (type === 'ellipse') {
		const el = sketch.ellipses.get(id);
		if (!el) return [];
		for (const c of sketch.constraints.values()) {
			if (
				((c instanceof PointOnEllipseConstraint || c instanceof EllipseAxisConstraint) && c.ellipseId === id) ||
				c.entityIds.includes(id)
			) {
				res.push(c);
			}
		}
	} else if (type === 'elliptical_arc') {
		const elarc = sketch.ellipticalArcs.get(id);
		if (!elarc) return [];
		for (const c of sketch.constraints.values()) {
			if (
				(c instanceof EllipticalArcEndpointsConstraint && c.arcId === id) ||
				((c instanceof PointOnEllipseConstraint || c instanceof EllipseAxisConstraint) && c.ellipseId === id) ||
				c.entityIds.includes(id)
			) {
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
			if ((c instanceof PointOnSplineConstraint && c.splineId === id) || c.entityIds.includes(id)) {
				pushUnique(c);
			} else if (c instanceof CircularPatternConstraint || c instanceof RectangularPatternConstraint) {
				if (c.sourceObjectIds?.includes(id)) pushUnique(c);
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
	type: PrimitiveType;
}> {
	const res: Array<{
		id: string;
		type: PrimitiveType;
	}> = [];
	const seen = new Set<string>();
	const collections = sketch.getPrimitiveCollections();

	const add = (id: string, type: PrimitiveType) => {
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
		for (const col of collections) {
			if (col.map.has(id)) {
				add(id, col.type);
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
				if (sketch.hasOwnPrimitive(item.id, item.type)) add(item.id, item.type);
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

	if (c instanceof FixedConstraint) {
		addPoint(c.pointId);
	} else if (c instanceof CoincidentConstraint) {
		addPoint(c.p1Id);
		addPoint(c.p2Id);
	} else if (c instanceof DistanceConstraint && c.circleIds) {
		for (const id of c.circleIds) addRadial(id);
	} else if (c instanceof DistanceConstraint && c.p1Id === 'origin' && c.orientation !== 'aligned') {
		add(c.p2Id, 'point');
		add(c.orientation === 'vertical' ? 'axis_x' : 'axis_y', 'line');
	} else if (c instanceof HorizontalConstraint || c instanceof VerticalConstraint || c instanceof DistanceConstraint) {
		addLineOrPoints(c.p1Id, c.p2Id);
	} else if (c instanceof PointToLineDistanceConstraint) {
		if (c.constrainedLineId) add(c.constrainedLineId, 'line');
		addPoint(c.pointId);
		addResolvedLine(
			c.lineId && sketch.lines.has(c.lineId)
				? sketch.lines.get(c.lineId)
				: lineFromPoints(sketch, c.lineP1Id, c.lineP2Id)
		);
	} else if (c instanceof RadiusConstraint) {
		addRadial(c.circleId);
	} else if (c instanceof EqualRadiusConstraint || c instanceof TangentCircleCircleConstraint) {
		addRadial(c.circle1Id);
		addRadial(c.circle2Id);
	} else if (c instanceof EqualLengthConstraint) {
		addResolvedLine(sketch.getLineBetween(c.line1P1, c.line1P2));
		addResolvedLine(sketch.getLineBetween(c.line2P1, c.line2P2));
	} else if (c instanceof ParallelConstraint || c instanceof PerpendicularConstraint) {
		addResolvedLine(lineFromPoints(sketch, c.l1P1, c.l1P2));
		addResolvedLine(lineFromPoints(sketch, c.l2P1, c.l2P2));
	} else if (c instanceof CollinearConstraint) {
		const l1 = lineFromPoints(sketch, c.l1P1, c.l1P2);
		const l2 = lineFromPoints(sketch, c.l2P1, c.l2P2);
		if (l1 && l2) {
			add(l1.id, 'line');
			add(l2.id, 'line');
		} else {
			for (const pid of [c.l1P1, c.l1P2, c.l2P1, c.l2P2]) addPoint(pid);
		}
	} else if (c instanceof SymmetryConstraint) {
		addPoint(c.p1Id);
		addPoint(c.p2Id);
		if (c.lineId === 'origin') add('origin', 'point');
		else
			addResolvedLine(
				(c.lineId ? sketch.getLine(c.lineId) : undefined) ?? lineFromPoints(sketch, c.lineP1Id, c.lineP2Id)
			);
	} else if (c instanceof CircularPatternConstraint) {
		const links = c.isReadOnly ? 'all' : patternLinks;
		if (links !== 'sources') addPoint(c.centerPtId);
		// The fallback below would add copies back to the inspector list.
		if (addPatternEntities(c, links)) return res;
	} else if (c instanceof RectangularPatternConstraint) {
		if (patternLinks === 'all') {
			if (c.line1Id && sketch.lines.has(c.line1Id)) add(c.line1Id, 'line');
			if (c.line2Id && sketch.lines.has(c.line2Id)) add(c.line2Id, 'line');
		}
		if (addPatternEntities(c, patternLinks)) return res;
	} else if (c instanceof AngleConstraint) {
		if (!c.line1Id && !c.line2Id) {
			for (const pid of [c.l1P1, c.l1P2, c.l2P1, c.l2P2]) addPoint(pid);
		} else {
			for (const [lineId, pA, pB] of [
				[c.line1Id, c.l1P1, c.l1P2],
				[c.line2Id, c.l2P1, c.l2P2],
			] as const) {
				if (lineId && sketch.arcs.has(lineId)) add(lineId, 'arc');
				else addResolvedLine(sketch.getLine(lineId) ?? lineFromPoints(sketch, pA, pB));
			}
		}
	} else if (c instanceof PointOnLineConstraint) {
		addPoint(c.pointId);
		addResolvedLine(lineFromPoints(sketch, c.lineP1Id, c.lineP2Id));
	} else if (c instanceof PointOnCircleConstraint) {
		addPoint(c.pointId);
		addRadial(c.circleId);
	} else if (c instanceof PointOnEllipseConstraint) {
		addPoint(c.pointId);
		addEllipseLike(c.ellipseId);
	} else if (c instanceof PointOnSplineConstraint) {
		addPoint(c.pointId);
		if (sketch.splines.has(c.splineId)) add(c.splineId, 'spline');
	} else if (c instanceof TangentLineCircleConstraint) {
		addResolvedLine(
			(c.lineId ? sketch.getLine(c.lineId) : undefined) ?? lineFromPoints(sketch, c.lineP1Id, c.lineP2Id)
		);
		addRadial(c.circleId);
	} else if (c instanceof ConcentricConstraint) {
		addConcentricEnd(c.c1CenterId);
		addConcentricEnd(c.c2CenterId);
	} else if (c instanceof MidpointConstraint) {
		addPoint(c.midId);
		addLineOrPoints(c.p1Id, c.p2Id);
	} else if (c instanceof EllipseAxisConstraint) {
		addEllipseLike(c.ellipseId);
	} else if (c instanceof EllipticalArcEndpointsConstraint) {
		if (c.arcId && sketch.ellipticalArcs.has(c.arcId)) add(c.arcId, 'elliptical_arc');
	} else if (c instanceof OffsetConstraint) {
		for (const id of c.entityIds) addAny(id);
	}

	// Safety net: check if any primitive in the sketch considers this constraint related
	for (const col of collections) {
		for (const id of col.map.keys()) {
			if (sketch.getConstraintsForEntity(col.type, id).some(sc => sc.id === c.id)) add(id, col.type);
		}
	}

	return res;
}

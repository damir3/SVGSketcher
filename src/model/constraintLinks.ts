import type { SketchDocument } from './sketch';
import type { IConstraint } from '../solver/types';
import type { SketchLine } from './types';
import {
	RadiusConstraint,
	AngleConstraint,
	FixedConstraint,
	OffsetConstraint,
	OriginDistanceConstraint,
	CircularPatternConstraint,
	RectangularPatternConstraint,
} from '../solver/constraints';
import { deserializeConstraint, serializeConstraint } from '../solver/constraints/serialization';

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
			case 'line_to_axis_distance':
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
	for (const line of sketch.lines.values()) {
		if (line.p1Id === pointId || line.p2Id === pointId) return true;
	}
	for (const circle of sketch.circles.values()) {
		if (circle.centerId === pointId) return true;
	}
	for (const arc of sketch.arcs.values()) {
		if (arc.centerId === pointId || arc.startPointId === pointId || arc.endPointId === pointId) return true;
	}
	for (const el of sketch.ellipses.values()) {
		if (el.centerId === pointId || el.majorAxisPointId === pointId || el.minorAxisPointId === pointId) return true;
	}
	for (const elarc of sketch.ellipticalArcs.values()) {
		if (
			elarc.centerId === pointId ||
			elarc.majorAxisPointId === pointId ||
			elarc.minorAxisPointId === pointId ||
			elarc.startPointId === pointId ||
			elarc.endPointId === pointId
		) {
			return true;
		}
	}
	for (const spline of sketch.splines.values()) {
		if (spline.pointIds.includes(pointId)) return true;
		if (spline.tangentLineIds) {
			for (const lid of spline.tangentLineIds) {
				const line = sketch.lines.get(lid);
				if (line && (line.p1Id === pointId || line.p2Id === pointId)) return true;
			}
		}
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
		if (id === 'origin') {
			for (const c of sketch.constraints.values()) {
				const anyC = c as any;
				if (c instanceof OriginDistanceConstraint) {
					if (c.isCoincident || c.orientation === 'aligned') {
						res.push(c);
					}
				} else if (c.type === 'midpoint') {
					if (anyC.midId === 'origin' || anyC.p1Id === 'origin' || anyC.p2Id === 'origin') {
						res.push(c);
					}
				} else if (c.type === 'symmetry') {
					if (anyC.p1Id === 'origin' || anyC.p2Id === 'origin' || anyC.lineId === 'origin') {
						res.push(c);
					}
				} else if (
					c.type === 'point_on_line' ||
					c.type === 'point_on_circle' ||
					c.type === 'point_on_ellipse' ||
					c.type === 'point_on_spline' ||
					c.type === 'point_to_line_distance'
				) {
					if (anyC.pointId === 'origin') {
						res.push(c);
					}
				} else if (
					c.type === 'coincident' ||
					c.type === 'horizontal' ||
					c.type === 'vertical' ||
					c.type === 'distance'
				) {
					if (anyC.p1Id === 'origin' || anyC.p2Id === 'origin') {
						res.push(c);
					}
				} else if (c.type === 'circular_pattern') {
					const cpat = c as CircularPatternConstraint;
					if (cpat.centerPtId === 'origin') {
						res.push(c);
					}
				} else if (c.type === 'collinear') {
					const l1 = sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
					const l2 = sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
					if (
						(!l1 || !l2) &&
						(anyC.l1P1 === 'origin' || anyC.l1P2 === 'origin' || anyC.l2P1 === 'origin' || anyC.l2P2 === 'origin')
					) {
						res.push(c);
					}
				} else if (c.type === 'angle') {
					if (
						!anyC.line1Id &&
						!anyC.line2Id &&
						(anyC.l1P1 === 'origin' || anyC.l1P2 === 'origin' || anyC.l2P1 === 'origin' || anyC.l2P2 === 'origin')
					) {
						res.push(c);
					}
				}
			}
			return res;
		}
		for (const c of sketch.constraints.values()) {
			if (sketch.isSplineInternalConstraint(c)) continue;
			const anyC = c as any;
			if (c.type === 'fixed') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'coincident') {
				if (anyC.p1Id === id || anyC.p2Id === id) res.push(c);
			} else if (c.type === 'point_on_line') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'point_on_circle') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'point_on_ellipse') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'point_on_spline') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'point_to_line_distance') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'origin_distance') {
				if (anyC.pointId === id) res.push(c);
			} else if (c.type === 'midpoint') {
				if (
					anyC.midId === id ||
					((anyC.p1Id === id || anyC.p2Id === id) && !sketch.getLineBetween(anyC.p1Id, anyC.p2Id))
				) {
					res.push(c);
				}
			} else if (c.type === 'collinear') {
				const l1 = sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
				const l2 = sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
				if (!l1 || !l2) {
					if (anyC.l1P1 === id || anyC.l1P2 === id || anyC.l2P1 === id || anyC.l2P2 === id) {
						res.push(c);
					}
				}
			} else if (c.type === 'angle') {
				if (
					!anyC.line1Id &&
					!anyC.line2Id &&
					(anyC.l1P1 === id || anyC.l1P2 === id || anyC.l2P1 === id || anyC.l2P2 === id)
				) {
					res.push(c);
				}
			} else if (c.type === 'symmetry') {
				if (anyC.p1Id === id || anyC.p2Id === id) res.push(c);
			} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
				if (anyC.p1Id === id || anyC.p2Id === id) {
					// Only associate if there is no line between these points (i.e. not a line constraint)
					if (!sketch.getLineBetween(anyC.p1Id, anyC.p2Id)) {
						res.push(c);
					}
				}
			} else if (c.type === 'circular_pattern') {
				const cpat = c as CircularPatternConstraint;
				if (
					cpat.centerPtId === id ||
					cpat.sourceObjectIds?.includes(id) ||
					cpat.copies?.some(cp => cp.createdEntityIds.some(e => e.type === 'point' && e.id === id))
				) {
					res.push(c);
				}
			} else if (c.type === 'rectangular_pattern') {
				const rpat = c as RectangularPatternConstraint;
				if (
					rpat.sourceObjectIds?.includes(id) ||
					rpat.copies?.some(cp => cp.createdEntityIds.some(e => e.type === 'point' && e.id === id))
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
				if (c.type === 'origin_distance') {
					const oc = c as OriginDistanceConstraint;
					if (axis === 'x' && oc.orientation === 'vertical') {
						res.push(c);
					} else if (axis === 'y' && oc.orientation === 'horizontal') {
						res.push(c);
					}
				} else if (c.type === 'line_to_axis_distance' && anyC.axis === axis) {
					res.push(c);
				} else if (c.type === 'angle') {
					const ac = c as AngleConstraint;
					if (ac.line1Id === id || ac.line2Id === id) {
						res.push(c);
					}
				} else if (c.type === 'symmetry') {
					if (anyC.lineId === id || anyC.lineP1Id === id) {
						res.push(c);
					}
				} else if (c.type === 'tangent_line_circle') {
					if (anyC.lineId === id || anyC.lineP1Id === id) {
						res.push(c);
					}
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
			if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
				if (matchesEndpoints(anyC.p1Id, anyC.p2Id, p1Id, p2Id)) {
					res.push(c);
				}
			} else if (c.type === 'point_to_line_distance') {
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
				const l1 = sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
				const l2 = sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
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
			} else if (c.type === 'line_to_axis_distance') {
				if (anyC.lineId === id || matchesEndpoints(anyC.lineP1Id, anyC.lineP2Id, p1Id, p2Id)) {
					res.push(c);
				}
			}
		}
	} else if (type === 'circle') {
		const circ = sketch.circles.get(id);
		if (!circ) return [];
		for (const c of sketch.constraints.values()) {
			const anyC = c as any;
			if (c.type === 'radius') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'equal_radius') {
				if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
			} else if (c.type === 'concentric') {
				if (anyC.c1CenterId === circ.centerId || anyC.c2CenterId === circ.centerId) {
					res.push(c);
				}
			} else if (c.type === 'tangent_line_circle') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'tangent_circle_circle') {
				if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
			} else if (c.type === 'point_on_circle') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.entityIds.includes(id)) {
				res.push(c);
			}
		}
	} else if (type === 'arc') {
		const arc = sketch.arcs.get(id);
		if (!arc) return [];
		for (const c of sketch.constraints.values()) {
			const anyC = c as any;
			if (c.type === 'radius') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'equal_radius') {
				if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
			} else if (c.type === 'concentric') {
				if (anyC.c1CenterId === arc.centerId || anyC.c2CenterId === arc.centerId) {
					res.push(c);
				}
			} else if (c.type === 'tangent_line_circle') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'tangent_circle_circle') {
				if (anyC.circle1Id === id || anyC.circle2Id === id) res.push(c);
			} else if (c.type === 'point_on_circle') {
				if (anyC.circleId === id) res.push(c);
			} else if (c.type === 'angle') {
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

export function getEntitiesForConstraint(
	sketch: SketchDocument,
	c: IConstraint
): Array<{
	id: string;
	type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
}> {
	const res: Array<{
		id: string;
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';
	}> = [];
	const seen = new Set<string>();

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

	const anyC = c as any;

	if (c.type === 'fixed') {
		if (anyC.pointId && sketch.points.has(anyC.pointId)) {
			add(anyC.pointId, 'point');
		}
	} else if (c.type === 'coincident') {
		if (anyC.p1Id && sketch.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
		if (anyC.p2Id && sketch.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
	} else if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'distance') {
		const line = sketch.getLineBetween(anyC.p1Id, anyC.p2Id);
		if (line) {
			add(line.id, 'line');
		} else {
			if (anyC.p1Id && sketch.points.has(anyC.p1Id)) add(anyC.p1Id, 'point');
			if (anyC.p2Id && sketch.points.has(anyC.p2Id)) add(anyC.p2Id, 'point');
		}
	} else if (c.type === 'point_to_line_distance') {
		if (anyC.pointId && sketch.points.has(anyC.pointId)) add(anyC.pointId, 'point');
		if (anyC.lineId && sketch.lines.has(anyC.lineId)) {
			add(anyC.lineId, 'line');
		} else {
			const line = sketch.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
			if (line) add(line.id, 'line');
		}
	} else if (c.type === 'radius') {
		const cid = anyC.circleId;
		if (sketch.circles.has(cid)) add(cid, 'circle');
		else if (sketch.arcs.has(cid)) add(cid, 'arc');
	} else if (c.type === 'equal_radius') {
		const c1 = anyC.circle1Id;
		const c2 = anyC.circle2Id;
		if (sketch.circles.has(c1)) add(c1, 'circle');
		else if (sketch.arcs.has(c1)) add(c1, 'arc');
		if (sketch.circles.has(c2)) add(c2, 'circle');
		else if (sketch.arcs.has(c2)) add(c2, 'arc');
	} else if (c.type === 'equal_length') {
		const l1 = sketch.getLineBetween(anyC.line1P1, anyC.line1P2);
		const l2 = sketch.getLineBetween(anyC.line2P1, anyC.line2P2);
		if (l1) add(l1.id, 'line');
		if (l2) add(l2.id, 'line');
	} else if (c.type === 'parallel' || c.type === 'perpendicular') {
		const l1 = sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
		const l2 = sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
		if (l1) add(l1.id, 'line');
		if (l2) add(l2.id, 'line');
	} else if (c.type === 'collinear') {
		const l1 = sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
		const l2 = sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
		if (l1 && l2) {
			add(l1.id, 'line');
			add(l2.id, 'line');
		} else {
			for (const pid of [anyC.l1P1, anyC.l1P2, anyC.l2P1, anyC.l2P2]) {
				if (sketch.points.get(pid)) add(pid, 'point');
			}
		}
	} else if (c.type === 'symmetry') {
		if (sketch.points.get(anyC.p1Id)) add(anyC.p1Id, 'point');
		if (sketch.points.get(anyC.p2Id)) add(anyC.p2Id, 'point');
		if (anyC.lineId === 'origin') {
			add('origin', 'point');
		} else {
			const line =
				(anyC.lineId ? sketch.getLine(anyC.lineId) : undefined) ?? sketch.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
			if (line) add(line.id, 'line');
		}
	} else if (c.type === 'circular_pattern') {
		const cpat = c as CircularPatternConstraint;
		if (sketch.points.get(cpat.centerPtId)) add(cpat.centerPtId, 'point');
		if (cpat.sourceObjectIds) {
			for (const id of cpat.sourceObjectIds) {
				if (sketch.lines.has(id)) add(id, 'line');
				else if (sketch.circles.has(id)) add(id, 'circle');
				else if (sketch.arcs.has(id)) add(id, 'arc');
				else if (sketch.ellipses.has(id)) add(id, 'ellipse');
				else if (sketch.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
				else if (sketch.splines.has(id)) add(id, 'spline');
				else if (sketch.points.has(id)) add(id, 'point');
			}
		}
		if (cpat.copies) {
			for (const copy of cpat.copies) {
				for (const item of copy.createdEntityIds) {
					if (item.type === 'line' && sketch.lines.has(item.id)) add(item.id, 'line');
					else if (item.type === 'circle' && sketch.circles.has(item.id)) add(item.id, 'circle');
					else if (item.type === 'arc' && sketch.arcs.has(item.id)) add(item.id, 'arc');
					else if (item.type === 'ellipse' && sketch.ellipses.has(item.id)) add(item.id, 'ellipse');
					else if (item.type === 'elliptical_arc' && sketch.ellipticalArcs.has(item.id)) add(item.id, 'elliptical_arc');
					else if (item.type === 'spline' && sketch.splines.has(item.id)) add(item.id, 'spline');
					else if (item.type === 'point' && sketch.points.has(item.id)) add(item.id, 'point');
				}
			}
		}
	} else if (c.type === 'rectangular_pattern') {
		const rpat = c as RectangularPatternConstraint;
		if (rpat.line1Id && sketch.lines.has(rpat.line1Id)) add(rpat.line1Id, 'line');
		if (rpat.line2Id && sketch.lines.has(rpat.line2Id)) add(rpat.line2Id, 'line');
		if (rpat.sourceObjectIds) {
			for (const id of rpat.sourceObjectIds) {
				if (sketch.lines.has(id)) add(id, 'line');
				else if (sketch.circles.has(id)) add(id, 'circle');
				else if (sketch.arcs.has(id)) add(id, 'arc');
				else if (sketch.ellipses.has(id)) add(id, 'ellipse');
				else if (sketch.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
				else if (sketch.splines.has(id)) add(id, 'spline');
				else if (sketch.points.has(id)) add(id, 'point');
			}
		}
		if (rpat.copies) {
			for (const copy of rpat.copies) {
				for (const item of copy.createdEntityIds) {
					if (item.type === 'line' && sketch.lines.has(item.id)) add(item.id, 'line');
					else if (item.type === 'circle' && sketch.circles.has(item.id)) add(item.id, 'circle');
					else if (item.type === 'arc' && sketch.arcs.has(item.id)) add(item.id, 'arc');
					else if (item.type === 'ellipse' && sketch.ellipses.has(item.id)) add(item.id, 'ellipse');
					else if (item.type === 'elliptical_arc' && sketch.ellipticalArcs.has(item.id)) add(item.id, 'elliptical_arc');
					else if (item.type === 'spline' && sketch.splines.has(item.id)) add(item.id, 'spline');
					else if (item.type === 'point' && sketch.points.has(item.id)) add(item.id, 'point');
				}
			}
		}
	} else if (c.type === 'angle') {
		if (!anyC.line1Id && !anyC.line2Id) {
			for (const pid of [anyC.l1P1, anyC.l1P2, anyC.l2P1, anyC.l2P2]) {
				if (sketch.points.get(pid)) add(pid, 'point');
			}
		} else {
			if (anyC.line1Id && sketch.arcs.has(anyC.line1Id)) {
				add(anyC.line1Id, 'arc');
			} else {
				const l1 = sketch.getLine(anyC.line1Id) ?? sketch.getLineBetween(anyC.l1P1, anyC.l1P2);
				if (l1) add(l1.id, 'line');
			}
			if (anyC.line2Id && sketch.arcs.has(anyC.line2Id)) {
				add(anyC.line2Id, 'arc');
			} else {
				const l2 = sketch.getLine(anyC.line2Id) ?? sketch.getLineBetween(anyC.l2P1, anyC.l2P2);
				if (l2) add(l2.id, 'line');
			}
		}
	} else if (c.type === 'point_on_line') {
		if (sketch.points.get(anyC.pointId)) add(anyC.pointId, 'point');
		const line = sketch.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
		if (line) add(line.id, 'line');
	} else if (c.type === 'point_on_circle') {
		if (sketch.points.get(anyC.pointId)) add(anyC.pointId, 'point');
		const cid = anyC.circleId;
		if (sketch.circles.has(cid)) add(cid, 'circle');
		else if (sketch.arcs.has(cid)) add(cid, 'arc');
	} else if (c.type === 'point_on_ellipse') {
		if (sketch.points.get(anyC.pointId)) add(anyC.pointId, 'point');
		const eid = anyC.ellipseId;
		if (sketch.ellipses.has(eid)) add(eid, 'ellipse');
		else if (sketch.ellipticalArcs.has(eid)) add(eid, 'elliptical_arc');
	} else if (c.type === 'point_on_spline') {
		if (sketch.points.get(anyC.pointId)) add(anyC.pointId, 'point');
		const sid = anyC.splineId;
		if (sketch.splines.has(sid)) add(sid, 'spline');
	} else if (c.type === 'tangent_line_circle') {
		const line =
			(anyC.lineId ? sketch.getLine(anyC.lineId) : undefined) ?? sketch.getLineBetween(anyC.lineP1Id, anyC.lineP2Id);
		if (line) add(line.id, 'line');
		const cid = anyC.circleId;
		if (sketch.circles.has(cid)) add(cid, 'circle');
		else if (sketch.arcs.has(cid)) add(cid, 'arc');
	} else if (c.type === 'tangent_circle_circle') {
		const c1 = anyC.circle1Id;
		if (sketch.circles.has(c1)) add(c1, 'circle');
		else if (sketch.arcs.has(c1)) add(c1, 'arc');
		const c2 = anyC.circle2Id;
		if (sketch.circles.has(c2)) add(c2, 'circle');
		else if (sketch.arcs.has(c2)) add(c2, 'arc');
	} else if (c.type === 'concentric') {
		const e1 =
			[...sketch.circles.values()].find(circ => circ.centerId === anyC.c1CenterId) ??
			[...sketch.arcs.values()].find(arc => arc.centerId === anyC.c1CenterId);
		if (e1) {
			add(e1.id, sketch.circles.has(e1.id) ? 'circle' : 'arc');
		} else if (anyC.c1CenterId && sketch.points.has(anyC.c1CenterId)) {
			add(anyC.c1CenterId, 'point');
		}

		const e2 =
			[...sketch.circles.values()].find(circ => circ.centerId === anyC.c2CenterId) ??
			[...sketch.arcs.values()].find(arc => arc.centerId === anyC.c2CenterId);
		if (e2) {
			add(e2.id, sketch.circles.has(e2.id) ? 'circle' : 'arc');
		} else if (anyC.c2CenterId && sketch.points.has(anyC.c2CenterId)) {
			add(anyC.c2CenterId, 'point');
		}
	} else if (c.type === 'midpoint') {
		if (sketch.points.get(anyC.midId)) add(anyC.midId, 'point');
		const line = sketch.getLineBetween(anyC.p1Id, anyC.p2Id);
		if (line) {
			add(line.id, 'line');
		} else {
			if (sketch.points.get(anyC.p1Id)) add(anyC.p1Id, 'point');
			if (sketch.points.get(anyC.p2Id)) add(anyC.p2Id, 'point');
		}
	} else if (c.type === 'ellipse_axis') {
		if (anyC.ellipseId) {
			if (sketch.ellipses.has(anyC.ellipseId)) add(anyC.ellipseId, 'ellipse');
			else if (sketch.ellipticalArcs.has(anyC.ellipseId)) add(anyC.ellipseId, 'elliptical_arc');
		}
	} else if (c.type === 'elliptical_arc_endpoints') {
		if (anyC.arcId && sketch.ellipticalArcs.has(anyC.arcId)) {
			add(anyC.arcId, 'elliptical_arc');
		}
	} else if (c.type === 'offset') {
		for (const id of c.entityIds) {
			if (sketch.lines.has(id)) add(id, 'line');
			else if (sketch.circles.has(id)) add(id, 'circle');
			else if (sketch.arcs.has(id)) add(id, 'arc');
			else if (sketch.ellipses.has(id)) add(id, 'ellipse');
			else if (sketch.ellipticalArcs.has(id)) add(id, 'elliptical_arc');
			else if (sketch.splines.has(id)) add(id, 'spline');
			else if (sketch.points.has(id)) add(id, 'point');
		}
	} else if (c.type === 'origin_distance') {
		if (anyC.pointId && sketch.points.has(anyC.pointId)) add(anyC.pointId, 'point');
		if (anyC.orientation === 'vertical') {
			add('axis_x', 'line');
		} else if (anyC.orientation === 'horizontal') {
			add('axis_y', 'line');
		} else {
			add('origin', 'point');
		}
	} else if (c.type === 'line_to_axis_distance') {
		if (anyC.lineId && sketch.lines.has(anyC.lineId)) add(anyC.lineId, 'line');
		add(anyC.axis === 'x' ? 'axis_x' : 'axis_y', 'line');
	}

	// Safety net: check if any primitive in the sketch considers this constraint related
	for (const l of sketch.lines.values()) {
		if (sketch.getConstraintsForEntity('line', l.id).some(sc => sc.id === c.id)) add(l.id, 'line');
	}
	for (const circ of sketch.circles.values()) {
		if (sketch.getConstraintsForEntity('circle', circ.id).some(sc => sc.id === c.id)) add(circ.id, 'circle');
	}
	for (const a of sketch.arcs.values()) {
		if (sketch.getConstraintsForEntity('arc', a.id).some(sc => sc.id === c.id)) add(a.id, 'arc');
	}
	for (const el of sketch.ellipses.values()) {
		if (sketch.getConstraintsForEntity('ellipse', el.id).some(sc => sc.id === c.id)) add(el.id, 'ellipse');
	}
	for (const ea of sketch.ellipticalArcs.values()) {
		if (sketch.getConstraintsForEntity('elliptical_arc', ea.id).some(sc => sc.id === c.id))
			add(ea.id, 'elliptical_arc');
	}
	for (const s of sketch.splines.values()) {
		if (sketch.getConstraintsForEntity('spline', s.id).some(sc => sc.id === c.id)) add(s.id, 'spline');
	}
	for (const pt of sketch.points.values()) {
		if (sketch.getConstraintsForEntity('point', pt.id).some(sc => sc.id === c.id)) add(pt.id, 'point');
	}

	return res;
}

// Independent pre-routing construction arithmetic extracted from the editor tools.
import { Vec2, projectPointOntoSegment } from './vector';
import type { ConstructionKernel } from '../kernel/constructionTypes';
const TAU = 2 * Math.PI;
const positiveAngle = (v: number) => (v + TAU) % TAU;
const point = (d: readonly number[], i: number) => new Vec2(d[i], d[i + 1]);
const circleData = (c: { center: Vec2; radius: number } | null) => (c ? [c.center.x, c.center.y, c.radius] : null);
function circumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
	const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
	if (Math.abs(d) < 1e-6) return null;

	const p1Sq = p1.lengthSq();
	const p2Sq = p2.lengthSq();
	const p3Sq = p3.lengthSq();

	const center = new Vec2(
		(p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / d,
		(p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / d
	);
	const radius = center.distanceTo(p1);
	if (!isFinite(radius) || radius < 1e-3 || radius > 1e6) return null;

	return { center, radius };
}

type CircleGeometry = { center: Vec2; radius: number };
type TangentLine = { p: Vec2; n: Vec2 };
function threeLines(lines: TangentLine[]) {
	let best: CircleGeometry | null = null;

	for (const s1 of [-1, 1]) {
		for (const s2 of [-1, 1]) {
			for (const s3 of [-1, 1]) {
				const [a, b, c] = lines;
				const h1 = a.p.dot(a.n);
				const h2 = b.p.dot(b.n);
				const h3 = c.p.dot(c.n);
				const rows = [
					[a.n.x, a.n.y, -s1],
					[b.n.x, b.n.y, -s2],
					[c.n.x, c.n.y, -s3],
				];
				const values = [h1, h2, h3];
				const matrix = rows.map((row, index) => [...row, values[index]]);

				for (let column = 0; column < 3; column++) {
					let pivot = column;
					for (let row = column + 1; row < 3; row++) {
						if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
							pivot = row;
						}
					}

					if (Math.abs(matrix[pivot][column]) < 1e-8) break;
					[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

					const divisor = matrix[column][column];
					for (let j = column; j < 4; j++) matrix[column][j] /= divisor;

					for (let row = 0; row < 3; row++) {
						if (row === column) continue;
						const factor = matrix[row][column];
						for (let j = column; j < 4; j++) {
							matrix[row][j] -= factor * matrix[column][j];
						}
					}
				}

				if (matrix.some((row, index) => Math.abs(row[index]) < 1e-8)) continue;

				const center = new Vec2(matrix[0][3], matrix[1][3]);
				const radius = Math.abs(matrix[2][3]);
				if (radius > 0.01 && (!best || radius < best.radius)) {
					best = { center, radius };
				}
			}
		}
	}

	return best;
}
function circlePreview(points: Vec2[], cursor: Vec2) {
	const circle = circumcircle(points[0], points[1], cursor);
	if (circle) return circle;

	const [a, b] = points;
	const dir = new Vec2().subVectors(b, a);
	const length = dir.length();
	if (length < 1e-8) return null;

	const offset = Math.max(10, length / 2);
	const normal = dir.perpendicular().divideScalar(length);
	const fallbackPoint = new Vec2().midpoint(a, b).addScaledVector(normal, offset);
	return circumcircle(a, b, fallbackPoint);
}
function circleChord(points: Vec2[], diameter: number, cursor: Vec2) {
	const [a, b] = points;
	const dir = new Vec2().subVectors(b, a);
	const chord = dir.length();
	const radius = diameter / 2;
	if (chord < 1e-8 || radius < chord / 2) return null;

	const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
	const midpoint = new Vec2().midpoint(a, b);
	const normal = dir.clone().perpendicular().divideScalar(chord);
	const centerA = midpoint.clone().addScaledVector(normal, h);
	const centerB = midpoint.clone().addScaledVector(normal, -h);
	const center = centerA.distanceTo(cursor) <= centerB.distanceTo(cursor) ? centerA : centerB;

	return { center, radius };
}
function lineIntersection(lineA: TangentLine, lineB: TangentLine, offsetA = 0, offsetB = 0) {
	if (!lineA || !lineB) return null;

	const determinant = lineA.n.cross(lineB.n);
	if (Math.abs(determinant) < 1e-8) return null;

	const h1 = lineA.p.dot(lineA.n) + offsetA;
	const h2 = lineB.p.dot(lineB.n) + offsetB;
	return new Vec2((h1 * lineB.n.y - lineA.n.y * h2) / determinant, (lineA.n.x * h2 - h1 * lineB.n.x) / determinant);
}
function twoTangent(lineA: TangentLine, lineB: TangentLine, cursor: Vec2) {
	const intersection = lineIntersection(lineA, lineB);
	if (!lineA || !lineB || !intersection) return null;

	const candidates = [new Vec2().addVectors(lineA.n, lineB.n), new Vec2().subVectors(lineA.n, lineB.n)].filter(
		vector => vector.length() > 1e-8
	);
	let best: (CircleGeometry & { distance: number }) | null = null;
	const cursorOffset = new Vec2().subVectors(cursor, intersection);

	for (const raw of candidates) {
		const length = raw.length();
		const axis = raw.clone().divideScalar(length);
		const t = cursorOffset.dot(axis);
		const center = intersection.clone().addScaledVector(axis, t);
		const radius = Math.abs(new Vec2().subVectors(center, lineA.p).dot(lineA.n));
		const distance = center.distanceTo(cursor);

		if (radius > 1e-6 && (!best || distance < best.distance)) {
			best = { center, radius, distance };
		}
	}

	return best;
}
function twoLineCenter(lineA: TangentLine, lineB: TangentLine, radius: number, cursor: Vec2) {
	let best: Vec2 | null = null;
	let bestDistance = Infinity;

	for (const signA of [-1, 1]) {
		for (const signB of [-1, 1]) {
			const center = lineIntersection(lineA, lineB, signA * radius, signB * radius);
			if (!center) return null;
			const distance = center.distanceTo(cursor);

			if (distance < bestDistance) {
				best = center;
				bestDistance = distance;
			}
		}
	}

	return best;
}
function slotCenters(p1: Vec2, p2: Vec2, radius: number, mode: number) {
	const v = new Vec2().subVectors(p2, p1);
	const len = v.length();
	const u = len > 1e-4 ? v.clone().divideScalar(len) : new Vec2(1, 0);
	const n = u.clone().perpendicular();

	if (mode === 0) {
		return { c1: p1, c2: p2, u, n, effectiveR: Math.max(0.1, radius) };
	} else if (mode === 1) {
		// p1 is midpoint M, p2 is C1; C2 is 2*M - C1
		const c2 = p1.clone().multiplyScalar(2).sub(p2);
		return { c1: c2, c2: p2, u, n, effectiveR: Math.max(0.1, radius) };
	} else {
		// overall mode: p1 is outer edge E1, p2 is outer edge E2
		const maxR = Math.max(0.1, len / 2 - 0.1);
		const effectiveR = Math.max(0.1, Math.min(radius, maxR));
		const c1 = p1.clone().addScaledVector(u, effectiveR);
		const c2 = p2.clone().addScaledVector(u, -effectiveR);
		return { c1, c2, u, n, effectiveR };
	}
}
function arcSlot(center: Vec2, c1: Vec2, c2: Vec2, rArc: number, sweepSign: number, slotRadius: number) {
	const maxR = Math.max(0.1, rArc - 0.5);
	const effectiveR = Math.max(0.1, Math.min(slotRadius, maxR));

	const theta1 = center.angleToPoint(c1);
	const theta2 = center.angleToPoint(c2);

	const ccwSpan = (((theta2 - theta1) % TAU) + TAU) % TAU;
	const span = sweepSign > 0 ? ccwSpan : (TAU - ccwSpan) % TAU;
	const thetaMid = theta1 + sweepSign * (span * 0.5);

	const r1 = Vec2.fromPolar(1, theta1);
	const r2 = Vec2.fromPolar(1, theta2);
	const rMid = Vec2.fromPolar(1, thetaMid);

	// Unit tangents pointing from C1 toward C2 along the arc
	const t1 = r1.clone().perpendicular().multiplyScalar(sweepSign);
	const t2 = r2.clone().perpendicular().multiplyScalar(sweepSign);

	const p1Outer = center.clone().addScaledVector(r1, rArc + effectiveR);
	const p1Inner = center.clone().addScaledVector(r1, rArc - effectiveR);
	const p2Outer = center.clone().addScaledVector(r2, rArc + effectiveR);
	const p2Inner = center.clone().addScaledVector(r2, rArc - effectiveR);

	const midCenterArc = center.clone().addScaledVector(rMid, rArc);
	const midOuterArc = center.clone().addScaledVector(rMid, rArc + effectiveR);
	const midInnerArc = center.clone().addScaledVector(rMid, rArc - effectiveR);
	const midCap1 = c1.clone().addScaledVector(t1, -effectiveR);
	const midCap2 = c2.clone().addScaledVector(t2, effectiveR);

	return {
		effectiveR,
		p1Inner,
		p1Outer,
		p2Inner,
		p2Outer,
		midCenterArc,
		midOuterArc,
		midInnerArc,
		midCap1,
		midCap2,
	};
}
function sweep(start: number, end: number, clockwise: boolean) {
	const value = (clockwise ? end - start : start - end) % TAU;
	return value < 0 ? value + TAU : value;
}
function screenAngle(center: Vec2, p: Vec2, orientation: number) {
	return Math.atan2((p.y - center.y) * orientation, p.x - center.x);
}
function through(center: Vec2, start: Vec2, end: Vec2, mid: Vec2): boolean {
	const a = center.angleToPoint(start);
	let s = (center.angleToPoint(end) - a) % TAU;
	if (s < 0) s += TAU;
	let t = (center.angleToPoint(mid) - a) % TAU;
	if (t < 0) t += TAU;
	return t > 0 && t < s;
}
function describeTangent(start: Vec2, end: Vec2, tangent: Vec2, center: Vec2, radius: number, orientation: number) {
	const clockwise = new Vec2().subVectors(start, center).cross(tangent) * orientation > 0;
	return [
		center.x,
		center.y,
		radius,
		Number(clockwise),
		sweep(screenAngle(center, start, orientation), screenAngle(center, end, orientation), clockwise),
		end.x,
		end.y,
	];
}
function arcTangent(d: readonly number[]): number[] | null {
	const start = point(d, 0),
		cursor = point(d, 2),
		tangent = point(d, 4),
		normal = tangent.clone().perpendicular();
	const delta = cursor.clone().sub(start),
		length = delta.length(),
		denom = 2 * delta.dot(normal);
	const s = (length * length) / denom,
		naturalRadius = Math.abs(s);
	const natural =
		length < 1e-3 || Math.abs(denom) < 1e-4 || naturalRadius < 0.5 || naturalRadius > 50000
			? null
			: describeTangent(start, cursor, tangent, start.clone().addScaledVector(normal, s), naturalRadius, d[10]);
	if (!d[6] && !d[8]) return natural;
	const angle = d[8] ? d[9] : (natural?.[4] ?? Math.PI / 2);
	const radius = d[6] ? d[7] : (natural?.[2] ?? Math.max(1, length / (2 * Math.sin(angle / 2))));
	const side = delta.dot(normal) < 0 ? -1 : 1;
	const end = start
		.clone()
		.addScaledVector(tangent, radius * Math.sin(angle))
		.addScaledVector(normal, side * radius * (1 - Math.cos(angle)));
	return describeTangent(start, end, tangent, start.clone().addScaledVector(normal, side * radius), radius, d[10]);
}
const construct: ConstructionKernel = (mode, d) => {
	const p = (i: number) => point(d, i);
	const line = (i: number): TangentLine => ({ p: p(i), n: p(i + 2) });
	switch (mode) {
		case 'circumcircle':
			return circleData(circumcircle(p(0), p(2), p(4)));
		case 'circle_preview':
			return circleData(circlePreview([p(0), p(2)], p(4)));
		case 'circle_chord':
			return circleData(circleChord([p(0), p(2)], d[6], p(4)));
		case 'line_intersection': {
			const q = lineIntersection(line(0), line(4), d[8], d[9]);
			return q ? [q.x, q.y] : null;
		}
		case 'circle_two_tangent':
			return circleData(twoTangent(line(0), line(4), p(8)));
		case 'circle_two_tangent_radius': {
			const center = twoLineCenter(line(0), line(4), d[10], p(8));
			return center ? [center.x, center.y, d[10]] : null;
		}
		case 'circle_three_tangent':
			return circleData(threeLines([line(0), line(4), line(8)]));
		case 'arc_three_point': {
			const start = p(0),
				end = p(2),
				cursor = p(4);
			let bulge = cursor;
			if (d[6] || d[8]) {
				const chord = end.clone().sub(start),
					half = start.distanceTo(end) / 2,
					normal = chord
						.clone()
						.perpendicular()
						.divideScalar(2 * half),
					mid = new Vec2().midpoint(start, end);
				const side = cursor.clone().sub(mid).dot(normal) < 0 ? -1 : 1;
				let angle: number;
				if (d[8]) angle = d[9];
				else {
					if (d[7] < half) return null;
					const minor = 2 * Math.asin(half / d[7]);
					angle = start.clone().sub(cursor).dot(end.clone().sub(cursor)) > 0 ? TAU - minor : minor;
				}
				bulge = mid.addScaledVector(normal, side * half * Math.tan(angle / 4));
			}
			const c = circumcircle(start, end, bulge);
			if (!c || c.radius < 1 || c.radius > 50000) return null;
			const a = screenAngle(c.center, start, d[10]),
				cw = positiveAngle(screenAngle(c.center, end, d[10]) - a),
				b = positiveAngle(screenAngle(c.center, bulge, d[10]) - a),
				clockwise = b > 0 && b < cw;
			return [...circleData(c)!, Number(clockwise), clockwise ? cw : TAU - cw];
		}
		case 'arc_tangent':
			return arcTangent(d);
		case 'arc_center': {
			const center = p(0),
				start = p(2),
				cursor = p(4),
				radius = center.distanceTo(start),
				a = screenAngle(center, start, d[8]),
				b = screenAngle(center, cursor, d[8]);
			const delta = positiveAngle(b - a + Math.PI) - Math.PI,
				clockwise = Math.abs(d[6]) >= 0.001 ? d[6] >= 0 : delta >= 0;
			const angle = d[7];
			// A negative sentinel means the angle is unlocked; valid locked angles are nonnegative.
			const span = angle < 0 ? sweep(a, b, clockwise) : angle;
			const worldAngle = angle < 0 ? center.angleToPoint(cursor) : (a + (clockwise ? span : -span)) * d[8];
			const end = center.clone().addScaledVector(Vec2.fromPolar(1, worldAngle), radius);
			return [end.x, end.y, radius, Number(clockwise), span];
		}
		case 'slot_centers': {
			const g = slotCenters(p(0), p(2), d[4], d[5]);
			return [g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.u.x, g.u.y, g.n.x, g.n.y, g.effectiveR];
		}
		case 'slot_outline': {
			const c1 = p(0),
				c2 = p(2),
				n = p(6),
				r = d[8];
			return [
				c1.clone().addScaledVector(n, r),
				c2.clone().addScaledVector(n, r),
				c2.clone().addScaledVector(n, -r),
				c1.clone().addScaledVector(n, -r),
			].flatMap(q => [q.x, q.y]);
		}
		case 'slot_radius': {
			const a = p(0),
				b = p(2),
				cursor = p(4),
				mode = d[6];
			if (mode === 2) {
				const v = b.clone().sub(a),
					len = v.length(),
					u = len > 1e-4 ? v.clone().divideScalar(len) : new Vec2(1, 0),
					n = u.clone().perpendicular(),
					dist = Math.abs(cursor.clone().sub(a).dot(n));
				return [Math.max(0.1, Math.min(dist > 0.1 ? dist : b.distanceTo(cursor), Math.max(0.1, len / 2 - 0.1)))];
			}
			const g = slotCenters(a, b, d[7], mode);
			return [Math.max(0.1, projectPointOntoSegment(cursor, g.c1, g.c2).dist)];
		}
		case 'arc_slot': {
			const g = arcSlot(p(0), p(2), p(4), d[6], d[7], d[8]);
			return [
				g.effectiveR,
				...[
					g.p1Inner,
					g.p1Outer,
					g.p2Inner,
					g.p2Outer,
					g.midCenterArc,
					g.midOuterArc,
					g.midInnerArc,
					g.midCap1,
					g.midCap2,
				].flatMap(q => [q.x, q.y]),
			];
		}
		case 'arc_slot_radius':
			return [Math.max(0.1, Math.min(Math.abs(p(0).distanceTo(p(2)) - d[4]), Math.max(0.1, d[4] - 0.5)))];
		case 'polygon_edge': {
			const start = p(0),
				end = p(2),
				edge = end.clone().sub(start),
				len = start.distanceTo(end),
				half = Math.PI / d[4],
				n = edge.clone().perpendicular().divideScalar(len),
				apothem = len / (2 * Math.tan(half));
			const center = new Vec2().midpoint(start, end).addScaledVector(n, d[5] ? -apothem : apothem);
			return [center.x, center.y, len / (2 * Math.sin(half)), center.angleToPoint(d[5] ? end : start)];
		}
		case 'polygon_vertices': {
			const n = Math.max(3, Math.round(d[3])),
				r = d[5] ? d[2] : d[2] / Math.cos(Math.PI / n),
				a = d[5] ? d[4] : d[4] - Math.PI / n,
				step = TAU / n;
			return Array.from({ length: n }, (_, k) => Vec2.fromPolar(r, a + k * step).add(p(0))).flatMap(q => [q.x, q.y]);
		}
		case 'point_at_distance': {
			const start = p(0),
				v = p(2).sub(start),
				len = v.length(),
				dir = len > d[5] ? v.divideScalar(len) : new Vec2(1, 0),
				q = start.addScaledVector(dir, d[4]);
			return [q.x, q.y];
		}
		case 'arc_through':
			return [Number(through(p(0), p(2), p(4), p(6)))];
	}
};

export const typescriptConstruction: ConstructionKernel = (mode, data) => {
	const out = construct(mode, data);
	return out?.every(Number.isFinite) ? out : null;
};

// Pre-native offset arithmetic, retained for fallback and independent snapshots.
import type { SketchDocument } from '../model/sketch';
import { Vec2 } from './vector';
import { computeNaturalFitHandles, evaluateBezier } from './splineReference';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import {
	getCoincidentPointGroup,
	getPrimitiveEndpoints,
	type ChainItem,
	type OffsetChain,
	type OffsetPrimitiveGeom,
	type OffsetSideGeometry,
	type OffsetGeometryResult,
	type OffsetDirection,
} from './offset';

function sampleChainItemPoints(sketch: SketchDocument, item: ChainItem, numSamples = 16): Vec2[] {
	if (item.type === 'line') {
		const l = sketch.lines.get(item.id);
		if (!l) return [];
		const p1 = sketch.points.get(item.startPointId || l.p1Id);
		const p2 = sketch.points.get(item.endPointId || l.p2Id);
		if (!p1 || !p2) return [];
		return [p1, p2];
	}

	if (item.type === 'circle') {
		const c = sketch.circles.get(item.id);
		if (!c) return [];
		const center = sketch.points.get(c.centerId);
		if (!center) return [];
		const pts: Vec2[] = [];
		for (let i = 0; i < numSamples; i++) {
			const a = (i / numSamples) * Math.PI * 2;
			pts.push(Vec2.fromPolar(c.radius, a).add(center));
		}
		pts.push(pts[0].clone());
		return pts;
	}

	if (item.type === 'ellipse') {
		const el = sketch.ellipses.get(item.id);
		if (!el) return [];
		const center = sketch.points.get(el.centerId);
		const maj = sketch.points.get(el.majorAxisPointId);
		const min = sketch.points.get(el.minorAxisPointId);
		if (!center || !maj || !min) return [];
		const radii = new Vec2(center.distanceTo(maj), center.distanceTo(min));
		const { axisU, axisV } = ellipseAxes(center.angleToPoint(maj));
		const pts: Vec2[] = [];
		for (let i = 0; i < numSamples; i++) {
			const theta = (i / numSamples) * Math.PI * 2;
			pts.push(ellipsePointAtParameter(theta, center, radii, axisU, axisV));
		}
		pts.push(pts[0].clone());
		return pts;
	}

	if (item.type === 'arc') {
		const arc = sketch.arcs.get(item.id);
		if (!arc) return [];
		const center = sketch.points.get(arc.centerId);
		const pStart = sketch.points.get(item.startPointId || arc.startPointId);
		const pEnd = sketch.points.get(item.endPointId || arc.endPointId);
		if (!center || !pStart || !pEnd) return [];

		const aStart = center.angleToPoint(pStart);
		const aEnd = center.angleToPoint(pEnd);
		const isReversed = item.startPointId === arc.endPointId;
		const effectiveClockwise = isReversed ? !arc.clockwise : !!arc.clockwise;

		let sweep = effectiveClockwise ? aStart - aEnd : aEnd - aStart;
		while (sweep < 0) sweep += Math.PI * 2;

		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const ang = effectiveClockwise ? aStart - t * sweep : aStart + t * sweep;
			pts.push(Vec2.fromPolar(arc.radius, ang).add(center));
		}
		return pts;
	}

	if (item.type === 'spline') {
		const s = sketch.splines.get(item.id);
		if (!s || s.pointIds.length < 2) return [];
		const geo = s.toGeoCurve(sketch);
		if (!geo || !geo.bezierSegments || geo.bezierSegments.length === 0) return [];
		const beziers = geo.bezierSegments;
		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const totalT = t * beziers.length;
			const segIdx = Math.min(Math.floor(totalT), beziers.length - 1);
			const localT = totalT - segIdx;
			pts.push(evaluateBezier(beziers[segIdx], localT));
		}
		const isReversed =
			item.reversed ||
			(item.startPointId
				? getCoincidentPointGroup(sketch, item.startPointId).has(s.pointIds[s.pointIds.length - 1])
				: false);
		if (isReversed) pts.reverse();
		return pts;
	}

	if (item.type === 'elliptical_arc') {
		const ea = sketch.ellipticalArcs.get(item.id);
		if (!ea) return [];
		const center = sketch.points.get(ea.centerId);
		const maj = sketch.points.get(ea.majorAxisPointId);
		const min = sketch.points.get(ea.minorAxisPointId);
		const pStart = sketch.points.get(item.startPointId || ea.startPointId);
		const pEnd = sketch.points.get(item.endPointId || ea.endPointId);
		if (!center || !maj || !min || !pStart || !pEnd) return [];
		const radii = new Vec2(center.distanceTo(maj), center.distanceTo(min));
		const { axisU, axisV } = ellipseAxes(center.angleToPoint(maj));
		const tStart = ellipseParameterAtPoint(pStart, center, radii, axisU, axisV);
		const tEnd = ellipseParameterAtPoint(pEnd, center, radii, axisU, axisV);
		const isReversed = item.startPointId === ea.endPointId;
		const effectiveClockwise = isReversed ? !ea.clockwise : !!ea.clockwise;

		let sweep = effectiveClockwise ? tStart - tEnd : tEnd - tStart;
		while (sweep < 0) sweep += Math.PI * 2;

		const pts: Vec2[] = [];
		for (let i = 0; i <= numSamples; i++) {
			const t = i / numSamples;
			const ang = effectiveClockwise ? tStart - t * sweep : tStart + t * sweep;
			pts.push(ellipsePointAtParameter(ang, center, radii, axisU, axisV));
		}
		return pts;
	}

	return [];
}

/**
 * Calculates 2D line intersection between infinite lines p1 + t*d1 and p2 + s*d2.
 */
export function intersectLines2D(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
	const determinant = d1.cross(d2);
	if (Math.abs(determinant) < 1e-7) return null;
	const dir = new Vec2().subVectors(p2, p1);
	const t = dir.cross(d2) / determinant;
	return p1.clone().addScaledVector(d1, t);
}

/**
 * Determines outward normal direction for closed chain using signed area.
 * For CCW: left normal is inward, right normal is outward.
 * For CW: left normal is outward, right normal is inward.
 */
function isPolygonCounterClockwise(pts: Vec2[]): boolean {
	let area = 0;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area += pts[i].cross(pts[j]);
	}
	return area > 0;
}

/**
 * Checks whether point `pt` is strictly inside the closed polygon `poly` using ray-casting.
 */
function isPointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
	let inside = false;
	const n = poly.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i].x,
			yi = poly[i].y;
		const xj = poly[j].x,
			yj = poly[j].y;
		const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * Computes offset geometry for a single signed distance displacement along the chain.
 */
function computeSingleOffsetSide(
	sketch: SketchDocument,
	chain: OffsetChain,
	signedDistance: number
): OffsetSideGeometry {
	const primitives: OffsetPrimitiveGeom[] = [];
	const n = chain.items.length;
	if (n === 0) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

	// 1. Single closed circle
	if (n === 1 && chain.items[0].type === 'circle') {
		const c = sketch.circles.get(chain.items[0].id);
		const center = c ? sketch.points.get(c.centerId) : null;
		if (!c || !center) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
		const newR = c.radius + signedDistance;
		if (newR <= 0.1) {
			return {
				primitives: [],
				side: 1,
				distance: signedDistance,
				isValid: false,
				errorMessage: 'Offset distance exceeds circle radius',
			};
		}
		return {
			primitives: [
				{
					sourceId: c.id,
					type: 'circle',
					circleCenter: center.clone(),
					circleRadius: newR,
				},
			],
			side: Math.sign(signedDistance) || 1,
			distance: Math.abs(signedDistance),
			isValid: true,
		};
	}

	// 2. Single closed ellipse
	if (n === 1 && chain.items[0].type === 'ellipse') {
		const el = sketch.ellipses.get(chain.items[0].id);
		const center = el ? sketch.points.get(el.centerId) : null;
		const maj = el ? sketch.points.get(el.majorAxisPointId) : null;
		const min = el ? sketch.points.get(el.minorAxisPointId) : null;
		if (!el || !center || !maj || !min) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
		const a = center.distanceTo(maj);
		const b = center.distanceTo(min);
		const { axisU, axisV } = ellipseAxes(center.angleToPoint(maj));
		const radii = new Vec2(a, b);

		const samples = 24;
		const fitPts: Vec2[] = [];
		for (let i = 0; i < samples; i++) {
			const theta = (i / samples) * Math.PI * 2;
			const p = ellipsePointAtParameter(theta, center, radii, axisU, axisV);
			// Tangent
			const tangent = axisU
				.clone()
				.multiplyScalar(-a * Math.sin(theta))
				.addScaledVector(axisV, b * Math.cos(theta));
			const normal = tangent.normalizeOrUnitX().perpendicular().negate();
			// Outward normal: points away from center
			if (p.clone().add(normal).distanceToSquared(center) < p.distanceToSquared(center)) {
				normal.negate();
			}
			fitPts.push(p.addScaledVector(normal, signedDistance));
		}
		fitPts.push(fitPts[0].clone());

		return {
			primitives: [
				{
					sourceId: el.id,
					type: 'spline',
					fitPoints: fitPts,
					isSplineClosed: true,
				},
			],
			side: Math.sign(signedDistance) || 1,
			distance: Math.abs(signedDistance),
			isValid: true,
		};
	}

	// 3. Multi-primitive or general open/closed chain
	// Determine normal direction:
	// For closed chain: calculate signed area to know if CCW or CW
	let isCCW = true;
	if (chain.isClosed) {
		const poly: Vec2[] = [];
		for (const it of chain.items) {
			const pts = sampleChainItemPoints(sketch, it, 4);
			for (let i = 0; i < pts.length - 1; i++) poly.push(pts[i]);
		}
		isCCW = isPolygonCounterClockwise(poly);
	}

	// For each item, compute unjoined raw offset geometry
	interface RawOffsetItem {
		sourceId: string;
		type: 'line' | 'arc' | 'spline';
		// For line
		p1?: Vec2;
		p2?: Vec2;
		dir?: Vec2;
		// For arc
		center?: Vec2;
		start?: Vec2;
		end?: Vec2;
		radius?: number;
		clockwise?: boolean;
		// For spline / sampled
		fitPoints?: Vec2[];
		fitBases?: Vec2[];
		fitNormals?: Vec2[];
		startTangent?: Vec2;
		endTangent?: Vec2;
		handles?: Array<{ h1: Vec2; h2: Vec2 }>;
	}

	const rawItems: RawOffsetItem[] = [];

	for (let i = 0; i < n; i++) {
		const item = chain.items[i];

		if (item.type === 'line') {
			const l = sketch.lines.get(item.id);
			if (!l) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
			const p1 = sketch.points.get(item.startPointId || l.p1Id);
			const p2 = sketch.points.get(item.endPointId || l.p2Id);
			if (!p1 || !p2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const dir = new Vec2().subVectors(p2, p1);
			const uT = dir.clone().normalizeOrUnitX();

			// Left normal is (-uT.y, uT.x). Right normal is (uT.y, -uT.x)
			// For closed CCW: outward is right normal (uT.y, -uT.x).
			// For closed CW: outward is left normal (-uT.y, uT.x).
			// For open chain: default outward/positive is left normal (-uT.y, uT.x).
			let norm: Vec2;
			if (chain.isClosed) {
				norm = isCCW ? uT.clone().perpendicular().negate() : uT.clone().perpendicular();
			} else {
				norm = uT.clone().perpendicular();
			}

			const offP1 = p1.clone().addScaledVector(norm, signedDistance);
			const offP2 = p2.clone().addScaledVector(norm, signedDistance);

			rawItems.push({
				sourceId: l.id,
				type: 'line',
				p1: offP1,
				p2: offP2,
				dir: uT,
			});
		} else if (item.type === 'arc') {
			const arc = sketch.arcs.get(item.id);
			if (!arc) return { primitives: [], side: 1, distance: signedDistance, isValid: false };
			const center = sketch.points.get(arc.centerId);
			const p1 = sketch.points.get(item.startPointId || arc.startPointId);
			const p2 = sketch.points.get(item.endPointId || arc.endPointId);
			if (!center || !p1 || !p2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const midSample = sampleChainItemPoints(sketch, item, 4)[2] || p1;
			const toMid = new Vec2().subVectors(midSample, center).normalizeOrUnitX();

			// Check if chain normal at mid points radially away from center
			const uT = new Vec2().subVectors(p2, p1).normalizeOrUnitX();
			let chainNorm: Vec2;
			if (chain.isClosed) {
				chainNorm = isCCW ? uT.clone().perpendicular().negate() : uT.clone().perpendicular();
			} else {
				chainNorm = uT.clone().perpendicular();
			}

			const radiallyOutward = chainNorm.dot(toMid) >= 0;
			const rDelta = radiallyOutward ? signedDistance : -signedDistance;
			const newR = arc.radius + rDelta;

			if (newR <= 0.1) {
				return {
					primitives: [],
					side: 1,
					distance: signedDistance,
					isValid: false,
					errorMessage: 'Offset collapses arc radius',
				};
			}

			const sRad1 = new Vec2().subVectors(p1, center).normalizeOrUnitX();
			const sRad2 = new Vec2().subVectors(p2, center).normalizeOrUnitX();

			const offP1 = center.clone().addScaledVector(sRad1, newR);
			const offP2 = center.clone().addScaledVector(sRad2, newR);

			const isReversed = item.startPointId === arc.endPointId;
			const effectiveClockwise = isReversed ? !arc.clockwise : !!arc.clockwise;

			rawItems.push({
				sourceId: arc.id,
				type: 'arc',
				center: center.clone(),
				start: offP1,
				end: offP2,
				radius: newR,
				clockwise: effectiveClockwise,
			});
		} else {
			// Spline or Elliptical Arc: sample points and offset along normals
			const samples = sampleChainItemPoints(sketch, item, 16);
			if (samples.length < 2) return { primitives: [], side: 1, distance: signedDistance, isValid: false };

			const offSamples: Vec2[] = [];
			const splineBases: Vec2[] = [];
			const splineNormals: Vec2[] = [];
			for (let k = 0; k < samples.length; k++) {
				const prev = samples[Math.max(0, k - 1)];
				const next = samples[Math.min(samples.length - 1, k + 1)];
				const uT = new Vec2().subVectors(next, prev).normalizeOrUnitX();
				let norm: Vec2;
				if (chain.isClosed) {
					norm = isCCW ? uT.clone().perpendicular().negate() : uT.clone().perpendicular();
				} else {
					norm = uT.clone().perpendicular();
				}
				splineBases.push(samples[k]);
				splineNormals.push(norm);
				offSamples.push(samples[k].clone().addScaledVector(norm, signedDistance));
			}

			// Compute exact endpoint tangents for spline
			let startTangent = new Vec2().subVectors(offSamples[1], offSamples[0]).normalizeOrUnitX();
			let endTangent = new Vec2()
				.subVectors(offSamples[offSamples.length - 1], offSamples[offSamples.length - 2])
				.normalizeOrUnitX();

			const s = sketch.splines.get(item.id);
			if (s && s.pointIds.length >= 2) {
				const geo = s.toGeoCurve(sketch);
				if (geo && geo.bezierSegments.length > 0) {
					const beziers = geo.bezierSegments;
					const ep = getPrimitiveEndpoints(sketch, item.type, item.id);
					const isReversed =
						item.reversed ||
						(ep && item.startPointId ? getCoincidentPointGroup(sketch, item.startPointId).has(ep.p2Id) : false);
					if (!isReversed) {
						startTangent = new Vec2().subVectors(beziers[0][1], beziers[0][0]).normalizeOrUnitX();
						endTangent = new Vec2()
							.subVectors(beziers[beziers.length - 1][3], beziers[beziers.length - 1][2])
							.normalizeOrUnitX();
					} else {
						startTangent = new Vec2()
							.subVectors(beziers[beziers.length - 1][2], beziers[beziers.length - 1][3])
							.normalizeOrUnitX();
						endTangent = new Vec2().subVectors(beziers[0][0], beziers[0][1]).normalizeOrUnitX();
					}
				}
			}

			const startNorm = chain.isClosed
				? isCCW
					? startTangent.clone().perpendicular().negate()
					: startTangent.clone().perpendicular()
				: startTangent.clone().perpendicular();
			const endNorm = chain.isClosed
				? isCCW
					? endTangent.clone().perpendicular().negate()
					: endTangent.clone().perpendicular()
				: endTangent.clone().perpendicular();
			splineNormals[0] = startNorm;
			splineNormals[splineNormals.length - 1] = endNorm;
			offSamples[0] = samples[0].clone().addScaledVector(startNorm, signedDistance);
			offSamples[offSamples.length - 1] = samples[samples.length - 1].clone().addScaledVector(endNorm, signedDistance);

			rawItems.push({
				sourceId: item.id,
				type: 'spline',
				fitPoints: offSamples,
				fitBases: splineBases,
				fitNormals: splineNormals,
				startTangent,
				endTangent,
			});
		}
	}

	// 4. Corner Trimming / Extension
	// For each consecutive pair (i, nextIdx), find intersection of the two offset geometries
	const cornerCount = chain.isClosed ? n : n - 1;
	for (let i = 0; i < cornerCount; i++) {
		const nextIdx = (i + 1) % n;
		const cur = rawItems[i];
		const next = rawItems[nextIdx];

		if (cur.type === 'line' && next.type === 'line') {
			const inter = intersectLines2D(cur.p1!, cur.dir!, next.p1!, next.dir!);
			if (inter) {
				cur.p2 = inter;
				next.p1 = inter;
			}
		} else if (cur.type === 'line' && next.type === 'arc') {
			// Line meeting Arc: intersect line with arc circle
			const c = next.center!;
			const r = next.radius!;
			const p1 = cur.p1!;
			const d = cur.dir!;
			// Project c onto line
			const tProj = new Vec2().subVectors(c, p1).dot(d);
			const perpDistSq = (p1.x + tProj * d.x - c.x) ** 2 + (p1.y + tProj * d.y - c.y) ** 2;
			if (perpDistSq <= r * r) {
				const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
				const i1 = p1.clone().addScaledVector(d, tProj - dt);
				const i2 = p1.clone().addScaledVector(d, tProj + dt);
				const best = i1.distanceTo(cur.p2!) < i2.distanceTo(cur.p2!) ? i1 : i2;
				cur.p2 = best;
				next.start = best;
			}
		} else if (cur.type === 'arc' && next.type === 'line') {
			const c = cur.center!;
			const r = cur.radius!;
			const p1 = next.p1!;
			const d = next.dir!;
			const tProj = new Vec2().subVectors(c, p1).dot(d);
			const perpDistSq = (p1.x + tProj * d.x - c.x) ** 2 + (p1.y + tProj * d.y - c.y) ** 2;
			if (perpDistSq <= r * r) {
				const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
				const i1 = p1.clone().addScaledVector(d, tProj - dt);
				const i2 = p1.clone().addScaledVector(d, tProj + dt);
				const best = i1.distanceTo(cur.end!) < i2.distanceTo(cur.end!) ? i1 : i2;
				cur.end = best;
				next.p1 = best;
			}
		} else if (cur.type === 'line' && next.type === 'spline') {
			// Line meeting Spline: intersect Line ray with Spline start tangent ray
			const pLine = cur.p1!;
			const dLine = cur.dir!;
			const spPts = next.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[0];
				const dSp = next.startTangent || new Vec2().subVectors(spPts[1], spPts[0]).normalizeOrUnitX();
				const inter = intersectLines2D(pLine, dLine, pSp, dSp);
				if (inter && inter.distanceTo(cur.p2!) <= 4 * Math.abs(signedDistance)) {
					cur.p2 = inter;
					spPts[0] = inter;
					joined = true;
				}
			}
			if (!joined) {
				const avg = new Vec2().midpoint(cur.p2!, spPts[0]);
				cur.p2 = avg;
				spPts[0] = avg;
			}
		} else if (cur.type === 'spline' && next.type === 'line') {
			// Spline meeting Line: intersect Spline end tangent ray with Line ray
			const spPts = cur.fitPoints!;
			const pLine = next.p1!;
			const dLine = next.dir!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[spPts.length - 1];
				const dSp = cur.endTangent || new Vec2().subVectors(pSp, spPts[spPts.length - 2]).normalizeOrUnitX();
				const inter = intersectLines2D(pLine, dLine, pSp, dSp);
				if (inter && inter.distanceTo(next.p1!) <= 4 * Math.abs(signedDistance)) {
					spPts[spPts.length - 1] = inter;
					next.p1 = inter;
					joined = true;
				}
			}
			if (!joined) {
				const avg = new Vec2().midpoint(spPts[spPts.length - 1], next.p1!);
				spPts[spPts.length - 1] = avg;
				next.p1 = avg;
			}
		} else if (cur.type === 'arc' && next.type === 'spline') {
			// Arc meeting Spline: intersect Arc circle with Spline start tangent ray
			const c = cur.center!;
			const r = cur.radius!;
			const spPts = next.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[0];
				const dSp = next.startTangent || new Vec2().subVectors(spPts[1], spPts[0]).normalizeOrUnitX();
				const tProj = new Vec2().subVectors(c, pSp).dot(dSp);
				const perpDistSq = (pSp.x + tProj * dSp.x - c.x) ** 2 + (pSp.y + tProj * dSp.y - c.y) ** 2;
				if (perpDistSq <= r * r) {
					const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
					const i1 = pSp.clone().addScaledVector(dSp, tProj - dt);
					const i2 = pSp.clone().addScaledVector(dSp, tProj + dt);
					const best = i1.distanceTo(cur.end!) < i2.distanceTo(cur.end!) ? i1 : i2;
					cur.end = best;
					spPts[0] = best;
					joined = true;
				}
			}
			if (!joined) {
				const avg = new Vec2().midpoint(cur.end!, spPts[0]);
				cur.end = avg;
				spPts[0] = avg;
			}
		} else if (cur.type === 'spline' && next.type === 'arc') {
			// Spline meeting Arc: intersect Arc circle with Spline end tangent ray
			const c = next.center!;
			const r = next.radius!;
			const spPts = cur.fitPoints!;
			let joined = false;
			if (spPts.length >= 2) {
				const pSp = spPts[spPts.length - 1];
				const dSp = cur.endTangent || new Vec2().subVectors(pSp, spPts[spPts.length - 2]).normalizeOrUnitX();
				const tProj = new Vec2().subVectors(c, pSp).dot(dSp);
				const perpDistSq = (pSp.x + tProj * dSp.x - c.x) ** 2 + (pSp.y + tProj * dSp.y - c.y) ** 2;
				if (perpDistSq <= r * r) {
					const dt = Math.sqrt(Math.max(0, r * r - perpDistSq));
					const i1 = pSp.clone().addScaledVector(dSp, tProj - dt);
					const i2 = pSp.clone().addScaledVector(dSp, tProj + dt);
					const best = i1.distanceTo(next.start!) < i2.distanceTo(next.start!) ? i1 : i2;
					spPts[spPts.length - 1] = best;
					next.start = best;
					joined = true;
				}
			}
			if (!joined) {
				const avg = new Vec2().midpoint(spPts[spPts.length - 1], next.start!);
				spPts[spPts.length - 1] = avg;
				next.start = avg;
			}
		} else {
			// Spline-Spline or other: connect endpoints to meet at their average
			const pCurEnd =
				cur.type === 'line' ? cur.p2! : cur.type === 'arc' ? cur.end! : cur.fitPoints![cur.fitPoints!.length - 1];
			const pNextStart = next.type === 'line' ? next.p1! : next.type === 'arc' ? next.start! : next.fitPoints![0];
			const avg = new Vec2().midpoint(pCurEnd, pNextStart);

			if (cur.type === 'line') cur.p2 = avg;
			else if (cur.type === 'arc') cur.end = avg;
			else cur.fitPoints![cur.fitPoints!.length - 1] = avg;

			if (next.type === 'line') next.p1 = avg;
			else if (next.type === 'arc') next.start = avg;
			else next.fitPoints![0] = avg;
		}
	}

	// Compute handles with true endpoint tangents for splines
	for (const raw of rawItems) {
		if (raw.type === 'spline' && raw.fitPoints && raw.fitPoints.length >= 2) {
			const pts = raw.fitPoints;
			const count = pts.length - 1;
			const handles = computeNaturalFitHandles(pts);
			if (raw.startTangent && handles[0]) {
				const d0 = pts[0].distanceTo(pts[1]) / 3;
				handles[0] = {
					h1: pts[0].clone().addScaledVector(raw.startTangent, -d0),
					h2: pts[0].clone().addScaledVector(raw.startTangent, d0),
				};
			}
			if (raw.endTangent && handles[count]) {
				const dn = pts[count - 1].distanceTo(pts[count]) / 3;
				handles[count] = {
					h1: pts[count].clone().addScaledVector(raw.endTangent, -dn),
					h2: pts[count].clone().addScaledVector(raw.endTangent, dn),
				};
			}
			raw.handles = handles;
		}
	}

	// Build output primitive geoms
	for (const raw of rawItems) {
		if (raw.type === 'line') {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'line',
				p1: raw.p1,
				p2: raw.p2,
			});
		} else if (raw.type === 'arc') {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'arc',
				center: raw.center,
				start: raw.start,
				end: raw.end,
				radius: raw.radius,
				clockwise: raw.clockwise,
			});
		} else {
			primitives.push({
				sourceId: raw.sourceId,
				type: 'spline',
				fitPoints: raw.fitPoints,
				fitBases: raw.fitBases,
				fitNormals: raw.fitNormals,
				startTangent: raw.startTangent,
				endTangent: raw.endTangent,
				handles: raw.handles,
				isSplineClosed: false,
			});
		}
	}

	return {
		primitives,
		side: Math.sign(signedDistance) || 1,
		distance: Math.abs(signedDistance),
		isValid: true,
	};
}

/**
 * Calculates complete offset geometry for all required sides according to `direction`.
 */
export function calculateOffsetGeometry(
	sketch: SketchDocument,
	chain: OffsetChain,
	direction: OffsetDirection,
	dist1: number,
	dist2: number,
	flip: boolean
): OffsetGeometryResult {
	if (!chain || chain.items.length === 0) {
		return {
			sides: [],
			gizmoAnchor: new Vec2(0, 0),
			gizmoNormal: new Vec2(1, 0),
			isValid: false,
			errorMessage: 'No primitives selected in chain',
		};
	}

	// 1. Calculate gizmo anchor and normal at the exact middle of the first selected primitive
	const refId = chain.firstSelectedId || chain.items[0]?.id;
	const refItem = chain.items.find(it => it.id === refId) || chain.items[0];
	let gizmoAnchor: Vec2 = new Vec2(0, 0);
	let gizmoNormal: Vec2 = new Vec2(0, 1);

	// Sample poly for inside/outside orientation test if chain is closed
	const poly: Vec2[] = [];
	if (chain.isClosed) {
		for (const it of chain.items) {
			const pts = sampleChainItemPoints(sketch, it, 16);
			for (let i = 0; i < pts.length - 1; i++) poly.push(pts[i]);
		}
	}

	if (refItem.type === 'line') {
		const l = sketch.lines.get(refItem.id);
		const p1 = l ? sketch.points.get(refItem.startPointId || l.p1Id) : null;
		const p2 = l ? sketch.points.get(refItem.endPointId || l.p2Id) : null;
		if (l && p1 && p2) {
			// Exact middle of the first selected line
			gizmoAnchor = new Vec2().midpoint(p1, p2);
			const uT = new Vec2().subVectors(p2, p1).normalizeOrUnitX();
			// Normal candidate (left of line direction)
			gizmoNormal = uT.clone().perpendicular();
			if (chain.isClosed && poly.length >= 3) {
				const testPt = gizmoAnchor.clone().addScaledVector(gizmoNormal, 0.5);
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = gizmoNormal.clone().negate();
				}
			}
		}
	} else if (refItem.type === 'arc') {
		const arc = sketch.arcs.get(refItem.id);
		const center = arc ? sketch.points.get(arc.centerId) : null;
		const p1 = arc ? sketch.points.get(refItem.startPointId || arc.startPointId) : null;
		const p2 = arc ? sketch.points.get(refItem.endPointId || arc.endPointId) : null;
		if (arc && center && p1 && p2) {
			const a1 = center.angleToPoint(p1);
			const a2 = center.angleToPoint(p2);
			let sweep = arc.clockwise ? a1 - a2 : a2 - a1;
			while (sweep < 0) sweep += 2 * Math.PI;
			while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
			const midAngle = arc.clockwise ? a1 - sweep / 2 : a1 + sweep / 2;

			// Exact middle of the arc along its curve
			gizmoAnchor = Vec2.fromPolar(arc.radius, midAngle).add(center);
			gizmoNormal = Vec2.fromPolar(1, midAngle);
			if (chain.isClosed && poly.length >= 3) {
				const testPt = gizmoAnchor.clone().addScaledVector(gizmoNormal, 0.5);
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = gizmoNormal.clone().negate();
				}
			}
		}
	} else if (refItem.type === 'circle') {
		const c = sketch.circles.get(refItem.id);
		const center = c ? sketch.points.get(c.centerId) : null;
		if (c && center) {
			gizmoAnchor = new Vec2(center.x + c.radius, center.y);
			gizmoNormal = new Vec2(1, 0);
		}
	} else if (refItem.type === 'ellipse') {
		const el = sketch.ellipses.get(refItem.id);
		const center = el ? sketch.points.get(el.centerId) : null;
		const maj = el ? sketch.points.get(el.majorAxisPointId) : null;
		if (el && center && maj) {
			gizmoAnchor = maj.clone();
			gizmoNormal = new Vec2().subVectors(maj, center).normalizeOrUnitX();
		}
	} else if (refItem.type === 'spline') {
		const splinePts = sampleChainItemPoints(sketch, refItem, 64);
		if (splinePts.length >= 2) {
			const midIdx = Math.floor(splinePts.length / 2);
			gizmoAnchor = splinePts[midIdx];
			const pPrev = splinePts[Math.max(0, midIdx - 1)];
			const pNext = splinePts[Math.min(splinePts.length - 1, midIdx + 1)];
			const uT = new Vec2().subVectors(pNext, pPrev).normalizeOrUnitX();
			gizmoNormal = uT.clone().perpendicular();
			if (chain.isClosed && poly.length >= 3) {
				const testPt = gizmoAnchor.clone().addScaledVector(gizmoNormal, 0.5);
				if (isPointInPolygon(testPt, poly)) {
					gizmoNormal = gizmoNormal.clone().negate();
				}
			}
		}
	}

	// 2. Compute sides
	const sides: OffsetSideGeometry[] = [];

	if (direction === 'one_side') {
		const sign = flip ? -1 : 1;
		const s1 = computeSingleOffsetSide(sketch, chain, sign * dist1);
		sides.push(s1);
	} else if (direction === 'two_sides') {
		const s1 = computeSingleOffsetSide(sketch, chain, !flip ? dist1 : -dist1);
		const s2 = computeSingleOffsetSide(sketch, chain, !flip ? -dist2 : dist2);
		sides.push(s1, s2);
	} else if (direction === 'symmetric') {
		const s1 = computeSingleOffsetSide(sketch, chain, dist1);
		const s2 = computeSingleOffsetSide(sketch, chain, -dist1);
		sides.push(s1, s2);
	}

	const allValid = sides.length > 0 && sides.every(s => s.isValid);
	const errorMsg = sides.find(s => !s.isValid)?.errorMessage;

	return {
		sides,
		gizmoAnchor,
		gizmoNormal,
		isValid: allValid,
		errorMessage: errorMsg,
	};
}

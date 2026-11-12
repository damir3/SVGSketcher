// Frozen trim calculation before native routing. Document mutation stays in intersection.ts.
import { Vec2 } from './vector';
import {
	getParamAtPoint,
	getPointAtParam,
	intersectCurvePairs,
	type GeoCurve,
	type CurveIntersection,
	type TrimCandidate,
} from './intersection';
const TWO_PI = 2 * Math.PI;

export function getCurveIntersections(target: GeoCurve, allCurves: GeoCurve[]): CurveIntersection[] {
	const results: CurveIntersection[] = [];

	const others = allCurves.filter(other => other.id !== target.id);
	const intersections = intersectCurvePairs(others.map(other => [target, other]));
	for (const [index, other] of others.entries()) {
		const pts = intersections[index];
		for (const pt of pts) {
			const param = getParamAtPoint(target, pt);
			// For open curves (segment, arc, elliptical_arc, open spline), ignore intersections right at the endpoints
			if (
				target.type === 'segment' ||
				target.type === 'arc' ||
				target.type === 'elliptical_arc' ||
				(target.type === 'spline' && !target.isClosed)
			) {
				if (param < 1e-4 || param > 1 - 1e-4) {
					continue;
				}
			}
			results.push({
				point: pt,
				param,
				cuttingCurveId: other.id,
				cuttingCurveType: other.type,
			});
		}
	}

	// Sort and deduplicate by param
	results.sort((a, b) => a.param - b.param);
	const unique: CurveIntersection[] = [];
	for (const item of results) {
		const eps = target.type === 'circle' || target.type === 'ellipse' ? 1e-3 : 1e-4;
		const exists = unique.some(u => Math.abs(u.param - item.param) < eps);
		if (!exists) {
			unique.push(item);
		}
	}

	return unique;
}

/**
 * Computes the TrimCandidate (the exact segment containing `cursorWorldPos` to be removed).
 */
export function getTrimCandidate(target: GeoCurve, allCurves: GeoCurve[], cursorWorldPos: Vec2): TrimCandidate | null {
	const intersections = getCurveIntersections(target, allCurves);
	const cursorParam = getParamAtPoint(target, cursorWorldPos);

	const isClosedCurve =
		target.type === 'circle' ||
		target.type === 'ellipse' ||
		(target.type === 'spline' && target.splineType !== 'control' && !!target.isClosed);

	if (!isClosedCurve) {
		// Open curves: domain [0, 1]
		if (intersections.length === 0) {
			// Entire curve will be removed
			return {
				curve: target,
				interval: [0, 1],
				cutStartWorld: getPointAtParam(target, 0),
				cutEndWorld: getPointAtParam(target, 1),
				isWholeEntity: true,
			};
		}

		// Partition into intervals between [0, p1, p2, ..., 1]
		const params = [0, ...intersections.map(i => i.param), 1];
		for (let i = 0; i < params.length - 1; i++) {
			const pA = params[i];
			const pB = params[i + 1];
			if (cursorParam >= pA - 1e-5 && cursorParam <= pB + 1e-5) {
				const startCut = i > 0 ? intersections[i - 1] : undefined;
				const endCut = i < intersections.length ? intersections[i] : undefined;
				return {
					curve: target,
					interval: [pA, pB],
					cutStartWorld: getPointAtParam(target, pA),
					cutEndWorld: getPointAtParam(target, pB),
					startCuttingCurveId: startCut?.cuttingCurveId,
					startCuttingCurveType: startCut?.cuttingCurveType,
					endCuttingCurveId: endCut?.cuttingCurveId,
					endCuttingCurveType: endCut?.cuttingCurveType,
					isWholeEntity: false,
				};
			}
		}

		// Fallback to nearest interval
		const fallbackEnd = intersections[0];
		return {
			curve: target,
			interval: [0, params[1]],
			cutStartWorld: getPointAtParam(target, 0),
			cutEndWorld: getPointAtParam(target, params[1]),
			endCuttingCurveId: fallbackEnd?.cuttingCurveId,
			endCuttingCurveType: fallbackEnd?.cuttingCurveType,
			isWholeEntity: false,
		};
	}

	// Closed curves (Circle, Ellipse, Closed Spline):
	const period = target.type === 'circle' || target.type === 'ellipse' ? TWO_PI : 1.0;

	if (intersections.length < 2) {
		// As requested: closed curves with < 2 intersections are completely deleted!
		return {
			curve: target,
			interval: [0, period],
			cutStartWorld: getPointAtParam(target, 0),
			cutEndWorld: getPointAtParam(target, period),
			isWholeEntity: true,
		};
	}

	// For >= 2 intersections on closed curve:
	// Cyclic intervals: [p0, p1], [p1, p2], ..., [pn-1, p0] (wrapping)
	const thetas = intersections.map(i => i.param);
	const n = thetas.length;

	let chosenIdxA = n - 1;
	let chosenIdxB = 0;

	let found = false;
	for (let i = 0; i < n - 1; i++) {
		if (cursorParam >= thetas[i] - 1e-5 && cursorParam <= thetas[i + 1] + 1e-5) {
			chosenIdxA = i;
			chosenIdxB = i + 1;
			found = true;
			break;
		}
	}
	if (!found) {
		chosenIdxA = n - 1;
		chosenIdxB = 0;
	}

	const cutA = intersections[chosenIdxA];
	const cutB = intersections[chosenIdxB];

	return {
		curve: target,
		interval: [cutA.param, cutB.param],
		cutStartWorld: getPointAtParam(target, cutA.param),
		cutEndWorld: getPointAtParam(target, cutB.param),
		startCuttingCurveId: cutA.cuttingCurveId,
		startCuttingCurveType: cutA.cuttingCurveType,
		endCuttingCurveId: cutB.cuttingCurveId,
		endCuttingCurveType: cutB.cuttingCurveType,
		isWholeEntity: false,
	};
}

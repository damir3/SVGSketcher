// Independent 64-step golden-section scalar minimizer used to refine pre-API-27
// spline cut parameters stored in test/fixtures/kernelEditing.json.
import {
	evaluateBezier,
	getSplineParamAtPoint,
	getSplinePointAtParam,
	type BezierSegment,
} from '../../src/math/spline';
import type { CurveIntersection, GeoSpline, TrimCandidate } from '../../src/math/intersection';
import { Vec2 } from '../../src/math/vector';
import type { Point2 } from '../../src/kernel/types';

export function refineSplineParameter(segments: readonly BezierSegment[], point: Point2): number {
	if (!segments.length) return 0;
	const target = Vec2.from(point);
	const value = getSplineParamAtPoint([...segments], target).param * segments.length;
	const i = Math.min(Math.floor(value), segments.length - 1);
	const curve = segments[i];
	let a = Math.max(0, value - i - 0.05);
	let b = Math.min(1, value - i + 0.05);
	const distance = (t: number) => evaluateBezier(curve, t).clone().sub(target).lengthSq();
	for (let k = 0; k < 64; k++) {
		const t1 = a + (b - a) * 0.382;
		const t2 = a + (b - a) * 0.618;
		if (distance(t1) < distance(t2)) b = t2;
		else a = t1;
	}
	let t = (a + b) * 0.5;
	for (const endpoint of [0, 1]) if (distance(endpoint) < distance(t)) t = endpoint;
	return (i + t) / segments.length;
}

export function refineSplineIntersections(
	target: GeoSpline,
	rawHits: readonly CurveIntersection[]
): CurveIntersection[] {
	const closed = target.splineType !== 'control' && !!target.isClosed;
	const refined: CurveIntersection[] = [];
	for (const hit of rawHits) {
		const param = refineSplineParameter(target.bezierSegments, hit.point);
		if (!closed && (param < 1e-4 || param > 1 - 1e-4)) continue;
		refined.push({ ...hit, point: Vec2.from(hit.point), param });
	}
	refined.sort((a, b) => a.param - b.param);
	const unique: CurveIntersection[] = [];
	for (const item of refined) {
		if (!unique.some(u => Math.abs(u.param - item.param) < 1e-4)) unique.push(item);
	}
	return unique;
}

export function expectedSplineTrim(
	target: GeoSpline,
	intersections: readonly CurveIntersection[],
	cursor: Vec2
): Omit<TrimCandidate, 'curve'> {
	const cursorParam = getSplineParamAtPoint(target.bezierSegments, cursor).param;
	const closed = target.splineType !== 'control' && !!target.isClosed;
	const evalAt = (t: number) => getSplinePointAtParam(target.bezierSegments, t);
	if (!closed) {
		if (intersections.length === 0) {
			return {
				interval: [0, 1],
				cutStartWorld: evalAt(0),
				cutEndWorld: evalAt(1),
				isWholeEntity: true,
			};
		}
		const params = [0, ...intersections.map(i => i.param), 1];
		for (let i = 0; i < params.length - 1; i++) {
			const pA = params[i];
			const pB = params[i + 1];
			if (cursorParam >= pA - 1e-5 && cursorParam <= pB + 1e-5) {
				const startCut = i > 0 ? intersections[i - 1] : undefined;
				const endCut = i < intersections.length ? intersections[i] : undefined;
				return {
					interval: [pA, pB],
					cutStartWorld: evalAt(pA),
					cutEndWorld: evalAt(pB),
					...(startCut
						? { startCuttingCurveId: startCut.cuttingCurveId, startCuttingCurveType: startCut.cuttingCurveType }
						: {}),
					...(endCut ? { endCuttingCurveId: endCut.cuttingCurveId, endCuttingCurveType: endCut.cuttingCurveType } : {}),
					isWholeEntity: false,
				};
			}
		}
		const fallbackEnd = intersections[0];
		return {
			interval: [0, params[1]],
			cutStartWorld: evalAt(0),
			cutEndWorld: evalAt(params[1]),
			endCuttingCurveId: fallbackEnd.cuttingCurveId,
			endCuttingCurveType: fallbackEnd.cuttingCurveType,
			isWholeEntity: false,
		};
	}
	if (intersections.length < 2) {
		return {
			interval: [0, 1],
			cutStartWorld: evalAt(0),
			cutEndWorld: evalAt(1),
			isWholeEntity: true,
		};
	}
	const thetas = intersections.map(i => i.param);
	let chosenA = thetas.length - 1;
	let chosenB = 0;
	for (let i = 0; i < thetas.length - 1; i++) {
		if (cursorParam >= thetas[i] - 1e-5 && cursorParam <= thetas[i + 1] + 1e-5) {
			chosenA = i;
			chosenB = i + 1;
			break;
		}
	}
	const cutA = intersections[chosenA];
	const cutB = intersections[chosenB];
	return {
		interval: [cutA.param, cutB.param],
		cutStartWorld: evalAt(cutA.param),
		cutEndWorld: evalAt(cutB.param),
		startCuttingCurveId: cutA.cuttingCurveId,
		startCuttingCurveType: cutA.cuttingCurveType,
		endCuttingCurveId: cutB.cuttingCurveId,
		endCuttingCurveType: cutB.cuttingCurveType,
		isWholeEntity: false,
	};
}

import { typescriptCurveKernel } from '../../src/kernel/curveReference';
// Independent scalar minimization for the changed cut-parameter expectations.
// Production uses damped derivative corrections; this oracle uses 64 golden-section steps.
import { getGeometryKernel, setGeometryKernel } from '../../src/kernel';
import { getSplineParamAtPoint, evaluateBezier, type BezierSegment } from '../../src/math/splineReference';
import { Vec2 } from '../../src/math/vector';
import type { Point2, CubicBezier } from '../../src/kernel/types';
function parameter(segments: readonly CubicBezier[], point: Point2): number {
	if (!segments.length) return 0;
	const curves = segments.map(b => b.map(Vec2.from) as BezierSegment),
		target = Vec2.from(point);
	const value = getSplineParamAtPoint(curves, target).param * curves.length;
	const i = Math.min(Math.floor(value), curves.length - 1),
		curve = curves[i];
	let a = Math.max(0, value - i - 0.05),
		b = Math.min(1, value - i + 0.05);
	const distance = (t: number) => evaluateBezier(curve, t).clone().sub(target).lengthSq();
	for (let k = 0; k < 64; k++) {
		const t1 = a + (b - a) * 0.382,
			t2 = a + (b - a) * 0.618;
		if (distance(t1) < distance(t2)) b = t2;
		else a = t1;
	}
	let t = (a + b) * 0.5;
	for (const endpoint of [0, 1]) if (distance(endpoint) < distance(t)) t = endpoint;
	return (i + t) / curves.length;
}
export function withPreciseSplineParameters<T>(query: () => T, cursor?: Point2): T {
	const previous = getGeometryKernel(),
		curves = previous.curves ?? typescriptCurveKernel;
	let calls = 0,
		cursorCall = Infinity;
	try {
		setGeometryKernel({
			...previous,
			curves: {
				...curves,
				parametersAtPoints(curve, points) {
					if (curve.type !== 'spline') return curves.parametersAtPoints(curve, points);
					return points.map(point => {
						calls++;
						return cursor && calls === cursorCall && point.x === cursor.x && point.y === cursor.y
							? curves.parametersAtPoints(curve, [point])[0]
							: parameter(curve.bezierSegments, point);
					});
				},
			},
		});
		if (cursor) {
			// In the frozen trim query the final parameter lookup belongs to the cursor.
			// Keep that lookup coarse even when its coordinates equal an intersection.
			query();
			cursorCall = calls;
			calls = 0;
		}
		return query();
	} finally {
		setGeometryKernel(previous);
	}
}

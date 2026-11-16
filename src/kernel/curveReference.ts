import type { CurveEvaluationKernel } from './curveTypes';
import { hydrateQueryCurve } from './queryReference';
import { createPathEvaluator } from '../math/curvePathReference';
import { getPointAtParam, getParamAtPoint } from '../math/curveParameterReference';
import { Vec2 } from '../math/vector';

export const typescriptCurveKernel: CurveEvaluationKernel = {
	preparePath(curve) {
		const path = createPathEvaluator(hydrateQueryCurve(curve));
		return { length: path.length, samples: distances => distances.map(d => path.getSampleAtDistance(d)) };
	},
	pointsAtParameters(curve, params) {
		const c = hydrateQueryCurve(curve);
		return params.map(t => getPointAtParam(c, t));
	},
	parametersAtPoints(curve, points) {
		const c = hydrateQueryCurve(curve);
		return points.map(p => getParamAtPoint(c, Vec2.from(p)));
	},
};

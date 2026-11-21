import { getGeometryKernel } from '../kernel';
import type { GeometryQueryKernel, QueryCurve } from '../kernel/queryTypes';

/** Batch callers retain document filtering and priority rules in the editor. */
export function getQueryKernel(): GeometryQueryKernel {
	const queries = getGeometryKernel().queries;
	if (!queries) throw new Error('Geometry queries require the Rust/WASM kernel');
	return queries;
}

/** Invalid/unbounded geometry must not reject otherwise valid queries in the same batch. */
export function isQueryableCurve(curve: QueryCurve): boolean {
	const finite = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);
	switch (curve.type) {
		case 'segment':
			return finite(curve.p1) && finite(curve.p2);
		case 'spline':
			return curve.bezierSegments.every(b => b.every(finite));
		case 'circle':
			return finite(curve.center) && Number.isFinite(curve.radius) && curve.radius >= 0;
		case 'arc':
			return (
				finite(curve.center) &&
				Number.isFinite(curve.radius) &&
				curve.radius >= 0 &&
				finite(curve.start) &&
				finite(curve.end)
			);
		case 'ellipse':
			return finite(curve.center) && finite(curve.majorAxisPoint) && finite(curve.minorAxisPoint);
		case 'elliptical_arc':
			return (
				finite(curve.center) &&
				finite(curve.majorAxisPoint) &&
				finite(curve.minorAxisPoint) &&
				finite(curve.start) &&
				finite(curve.end)
			);
	}
}

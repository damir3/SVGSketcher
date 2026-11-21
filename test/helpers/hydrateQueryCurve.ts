import type { QueryCurve } from '../../src/kernel/queryTypes';
import type { GeoCurve } from '../../src/math/intersection';
import { Vec2 } from '../../src/math/vector';
import type { BezierSegment } from '../../src/math/spline';

export function hydrateQueryCurve(c: QueryCurve): GeoCurve {
	switch (c.type) {
		case 'segment':
			return { ...c, p1: Vec2.from(c.p1), p2: Vec2.from(c.p2) };
		case 'circle':
			return { ...c, centerId: '', center: Vec2.from(c.center) };
		case 'arc':
			return {
				...c,
				centerId: '',
				startPointId: '',
				endPointId: '',
				center: Vec2.from(c.center),
				start: Vec2.from(c.start),
				end: Vec2.from(c.end),
			};
		case 'ellipse':
			return {
				...c,
				centerId: '',
				majorAxisPointId: '',
				minorAxisPointId: '',
				center: Vec2.from(c.center),
				majorAxisPoint: Vec2.from(c.majorAxisPoint),
				minorAxisPoint: Vec2.from(c.minorAxisPoint),
			};
		case 'elliptical_arc':
			return {
				...c,
				centerId: '',
				majorAxisPointId: '',
				minorAxisPointId: '',
				startPointId: '',
				endPointId: '',
				center: Vec2.from(c.center),
				majorAxisPoint: Vec2.from(c.majorAxisPoint),
				minorAxisPoint: Vec2.from(c.minorAxisPoint),
				start: Vec2.from(c.start),
				end: Vec2.from(c.end),
			};
		case 'spline':
			return {
				...c,
				splineType: 'control',
				pointIds: [],
				points: [],
				bezierSegments: c.bezierSegments.map(b => b.map(Vec2.from) as BezierSegment),
			};
	}
}

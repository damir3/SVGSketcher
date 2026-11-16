// Frozen pre-migration parameter conventions, independent of the active backend.
import type { GeoCurve } from './intersection';
import { Vec2 } from './vector';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import { getSplinePointAtParam, getSplineParamAtPoint } from './splineReference';
const TWO_PI = 2 * Math.PI;

export function getPointAtParam(curve: GeoCurve, param: number): Vec2 {
	if (curve.type === 'spline') {
		return getSplinePointAtParam(curve.bezierSegments, param);
	} else if (curve.type === 'segment') {
		const t = Math.max(0, Math.min(1, param));
		return curve.p1.clone().lerp(curve.p2, t);
	} else if (curve.type === 'circle') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const sq = Vec2.fromPolar(curve.radius, param).add(sc);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const as = Vec2.from(sc).angleToPoint(ss);
		const ae = Vec2.from(sc).angleToPoint(se);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const ang = curve.clockwise ? as + u * sweep : as - u * sweep;
		const sq = Vec2.fromPolar(curve.radius, ang).add(sc);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'ellipse') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU: u, axisV: v } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const sq = ellipsePointAtParameter(param, sc, r, u, v);
		return new Vec2(sq.x, -sq.y);
	} else if (curve.type === 'elliptical_arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const ts = ellipseParameterAtPoint(ss, sc, r, axisU, axisV);
		const te = ellipseParameterAtPoint(se, sc, r, axisU, axisV);
		let sweep = curve.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		const u = Math.max(0, Math.min(1, param));
		const t = curve.clockwise ? ts + u * sweep : ts - u * sweep;
		const sq = ellipsePointAtParameter(t, sc, r, axisU, axisV);
		return new Vec2(sq.x, -sq.y);
	}
	return new Vec2(0, 0);
}

/**
 * Computes parameter of point `pt` (in world coordinates) along `curve`.
 */
export function getParamAtPoint(curve: GeoCurve, pt: Vec2): number {
	if (curve.type === 'spline') {
		return getSplineParamAtPoint(curve.bezierSegments, pt).param;
	} else if (curve.type === 'segment') {
		const dir = new Vec2().subVectors(curve.p2, curve.p1);
		const l2 = dir.lengthSq();
		if (l2 < 1e-12) return 0;
		const t = new Vec2().subVectors(pt, curve.p1).dot(dir) / l2;
		return Math.max(0, Math.min(1, t));
	} else if (curve.type === 'circle') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const sp = new Vec2(pt.x, -pt.y);
		let ang = Vec2.from(sc).angleToPoint(sp);
		if (ang < 0) ang += TWO_PI;
		return ang;
	} else if (curve.type === 'arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const sp = new Vec2(pt.x, -pt.y);
		const as = Vec2.from(sc).angleToPoint(ss);
		const ae = Vec2.from(sc).angleToPoint(se);
		const ap = Vec2.from(sc).angleToPoint(sp);
		let sweep = curve.clockwise ? (ae - as) % TWO_PI : (as - ae) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		let delta = curve.clockwise ? (ap - as) % TWO_PI : (as - ap) % TWO_PI;
		if (delta < 0) delta += TWO_PI;
		if (sweep < 1e-6) return 0;
		return Math.max(0, Math.min(1, delta / sweep));
	} else if (curve.type === 'ellipse') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const sp = new Vec2(pt.x, -pt.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const paramRadii = new Vec2(Math.max(r.x, 1e-6), Math.max(r.y, 1e-6));
		let t = ellipseParameterAtPoint(sp, sc, paramRadii, axisU, axisV);
		if (t < 0) t += TWO_PI;
		return t;
	} else if (curve.type === 'elliptical_arc') {
		const sc = new Vec2(curve.center.x, -curve.center.y);
		const smaj = new Vec2(curve.majorAxisPoint.x, -curve.majorAxisPoint.y);
		const smin = new Vec2(curve.minorAxisPoint.x, -curve.minorAxisPoint.y);
		const ss = new Vec2(curve.start.x, -curve.start.y);
		const se = new Vec2(curve.end.x, -curve.end.y);
		const sp = new Vec2(pt.x, -pt.y);
		const r = Vec2.from(sc).distancesTo(smaj, smin);
		const { axisU, axisV } = ellipseAxes(Vec2.from(sc).angleToPoint(smaj));
		const paramRadii = new Vec2(Math.max(r.x, 1e-6), Math.max(r.y, 1e-6));
		const ts = ellipseParameterAtPoint(ss, sc, paramRadii, axisU, axisV);
		const te = ellipseParameterAtPoint(se, sc, paramRadii, axisU, axisV);
		const tp = ellipseParameterAtPoint(sp, sc, paramRadii, axisU, axisV);
		let sweep = curve.clockwise ? (te - ts) % TWO_PI : (ts - te) % TWO_PI;
		if (sweep < 0) sweep += TWO_PI;
		let delta = curve.clockwise ? (tp - ts) % TWO_PI : (ts - tp) % TWO_PI;
		if (delta < 0) delta += TWO_PI;
		if (sweep < 1e-6) return 0;
		return Math.max(0, Math.min(1, delta / sweep));
	}
	return 0;
}

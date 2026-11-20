import { fitPointsToBezier, type BezierSegment } from '../../math/spline';
import { Vec2 } from '../../math/vector';
import {
	countTraceStats,
	type TraceResult,
	type TracedClosedSpline,
	type TracedPath,
	type TracedSegment,
} from './types';

const TAU = 2 * Math.PI;

function line(start: Vec2, end: Vec2): BezierSegment {
	return [start, start, end, end];
}

function arcCubics(
	center: Vec2,
	radius: number,
	start: Vec2,
	end: Vec2,
	angle: number,
	sweep: number
): BezierSegment[] {
	const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
	const step = sweep / count;
	const handleLength = (4 / 3) * radius * Math.tan(step / 4);
	const curves: BezierSegment[] = [];
	for (let i = 0; i < count; i++) {
		const a = angle + i * step;
		const b = a + step;
		const p0 = i === 0 ? start : curves[i - 1][3];
		const p3 = i === count - 1 ? end : Vec2.fromPolar(radius, b).add(center);
		const h1 = p0.clone().addScaledVector(new Vec2(-Math.sin(a), Math.cos(a)), handleLength);
		const h2 = p3.clone().addScaledVector(new Vec2(-Math.sin(b), Math.cos(b)), -handleLength);
		curves.push([p0, h1, h2, p3]);
	}
	return curves;
}

function shortArc(start: Vec2, end: Vec2, nominalRadius: number, direction: number): BezierSegment[] {
	const chord = new Vec2().subVectors(end, start);
	const halfChord = chord.length() / 2;
	if (halfChord === 0) return [line(start, end)];
	const radius = Math.max(nominalRadius, halfChord);
	const height = Math.sqrt(Math.max(0, (radius - halfChord) * (radius + halfChord)));
	const center = start
		.clone()
		.lerp(end, 0.5)
		.addScaledVector(chord.perpendicular(), (direction * height) / (2 * halfChord));
	const sweep = direction * 2 * Math.asin(halfChord / radius);
	return arcCubics(center, radius, start, end, center.angleToPoint(start), sweep);
}

function segmentCubics(segment: TracedSegment, start: Vec2, end: Vec2): BezierSegment[] {
	if (segment.kind === 'line') return [line(start, end)];
	if (segment.kind === 'spline') {
		return fitPointsToBezier(
			[start, ...segment.points.map(Vec2.from), end],
			segment.handles.map(({ h1, h2 }) => ({ h1: Vec2.from(h1), h2: Vec2.from(h2) }))
		);
	}

	// Mirror the primitive preview's small SVG arcs, including its split for long sweeps.
	const direction =
		new Vec2().subVectors(segment.mid, start).cross(new Vec2().subVectors(end, segment.mid)) > 0 ? 1 : -1;
	const center = Vec2.from(segment.center);
	const angle = center.angleToPoint(start);
	const sweep = (((direction * (center.angleToPoint(end) - angle)) % TAU) + TAU) % TAU;
	if (sweep <= (3 * Math.PI) / 4) return shortArc(start, end, segment.radius, direction);

	const mid = Vec2.fromPolar(segment.radius, angle + direction * sweep * 0.5).add(center);
	return [...shortArc(start, mid, segment.radius, direction), ...shortArc(mid, end, segment.radius, direction)];
}

function toFitSpline(curves: BezierSegment[], closed: boolean): TracedClosedSpline {
	const points: TracedClosedSpline['points'] = [];
	const handles: TracedClosedSpline['handles'] = [];
	for (let i = 0; i < curves.length + Number(!closed); i++) {
		const prev = i > 0 ? curves[i - 1] : closed ? curves.at(-1) : undefined;
		const next = curves[i];
		const point = next?.[0] ?? prev![3];
		const h1 = prev?.[2] ?? point.clone().multiplyScalar(2).sub(next[1]);
		const h2 = next?.[1] ?? point.clone().multiplyScalar(2).sub(prev![2]);
		const incoming = new Vec2().subVectors(h1, point);
		const outgoing = new Vec2().subVectors(h2, point);
		// The editor requires collinear opposing handles. Preserve corners with two
		// coincident fit points so the solver does not change either neighboring curve.
		if (
			incoming.dot(outgoing) > 0 ||
			Math.abs(incoming.cross(outgoing)) > 1e-10 * incoming.length() * outgoing.length()
		) {
			points.push(point, point);
			handles.push({ h1, h2: point }, { h1: point, h2 });
		} else {
			points.push(point);
			handles.push({ h1, h2 });
		}
	}
	return { points, handles };
}

/** Converts fitted contours into editable spline geometry without reading the raster again. */
export function convertTraceToSplines(result: TraceResult): TraceResult {
	const paths: TracedPath[] = [];
	const closedSplines = [...result.closedSplines];
	for (const path of result.paths) {
		const segments = path.segments.filter(segment => segment.kind !== 'line' || segment.a !== segment.b);
		if (segments.length === 0) continue;
		const curves = segments.flatMap(segment =>
			segmentCubics(segment, Vec2.from(result.vertices[segment.a]), Vec2.from(result.vertices[segment.b]))
		);
		if (!path.closed && segments.length === 1 && segments[0].kind === 'line') {
			const curve = curves[0];
			curve[1] = curve[0].clone().lerp(curve[3], 1 / 3);
			curve[2] = curve[0].clone().lerp(curve[3], 2 / 3);
		}
		const spline = toFitSpline(curves, path.closed);
		if (path.closed) {
			if (spline.points.length >= 2) closedSplines.push(spline);
		} else {
			const a = segments[0].a;
			const b = segments.at(-1)!.b;
			paths.push({
				segments: [{ kind: 'spline', a, b, points: spline.points.slice(1, -1), handles: spline.handles }],
				closed: false,
				tangent: [false],
			});
		}
	}
	for (const { center, radius } of result.circles) {
		const c = Vec2.from(center);
		const start = c.clone().add(new Vec2(radius, 0));
		closedSplines.push(toFitSpline(arcCubics(c, radius, start, start, 0, TAU), true));
	}
	const converted = { ...result, paths, circles: [], closedSplines };
	return { ...converted, stats: countTraceStats(converted) };
}

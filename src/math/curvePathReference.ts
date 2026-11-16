// Frozen pre-migration curve-distance arithmetic; no font or active-kernel dependencies.
import { Vec2 } from './vector';
import type { GeoCurve, GeoSegment, GeoEllipse, GeoEllipticalArc, GeoSpline } from './intersection';
import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from './ellipse';
import { evaluateBezier, evaluateBezierDerivative } from './splineReference';

export interface CurveSample {
	point: Vec2;
	tangent: Vec2;
	normal: Vec2;
}

export interface PathEvaluator {
	// Length used for alignment and fitting. A closed continuation may extend beyond it.
	readonly length: number;
	getSampleAtDistance(s: number): CurveSample;
}

function createEllipsePathEvaluator(curve: GeoEllipse | GeoEllipticalArc): PathEvaluator {
	const { center, majorAxisPoint, minorAxisPoint } = curve;
	const radii = center.distancesTo(majorAxisPoint, minorAxisPoint);
	const { axisU, axisV } = ellipseAxes(center.angleToPoint(majorAxisPoint));
	const fullTurn = 2 * Math.PI;
	const direction = curve.type === 'ellipse' || curve.clockwise ? -1 : 1;
	let start = Math.PI;
	let sweep = fullTurn;
	if (radii.x === 0 || radii.y === 0) {
		sweep = 0;
	} else if (curve.type === 'elliptical_arc') {
		start = ellipseParameterAtPoint(curve.start, center, radii, axisU, axisV);
		const end = ellipseParameterAtPoint(curve.end, center, radii, axisU, axisV);
		sweep = (direction * (end - start)) % fullTurn;
		if (sweep < 0) sweep += fullTurn;
	}

	// Sample the full revolution, including the exact arc endpoint for alignment and fitting.
	const steps = 256;
	const angles = Array.from({ length: steps + 1 }, (_, i) => (i * fullTurn) / steps);
	const endIndex = angles.findIndex(angle => angle >= sweep);
	if (angles[endIndex] !== sweep) angles.splice(endIndex, 0, sweep);

	const lengths = [0];
	let previous = ellipsePointAtParameter(start, center, radii, axisU, axisV);
	for (let i = 1; i < angles.length; i++) {
		const point = ellipsePointAtParameter(start + direction * angles[i], center, radii, axisU, axisV);
		lengths.push(lengths[i - 1] + previous.distanceTo(point));
		previous = point;
	}

	const length = lengths[endIndex];
	const perimeter = lengths[lengths.length - 1];
	return {
		length,
		getSampleAtDistance(s: number) {
			const remainder = perimeter > 0 ? s % perimeter : 0;
			const distance = remainder < 0 ? remainder + perimeter : remainder;
			let low = 0;
			let high = lengths.length - 1;
			while (high - low > 1) {
				const middle = (low + high) >> 1;
				if (lengths[middle] <= distance) low = middle;
				else high = middle;
			}
			const span = lengths[high] - lengths[low];
			const fraction = span > 0 ? (distance - lengths[low]) / span : 0;
			const angle = angles[low] + fraction * (angles[high] - angles[low]);
			const theta = start + direction * angle;
			const du = -radii.x * Math.sin(theta);
			const dv = radii.y * Math.cos(theta);
			const forward = axisU.clone().multiplyScalar(du).addScaledVector(axisV, dv).normalizeOrUnitX();
			return {
				point: ellipsePointAtParameter(theta, center, radii, axisU, axisV),
				tangent: forward.clone().multiplyScalar(direction),
				normal: forward.clone().perpendicular().negate(),
			};
		},
	};
}

export function createPathEvaluator(curve: GeoCurve): PathEvaluator {
	switch (curve.type) {
		case 'segment': {
			const seg = curve as GeoSegment;
			const totalLen = seg.p1.distanceTo(seg.p2);
			const delta = new Vec2().subVectors(seg.p2, seg.p1);
			const dir = totalLen > 1e-9 ? delta.clone().divideScalar(totalLen) : new Vec2(1, 0);
			const norm = dir.clone().perpendicular();
			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const clampedS = Math.max(0, Math.min(totalLen, s));
					return {
						point: seg.p1.clone().addScaledVector(dir, clampedS),
						tangent: dir,
						normal: norm,
					};
				},
			};
		}
		case 'circle':
		case 'arc': {
			const { center, radius } = curve;
			const fullTurn = 2 * Math.PI;
			const direction = curve.type === 'circle' || curve.clockwise ? -1 : 1;
			const start = curve.type === 'circle' ? Math.PI : center.angleToPoint(curve.start);
			let sweep = fullTurn;
			if (curve.type === 'arc') {
				const end = center.angleToPoint(curve.end);
				sweep = (direction * (end - start)) % fullTurn;
				if (sweep <= 0) sweep += fullTurn;
			}
			const circumference = fullTurn * radius;
			return {
				length: radius * sweep,
				getSampleAtDistance(s: number) {
					const offset = radius > 0 ? (s % circumference) / radius : 0;
					const theta = start + direction * offset;
					const normal = Vec2.fromPolar(1, theta);
					return {
						point: center.clone().addScaledVector(normal, radius),
						tangent: normal.clone().perpendicular().multiplyScalar(direction),
						normal,
					};
				},
			};
		}
		case 'ellipse':
		case 'elliptical_arc':
			return createEllipsePathEvaluator(curve);
		case 'spline': {
			const spline = curve as GeoSpline;
			const segments = spline.bezierSegments || [];
			if (segments.length === 0) {
				return {
					length: 0,
					getSampleAtDistance() {
						return { point: new Vec2(0, 0), tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
					},
				};
			}

			// Subdivide segments to approximate arc-lengths
			const stepsPerSeg = 20;
			const subSamples: Array<{ t: number; segIdx: number; cumLen: number }> = [];
			let cumLen = 0;

			for (let i = 0; i < segments.length; i++) {
				const seg = segments[i];
				let prevP = evaluateBezier(seg, 0);
				if (i === 0) {
					subSamples.push({ t: 0, segIdx: 0, cumLen: 0 });
				}
				for (let step = 1; step <= stepsPerSeg; step++) {
					const t = step / stepsPerSeg;
					const p = evaluateBezier(seg, t);
					cumLen += prevP.distanceTo(p);
					subSamples.push({ t, segIdx: i, cumLen });
					prevP = p;
				}
			}

			const totalLen = cumLen;

			return {
				length: totalLen,
				getSampleAtDistance(s: number) {
					const clampedS = Math.max(0, Math.min(totalLen, s));
					// Binary search in subSamples
					let low = 0;
					let high = subSamples.length - 1;
					while (low < high - 1) {
						const mid = (low + high) >> 1;
						if (subSamples[mid].cumLen <= clampedS) {
							low = mid;
						} else {
							high = mid;
						}
					}

					const s0 = subSamples[low];
					const s1 = subSamples[high];
					const segSpan = s1.cumLen - s0.cumLen;
					const frac = segSpan > 1e-9 ? (clampedS - s0.cumLen) / segSpan : 0;
					// The endpoint of one segment is also t = 0 on the next segment.
					const startT = s0.segIdx === s1.segIdx ? s0.t : 0;
					const t = startT + frac * (s1.t - startT);
					const seg = segments[s1.segIdx];
					const pt = evaluateBezier(seg, t);
					const d = evaluateBezierDerivative(seg, t);
					const tan = d.clone().normalizeOrNull(1e-9) ?? new Vec2(1, 0);
					const norm = tan.clone().perpendicular();
					return {
						point: pt,
						tangent: tan,
						normal: norm,
					};
				},
			};
		}
		default:
			return {
				length: 0,
				getSampleAtDistance() {
					return { point: new Vec2(0, 0), tangent: new Vec2(1, 0), normal: new Vec2(0, 1) };
				},
			};
	}
}

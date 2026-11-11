import { MAX_CONIC_INTERSECTION_CANDIDATES, type KernelCurve, type Point2 } from './types';

type Segment = Extract<KernelCurve, { type: 'segment' }>;
type Conic = Extract<KernelCurve, { type: 'circle' | 'ellipse' }>;

interface Frame {
	center: Point2;
	rx: number;
	ry: number;
	u: Point2;
	v: Point2;
}

/** Preserve the legacy SVG-coordinate basis and the order of floating-point operations. */
function frame(curve: Conic): Frame | null {
	const center = { x: curve.center.x, y: -curve.center.y };
	let rx: number,
		ry: number,
		angle = 0;
	if (curve.type === 'circle') {
		rx = ry = curve.radius;
	} else {
		const dx = curve.majorAxisPoint.x - center.x;
		const dy = -curve.majorAxisPoint.y - center.y;
		rx = Math.hypot(dx, dy);
		ry = Math.hypot(curve.minorAxisPoint.x - center.x, -curve.minorAxisPoint.y - center.y);
		angle = Math.atan2(dy, dx);
	}
	if (rx < 1e-6 || ry < 1e-6) return null;
	const u = { x: Math.cos(angle), y: Math.sin(angle) };
	return { center, rx, ry, u, v: { x: -u.y, y: u.x } };
}

function localPoint(p: Point2, e: Frame): Point2 {
	const dx = p.x - e.center.x;
	const dy = p.y - e.center.y;
	return { x: dx * e.u.x + dy * e.u.y, y: dx * e.v.x + dy * e.v.y };
}

function pointAt(e: Frame, t: number): Point2 {
	const u = e.rx * Math.cos(t),
		v = e.ry * Math.sin(t);
	return { x: e.center.x + e.u.x * u + e.v.x * v, y: e.center.y + e.u.y * u + e.v.y * v };
}

export function segmentEllipse(segment: Segment, ellipse: Extract<Conic, { type: 'ellipse' }>): Point2[] {
	const e = frame(ellipse);
	if (!e) return [];
	const p1 = localPoint({ x: segment.p1.x, y: -segment.p1.y }, e);
	const p2 = localPoint({ x: segment.p2.x, y: -segment.p2.y }, e);
	const du = p2.x - p1.x,
		dv = p2.y - p1.y;
	const a = e.ry * e.ry * du * du + e.rx * e.rx * dv * dv;
	if (a < 1e-12) return [];
	const b = 2 * (e.ry * e.ry * p1.x * du + e.rx * e.rx * p1.y * dv);
	const c = e.ry * e.ry * p1.x * p1.x + e.rx * e.rx * p1.y * p1.y - e.rx * e.rx * e.ry * e.ry;
	const discriminant = b * b - 4 * a * c;
	if (discriminant < -1e-7) return [];
	const sqrtD = Math.sqrt(Math.max(0, discriminant));
	const points: Point2[] = [];
	for (const t of [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)]) {
		if (t >= -1e-5 && t <= 1 + 1e-5) {
			const clamped = Math.max(0, Math.min(1, t));
			points.push({
				x: segment.p1.x + (segment.p2.x - segment.p1.x) * clamped,
				y: segment.p1.y + (segment.p2.y - segment.p1.y) * clamped,
			});
		}
	}
	return points;
}

/** Sample and bracket roots exactly as the pre-migration editor did; filter spans afterwards. */
export function conicConic(a: Conic, b: Conic): Point2[] {
	const e1 = frame(a),
		e2 = frame(b);
	if (!e1 || !e2) return [];
	const g = (t: number) => {
		const p = localPoint(pointAt(e1, t), e2);
		return (p.x * p.x) / (e2.rx * e2.rx) + (p.y * p.y) / (e2.ry * e2.ry) - 1;
	};
	const n = MAX_CONIC_INTERSECTION_CANDIDATES;
	const step = (2 * Math.PI) / n;
	const values = Array.from({ length: n + 1 }, (_, i) => g(i * step));
	const roots: number[] = [];
	for (let i = 0; i < n; i++) {
		const ta = i * step,
			tb = (i + 1) * step;
		const ga = values[i],
			gb = values[i + 1];
		if (ga * gb <= 0) {
			let low = ta,
				high = tb,
				fLow = ga;
			for (let iteration = 0; iteration < 28; iteration++) {
				const mid = (low + high) * 0.5;
				const fMid = g(mid);
				if (Math.abs(fMid) < 1e-12 || high - low < 1e-10) {
					low = mid;
					break;
				}
				if (fLow * fMid <= 0) high = mid;
				else {
					low = mid;
					fLow = fMid;
				}
			}
			roots.push((low + high) * 0.5);
		} else if (
			Math.abs(ga) < 1e-4 &&
			(i === 0 || Math.abs(ga) <= Math.abs(values[i - 1])) &&
			Math.abs(ga) <= Math.abs(gb)
		) {
			roots.push(ta);
		}
	}
	return roots.map(t => {
		const p = pointAt(e1, t);
		return { x: p.x, y: -p.y };
	});
}

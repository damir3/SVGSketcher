import { GEOMETRY_KERNEL_API_VERSION, type GeometryKernel, type KernelCurve, type Point2 } from './types';
import { conicConic, segmentEllipse } from './conics';
import { bezierCurve } from './bezier';
import { typescriptSplineKernel } from './splineReference';

type Segment = Extract<KernelCurve, { type: 'segment' }>;
type Circle = Extract<KernelCurve, { type: 'circle' }>;

// Preserve the editor's existing arithmetic, point order and tolerances during migration.
function segmentSegment(a: Segment, b: Segment): Point2[] {
	const dx = a.p2.x - a.p1.x;
	const dy = a.p2.y - a.p1.y;
	const ex = b.p2.x - b.p1.x;
	const ey = b.p2.y - b.p1.y;
	const det = dx * ey - dy * ex;
	if (Math.abs(det) < 1e-10) return [];
	const wx = b.p1.x - a.p1.x;
	const wy = b.p1.y - a.p1.y;
	const t = (wx * ey - wy * ex) / det;
	const u = (wx * dy - wy * dx) / det;
	if (!(t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5)) return [];
	const clamped = Math.max(0, Math.min(1, t));
	return [{ x: a.p1.x + dx * clamped, y: a.p1.y + dy * clamped }];
}

function segmentCircle(s: Segment, c: Circle): Point2[] {
	const dx = s.p2.x - s.p1.x;
	const dy = s.p2.y - s.p1.y;
	const wx = s.p1.x - c.center.x;
	const wy = s.p1.y - c.center.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq < 1e-12) return [];
	const closestT = -(wx * dx + wy * dy) / lengthSq;
	const closestX = s.p1.x + dx * closestT;
	const closestY = s.p1.y + dy * closestT;
	const distance = Math.hypot(closestX - c.center.x, closestY - c.center.y);
	// World-space tangency tolerance absorbs solver roundoff, independent of segment length.
	const tangent = Math.abs(distance - c.radius) <= 1e-5;
	if (!tangent && distance > c.radius) return [];
	const offset = tangent ? 0 : Math.sqrt(((c.radius - distance) * (c.radius + distance)) / lengthSq);
	const candidates = tangent ? [closestT] : [closestT - offset, closestT + offset];
	const points: Point2[] = [];
	for (const t of candidates) {
		if (t >= -1e-5 && t <= 1 + 1e-5) {
			const clamped = Math.max(0, Math.min(1, t));
			const point = { x: s.p1.x + dx * clamped, y: s.p1.y + dy * clamped };
			points.push(point);
		}
	}
	return points;
}

function circleCircle(a: Circle, b: Circle): Point2[] {
	const dx = b.center.x - a.center.x;
	const dy = b.center.y - a.center.y;
	const distance = Math.hypot(dx, dy);
	if (distance < 1e-9) return [];
	if (distance > a.radius + b.radius + 1e-5 || distance < Math.abs(a.radius - b.radius) - 1e-5) return [];
	const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
	const height = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
	const base = { x: a.center.x + dx * (along / distance), y: a.center.y + dy * (along / distance) };
	if (height < 1e-7) return [base];
	const nx = -dy * (1 / distance);
	const ny = dx * (1 / distance);
	// Arc filtering happens before deduplication in the legacy adapter.
	return [
		{ x: base.x + nx * height, y: base.y + ny * height },
		{ x: base.x + nx * -height, y: base.y + ny * -height },
	];
}

export const typescriptGeometryKernel: GeometryKernel = {
	backend: 'typescript',
	apiVersion: GEOMETRY_KERNEL_API_VERSION,
	spline: typescriptSplineKernel,
	intersectPairs(pairs) {
		return pairs.map(({ a, b }) => {
			if (a.type === 'bezier') return bezierCurve(a.points, b);
			if (b.type === 'bezier') return bezierCurve(b.points, a);
			if (a.type === 'segment') {
				if (b.type === 'segment') return segmentSegment(a, b);
				return b.type === 'circle' ? segmentCircle(a, b) : segmentEllipse(a, b);
			}
			if (b.type === 'segment') return a.type === 'circle' ? segmentCircle(b, a) : segmentEllipse(b, a);
			return a.type === 'circle' && b.type === 'circle' ? circleCircle(a, b) : conicConic(a, b);
		});
	},
};

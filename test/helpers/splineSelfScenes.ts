import { Vec2 } from '../../src/math/vector';
import { fitPointsToBezier, type BezierSegment } from '../../src/math/spline';
const pt = (x: number, y: number) => new Vec2(x, y);
const line = (a: Vec2, b: Vec2): BezierSegment => [a, a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b];
export function splineSelfScenes() {
	const a = pt(-40, -30),
		b = pt(40, 30),
		c = pt(-40, 30),
		d = pt(40, -30);
	const cases: { name: string; segments: BezierSegment[]; closed: boolean }[] = [
		{ name: 'empty', segments: [], closed: false },
		{ name: 'single-line', segments: [line(a, b)], closed: false },
		{ name: 'point', segments: [[a, a, a, a]], closed: false },
		{ name: 'cubic-loop', segments: [[pt(0, 0), pt(100, 100), pt(-100, 100), pt(50, 0)]], closed: false },
		{ name: 'cubic-cusp', segments: [[pt(0, 0), pt(30, 30), pt(-30, 30), pt(0, 0)]], closed: true },
		{
			name: 'alpha',
			segments: fitPointsToBezier([pt(-40, 0), pt(10, 30), pt(10, -30), pt(-20, 0), pt(30, 0)]),
			closed: false,
		},
		{ name: 'crossing-pair', segments: [line(a, b), line(c, d)], closed: false },
		{ name: 'bow-tie', segments: [line(a, b), line(b, c), line(c, d), line(d, a)], closed: true },
		{ name: 'joined-endpoints', segments: [line(a, b), line(b, c)], closed: false },
		{ name: 'retraced', segments: [line(a, b), line(b, a)], closed: true },
		{ name: 'coincident', segments: [line(a, b), line(a, b)], closed: false },
		{ name: 'disjoint', segments: [line(pt(0, 0), pt(5, 0)), line(pt(10, 1), pt(15, 1))], closed: false },
		{
			name: 'tangency',
			segments: [[pt(-1, 1), pt(-1 / 3, -1 / 3), pt(1 / 3, -1 / 3), pt(1, 1)], line(pt(-2, 0), pt(2, 0))],
			closed: false,
		},
		{ name: 'nonadjacent-vertex', segments: [line(a, b), line(b, c), line(a, d)], closed: false },
		{ name: 'collapsed-middle', segments: [line(a, b), [b, b, b, b], line(c, d)], closed: false },
	];
	const output = [...cases];
	for (const source of cases.filter(c => c.segments.length))
		for (const [scale, angle, x, y] of [
			[0.05, 0.4, 3, -7],
			[1, 1.3, 31, -42],
			[20, -0.7, -123, 47],
		]) {
			const segments = source.segments.map(
				b =>
					b.map(p =>
						p.clone().multiplyScalar(scale).rotateAround(new Vec2(0, 0), angle).add(new Vec2(x, y))
					) as BezierSegment
			);
			output.push({ name: `${source.name}/${scale}`, segments, closed: source.closed });
		}
	// The same seam is a real endpoint contact on an open spline and omitted on a closed one.
	for (const closed of [false, true])
		output.push({ name: `seam/${closed}`, segments: [line(a, b), line(c, a)], closed });
	return output;
}

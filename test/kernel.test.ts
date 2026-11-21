import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel/index';
import {
	GEOMETRY_KERNEL_API_VERSION,
	type GeometryKernel,
	type IntersectionPair,
	type KernelCurve,
	type Point2,
} from '../src/kernel/types';
import { createWasmGeometryKernel, type WasmKernelBindings } from '../src/kernel/wasm';
import { intersectBezierBezier, intersectCurvePairs, intersectCurves, type GeoCurve } from '../src/math/intersection';
import { Vec2 } from '../src/math/vector';

type FixtureSet = {
	cases: Array<{ name: string; a: Record<string, unknown>; b: Record<string, unknown>; expected: Point2[] }>;
};
const fixtures = JSON.parse(
	readFileSync(new URL('./fixtures/kernelIntersections.json', import.meta.url), 'utf8')
) as FixtureSet;
const ellipseFixtures = JSON.parse(
	readFileSync(new URL('./fixtures/kernelEllipses.json', import.meta.url), 'utf8')
) as FixtureSet;
const splineFixtures = JSON.parse(
	readFileSync(new URL('./fixtures/kernelSplines.json', import.meta.url), 'utf8')
) as FixtureSet;
const allFixtures = [...fixtures.cases, ...ellipseFixtures.cases, ...splineFixtures.cases];

function hydrate(data: Record<string, unknown>, id: string): GeoCurve {
	const restore = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(restore)
			: value && typeof value === 'object' && 'x' in value && 'y' in value
				? Vec2.from(value as Point2)
				: value;
	return Object.fromEntries(
		Object.entries({ ...data, id }).map(([key, value]) => [key, restore(value)])
	) as unknown as GeoCurve;
}

function assertPoints(actual: Point2[], expected: Point2[]): void {
	assert.equal(actual.length, expected.length, 'intersection count');
	actual.forEach((point, i) => {
		for (const axis of ['x', 'y'] as const) {
			const tolerance = 1e-8 + Number.EPSILON * 32 * Math.abs(expected[i][axis]);
			assert.ok(
				Math.abs(point[axis] - expected[i][axis]) <= tolerance,
				`${axis}: ${point[axis]} ≠ ${expected[i][axis]}`
			);
		}
	});
}

describe('geometry kernel baseline captured before migration', () => {
	for (const fixture of allFixtures) {
		it(fixture.name, () => {
			const a = hydrate(fixture.a, 'a'),
				b = hydrate(fixture.b, 'b');
			assertPoints(intersectCurves(a, b), fixture.expected);
			assertPoints(intersectCurvePairs([[a, b]])[0], fixture.expected);
		});
	}
});

it('preserves mixed spline and conic batch results, including empty composites and shared endpoints', () => {
	const all = allFixtures;
	const pairs = all.map(fixture => [hydrate(fixture.a, 'a'), hydrate(fixture.b, 'b')] as const);
	const actual = intersectCurvePairs(pairs);
	assert.equal(actual.length, all.length);
	actual.forEach((points, i) => assertPoints(points, all[i].expected));
});

it('batches spline and ellipse intersections together', () => {
	const spline: GeoCurve = {
		type: 'spline',
		id: 'spline',
		splineType: 'control',
		pointIds: ['p1', 'p2'],
		points: [new Vec2(-10, 0), new Vec2(10, 0)],
		bezierSegments: [[new Vec2(-10, 0), new Vec2(-10 / 3, 0), new Vec2(10 / 3, 0), new Vec2(10, 0)]],
	};
	const ellipse = hydrate(
		{ type: 'ellipse', center: { x: 0, y: 0 }, majorAxisPoint: { x: 5, y: 0 }, minorAxisPoint: { x: 0, y: 3 } },
		'ellipse'
	);
	const segment = hydrate({ type: 'segment', p1: { x: -10, y: 0 }, p2: { x: 10, y: 0 } }, 'segment');
	const actual = intersectCurvePairs([
		[spline, ellipse],
		[segment, ellipse],
		[ellipse, spline],
	]);
	for (const points of actual)
		assertPoints(points, [
			{ x: -5, y: 0 },
			{ x: 5, y: 0 },
		]);
});

it('preserves direct cubic intersection calls and never intersects a spline with itself', () => {
	const a = [new Vec2(-3, 0), new Vec2(-1, 0), new Vec2(1, 0), new Vec2(3, 0)] as const;
	const b = [new Vec2(0, -3), new Vec2(0, -1), new Vec2(0, 1), new Vec2(0, 3)] as const;
	assertPoints(intersectBezierBezier([...a], [...b]), [{ x: 0, y: 0 }]);
	const spline = hydrate(splineFixtures.cases[0].a, 'spline');
	assert.deepEqual(intersectCurves(spline, spline), []);
	assert.deepEqual(intersectCurvePairs([[spline, spline]]), [[]]);
});

it('submits all cubic combinations of composite spline pairs in one kernel call', () => {
	const fixture = splineFixtures.cases.find(item => item.name === 'multi segment spline pair')!;
	const a = hydrate(fixture.a, 'a'),
		b = hydrate(fixture.b, 'b');
	const previous = getGeometryKernel();
	const expectedReverse = intersectCurves(b, a);
	let calls = 0;
	setGeometryKernel({
		...previous,
		intersectPairs(pairs) {
			calls++;
			assert.equal(pairs.length, 12);
			return previous.intersectPairs(pairs);
		},
	});
	try {
		const actual = intersectCurvePairs([
			[a, b],
			[a, a],
			[b, a],
		]);
		assert.equal(calls, 1);
		assertPoints(actual[0], fixture.expected);
		assert.deepEqual(actual[1], []);
		assertPoints(actual[2], expectedReverse);
	} finally {
		setGeometryKernel(previous);
	}
});

it('batches ellipses with other supported pairs, preserves order and skips self-pairs', () => {
	const previous = getGeometryKernel();
	const segment = hydrate({ type: 'segment', p1: { x: -10, y: 0 }, p2: { x: 10, y: 0 } }, 'segment');
	const circle = hydrate({ type: 'circle', center: { x: 0, y: 0 }, radius: 5 }, 'circle');
	const ellipse = hydrate(
		{ type: 'ellipse', center: { x: 0, y: 0 }, majorAxisPoint: { x: 4, y: 0 }, minorAxisPoint: { x: 0, y: 2 } },
		'ellipse'
	);
	const pairs: Array<[GeoCurve, GeoCurve]> = [
		[segment, circle],
		[segment, ellipse],
		[circle, circle],
		[circle, segment],
	];
	const expected = pairs.map(([a, b]) => intersectCurves(a, b));
	let calls = 0;
	setGeometryKernel({
		...previous,
		intersectPairs(batch) {
			calls++;
			assert.equal(batch.length, 3);
			return previous.intersectPairs(batch);
		},
	});
	try {
		const actual = intersectCurvePairs(pairs);
		assert.equal(calls, 1);
		actual.forEach((points, i) => assertPoints(points, expected[i]));
		assert.deepEqual(intersectCurvePairs([]), []);
		assert.equal(calls, 1);
	} finally {
		setGeometryKernel(previous);
	}
});

it('rejects incompatible backend versions without replacing the working kernel', () => {
	const previous = getGeometryKernel();
	for (const apiVersion of Array.from({ length: GEOMETRY_KERNEL_API_VERSION - 1 }, (_, i) => i + 1)) {
		assert.throws(() => setGeometryKernel({ ...previous, apiVersion } as unknown as GeometryKernel), /API version/);
		assert.equal(getGeometryKernel(), previous);
		assert.throws(
			() =>
				createWasmGeometryKernel({
					api_version: () => apiVersion,
					intersect_pairs: () => new Float64Array(),
				} as unknown as WasmKernelBindings),
			/API version/
		);
	}
});

it('rejects malformed packed results at the WASM boundary', () => {
	const pair: IntersectionPair = {
		a: { type: 'circle', center: { x: 0, y: 0 }, radius: 1 },
		b: { type: 'circle', center: { x: 2, y: 0 }, radius: 1 },
	};
	for (const output of [[], [-1], [3], [1, 0], [0, 1], [0.5], [1, NaN, 0], [1, 0, Infinity]]) {
		const kernel = createWasmGeometryKernel({
			api_version: () => GEOMETRY_KERNEL_API_VERSION,
			intersect_pairs: () => new Float64Array(output),
			spline_geometry: () => new Float64Array(),
			find_regions_packed: () => new Float64Array([0]),
			curve_editing: () => new Float64Array([0]),
			fillet_geometry: () => new Float64Array([0]),
			chamfer_geometry: () => new Float64Array([0]),
			offset_geometry: () => new Float64Array([0]),
			curve_path: () => new Float64Array(),
			resize_offset_spline: () => new Float64Array(),
			trace_image: () => new Float64Array(),
			topology_queries: () => new Float64Array(),
			text_geometry: () => new Float64Array(),
			construct_geometry: () => new Float64Array(),
			constraint_dependency: () => new Float64Array(),
			inspect_constraints: () => new Float64Array(),
			transform_geometry: () => new Float64Array(),
			copy_geometry: () => new Float64Array(),
			trace_postprocess: () => new Float64Array(),
			constraint_max_errors: () => new Float64Array(),
			solve_system: () => new Float64Array(),
		});
		assert.throws(() => kernel.intersectPairs([pair]), /WASM intersection/);
	}
});

function assertPointOnCurve(p: Point2, curve: KernelCurve, tol = 1e-6): void {
	assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
	if (curve.type === 'segment') {
		const dx = curve.p2.x - curve.p1.x,
			dy = curve.p2.y - curve.p1.y;
		const lenSq = dx * dx + dy * dy;
		const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - curve.p1.x) * dx + (p.y - curve.p1.y) * dy) / lenSq)) : 0;
		const dist = Math.hypot(p.x - (curve.p1.x + t * dx), p.y - (curve.p1.y + t * dy));
		assert.ok(dist < tol, `segment residual ${dist}`);
	} else if (curve.type === 'circle') {
		const err = Math.abs(Math.hypot(p.x - curve.center.x, p.y - curve.center.y) - curve.radius);
		assert.ok(err < tol, `circle residual ${err}`);
	} else if (curve.type === 'ellipse') {
		const ux = curve.majorAxisPoint.x - curve.center.x,
			uy = curve.majorAxisPoint.y - curve.center.y;
		const vx = curve.minorAxisPoint.x - curve.center.x,
			vy = curve.minorAxisPoint.y - curve.center.y;
		const rx = Math.hypot(ux, uy),
			ry = Math.hypot(vx, vy);
		if (rx > 1e-6 && ry > 1e-6) {
			const dx = p.x - curve.center.x,
				dy = p.y - curve.center.y;
			const lx = (dx * ux + dy * uy) / (rx * rx);
			const ly = (dx * vx + dy * vy) / (ry * ry);
			const err = Math.abs(lx * lx + ly * ly - 1);
			assert.ok(err < Math.max(tol, 1e-3), `ellipse residual ${err}`);
		}
	}
}

it('WASM intersects 1500 deterministic segment/circle pairs accurately without mutating inputs', () => {
	assert.equal(getGeometryKernel().backend, 'wasm');
	let seed = 5489;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const point = () => ({ x: random() * 200 - 100, y: random() * 200 - 100 });
	const curve = (): KernelCurve =>
		random() < 0.5
			? { type: 'segment', p1: point(), p2: point() }
			: { type: 'circle', center: point(), radius: random() * 100 };
	const pairs = Array.from({ length: 1500 }, () => ({ a: curve(), b: curve() }));
	const before = structuredClone(pairs);
	const actual = getGeometryKernel().intersectPairs(pairs);
	assert.equal(actual.length, pairs.length);
	let total = 0;
	actual.forEach((points, i) => {
		total += points.length;
		for (const p of points) {
			assertPointOnCurve(p, pairs[i].a);
			assertPointOnCurve(p, pairs[i].b);
		}
	});
	assert.ok(total > 500);
	assert.deepEqual(pairs, before);
	assert.deepEqual(getGeometryKernel().intersectPairs([]), []);
});

it('WASM intersects 1200 deterministic ellipse pairs accurately without mutating inputs', () => {
	let seed = 8187;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const point = () => ({ x: random() * 40 - 20, y: random() * 40 - 20 });
	const ellipse = (): Extract<KernelCurve, { type: 'ellipse' }> => {
		const center = point(),
			rx = 1 + random() * 20,
			ry = 1 + random() * 20;
		const angle = random() * Math.PI * 2;
		return {
			type: 'ellipse',
			center,
			majorAxisPoint: { x: center.x + rx * Math.cos(angle), y: center.y + rx * Math.sin(angle) },
			minorAxisPoint: { x: center.x - ry * Math.sin(angle), y: center.y + ry * Math.cos(angle) },
		};
	};
	const pairs: IntersectionPair[] = Array.from({ length: 1200 }, (_, i) => {
		const a = ellipse();
		const b: KernelCurve =
			i % 3 === 0
				? ellipse()
				: i % 3 === 1
					? { type: 'circle', center: point(), radius: 1 + random() * 20 }
					: { type: 'segment', p1: point(), p2: point() };
		return i % 2 === 0 ? { a, b } : { a: b, b: a };
	});
	const before = structuredClone(pairs);
	const actual = getGeometryKernel().intersectPairs(pairs);
	assert.equal(actual.length, pairs.length);
	let total = 0;
	actual.forEach((points, i) => {
		total += points.length;
		for (const p of points) {
			assertPointOnCurve(p, pairs[i].a, 1e-3);
			assertPointOnCurve(p, pairs[i].b, 1e-3);
		}
	});
	assert.ok(total > 400);
	assert.deepEqual(pairs, before);
});

it('WASM intersects 600 deterministic cubic pairs accurately without mutating inputs', () => {
	let seed = 2517;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const point = () => ({ x: random() * 20 - 10, y: random() * 20 - 10 });
	const cubic = (): Extract<KernelCurve, { type: 'bezier' }> => ({
		type: 'bezier',
		points: [point(), point(), point(), point()],
	});
	const pairs: IntersectionPair[] = Array.from({ length: 600 }, (_, i) => {
		const a = cubic();
		let b: KernelCurve;
		if (i % 4 === 0) b = cubic();
		else if (i % 4 === 1) b = { type: 'circle', center: point(), radius: 1 + random() * 10 };
		else if (i % 4 === 2) b = { type: 'segment', p1: point(), p2: point() };
		else {
			const center = point(),
				rx = 1 + random() * 10,
				ry = 1 + random() * 10,
				angle = random() * Math.PI * 2;
			b = {
				type: 'ellipse',
				center,
				majorAxisPoint: { x: center.x + rx * Math.cos(angle), y: center.y + rx * Math.sin(angle) },
				minorAxisPoint: { x: center.x - ry * Math.sin(angle), y: center.y + ry * Math.cos(angle) },
			};
		}
		return i % 2 === 0 ? { a, b } : { a: b, b: a };
	});
	const before = structuredClone(pairs);
	const actual = getGeometryKernel().intersectPairs(pairs);
	assert.equal(actual.length, pairs.length);
	let total = 0;
	actual.forEach((points, i) => {
		total += points.length;
		for (const p of points) {
			assertPointOnCurve(p, pairs[i].a, 1e-3);
			assertPointOnCurve(p, pairs[i].b, 1e-3);
		}
	});
	assert.ok(total > 100);
	assert.deepEqual(pairs, before);
});

it('finds small-feature circle and multiple segment crossings within a single coarse sample interval', () => {
	const longCubic: Extract<KernelCurve, { type: 'bezier' }> = {
		type: 'bezier',
		points: [
			{ x: 0, y: 0 },
			{ x: 333, y: 0.02 },
			{ x: 666, y: -0.02 },
			{ x: 1000, y: 0 },
		],
	};
	const smallCircle: KernelCurve = { type: 'circle', center: { x: 317.123, y: 0 }, radius: 0.005 };

	// y(t) = 1e4 * (t - 0.01)(t - 0.03)(t - 0.05) places all 3 crossings inside [0, 1/16].
	const y0 = -0.000015 * 1e4;
	const y1 = (-0.000015 + 0.0023 / 3) * 1e4;
	const y2 = (-0.000015 + (2 * 0.0023) / 3 - 0.09 / 3) * 1e4;
	const y3 = (1 - 0.09 + 0.0023 - 0.000015) * 1e4;
	const tripleCubic: Extract<KernelCurve, { type: 'bezier' }> = {
		type: 'bezier',
		points: [
			{ x: 0, y: y0 },
			{ x: 1 / 3, y: y1 },
			{ x: 2 / 3, y: y2 },
			{ x: 1, y: y3 },
		],
	};
	const axisLine: KernelCurve = { type: 'segment', p1: { x: -1, y: 0 }, p2: { x: 2, y: 0 } };

	const tsStar = 1 / Math.sqrt(3);
	const tanCubic: Extract<KernelCurve, { type: 'bezier' }> = {
		type: 'bezier',
		points: [
			{ x: 0, y: 10 * tsStar * tsStar },
			{ x: 1 / 3, y: 10 * (tsStar * tsStar - (2 * tsStar) / 3) },
			{ x: 2 / 3, y: 10 * (tsStar * tsStar - (4 * tsStar) / 3 + 1 / 3) },
			{ x: 1, y: 10 * (tsStar * tsStar - 2 * tsStar + 1) },
		],
	};

	const sharedJoin = { x: 49.61295834866398, y: -25.76020358468419 };
	const nearTangentCubicA: Extract<KernelCurve, { type: 'bezier' }> = {
		type: 'bezier',
		points: [
			sharedJoin,
			{ x: 42.44238510289348, y: -2.9859618798756253 },
			{ x: 9.583250450170045, y: 17.444397623456208 },
			{ x: 4.443064009924984e-19, y: 40.00009685405597 },
		],
	};
	const nearTangentCubicB: Extract<KernelCurve, { type: 'bezier' }> = {
		type: 'bezier',
		points: [
			{ x: 40.999982253826545, y: -56.49998319368469 },
			{ x: 51.06022153273804, y: -45.59769745530476 },
			{ x: 52.66908742069694, y: -35.46668336925695 },
			sharedJoin,
		],
	};

	const pairs: IntersectionPair[] = [
		{ a: longCubic, b: smallCircle },
		{ a: tripleCubic, b: axisLine },
		{ a: tanCubic, b: axisLine },
		{ a: nearTangentCubicA, b: nearTangentCubicB },
	];
	const [circleHits, tripleHits, tanHits, nearTangentHits] = getGeometryKernel().intersectPairs(pairs);
	assert.equal(circleHits.length, 2);
	for (const p of circleHits) assert.ok(Math.abs(Math.hypot(p.x - 317.123, p.y) - 0.005) < 1e-10);
	assert.equal(tripleHits.length, 3);
	assertPoints(tripleHits, [
		{ x: 0.01, y: 0 },
		{ x: 0.03, y: 0 },
		{ x: 0.05, y: 0 },
	]);
	assert.equal(tanHits.length, 1);
	assert.ok(Math.abs(tanHits[0].x - tsStar) < 1e-6);
	assert.ok(Math.abs(tanHits[0].y) < 1e-10);
	assert.equal(nearTangentHits.length, 1);
	assert.ok(Math.hypot(nearTangentHits[0].x - sharedJoin.x, nearTangentHits[0].y - sharedJoin.y) < 1e-9);
});

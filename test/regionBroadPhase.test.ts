import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { getRegionCurveBounds, regionBoundsMayIntersect } from '../src/math/regionBroadPhase';
import {
	intersectCurvePairs,
	type GeoCurve,
	type GeoCircle,
	type GeoEllipse,
	type GeoSpline,
} from '../src/math/intersection';
import { findCurveRegions } from '../src/math/regions';
import { Vec2 } from '../src/math/vector';

const circle = (id: string, x: number, y: number, radius: number): GeoCircle => ({
	type: 'circle',
	id,
	centerId: `${id}-center`,
	center: new Vec2(x, y),
	radius,
});
const segment = (id: string, x1: number, y1: number, x2: number, y2: number): GeoCurve => ({
	type: 'segment',
	id,
	p1: new Vec2(x1, y1),
	p2: new Vec2(x2, y2),
});
const ellipse = (id: string, x: number, y: number, rx: number, ry: number, angle = 0): GeoEllipse => ({
	type: 'ellipse',
	id,
	centerId: `${id}-center`,
	center: new Vec2(x, y),
	majorAxisPointId: `${id}-major`,
	minorAxisPointId: `${id}-minor`,
	majorAxisPoint: new Vec2(x + rx * Math.cos(angle), y + rx * Math.sin(angle)),
	minorAxisPoint: new Vec2(x - ry * Math.sin(angle), y + ry * Math.cos(angle)),
});
const spline = (id: string, points: Vec2[]): GeoSpline => ({
	type: 'spline',
	id,
	splineType: 'control',
	points,
	pointIds: [],
	bezierSegments: [points as GeoSpline['bezierSegments'][number]],
});
const retained = (a: GeoCurve, b: GeoCurve) =>
	regionBoundsMayIntersect(a, b, getRegionCurveBounds(a), getRegionCurveBounds(b));

test('region rejection preserves tolerated contacts, long segment extensions and large conic near roots', () => {
	const pairs: Array<[GeoCurve, GeoCurve]> = [
		[segment('long', 0, 0, 1e6, 0), segment('extension', 1e6 + 5, -1, 1e6 + 5, 1)],
		[circle('circle', 0, 0, 1), segment('tangent', -2, 1 + 5e-6, 2, 1 + 5e-6)],
		[
			spline(
				'near-circle',
				[0, 1, 2, 3].map(x => new Vec2(x, 1 + 5e-5))
			),
			circle('near-root', 0, 0, 1),
		],
		[
			spline(
				'near-line',
				[0, 1, 2, 3].map(x => new Vec2(x, 5e-5))
			),
			segment('line', -1, 0, 4, 0),
		],
		[ellipse('large', 0, 0, 1e6, 1e6), ellipse('large-near', 2e6 + 20, 0, 1e6, 1e6)],
		[segment('tiny-segment', -1e-3, 1, 1e-3, 1), ellipse('tiny-ellipse', 0, 0, 1e-3, 1e-3)],
	];
	for (const [a, b] of pairs) {
		assert.ok(intersectCurvePairs([[a, b]])[0].length > 0, `${a.id}: exact reference must accept the contact`);
		assert.ok(retained(a, b), a.id);
		assert.ok(retained(b, a), a.id);
	}
});

test('spline hull bounds include interior extrema and arc bounds retain contacts outside a tight endpoint box', () => {
	const curve = spline('bulge', [new Vec2(0, 0), new Vec2(10, 12), new Vec2(10, 12), new Vec2(0, 0)]);
	const cutter = segment('cutter', 5, 0, 5, 15);
	assert.ok(intersectCurvePairs([[curve, cutter]])[0].length > 0);
	assert.ok(retained(curve, cutter));
	const arc: GeoCurve = {
		...circle('arc', 0, 0, 10),
		type: 'arc',
		startPointId: 'start',
		endPointId: 'end',
		start: new Vec2(10, 0),
		end: new Vec2(0, 10),
		clockwise: true,
	};
	assert.ok(retained(arc, segment('arc-tangent', -1, -10, 1, -10)));
});

test('unknown or invalid bounds keep exact intersection validation reachable', () => {
	const invalid = circle('invalid', NaN, 0, 1),
		far = circle('far', 1e6, 0, 1);
	assert.equal(getRegionCurveBounds(invalid), null);
	assert.ok(retained(invalid, far));
	assert.equal(getRegionCurveBounds(spline('empty', [])), null);
	assert.equal(getRegionCurveBounds(circle('negative', 0, 0, -1)), null);
});

test('rejected mixed-curve pairs have no exact hits in either operand order across scales', () => {
	let seed = 0x39b12;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	let rejected = 0,
		contacts = 0;
	for (const [scale, offset] of [
		[1e-3, 0],
		[1, 0],
		[1e6, 0],
		[10, 1e9],
	]) {
		const curves: GeoCurve[] = Array.from({ length: 36 }, (_, i) => {
			const x = offset + (random() - 0.5) * scale * 20,
				y = offset + (random() - 0.5) * scale * 20;
			const radius = (0.2 + random() * 2) * scale,
				angle = random() * Math.PI * 2,
				id = `curve-${i}`;
			switch (i % 6) {
				case 0:
					return segment(id, x - radius, y, x + radius, y + radius);
				case 1:
					return circle(id, x, y, radius);
				case 2:
					return ellipse(id, x, y, radius, radius * 0.3, angle);
				case 3:
					return {
						...circle(id, x, y, radius),
						type: 'arc',
						start: new Vec2(x + radius, y),
						end: new Vec2(x, y - radius),
						clockwise: i % 2 === 0,
						startPointId: 'start',
						endPointId: 'end',
					};
				case 4:
					return {
						...ellipse(id, x, y, radius, radius * 0.3, angle),
						type: 'elliptical_arc',
						start: new Vec2(x + radius, y),
						end: new Vec2(x, y - radius),
						clockwise: true,
						startPointId: 'start',
						endPointId: 'end',
					};
				default:
					return spline(id, [
						new Vec2(x - radius, y),
						new Vec2(x + radius, y + radius * 3),
						new Vec2(x - radius, y - radius * 3),
						new Vec2(x + radius, y),
					]);
			}
		});
		for (let i = 0; i < curves.length; i++)
			for (let j = i + 1; j < curves.length; j++) {
				const pairs = [
					[curves[i], curves[j]],
					[curves[j], curves[i]],
				] as const;
				const hits = intersectCurvePairs(pairs);
				for (let k = 0; k < pairs.length; k++) {
					if (hits[k].length) contacts++;
					if (!retained(...pairs[k])) {
						rejected++;
						assert.equal(hits[k].length, 0, `${scale}/${offset}: ${pairs[k][0].id}/${pairs[k][1].id}`);
					}
				}
			}
	}
	assert.ok(rejected > 1000);
	assert.ok(contacts > 20);
});

test('region integration skips disjoint exact queries while preserving nested holes and tangent faces', () => {
	const previous = getGeometryKernel();
	let exactPairs = 0;
	setGeometryKernel({
		...previous,
		findRegions: undefined,
		intersectPairs(pairs) {
			exactPairs += pairs.length;
			return previous.intersectPairs(pairs);
		},
	});
	try {
		const disjoint = Array.from({ length: 32 }, (_, i) => circle(`circle-${i}`, i * 100, 0, 1));
		assert.equal(findCurveRegions(disjoint).length, 32);
		assert.equal(exactPairs, 0);
		const nested = findCurveRegions([circle('outer', 0, 0, 10), circle('inner', 0, 0, 2)]);
		assert.equal(nested.length, 2);
		assert.equal(nested.filter(region => region.holes.length === 1).length, 1);
		const tangent = findCurveRegions([circle('left', 0, 0, 1), circle('right', 2, 0, 1)]);
		assert.equal(tangent.length, 2);
		assert.ok(exactPairs > 0);
	} finally {
		setGeometryKernel(previous);
	}
});

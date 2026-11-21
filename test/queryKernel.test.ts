import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmQueryKernel } from '../src/kernel/queryWasm';
import type { QueryCurve } from '../src/kernel/queryTypes';
import { getQueryKernel } from '../src/math/queries';
import { pointInRegion } from '../src/math/regions';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { Viewport } from '../src/canvas/viewport';
import { snapPrimitives } from '../src/canvas/geometryQueries';
import { findClosest, findTrimTargetNear, findLineNear } from '../src/canvas/hitTesting';
import { findSnapTarget } from '../src/canvas/snapping';
import { SelectTool } from '../src/canvas/tools/selection/select';

const p = (x: number, y: number) => new Vec2(x, y);
const curves: QueryCurve[] = [
	{ id: 'line', type: 'segment', p1: p(-20, 3), p2: p(30, 15) },
	{ id: 'point-line', type: 'segment', p1: p(4, 5), p2: p(4, 5) },
	{ id: 'circle', type: 'circle', center: p(12, -7), radius: 18 },
	{ id: 'tiny-circle', type: 'circle', center: p(0, 0), radius: 0 },
	...[false, true].flatMap(clockwise => [
		{ id: 'arc', type: 'arc' as const, center: p(0, 0), radius: 20, start: p(20, 0), end: p(0, 20), clockwise },
		{
			id: 'ea',
			type: 'elliptical_arc' as const,
			center: p(3, 4),
			majorAxisPoint: p(23, 15),
			minorAxisPoint: p(-2, 13),
			start: p(23, 15),
			end: p(-2, 13),
			clockwise,
		},
	]),
	{ id: 'ellipse', type: 'ellipse', center: p(3, 4), majorAxisPoint: p(23, 15), minorAxisPoint: p(-2, 13) },
	{ id: 'flat', type: 'ellipse', center: p(3, 4), majorAxisPoint: p(3, 4), minorAxisPoint: p(8, 12) },
	{ id: 'tiny', type: 'ellipse', center: p(0, 0), majorAxisPoint: p(0.05, 0), minorAxisPoint: p(0, 0.07) },
	{
		id: 'spline',
		type: 'spline',
		bezierSegments: [
			[p(-20, 0), p(-10, 40), p(10, -40), p(20, 0)],
			[p(20, 0), p(40, 30), p(30, 40), p(0, 20)],
		],
	},
	{ id: 'empty', type: 'spline', bezierSegments: [] },
];
function compare(actual: any, expected: any, path = '') {
	if (typeof expected === 'number') {
		assert.ok(
			typeof actual === 'number' && Math.abs(actual - expected) < 1e-7 + Math.abs(expected) * 1e-10,
			`${path}: ${actual} != ${expected}`
		);
		return;
	}
	if (expected == null || typeof expected !== 'object') {
		assert.equal(actual, expected, path);
		return;
	}
	assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
	for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
}
const plain = (v: any) => JSON.parse(JSON.stringify(v));

test('batch bounds, hits, snapping and both box modes stay mutually consistent across all curve types', () => {
	const kernel = getQueryKernel();
	const bounds = kernel.bounds(curves);
	assert.equal(bounds.length, curves.length);
	curves.forEach((curve, i) => {
		const b = bounds[i];
		if (curve.type === 'spline' && !curve.bezierSegments.length) {
			assert.equal(b, null);
			return;
		}
		assert.ok(b && b.min.x <= b.max.x && b.min.y <= b.max.y, curve.id);
	});
	compare(bounds[0], { min: { x: -20, y: 3 }, max: { x: 30, y: 15 } }, 'line bounds');
	compare(bounds[2], { min: { x: -6, y: -25 }, max: { x: 30, y: 11 } }, 'circle bounds');
	for (let x = -32; x <= 32; x += 8)
		for (let y = -32; y <= 32; y += 8) {
			const point = p(x, y);
			const distances = kernel.distances(curves, point, 18);
			assert.equal(distances.length, curves.length);
			const hit = kernel.closest(curves, point, 18, false);
			const minIdx = distances.reduce(
				(best, d, i) => (d !== null && d < 18 && (best === -1 || d < distances[best]!) ? i : best),
				-1
			);
			if (minIdx === -1) assert.equal(hit, null);
			else {
				assert.ok(hit && hit.distance <= distances[minIdx]! + 1e-9);
			}
			const crossing = kernel.box(curves, point, p(x + 7, y + 5), false);
			const contained = kernel.box(curves, point, p(x + 7, y + 5), true);
			assert.equal(crossing.length, curves.length);
			assert.equal(contained.length, curves.length);
			for (let i = 0; i < curves.length; i++) {
				if (contained[i] && curves[i].id !== 'empty')
					assert.equal(crossing[i], true, `contained must imply crossing for ${curves[i].id}`);
			}
		}
	assert.deepEqual(kernel.bounds([]), []);
	assert.deepEqual(kernel.box([], p(0, 0), p(1, 1), false), []);
	assert.equal(kernel.closest([], p(0, 0), 18), null);
});

test('closest retains first ties and shrinks arc angular tolerance after earlier hits', () => {
	const kernel = getQueryKernel(),
		point = p(20 * Math.cos(-0.1), 20 * Math.sin(-0.1));
	const line: QueryCurve = {
		id: 'line',
		type: 'segment',
		p1: p(point.x - 5, point.y + 1),
		p2: p(point.x + 5, point.y + 1),
	};
	const arc = curves.find(c => c.type === 'arc' && c.clockwise)!;
	assert.equal(kernel.closest([line, line], point, 18)?.index, 0);
	assert.equal(kernel.closest([line, arc], point, 18)?.index, 0);
	assert.equal(kernel.closest([arc, line], point, 18)?.index, 0);
	const q = kernel.closest([arc], point, 18, true)!;
	// Preserve the circular arc's existing wrap-to-end snap behavior.
	compare(q.point, p(0, 20));
	const ea: QueryCurve = {
		id: 'ea',
		type: 'elliptical_arc',
		center: p(0, 0),
		majorAxisPoint: p(20, 0),
		minorAxisPoint: p(0, 10),
		start: p(20, 0),
		end: p(0, 10),
		clockwise: true,
	};
	compare(kernel.closest([ea], point, 18, true)?.point, p(20, 0));
});

test('region batch preserves holes, reversed rings, empty polygons and boundary convention', () => {
	const outer = [p(0, 0), p(20, 0), p(20, 20), p(0, 20)],
		hole = [p(5, 5), p(15, 5), p(15, 15), p(5, 15)];
	const regions = [
		{ points: outer, holes: [hole], area: 300, path: '' },
		{ points: [...outer].reverse(), holes: [], area: 400, path: '' },
		{ points: [], holes: [], area: 0, path: '' },
	];
	for (let x = -1; x <= 21; x++)
		for (let y = -1; y <= 21; y++) {
			const point = p(x, y);
			const result = getQueryKernel().contains(regions, point);
			assert.equal(pointInRegion(point, regions[0]), result[0]);
			assert.equal(result[2], false);
			if (x > 0 && x < 20 && y > 0 && y < 20) {
				assert.equal(result[1], true);
				if (x > 5 && x < 15 && y > 5 && y < 15) assert.equal(result[0], false);
				if (x < 5 || x > 15 || y < 5 || y > 15) assert.equal(result[0], true);
			} else if (x < 0 || x > 20 || y < 0 || y > 20) {
				assert.equal(result[0], false);
				assert.equal(result[1], false);
			}
		}
	assert.deepEqual(getQueryKernel().contains([], p(0, 0)), []);
});

function scene() {
	const sketch = new SketchDocument(),
		viewport = new Viewport(800, 600);
	const a = sketch.addPoint(p(30, 20)),
		b = sketch.addPoint(p(80, 20)),
		c = sketch.addPoint(p(100, 30));
	const line = sketch.addLine(a.id, b.id),
		circle = sketch.addCircle(c.id, 20);
	const start = sketch.addPoint(p(120, 30)),
		end = sketch.addPoint(p(100, 50));
	sketch.addArc(c.id, start.id, end.id, 20, true);
	const major = sketch.addPoint(p(125, 40)),
		minor = sketch.addPoint(p(95, 45));
	sketch.addEllipse(c.id, major.id, minor.id);
	sketch.addEllipticalArc(c.id, major.id, minor.id, major.id, minor.id, true);
	sketch.addFitSpline([a.id, c.id, major.id]);
	return { sketch, viewport, line, circle };
}

test('screen-space batch snapping matches primitive methods across zoom, pan and skew axes', () => {
	const { sketch, viewport } = scene(),
		items = [...sketch.getCurvePrimitives()];
	for (const zoom of [0.05, 1, 8]) {
		viewport.zoom = zoom;
		viewport.panX = 123;
		viewport.panY = 87;
		for (let x = 25; x < 140; x += 7)
			for (let y = 15; y < 55; y += 7) {
				const screen = viewport.worldToScreen(p(x, y));
				let expected: any = null,
					max = 18;
				for (const item of items) {
					const q = item.snapTo(screen, sketch, viewport, max, 18);
					if (q && q.dist < max) {
						expected = q;
						max = q.dist;
					}
				}
				const actual = snapPrimitives(items, sketch, viewport, screen, 18);
				compare(plain(actual), plain(expected));
			}
	}
});

test('custom distance and snap overrides preserve polymorphic dispatch', () => {
	const { sketch, viewport, line, circle } = scene(),
		screen = p(0, 0);
	line.distanceTo = () => 2;
	circle.distanceTo = () => 1;
	assert.equal(findClosest(sketch, viewport, [line, circle], screen, 18), circle);
	const candidate = { id: line.id, type: 'line' as const, dist: 1, screenPos: screen, worldPos: p(1, 1) };
	line.snapTo = () => candidate;
	circle.snapTo = () => null;
	assert.equal(snapPrimitives([line, circle], sketch, viewport, screen, 18), candidate);
	line.toGeoCurve = () => {
		throw new Error('custom crossing selection must not request a curve');
	};
	line.intersectsAABB = () => true;
	SelectTool.performBoxSelection(sketch, viewport, p(20, 20), p(0, 0), false, 'select');
	assert.ok(sketch.selection.lineIds.has(line.id));
});

test('WASM batches editor hit, snap and box queries without per-curve numerical callbacks', {
	skip: !getGeometryKernel().queries,
}, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel(),
		{ sketch, viewport, line } = scene();
	let calls = 0;
	const kernel = createWasmGeometryKernel({
		...bindings,
		geometry_queries(data, settings) {
			calls++;
			return bindings.geometry_queries(data, settings);
		},
	});
	try {
		setGeometryKernel(kernel);
		const before = plain(sketch.takeSnapshot()),
			history = [sketch.canUndo(), sketch.canRedo()];
		const screen = viewport.worldToScreen(p(55, 21));
		assert.equal(findLineNear(sketch, viewport, screen, 'select')?.id, line.id);
		assert.equal(calls, 1);
		calls = 0;
		const snap = findSnapTarget(sketch, viewport, screen, {
			activeTool: 'select',
			isSnapModifierPressed: false,
			isSnappingEnabled: false,
		});
		assert.equal(snap?.id, line.id);
		assert.equal(calls, 1);
		calls = 0;
		assert.equal(findTrimTargetNear(sketch, viewport, screen)?.id, line.id);
		assert.equal(calls, 1);
		calls = 0;
		const min = viewport.worldToScreen(p(20, 60)),
			max = viewport.worldToScreen(p(140, 10));
		SelectTool.performBoxSelection(sketch, viewport, min, max, false, 'select');
		assert.equal(calls, 1);
		assert.ok(sketch.selection.lineIds.has(line.id));
		// Queries and selection do not rewrite geometry or history.
		assert.deepEqual(plain(sketch.takeSnapshot()), before);
		assert.deepEqual([sketch.canUndo(), sketch.canRedo()], history);
	} finally {
		setGeometryKernel(previous);
	}
});

test('WASM query adapter rejects malformed responses', () => {
	for (const data of [[], [2, 0, 0, 1, 1], [1, 0, 0, NaN, 1], [1, 2, 0, 1, 1], [0, 0, 0, 1, 1]])
		assert.throws(() => createWasmQueryKernel(() => new Float64Array(data)).bounds([curves[0]]), /WASM/);
	for (const data of [
		[0.5, 0, 0, 0, 0],
		[100, 0, 0, 0, 0],
		[-1, 1, 0, 0, 0],
		[0, -1, 0, 0, 0],
		[0, 18, 0, 0, 0],
		[0, 0, 0, 0, 2],
	])
		assert.throws(
			() => createWasmQueryKernel(() => new Float64Array(data)).closest([curves[0]], p(0, 0), 18, true),
			/WASM/
		);
	assert.throws(
		() => createWasmQueryKernel(() => new Float64Array([2])).box([curves[0]], p(0, 0), p(1, 1), false),
		/WASM/
	);
});

test('native query decoder rejects malformed settings and truncated curve/region buffers', {
	skip: !getGeometryKernel().queries,
}, async () => {
	const { geometry_queries: query } = await import('../public/kernel/sketcher_wasm.js');
	for (const settings of [[], [7, 0, 0, 0, 0], [1, NaN, 0, 1, 0], [2, 0, 0, -1, 0], [4, 1, 1, 0, 0]])
		assert.throws(() => query(new Float64Array([]), new Float64Array(settings)), /query/);
	for (const data of [[], [1], [1, 1], [1, 1, 3, 0, 0], [1, 0], [0, 1], [1, 1, 2 ** 32]])
		assert.throws(() => query(new Float64Array(data), new Float64Array([6, 0, 0, 0, 0])), /query|ring/);
});

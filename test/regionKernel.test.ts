import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmRegionKernel, packRegionCurves } from '../src/kernel/regionWasm';
import { findCurveRegions, type SketchRegion } from '../src/math/regions';
import { findCurveRegions as reference } from '../src/math/regionsReference';
import { getAllGeoCurves, type GeoCurve } from '../src/math/intersection';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { createBenchmarkScene, dragTarget } from '../benchmarks/scenes';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/kernelRegions.json', import.meta.url), 'utf8')) as {
	sourceSha256: string;
	cases: Array<{ name: string; curves: GeoCurve[]; expected: SketchRegion[] }>;
};
function hydrate(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(hydrate);
	if (value && typeof value === 'object') {
		if ('x' in value && 'y' in value) return Vec2.from(value as Vec2);
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrate(v)]));
	}
	return value;
}
function close(a: number, b: number, tolerance = 1e-7) {
	assert.ok(Math.abs(a - b) <= tolerance + Math.abs(b) * 1e-10, `${a} != ${b}`);
}
function compare(actual: SketchRegion[], expected: SketchRegion[]) {
	assert.equal(actual.length, expected.length, 'face count');
	for (let i = 0; i < actual.length; i++) {
		const a = actual[i],
			b = expected[i];
		close(a.area, b.area);
		assert.equal(a.holes.length, b.holes.length, 'hole count');
		const aa = [a.points, ...a.holes],
			bb = [b.points, ...b.holes];
		for (let r = 0; r < aa.length; r++) {
			assert.equal(aa[r].length, bb[r].length, 'ring vertex count');
			for (let j = 0; j < aa[r].length; j++) {
				close(aa[r][j].x, bb[r][j].x);
				close(aa[r][j].y, bb[r][j].y);
			}
		}
		const tokens = a.path.split(' '),
			expectedTokens = b.path.split(' ');
		assert.equal(tokens.length, expectedTokens.length, 'SVG command structure');
		for (let j = 0; j < tokens.length; j++) {
			if (Number.isNaN(Number(tokens[j])) || Number.isNaN(Number(expectedTokens[j])))
				assert.equal(tokens[j], expectedTokens[j]);
			else close(Number(tokens[j]), Number(expectedTokens[j]), 1.01e-5);
		}
	}
}
test('region fixtures identify the unchanged pre-native TypeScript source', () => {
	assert.equal(
		createHash('sha256')
			.update(readFileSync(new URL('../src/math/regionsReference.ts', import.meta.url)))
			.digest('hex'),
		fixtures.sourceSha256
	);
});
describe('region topology and exact boundaries captured before native routing', () => {
	for (const fixture of fixtures.cases)
		test(fixture.name, () => {
			const curves = hydrate(fixture.curves) as GeoCurve[],
				saved = JSON.stringify(curves);
			const actual = findCurveRegions(curves);
			compare(actual, fixture.expected);
			assert.equal(JSON.stringify(curves), saved, 'input curves remain unchanged');
			for (const region of actual) assert.ok(region.points.every(p => p instanceof Vec2));
		});
});

test('native regions match the frozen reference on 24 dragged benchmark states', {
	skip: !getGeometryKernel().findRegions,
}, () => {
	const native = getGeometryKernel();
	try {
		for (const family of ['rectangles', 'splines'] as const)
			for (const size of ['small', 'medium', 'large'] as const) {
				const scene = createBenchmarkScene(family, size),
					sketch = new SketchDocument();
				sketch.restoreSnapshot(scene.snapshot);
				for (const i of [0, 3, 12, 29]) {
					const target = dragTarget(scene, i, 30);
					sketch.dragPoint(scene.dragPointId, target.x, target.y);
					const curves = getAllGeoCurves(sketch).filter(c => !c.isConstruction);
					setGeometryKernel(typescriptGeometryKernel);
					const expected = reference(curves);
					setGeometryKernel(native);
					compare(findCurveRegions(curves), expected);
				}
			}
	} finally {
		setGeometryKernel(native);
	}
});

test('region result validation rejects corrupt counts, commands, flags and non-finite coordinates', () => {
	const points = [0, 0, 1, 0, 0, 1];
	const output = (commands: number[]) => [1, 1, 1, 3, ...points, commands.length, ...commands];
	const bad = [
		[],
		[NaN],
		[0, 1],
		[1],
		[1, 1, 0],
		output([0, 0, 0, 1, 1, 4]), // final coordinate 4 is not a close command
		output([0, 0, 0, 4, 4]),
		output([1, 0, 0, 4]),
		output([0, 0, 0, 9, 4]),
		output([0, 0, 0, 2, 0, 0, 4]),
		output([0, NaN, 0, 4]),
		output([0, 0, 0, 3, -1, 1, 0, 0, 1, 0, 0, 4]),
		output([0, 0, 0, 3, 1, 1, 0, 0.5, 1, 0, 0, 4]),
	];
	const curves: GeoCurve[] = [{ type: 'segment', id: 'a', p1: new Vec2(), p2: new Vec2(1, 1) }];
	for (const data of bad)
		assert.throws(() => createWasmRegionKernel(() => new Float64Array(data))(curves), /WASM region/);
	assert.deepEqual(createWasmRegionKernel(() => new Float64Array([0]))(curves), []);
});

test('region packing preserves duplicate identities and avoids spread limits', () => {
	const curve: GeoCurve = { type: 'circle', id: 'same', centerId: 'c', center: new Vec2(), radius: 1 };
	const buffer = packRegionCurves(
		Array.from({ length: 20000 }, (_, i) => ({ ...curve, id: i < 2 ? 'same' : String(i) }))
	);
	assert.equal(buffer.length, 20000 * 7);
	assert.equal(buffer[1], buffer[8]);
	assert.notEqual(buffer[8], buffer[15]);
});

test('native region construction uses one call with no intersection or spline callbacks', {
	skip: !getGeometryKernel().findRegions,
}, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0;
	const kernel = createWasmGeometryKernel({
		...bindings,
		find_regions_packed(data) {
			calls++;
			return bindings.find_regions_packed(data);
		},
		intersect_pairs() {
			throw new Error('unexpected intersection boundary call');
		},
		spline_geometry() {
			throw new Error('unexpected spline boundary call');
		},
	});
	try {
		setGeometryKernel(kernel);
		const fixture = fixtures.cases.find(c => c.name === 'spline-circle-closed-regions.json')!;
		compare(findCurveRegions(hydrate(fixture.curves) as GeoCurve[]), fixture.expected);
		assert.equal(calls, 1);
		assert.deepEqual(findCurveRegions([]), []);
		assert.equal(calls, 1);
		assert.throws(() => bindings.find_regions_packed(new Float64Array([0])), /region/);
		assert.throws(() => bindings.find_regions_packed(new Float64Array([1, 2 ** 32, 0, 3, 0, 0, 1])), /region/);
	} finally {
		setGeometryKernel(previous);
	}
});

test('finds all 4 regions in sketch with near-vertex spline crossings', {
	skip: !getGeometryKernel().findRegions,
}, () => {
	const curves: GeoCurve[] = [
		{
			type: 'segment',
			id: 'Line-11',
			p1: new Vec2(-70.71325976904807, -48.951669519098786),
			p2: new Vec2(-17.100982328552572, -21.52799891578571),
		},
		{
			type: 'segment',
			id: 'Line-25',
			p1: new Vec2(-17.100982328552572, -21.52799891578571),
			p2: new Vec2(74.04047285091734, 25.072922657761502),
		},
		{
			type: 'spline',
			id: 'Spline-2',
			points: [
				new Vec2(-70.71378470916424, -48.95193749047031),
				new Vec2(74.04047285089842, 25.072922657919527),
			],
			bezierSegments: [
				[
					new Vec2(-70.71378470916424, -48.95193749047031),
					new Vec2(-76.38805459910975, 31.402809214636047),
					new Vec2(9.555917968086924, 72.31449478600706),
					new Vec2(74.04047285089842, 25.072922657919527),
				],
			],
			isClosed: false,
		},
		{
			type: 'spline',
			id: 'Spline-3',
			points: [
				new Vec2(74.04047285089842, 25.072922657919527),
				new Vec2(-6.055887911150573e-14, -6.999998057749547),
				new Vec2(-41.7499107971143, -71.49998309632444),
				new Vec2(-70.71378470916424, -48.95193749047031),
			],
			bezierSegments: [
				[
					new Vec2(74.04047285089842, 25.072922657919527),
					new Vec2(81.29440434316525, -32.13563250820586),
					new Vec2(33.23648165578342, -7.10041044590254),
					new Vec2(-6.055887911150573e-14, -6.999998057749547),
				],
				[
					new Vec2(-6.055887911150573e-14, -6.999998057749547),
					new Vec2(-33.23648161240703, -6.899585669729027),
					new Vec2(-6.924328501645778, -74.75038210919845),
					new Vec2(-41.7499107971143, -71.49998309632444),
				],
				[
					new Vec2(-41.7499107971143, -71.49998309632444),
					new Vec2(-57.663650372955594, -70.01469555772024),
					new Vec2(-66.22093107343193, -61.04675276832995),
					new Vec2(-70.71378470916424, -48.95193749047031),
				],
			],
			isClosed: false,
		},
	];
	const regions = findCurveRegions(curves);
	assert.equal(regions.length, 4);
});

test('finds region enclosed by line and spline in region-issue3 sketch', {
	skip: !getGeometryKernel().findRegions,
}, () => {
	const curves: GeoCurve[] = [
		{
			type: 'segment',
			id: 'Line-11',
			p1: new Vec2(-70.71325927281734, -48.951670489171605),
			p2: new Vec2(-17.10397210470489, -21.522154268869784),
		},
		{
			type: 'spline',
			id: 'Spline-4',
			points: [
				new Vec2(-17.09658295979887, -21.51837356748017),
				new Vec2(-41.74991079711482, -71.49998309632997),
				new Vec2(-70.71378470912933, -48.95193749045716),
			],
			bezierSegments: [
				[
					new Vec2(-17.09658295979887, -21.51837356748017),
					new Vec2(-22.9479743699381, -41.22489824814197),
					new Vec2(-17.37699860943317, -73.77479616458997),
					new Vec2(-41.74991079711482, -71.49998309632997),
				],
				[
					new Vec2(-41.74991079711482, -71.49998309632997),
					new Vec2(-57.66365037295553, -70.01469555771958),
					new Vec2(-66.22093107339695, -61.046752768316956),
					new Vec2(-70.71378470912933, -48.95193749045716),
				],
			],
			isClosed: false,
		},
	];
	const regions = findCurveRegions(curves);
	assert.equal(regions.length, 1);
	const refRegions = reference(curves);
	assert.equal(refRegions.length, 1);
});



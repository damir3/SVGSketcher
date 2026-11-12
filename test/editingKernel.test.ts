import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmEditingKernel } from '../src/kernel/editingWasm';
import {
	getCurveIntersections,
	getTrimCandidate,
	executeTrim,
	executeBreak,
	getAllGeoCurves,
	type GeoCurve,
} from '../src/math/intersection';
import { findSketchRegions, pointInRegion } from '../src/math/regions';
import { findExtendCandidate, executeExtend } from '../src/math/extend';
import { getTrimCandidate as trimReference } from '../src/math/trimReference';
import { findExtendCandidate as extendReference } from '../src/math/extendReference';
import { typescriptGeometryKernel } from '../src/kernel/typescript';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/kernelEditing.json', import.meta.url), 'utf8')) as {
	sourceHashes: Record<string, string>;
	scenes: Array<{
		name: string;
		target: GeoCurve;
		others: GeoCurve[];
		intersections: unknown;
		probes: Array<{ cursor: Vec2; trim: unknown; extend: unknown }>;
	}>;
};
function hydrate(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(hydrate);
	if (value && typeof value === 'object') {
		if ('x' in value && 'y' in value) return Vec2.from(value as Vec2);
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrate(v)]));
	}
	return value;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function compare(a: unknown, b: unknown, path = '') {
	if (typeof a === 'number' && typeof b === 'number') {
		assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-8 + Math.abs(b) * 1e-10, `${path}: ${a} != ${b}`);
		return;
	}
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		assert.deepEqual(a, b, path);
		return;
	}
	assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
	for (const key of Object.keys(b)) compare(a[key], b[key], `${path}.${key}`);
}
test('editing snapshots identify the frozen pre-routing calculations', () => {
	for (const [file, hash] of Object.entries(fixtures.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(`../${file}`, import.meta.url)))
				.digest('hex'),
			hash
		);
});
describe('trim/extend candidates captured before native routing', () => {
	for (const fixture of fixtures.scenes)
		test(fixture.name, () => {
			const target = hydrate(fixture.target) as GeoCurve,
				others = hydrate(fixture.others) as GeoCurve[];
			const saved = JSON.stringify([target, others]);
			compare(plain(getCurveIntersections(target, others)), fixture.intersections, 'intersections');
			for (const probe of fixture.probes) {
				const cursor = Vec2.from(probe.cursor),
					t = getTrimCandidate(target, others, cursor)!;
				assert.equal(t.curve, target);
				assert.ok(t.cutStartWorld instanceof Vec2);
				assert.ok(t.cutEndWorld instanceof Vec2);
				const { curve, ...trim } = t;
				compare(plain(trim), probe.trim, 'trim');
				const e = findExtendCandidate(undefined as unknown as SketchDocument, target, others, cursor);
				if (e) {
					assert.equal(e.target, target);
					assert.ok(e.fromPoint instanceof Vec2);
					assert.ok(e.toPoint instanceof Vec2);
					if (e.becomesFullLoop) assert.equal(e.fromPoint, e.toPoint);
					const { target: ignored, ...extend } = e;
					compare(plain(extend), probe.extend, 'extend');
				} else assert.equal(probe.extend, null);
			}
			assert.equal(JSON.stringify([target, others]), saved, 'queries must not mutate inputs');
		});
});

test('native editing uses one query without intersection/spline callbacks and retains original cutter indices', {
	skip: !getGeometryKernel().editing,
}, async () => {
	const previous = getGeometryKernel(),
		bindings = await import('../public/kernel/sketcher_wasm.js');
	let calls = 0;
	const native = createWasmGeometryKernel({
		...bindings,
		curve_editing(curves, settings) {
			calls++;
			return bindings.curve_editing(curves, settings);
		},
		intersect_pairs() {
			throw new Error('unexpected JS intersection call');
		},
		spline_geometry() {
			throw new Error('unexpected JS spline call');
		},
	});
	try {
		setGeometryKernel(native);
		const fixture = fixtures.scenes.find(s => s.name === 'ties and behind ray')!;
		const target = hydrate(fixture.target) as GeoCurve,
			others = hydrate(fixture.others) as GeoCurve[];
		assert.equal(
			findExtendCandidate(undefined as unknown as SketchDocument, target, others, new Vec2(10, 0))!.intersectedCurveId,
			'first'
		);
		assert.equal(calls, 1);
		getTrimCandidate(target, others, new Vec2(5, 0));
		assert.equal(calls, 2);
		getCurveIntersections(target, others);
		assert.equal(calls, 3);
		assert.throws(() => bindings.curve_editing(new Float64Array(), new Float64Array([1, 0, 0, 0])), /target/);
		assert.throws(() => bindings.curve_editing(new Float64Array(), new Float64Array([3, 0, 0, 0])), /settings/);
	} finally {
		setGeometryKernel(previous);
	}
});

test('editing result validation rejects corrupt shapes, parameters, flags and source indices', () => {
	const target: GeoCurve = { type: 'segment', id: 'target', p1: new Vec2(), p2: new Vec2(10, 0) };
	const other = { ...target, id: 'other' };
	for (const output of [[], [NaN], [-1], [0, 1], [1, 0, 0, 0.5, 1], [1, 0, 0, 2, 0], [1, 0, 0, 0.5, -1]])
		assert.throws(
			() => createWasmEditingKernel(() => new Float64Array(output)).intersections(target, [target, other]),
			/WASM editing/
		);
	for (const output of [
		[],
		[0],
		[0, 2, 0, 0, 10, 0, -1, -1, 1],
		[0, 1, 0, 0, 10, 0, -2, -1, 1],
		[0, 1, 0, 0, 10, 0, -1, -1, 0.5],
		[0, 1, 0, 0, 10, 0, 0, -1, 1],
	])
		assert.throws(
			() => createWasmEditingKernel(() => new Float64Array(output)).trim(target, [other], new Vec2()),
			/WASM editing/
		);
	for (const output of [
		[],
		[1],
		[1, 2, 0, 0, 10, 0, -1, 0],
		[1, 0, NaN, 0, 10, 0, -1, 0],
		[1, 0, 0, 0, 10, 0, 3, 0],
		[1, 0, 0, 0, 10, 0, -1, 1],
	])
		assert.throws(
			() => createWasmEditingKernel(() => new Float64Array(output)).extend(target, [other], new Vec2()),
			/WASM editing/
		);
});

test('off-curve cursors match the frozen reference across supported geometry types', {
	skip: !getGeometryKernel().editing,
}, () => {
	const native = getGeometryKernel();
	try {
		for (let i = 0; i < fixtures.scenes.length; i += 7) {
			const fixture = fixtures.scenes[i],
				target = hydrate(fixture.target) as GeoCurve,
				others = hydrate(fixture.others) as GeoCurve[];
			for (const [dx, dy] of [
				[1e-5, -1e-5],
				[3, -4],
				[1000, -1000],
			]) {
				const cursor = Vec2.from(fixture.probes[1].cursor).add(new Vec2(dx, dy));
				setGeometryKernel(typescriptGeometryKernel);
				const expectedTrim = trimReference(target, others, cursor),
					expectedExtend = extendReference(undefined as unknown as SketchDocument, target, others, cursor);
				setGeometryKernel(native);
				compare(plain(getTrimCandidate(target, others, cursor)), plain(expectedTrim), fixture.name);
				compare(
					plain(findExtendCandidate(undefined as unknown as SketchDocument, target, others, cursor)),
					plain(expectedExtend),
					fixture.name
				);
			}
		}
	} finally {
		setGeometryKernel(native);
	}
});

test('trim/extend preserve document constraints and transaction undo/redo', () => {
	const snapshot = (sketch: SketchDocument) =>
		Object.fromEntries(
			Object.entries(plain(sketch.takeSnapshot())).map(([key, value]) => [
				key,
				Array.isArray(value) && value.every(item => item && typeof item === 'object' && 'id' in item)
					? [...value].sort((a, b) => a.id.localeCompare(b.id))
					: value,
			])
		);
	for (const operation of ['trim', 'extend'] as const) {
		const sketch = new SketchDocument();
		sketch.withDeferredSolve(() => {
			const a = sketch.addPoint(new Vec2(0, 0)),
				b = sketch.addPoint(new Vec2(10, 0));
			sketch.addLine(a.id, b.id);
			sketch.addHorizontalConstraint(a.id, b.id);
			const x = operation === 'trim' ? 5 : 20;
			const c = sketch.addPoint(new Vec2(x, -5)),
				d = sketch.addPoint(new Vec2(x, 5));
			sketch.addLine(c.id, d.id);
		});
		sketch.clearHistory();
		const before = snapshot(sketch),
			curves = getAllGeoCurves(sketch),
			target = curves[0];
		sketch.beginTransaction();
		if (operation === 'trim') executeTrim(sketch, getTrimCandidate(target, curves, new Vec2(8, 0))!);
		else assert.ok(executeExtend(sketch, findExtendCandidate(sketch, target, curves, new Vec2(10, 0))!));
		sketch.commitTransaction();
		const after = snapshot(sketch);
		assert.notDeepEqual(after, before);
		assert.ok([...sketch.constraints.values()].some(c => c.type === 'horizontal'));
		sketch.undo();
		compare(snapshot(sketch), before);
		sketch.redo();
		compare(snapshot(sketch), after);
	}
});

test('spline self-intersections support intersections, trim, break and self-extend across active and reference kernels', () => {
	const native = getGeometryKernel();
	const backends = native.editing ? [typescriptGeometryKernel, native] : [typescriptGeometryKernel];

	const makeAlphaSketch = () => {
		const sketch = new SketchDocument();
		const pt = (x: number, y: number) => sketch.addPoint({ x, y });
		sketch.addFitSpline([pt(-40, 0), pt(10, 30), pt(10, -30), pt(-20, 0), pt(30, 0)].map(p => p.id));
		return sketch;
	};
	const makeBowTieSketch = () => {
		const sketch = new SketchDocument();
		const pt = (x: number, y: number) => sketch.addPoint({ x, y });
		sketch.addFitSpline([pt(-40, 25), pt(40, -25), pt(40, 25), pt(-40, -25)].map(p => p.id), undefined, false, undefined, true);
		return sketch;
	};
	const makeHookSketch = () => {
		const sketch = new SketchDocument();
		const pt = (x: number, y: number) => sketch.addPoint({ x, y });
		sketch.addFitSpline([pt(-20, 20), pt(20, 40), pt(40, 10), pt(10, -20), pt(5, 0)].map(p => p.id));
		return sketch;
	};

	try {
		for (const kernel of backends) {
			setGeometryKernel(kernel);

			// 1. Open self-intersecting fit spline: intersections, middle loop trim, and break
			const alpha = makeAlphaSketch();
			const alphaCurves = getAllGeoCurves(alpha);
			const alphaHits = getCurveIntersections(alphaCurves[0], alphaCurves);
			assert.equal(alphaHits.length, 2);
			assert.equal(alphaHits[0].cuttingCurveId, alphaCurves[0].id);
			assert.equal(alphaHits[1].cuttingCurveId, alphaCurves[0].id);

			const loopCand = getTrimCandidate(alphaCurves[0], alphaCurves, new Vec2(15, 10))!;
			assert.equal(loopCand.isWholeEntity, false);
			assert.ok(loopCand.interval[0] > 0.01 && loopCand.interval[1] < 0.99);
			assert.ok(Math.abs(loopCand.interval[0] - alphaHits[0].param) < 1e-6);
			assert.ok(Math.abs(loopCand.interval[1] - alphaHits[1].param) < 1e-6);
			executeTrim(alpha, loopCand);
			assert.equal(alpha.splines.size, 2);
			assert.ok([...alpha.constraints.values()].some(c => c.type === 'coincident'));

			const breakAlpha = makeAlphaSketch();
			const breakCurves = getAllGeoCurves(breakAlpha);
			const breakCand = getTrimCandidate(breakCurves[0], breakCurves, new Vec2(15, 10))!;
			executeBreak(breakAlpha, breakCand);
			assert.equal(breakAlpha.splines.size, 3);
			assert.equal(findSketchRegions(breakAlpha).length, 1);

			// 2. Closed bow-tie spline: trim one loop instead of deleting the whole curve, or break into two loops
			const bowTrim = makeBowTieSketch();
			const bowCurves = getAllGeoCurves(bowTrim);
			assert.equal(getCurveIntersections(bowCurves[0], bowCurves).length, 2);
			const bowCand = getTrimCandidate(bowCurves[0], bowCurves, new Vec2(40, 0))!;
			assert.equal(bowCand.isWholeEntity, false);
			executeTrim(bowTrim, bowCand);
			assert.equal(bowTrim.splines.size, 1);
			assert.equal(findSketchRegions(bowTrim).length, 1);
			assert.equal(pointInRegion(new Vec2(-25, 0), findSketchRegions(bowTrim)[0]), true);

			const bowBreak = makeBowTieSketch();
			const bowBreakCurves = getAllGeoCurves(bowBreak);
			executeBreak(bowBreak, getTrimCandidate(bowBreakCurves[0], bowBreakCurves, new Vec2(40, 0))!);
			assert.equal(bowBreak.splines.size, 2);
			assert.equal(findSketchRegions(bowBreak).length, 2);

			// 3. Extend open hook spline until it intersects itself and encloses a region
			const hook = makeHookSketch();
			const hookCurves = getAllGeoCurves(hook);
			const extendCand = findExtendCandidate(hook, hookCurves[0], hookCurves, new Vec2(5, 0))!;
			assert.equal(extendCand.intersectedCurveId, hookCurves[0].id);
			assert.equal(extendCand.intersectedCurveType, 'spline');
			assert.ok(extendCand.toPoint.y > 20);
			assert.ok(executeExtend(hook, extendCand));
			assert.equal(findSketchRegions(hook).length, 1);
		}
	} finally {
		setGeometryKernel(native);
	}
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fitOffsetNodes, OFFSET_FIT_TOLERANCE, type OffsetFitNode } from '../src/math/offsetFit';
import { evaluateBezier, evaluateBezierDerivative, type BezierSegment } from '../src/math/splineReference';
import { Vec2, projectPointOntoSegment } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { calculateOffsetGeometry, toggleOrExtendChain } from '../src/math/offset';
import { distanceToCubics } from './helpers/offsetGeometry';

function verifyBound(nodes: OffsetFitNode[], curves: BezierSegment[]): void {
	for (const n of nodes)
		assert.ok(
			distanceToCubics(curves, n.p) <= OFFSET_FIT_TOLERANCE + 1e-7,
			'reference point escaped the fit tolerance'
		);
	for (const curve of curves)
		for (let k = 0; k <= 100; k++) {
			const p = evaluateBezier(curve, k / 100);
			let d = Infinity;
			for (let i = 0; i + 1 < nodes.length; i++)
				d = Math.min(d, projectPointOntoSegment(p, nodes[i].p, nodes[i + 1].p).dist);
			assert.ok(d <= OFFSET_FIT_TOLERANCE + 1e-7, `fitted curve escaped the reference by ${d}`);
		}
}
test('offset fitting reduces an exact cubic to one segment with a two-way geometric error bound', () => {
	const source = [new Vec2(0, 0), new Vec2(0, 100), new Vec2(100, 100), new Vec2(100, 0)] as BezierSegment;
	const nodes = Array.from({ length: 129 }, (_, i) => ({
		p: evaluateBezier(source, i / 128),
		t: evaluateBezierDerivative(source, i / 128).normalizeOrUnitX(),
		corner: false,
	}));
	const pieces = fitOffsetNodes(nodes);
	assert.equal(pieces.length, 1);
	assert.deepEqual(pieces[0].curve[0], nodes[0].p);
	assert.deepEqual(pieces[0].curve[3], nodes.at(-1)!.p);
	verifyBound(
		nodes,
		pieces.map(p => p.curve)
	);
});
test('offset fitting preserves protected corners without rounding or crossing them', () => {
	const nodes = Array.from({ length: 81 }, (_, i) =>
		i <= 40
			? { p: new Vec2(i / 4, 0), t: new Vec2(1, 0), corner: i === 40 }
			: { p: new Vec2(10, (i - 40) / 4), t: new Vec2(0, 1), corner: false }
	);
	const pieces = fitOffsetNodes(nodes);
	assert.equal(pieces.length, 2);
	assert.equal(pieces[0].end, 40);
	assert.equal(pieces[1].start, 40);
	assert.deepEqual(pieces[0].curve[2], nodes[40].p);
	assert.deepEqual(pieces[1].curve[1], nodes[40].p);
	verifyBound(
		nodes,
		pieces.map(p => p.curve)
	);
});
for (const radius of [0.01, 10])
	test(`offset fitting keeps a closed loop with radius ${radius}`, () => {
		const nodes = Array.from({ length: 129 }, (_, i) => {
			const t = (i * 2 * Math.PI) / 128;
			return { p: Vec2.fromPolar(radius, t), t: new Vec2(-Math.sin(t), Math.cos(t)), corner: false };
		});
		const pieces = fitOffsetNodes(nodes, OFFSET_FIT_TOLERANCE, true);
		assert.ok(pieces.length >= 4 && pieces.length <= 8);
		const samples = pieces.flatMap(p => Array.from({ length: 32 }, (_, i) => evaluateBezier(p.curve, i / 32)));
		const area = samples.reduce((sum, p, i) => sum + p.cross(samples[(i + 1) % samples.length]), 0) / 2;
		assert.ok(area > Math.PI * radius * radius * 0.8, 'a small closed loop collapsed or reversed');
		verifyBound(
			nodes,
			pieces.map(p => p.curve)
		);
	});
test('offset fitting collapses duplicate samples to one finite degenerate segment', () => {
	const nodes = Array.from({ length: 128 }, () => ({ p: new Vec2(5, 7), t: new Vec2(1, 0), corner: false }));
	const pieces = fitOffsetNodes(nodes);
	assert.equal(pieces.length, 1);
	for (const p of pieces[0].curve) assert.deepEqual(p, new Vec2(5, 7));
});
for (const file of ['spline-offset-issue.svg', 'offset-test.svg'])
	test(`offset splines use at least four times fewer fit points in ${file}`, () => {
		const data = JSON.parse(
			readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8').match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]
		);
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(data.snapshot);
		const id = file.startsWith('spline') ? 'Spline-2' : 'Line-1',
			chain = toggleOrExtendChain(sketch, null, id, id.startsWith('Line') ? 'line' : 'spline', true)!;
		for (const flip of [false, true]) {
			const result = calculateOffsetGeometry(sketch, chain, 'two_sides', 6.5, 15.5, flip);
			assert.ok(result.isValid);
			let before = 0,
				after = 0;
			for (const side of result.sides)
				for (const p of side.primitives)
					if (p.type === 'spline') {
						const source = sketch.splines.get(p.sourceId);
						before += source
							? Math.min(257, Math.max(17, source.toGeoCurve(sketch)!.bezierSegments!.length * 16 + 1))
							: 65;
						after += p.fitPoints!.length;
					}
			assert.ok(after * 4 <= before, `${before} old fit points became ${after}`);
		}
	});

test('closed ellipse offsets retain their shape with fewer fit points', async () => {
	const { calculateOffsetGeometry: legacy } = await import('../src/math/offsetReference');
	const { fitPointsToBezier } = await import('../src/math/splineReference');
	const fixture = JSON.parse(
		readFileSync(new URL('./fixtures/kernelOffset.json', import.meta.url), 'utf8')
	).scenes.find((s: { name: string }) => s.name === 'ellipse');
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture.snapshot);
	for (const flip of [false, true]) {
		const before = legacy(sketch, fixture.chain, 'one_side', 3, 0, flip).sides[0].primitives[0],
			after = calculateOffsetGeometry(sketch, fixture.chain, 'one_side', 3, 0, flip).sides[0].primitives[0];
		assert.equal(before.fitPoints!.length, 25);
		assert.ok(after.fitPoints!.length <= 10);
		assert.equal(after.isSplineClosed, true);
		const original = fitPointsToBezier(before.fitPoints!, before.handles),
			compact = fitPointsToBezier(after.fitPoints!, after.handles);
		for (const [from, to] of [
			[original, compact],
			[compact, original],
		])
			for (const b of from)
				for (let j = 0; j <= 8; j++) assert.ok(distanceToCubics(to, evaluateBezier(b, j / 8)) < 0.055);
	}
});

test('a tiny open interval remains one finite cubic', () => {
	const nodes = [
		{ p: new Vec2(0, 0), t: new Vec2(1, 0), corner: false },
		{ p: new Vec2(1e-9, 0), t: new Vec2(1, 0), corner: false },
	];
	assert.equal(fitOffsetNodes(nodes).length, 1);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluateBezier, fitPointsToBezier } from '../src/math/spline';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { calculateOffsetGeometry, toggleOrExtendChain } from '../src/math/offset';
import { distanceToCubics } from './helpers/offsetGeometry';

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

test('closed ellipse offsets retain their shape with fewer fit points', () => {
	const fixture = JSON.parse(
		readFileSync(new URL('./fixtures/kernelOffset.json', import.meta.url), 'utf8')
	).scenes.find((s: { name: string }) => s.name === 'ellipse');
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(fixture.snapshot);
	for (const flip of [false, true]) {
		const q = fixture.queries.find(
			(item: { direction: string; d1: number; flip: boolean }) =>
				item.direction === 'one_side' && item.d1 === 3 && item.flip === flip
		);
		const before = fixture.sideResults[q.result.sides[0]].primitives[0];
		const after = calculateOffsetGeometry(sketch, fixture.chain, 'one_side', 3, 0, flip).sides[0].primitives[0];
		assert.equal(before.fitPoints.length, 25);
		assert.ok(after.fitPoints!.length <= 10);
		assert.equal(after.isSplineClosed, true);
		const original = fitPointsToBezier(
				before.fitPoints.map(Vec2.from),
				before.handles?.map((h: { h1: Vec2; h2: Vec2 }) => ({ h1: Vec2.from(h.h1), h2: Vec2.from(h.h2) }))
			),
			compact = fitPointsToBezier(after.fitPoints!, after.handles);
		for (const [from, to] of [
			[original, compact],
			[compact, original],
		])
			for (const b of from)
				for (let j = 0; j <= 8; j++) assert.ok(distanceToCubics(to, evaluateBezier(b, j / 8)) < 0.055);
	}
});

import assert from 'node:assert/strict';
import { assertSameCubicGeometry } from './helpers/offsetGeometry';
import { mixedOffsetScene, offsetContourGroups, openSplineLoopScene } from './helpers/mixedOffsetScene';
import { fitPointsToBezier } from '../src/math/splineReference';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import type { SVGRenderer as Renderer } from '../src/canvas/renderer';
import { Viewport } from '../src/canvas/viewport';
import { OFFSET_PREVIEW_ATTRS } from '../src/canvas/styles';
import { SketchDocument } from '../src/model/sketch';
import { OffsetConstraint } from '../src/solver/constraints/offset';
import {
	calculateOffsetGeometry,
	commitOffsetToSketch,
	type OffsetChain,
	type OffsetDirection,
	type OffsetGeometryResult,
} from '../src/math/offset';
register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { SVGRenderer } = await import('../src/canvas/renderer');
class SvgElement {
	attributes = new Map<string, string>();
	children: SvgElement[] = [];
	parent: SvgElement | null = null;
	style = {};
	classList = { add: (name: string) => this.setAttribute('class', `${this.getAttribute('class') ?? ''} ${name}`) };
	setAttribute(name: string, value: string) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
	set innerHTML(_value: string) {
		this.children = [];
	}
	appendChild(child: SvgElement) {
		if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child);
		child.parent = this;
		this.children.push(child);
	}
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelOffset.json', import.meta.url), 'utf8')) as {
	scenes: { name: string; snapshot: ReturnType<SketchDocument['takeSnapshot']>; chain: OffsetChain }[];
};
function signature(el: SvgElement) {
	return el.getAttribute('d') !== null
		? ['path', el.getAttribute('d')!.replace(/[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/gi, value => String(Number(value)))]
		: el.getAttribute('r') !== null
			? ['circle', ...['cx', 'cy', 'r'].map(k => Number(el.getAttribute(k)))]
			: ['line', ...['x1', 'y1', 'x2', 'y2'].map(k => Number(el.getAttribute(k)))];
}
function render(
	sketch: SketchDocument,
	chain?: OffsetChain,
	result?: OffsetGeometryResult,
	direction: OffsetDirection = 'one_side',
	flip = false
) {
	const geometry = new SvgElement(),
		preview = new SvgElement(),
		previous = globalThis.document,
		viewport = new Viewport(800, 600);
	viewport.zoom = 2;
	viewport.panX = 350;
	viewport.panY = 290;
	const renderer: Renderer = Object.assign(Object.create(SVGRenderer.prototype), {
		geometryGroup: geometry,
		pointGroup: new SvgElement(),
		offsetGroup: preview,
		offsetGizmoHandles: [],
	});
	try {
		(globalThis as any).document = { createElementNS: () => new SvgElement() };
		renderer['renderGeometry'](sketch, viewport);
		if (chain && result)
			renderer.renderOffsetPreviews(sketch, viewport, {
				chain,
				geomResult: result,
				direction,
				dist1: 3,
				dist2: 5,
				flip,
			});
	} finally {
		globalThis.document = previous;
	}
	return {
		previews: preview.children
			.filter(el => Object.entries(OFFSET_PREVIEW_ATTRS).every(([k, v]) => el.getAttribute(k) === String(v)))
			.map(signature),
		entity(id: string) {
			const group = geometry.children.find(el => el.getAttribute('data-id') === id);
			assert.ok(group);
			const visible = group.children.find(el => el.getAttribute('class')?.includes('entity-visible'));
			assert.ok(visible);
			return signature(visible);
		},
	};
}
function assertAppliedOffset(
	sketch: SketchDocument,
	ids: string[],
	chain: OffsetChain,
	result: OffsetGeometryResult
): void {
	const actual = render(sketch),
		expected = render(sketch, chain, result).previews;
	assert.equal(ids.length, result.sides[0].primitives.length);
	for (let i = 0; i < ids.length; i++) {
		const prim = result.sides[0].primitives[i];
		if (prim.type === 'spline')
			assertSameCubicGeometry(
				sketch.splines.get(ids[i])!.toGeoCurve(sketch)!.bezierSegments!,
				fitPointsToBezier(prim.fitPoints!, prim.handles)
			);
		else assert.deepEqual(actual.entity(ids[i]), expected[i]);
	}
}
function canonical(s: ReturnType<SketchDocument['takeSnapshot']>) {
	return Object.fromEntries(
		Object.entries(s).map(([k, v]) => [
			k,
			Array.isArray(v) && v.every(p => typeof p.id === 'string') ? [...v].sort((a, b) => a.id.localeCompare(b.id)) : v,
		])
	);
}
for (const name of [
	'line',
	'polyline',
	'rectangle ccw',
	'rectangle cw',
	'circle',
	'arc',
	'fit spline',
	'control spline',
	'closed fit spline',
	'ellipse',
	'line arc',
	'arc line',
	'spline line',
	'arc spline',
	'spline arc',
	'spline spline',
	'line spline loop',
])
	for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
		for (const flip of [false, true])
			test(`offset preview, commit and history: ${name}, ${direction}, flip=${flip}`, () => {
				const scene = fixture.scenes.find(s => s.name === name)!,
					sketch = new SketchDocument();
				sketch.restoreSnapshot(scene.snapshot);
				sketch.clearHistory();
				const before = sketch.takeSnapshot(),
					geometry = calculateOffsetGeometry(sketch, scene.chain, direction, 3, 5, flip);
				assert.ok(geometry.isValid);
				const preview = render(sketch, scene.chain, geometry, direction, flip).previews;
				assert.equal(
					preview.length,
					geometry.sides.reduce((n, s) => n + s.primitives.length, 0)
				);
				assert.deepEqual(sketch.takeSnapshot(), before);
				const created = sketch.withDeferredSolve(() =>
					commitOffsetToSketch(sketch, scene.chain, geometry, direction, 3, 5, flip, {
						dist1: '3',
						dist2: '5',
					})
				);
				assert.ok(created);
				const actual = render(sketch);
				assert.deepEqual(
					created.createdIds.map(id => actual.entity(id)),
					preview,
					'applied curves differ from the SVG preview'
				);
				for (const p of before.points)
					assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7, 'source geometry moved');
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				const after = sketch.takeSnapshot();
				assert.equal(sketch.undo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
				assert.equal(sketch.canUndo(), false);
				assert.equal(sketch.redo(), true);
				for (const p of after.points)
					assert.ok(
						sketch.points.get(p.id)!.distanceTo(p) < 1e-5,
						`redo moved ${p.id} by ${sketch.points.get(p.id)!.distanceTo(p)}`
					);
				const restored = render(sketch);
				assert.deepEqual(
					created.createdIds.map(id => restored.entity(id)),
					preview
				);
			});

for (const name of ['polyline', 'circle', 'arc', 'fit spline'])
	test(`editing each offset distance preserves its side: ${name}`, () => {
		const scene = fixture.scenes.find(s => s.name === name)!,
			sketch = new SketchDocument();
		sketch.restoreSnapshot(scene.snapshot);
		const geometry = calculateOffsetGeometry(sketch, scene.chain, 'two_sides', 3, 5, true);
		const created = sketch.withDeferredSolve(() =>
			commitOffsetToSketch(sketch, scene.chain, geometry, 'two_sides', 3, 5, true)
		);
		assert.ok(created);
		const count = geometry.sides[0].primitives.length;
		for (const index of [0, 1]) {
			const ids = created.createdIds.slice(index * count, (index + 1) * count),
				other = created.createdIds.filter(id => !ids.includes(id)),
				before = render(sketch);
			const otherBefore = other.map(id => before.entity(id));
			const c = sketch.constraints.get(created.constraintIds[index]);
			assert.ok(c instanceof OffsetConstraint);
			const target = index === 0 ? 4 : 6;
			assert.equal(sketch.applyConstraintValueDirectly(c, target), true);
			sketch.solve();
			const expected = calculateOffsetGeometry(sketch, scene.chain, 'one_side', target, 0, !!c.flip);
			const expectedPaths = render(sketch, scene.chain, expected, 'one_side', !!c.flip).previews,
				actual = render(sketch);
			assert.deepEqual(
				ids.map(id => actual.entity(id)),
				expectedPaths
			);
			assert.deepEqual(
				other.map(id => actual.entity(id)),
				otherBefore,
				'editing one distance moved the opposite offset'
			);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
		}
	});

// User regression: a fit spline with tight shoulders and a straight closing edge.
// The old 17-point normal sampling produced inward loops even at distance 3.
const splineIssue = JSON.parse(
	readFileSync(new URL('./fixtures/spline-offset-issue.svg', import.meta.url), 'utf8').match(
		/<!\[CDATA\[([\s\S]*?)\]\]>/
	)![1]
);
const { toggleOrExtendChain } = await import('../src/math/offset');
const { evaluateBezier } = await import('../src/math/splineReference');
const { Vec2, projectPointOntoSegment } = await import('../src/math/vector');
function sampledSpline(sketch: SketchDocument, id: string, steps = 24) {
	return sketch.splines
		.get(id)!
		.toGeoCurve(sketch)!
		.bezierSegments!.flatMap((b, i) =>
			Array.from({ length: steps + (i === 0 ? 1 : 0) }, (_, j) => evaluateBezier(b, (j + (i === 0 ? 0 : 1)) / steps))
		);
}
function assertNoCrossings(points: InstanceType<typeof Vec2>[]) {
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i],
			u = points[i + 1].clone().sub(a);
		for (let j = i + 2; j + 1 < points.length; j++) {
			const b = points[j],
				v = points[j + 1].clone().sub(b),
				delta = b.clone().sub(a),
				det = u.cross(v);
			if (Math.abs(det) < 1e-12) continue;
			const t = delta.cross(v) / det,
				s = delta.cross(u) / det;
			assert.ok(
				!(t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6),
				`offset crosses itself at segments ${i} (${a.x}, ${a.y}) and ${j} (${b.x}, ${b.y})`
			);
		}
	}
}
function assertOffsetDistance(
	points: InstanceType<typeof Vec2>[],
	source: InstanceType<typeof Vec2>[],
	distance: number
) {
	for (const p of points) {
		let nearest = Infinity;
		for (let i = 0; i + 1 < source.length; i++)
			nearest = Math.min(nearest, projectPointOntoSegment(p, source[i], source[i + 1]).dist);
		assert.ok(Math.abs(nearest - distance) < 0.15, `offset distance ${nearest} differs from ${distance}`);
	}
}
for (const start of ['single', 'Spline-2', 'Line-12'])
	for (const flip of [false, true])
		for (const distance of [3, 10])
			test(`tight spline offset has no loops: ${start}, flip=${flip}, d=${distance}`, () => {
				const sketch = new SketchDocument();
				sketch.restoreSnapshot(splineIssue.snapshot);
				sketch.clearHistory();
				const before = sketch.takeSnapshot(),
					source = sampledSpline(sketch, 'Spline-2', 160);
				const chain = toggleOrExtendChain(
					sketch,
					null,
					start === 'single' ? 'Spline-2' : start,
					start === 'Line-12' ? 'line' : 'spline',
					start !== 'single'
				)!;
				assert.equal(chain.isClosed, start !== 'single');
				const result = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 5, flip);
				assert.ok(result.isValid);
				const preview = render(sketch, chain, result, 'one_side', flip).previews;
				const created = sketch.withDeferredSolve(() =>
					commitOffsetToSketch(sketch, chain, result, 'one_side', distance, 5, flip)
				)!;
				assert.deepEqual(
					created.createdIds.map(id => render(sketch).entity(id)),
					preview
				);
				const spline = created.createdIds.find(id => sketch.splines.has(id))!;
				const points = sampledSpline(sketch, spline);
				if (chain.isClosed) points.push(points[0]);
				assertNoCrossings(points);
				// Outer miters extend beyond the endpoint normal by sqrt(2); use the open source for the accuracy check.
				if (start === 'single' || flip) {
					if (chain.isClosed) source.push(source[0]);
					assertOffsetDistance(sampledSpline(sketch, spline), source, distance);
				}
				for (const p of before.points) assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7);
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				assert.equal(sketch.undo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
				assert.equal(sketch.redo(), true);
				assert.deepEqual(
					created.createdIds.map(id => render(sketch).entity(id)),
					preview
				);
			});
for (const flip of [false, true])
	test(`tight spline offset dimensions resample the trimmed curve: flip=${flip}`, () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(splineIssue.snapshot);
		const chain = toggleOrExtendChain(sketch, null, 'Spline-2', 'spline', true)!;
		const result = calculateOffsetGeometry(sketch, chain, 'two_sides', 3, 5, flip);
		const created = sketch.withDeferredSolve(() =>
			commitOffsetToSketch(sketch, chain, result, 'two_sides', 3, 5, flip)
		)!;
		const before = sketch.takeSnapshot();
		for (let side = 0; side < 2; side++) {
			const c = sketch.constraints.get(created.constraintIds[side]) as OffsetConstraint;
			const pair = c.pairs.find(p => p.kind === 'spline')!;
			assert.equal(pair.kind, 'spline');
			const ids = [...sketch.splines.get(pair.offSplineId)!.pointIds];
			for (const distance of [10, 0.5, 3]) {
				assert.equal(sketch.applyConstraintValueDirectly(c, distance), true);
				sketch.solve();
				const expected = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, !!c.flip);
				assertAppliedOffset(sketch, c.pairs.map(offsetPairChild), chain, expected);
				const currentIds = sketch.splines.get(pair.offSplineId)!.pointIds;
				assert.deepEqual(
					currentIds.filter(id => ids.includes(id)),
					ids,
					'existing fit-point IDs changed'
				);

				const points = sampledSpline(sketch, pair.offSplineId);
				points.push(points[0]);
				assertNoCrossings(points);
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
			}
		}
		for (const p of splineIssue.snapshot.points) assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7);
		assert.ok(before.points.length > splineIssue.snapshot.points.length);
	});

test('spline offsets saved with 17 points keep their IDs when the distance changes', async () => {
	const reference = await import('../src/math/offsetReference');
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(splineIssue.snapshot);
	const chain = toggleOrExtendChain(sketch, null, 'Spline-2', 'spline', true)!;
	const legacy = reference.calculateOffsetGeometry(sketch, chain, 'one_side', 3, 0, true);
	const created = sketch.withDeferredSolve(() => commitOffsetToSketch(sketch, chain, legacy, 'one_side', 3, 0, true))!;
	const splineId = created.createdIds.find(id => sketch.splines.has(id))!;
	const ids = [...sketch.splines.get(splineId)!.pointIds];
	assert.equal(ids.length, 17);
	const c = sketch.constraints.get(created.constraintIds[0]) as OffsetConstraint;
	assert.equal(sketch.applyConstraintValueDirectly(c, 10), true);
	sketch.solve();
	assert.deepEqual(sketch.splines.get(splineId)!.pointIds, ids);
	const points = sampledSpline(sketch, splineId);
	points.push(points[0]);
	assertNoCrossings(points);
	assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
});

test('collapsed spline handles yield finite offset geometry', () => {
	const sketch = new SketchDocument();
	const a = sketch.addPoint({ x: 2, y: 3 }),
		b = sketch.addPoint({ x: 2, y: 3 });
	const spline = sketch.addFitSpline([a.id, b.id], undefined, false, undefined, false);
	const chain: OffsetChain = { items: [{ id: spline.id, type: 'spline' }], isClosed: false };
	for (const flip of [false, true])
		for (const distance of [0, 3]) {
			const result = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, flip);
			assert.ok(result.isValid);
			const points = result.sides[0].primitives[0].fitPoints!;
			assert.equal(points.length, 2);
			for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
		}
});

const junctionIssue = JSON.parse(
	readFileSync(new URL('./fixtures/offset-test.svg', import.meta.url), 'utf8').match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]
);
function sampledOffsetBoundary(result: OffsetGeometryResult) {
	const vertices: InstanceType<typeof Vec2>[] = [];
	for (const prim of result.sides[0].primitives) {
		let points: InstanceType<typeof Vec2>[];
		if (prim.type === 'line') points = [prim.p1!, prim.p2!];
		else if (prim.type === 'arc') {
			assert.ok(Math.abs(prim.start!.distanceTo(prim.center!) - prim.radius!) < 1e-7, 'arc start is off its circle');
			assert.ok(Math.abs(prim.end!.distanceTo(prim.center!) - prim.radius!) < 1e-7, 'arc end is off its circle');
			const a = prim.center!.angleToPoint(prim.start!),
				b = prim.center!.angleToPoint(prim.end!);
			let sweep = prim.clockwise ? a - b : b - a;
			while (sweep < 0) sweep += 2 * Math.PI;
			points = Array.from({ length: 65 }, (_, j) =>
				Vec2.fromPolar(prim.radius!, a + ((prim.clockwise ? -1 : 1) * sweep * j) / 64).add(prim.center!)
			);
		} else {
			assert.equal(prim.type, 'spline');
			points = prim
				.fitPoints!.slice(1)
				.flatMap((p, i) =>
					Array.from({ length: 21 }, (_, j) =>
						evaluateBezier([prim.fitPoints![i], prim.handles![i].h2, prim.handles![i + 1].h1, p], j / 20)
					)
				);
		}
		if (vertices.length) assert.ok(vertices.at(-1)!.distanceTo(points[0]) < 1e-7, 'offset boundary has a gap');
		for (const p of points) if (!vertices.length || vertices.at(-1)!.distanceTo(p) > 1e-8) vertices.push(p);
	}
	assert.ok(vertices[0].distanceTo(vertices.at(-1)!) < 1e-7, 'closed offset has an open seam');
	return vertices;
}
for (const selected of ['Spline-1', 'Line-10', 'Spline-3'])
	for (const flip of [false, true])
		for (const distance of [3, 10])
			test(`mixed offset junctions remain on curves: ${selected}, flip=${flip}, d=${distance}`, () => {
				const sketch = new SketchDocument();
				sketch.restoreSnapshot(junctionIssue.snapshot);
				sketch.clearHistory();
				const before = sketch.takeSnapshot(),
					chain = toggleOrExtendChain(sketch, null, selected, selected === 'Line-10' ? 'line' : 'spline', true)!;
				assert.equal(chain.items.length, 9);
				assert.equal(chain.isClosed, true);
				const result = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, flip);
				assert.ok(result.isValid);
				assertNoCrossings(sampledOffsetBoundary(result));
				const preview = render(sketch, chain, result, 'one_side', flip).previews;
				const created = sketch.withDeferredSolve(() =>
					commitOffsetToSketch(sketch, chain, result, 'one_side', distance, 0, flip)
				)!;
				assert.deepEqual(
					created.createdIds.map(id => render(sketch).entity(id)),
					preview,
					'committed joins differ from preview'
				);
				for (const p of before.points)
					assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-6, 'source geometry moved');
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				assert.equal(sketch.undo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
				assert.equal(sketch.redo(), true);
				assert.deepEqual(
					created.createdIds.map(id => render(sketch).entity(id)),
					preview
				);
				const constraint = sketch.constraints.get(created.constraintIds[0]) as OffsetConstraint;
				for (const value of [distance === 10 ? 3 : 10, distance]) {
					assert.equal(sketch.applyConstraintValueDirectly(constraint, value), true);
					sketch.solve();
					const updated = calculateOffsetGeometry(sketch, chain, 'one_side', value, 0, flip);
					assertNoCrossings(sampledOffsetBoundary(updated));
					assertAppliedOffset(sketch, created.createdIds, chain, updated);
					assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				}
			});

function offsetPairChild(pair: OffsetConstraint['pairs'][number]) {
	return pair.kind === 'line' ? pair.offLineId : pair.kind === 'circle' ? pair.offId : pair.offSplineId;
}
for (const selected of ['Line-1', 'Arc-2', 'Spline-3'])
	for (const flip of [false, true])
		test(`collapsed offset fillet is removed and restored: ${selected}, flip=${flip}`, () => {
			const sketch = new SketchDocument();
			sketch.restoreSnapshot(junctionIssue.snapshot);
			sketch.clearHistory();
			const chain = toggleOrExtendChain(
				sketch,
				null,
				selected,
				selected.startsWith('Line') ? 'line' : selected.startsWith('Arc') ? 'arc' : 'spline',
				true
			)!;
			const before = sketch.takeSnapshot();
			const geometry = calculateOffsetGeometry(sketch, chain, 'two_sides', 6.5, 15.5, flip);
			assert.ok(geometry.isValid);
			for (const side of geometry.sides) {
				assertNoCrossings(sampledOffsetBoundary({ ...geometry, sides: [side] }));
				if (side.side < 0 && side.distance === 15.5) {
					assert.equal(side.primitives.length, 8);
					assert.ok(!side.primitives.some(p => p.sourceId === 'Arc-2'));
				}
			}
			const preview = render(sketch, chain, geometry, 'two_sides', flip).previews;
			const created = sketch.withDeferredSolve(() =>
				commitOffsetToSketch(sketch, chain, geometry, 'two_sides', 6.5, 15.5, flip)
			)!;
			assert.deepEqual(
				created.createdIds.map(id => render(sketch).entity(id)),
				preview
			);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
			const innerId = created.constraintIds.find(id => (sketch.constraints.get(id) as OffsetConstraint).flip)!;
			const outerId = created.constraintIds.find(id => id !== innerId)!;
			const outer = sketch.constraints.get(outerId) as OffsetConstraint;
			const outerChildren = outer.pairs.map(offsetPairChild);
			const outerRender = outerChildren.map(id => render(sketch).entity(id));
			const stableIds = new Map(
				(sketch.constraints.get(innerId) as OffsetConstraint).pairs.map(pair => [
					pair.kind === 'line' ? pair.origLineId : pair.kind === 'circle' ? pair.origId : pair.origSplineId,
					offsetPairChild(pair),
				])
			);
			for (const distance of (sketch.constraints.get(innerId) as OffsetConstraint).targetDistance > 10
				? [6.5, 15.5, 6.5, 15.5]
				: [15.5, 6.5, 15.5, 6.5]) {
				const old = sketch.takeSnapshot();
				assert.equal(sketch.updateDimensionalConstraint(innerId, distance), true);
				let c = sketch.constraints.get(innerId) as OffsetConstraint;
				assert.ok(c);
				const expected = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
				assertNoCrossings(sampledOffsetBoundary(expected));
				assertAppliedOffset(sketch, c.pairs.map(offsetPairChild), chain, expected);
				assert.deepEqual(
					outerChildren.map(id => render(sketch).entity(id)),
					outerRender,
					'the opposite offset side moved'
				);
				for (const p of before.points)
					assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-6, 'source geometry moved');
				for (const pair of c.pairs) {
					const source =
						pair.kind === 'line' ? pair.origLineId : pair.kind === 'circle' ? pair.origId : pair.origSplineId;
					if (source !== 'Arc-2' && stableIds.has(source)) assert.equal(offsetPairChild(pair), stableIds.get(source));
				}
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				const after = sketch.takeSnapshot();
				assert.equal(sketch.undo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(old));
				assert.equal(sketch.redo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(after));
				// Exercise plain-coordinate metadata and owned junction constraints after import.
				sketch.restoreSnapshot(JSON.parse(JSON.stringify(after)));
				c = sketch.constraints.get(innerId) as OffsetConstraint;
				assert.ok((c.junctionConstraintIds ?? []).every(id => sketch.constraints.has(id)));
			}
		});

const internalOffsetIssue = JSON.parse(
	readFileSync(new URL('./fixtures/spline-internal-offset.svg', import.meta.url), 'utf8').match(
		/<!\[CDATA\[([\s\S]*?)\]\]>/
	)![1]
);
for (const direction of ['one_side', 'two_sides', 'symmetric'] as const)
	for (const flip of [false, true])
		test(`separated spline offset loops preview and commit independently: ${direction}, flip=${flip}`, () => {
			const sketch = new SketchDocument();
			sketch.restoreSnapshot(internalOffsetIssue.snapshot);
			sketch.clearHistory();
			const before = sketch.takeSnapshot(),
				chain = toggleOrExtendChain(sketch, null, 'Spline-1', 'spline', true)!;
			const geometry = calculateOffsetGeometry(sketch, chain, direction, -10, -10, flip);
			assert.ok(geometry.isValid);
			for (const side of geometry.sides) {
				assert.equal(side.primitives.length, side.side < 0 ? 2 : 1);
				const boundaries = side.primitives.map(prim =>
					sampledOffsetBoundary({ ...geometry, sides: [{ ...side, primitives: [prim] }] })
				);
				for (const boundary of boundaries) assertNoCrossings(boundary);
				if (side.side < 0) {
					assert.ok(Math.max(...boundaries[0].map(p => p.x)) < -10, 'left component was lost');
					assert.ok(Math.min(...boundaries[1].map(p => p.x)) > 10, 'right component was lost');
					// Check the full fitted boundary, including the new seam, against dense source samples.
					const source = sampledSpline(sketch, 'Spline-1');
					for (const boundary of boundaries)
						for (const p of boundary) {
							const distance = Math.min(
								...source.slice(1).map((q, i) => projectPointOntoSegment(p, source[i], q).dist)
							);
							assert.ok(Math.abs(distance - 10) < 0.15, `offset boundary distance ${distance}`);
						}
				}
			}
			const previews = render(sketch, chain, geometry, direction, flip).previews;
			const created = sketch.withDeferredSolve(() =>
				commitOffsetToSketch(sketch, chain, geometry, direction, -10, -10, flip)
			)!;
			assert.deepEqual(
				created.createdIds.map(id => render(sketch).entity(id)),
				previews
			);
			assert.equal(created.constraintIds.length, direction === 'one_side' ? 1 : 2);
			for (const id of created.createdIds) {
				const spline = sketch.splines.get(id)!;
				assert.ok(spline.isClosed);
				assert.equal(spline.pointIds[0], spline.pointIds.at(-1));
			}
			if (created.createdIds.length > 1) {
				const pointSets = created.createdIds.map(id => new Set(sketch.splines.get(id)!.pointIds));
				for (let i = 0; i < pointSets.length; i++)
					for (let j = i + 1; j < pointSets.length; j++) assert.ok(![...pointSets[i]].some(id => pointSets[j].has(id)));
			}
			for (const p of before.points) assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
			const after = sketch.takeSnapshot();
			assert.equal(sketch.undo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
			assert.equal(sketch.redo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(after));
		});

for (const initial of [5, 10])
	test(`offset distance splits and rejoins closed splines atomically from ${initial}`, () => {
		const sketch = new SketchDocument();
		sketch.restoreSnapshot(internalOffsetIssue.snapshot);
		sketch.clearHistory();
		const source = sketch.takeSnapshot(),
			chain = toggleOrExtendChain(sketch, null, 'Spline-1', 'spline', true)!;
		const geometry = calculateOffsetGeometry(sketch, chain, 'two_sides', 3, initial, false);
		const created = sketch.withDeferredSolve(() =>
			commitOffsetToSketch(sketch, chain, geometry, 'two_sides', 3, initial, false)
		)!;
		const innerId = created.constraintIds[1],
			outerId = created.constraintIds[0];
		const outerChildren = (sketch.constraints.get(outerId) as OffsetConstraint).pairs.map(offsetPairChild);
		const outerRender = outerChildren.map(id => render(sketch).entity(id));
		const stableId = offsetPairChild((sketch.constraints.get(innerId) as OffsetConstraint).pairs[0]);
		for (const distance of initial === 5 ? [10, 15, 5, 8, 0.5, 10] : [5, 10, 15, 5, 8, 10]) {
			const before = sketch.takeSnapshot();
			assert.equal(sketch.updateDimensionalConstraint(innerId, distance), true, `distance ${distance}`);
			const c = sketch.constraints.get(innerId) as OffsetConstraint;
			assert.equal(c.pairs.length, distance >= 8 ? 2 : 1);
			assert.equal(sketch.splines.size, 2 + c.pairs.length, 'a merged component was left in the scene');
			assert.equal(offsetPairChild(c.pairs[0]), stableId);
			assert.equal(c.junctionConstraintIds?.length ?? 0, 0, 'separate loops were joined together');
			const expected = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
			assertAppliedOffset(sketch, c.pairs.map(offsetPairChild), chain, expected);
			for (const id of c.pairs.map(offsetPairChild)) assertNoCrossings(sampledSpline(sketch, id));
			assert.deepEqual(
				outerChildren.map(id => render(sketch).entity(id)),
				outerRender
			);
			for (const p of source.points) assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7);
			assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
			const after = sketch.takeSnapshot();
			assert.equal(sketch.undo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
			assert.equal(sketch.redo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(after));
			sketch.restoreSnapshot(JSON.parse(JSON.stringify(after)));
		}
	});

for (const kind of ['lines', 'arcs', 'mixed', 'arc-neck'] as const)
	for (const reversed of [false, true])
		test(`mixed offset components preview, commit, split and merge: ${kind}, reversed=${reversed}`, () => {
			const { sketch, chain } = mixedOffsetScene(kind, reversed, reversed ? 3 : 0);
			const source = sketch.takeSnapshot();
			const geometry = calculateOffsetGeometry(sketch, chain, 'two_sides', 0.1, 4, false);
			assert.ok(geometry.isValid);
			const groups = offsetContourGroups(geometry.sides[1].primitives);
			assert.equal(groups.length, 2);
			const boundaries = groups.map(primitives =>
				sampledOffsetBoundary({ ...geometry, sides: [{ ...geometry.sides[1], primitives }] })
			);
			for (const boundary of boundaries) assertNoCrossings(boundary);
			assert.ok(Math.max(...boundaries[0].map(p => p.x)) < -10);
			assert.ok(Math.min(...boundaries[1].map(p => p.x)) > 10);
			if (kind === 'mixed')
				assert.ok(
					groups.every(g => g.some(p => p.type === 'spline')),
					'a retained spline disappeared'
				);
			if (kind === 'arc-neck') {
				const shared = groups[0].filter(p => groups[1].some(q => q.sourceId === p.sourceId));
				assert.equal(shared.length, 2, 'both neck arcs must survive in both components');
			}
			const previews = render(sketch, chain, geometry, 'two_sides').previews;
			const created = sketch.withDeferredSolve(() =>
				commitOffsetToSketch(sketch, chain, geometry, 'two_sides', 0.1, 4, false)
			)!;
			assert.deepEqual(
				created.createdIds.map(id => render(sketch).entity(id)),
				previews
			);
			const initial = sketch.takeSnapshot();
			assert.equal(sketch.undo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(source));
			assert.equal(sketch.redo(), true);
			assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(initial));
			const innerId = created.constraintIds[1],
				outerId = created.constraintIds[0];
			const outer = (sketch.constraints.get(outerId) as OffsetConstraint).pairs.map(offsetPairChild);
			const outerRender = outer.map(id => render(sketch).entity(id));
			for (const distance of [0.1, 4, 1, 4, 0.1, 4]) {
				const before = sketch.takeSnapshot(),
					oldPairs = [...(sketch.constraints.get(innerId) as OffsetConstraint).pairs];
				assert.equal(sketch.updateDimensionalConstraint(innerId, distance), true);
				const c = sketch.constraints.get(innerId) as OffsetConstraint;
				const expected = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
				const components = offsetContourGroups(expected.sides[0].primitives);
				assert.equal(components.length, distance === 4 || (kind === 'arc-neck' && distance === 1) ? 2 : 1);
				for (const primitives of components)
					assertNoCrossings(sampledOffsetBoundary({ ...expected, sides: [{ ...expected.sides[0], primitives }] }));
				assertAppliedOffset(sketch, c.pairs.map(offsetPairChild), chain, expected);
				assert.deepEqual(
					outer.map(id => render(sketch).entity(id)),
					outerRender
				);
				for (const p of source.points)
					assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7, 'source geometry moved');
				// Unique surviving sources retain their curve IDs even when their component number changes.
				const pairSource = (p: OffsetConstraint['pairs'][number]) =>
					p.kind === 'line' ? p.origLineId : p.kind === 'circle' ? p.origId : p.origSplineId;
				for (const pair of c.pairs) {
					const previous = oldPairs.filter(p => pairSource(p) === pairSource(pair));
					if (previous.length === 1 && c.pairs.filter(p => pairSource(p) === pairSource(pair)).length === 1)
						assert.equal(offsetPairChild(pair), offsetPairChild(previous[0]));
				}
				for (const id of c.junctionConstraintIds ?? []) {
					const constraint = sketch.constraints.get(id)!;
					const owners = constraint.entityIds
						.map(pointId =>
							c.pairs
								.filter(p => {
									const ids =
										p.kind === 'line'
											? [p.offP1Id, p.offP2Id]
											: p.kind === 'spline'
												? sketch.splines.get(p.offSplineId)!.pointIds
												: (() => {
														const arc = sketch.arcs.get(p.offId)!;
														return [arc.startPointId, arc.endPointId];
													})();
									return ids.includes(pointId);
								})
								.map(p => p.contourIndex ?? 0)
						)
						.flat();
					assert.equal(new Set(owners).size, 1, 'independent components were joined');
				}
				assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
				const after = sketch.takeSnapshot();
				assert.equal(sketch.undo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(before));
				assert.equal(sketch.redo(), true);
				assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(after));
				sketch.restoreSnapshot(JSON.parse(JSON.stringify(after)));
			}
		});

test('a split mixed chain can create an independent closed child from an open source spline', () => {
	const { sketch, chain } = openSplineLoopScene();
	const before = sketch.takeSnapshot(),
		geometry = calculateOffsetGeometry(sketch, chain, 'one_side', -10, 0, false);
	assert.deepEqual(
		offsetContourGroups(geometry.sides[0].primitives).map(g => g.length),
		[2, 1]
	);
	const previews = render(sketch, chain, geometry).previews;
	const created = sketch.withDeferredSolve(() => commitOffsetToSketch(sketch, chain, geometry))!;
	assert.deepEqual(
		created.createdIds.map(id => render(sketch).entity(id)),
		previews
	);
	const constraintId = created.constraintIds[0];
	for (const distance of [5, 10, 15, 5, 10]) {
		const old = sketch.takeSnapshot();
		assert.equal(sketch.updateDimensionalConstraint(constraintId, distance), true);
		const c = sketch.constraints.get(constraintId) as OffsetConstraint;
		const expected = calculateOffsetGeometry(sketch, chain, 'one_side', distance, 0, true);
		assertAppliedOffset(sketch, c.pairs.map(offsetPairChild), chain, expected);
		if (distance > 5) {
			const pair = c.pairs.find(p => p.contourIndex === 1)!;
			assert.equal(pair.kind, 'spline');
			const child = sketch.splines.get(offsetPairChild(pair))!;
			assert.ok(child.isClosed);
			assert.equal(child.pointIds[0], child.pointIds.at(-1));
		}
		for (const p of before.points) assert.ok(sketch.points.get(p.id)!.distanceTo(p) < 1e-7);
		assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
		const after = sketch.takeSnapshot();
		assert.equal(sketch.undo(), true);
		assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(old));
		assert.equal(sketch.redo(), true);
		assert.deepEqual(canonical(sketch.takeSnapshot()), canonical(after));
		sketch.restoreSnapshot(JSON.parse(JSON.stringify(after)));
	}
});

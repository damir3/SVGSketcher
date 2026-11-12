import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import type { SVGRenderer as Renderer, RenderOptions } from '../src/canvas/renderer';
import { Viewport } from '../src/canvas/viewport';
import { getArcSvgPath } from '../src/canvas/svg';
import { SketchDocument } from '../src/model/sketch';
import { calculateFilletGeometry, getConnectedPrimitivesForPoint, type FilletCandidate } from '../src/math/fillet';
import { filletSplinePreview } from '../src/math/filletPreview';
import { extractSplineInterval, getSplineSvgPath, type BezierSegment } from '../src/math/splineReference';
import { Vec2 } from '../src/math/vector';

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
	set innerHTML(_v: string) {
		for (const c of this.children) c.parent = null;
		this.children = [];
	}
	appendChild(child: SvgElement) {
		if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child);
		child.parent = this;
		this.children.push(child);
	}
}
function render(sketch: SketchDocument, viewport: Viewport, options: RenderOptions = {}) {
	const geometry = new SvgElement(),
		previous = globalThis.document;
	const renderer: Renderer = Object.assign(Object.create(SVGRenderer.prototype), {
		geometryGroup: geometry,
		pointGroup: new SvgElement(),
	});
	try {
		(globalThis as any).document = { createElementNS: () => new SvgElement() };
		renderer['renderGeometry'](sketch, viewport, options);
	} finally {
		globalThis.document = previous;
	}
	return (id: string) => {
		const entity = geometry.children.find(c => c.getAttribute('data-id') === id);
		assert.ok(entity);
		const visible = entity.children.find(c => c.getAttribute('class')?.includes('entity-visible'));
		assert.ok(visible);
		const hit = entity.children.find(c => c !== visible && c.getAttribute('d') !== null);
		return { visible, hit };
	};
}
function fillets(sketch: SketchDocument, ids: string[], radius = 10): FilletCandidate[] {
	return ids.map(id => {
		const [a, b] = getConnectedPrimitivesForPoint(sketch, id).primitives;
		const options = {
			cornerVertex: sketch.points.get(id)!.clone(),
			endPointId1: a.endPointId,
			endPointId2: b.endPointId,
		};
		const result = calculateFilletGeometry(
			sketch.toGeoCurve(a.id, a.type)!,
			sketch.toGeoCurve(b.id, b.type)!,
			radius,
			options
		);
		assert.ok(result);
		return {
			id,
			vertexPointId: id,
			primitive1: { type: a.type, id: a.id },
			primitive2: { type: b.type, id: b.id },
			...options,
			result,
		};
	});
}
const source = JSON.parse(
	readFileSync(new URL('./fixtures/point94-fillet.json', import.meta.url), 'utf8')
) as ReturnType<SketchDocument['takeSnapshot']>;
for (const reverseArc of [false, true])
	for (const ids of [['Point-94'], ['Point-98'], ['Point-94', 'Point-98'], ['Point-98', 'Point-94']])
		test(`SVG fillet preview trims arcs and the retained spline interval: ${ids.join('+')}, reversed arc=${reverseArc}`, () => {
			const sketch = new SketchDocument();
			sketch.restoreSnapshot(structuredClone(source));
			sketch.clearHistory();
			const arc = sketch.arcs.get('Arc-1')!;
			if (reverseArc) {
				[arc.startPointId, arc.endPointId] = [arc.endPointId, arc.startPointId];
				arc.clockwise = !arc.clockwise;
			}
			const pending = fillets(sketch, ids),
				viewport = new Viewport(800, 600);
			viewport.zoom = 3.5;
			viewport.panX = 560;
			viewport.panY = 430;
			const original = sketch.splines.get('Spline-1')!.toGeoCurve(sketch)!;
			const before = sketch.takeSnapshot(),
				previews = JSON.stringify(pending);
			const a = pending.find(f => f.id === 'Point-94')?.result,
				b = pending.find(f => f.id === 'Point-98')?.result;
			const segments = extractSplineInterval(original.bezierSegments, a?.param2 ?? 0, b?.param2 ?? 1).map(
				s => [...s] as BezierSegment
			);
			if (a) segments[0][0] = a.t2;
			if (b) segments.at(-1)![3] = b.t2;
			const rendered = render(sketch, viewport, { filletState: { pendingFillets: pending } });
			const expectedSpline = getSplineSvgPath(segments, p => viewport.worldToScreen(p));
			const fullSpline = getSplineSvgPath(original.bezierSegments, p => viewport.worldToScreen(p));
			assert.equal(rendered('Spline-1').visible.getAttribute('d'), expectedSpline);
			assert.notEqual(expectedSpline, fullSpline);
			assert.equal(rendered('Spline-1').hit!.getAttribute('d'), fullSpline, 'original curve stays selectable');
			const center = viewport.worldToScreen(sketch.points.get(arc.centerId)!);
			const start = viewport.worldToScreen(sketch.points.get(arc.startPointId)!),
				end = viewport.worldToScreen(sketch.points.get(arc.endPointId)!);
			const expectedArc = getArcSvgPath(
				center,
				a && !reverseArc ? viewport.worldToScreen(a.t1) : start,
				a && reverseArc ? viewport.worldToScreen(a.t1) : end,
				arc.radius * viewport.zoom,
				arc.clockwise!
			);
			const fullArc = getArcSvgPath(center, start, end, arc.radius * viewport.zoom, arc.clockwise!);
			assert.equal(rendered('Arc-1').visible.getAttribute('d'), expectedArc);
			assert.equal(rendered('Arc-1').hit!.getAttribute('d'), fullArc);
			if (a) assert.notEqual(expectedArc, fullArc);
			assert.deepEqual(sketch.takeSnapshot(), before);
			assert.equal(sketch.canUndo(), false);
			assert.equal(JSON.stringify(pending), previews);
			const cancelled = render(sketch, viewport);
			assert.equal(cancelled('Spline-1').visible.getAttribute('d'), fullSpline);
			assert.equal(cancelled('Arc-1').visible.getAttribute('d'), fullArc);
		});

for (const type of ['fit', 'control'] as const)
	test(`${type} spline preview clips both ends without changing its control points`, () => {
		const sketch = new SketchDocument();
		const ids = sketch.withDeferredSolve(() => {
			const ids = [
				[0, 0],
				[0, 30],
				[30, 60],
				[60, 30],
				[60, 0],
			].map(([x, y]) => sketch.addPoint({ x, y }).id);
			type === 'fit' ? sketch.addFitSpline(ids) : sketch.addControlSpline(ids);
			sketch.addLine(ids[0], sketch.addPoint({ x: -40, y: 0 }).id);
			sketch.addLine(ids.at(-1)!, sketch.addPoint({ x: 100, y: 0 }).id);
			return [ids[0], ids.at(-1)!];
		});
		const spline = [...sketch.splines.values()][0],
			original = spline.toGeoCurve(sketch)!,
			pending = fillets(sketch, ids, 5),
			before = sketch.takeSnapshot();
		const a = pending[0].result!,
			b = pending[1].result!,
			viewport = new Viewport(800, 600);
		const expected = extractSplineInterval(original.bezierSegments, a.param2, b.param2).map(
			s => [...s] as BezierSegment
		);
		expected[0][0] = a.t2;
		expected.at(-1)![3] = b.t2;
		const path = render(sketch, viewport, { filletState: { pendingFillets: pending } })(spline.id).visible.getAttribute(
			'd'
		);
		assert.equal(
			path,
			getSplineSvgPath(expected, p => viewport.worldToScreen(p))
		);
		assert.notEqual(
			path,
			getSplineSvgPath(original.bezierSegments, p => viewport.worldToScreen(p))
		);
		assert.deepEqual(sketch.takeSnapshot(), before);
	});

test('fit spline preview extends the endpoint handle without mutating shared cubic data', () => {
	const segment: BezierSegment = [new Vec2(0, 0), new Vec2(0, 10), new Vec2(10, 20), new Vec2(20, 20)],
		before = JSON.stringify(segment);
	const result = filletSplinePreview([segment], 'fit', { start: { param: -0.1, point: new Vec2(0, -10) } });
	assert.deepEqual(result[0], [new Vec2(0, -10), new Vec2(0, 0), segment[2], segment[3]]);
	assert.equal(JSON.stringify(segment), before);
	assert.deepEqual(
		filletSplinePreview([segment], 'fit', {
			start: { param: 0.8, point: new Vec2() },
			end: { param: 0.2, point: new Vec2() },
		}),
		[]
	);
});

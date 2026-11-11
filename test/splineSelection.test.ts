import assert from 'node:assert/strict';
import { it } from 'node:test';
import { register } from 'node:module';
import { CanvasInteraction } from '../src/canvas/interaction';
import type { SVGRenderer as Renderer } from '../src/canvas/renderer';
import { COLORS } from '../src/canvas/styles';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';

// Render the actual SVG output in Node, including Vite's raw icon imports.
register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { SVGRenderer } = await import('../src/canvas/renderer');

class SvgElement {
	attributes = new Map<string, string>();
	children: SvgElement[] = [];
	parent: SvgElement | null = null;
	style = {};
	classList = {
		add: (name: string) => this.setAttribute('class', `${this.getAttribute('class') ?? ''} ${name}`),
	};
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	set innerHTML(_value: string) {
		for (const child of this.children) child.parent = null;
		this.children = [];
	}
	appendChild(child: SvgElement): void {
		if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
		child.parent = this;
		this.children.push(child);
	}
}

function renderGeometry(sketch: SketchDocument, viewport = new Viewport(800, 600)) {
	const previousDocument = globalThis.document;
	const geometry = new SvgElement(),
		points = new SvgElement();
	const renderer: Renderer = Object.assign(Object.create(SVGRenderer.prototype), {
		geometryGroup: geometry,
		pointGroup: points,
	});
	try {
		(globalThis as any).document = { createElementNS: () => new SvgElement() };
		renderer['renderGeometry'](sketch, viewport);
	} finally {
		(globalThis as any).document = previousDocument;
	}
	const entity = (id: string, type: string): SvgElement => {
		const found = [...geometry.children, ...points.children].find(
			el => el.getAttribute('data-id') === id && el.getAttribute('data-type') === type
		);
		assert.ok(found, `${type} ${id} should remain visible`);
		return found;
	};
	return { entity };
}

function assertSelected(element: SvgElement, expected: boolean): void {
	assert.equal((element.getAttribute('class') ?? '').split(/\s+/).includes('is-selected'), expected);
	const visible = element.children.find(child => child.getAttribute('class')?.includes('entity-visible'));
	assert.ok(visible);
	assert.equal(visible.getAttribute('stroke') === COLORS.selected, expected);
}

function createSpline(type: 'fit' | 'control') {
	const sketch = new SketchDocument();
	const points = [
		[10, 10],
		[20, 30],
		[40, 30],
		[50, 10],
	].map(([x, y]) => sketch.addPoint(new Vec2(x, y)));
	const ids = points.map(point => point.id);
	const spline = type === 'fit' ? sketch.addFitSpline(ids) : sketch.addControlSpline(ids);
	return { sketch, spline, points };
}

for (const type of ['fit', 'control'] as const) {
	it(`${type} spline points and handles can be selected without highlighting the entire curve`, () => {
		const { sketch, spline, points } = createSpline(type);
		const handle = sketch.lines.get(spline.tangentLineIds![0])!;
		for (const item of [
			{ id: points[1].id, type: 'point' as const },
			{ id: handle.id, type: 'line' as const },
			{ id: handle.p1Id, type: 'point' as const },
		]) {
			sketch.selectEntity(item.id, item.type);
			assert.equal(sketch.selection.splineIds.size, 0);
			const rendered = renderGeometry(sketch);
			assertSelected(rendered.entity(spline.id, 'spline'), false);
			assertSelected(rendered.entity(item.id, item.type), true);
			for (const id of spline.tangentLineIds!) rendered.entity(id, 'line');
		}
	});

	it(`${type} spline still highlights when the curve itself is selected`, () => {
		const { sketch, spline } = createSpline(type);
		sketch.selectEntity(spline.id, 'spline');
		assertSelected(renderGeometry(sketch).entity(spline.id, 'spline'), true);
	});

	it(`${type} spline box selection distinguishes a contained point from a crossing curve`, () => {
		const { sketch, spline, points } = createSpline(type);
		const viewport = new Viewport(800, 600);
		const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
			sketch,
			viewport,
		});
		const left = viewport.worldToScreen(new Vec2(9, 11)),
			right = viewport.worldToScreen(new Vec2(11, 9));
		interaction['finishBoxSelection'](left, right, false);
		assert.ok(sketch.selection.pointIds.has(points[0].id));
		assert.equal(sketch.selection.splineIds.size, 0);
		assertSelected(renderGeometry(sketch, viewport).entity(spline.id, 'spline'), false);
		interaction['finishBoxSelection'](right, left, false);
		assert.ok(sketch.selection.splineIds.has(spline.id));
		assertSelected(renderGeometry(sketch, viewport).entity(spline.id, 'spline'), true);
	});
}

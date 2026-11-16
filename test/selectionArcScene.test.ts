import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { CanvasInteraction } from '../src/canvas/interaction';
import { SelectTool } from '../src/canvas/tools/selection/select';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { importSketchFromSVG } from '../src/model/io/svgIO';
import { curvesIntersectAABB } from '../src/math/aabb';

register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { SVGRenderer } = await import('../src/canvas/renderer');
const scene = readFileSync(new URL('./fixtures/selection-arc-issue.svg', import.meta.url), 'utf8');

class SvgElement {
	attributes = new Map<string, string>();
	children: SvgElement[] = [];
	style = {};
	classList = {
		add: (name: string) => this.setAttribute('class', `${this.getAttribute('class') ?? ''} ${name}`),
		remove: () => {},
	};
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
		this.children.push(child);
	}
}

test('user scene selects and renders only Arc-11 for the crossing box (60,-40) to (35,-20)', () => {
	const sketch = new SketchDocument(),
		imported = importSketchFromSVG(sketch, scene);
	assert.equal(imported.success, true);
	const viewport = Object.assign(new Viewport(), imported.viewport);
	const before = sketch.takeSnapshot();
	const curves = [...sketch.arcs.values()].map(arc => arc.toGeoCurve(sketch)!);
	const hits = curvesIntersectAABB(curves, new Vec2(35, -40), new Vec2(60, -20));
	assert.deepEqual(
		curves.filter((_, i) => hits[i]).map(c => c.id),
		['Arc-11']
	);

	const geometry = new SvgElement(),
		points = new SvgElement();
	const renderer = Object.assign(Object.create(SVGRenderer.prototype), {
		geometryGroup: geometry,
		pointGroup: points,
		clearPreviews() {},
		renderSelectionBox() {},
	});
	const host: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
		sketch,
		viewport,
		renderer,
		activeTool: 'select',
		activeToolInstance: null,
		svg: { getBoundingClientRect: () => ({ left: 300, top: 80 }), classList: { remove() {} } },
		render() {
			renderer['renderGeometry'](sketch, viewport);
		},
	});
	const previousDocument = globalThis.document;
	try {
		(globalThis as any).document = { createElementNS: () => new SvgElement() };
		for (const zoom of [imported.viewport!.zoom, 6, 12]) {
			viewport.zoom = zoom;
			const start = viewport.worldToScreen(new Vec2(60, -40)),
				end = viewport.worldToScreen(new Vec2(35, -20));
			const mouse = (screen: Vec2) =>
				({
					clientX: screen.x + 300,
					clientY: screen.y + 80,
					shiftKey: false,
					target: { closest: () => null, getAttribute: () => null },
				}) as unknown as MouseEvent;
			host.lastMouseScreen = start;
			SelectTool.handleMouseDown(host, mouse(start), start, null);
			assert.equal(host.isBoxSelecting, true);
			assert.equal(SelectTool.handleDragMouseMove(host, mouse(end), end, viewport.screenToWorld(end)), true);
			host.lastMouseScreen = end;
			host['handleMouseUp'](mouse(end));
			assert.equal(host.isBoxSelecting, false);
			assert.deepEqual([...sketch.selection.arcIds], ['Arc-11']);
			assert.deepEqual(
				geometry.children
					.filter(
						el =>
							el.getAttribute('data-type') === 'arc' && el.getAttribute('class')?.split(/\s+/).includes('is-selected')
					)
					.map(el => el.getAttribute('data-id')),
				['Arc-11']
			);
			assert.deepEqual(sketch.takeSnapshot(), before);
			assert.equal(sketch.canUndo(), false);
		}
	} finally {
		(globalThis as any).document = previousDocument;
	}
});

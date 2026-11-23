import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AABB } from '../src/math/aabb';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import type { SvgExportDimensions } from '../src/model/io/svgIO';
import { register } from 'node:module';
import { Viewport } from '../src/canvas/viewport';

register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { SVGRenderer, COLORS, renderAngleExtensionLines } = await import('../src/canvas/renderer');
const { LIGHT_THEME } = await import('../src/theme/themes');

class SvgElement {
	attributes: Record<string, string> = {};
	children: SvgElement[] = [];
	parent?: SvgElement;
	style = {};
	textContent = '';
	constructor(readonly tag: string) {}
	setAttribute(name: string, value: string) {
		this.attributes[name] = String(value);
	}
	get innerHTML(): string {
		return this.textContent + this.children.map(child => child.outerHTML).join('');
	}
	set innerHTML(_value: string) {
		this.children = [];
	}
	get outerHTML(): string {
		const attrs = Object.entries(this.attributes)
			.map(([key, value]) => `${key}="${value}"`)
			.join(' ');
		return `<${this.tag} ${attrs}>${this.innerHTML}</${this.tag}>`;
	}
	appendChild(child: SvgElement) {
		child.remove();
		child.parent = this;
		this.children.push(child);
	}
	remove() {
		if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
		this.parent = undefined;
	}
	querySelectorAll(selector: string): SvgElement[] {
		return this.children.flatMap(child => [
			...(selector === '[stroke-width]'
				? child.attributes['stroke-width'] !== undefined
					? [child]
					: []
				: child.tag === selector || child.attributes.class?.split(' ').includes(selector.slice(1))
					? [child]
					: []),
			...child.querySelectorAll(selector),
		]);
	}
	getBBox() {
		return { x: 100, y: 200, width: 500, height: 300 };
	}
}

const dimensions: SvgExportDimensions = {
	svg: '<defs><marker id="dim-arrow" /></defs><g><text>70</text><text>90°</text><text>R30</text><text>Ø40</text></g>',
	bounds: new AABB(new Vec2(-300, -200)).addPoint(new Vec2(500, 400)),
};

function scene() {
	const sketch = new SketchDocument();
	const a = sketch.addPoint(new Vec2(0, 0));
	const b = sketch.addPoint(new Vec2(70, 0));
	sketch.addLine(a.id, b.id);
	sketch.addDistanceConstraint(a.id, b.id, 70, 25, 'horizontal');
	return sketch;
}

test('dimension markup is opt-in and does not affect default export bounds', () => {
	const sketch = scene();
	const plain = sketch.exportSVG();
	for (const layers of [{}, { dimensions: false }]) {
		const svg = sketch.exportSVG(undefined, 1, layers, dimensions);
		assert.doesNotMatch(svg, /<g id="dimensions"/);
		assert.equal(svg.match(/viewBox="([^"]+)"/)![1], plain.match(/viewBox="([^"]+)"/)![1]);
		assert.doesNotMatch(svg, /<marker/);
	}
});

test('exported point diameter is twice the primitive stroke width in every unit scale', () => {
	const sketch = scene();
	sketch.addPoint(new Vec2(100, 50));
	for (const scale of [1, 96 / 25.4]) {
		const svg = sketch.exportSVG(undefined, scale);
		const width = Number(svg.match(/<line[^>]*stroke-width="([^"]+)"/)![1]);
		const radius = Number(svg.match(/<circle cx="100.00" cy="-50.00" r="([^"]+)"/)![1]);
		assert.equal(radius * 2, width * 2);
	}
});

test('custom line width controls geometry, engineering dashes and points and survives SVG reopening', () => {
	const sketch = scene();
	const a = sketch.addPoint(new Vec2(0, 50));
	const b = sketch.addPoint(new Vec2(70, 50));
	const c = sketch.addPoint(new Vec2(0, 120));
	sketch.addLine(a.id, b.id, 'hidden');
	sketch.addCircle(a.id, 10, 'hidden');
	sketch.addArc(a.id, b.id, c.id, 70, false, 'centerline');
	sketch.addCircle(b.id, 15, 'phantom');
	sketch.addLine(a.id, c.id, 'cutting_plane');
	sketch.addPoint(new Vec2(100, 50));
	const widthFactors = {
		solid: [1],
		centerlines: [0.5],
		'hidden-lines': [0.5, 0.5],
		'phantom-lines': [0.5],
		'cutting-planes': [1, 1, 1],
	};
	for (const strokeWidth of [0.1, 0.35, 0.8]) {
		for (const scale of [1, 96 / 25.4]) {
			const svg = sketch.exportSVG(undefined, scale, { strokeWidth });
			for (const [layer, factors] of Object.entries(widthFactors)) {
				const group = svg.match(new RegExp(`<g id="${layer}"[^>]*>([\\s\\S]*?)</g>`))?.[1] ?? '';
				const widths = Array.from(group.matchAll(/stroke-width="([^"]+)"/g), match => Number(match[1]));
				assert.deepEqual(widths, factors.map(factor => strokeWidth * factor), layer);
			}
			const hiddenDashes = svg.match(/<g id="hidden-lines"[^>]*stroke-dasharray="([^"]+)"/)![1];
			assert.deepEqual(
				hiddenDashes.split(' ').map(Number),
				[5, 3].map(length => Number((strokeWidth * length).toPrecision(8)))
			);
			assert.equal(Number(svg.match(/<circle cx="100.00" cy="-50.00" r="([^"]+)"/)![1]), strokeWidth);
			const reopened = new SketchDocument();
			const result = reopened.importSVG(svg);
			assert.equal(result.success, true);
			assert.deepEqual(result.exportSettings, { strokeWidth });
			const exportedAgain = reopened.exportSVG(undefined, scale, result.exportSettings);
			assert.match(exportedAgain, new RegExp(`stroke-width="${strokeWidth}"`));
		}
	}
});

test('line width validation rejects invalid exports and ignores invalid or missing saved settings', () => {
	const sketch = scene();
	for (const strokeWidth of [0, -1, NaN, Infinity]) {
		assert.throws(() => sketch.exportSVG(undefined, 1, { strokeWidth }), RangeError);
	}
	const svg = sketch.exportSVG();
	for (const settings of [undefined, { strokeWidth: 0 }, { strokeWidth: -1 }, { strokeWidth: '0.2' }]) {
		const withoutSettings = svg.replace(/"exportSettings":\s*\{[^}]+\},/, '');
		const content = settings
			? withoutSettings.replace('"version": 1,', `"version": 1, "exportSettings": ${JSON.stringify(settings)},`)
			: withoutSettings;
		const result = new SketchDocument().importSVG(content);
		assert.equal(result.success, true);
		assert.equal(result.exportSettings, undefined);
	}
});

test('angle extension lines use the solid dimension style and the same 8px overhang', () => {
	const previous = globalThis.document;
	try {
		globalThis.document = { createElementNS: (_ns: string, tag: string) => new SvgElement(tag) } as unknown as Document;
		for (const color of [COLORS.primary, COLORS.selected]) {
			const group = new SvgElement('g');
			renderAngleExtensionLines(
				group as unknown as SVGElement,
				new Vec2(),
				0,
				40,
				new Vec2(),
				new Vec2(10, 0),
				color
			);
			assert.equal(group.children.length, 1);
			const line = group.children[0];
			assert.equal(line.attributes['stroke-dasharray'], undefined);
			assert.equal(line.attributes['stroke-width'], '1');
			assert.equal(line.attributes.stroke, color);
			assert.equal(line.attributes.x1, '10');
			assert.equal(line.attributes.x2, '48');
		}
	} finally {
		globalThis.document = previous;
	}
});

test('enabled dimensions retain labels and arrow definitions, scale together, and expand export bounds', () => {
	const sketch = scene();
	const before = sketch.takeSnapshot();
	for (const scale of [1, 96 / 25.4]) {
		const svg = sketch.exportSVG(undefined, scale, { dimensions: true }, dimensions);
		assert.ok(svg.includes(`<g id="dimensions" transform="scale(${scale})">${dimensions.svg}</g>`));
		const bounds = svg
			.match(/viewBox="([^"]+)"/)![1]
			.split(' ')
			.map(Number);
		for (const [i, value] of [-340, -440, 880, 680].entries()) {
			assert.ok(Math.abs(bounds[i] - value * scale) < 0.01);
		}
		const restored = new SketchDocument();
		assert.equal(restored.importSVG(svg).success, true);
		assert.deepEqual(
			JSON.parse(JSON.stringify(restored.takeSnapshot())),
			JSON.parse(JSON.stringify(before)),
			'rendered dimensions do not become extra editable primitives'
		);
	}
	assert.deepEqual(sketch.takeSnapshot(), before);
});

test('an empty sketch can export dimensions alone without geometry or invalid bounds', () => {
	const svg = new SketchDocument().exportSVG(
		undefined,
		1,
		{ solid: false, engineeringLines: false, regions: false, images: false, dimensions: true },
		dimensions
	);
	assert.match(svg, /id="dimensions"/);
	assert.doesNotMatch(svg, /id="solid"|id="construction"|id="regions"|NaN|Infinity/);
	assert.match(svg, /viewBox="-340.00 -440.00 880.00 680.00"/);
});

test('renderer exports only dimensions without selection styling or changing canvas visibility, and converts Y-up bounds', () => {
	const previous = globalThis.document;
	try {
		globalThis.document = { createElementNS: (_ns: string, tag: string) => new SvgElement(tag) } as unknown as Document;
		const sketch = scene();
		const line = [...sketch.lines.values()][0];
		sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
		const dimension = [...sketch.constraints.values()].find(constraint => constraint.isDimensional)!;
		dimension.expression = '35 * 2';
		sketch.selection.constraintIds.add(dimension.id);
		const svg = new SvgElement('svg');
		const renderer = new SVGRenderer(svg as unknown as SVGSVGElement);
		renderer.setDimensionsVisible(false);
		const before = svg.innerHTML;
		const viewport = Object.assign(new Viewport(800, 600), { panX: 50, panY: 100, zoom: 2 });
		const exported = renderer.exportDimensions(sketch, viewport)!;
		assert.ok(exported.svg.includes('dim-arrow'));
		assert.ok(exported.svg.includes('>70</text>'));
		assert.ok(!exported.svg.includes('fx:'));
		assert.equal(dimension.expression, '35 * 2');
		assert.ok(exported.svg.includes('translate(-25 -50) scale(0.5)'));
		assert.ok(!exported.svg.includes('var(--'), 'theme variables are resolved to concrete colors');
		assert.ok(exported.svg.includes(LIGHT_THEME.canvas.primary), 'export uses the default theme palette');
		assert.ok(!exported.svg.split('</defs>')[1].includes(LIGHT_THEME.canvas.selected));
		assert.ok(!exported.svg.includes('constraint-badge'));
		assert.deepEqual(exported.bounds.min, new Vec2(17, -208));
		assert.deepEqual(exported.bounds.max, new Vec2(283, -42));
		assert.equal(svg.innerHTML, before, 'temporary export nodes are removed');
		assert.equal(sketch.selection.constraintIds.has(dimension.id), true);
		for (const zoom of [1, 2, 4]) {
			viewport.zoom = zoom;
			for (const strokeWidth of [0.2, 0.5, 1]) {
				const annotations = renderer.exportDimensions(sketch, viewport, strokeWidth)!;
				const output = sketch.exportSVG(undefined, 1, { dimensions: true, strokeWidth }, annotations);
				const primitiveWidth = Number(output.match(/<line[^>]*stroke-width="([^"]+)"/)![1]);
				for (const match of annotations.svg.matchAll(/stroke-width="([^"]+)"/g)) {
					assert.equal(primitiveWidth / (Number(match[1]) / zoom), 2, 'export stroke ratio stays 2:1 at every zoom');
				}
			}
		}
		assert.equal(renderer.exportDimensions(new SketchDocument(), viewport), undefined);
		assert.equal(svg.innerHTML, before);
	} finally {
		globalThis.document = previous;
	}
});

test('cutting-plane letters export at the same effective size as dimension labels', () => {
	const previous = globalThis.document;
	try {
		globalThis.document = { createElementNS: (_ns: string, tag: string) => new SvgElement(tag) } as unknown as Document;
		const sketch = scene();
		const a = sketch.addPoint(new Vec2(0, 35));
		const b = sketch.addPoint(new Vec2(70, 35));
		sketch.addLine(a.id, b.id, 'cutting_plane');
		const renderer = new SVGRenderer(new SvgElement('svg') as unknown as SVGSVGElement);
		const viewport = new Viewport(800, 600);
		for (const zoom of [1, 2.5, 8]) {
			viewport.zoom = zoom;
			for (const [scale, strokeWidth] of [[1, 0.2], [96 / 25.4, 0.8]]) {
				const dimensions = renderer.exportDimensions(sketch, viewport, strokeWidth)!;
				const svg = sketch.exportSVG(undefined, scale, { dimensions: true, strokeWidth }, dimensions);
				const dimensionFont = Number(dimensions.svg.match(/font-size="([^"]+)"/)![1]);
				const dimensionScale = Number(dimensions.svg.match(/translate\([^)]+\) scale\(([^)]+)\)/)![1]);
				const letters = [...svg.matchAll(/<text [^>]*font-size="([^"]+)"[^>]*>A<\/text>/g)];
				assert.equal(letters.length, 2);
				for (const letter of letters) {
					assert.ok(Math.abs(Number(letter[1]) - dimensionFont * dimensionScale) < 1e-10);
				}

				const withoutDimensions = sketch.exportSVG(viewport, scale, { strokeWidth });
				assert.equal(
					withoutDimensions.match(/<text [^>]*font-size="([^"]+)"[^>]*>A<\/text>/)?.[1],
					letters[0][1]
				);
			}
		}
	} finally {
		globalThis.document = previous;
	}
});

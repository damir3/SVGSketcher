import { Vec2 } from '../src/math/vector';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CanvasInteraction } from '../src/canvas/interaction';
import { ImageTool } from '../src/canvas/tools/modify/image';
import type { ToolMouseEvent } from '../src/canvas/tools/types';
import { Viewport } from '../src/canvas/viewport';
import { SketchDocument } from '../src/model/sketch';

it('selects a background image on click and selects geometry on a box drag starting over it', () => {
	const sketch = new SketchDocument();
	const viewport = new Viewport(800, 600);
	const point = sketch.addPoint(viewport.screenToWorld({ x: 200, y: 200 }));
	const image = sketch.addImage({
		fileName: 'reference.png',
		x: 0,
		y: 0,
		width: 200,
		height: 100,
		angle: 0,
		opacity: 1,
	});
	const selectedImages: string[] = [];
	const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
		sketch,
		viewport,
		activeTool: 'select',
		lastClickPos: { x: 0, y: 0 },
		svg: { getBoundingClientRect: () => ({ left: 0, top: 0 }), classList: { remove() {} } },
		renderer: { clearPreviews() {} },
		highlightManager: { clear() {}, update() {} },
		render() {},
		selectImage(id: string) {
			selectedImages.push(id);
		},
	});
	const eventAt = (clientX: number, clientY: number) =>
		({
			clientX,
			clientY,
			button: 0,
			target: { closest: () => ({ getAttribute: () => image.id }) },
		}) as unknown as MouseEvent;

	interaction['handleMouseDown'](eventAt(150, 150));
	assert.deepEqual(selectedImages, []);
	interaction['handleMouseUp'](eventAt(150, 150));
	assert.deepEqual(selectedImages, [image.id]);

	interaction['handleMouseDown'](eventAt(150, 150));
	interaction['handleMouseUp'](eventAt(250, 250));
	assert.ok(sketch.selection.pointIds.has(point.id));
	assert.deepEqual(selectedImages, [image.id]);
});

it('exports images as local SVG links and restores their editable placement', () => {
	const sketch = new SketchDocument();
	const added = sketch.addImage({
		fileName: 'reference & study.png',
		objectUrl: 'blob:https://example.test/session-reference',
		x: 20,
		y: 30,
		width: 40,
		height: 20,
		naturalWidth: 1600,
		naturalHeight: 800,
		pivotX: 240,
		pivotY: -80,
		angle: 90,
		opacity: 0.7,
	});
	sketch.updateImage(added.id, { width: 80, height: 40 });
	const image = sketch.images.get(added.id)!;

	const svg = sketch.exportSVG();
	assert.match(svg, /<image href="\.\/reference%20%26%20study\.png"/);
	assert.match(svg, /opacity="0\.7" preserveAspectRatio="none" transform="rotate\(-90 20 -30\)"/);
	assert.doesNotMatch(svg, /blob:|data:image|objectUrl/);
	assert.match(svg, /viewBox="-10\.00 -80\.00 60\.00 100\.00"/);

	const restored = new SketchDocument();
	assert.equal(restored.importSVG(svg).success, true);
	const { objectUrl, ...placement } = image;
	assert.deepEqual(restored.images.get(image.id), placement);
});

it('moves from the offset image pivot and holds it fixed during rotation and scaling', () => {
	const sketch = new SketchDocument();
	const viewport = new Viewport();
	viewport.zoom = 4;
	const { id } = sketch.addImage({
		fileName: 'reference.png',
		x: 10,
		y: 20,
		width: 80,
		height: 40,
		naturalWidth: 800,
		naturalHeight: 400,
		pivotX: 100,
		pivotY: 50,
		angle: 0,
		opacity: 1,
	});
	const tool = new ImageTool(() => {});
	tool.activate({ sketch, viewport, setCursor() {}, renderer: { renderImages() {} } } as Parameters<
		typeof tool.activate
	>[0]);
	tool.imageId = id;
	const eventAt = (x: number, y: number) => {
		const world = new Vec2(x, y);
		return { world, screen: viewport.worldToScreen(world) } as ToolMouseEvent;
	};
	const drag = (from: ToolMouseEvent, to: ToolMouseEvent) => {
		assert.equal(tool.onMouseDown(from), true);
		tool.onMouseMove(to);
		tool.onMouseUp(to);
	};
	const assertPlacement = (expected: number[]) => {
		const { x, y, angle, width, height } = sketch.images.get(id)!;
		assert.deepEqual(
			[x, y, angle, width, height].map(value => Number(value.toFixed(8))),
			expected
		);
	};

	// The pivot is at (20, 15). The rotation handle starts 36 screen pixels above the top edge.
	assert.equal(tool.onMouseDown(eventAt(10, 20)), false);
	drag(eventAt(10, 49), eventAt(-14, 5));
	assertPlacement([15, 5, 90, 80, 40]);

	// Double the vector from the fixed pivot to the rotated top-right corner.
	drag(eventAt(-5, 45), eventAt(-30, 75));
	assertPlacement([10, -5, 90, 160, 80]);
	drag(eventAt(20, 15), eventAt(28, 12));
	assertPlacement([18, -8, 90, 160, 80]);
});

it('shows and sets the pivot coordinates in the Image position fields', () => {
	const sketch = new SketchDocument();
	const { id } = sketch.addImage({
		fileName: 'reference.png',
		x: 10,
		y: 20,
		width: 80,
		height: 40,
		naturalWidth: 800,
		naturalHeight: 400,
		pivotX: 100,
		pivotY: 50,
		angle: 90,
		opacity: 1,
	});
	const tool = new ImageTool(() => {});
	tool.activate({ sketch, setCursor() {} } as Parameters<typeof tool.activate>[0]);
	tool.imageId = id;
	const panel = tool.sidebarPanel!;
	assert.match(panel.render(), /id="image-x"[^>]*value="15"/);
	assert.match(panel.render(), /id="image-y"[^>]*value="30"/);

	const xInput = Object.assign(new EventTarget(), { valueAsNumber: -12, value: '' });
	const yInput = Object.assign(new EventTarget(), { valueAsNumber: 0, value: '' });
	const inputs = new Map([
		['#image-x', xInput],
		['#image-y', yInput],
	]);
	panel.bindEvents?.({ querySelector: (selector: string) => inputs.get(selector) } as unknown as HTMLElement);
	xInput.dispatchEvent(new Event('change'));
	assert.equal(yInput.value, '30');
	yInput.dispatchEvent(new Event('change'));
	assert.equal(xInput.value, '-12');
	assert.equal(yInput.value, '0');
	assert.equal(sketch.images.get(id)?.x, -17);
	assert.equal(sketch.images.get(id)?.y, -10);
});

it('keeps the local source available through image edits, deletion and undo', () => {
	const sketch = new SketchDocument();
	const image = sketch.addImage({
		fileName: 'reference.png',
		objectUrl: 'blob:original',
		x: 0,
		y: 0,
		width: 20,
		height: 10,
		angle: 0,
		opacity: 1,
	});
	sketch.updateImage(image.id, { fileName: 'replacement.png', objectUrl: 'blob:replacement', opacity: 0.5 });
	sketch.removeImage(image.id);
	assert.equal(sketch.images.size, 0);
	assert.ok(sketch.undo());
	assert.equal(sketch.images.get(image.id)?.objectUrl, 'blob:replacement');
	assert.ok(sketch.undo());
	assert.deepEqual(sketch.images.get(image.id), image);
	assert.ok(sketch.redo());
	assert.ok(sketch.redo());
	assert.equal(sketch.images.size, 0);
});

it('enables Convert to Primitives only when the image has a local file reference', () => {
	const sketch = new SketchDocument();
	const missing = sketch.addImage({
		fileName: 'missing.png',
		x: 0,
		y: 0,
		width: 100,
		height: 80,
		angle: 0,
		opacity: 1,
	});
	const linked = sketch.addImage({
		fileName: 'linked.png',
		objectUrl: 'blob:linked',
		x: 0,
		y: 0,
		width: 100,
		height: 80,
		angle: 0,
		opacity: 1,
	});
	const tool = new ImageTool(() => {});
	tool.activate({ sketch, setCursor() {} } as any);

	tool.imageId = missing.id;
	const missingHtml = tool.sidebarPanel!.render();
	assert.match(missingHtml, /image-convert[^>]*disabled/);

	tool.imageId = linked.id;
	const linkedHtml = tool.sidebarPanel!.render();
	assert.match(linkedHtml, /\bimage-convert"\s*>/);
});

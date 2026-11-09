import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CanvasInteraction } from '../src/canvas/interaction';
import { ImageTool } from '../src/canvas/tools/modify/image';
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
	assert.match(linkedHtml, /class="btn-mirror-ok image-convert"\s*>/);
});

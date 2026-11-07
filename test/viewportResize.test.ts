import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Viewport } from '../src/canvas/viewport';

it('keeps the panned view in frame and restores it after mixed-aspect resizes', () => {
	const viewport = new Viewport(800, 600);
	viewport.pan(80, -40);
	const center = viewport.screenToWorld({ x: 400, y: 300 });
	const leftTop = viewport.screenToWorld({ x: 0, y: 0 });
	const rightBottom = viewport.screenToWorld({ x: 800, y: 600 });

	viewport.resize(400, 600);
	assert.equal(viewport.zoom, 2);
	assert.deepEqual(viewport.worldToScreen(center), { x: 200, y: 300 });
	assert.deepEqual(viewport.worldToScreen(leftTop), { x: 0, y: 150 });
	assert.deepEqual(viewport.worldToScreen(rightBottom), { x: 400, y: 450 });

	viewport.resize(400, 300);
	assert.equal(viewport.zoom, 2);
	viewport.resize(800, 600);
	assert.equal(viewport.zoom, 4);
	assert.deepEqual(viewport.worldToScreen(center), { x: 400, y: 300 });
});

it('uses the current camera after zooming and ignores a collapsed canvas', () => {
	const viewport = new Viewport(800, 600);
	viewport.resize(400, 600);
	viewport.zoomAt({ x: 200, y: 300 }, 2);
	assert.equal(viewport.resize(0, 600), false);
	assert.equal(viewport.width, 400);

	viewport.resize(400, 300);
	assert.equal(viewport.zoom, 2);
});

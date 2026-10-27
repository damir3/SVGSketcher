import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { CanvasInteraction } from '../src/canvas/interaction';
import { Viewport } from '../src/canvas/viewport';
import { vec } from '../src/math/vector';

function setupMockDocument() {
	const origDoc = (globalThis as any).document;
	const origWin = (globalThis as any).window;
	const makeEl = () => ({
		style: {},
		classList: { add: () => {}, remove: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
		appendChild: () => {},
		querySelector: () => makeEl(),
		querySelectorAll: () => [],
		value: '',
		checked: false,
	});
	(globalThis as any).document = {
		createElement: (_tag: string) => makeEl(),
		createElementNS: (_ns: string, _tag: string) => ({
			setAttribute: () => {},
			style: {},
			appendChild: () => {},
		}),
		body: {
			appendChild: () => {},
			removeChild: () => {},
		},
	};
	(globalThis as any).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	return () => {
		(globalThis as any).document = origDoc;
		(globalThis as any).window = origWin;
	};
}

describe('Grid Snapping & Drag Precision', () => {
	it('dragPoint snaps/moves free point to exact coordinates with 0 offset (no 0.023 residual error)', () => {
		const sketch = new SketchDocument();
		const pt = sketch.addPoint(0, 0);

		// Incremental drag simulation (similar to real mouse move trajectory)
		for (let i = 1; i <= 20; i++) {
			sketch.dragPoint(pt.id, i * 0.5, i * 0.5);
		}
		// Final snap to (10, 10)
		sketch.dragPoint(pt.id, 10, 10);

		assert.equal(pt.x, 10, 'pt.x should be exactly 10');
		assert.equal(pt.y, 10, 'pt.y should be exactly 10');
	});

	it('dragLine moves line endpoints exactly to target coordinates', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(50, 0);
		const line = sketch.addLine(p1.id, p2.id);

		sketch.dragLine(line.id, 20, 30, 70, 30);

		assert.equal(p1.x, 20);
		assert.equal(p1.y, 30);
		assert.equal(p2.x, 70);
		assert.equal(p2.y, 30);
	});

	it('dragCircle moves center point exactly to target coordinates', () => {
		const sketch = new SketchDocument();
		const c = sketch.addPoint(0, 0);
		const circle = sketch.addCircle(c.id, 25);

		sketch.dragCircle(circle.id, 40, 60);

		assert.equal(c.x, 40);
		assert.equal(c.y, 60);
	});

	it('findSnap returns clean grid coordinates and snaps within adaptive distance', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const viewport = new Viewport(800, 600);
			viewport.zoom = 4.0; // 4 px per world unit -> gridStep = 5 mm, gridStepPx = 20 px
			const fakeSvg = {
				style: {},
			classList: { add: () => {}, remove: () => {}, toggle: () => {} },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
			const renderer = {
				clearPreviews: () => {},
				renderSnapIndicator: () => {},
				render: () => {},
				rectangularGizmoHandles: new Map(),
				selectionBox: null,
			} as any;
			const interaction = new CanvasInteraction(fakeSvg, sketch, viewport, renderer);

			// Origin (0,0) on screen is at (400, 300)
			const originScreen = viewport.worldToScreen(0, 0);
			assert.equal(originScreen.x, 400);
			assert.equal(originScreen.y, 300);

			// Cursor 5px away from (0,0) on screen (within adaptive snap radius of ~9px)
			const snap = interaction.findSnap(vec(405, 300));
			assert.ok(snap, 'Snap should be found');
			assert.equal(snap.type, 'grid');
			assert.equal(snap.worldPos.x, 0);
			assert.equal(snap.worldPos.y, 0);
			assert.equal(snap.screenPos.x, 400);
			assert.equal(snap.screenPos.y, 300);
		} finally {
			cleanupDoc();
		}
	});

	it('onMouseUp after dragging point onto grid snaps point to exact grid coordinates', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const viewport = new Viewport(800, 600);
			viewport.zoom = 4.0;
			const fakeSvg = {
				style: {},
				classList: { add: () => {}, remove: () => {}, toggle: () => {} },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
			const renderer = {
				clearPreviews: () => {},
				renderSnapIndicator: () => {},
				render: () => {},
				rectangularGizmoHandles: new Map(),
				selectionBox: null,
			} as any;
			const interaction = new CanvasInteraction(fakeSvg, sketch, viewport, renderer);

			const pt = sketch.addPoint(12.34, 15.67);

			// Simulate point drag
			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = pt.id;
			(interaction as any).dragPointStartWorld = vec(pt.x, pt.y);
			(interaction as any).hasDragged = true;

			// Release mouse near screen pos corresponding to world (25, 20)
			const targetScreen = viewport.worldToScreen(25, 20);
			(interaction as any).handleMouseUp({
				clientX: targetScreen.x + 2,
				clientY: targetScreen.y - 1,
				button: 0,
			} as any);

			assert.equal(pt.x, 25, 'Point X should snap exactly to grid 25');
			assert.equal(pt.y, 20, 'Point Y should snap exactly to grid 20');
		} finally {
			cleanupDoc();
		}
	});
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { CanvasInteraction } from '../src/canvas/interaction';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { computeNaturalFitHandles } from '../src/math/spline';

function setupMockDocument() {
	const origDoc = (globalThis as any).document;
	const origWin = (globalThis as any).window;
	const makeEl = () => ({
		style: {},
		setAttribute: () => {},
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
		const pt = sketch.addPoint({ x: 0, y: 0 });

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
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		sketch.dragLine(line.id, 20, 30, 70, 30);

		assert.equal(p1.x, 20);
		assert.equal(p1.y, 30);
		assert.equal(p2.x, 70);
		assert.equal(p2.y, 30);
	});

	it('dragCircle moves center point exactly to target coordinates', () => {
		const sketch = new SketchDocument();
		const c = sketch.addPoint({ x: 0, y: 0 });
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

			// Test grid point at (20, 20) in world space (away from origin and axes)
			const gridPointScreen = viewport.worldToScreen({ x: 20, y: 20 });
			assert.equal(gridPointScreen.x, 480);
			assert.equal(gridPointScreen.y, 220);

			// Cursor 3px away from (20,20) on screen (within 4px snap radius)
			const snap = interaction.findSnap(new Vec2(gridPointScreen.x + 3, gridPointScreen.y));
			assert.ok(snap, 'Snap should be found');
			assert.equal(snap.type, 'grid');
			assert.equal(snap.worldPos.x, 20);
			assert.equal(snap.worldPos.y, 20);
			assert.equal(snap.screenPos.x, 480);
			assert.equal(snap.screenPos.y, 220);

			// Cursor 5px away (outside 4px snap radius) -> returns null
			const snapTooFar = interaction.findSnap(new Vec2(gridPointScreen.x + 5, gridPointScreen.y));
			assert.equal(snapTooFar, null, 'Grid snap should not trigger beyond 4px');

			// When allowGrid is false, grid snap is suppressed
			const snapNoGrid = interaction.findSnap(new Vec2(gridPointScreen.x + 3, gridPointScreen.y), undefined, false);
			assert.equal(snapNoGrid, null, 'Grid snap should be suppressed when allowGrid=false');

			// But existing point is still found even when allowGrid=false
			sketch.addPoint({ x: 20, y: 20 });
			const snapPt = interaction.findSnap(new Vec2(gridPointScreen.x + 3, gridPointScreen.y), undefined, false);
			assert.ok(snapPt, 'Point snap should still be found when allowGrid=false');
			assert.equal(snapPt.type, 'point');
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

			const pt = sketch.addPoint({ x: 12.34, y: 15.67 });

			// Simulate point drag
			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = pt.id;
			(interaction as any).dragPointStartWorld = new Vec2(pt.x, pt.y);
			(interaction as any).hasDragged = true;

			// Release mouse near screen pos corresponding to world (25, 20)
			const targetScreen = viewport.worldToScreen({ x: 25, y: 20 });
			(interaction as any).handleMouseUp({
				clientX: targetScreen.x + 2,
				clientY: targetScreen.y - 1,
				button: 0,
			} as any);

			assert.equal(pt.x, 25, 'Point X should snap exactly to grid 25');
			assert.equal(pt.y, 20, 'Point Y should snap exactly to grid 20');

			const points = [new Vec2(15, 40), new Vec2(30, 40), new Vec2(45, 55)].map(point => sketch.addPoint(point));
			const spline = sketch.addFitSpline(points.map(point => point.id));
			sketch.selectEntity(points[1].id, 'point');
			const nearGrid = viewport.worldToScreen(new Vec2(20, 40));
			// The previous fit point's forward handle sits on this grid intersection.
			assert.equal(interaction.findSnap(nearGrid, points[1].id)?.type, 'grid');

			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = points[1].id;
			(interaction as any).dragPointStartWorld = new Vec2(30, 40);
			(interaction as any).hasDragged = true;
			(interaction as any).handleMouseUp({ clientX: nearGrid.x + 1, clientY: nearGrid.y, button: 0 });
			assert.deepEqual(new Vec2(points[1].x, points[1].y), new Vec2(20, 40));
			assert.equal(sketch.constraints.size, 3);

			const checkHandles = () => {
				const expected = computeNaturalFitHandles(points);
				for (const [i, id] of spline.tangentLineIds!.entries()) {
					const line = sketch.lines.get(id)!;
					const h1 = sketch.points.get(line.p1Id)!;
					const h2 = sketch.points.get(line.p2Id)!;
					assert.deepEqual(new Vec2(h1.x, h1.y), expected[i].h1);
					assert.deepEqual(new Vec2(h2.x, h2.y), expected[i].h2);
				}
			};
			checkHandles();
			sketch.dragPoint(points[0].id, 10, 45);
			checkHandles();

			const tangent = sketch.lines.get(spline.tangentLineIds![1])!;
			const handle = sketch.points.get(tangent.p2Id)!;
			const handleTarget = viewport.worldToScreen(new Vec2(25, 50));
			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = handle.id;
			(interaction as any).dragPointStartWorld = new Vec2(handle.x, handle.y);
			(interaction as any).hasDragged = true;
			(interaction as any).handleMouseUp({ clientX: handleTarget.x + 1, clientY: handleTarget.y, button: 0 });
			assert.deepEqual(new Vec2(handle.x, handle.y), new Vec2(25, 50));
			assert.deepEqual(new Vec2(points[1].x, points[1].y), new Vec2(20, 40));
			assert.equal(sketch.constraints.size, 3);
		} finally {
			cleanupDoc();
		}
	});

	it('defers region solving until the dragged point has snapped on mouseup', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const viewport = new Viewport(800, 600);
			viewport.zoom = 4;
			const point = sketch.addPoint(new Vec2(12, 16));
			const svg = {
				style: {},
				classList: { add() {}, remove() {}, toggle() {} },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
				addEventListener() {},
			} as unknown as SVGSVGElement;
			const regionInputs: number[] = [];
			const renderer = {
				deferRegionSolve: false,
				rectangularGizmoHandles: new Map(),
				patternCheckboxPositions: new Map(),
				clearPreviews() {},
				renderSnapIndicator() {},
				render() {
					if (!this.deferRegionSolve) regionInputs.push(point.x);
				},
			};
			const interaction = new CanvasInteraction(svg, sketch, viewport, renderer as any);
			sketch.onChange(() => renderer.render());
			const eventAt = (x: number, y: number) => {
				const screen = viewport.worldToScreen(new Vec2(x, y));
				return {
					button: 0,
					clientX: screen.x,
					clientY: screen.y,
					target: {
						closest: (selector: string) =>
							selector === '[data-id]'
								? { getAttribute: (name: string) => (name === 'data-id' ? point.id : 'point') }
								: null,
					},
				} as unknown as MouseEvent;
			};

			interaction['handleMouseDown'](eventAt(12, 16));
			regionInputs.length = 0;
			interaction['handleMouseMove'](eventAt(16, 17));
			interaction['handleMouseMove'](eventAt(20, 19));
			assert.equal(point.x, 20);
			assert.deepEqual(regionInputs, []);

			interaction['handleMouseUp'](eventAt(25.5, 20));
			assert.deepEqual(regionInputs, [25]);
		} finally {
			cleanupDoc();
		}
	});

	it('snaps along X to grid on X-axis and along Y to grid on Y-axis', () => {
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

			// Test X-axis at world (20, 0)
			const sX = viewport.worldToScreen({ x: 20, y: 0 });

			// Cursor 2px offset along X and 2px offset along Y (both <= 4px threshold)
			const snapXNear = interaction.findSnap(new Vec2(sX.x + 2, sX.y + 2));
			assert.ok(snapXNear, 'Snap on X-axis should be found');
			assert.equal(snapXNear.type, 'line');
			assert.equal(snapXNear.id, 'axis_x');
			assert.equal(snapXNear.worldPos.x, 20, 'World X should snap to 20');
			assert.equal(snapXNear.worldPos.y, 0, 'World Y should be 0 on X-axis');
			assert.equal(snapXNear.screenPos.x, sX.x);
			assert.equal(snapXNear.screenPos.y, sX.y);

			// Cursor 6px offset along X (>4px threshold) but 2px along Y (<10px axis snap)
			const snapXFar = interaction.findSnap(new Vec2(sX.x + 6, sX.y + 2));
			assert.ok(snapXFar, 'Snap on X-axis should still be found');
			assert.equal(snapXFar.type, 'line');
			assert.equal(snapXFar.id, 'axis_x');
			assert.equal(snapXFar.worldPos.y, 0, 'World Y should still be 0');
			assert.notEqual(snapXFar.worldPos.x, 20, 'World X should NOT snap to 20 when > 4px away');

			// When allowGrid is false, axis snapping is also suppressed
			const snapXNoGrid = interaction.findSnap(new Vec2(sX.x + 2, sX.y + 2), undefined, false);
			assert.equal(snapXNoGrid, null, 'Axis snap should be suppressed when allowGrid=false');

			// Test Y-axis at world (0, 20)
			const sY = viewport.worldToScreen({ x: 0, y: 20 });

			// Cursor 2px offset along X (<10px axis snap) and 2px offset along Y (<= 4px grid snap)
			const snapYNear = interaction.findSnap(new Vec2(sY.x + 2, sY.y + 2));
			assert.ok(snapYNear, 'Snap on Y-axis should be found');
			assert.equal(snapYNear.type, 'line');
			assert.equal(snapYNear.id, 'axis_y');
			assert.equal(snapYNear.worldPos.x, 0, 'World X should be 0 on Y-axis');
			assert.equal(snapYNear.worldPos.y, 20, 'World Y should snap to 20');
			assert.equal(snapYNear.screenPos.x, sY.x);
			assert.equal(snapYNear.screenPos.y, sY.y);

			// Cursor 2px offset along X but 6px offset along Y (>4px threshold)
			const snapYFar = interaction.findSnap(new Vec2(sY.x + 2, sY.y + 6));
			assert.ok(snapYFar, 'Snap on Y-axis should still be found');
			assert.equal(snapYFar.type, 'line');
			assert.equal(snapYFar.id, 'axis_y');
			assert.equal(snapYFar.worldPos.x, 0, 'World X should still be 0');
			assert.notEqual(snapYFar.worldPos.y, 20, 'World Y should NOT snap to 20 when > 4px away');

			// When allowGrid is false, Y axis snapping is also suppressed
			const snapYNoGrid = interaction.findSnap(new Vec2(sY.x + 2, sY.y + 2), undefined, false);
			assert.equal(snapYNoGrid, null, 'Axis snap should be suppressed when allowGrid=false');
		} finally {
			cleanupDoc();
		}
	});

	it('geometry has strictly higher priority than coordinate axes and grid', () => {
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

			// Add a sketch line near the X-axis (y = 1)
			const p1 = sketch.addPoint({ x: 10, y: 1 });
			const p2 = sketch.addPoint({ x: 50, y: 1 });
			const line = sketch.addLine(p1.id, p2.id);

			// Screen position of world (20, 1)
			const sLine = viewport.worldToScreen({ x: 20, y: 1 });
			const snap = interaction.findSnap(sLine);
			assert.ok(snap, 'Snap should be found');
			assert.equal(snap.type, 'line');
			assert.equal(snap.id, line.id, 'Should snap to sketch line, not to axis_x or grid');
		} finally {
			cleanupDoc();
		}
	});
});

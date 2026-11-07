import { AABB } from '../src/math/aabb';
import { vec } from '../src/math/vector';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { Viewport } from '../src/canvas/viewport';
import { CanvasInteraction } from '../src/canvas/interaction';

function setupMockDocument() {
	const origDoc = (globalThis as any).document;
	const origWin = (globalThis as any).window;
	const makeEl = () => ({
		style: {},
		setAttribute: () => {},
		classList: { add: () => {}, remove: () => {}, toggle: () => {} },
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

describe('Fit to View & Selection Bounding Box', () => {
	it('returns null when nothing is selected', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 100 });
		sketch.addLine(p1.id, p2.id);
		assert.equal(sketch.getSelectionBoundingBox(), null);
	});

	it('computes selection bounding box for a selected point', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 15, y: -25 });
		const p2 = sketch.addPoint({ x: 100, y: 100 });
		const p3 = sketch.addPoint({ x: 200, y: 200 });
		sketch.addLine(p2.id, p3.id);

		sketch.selectEntity(p1.id, 'point');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.min.x, 15);
		assert.equal(bbox.max.x, 15);
		assert.equal(bbox.min.y, -25);
		assert.equal(bbox.max.y, -25);
	});

	it('computes selection bounding box for a selected line', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 20 });
		const p2 = sketch.addPoint({ x: 50, y: 80 });
		const line = sketch.addLine(p1.id, p2.id);

		const pOther1 = sketch.addPoint({ x: 1000, y: 1000 });
		const pOther2 = sketch.addPoint({ x: 2000, y: 2000 });
		sketch.addLine(pOther1.id, pOther2.id);

		sketch.selectEntity(line.id, 'line');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.min.x, 10);
		assert.equal(bbox.max.x, 50);
		assert.equal(bbox.min.y, 20);
		assert.equal(bbox.max.y, 80);
	});

	it('computes selection bounding box for a selected circle', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint({ x: 30, y: 40 });
		const circle = sketch.addCircle(center.id, 25);

		const pOther1 = sketch.addPoint({ x: 500, y: 500 });
		const pOther2 = sketch.addPoint({ x: 600, y: 600 });
		sketch.addLine(pOther1.id, pOther2.id);

		sketch.selectEntity(circle.id, 'circle');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.min.x, 5);
		assert.equal(bbox.max.x, 55);
		assert.equal(bbox.min.y, 15);
		assert.equal(bbox.max.y, 65);
	});

	it('computes selection bounding box for a selected arc', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint({ x: 10, y: 10 });
		const pStart = sketch.addPoint({ x: 30, y: 10 });
		const pEnd = sketch.addPoint({ x: 10, y: 30 });
		const arc = sketch.addArc(center.id, pStart.id, pEnd.id, 20);

		const pOther = sketch.addPoint({ x: 500, y: 500 });
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(arc.id, 'arc');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.min.x, -10);
		assert.equal(bbox.max.x, 30);
		assert.equal(bbox.min.y, -10);
		assert.equal(bbox.max.y, 30);
	});

	it('computes selection bounding box for a selected ellipse', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint({ x: 50, y: 50 });
		const maj = sketch.addPoint({ x: 100, y: 50 });
		const min = sketch.addPoint({ x: 50, y: 70 });
		const ellipse = sketch.addEllipse(center.id, maj.id, min.id);

		const pOther = sketch.addPoint({ x: 1000, y: 1000 });
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(ellipse.id, 'ellipse');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(Math.round(bbox.min.x), 0);
		assert.equal(Math.round(bbox.max.x), 100);
		assert.equal(Math.round(bbox.min.y), 30);
		assert.equal(Math.round(bbox.max.y), 70);
	});

	it('computes selection bounding box for a selected spline', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: 40 });
		const p3 = sketch.addPoint({ x: 30, y: 15 });
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);

		const pOther = sketch.addPoint({ x: 500, y: 500 });
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(spline.id, 'spline');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.ok(bbox.min.x <= 10);
		assert.ok(bbox.max.x >= 30);
		assert.ok(bbox.min.y <= 10);
		assert.ok(bbox.max.y >= 40);
	});

	it('computes combined bounding box for multiple selected items', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 10 });
		const p2 = sketch.addPoint({ x: 20, y: 20 });
		const l1 = sketch.addLine(p1.id, p2.id);

		const p3 = sketch.addPoint({ x: 100, y: 50 });
		const p4 = sketch.addPoint({ x: 120, y: 80 });
		const l2 = sketch.addLine(p3.id, p4.id);

		const pOther = sketch.addPoint({ x: 500, y: 500 });
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntities([
			{ id: l1.id, type: 'line' },
			{ id: l2.id, type: 'line' },
		]);
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.min.x, 10);
		assert.equal(bbox.max.x, 120);
		assert.equal(bbox.min.y, 10);
		assert.equal(bbox.max.y, 80);
	});

	it('computes bounding box for entities of a selected constraint if only constraint is selected', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 20 });
		const p2 = sketch.addPoint({ x: 30, y: 40 });
		const c = sketch.addDistanceConstraint(p1.id, p2.id, 28.28);

		const pOther = sketch.addPoint({ x: 500, y: 500 });
		sketch.addCircle(pOther.id, 50);

		sketch.clearSelection();
		sketch.selectEntity(c.id, 'constraint');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.ok(Math.abs(bbox.min.x - 10) < 0.1);
		assert.ok(Math.abs(bbox.max.x - 30) < 0.1);
		assert.ok(Math.abs(bbox.min.y - 20) < 0.1);
		assert.ok(Math.abs(bbox.max.y - 40) < 0.1);
	});

	it('getTargetFit returns expected pan and zoom matching fitToBounds', () => {
		const vp = new Viewport(800, 600);
		const bounds = AABB.fromPoints([vec(0, 0), vec(100, 100)])!;
		const target = vp.getTargetFit(bounds, 80);
		vp.fitToBounds(bounds, 80);

		assert.equal(vp.panX, target.panX);
		assert.equal(vp.panY, target.panY);
		assert.equal(vp.zoom, target.zoom);
	});

	it('fitToView zooms to selected geometry when selection exists and to whole scene otherwise', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const p1 = sketch.addPoint({ x: 0, y: 0 });
			const p2 = sketch.addPoint({ x: 20, y: 20 });
			const l1 = sketch.addLine(p1.id, p2.id);

			const p3 = sketch.addPoint({ x: 200, y: 200 });
			const p4 = sketch.addPoint({ x: 300, y: 300 });
			sketch.addLine(p3.id, p4.id);

			const fakeSvg = {
				style: {},
				classList: { add: () => {}, remove: () => {}, toggle: () => {} },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
			const renderer = {
				render: () => {},
				clearPreviews: () => {},
			} as any;

			const interaction = new CanvasInteraction(fakeSvg, sketch, vp, renderer);

			// 1. Zoom with selection (should zoom to l1 only: [0, 0] to [20, 20])
			sketch.selectEntity(l1.id, 'line');
			const targetSelected = vp.getTargetFit(AABB.fromPoints([vec(0, 0), vec(20, 20)])!);
			interaction.fitToView(false);

			assert.equal(vp.panX, targetSelected.panX);
			assert.equal(vp.panY, targetSelected.panY);
			assert.equal(vp.zoom, targetSelected.zoom);

			// 2. Zoom without selection (should zoom to whole scene: [0, 0] to [300, 300])
			sketch.clearSelection();
			const targetAll = vp.getTargetFit(AABB.fromPoints([vec(0, 0), vec(300, 300)])!);
			interaction.fitToView(false);

			assert.equal(vp.panX, targetAll.panX);
			assert.equal(vp.panY, targetAll.panY);
			assert.equal(vp.zoom, targetAll.zoom);

			// 3. An empty sketch restores the default view.
			sketch.clear();
			interaction.fitToView(false);
			assert.equal(vp.zoom, 4);
			assert.equal(vp.panX, 400);
			assert.equal(vp.panY, 300);
		} finally {
			cleanupDoc();
		}
	});

	it('smooth animation triggers onViewportChange and cancels properly', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const p1 = sketch.addPoint({ x: 0, y: 0 });
			const p2 = sketch.addPoint({ x: 100, y: 100 });
			sketch.addLine(p1.id, p2.id);

			const fakeSvg = {
				style: {},
				classList: { add: () => {}, remove: () => {}, toggle: () => {} },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
			const renderer = {
				render: () => {},
				clearPreviews: () => {},
			} as any;

			const interaction = new CanvasInteraction(fakeSvg, sketch, vp, renderer);
			let viewportChanged = false;
			interaction.onViewportChange = () => {
				viewportChanged = true;
			};

			interaction.fitToView(true);
			assert.equal(viewportChanged, true);

			interaction.cancelAnimation();
		} finally {
			cleanupDoc();
		}
	});
});

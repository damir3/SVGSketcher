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
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 100);
		sketch.addLine(p1.id, p2.id);
		assert.equal(sketch.getSelectionBoundingBox(), null);
	});

	it('computes selection bounding box for a selected point', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(15, -25);
		const p2 = sketch.addPoint(100, 100);
		const p3 = sketch.addPoint(200, 200);
		sketch.addLine(p2.id, p3.id);

		sketch.selectEntity(p1.id, 'point');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.minX, 15);
		assert.equal(bbox.maxX, 15);
		assert.equal(bbox.minY, -25);
		assert.equal(bbox.maxY, -25);
	});

	it('computes selection bounding box for a selected line', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 20);
		const p2 = sketch.addPoint(50, 80);
		const line = sketch.addLine(p1.id, p2.id);

		const pOther1 = sketch.addPoint(1000, 1000);
		const pOther2 = sketch.addPoint(2000, 2000);
		sketch.addLine(pOther1.id, pOther2.id);

		sketch.selectEntity(line.id, 'line');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.minX, 10);
		assert.equal(bbox.maxX, 50);
		assert.equal(bbox.minY, 20);
		assert.equal(bbox.maxY, 80);
	});

	it('computes selection bounding box for a selected circle', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(30, 40);
		const circle = sketch.addCircle(center.id, 25);

		const pOther1 = sketch.addPoint(500, 500);
		const pOther2 = sketch.addPoint(600, 600);
		sketch.addLine(pOther1.id, pOther2.id);

		sketch.selectEntity(circle.id, 'circle');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.minX, 5);
		assert.equal(bbox.maxX, 55);
		assert.equal(bbox.minY, 15);
		assert.equal(bbox.maxY, 65);
	});

	it('computes selection bounding box for a selected arc', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(10, 10);
		const pStart = sketch.addPoint(30, 10);
		const pEnd = sketch.addPoint(10, 30);
		const arc = sketch.addArc(center.id, pStart.id, pEnd.id, 20);

		const pOther = sketch.addPoint(500, 500);
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(arc.id, 'arc');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.minX, -10);
		assert.equal(bbox.maxX, 30);
		assert.equal(bbox.minY, -10);
		assert.equal(bbox.maxY, 30);
	});

	it('computes selection bounding box for a selected ellipse', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(50, 50);
		const maj = sketch.addPoint(100, 50);
		const min = sketch.addPoint(50, 70);
		const ellipse = sketch.addEllipse(center.id, maj.id, min.id);

		const pOther = sketch.addPoint(1000, 1000);
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(ellipse.id, 'ellipse');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(Math.round(bbox.minX), 0);
		assert.equal(Math.round(bbox.maxX), 100);
		assert.equal(Math.round(bbox.minY), 30);
		assert.equal(Math.round(bbox.maxY), 70);
	});

	it('computes selection bounding box for a selected spline', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 10);
		const p2 = sketch.addPoint(20, 40);
		const p3 = sketch.addPoint(30, 15);
		const spline = sketch.addFitSpline([p1.id, p2.id, p3.id]);

		const pOther = sketch.addPoint(500, 500);
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntity(spline.id, 'spline');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.ok(bbox.minX <= 10);
		assert.ok(bbox.maxX >= 30);
		assert.ok(bbox.minY <= 10);
		assert.ok(bbox.maxY >= 40);
	});

	it('computes combined bounding box for multiple selected items', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 10);
		const p2 = sketch.addPoint(20, 20);
		const l1 = sketch.addLine(p1.id, p2.id);

		const p3 = sketch.addPoint(100, 50);
		const p4 = sketch.addPoint(120, 80);
		const l2 = sketch.addLine(p3.id, p4.id);

		const pOther = sketch.addPoint(500, 500);
		sketch.addCircle(pOther.id, 50);

		sketch.selectEntities([
			{ id: l1.id, type: 'line' },
			{ id: l2.id, type: 'line' },
		]);
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.equal(bbox.minX, 10);
		assert.equal(bbox.maxX, 120);
		assert.equal(bbox.minY, 10);
		assert.equal(bbox.maxY, 80);
	});

	it('computes bounding box for entities of a selected constraint if only constraint is selected', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 20);
		const p2 = sketch.addPoint(30, 40);
		const c = sketch.addDistanceConstraint(p1.id, p2.id, 28.28);

		const pOther = sketch.addPoint(500, 500);
		sketch.addCircle(pOther.id, 50);

		sketch.clearSelection();
		sketch.selectEntity(c.id, 'constraint');
		const bbox = sketch.getSelectionBoundingBox();
		assert.ok(bbox);
		assert.ok(Math.abs(bbox.minX - 10) < 0.1);
		assert.ok(Math.abs(bbox.maxX - 30) < 0.1);
		assert.ok(Math.abs(bbox.minY - 20) < 0.1);
		assert.ok(Math.abs(bbox.maxY - 40) < 0.1);
	});

	it('getTargetFit returns expected pan and zoom matching fitToBounds', () => {
		const vp = new Viewport(800, 600);
		const target = vp.getTargetFit(0, 0, 100, 100, 80);
		vp.fitToBounds(0, 0, 100, 100, 80);

		assert.equal(vp.panX, target.panX);
		assert.equal(vp.panY, target.panY);
		assert.equal(vp.zoom, target.zoom);
	});

	it('fitToView zooms to selected geometry when selection exists and to whole scene otherwise', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const p1 = sketch.addPoint(0, 0);
			const p2 = sketch.addPoint(20, 20);
			const l1 = sketch.addLine(p1.id, p2.id);

			const p3 = sketch.addPoint(200, 200);
			const p4 = sketch.addPoint(300, 300);
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
			const targetSelected = vp.getTargetFit(0, 0, 20, 20);
			interaction.fitToView(false);

			assert.equal(vp.panX, targetSelected.panX);
			assert.equal(vp.panY, targetSelected.panY);
			assert.equal(vp.zoom, targetSelected.zoom);

			// 2. Zoom without selection (should zoom to whole scene: [0, 0] to [300, 300])
			sketch.clearSelection();
			const targetAll = vp.getTargetFit(0, 0, 300, 300);
			interaction.fitToView(false);

			assert.equal(vp.panX, targetAll.panX);
			assert.equal(vp.panY, targetAll.panY);
			assert.equal(vp.zoom, targetAll.zoom);

			// 3. Zoom with empty sketch (should center origin and zoom 1.0)
			sketch.clear();
			interaction.fitToView(false);
			assert.equal(vp.zoom, 1.0);
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
			const p1 = sketch.addPoint(0, 0);
			const p2 = sketch.addPoint(100, 100);
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

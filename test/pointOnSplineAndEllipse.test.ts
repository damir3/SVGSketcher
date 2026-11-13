import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { Viewport } from '../src/canvas/viewport';
import { CanvasInteraction } from '../src/canvas/interaction';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { PointTool } from '../src/canvas/tools/primitives/point';
import { LineTool } from '../src/canvas/tools/primitives/line';
import { PointOnEllipseConstraint } from '../src/solver/constraints/pointOnEllipse';
import { PointOnSplineConstraint } from '../src/solver/constraints/pointOnSpline';
import { CoincidentConstraint, PointOnLineConstraint } from '../src/solver/constraints';
import { Vec2 } from '../src/math/vector';
import { getSplineParamAtPoint } from '../src/math/spline';

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
		remove: () => {},
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
		getElementById: (_id: string) => null,
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

function createMockInteraction(sketch: SketchDocument, vp: Viewport) {
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
		clearSnapIndicator: () => {},
		render: () => {},
		requestRender: () => {},
		rectangularGizmoHandles: new Map(),
		selectionBox: null,
	} as any;
	return new CanvasInteraction(fakeSvg, sketch, vp, renderer);
}

function createMockCtx(sketch: SketchDocument, vp: Viewport, interaction?: CanvasInteraction) {
	return {
		sketch,
		viewport: vp,
		renderer: {
			requestRender: () => {},
			clearPreviews: () => {},
			renderSnapIndicator: () => {},
			clearSnapIndicator: () => {},
		},
		svg: {} as any,
		isConstructionMode: false,
		requestRender: () => {},
		setTool: () => {},
		setCursor: () => {},
		showToast: () => {},
		findSnap: (screen: any, excl?: string, grid?: boolean) =>
			interaction ? interaction.findSnap(screen, excl, grid) : null,
		findPointNear: () => null,
		findLineNear: () => null,
		findCircleNear: () => null,
		findArcNear: () => null,
		findEllipseNear: () => null,
		findEllipticalArcNear: () => null,
		findSplineNear: () => null,
		toGeoCurve: (t: any, id: string) => sketch.toGeoCurve(id, t),
		applySnapConstraintIfNeeded: (ptId: string, snap: any) =>
			interaction ? (interaction as any).applySnapConstraintIfNeeded(ptId, snap) : undefined,
	} as any;
}

describe('Point on Ellipse Constraint', () => {
	it('constrains a free point to lie on an ellipse and solves successfully', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint({ x: 0, y: 0 });
		const majPt = sketch.addPoint({ x: 50, y: 0 });
		const minPt = sketch.addPoint({ x: 0, y: 20 });
		const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);

		// Fix ellipse definition points
		sketch.addFixedConstraint(cPt.id);
		sketch.addFixedConstraint(majPt.id);
		sketch.addFixedConstraint(minPt.id);

		// Free point near the ellipse
		const testPt = sketch.addPoint({ x: 45, y: 15 });
		const c = sketch.addPointOnEllipseConstraint(testPt.id, ellipse.id);

		assert.ok(c instanceof PointOnEllipseConstraint, 'Constraint created');
		assert.equal(c.pointId, testPt.id);
		assert.equal(c.ellipseId, ellipse.id);

		// Ellipse equation: (x/50)^2 + (y/20)^2 = 1
		const pt = sketch.getPoint(testPt.id)!;
		const val = (pt.x / 50) ** 2 + (pt.y / 20) ** 2;
		assert.ok(Math.abs(val - 1.0) < 1e-4, `Point should lie on ellipse, got (x/a)^2+(y/b)^2 = ${val}`);
	});

	it('constrains a free point to lie on an elliptical arc', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint({ x: 0, y: 0 });
		const majPt = sketch.addPoint({ x: 40, y: 0 });
		const minPt = sketch.addPoint({ x: 0, y: 30 });
		const startPt = sketch.addPoint({ x: 40, y: 0 });
		const endPt = sketch.addPoint({ x: 0, y: 30 });
		const arc = sketch.addEllipticalArc(cPt.id, majPt.id, minPt.id, startPt.id, endPt.id);

		sketch.addFixedConstraint(cPt.id);
		sketch.addFixedConstraint(majPt.id);
		sketch.addFixedConstraint(minPt.id);

		const testPt = sketch.addPoint({ x: 30, y: 25 });
		const c = sketch.addPointOnEllipseConstraint(testPt.id, arc.id);

		assert.ok(c instanceof PointOnEllipseConstraint, 'Constraint created for elliptical arc');
		const pt = sketch.getPoint(testPt.id)!;
		const val = (pt.x / 40) ** 2 + (pt.y / 30) ** 2;
		assert.ok(Math.abs(val - 1.0) < 1e-4, `Point on elliptical arc satisfies ellipse equation: ${val}`);
	});

	it('rejects ellipse definition points and duplicate constraints', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint({ x: 0, y: 0 });
		const majPt = sketch.addPoint({ x: 50, y: 0 });
		const minPt = sketch.addPoint({ x: 0, y: 20 });
		const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);

		assert.equal(sketch.addPointOnEllipseConstraint(cPt.id, ellipse.id), null);
		assert.equal(sketch.addPointOnEllipseConstraint(majPt.id, ellipse.id), null);
		assert.equal(sketch.addPointOnEllipseConstraint(minPt.id, ellipse.id), null);

		const freePt = sketch.addPoint({ x: 10, y: 10 });
		const c1 = sketch.addPointOnEllipseConstraint(freePt.id, ellipse.id);
		assert.ok(c1);
		const c2 = sketch.addPointOnEllipseConstraint(freePt.id, ellipse.id);
		assert.equal(c2, null, 'Duplicate constraint should be rejected');
	});

	it('supports snapshot serialization and deserialization (undo/redo)', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint({ x: 0, y: 0 });
		const majPt = sketch.addPoint({ x: 60, y: 0 });
		const minPt = sketch.addPoint({ x: 0, y: 30 });
		const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);
		const freePt = sketch.addPoint({ x: 50, y: 10 });

		sketch.addPointOnEllipseConstraint(freePt.id, ellipse.id);

		const snapshot = sketch.takeSnapshot();
		const newSketch = new SketchDocument();
		newSketch.restoreSnapshot(snapshot);

		const restoredC = [...newSketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
		assert.ok(restoredC, 'Constraint restored from snapshot');
		assert.equal(restoredC?.pointId, freePt.id);
		assert.equal(restoredC?.ellipseId, ellipse.id);
	});

	it('deleting ellipse cascades to remove PointOnEllipseConstraint', () => {
		const sketch = new SketchDocument();
		const cPt = sketch.addPoint({ x: 0, y: 0 });
		const majPt = sketch.addPoint({ x: 50, y: 0 });
		const minPt = sketch.addPoint({ x: 0, y: 20 });
		const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);
		const freePt = sketch.addPoint({ x: 45, y: 15 });
		sketch.addPointOnEllipseConstraint(freePt.id, ellipse.id);

		assert.equal([...sketch.constraints.values()].filter(c => c instanceof PointOnEllipseConstraint).length, 1);
		sketch.removeEntity(ellipse.id);
		assert.equal([...sketch.constraints.values()].filter(c => c instanceof PointOnEllipseConstraint).length, 0);
	});
});

describe('Point on Spline Constraint', () => {
	it('constrains a free point to lie on a fit spline', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 50, y: 40 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);

		sketch.addFixedConstraint(p0.id);
		sketch.addFixedConstraint(p1.id);
		sketch.addFixedConstraint(p2.id);

		const testPt = sketch.addPoint({ x: 50, y: 10 });
		const c = sketch.addPointOnSplineConstraint(testPt.id, spline.id);

		assert.ok(c instanceof PointOnSplineConstraint, 'Constraint created');
		assert.equal(c.pointId, testPt.id);
		assert.equal(c.splineId, spline.id);

		const geo = spline.toGeoCurve(sketch);
		assert.ok(geo && geo.bezierSegments);
		const pt = sketch.getPoint(testPt.id)!;
		const proj = getSplineParamAtPoint(geo.bezierSegments, pt);
		assert.ok(proj.distance < 0.05, `pt should lie on spline, distance is ${proj.distance}`);
	});

	it('constrains a free point to lie on a control spline', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 20, y: 50 });
		const p2 = sketch.addPoint({ x: 80, y: 50 });
		const p3 = sketch.addPoint({ x: 100, y: 0 });
		const spline = sketch.addControlSpline([p0.id, p1.id, p2.id, p3.id]);

		sketch.addFixedConstraint(p0.id);
		sketch.addFixedConstraint(p1.id);
		sketch.addFixedConstraint(p2.id);
		sketch.addFixedConstraint(p3.id);

		const testPt = sketch.addPoint({ x: 50, y: 0 });
		const c = sketch.addPointOnSplineConstraint(testPt.id, spline.id);

		assert.ok(c instanceof PointOnSplineConstraint, 'Control spline constraint created');
		assert.equal(c.splineType, 'control');

		const geo = spline.toGeoCurve(sketch);
		assert.ok(geo && geo.bezierSegments);
		const pt = sketch.getPoint(testPt.id)!;
		const proj = getSplineParamAtPoint(geo.bezierSegments, pt);
		assert.ok(proj.distance < 0.05, `pt should lie on control spline, distance is ${proj.distance}`);
	});

	it('rejects fit points and handle points and duplicate constraints', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 50, y: 30 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);

		assert.equal(sketch.addPointOnSplineConstraint(p0.id, spline.id), null);
		assert.equal(sketch.addPointOnSplineConstraint(p1.id, spline.id), null);

		const testPt = sketch.addPoint({ x: 20, y: 20 });
		const c1 = sketch.addPointOnSplineConstraint(testPt.id, spline.id);
		assert.ok(c1);
		const c2 = sketch.addPointOnSplineConstraint(testPt.id, spline.id);
		assert.equal(c2, null, 'Duplicate constraint rejected');
	});

	it('supports snapshot serialization and deserialization (undo/redo)', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 50, y: 40 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);
		const freePt = sketch.addPoint({ x: 50, y: 20 });

		sketch.addPointOnSplineConstraint(freePt.id, spline.id);

		const snapshot = sketch.takeSnapshot();
		const newSketch = new SketchDocument();
		newSketch.restoreSnapshot(snapshot);

		const restoredC = [...newSketch.constraints.values()].find(c => c instanceof PointOnSplineConstraint);
		assert.ok(restoredC, 'Point on spline constraint restored from snapshot');
		assert.equal(restoredC?.pointId, freePt.id);
		assert.equal(restoredC?.splineId, spline.id);
	});

	it('deleting spline cascades to remove PointOnSplineConstraint', () => {
		const sketch = new SketchDocument();
		const p0 = sketch.addPoint({ x: 0, y: 0 });
		const p1 = sketch.addPoint({ x: 50, y: 40 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);
		const freePt = sketch.addPoint({ x: 50, y: 20 });
		sketch.addPointOnSplineConstraint(freePt.id, spline.id);

		assert.equal([...sketch.constraints.values()].filter(c => c instanceof PointOnSplineConstraint).length, 1);
		sketch.removeEntity(spline.id);
		assert.equal([...sketch.constraints.values()].filter(c => c instanceof PointOnSplineConstraint).length, 0);
	});
});

describe('Coincident Tool with Ellipse and Spline', () => {
	it('ConstraintTool applies PointOnEllipseConstraint via entity clicks in both orders', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const cPt = sketch.addPoint({ x: 0, y: 0 });
			const majPt = sketch.addPoint({ x: 50, y: 0 });
			const minPt = sketch.addPoint({ x: 0, y: 20 });
			const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);
			const pt = sketch.addPoint({ x: 40, y: 10 });

			const vp = new Viewport(800, 600);
			const tool = new ConstraintTool('coincident');
			const mockCtx = createMockCtx(sketch, vp);
			tool.activate(mockCtx);

			// Order 1: point then ellipse
			(tool as any).handleConstraintEntityClick(pt.id, 'point');
			(tool as any).handleConstraintEntityClick(ellipse.id, 'ellipse');

			let elConstraints = [...sketch.constraints.values()].filter(c => c instanceof PointOnEllipseConstraint);
			assert.equal(elConstraints.length, 1, 'PointOnEllipseConstraint applied point -> ellipse');
			assert.equal(elConstraints[0].pointId, pt.id);
			assert.equal(elConstraints[0].ellipseId, ellipse.id);

			// Clear and test reverse order: ellipse then point
			sketch.removeConstraint(elConstraints[0].id);
			(tool as any).handleConstraintEntityClick(ellipse.id, 'ellipse');
			const pt2 = sketch.addPoint({ x: 30, y: 15 });
			(tool as any).handleConstraintEntityClick(pt2.id, 'point');

			elConstraints = [...sketch.constraints.values()].filter(c => c instanceof PointOnEllipseConstraint);
			assert.equal(elConstraints.length, 1, 'PointOnEllipseConstraint applied ellipse -> point');
			assert.equal(elConstraints[0].pointId, pt2.id);
		} finally {
			cleanupDoc();
		}
	});

	it('ConstraintTool applies PointOnSplineConstraint via entity clicks in both orders', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const p0 = sketch.addPoint({ x: 0, y: 0 });
			const p1 = sketch.addPoint({ x: 50, y: 40 });
			const p2 = sketch.addPoint({ x: 100, y: 0 });
			const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);
			const pt = sketch.addPoint({ x: 50, y: 20 });

			const vp = new Viewport(800, 600);
			const tool = new ConstraintTool('coincident');
			const mockCtx = createMockCtx(sketch, vp);
			tool.activate(mockCtx);

			// Order 1: point then spline
			(tool as any).handleConstraintEntityClick(pt.id, 'point');
			(tool as any).handleConstraintEntityClick(spline.id, 'spline');

			let spConstraints = [...sketch.constraints.values()].filter(c => c instanceof PointOnSplineConstraint);
			assert.equal(spConstraints.length, 1, 'PointOnSplineConstraint applied point -> spline');
			assert.equal(spConstraints[0].pointId, pt.id);
			assert.equal(spConstraints[0].splineId, spline.id);

			// Clear and test reverse order: spline then point
			sketch.removeConstraint(spConstraints[0].id);
			(tool as any).handleConstraintEntityClick(spline.id, 'spline');
			const pt2 = sketch.addPoint({ x: 60, y: 25 });
			(tool as any).handleConstraintEntityClick(pt2.id, 'point');

			spConstraints = [...sketch.constraints.values()].filter(c => c instanceof PointOnSplineConstraint);
			assert.equal(spConstraints.length, 1, 'PointOnSplineConstraint applied spline -> point');
			assert.equal(spConstraints[0].pointId, pt2.id);
		} finally {
			cleanupDoc();
		}
	});

	it('applies PointOnEllipseConstraint via CanvasInteraction.applyConstraint', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const cPt = sketch.addPoint({ x: 0, y: 0 });
			const majPt = sketch.addPoint({ x: 50, y: 0 });
			const minPt = sketch.addPoint({ x: 0, y: 20 });
			const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);
			const pt = sketch.addPoint({ x: 30, y: 15 });

			sketch.selection.pointIds.add(pt.id);
			sketch.selection.ellipseIds.add(ellipse.id);

			assert.ok(interaction.canApplyConstraint('coincident'));
			const applied = interaction.applyConstraint('coincident');
			assert.ok(applied);

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
			assert.ok(c, 'PointOnEllipseConstraint applied');
		} finally {
			cleanupDoc();
		}
	});

	it('applies PointOnSplineConstraint via CanvasInteraction.applyConstraint', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const p0 = sketch.addPoint({ x: 0, y: 0 });
			const p1 = sketch.addPoint({ x: 50, y: 40 });
			const p2 = sketch.addPoint({ x: 100, y: 0 });
			const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);
			const pt = sketch.addPoint({ x: 40, y: 30 });

			sketch.selection.pointIds.add(pt.id);
			sketch.selection.splineIds.add(spline.id);

			assert.ok(interaction.canApplyConstraint('coincident'));
			const applied = interaction.applyConstraint('coincident');
			assert.ok(applied);

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnSplineConstraint);
			assert.ok(c, 'PointOnSplineConstraint applied');
		} finally {
			cleanupDoc();
		}
	});
});

describe('Snapping with Ellipse and Spline', () => {
	it('findSnap detects snap onto an ellipse', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			// Center away from axes (100, 100)
			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 180, y: 100 }); // rx = 80
			const minPt = sketch.addPoint({ x: 100, y: 140 }); // ry = 40
			const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);

			// Query along ellipse perimeter away from definition points: at theta = 45 deg
			// x = 100 + 80*cos(pi/4) ~ 156.57, y = 100 + 40*sin(pi/4) ~ 128.28
			const pEl = new Vec2(100 + 80 * Math.cos(Math.PI / 4), 100 + 40 * Math.sin(Math.PI / 4));
			const s = vp.worldToScreen(pEl);
			const snap = interaction.findSnap(new Vec2(s.x + 2, s.y - 2));
			assert.ok(snap, 'Snap found');
			assert.equal(snap.type, 'ellipse');
			assert.equal(snap.id, ellipse.id);
			assert.ok(Math.abs(snap.worldPos.x - pEl.x) < 1.0, `Snapped world X near ${pEl.x}, got ${snap.worldPos.x}`);
			assert.ok(Math.abs(snap.worldPos.y - pEl.y) < 1.0, `Snapped world Y near ${pEl.y}, got ${snap.worldPos.y}`);
		} finally {
			cleanupDoc();
		}
	});

	it('findSnap detects snap onto a spline', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const p0 = sketch.addPoint({ x: 0, y: 0 });
			const p1 = sketch.addPoint({ x: 50, y: 40 });
			const p2 = sketch.addPoint({ x: 100, y: 0 });
			const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);

			// Point along spline body away from fit points and axes
			const sMid = vp.worldToScreen({ x: 25, y: 25 });
			const snapMid = interaction.findSnap(sMid);
			assert.ok(snapMid, 'Snap found along spline body');
			assert.equal(snapMid.type, 'spline');
			assert.equal(snapMid.id, spline.id);
		} finally {
			cleanupDoc();
		}
	});

	it('PointTool applies PointOnEllipseConstraint when clicking with ellipse snap', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 180, y: 100 });
			const minPt = sketch.addPoint({ x: 100, y: 140 });
			const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);

			const pEl = new Vec2(100 + 80 * Math.cos(Math.PI / 4), 100 + 40 * Math.sin(Math.PI / 4));
			const s = vp.worldToScreen(pEl);
			const snap = interaction.findSnap(s);
			assert.ok(snap && snap.type === 'ellipse');

			const tool = new PointTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);

			tool.onMouseDown({
				screen: s,
				world: snap.worldPos,
				client: s,
				raw: {} as any,
				snap,
				effectiveWorld: snap.worldPos,
				effectiveScreen: s,
			});

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
			assert.ok(c, 'PointTool applied PointOnEllipseConstraint with snap');
			assert.equal(c.ellipseId, ellipse.id);
		} finally {
			cleanupDoc();
		}
	});

	it('PointTool applies PointOnSplineConstraint when clicking with spline snap', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const p0 = sketch.addPoint({ x: 0, y: 0 });
			const p1 = sketch.addPoint({ x: 50, y: 40 });
			const p2 = sketch.addPoint({ x: 100, y: 0 });
			const spline = sketch.addFitSpline([p0.id, p1.id, p2.id]);

			const sMid = vp.worldToScreen({ x: 25, y: 25 });
			const snap = interaction.findSnap(sMid);
			assert.ok(snap && snap.type === 'spline');

			const tool = new PointTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);

			tool.onMouseDown({
				screen: sMid,
				world: snap.worldPos,
				client: sMid,
				raw: {} as any,
				snap,
				effectiveWorld: snap.worldPos,
				effectiveScreen: sMid,
			});

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnSplineConstraint);
			assert.ok(c, 'PointTool applied PointOnSplineConstraint with snap');
			assert.equal(c.splineId, spline.id);
		} finally {
			cleanupDoc();
		}
	});

	it('LineTool terminates chaining when ending on ellipse or spline snap', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 180, y: 100 });
			const minPt = sketch.addPoint({ x: 100, y: 140 });
			const ellipse = sketch.addEllipse(cPt.id, majPt.id, minPt.id);

			const tool = new LineTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);

			// Step 1: Start free line at (50, 50)
			const sStart = vp.worldToScreen({ x: 50, y: 50 });
			tool.onMouseDown({
				screen: sStart,
				world: new Vec2(50, 50),
				client: sStart,
				raw: {} as any,
				snap: null,
				effectiveWorld: new Vec2(50, 50),
				effectiveScreen: sStart,
			});

			// Step 2: Snap to ellipse at perimeter
			const pEl = new Vec2(100 + 80 * Math.cos(Math.PI / 4), 100 + 40 * Math.sin(Math.PI / 4));
			const sEllipse = vp.worldToScreen(pEl);
			const snapEllipse = interaction.findSnap(sEllipse);
			assert.ok(snapEllipse && snapEllipse.type === 'ellipse');

			tool.onMouseDown({
				screen: sEllipse,
				world: snapEllipse.worldPos,
				client: sEllipse,
				raw: {} as any,
				snap: snapEllipse,
				effectiveWorld: snapEllipse.worldPos,
				effectiveScreen: sEllipse,
			});

			assert.equal(tool.isBusy(), false, 'LineTool terminates when snapping to ellipse');
			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
			assert.ok(c, 'Line endpoint constrained to ellipse via snap');
		} finally {
			cleanupDoc();
		}
	});

	it('findSnap detects snap onto elliptical arc within angular span and rejects outside', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			// Elliptical arc in first quadrant: center (100, 100), rx=60, ry=30, span from (160, 100) to (100, 130)
			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 160, y: 100 });
			const minPt = sketch.addPoint({ x: 100, y: 130 });
			const startPt = sketch.addPoint({ x: 160, y: 100 });
			const endPt = sketch.addPoint({ x: 100, y: 130 });
			const arc = sketch.addEllipticalArc(cPt.id, majPt.id, minPt.id, startPt.id, endPt.id);

			// Point inside angular span: theta = pi/4
			const pIn = new Vec2(100 + 60 * Math.cos(Math.PI / 4), 100 + 30 * Math.sin(Math.PI / 4));
			const sIn = vp.worldToScreen(pIn);
			const snapIn = interaction.findSnap(new Vec2(sIn.x + 2, sIn.y - 2));
			assert.ok(snapIn, 'Snap should be found within angular span');
			assert.equal(snapIn.type, 'ellipse');
			assert.equal(snapIn.id, arc.id);

			// Point outside angular span: theta = pi (x=40, y=100)
			const pOut = new Vec2(40, 100);
			const sOut = vp.worldToScreen(pOut);
			const snapOut = interaction.findSnap(sOut);
			// Should NOT snap to arc.id
			if (snapOut) {
				assert.notEqual(snapOut.id, arc.id, 'Should not snap outside angular span');
			}
		} finally {
			cleanupDoc();
		}
	});

	it('PointTool applies PointOnEllipseConstraint when clicking with elliptical arc snap', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 160, y: 100 });
			const minPt = sketch.addPoint({ x: 100, y: 130 });
			const startPt = sketch.addPoint({ x: 160, y: 100 });
			const endPt = sketch.addPoint({ x: 100, y: 130 });
			const arc = sketch.addEllipticalArc(cPt.id, majPt.id, minPt.id, startPt.id, endPt.id);

			const pIn = new Vec2(100 + 60 * Math.cos(Math.PI / 4), 100 + 30 * Math.sin(Math.PI / 4));
			const s = vp.worldToScreen(pIn);
			const snap = interaction.findSnap(s);
			assert.ok(snap && snap.id === arc.id);

			const tool = new PointTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);

			tool.onMouseDown({
				screen: s,
				world: snap.worldPos,
				client: s,
				raw: {} as any,
				snap,
				effectiveWorld: snap.worldPos,
				effectiveScreen: s,
			});

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
			assert.ok(c, 'PointTool applied constraint for elliptical arc');
			assert.equal(c.ellipseId, arc.id);
		} finally {
			cleanupDoc();
		}
	});

	it('onMouseUp after dragging point onto elliptical arc applies PointOnEllipseConstraint', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const cPt = sketch.addPoint({ x: 100, y: 100 });
			const majPt = sketch.addPoint({ x: 160, y: 100 });
			const minPt = sketch.addPoint({ x: 100, y: 130 });
			const startPt = sketch.addPoint({ x: 160, y: 100 });
			const endPt = sketch.addPoint({ x: 100, y: 130 });
			const arc = sketch.addEllipticalArc(cPt.id, majPt.id, minPt.id, startPt.id, endPt.id);

			const freePt = sketch.addPoint({ x: 200, y: 200 });

			const pIn = new Vec2(100 + 60 * Math.cos(Math.PI / 4), 100 + 30 * Math.sin(Math.PI / 4));
			const sIn = vp.worldToScreen(pIn);

			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = freePt.id;
			(interaction as any).hasDragged = true;
			(interaction as any).handleMouseUp({
				clientX: sIn.x,
				clientY: sIn.y,
			} as any);

			const c = [...sketch.constraints.values()].find(c => c instanceof PointOnEllipseConstraint);
			assert.ok(c, 'Drag drop applied constraint to elliptical arc');
			assert.equal(c.pointId, freePt.id);
			assert.equal(c.ellipseId, arc.id);
		} finally {
			cleanupDoc();
		}
	});

	it('findSnap detects snap onto coordinate axes (axis_x and axis_y)', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			// Test X-axis at x=150, y=0 (screen y = sOrigin.y)
			const sX = vp.worldToScreen({ x: 150, y: 0 });
			const snapX = interaction.findSnap(new Vec2(sX.x, sX.y + 3));
			assert.ok(snapX, 'Snap found on X axis');
			assert.equal(snapX.type, 'line');
			assert.equal(snapX.id, 'axis_x');
			assert.equal(snapX.worldPos.y, 0);

			// Test Y-axis at x=0, y=150 (screen x = sOrigin.x)
			const sY = vp.worldToScreen({ x: 0, y: 150 });
			const snapY = interaction.findSnap(new Vec2(sY.x + 3, sY.y));
			assert.ok(snapY, 'Snap found on Y axis');
			assert.equal(snapY.type, 'line');
			assert.equal(snapY.id, 'axis_y');
			assert.equal(snapY.worldPos.x, 0);
		} finally {
			cleanupDoc();
		}
	});

	it('PointTool and drag-and-drop apply PointOnAxisConstraint on coordinate axes', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			// 1. PointTool on X-axis
			const sX = vp.worldToScreen({ x: 150, y: 0 });
			const snapX = interaction.findSnap(sX);
			assert.ok(snapX && snapX.id === 'axis_x');

			const tool = new PointTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);
			tool.onMouseDown({
				screen: sX,
				world: snapX.worldPos,
				client: sX,
				raw: {} as any,
				snap: snapX,
				effectiveWorld: snapX.worldPos,
				effectiveScreen: sX,
			});

			const pt1 = [...sketch.points.values()].find(p => Math.abs(p.x - 150) < 1);
			assert.ok(pt1);
			const cX = [...sketch.constraints.values()].find(
				c => c instanceof PointOnLineConstraint && c.pointId === pt1.id && c.lineP2Id === 'axis_x'
			);
			assert.ok(cX, 'PointOnAxisConstraint applied for X-axis via PointTool');

			// 2. Drag and drop on Y-axis
			const freePt = sketch.addPoint({ x: 50, y: 150 });
			const sY = vp.worldToScreen({ x: 0, y: 150 });

			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = freePt.id;
			(interaction as any).hasDragged = true;
			(interaction as any).handleMouseUp({
				clientX: sY.x,
				clientY: sY.y,
			} as any);

			const cY = [...sketch.constraints.values()].find(
				c => c instanceof PointOnLineConstraint && c.pointId === freePt.id && c.lineP2Id === 'axis_y'
			);
			assert.ok(cY, 'PointOnAxisConstraint applied for Y-axis via drag drop');
		} finally {
			cleanupDoc();
		}
	});

	it('findSnap detects snap onto coordinate origin (0, 0)', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const sOrigin = vp.worldToScreen({ x: 0, y: 0 });
			const snap = interaction.findSnap(new Vec2(sOrigin.x + 3, sOrigin.y - 3));
			assert.ok(snap, 'Snap found at origin');
			assert.equal(snap.type, 'point');
			assert.equal(snap.id, 'origin');
			assert.equal(snap.worldPos.x, 0);
			assert.equal(snap.worldPos.y, 0);
		} finally {
			cleanupDoc();
		}
	});

	it('PointTool applies OriginCoincidentConstraint at coordinate origin', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const sOrigin = vp.worldToScreen({ x: 0, y: 0 });
			const snapOrigin = interaction.findSnap(sOrigin);
			assert.ok(snapOrigin && snapOrigin.id === 'origin');

			const tool = new PointTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);
			tool.onMouseDown({
				screen: sOrigin,
				world: snapOrigin.worldPos,
				client: sOrigin,
				raw: {} as any,
				snap: snapOrigin,
				effectiveWorld: snapOrigin.worldPos,
				effectiveScreen: sOrigin,
			});

			const ptOrigin = [...sketch.points.values()].find(p => p.x === 0 && p.y === 0);
			assert.ok(ptOrigin);
			const cOrigin = [...sketch.constraints.values()].find(
				c => c instanceof CoincidentConstraint && c.p1Id === 'origin' && c.p2Id === ptOrigin.id
			);
			assert.ok(cOrigin, 'OriginCoincidentConstraint applied via PointTool');
		} finally {
			cleanupDoc();
		}
	});

	it('drag-and-drop applies OriginCoincidentConstraint when dropped at coordinate origin', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const sOrigin = vp.worldToScreen({ x: 0, y: 0 });
			const freePt = sketch.addPoint({ x: 80, y: 80 });

			(interaction as any).isDraggingPoint = true;
			(interaction as any).draggedPointId = freePt.id;
			(interaction as any).hasDragged = true;
			(interaction as any).handleMouseUp({
				clientX: sOrigin.x,
				clientY: sOrigin.y,
			} as any);

			const cDragOrigin = [...sketch.constraints.values()].find(
				c => c instanceof CoincidentConstraint && c.p1Id === 'origin' && c.p2Id === freePt.id
			);
			assert.ok(cDragOrigin, 'OriginCoincidentConstraint applied via drag drop');
		} finally {
			cleanupDoc();
		}
	});

	it('LineTool terminates chaining when ending on coordinate origin or axis snap', () => {
		const cleanupDoc = setupMockDocument();
		try {
			const sketch = new SketchDocument();
			const vp = new Viewport(800, 600);
			const interaction = createMockInteraction(sketch, vp);

			const tool = new LineTool();
			const mockCtx = createMockCtx(sketch, vp, interaction);
			tool.activate(mockCtx);

			// Line ending on origin
			const sStart = vp.worldToScreen({ x: 50, y: 50 });
			tool.onMouseDown({
				screen: sStart,
				world: new Vec2(50, 50),
				client: sStart,
				raw: {} as any,
				snap: null,
				effectiveWorld: new Vec2(50, 50),
				effectiveScreen: sStart,
			});

			const sOrigin = vp.worldToScreen({ x: 0, y: 0 });
			const snapOrigin = interaction.findSnap(sOrigin);
			assert.ok(snapOrigin && snapOrigin.id === 'origin');

			tool.onMouseDown({
				screen: sOrigin,
				world: snapOrigin.worldPos,
				client: sOrigin,
				raw: {} as any,
				snap: snapOrigin,
				effectiveWorld: snapOrigin.worldPos,
				effectiveScreen: sOrigin,
			});

			assert.equal(tool.isBusy(), false, 'LineTool terminates on origin snap');
			const cOrigin = [...sketch.constraints.values()].find(
				c => c instanceof CoincidentConstraint && c.p1Id === 'origin'
			);
			assert.ok(cOrigin, 'Endpoint constrained to origin');

			// Line ending on X-axis
			tool.onMouseDown({
				screen: sStart,
				world: new Vec2(50, 50),
				client: sStart,
				raw: {} as any,
				snap: null,
				effectiveWorld: new Vec2(50, 50),
				effectiveScreen: sStart,
			});

			const sAxis = vp.worldToScreen({ x: 100, y: 0 });
			const snapAxis = interaction.findSnap(sAxis);
			assert.ok(snapAxis && snapAxis.id === 'axis_x');

			tool.onMouseDown({
				screen: sAxis,
				world: snapAxis.worldPos,
				client: sAxis,
				raw: {} as any,
				snap: snapAxis,
				effectiveWorld: snapAxis.worldPos,
				effectiveScreen: sAxis,
			});

			assert.equal(tool.isBusy(), false, 'LineTool terminates on axis snap');
			const cAxis = [...sketch.constraints.values()].find(
				c => c instanceof PointOnLineConstraint && c.lineP2Id === 'axis_x'
			);
			assert.ok(cAxis, 'Endpoint constrained to X-axis');
		} finally {
			cleanupDoc();
		}
	});
});

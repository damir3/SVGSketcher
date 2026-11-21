import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import { Viewport } from '../src/canvas/viewport';
import { SelectTool, type SelectInteractionHost } from '../src/canvas/tools/selection/select';
import { calculateOffsetGeometry, commitOffsetToSketch, type OffsetChain } from '../src/math/offset';
import { applySnapConstraint } from '../src/canvas/snapping';
import type { SnapResult } from '../src/canvas/snapping';

function createHost(sketch: SketchDocument, snap: SnapResult): SelectInteractionHost {
	const viewport = new Viewport(800, 600);
	const host: SelectInteractionHost = {
		sketch,
		viewport,
		activeTool: 'select',
		activeToolInstance: null,
		selectedImageId: null,
		lastMouseScreen: viewport.worldToScreen(snap.worldPos),
		isDraggingPoint: false,
		draggedPointId: null,
		dragPointStartWorld: null,
		curveDragState: null,
		isDraggingConstraint: false,
		draggedConstraintId: null,
		dragConstraintStartScreen: null,
		isBoxSelecting: false,
		boxSelectStartScreen: null,
		boxSelectCurrentScreen: null,
		boxSelectShift: false,
		boxSelectImageId: null,
		pendingExclusiveSelection: null,
		preDragSnapshot: null,
		hasDragged: false,
		textRotationDragState: null,
		textDragState: null,
		gizmoDragState: null,
		render: () => {},
		setTool: () => {},
		getScreenPos: () => host.lastMouseScreen,
		findSnap: () => snap,
		applySnapConstraintIfNeeded: (pointId, s) => applySnapConstraint(sketch, pointId, s),
		finishBoxSelection: () => {},
		selectImage: () => {},
	};
	return host;
}

test('SelectTool.handleMouseUp keeps offset topology changes inside the undo transaction when snap is rejected', () => {
	const sketch = new SketchDocument();
	// Mirrors src/main.ts onChange -> updateUndoRedoButtons -> sketch.canUndo()
	sketch.onChange(() => {
		sketch.canUndo();
	});

	// Closed rectangle with an inward offset (flip = true): moving p3 to y = 0 collapses
	// the inward offset via reconcileOffsetTopology; restoring height recreates offset edges with new IDs.
	const p1 = sketch.addPoint(new Vec2(0, 10));
	const p2 = sketch.addPoint(new Vec2(60, 10));
	const p3 = sketch.addPoint(new Vec2(60, 50));
	const p4 = sketch.addPoint(new Vec2(0, 50));
	const l1 = sketch.addLine(p1.id, p2.id);
	const l2 = sketch.addLine(p2.id, p3.id);
	const l3 = sketch.addLine(p3.id, p4.id);
	const l4 = sketch.addLine(p4.id, p1.id);
	sketch.addFixedConstraint(p1.id);
	sketch.addHorizontalConstraint(l1.id);
	sketch.addVerticalConstraint(l2.id);
	sketch.addHorizontalConstraint(l3.id);
	sketch.addVerticalConstraint(l4.id);
	// Keeps p3 at y = 50 (so snapping p3 onto axis_x at y = 0 is rejected), while p3.x stays free to drag.
	sketch.addDistanceConstraint(p2.id, p3.id, 40);

	const chain: OffsetChain = {
		items: [
			{ id: l1.id, type: 'line', startPointId: p1.id, endPointId: p2.id },
			{ id: l2.id, type: 'line', startPointId: p2.id, endPointId: p3.id },
			{ id: l3.id, type: 'line', startPointId: p3.id, endPointId: p4.id },
			{ id: l4.id, type: 'line', startPointId: p4.id, endPointId: p1.id },
		],
		isClosed: true,
		firstSelectedId: l1.id,
	};
	const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, true);
	assert.equal(geom.isValid, true);
	commitOffsetToSketch(sketch, chain, geom, 'one_side', 10, 10, true);
	sketch.clearHistory();

	const initial = sketch.takeSnapshot();
	assert.equal(initial.lines.length, 8);

	const snapWorld = new Vec2(50, 0);
	const snap: SnapResult = {
		type: 'line',
		id: 'axis_x',
		worldPos: snapWorld,
		screenPos: new Vec2(0, 0),
	};
	const host = createHost(sketch, snap);
	host.isDraggingPoint = true;
	host.draggedPointId = p3.id;
	host.dragPointStartWorld = p3.clone();
	host.preDragSnapshot = sketch.takeSnapshot();
	host.hasDragged = true;

	// Drag horizontally so the drag produces a real undo entry, then release on axis_x.
	sketch.dragPoint(p3.id, 50, 50);
	SelectTool.handleMouseUp(host);

	assert.equal(sketch.canUndo(), true);
	assert.equal(sketch.undo(), true);

	const afterUndo = sketch.takeSnapshot();
	assert.equal(afterUndo.points.length, initial.points.length);
	assert.equal(afterUndo.lines.length, initial.lines.length);
	assert.equal(afterUndo.constraints.length, initial.constraints.length);
	assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');
	assert.ok(Math.abs(sketch.points.get(p3.id)!.x - 60) < 1e-4);
	assert.ok(Math.abs(sketch.points.get(p3.id)!.y - 50) < 1e-4);
});

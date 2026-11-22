import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { DeleteTool } from '../src/canvas/tools/modify/delete';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import { Vec2 } from '../src/math/vector';
import {
	CircularPatternConstraint,
	OffsetConstraint,
	RectangularPatternConstraint,
	SymmetryConstraint,
} from '../src/solver/constraints';
import type { IConstraint } from '../src/solver/types';
import { commitOffsetToSketch, calculateOffsetGeometry } from '../src/math/offset';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';

function createOffsetLineSketch(): {
	sketch: SketchDocument;
	origLineId: string;
	offsetConstraint: OffsetConstraint;
	offLineId: string;
} {
	const sketch = new SketchDocument();
	const p1 = sketch.addPoint(new Vec2(0, 0));
	const p2 = sketch.addPoint(new Vec2(100, 0));
	const origLine = sketch.addLine(p1.id, p2.id);

	const chain = {
		items: [{ id: origLine.id, type: 'line' as const, reversed: false }],
		isClosed: false,
	};
	const geom = calculateOffsetGeometry(sketch, chain, 'one_side', 10, 10, false);
	assert.equal(geom.isValid, true);
	const res = commitOffsetToSketch(sketch, chain, geom, 'one_side', 10, 10, false)!;
	assert.ok(res);
	assert.equal(res.constraintIds.length, 1);

	const offsetConstraint = sketch.constraints.get(res.constraintIds[0]) as OffsetConstraint;
	const pair = offsetConstraint.pairs[0];
	assert.equal(pair.kind, 'line');
	return { sketch, origLineId: origLine.id, offsetConstraint, offLineId: pair.offLineId };
}

function createCircularPatternSketch(): {
	sketch: SketchDocument;
	centerId: string;
	sourceLineId: string;
	patternConstraint: CircularPatternConstraint;
	createdLineIds: string[];
} {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(0, 0));
	const p1 = sketch.addPoint(new Vec2(50, 0));
	const p2 = sketch.addPoint(new Vec2(80, 0));
	const sourceLine = sketch.addLine(p1.id, p2.id);

	const copies = [1, 2].map(k => sketch.generatePatternCopy(center.id, [sourceLine.id], k, 3, 'full', 360)!);
	const patternConstraint = sketch.addCircularPatternConstraint(
		center.id,
		[sourceLine.id],
		'full',
		360,
		3,
		false,
		[],
		copies
	)!;
	const createdLineIds = copies.flatMap(copy => copy.createdEntityIds.filter(e => e.type === 'line').map(e => e.id));
	return { sketch, centerId: center.id, sourceLineId: sourceLine.id, patternConstraint, createdLineIds };
}

function createRectangularPatternSketch(): {
	sketch: SketchDocument;
	sourceLineId: string;
	patternConstraint: RectangularPatternConstraint;
	createdLineIds: string[];
} {
	const sketch = new SketchDocument();
	const p1 = sketch.addPoint(new Vec2(0, 0));
	const p2 = sketch.addPoint(new Vec2(20, 0));
	const sourceLine = sketch.addLine(p1.id, p2.id);

	const copies = [
		sketch.generateRectangularPatternCopy(
			[sourceLine.id],
			1,
			0,
			40,
			'one_direction',
			30,
			'one_direction',
			new Vec2(1, 0),
			new Vec2(0, 1)
		)!,
		sketch.generateRectangularPatternCopy(
			[sourceLine.id],
			0,
			1,
			40,
			'one_direction',
			30,
			'one_direction',
			new Vec2(1, 0),
			new Vec2(0, 1)
		)!,
	];
	const patternConstraint = sketch.addRectangularPatternConstraint(
		[sourceLine.id],
		null,
		null,
		2,
		40,
		'one_direction',
		2,
		30,
		'one_direction',
		false,
		[],
		copies
	)!;
	const createdLineIds = copies.flatMap(copy => copy.createdEntityIds.filter(e => e.type === 'line').map(e => e.id));
	return { sketch, sourceLineId: sourceLine.id, patternConstraint, createdLineIds };
}

function createMirroredLineSketch(): {
	sketch: SketchDocument;
	origLineId: string;
	mirroredLineId: string;
	mirrorConstraints: SymmetryConstraint[];
} {
	const sketch = new SketchDocument();
	const p1 = sketch.addPoint(new Vec2(20, 10));
	const p2 = sketch.addPoint(new Vec2(60, 40));
	const origLine = sketch.addLine(p1.id, p2.id);

	const tool = new MirrorTool();
	const ctx = {
		sketch,
		viewport: { worldToScreen: (p: Vec2) => p, screenToWorld: (p: Vec2) => p },
		renderer: { clearPreviews: () => {} },
		svg: {},
		isConstructionMode: false,
		lineType: 'solid',
		requestRender: () => {},
		setTool: () => {},
		setCursor: () => {},
		showToast: () => {},
	} as unknown as ToolContext;
	tool.activate(ctx);
	tool.state = {
		phase: 'mirror_line',
		selectedObjectIds: new Set([origLine.id]),
		mirrorLineId: 'axis_y',
	};
	assert.equal(tool.executeMirror(), true);

	const mirroredLine = [...sketch.lines.values()].find(l => l.id !== origLine.id)!;
	assert.ok(mirroredLine);
	const mirrorConstraints = [...sketch.constraints.values()].filter(
		(c): c is SymmetryConstraint => c instanceof SymmetryConstraint && Boolean(c.isMirrorCopy)
	);
	assert.equal(mirrorConstraints.length, 2);
	return { sketch, origLineId: origLine.id, mirroredLineId: mirroredLine.id, mirrorConstraints };
}

describe('Deleting generative constraints with optional geometry removal', () => {
	it('OffsetConstraint: keeps or deletes offset geometry and supports single-step undo', () => {
		const { sketch, origLineId, offsetConstraint, offLineId } = createOffsetLineSketch();

		assert.deepEqual(sketch.getConstraintCreatedGeometryIds(offsetConstraint.id), [offLineId]);
		assert.equal(sketch.getCreatedGeometryConstraintsForIds([offsetConstraint.id]).length, 1);

		// Keep geometry
		sketch.removeConstraint(offsetConstraint.id, { deleteCreatedGeometry: false });
		assert.equal(sketch.constraints.has(offsetConstraint.id), false);
		assert.equal(sketch.lines.has(offLineId), true);
		assert.equal(sketch.lines.has(origLineId), true);

		// Undo and delete WITH geometry
		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(offsetConstraint.id), true);
		assert.equal(sketch.lines.has(offLineId), true);

		sketch.removeConstraint(offsetConstraint.id, { deleteCreatedGeometry: true });
		assert.equal(sketch.constraints.has(offsetConstraint.id), false);
		assert.equal(sketch.lines.has(offLineId), false);
		assert.equal(sketch.lines.has(origLineId), true);

		// Single undo restores both the offset constraint and offset geometry
		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(offsetConstraint.id), true);
		assert.equal(sketch.lines.has(offLineId), true);
	});

	it('CircularPatternConstraint: deletes cloned copies while keeping source and center, and excludes readonly polygons', () => {
		const { sketch, centerId, sourceLineId, patternConstraint, createdLineIds } = createCircularPatternSketch();

		assert.deepEqual(sketch.getConstraintCreatedGeometryIds(patternConstraint.id), createdLineIds);
		assert.equal(sketch.getCreatedGeometryConstraintsForIds([patternConstraint.id]).length, 1);

		sketch.removeConstraint(patternConstraint.id, { deleteCreatedGeometry: true });
		assert.equal(sketch.constraints.has(patternConstraint.id), false);
		for (const id of createdLineIds) {
			assert.equal(sketch.lines.has(id), false);
		}
		assert.equal(sketch.lines.has(sourceLineId), true);
		assert.equal(sketch.points.has(centerId), true);

		// Undo restores both constraint and cloned lines
		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(patternConstraint.id), true);
		for (const id of createdLineIds) {
			assert.equal(sketch.lines.has(id), true);
		}

		// Polygon (read-only circular pattern) does NOT prompt to delete geometry
		const polySketch = new SketchDocument();
		const polyCenter = polySketch.addPoint(new Vec2(0, 0));
		const poly = polySketch.addPolygon(polyCenter.id, 30, 6, 0)!;
		assert.equal(poly.constraint.isReadOnly, true);
		assert.deepEqual(polySketch.getConstraintCreatedGeometryIds(poly.constraint.id), []);
		assert.equal(polySketch.getCreatedGeometryConstraintsForIds([poly.constraint.id]).length, 0);
	});

	it('RectangularPatternConstraint: deletes cloned copies while keeping source geometry', () => {
		const { sketch, sourceLineId, patternConstraint, createdLineIds } = createRectangularPatternSketch();

		assert.deepEqual(sketch.getConstraintCreatedGeometryIds(patternConstraint.id), createdLineIds);
		sketch.removeConstraint(patternConstraint.id, { deleteCreatedGeometry: true });

		assert.equal(sketch.constraints.has(patternConstraint.id), false);
		for (const id of createdLineIds) {
			assert.equal(sketch.lines.has(id), false);
		}
		assert.equal(sketch.lines.has(sourceLineId), true);

		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(patternConstraint.id), true);
		for (const id of createdLineIds) {
			assert.equal(sketch.lines.has(id), true);
		}
	});

	it('SymmetryConstraint: prompts only for mirror copies and deletes mirrored geometry when requested', () => {
		const { sketch, origLineId, mirroredLineId, mirrorConstraints } = createMirroredLineSketch();
		const target = mirrorConstraints[0];

		assert.deepEqual(sketch.getConstraintCreatedGeometryIds(target.id), [target.p2Id]);
		assert.equal(sketch.getCreatedGeometryConstraintsForIds([target.id]).length, 1);

		sketch.removeConstraint(target.id, { deleteCreatedGeometry: true });
		assert.equal(sketch.constraints.has(target.id), false);
		assert.equal(sketch.lines.has(mirroredLineId), false);
		assert.equal(sketch.lines.has(origLineId), true);

		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(target.id), true);
		assert.equal(sketch.lines.has(mirroredLineId), true);

		// Manual symmetry constraint (not created by MirrorTool) should NOT trigger created-geometry deletion
		const manualSketch = new SketchDocument();
		const a = manualSketch.addPoint(new Vec2(-10, 5));
		const b = manualSketch.addPoint(new Vec2(10, 5));
		const sym = manualSketch.addSymmetryConstraint(a.id, b.id, 'axis_y')!;
		assert.deepEqual(manualSketch.getConstraintCreatedGeometryIds(sym.id), []);
		assert.equal(manualSketch.getCreatedGeometryConstraintsForIds([sym.id]).length, 0);
	});

	it('deleteSelected skips prompting when created geometry is already selected and deletes geometry when requested', () => {
		const { sketch, offsetConstraint, offLineId } = createOffsetLineSketch();

		// Only constraint selected -> prompts
		sketch.selectEntity(offsetConstraint.id, 'constraint', false);
		assert.equal(sketch.getCreatedGeometryConstraintsForSelection().length, 1);

		// Both constraint and offset line selected -> no prompt needed
		sketch.selectEntity(offLineId, 'line', true);
		assert.equal(sketch.getCreatedGeometryConstraintsForSelection().length, 0);

		// Select only constraint and deleteSelected with deleteConstraintGeometry: true
		sketch.selectEntity(offsetConstraint.id, 'constraint', false);
		sketch.deleteSelected({ deleteConstraintGeometry: true });
		assert.equal(sketch.constraints.has(offsetConstraint.id), false);
		assert.equal(sketch.lines.has(offLineId), false);

		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.has(offsetConstraint.id), true);
		assert.equal(sketch.lines.has(offLineId), true);
	});

	it('DeleteTool invokes onConfirmConstraintDelete for generative constraints and respects cancel / keep / delete', async () => {
		const { sketch, offsetConstraint, offLineId } = createOffsetLineSketch();
		const prompted: IConstraint[][] = [];
		let nextChoice: 'delete-geometry' | 'keep-geometry' | 'cancel' = 'cancel';

		const ctx = {
			sketch,
			viewport: { worldToScreen: (p: Vec2) => p, screenToWorld: (p: Vec2) => p },
			renderer: { clearPreviews: () => {} },
			svg: {},
			highlightManager: {
				getHoveredTarget: () => ({ id: offsetConstraint.id, type: 'constraint' as const }),
				clear: () => {},
			},
			isConstructionMode: false,
			lineType: 'solid',
			requestRender: () => {},
			setTool: () => {},
			setCursor: () => {},
			showToast: () => {},
			onConfirmConstraintDelete: async (constraints: IConstraint[]) => {
				prompted.push(constraints);
				return nextChoice;
			},
		} as unknown as ToolContext;

		const tool = new DeleteTool();
		tool.activate(ctx);
		const fakeEvent = {
			raw: {} as MouseEvent,
			screen: new Vec2(0, 0),
			client: new Vec2(0, 0),
			world: new Vec2(0, 0),
			snap: null,
			effectiveWorld: new Vec2(0, 0),
			effectiveScreen: new Vec2(0, 0),
		} satisfies ToolMouseEvent;

		// 1. Cancel -> nothing deleted
		nextChoice = 'cancel';
		tool.onMouseDown(fakeEvent);
		await Promise.resolve();
		assert.equal(prompted.length, 1);
		assert.equal(sketch.constraints.has(offsetConstraint.id), true);
		assert.equal(sketch.lines.has(offLineId), true);

		// 2. Keep geometry -> only constraint deleted
		nextChoice = 'keep-geometry';
		tool.onMouseDown(fakeEvent);
		await Promise.resolve();
		assert.equal(prompted.length, 2);
		assert.equal(sketch.constraints.has(offsetConstraint.id), false);
		assert.equal(sketch.lines.has(offLineId), true);

		// Restore via undo
		sketch.undo();
		assert.equal(sketch.constraints.has(offsetConstraint.id), true);

		// 3. Delete geometry -> both constraint and offset line deleted
		nextChoice = 'delete-geometry';
		tool.onMouseDown(fakeEvent);
		await Promise.resolve();
		assert.equal(prompted.length, 3);
		assert.equal(sketch.constraints.has(offsetConstraint.id), false);
		assert.equal(sketch.lines.has(offLineId), false);
	});
});

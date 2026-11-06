import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { DistanceConstraint, RadiusConstraint, AngleConstraint } from '../src/solver/constraints';

describe('CAD Parameters, Equations & Geometry Integration', () => {
	it('adds, updates, and deletes parameters in SketchDocument', () => {
		const doc = new SketchDocument();

		// Add
		const res1 = doc.addParameter('width', '100', 'Plate width');
		assert.equal(res1.success, true);
		assert.equal(doc.getParameter('width')?.value, 100);

		// Duplicate error
		const resDup = doc.addParameter('width', '50');
		assert.equal(resDup.success, false);

		// Invalid name error
		const resInvalid = doc.addParameter('123bad', '10');
		assert.equal(resInvalid.success, false);

		// Update value
		const resUpd = doc.updateParameter('width', 'width', '120', 'Updated width');
		assert.equal(resUpd.success, true);
		assert.equal(doc.getParameter('width')?.value, 120);

		// Delete
		const resDel = doc.deleteParameter('width');
		assert.equal(resDel.success, true);
		assert.equal(doc.getParameter('width'), undefined);
	});

	it('resolves parameter dependency chains', () => {
		const doc = new SketchDocument();
		doc.addParameter('a', '50');
		doc.addParameter('b', 'a * 2');
		doc.addParameter('c', 'b + 15');

		assert.equal(doc.getParameter('a')?.value, 50);
		assert.equal(doc.getParameter('b')?.value, 100);
		assert.equal(doc.getParameter('c')?.value, 115);

		// Update root parameter 'a', dependent parameters automatically recalculate
		doc.updateParameter('a', 'a', '80');
		assert.equal(doc.getParameter('a')?.value, 80);
		assert.equal(doc.getParameter('b')?.value, 160);
		assert.equal(doc.getParameter('c')?.value, 175);
	});

	it('binds DistanceConstraint to expression and recalculates geometry on parameter change', () => {
		const doc = new SketchDocument();
		doc.addParameter('len', '100');

		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 50, y: 0 });
		doc.addLine(p1.id, p2.id);

		// Add distance constraint
		const distC = doc.addDistanceConstraint(p1.id, p2.id, 50, 'horizontal');
		assert.ok(distC);

		// Set expression via calculator input
		const ok = doc.updateDimensionalConstraint(distC.id, 'len / 2 + 10');
		assert.equal(ok, true);
		assert.equal(distC.expression, 'len / 2 + 10');
		assert.equal(distC.targetDistance, 60);

		// Point p2 moved to 60
		const pt2 = doc.points.get(p2.id)!;
		assert.ok(Math.abs(pt2.x - 60) < 1e-3);

		// Now change parameter 'len' to 200: len / 2 + 10 = 110
		doc.updateParameter('len', 'len', '200');
		assert.equal(distC.targetDistance, 110);
		assert.ok(Math.abs(pt2.x - 110) < 1e-3);
	});

	it('binds RadiusConstraint to expression with radius and diameter modes', () => {
		const doc = new SketchDocument();
		doc.addParameter('dia', '40');

		const center = doc.addPoint({ x: 0, y: 0 }, true);
		const circle = doc.addCircle(center.id, 10);
		const radC = doc.addRadiusConstraint(circle.id);
		assert.ok(radC);

		// Update with diameter expression
		doc.updateDimensionalConstraint(radC.id, 'dia', 'diameter');
		assert.equal(radC.expression, 'dia');
		assert.equal(radC.targetRadius, 20);

		// Change 'dia' to 80 -> target radius becomes 40
		doc.updateParameter('dia', 'dia', '80');
		assert.equal(radC.targetRadius, 40);
	});

	it('supports undo and redo for parameter changes and geometry re-solve', () => {
		const doc = new SketchDocument();
		doc.clearHistory();

		// Add parameter
		doc.addParameter('w', '50');
		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 10, y: 0 });
		const distC = doc.addDistanceConstraint(p1.id, p2.id, 10, 'horizontal');
		doc.updateDimensionalConstraint(distC.id, 'w');

		assert.ok(Math.abs(doc.points.get(p2.id)!.x - 50) < 1e-3);

		// Change parameter w to 120
		doc.updateParameter('w', 'w', '120');
		assert.ok(Math.abs(doc.points.get(p2.id)!.x - 120) < 1e-3);

		// Undo should restore w to 50 and point to 50
		assert.equal(doc.canUndo(), true);
		assert.equal(doc.undo(), true);
		assert.equal(doc.getParameter('w')?.value, 50);
		assert.ok(Math.abs(doc.points.get(p2.id)!.x - 50) < 1e-3);

		// Redo should restore w to 120 and point to 120
		assert.equal(doc.canRedo(), true);
		assert.equal(doc.redo(), true);
		assert.equal(doc.getParameter('w')?.value, 120);
		assert.ok(Math.abs(doc.points.get(p2.id)!.x - 120) < 1e-3);
	});

	it('exports and imports parameters and constraint expressions in SVG', () => {
		const doc = new SketchDocument();
		doc.addParameter('box_w', '75', 'Box width');
		doc.addParameter('box_h', 'box_w / 2', 'Box height');

		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 75, y: 0 });
		const distC = doc.addDistanceConstraint(p1.id, p2.id, 75, 'horizontal');
		doc.updateDimensionalConstraint(distC.id, 'box_w');

		// Export SVG
		const svgMarkup = doc.exportSVG();
		assert.ok(svgMarkup.includes('<metadata id="sketcher-metadata">'));
		assert.ok(svgMarkup.includes('"name": "box_w"'));
		assert.ok(svgMarkup.includes('"expression": "box_w / 2"'));

		// Import into a new document
		const doc2 = new SketchDocument();
		const importRes = doc2.importSVG(svgMarkup);
		assert.equal(importRes.success, true);

		// Parameters are restored
		assert.equal(doc2.getParameter('box_w')?.value, 75);
		assert.equal(doc2.getParameter('box_h')?.value, 37.5);

		// Constraint expressions are restored
		const importedDistC = Array.from(doc2.constraints.values()).find(c => c instanceof DistanceConstraint);
		assert.ok(importedDistC);
		assert.equal(importedDistC.expression, 'box_w');
		assert.equal(importedDistC.targetDistance, 75);

		// Updating restored parameter updates restored document geometry
		doc2.updateParameter('box_w', 'box_w', '150');
		assert.equal(importedDistC.targetDistance, 150);
		assert.equal(doc2.getParameter('box_h')?.value, 75);
	});

	it('renames parameter across expressions in parameters and constraints', () => {
		const doc = new SketchDocument();
		doc.addParameter('old_name', '10');
		doc.addParameter('dep', 'old_name * 3');

		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 10, y: 0 });
		const distC = doc.addDistanceConstraint(p1.id, p2.id, 10, 'horizontal');
		doc.updateDimensionalConstraint(distC.id, 'old_name + 5');

		// Rename old_name -> new_name
		doc.updateParameter('old_name', 'new_name', '20');

		assert.equal(doc.getParameter('old_name'), undefined);
		assert.equal(doc.getParameter('new_name')?.value, 20);
		assert.equal(doc.getParameter('dep')?.expression, 'new_name * 3');
		assert.equal(doc.getParameter('dep')?.value, 60);
		assert.equal(distC.expression, 'new_name + 5');
		assert.equal(distC.targetDistance, 25);
	});

	it('evaluateParameterGraph on document performs pure evaluation without change notifications', () => {
		const doc = new SketchDocument();
		doc.addParameter('len', '50');
		doc.addParameter('half', 'len / 2');

		let listenerCalled = false;
		doc.onChange(() => {
			listenerCalled = true;
		});

		const res = doc.evaluateParameterGraph();
		assert.equal(listenerCalled, false);
		assert.equal(res.values.get('len'), 50);
		assert.equal(res.values.get('half'), 25);
		assert.equal(res.errors.size, 0);
	});

	it('parameters popup workflow adds parameters without stack overflow or re-entrancy', () => {
		const doc = new SketchDocument();
		let notifications = 0;
		doc.onChange(() => {
			notifications++;
			// Verify that querying parameter graph in listener is safe and does not trigger re-solve
			const graph = doc.evaluateParameterGraph();
			assert.ok(graph.values);
		});

		const res1 = doc.addParameter('d1', '10');
		assert.equal(res1.success, true);
		const res2 = doc.addParameter('d2', 'd1 * 2');
		assert.equal(res2.success, true);

		assert.ok(notifications <= 4);
		assert.equal(doc.getParameter('d1')?.value, 10);
		assert.equal(doc.getParameter('d2')?.value, 20);
	});
});

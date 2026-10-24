import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { CircularPatternConstraint } from '../src/solver/constraints';
import { serializeConstraint, deserializeConstraint } from '../src/model/history';
import { dist } from '../src/math/vector';

describe('Polygon Geometry and Constraints', () => {
	it('addPolygon creates correct number of vertices, edges, and CircularPatternConstraint', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);

		// Hexagon (6 sides) with inradius 50 mm
		const inradius = 50;
		const sides = 6;
		const poly = doc.addPolygon(center.id, inradius, sides, 0);

		assert.ok(poly, 'Polygon should be successfully created');
		assert.equal(poly.vertices.length, 6);
		assert.equal(poly.lines.length, 6);
		assert.ok(poly.constraint instanceof CircularPatternConstraint);
		assert.equal(poly.constraint.isReadOnly, true);
		assert.equal(poly.constraint.quantity, 6);
		assert.equal(poly.constraint.distribution, 'full');
		assert.equal(poly.constraint.totalAngle, 360);
		assert.equal(poly.constraint.centerPtId, center.id);

		// Check circumradius R = r / cos(pi / 6) = 50 / (sqrt(3)/2) = 57.735 mm
		const expectedR = inradius / Math.cos(Math.PI / 6);
		for (const v of poly.vertices) {
			const d = dist(center, v);
			assert.ok(Math.abs(d - expectedR) < 1e-3, `Vertex distance ${d} should match circumradius ${expectedR}`);
		}

		// Check each edge midpoint distance to center = inradius
		for (const line of poly.lines) {
			const p1 = doc.points.get(line.p1Id)!;
			const p2 = doc.points.get(line.p2Id)!;
			const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
			const d = dist(center, mid);
			assert.ok(Math.abs(d - inradius) < 1e-3, `Edge midpoint distance ${d} should match inradius ${inradius}`);
		}

		// Check all edges have equal length: 2 * r * tan(pi / 6)
		const expectedEdgeLen = 2 * inradius * Math.tan(Math.PI / 6);
		for (const line of poly.lines) {
			const p1 = doc.points.get(line.p1Id)!;
			const p2 = doc.points.get(line.p2Id)!;
			const len = dist(p1, p2);
			assert.ok(Math.abs(len - expectedEdgeLen) < 1e-3, `Edge length ${len} should match ${expectedEdgeLen}`);
		}
	});

	it('addPolygon works with arbitrary N (e.g. pentagon N=5, octagon N=8)', () => {
		const doc = new SketchDocument();
		const c5 = doc.addPoint(100, 100);
		const poly5 = doc.addPolygon(c5.id, 30, 5, Math.PI / 4);
		assert.ok(poly5);
		assert.equal(poly5.vertices.length, 5);
		assert.equal(poly5.lines.length, 5);
		assert.equal(poly5.constraint.quantity, 5);

		const c8 = doc.addPoint(-100, -100);
		const poly8 = doc.addPolygon(c8.id, 40, 8, 0);
		assert.ok(poly8);
		assert.equal(poly8.vertices.length, 8);
		assert.equal(poly8.lines.length, 8);
		assert.equal(poly8.constraint.quantity, 8);
	});

	it('polygon solver maintains regular polygon geometry when solved', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(10, 20);
		const inradius = 45;
		const poly = doc.addPolygon(center.id, inradius, 6, 0);
		assert.ok(poly);

		// Solver satisfied all equations
		assert.ok(doc.lastSolverResult?.status === 'UNDER_CONSTRAINED' || doc.lastSolverResult?.status === 'CONVERGED');

		// Fix center and vertex 0, verifying fully constrained solve
		doc.addFixedConstraint(center.id);
		doc.addFixedConstraint(poly.vertices[0].id);
		doc.solve();
		assert.equal(doc.lastSolverResult?.status, 'CONVERGED');

		// Check that all vertices have circumradius distance
		const expectedR = inradius / Math.cos(Math.PI / 6);
		for (const v of poly.vertices) {
			const d = dist(center, v);
			assert.ok(Math.abs(d - expectedR) < 1e-2, `Distance to center should remain circumradius ${expectedR}`);
		}
	});

	it('polygon constraint cannot be edited via updateCircularPattern (isReadOnly)', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);
		const poly = doc.addPolygon(center.id, 50, 6, 0);
		assert.ok(poly);

		// Attempting to update a read-only polygon circular pattern must be rejected
		const success = doc.updateCircularPattern(poly.constraint.id, { quantity: 10, totalAngle: 180 });
		assert.equal(success, false);
		assert.equal(poly.constraint.quantity, 6);
		assert.equal(poly.constraint.totalAngle, 360);
	});

	it('deleting polygon constraint keeps vertices and edges intact', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);
		const poly = doc.addPolygon(center.id, 50, 6, 0);
		assert.ok(poly);

		const cid = poly.constraint.id;
		assert.ok(doc.constraints.has(cid));

		// Remove constraint
		doc.removeConstraint(cid);
		assert.ok(!doc.constraints.has(cid), 'Constraint should be deleted');

		// Points and lines should still exist
		assert.equal(doc.points.has(center.id), true);
		for (const v of poly.vertices) {
			assert.equal(doc.points.has(v.id), true, 'Vertex point should remain after constraint removal');
		}
		for (const l of poly.lines) {
			assert.equal(doc.lines.has(l.id), true, 'Line should remain after constraint removal');
		}
	});

	it('deleting a vertex cleans up the polygon circular pattern constraint', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);
		const poly = doc.addPolygon(center.id, 50, 6, 0);
		assert.ok(poly);

		const cid = poly.constraint.id;
		assert.ok(doc.constraints.has(cid));

		// Remove vertex 2
		const v2 = poly.vertices[2];
		doc.removeEntity(v2.id);

		// Constraint should be cleaned up because one of its pattern points is missing
		assert.ok(!doc.constraints.has(cid), 'Constraint should be removed when a vertex is deleted');
	});

	it('history undo and redo properly restore polygon and its isReadOnly flag', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);

		// Add polygon
		const poly = doc.addPolygon(center.id, 50, 6, 0);
		assert.ok(poly);
		const cid = poly.constraint.id;
		assert.ok(doc.constraints.has(cid));

		// Undo
		doc.undo();
		assert.ok(!doc.constraints.has(cid), 'Constraint should be gone after undo');
		assert.equal(doc.lines.size, 0, 'Lines should be gone after undo');
		assert.equal(doc.points.size, 1, 'Only center point should remain after undo');

		// Redo
		doc.redo();
		assert.ok(doc.constraints.has(cid), 'Constraint should be restored after redo');
		const restoredC = doc.constraints.get(cid) as CircularPatternConstraint;
		assert.equal(restoredC.isReadOnly, true, 'isReadOnly flag should be preserved across undo/redo');
		assert.equal(restoredC.quantity, 6);
		assert.equal(doc.lines.size, 6, 'Lines should be restored after redo');
		assert.equal(doc.points.size, 7, 'Center + 6 vertices should be restored after redo');
	});

	it('serialization and deserialization preserve isReadOnly on CircularPatternConstraint', () => {
		const c = new CircularPatternConstraint(
			'c_poly',
			'p_center',
			['p_v0'],
			'full',
			360,
			6,
			false,
			[],
			[
				{ copyIndex: 1, pointPairs: [{ sourcePtId: 'p_v0', patternPtId: 'p_v1' }], createdEntityIds: [{ id: 'p_v1', type: 'point' }] }
			],
			1.0,
			true // isReadOnly
		);

		const serialized = serializeConstraint(c);
		assert.equal(serialized.isReadOnly, true);

		const deserialized = deserializeConstraint(serialized) as CircularPatternConstraint;
		assert.ok(deserialized instanceof CircularPatternConstraint);
		assert.equal(deserialized.isReadOnly, true);
		assert.equal(deserialized.quantity, 6);
	});

	it('addPolygon with addDistanceConstraint = true creates PointToLineDistanceConstraint', () => {
		const doc = new SketchDocument();
		const center = doc.addPoint(0, 0);
		const inradius = 40;
		const poly = doc.addPolygon(center.id, inradius, 6, 0, false, true);
		assert.ok(poly);
		assert.ok(poly.distanceConstraint, 'Distance constraint should be created');
		assert.equal(poly.distanceConstraint.pointId, center.id);
		assert.equal(poly.distanceConstraint.lineId, poly.lines[0].id);
		assert.ok(Math.abs(poly.distanceConstraint.targetDistance - inradius) < 1e-4);

		// Solver converges with distance constraint and fixed center & vertex
		doc.addFixedConstraint(center.id);
		doc.addFixedConstraint(poly.vertices[0].id);
		doc.solve();
		assert.equal(doc.lastSolverResult?.status, 'CONVERGED');
	});
});

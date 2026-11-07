import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { DistanceConstraint } from '../src/solver/constraints/distance';
import { RadiusConstraint } from '../src/solver/constraints/radius';
import { CircularPatternConstraint } from '../src/solver/constraints/circularPattern';
import { RectangularPatternConstraint } from '../src/solver/constraints/rectangularPattern';
import { ParallelConstraint } from '../src/solver/constraints/parallel';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import { ConstraintPanel } from '../src/ui/panels/constraints/constraintPanel';

describe('ConstraintPanel Integration', () => {
	it('BaseConstraint (e.g. ParallelConstraint) defaults to ConstraintPanel', () => {
		const doc = new SketchDocument();
		const p1 = doc.addPoint({ x: 0, y: 0 });
		const p2 = doc.addPoint({ x: 10, y: 0 });
		const p3 = doc.addPoint({ x: 0, y: 5 });
		const p4 = doc.addPoint({ x: 10, y: 5 });
		const l1 = doc.addLine(p1.id, p2.id);
		const l2 = doc.addLine(p3.id, p4.id);
		const c = new ParallelConstraint('c_par', l1.id, l2.id, p1.id, p2.id, p3.id, p4.id);

		assert.ok(c.sidebarPanel, 'Should have sidebarPanel');
		assert.ok(c.sidebarPanel instanceof ConstraintPanel, 'Should be an instance of ConstraintPanel');

		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '<div class="prims"></div>',
		};

		const html = c.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('Parallel'), 'Should render constraint name in title');
		assert.ok(html.includes('prims'), 'Should render primitives sublist');
	});

	it('DistanceConstraint renders dimension value and fx expression', () => {
		const doc = new SketchDocument();
		const p1 = doc.addPoint({ x: 0, y: 0 });
		const p2 = doc.addPoint({ x: 50, y: 0 });
		const c = new DistanceConstraint('c_dist', p1.id, p2.id, 50);
		c.expression = 'len / 2';

		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '',
		};

		const html = c.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('Distance'), 'Should render title');
		assert.ok(html.includes('50 mm'), 'Should render formatted distance');
		assert.ok(html.includes('fx: len / 2'), 'Should render expression badge');
		assert.ok(html.includes('btn-insp-edit-dim'), 'Should render edit dimension button');

		const restored = deserializeConstraint(serializeConstraint(c));
		assert.ok(restored instanceof DistanceConstraint);
		assert.equal(restored.sidebarPanel.render(mockCtx), html);
	});

	it('RadiusConstraint renders segmented control for mode and dimension', () => {
		const doc = new SketchDocument();
		const p = doc.addPoint({ x: 0, y: 0 });
		const circle = doc.addCircle(p.id, 25);
		const c = new RadiusConstraint('c_rad', circle.id, 25, 1.0, undefined, 'radius');

		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '',
		};

		const html = c.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('Radius'), 'Should have Radius in title/label');
		assert.ok(html.includes('25 mm'), 'Should have 25 mm value');
		assert.ok(html.includes('insp-cpanel-seg-btn'), 'Should have segmented control buttons');
	});

	it('CircularPatternConstraint renders distribution, angle, quantity, and suppression', () => {
		const doc = new SketchDocument();
		const c = new CircularPatternConstraint('c_cpat', 'center_pt', ['src1'], 'full', 360, 4, false, [], []);

		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '',
		};

		const html = c.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('Circular Pattern'), 'Should have title');
		assert.ok(html.includes('Distribution'), 'Should have distribution segmented control');
		assert.ok(html.includes('Quantity'), 'Should have quantity field');
		assert.ok(html.includes('Suppression'), 'Should have suppression checkbox');
	});

	it('RectangularPatternConstraint renders sections AXIS 1 and AXIS 2', () => {
		const doc = new SketchDocument();
		const c = new RectangularPatternConstraint(
			'c_rpat',
			['src1'],
			'line1',
			'p1',
			'p2',
			null,
			null,
			null,
			3,
			20,
			'one_direction',
			2,
			30,
			'symmetric',
			false,
			[],
			[]
		);

		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '',
		};

		const html = c.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('Rectangular Pattern'), 'Should have title');
		assert.ok(html.includes('AXIS 1'), 'Should have AXIS 1 section header');
		assert.ok(html.includes('AXIS 2'), 'Should have AXIS 2 section header');
		assert.ok(html.includes('Distance'), 'Should have distance fields');
		assert.ok(html.includes('Quantity'), 'Should have quantity fields');
		assert.ok(html.includes('Suppression'), 'Should have suppression checkbox');
	});
});

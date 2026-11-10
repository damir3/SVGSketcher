import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';

describe('PrimitivePanel Integration', () => {
	it('SketchLine uses PrimitivePanel for sidebar inspector rendering', () => {
		const doc = new SketchDocument();
		const p1 = doc.addPoint({ x: 0, y: 0 });
		const p2 = doc.addPoint({ x: 100, y: 0 });
		const line = doc.addLine(p1.id, p2.id);

		assert.ok(line.sidebarPanel, 'Line should have sidebarPanel');

		const mockCtx: any = {
			sketch: doc,
			renderConstraintsSublist: () => '<div class="sublist"></div>',
			bindInspectorNumberInput: () => {},
		};

		const html = line.sidebarPanel.render(mockCtx);
		assert.ok(html.includes(line.id), 'Panel should render line id');
		assert.ok(html.includes('insp-line-length'), 'Panel should have length input');
		assert.ok(html.includes('insp-line-angle'), 'Panel should have angle input');
		assert.ok(html.includes('value="100"'), 'Panel should display correct length');
	});

	it('SketchCircle uses PrimitivePanel for sidebar inspector rendering', () => {
		const doc = new SketchDocument();
		const p = doc.addPoint({ x: 10, y: 20 });
		const circle = doc.addCircle(p.id, 25);

		assert.ok(circle.sidebarPanel, 'Circle should have sidebarPanel');

		const mockCtx: any = {
			sketch: doc,
			renderConstraintsSublist: () => '',
			bindInspectorNumberInput: () => {},
		};

		const html = circle.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('insp-circle-radius'));
		assert.ok(html.includes('insp-circle-diameter'));
		assert.ok(html.includes('value="25"'));
		assert.ok(html.includes('value="50"'));
	});

	it('SketchPoint uses PrimitivePanel for sidebar inspector rendering', () => {
		const doc = new SketchDocument();
		const pt = doc.addPoint({ x: 42.5, y: -17.25 });

		assert.ok(pt.sidebarPanel, 'Point should have sidebarPanel');

		const mockCtx: any = {
			sketch: doc,
			renderConstraintsSublist: () => '',
			bindInspectorNumberInput: () => {},
		};

		const html = pt.sidebarPanel.render(mockCtx);
		assert.ok(html.includes('insp-pt-x'));
		assert.ok(html.includes('insp-pt-y'));
		assert.ok(html.includes('value="42.5"'));
		assert.ok(html.includes('value="-17.25"'));
	});
});

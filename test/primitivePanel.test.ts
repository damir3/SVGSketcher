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
		assert.ok(html.includes('<strong>42.5 mm</strong>'));
		assert.ok(html.includes('<strong>-17.25 mm</strong>'));
	});

	it('PrimitivePanel evaluates formulas inline without storing expressions', () => {
		const doc = new SketchDocument();
		doc.addParameter('span', '120');
		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 60, y: 0 });
		const line = doc.addLine(p1.id, p2.id);

		const makeClassList = (initial: string[]) => {
			const set = new Set(initial);
			return {
				add: (...names: string[]) => names.forEach(n => set.add(n)),
				remove: (...names: string[]) => names.forEach(n => set.delete(n)),
				contains: (name: string) => set.has(name),
			};
		};
		const makeEl = (classes: string[], value = '') => {
			const listeners = new Map<string, Array<(e: any) => void>>();
			return {
				value,
				textContent: '',
				innerHTML: '',
				title: '',
				classList: makeClassList(classes),
				addEventListener(type: string, fn: (e: any) => void) {
					const list = listeners.get(type) ?? [];
					list.push(fn);
					listeners.set(type, list);
				},
				dispatch(type: string, extra: Record<string, any> = {}) {
					const evt = { stopPropagation() {}, preventDefault() {}, ...extra };
					for (const fn of listeners.get(type) ?? []) fn(evt);
				},
				focus() {},
				blur() {},
				select() {},
			};
		};

		const displayBtn = makeEl(['inspector-value-display']);
		const editorEl = makeEl(['inspector-inline-editor', 'hidden']);
		const wrapEl = makeEl(['pattern-input-suffix-wrapper', 'inspector-dim-input-wrap']);
		const input = makeEl(['pattern-num-input', 'inspector-dim-input'], '60');
		const previewEl = makeEl(['dim-eval-preview', 'inspector-dim-preview', 'hidden']);

		const selectorMap = new Map<string, any>([
			['.inspector-value-display[data-field-id="insp-line-length"]', displayBtn],
			['[data-dim-editor="insp-line-length"]', editorEl],
			['[data-dim-wrap="insp-line-length"]', wrapEl],
			['#insp-line-length', input],
			['#insp-dim-preview-insp-line-length', previewEl],
		]);
		const mockContainer: any = {
			contains: () => false,
			querySelector: (sel: string) => selectorMap.get(sel) ?? null,
			querySelectorAll: () => [],
		};
		const mockCtx: any = {
			sketch: doc,
			renderConstraintsSublist: () => '',
			requestRender: () => {},
		};

		line.sidebarPanel.bindEvents(mockContainer, mockCtx);
		displayBtn.dispatch('click');
		assert.equal(editorEl.classList.contains('hidden'), false);

		input.value = 'span / 2 + 15';
		input.dispatch('input');
		assert.equal(previewEl.classList.contains('hidden'), false);
		assert.equal(previewEl.textContent, '= 75.0 mm');

		input.dispatch('keydown', { key: 'Enter' });
		assert.ok(Math.abs(p1.distanceTo(p2) - 75) < 1e-6);
		assert.equal(editorEl.classList.contains('hidden'), true);

		const rerendered = line.sidebarPanel.render(mockCtx);
		assert.ok(rerendered.includes('<strong>75 mm</strong>'));
		assert.ok(!rerendered.includes('inspector-expr-badge'), 'Should not persist fx badge on primitives');
		assert.equal(doc.canUndo(), true);
	});
});

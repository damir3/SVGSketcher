import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { SketchDocument } from '../src/model/sketch';

register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { Sidebar } = await import('../src/ui/sidebar');

interface MockElement {
	tagName: string;
	id: string;
	classes: Set<string>;
	attrs: Map<string, string>;
	listeners: Map<string, Array<(e: any) => void>>;
	getAttribute(name: string): string | null;
	addEventListener(type: string, fn: (e: any) => void): void;
	click(eventOverrides?: Record<string, any>): void;
	closest(selector: string): MockElement | null;
}

function createMockElement(tagName: string, attrString: string): MockElement {
	const attrs = new Map<string, string>();
	const attrRegex = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
	let m: RegExpExecArray | null;
	while ((m = attrRegex.exec(attrString))) {
		attrs.set(m[1], m[2] ?? '');
	}
	const classes = new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
	const listeners = new Map<string, Array<(e: any) => void>>();

	const el: MockElement = {
		tagName: tagName.toUpperCase(),
		id: attrs.get('id') ?? '',
		classes,
		attrs,
		listeners,
		getAttribute(name: string) {
			return attrs.get(name) ?? null;
		},
		addEventListener(type: string, fn: (e: any) => void) {
			const list = listeners.get(type) ?? [];
			list.push(fn);
			listeners.set(type, list);
		},
		click(eventOverrides = {}) {
			const evt = {
				target: el,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				stopPropagation() {},
				preventDefault() {},
				...eventOverrides,
			};
			for (const fn of listeners.get('click') ?? []) {
				fn(evt);
			}
		},
		closest(selector: string) {
			const parts = selector.split(',').map(s => s.trim());
			for (const part of parts) {
				if (part.startsWith('.') && classes.has(part.slice(1))) return el;
			}
			return null;
		},
	};
	return el;
}

function parseElements(html: string): MockElement[] {
	const elements: MockElement[] = [];
	const tagRegex = /<([a-zA-Z][a-zA-Z0-9-]*)(\s+[^>]*)?>/g;
	let m: RegExpExecArray | null;
	while ((m = tagRegex.exec(html))) {
		elements.push(createMockElement(m[1], m[2] ?? ''));
	}
	return elements;
}

function matchesSelector(el: MockElement, selector: string): boolean {
	if (selector.startsWith('#')) {
		return el.id === selector.slice(1);
	}
	// Support patterns like ".tree-item[data-type]" or ".tree-delete-btn[data-delete-id]" or ".constraint-entity-chip"
	const attrMatch = selector.match(/^(\.[a-zA-Z0-9_-]+)\[([a-zA-Z0-9_-]+)\]$/);
	if (attrMatch) {
		return el.classes.has(attrMatch[1].slice(1)) && el.attrs.has(attrMatch[2]);
	}
	if (selector.startsWith('.')) {
		return el.classes.has(selector.slice(1));
	}
	if (selector.startsWith('[') && selector.endsWith(']')) {
		return el.attrs.has(selector.slice(1, -1));
	}
	return false;
}

function createSidebarContainer() {
	let html = '';
	let parsed: MockElement[] = [];

	const container = {
		get innerHTML() {
			return html;
		},
		set innerHTML(val: string) {
			html = val;
			parsed = parseElements(val);
		},
		contains() {
			return false;
		},
		querySelector(selector: string): MockElement | null {
			return parsed.find(el => matchesSelector(el, selector)) ?? null;
		},
		querySelectorAll(selector: string): MockElement[] {
			return parsed.filter(el => matchesSelector(el, selector));
		},
	};

	return container as unknown as HTMLElement & {
		querySelector(selector: string): MockElement | null;
		querySelectorAll(selector: string): MockElement[];
	};
}

describe('Sidebar', () => {
	it('collapses Primitives tree by default and does not render tree items until expanded', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const container = createSidebarContainer();
		new Sidebar(container, sketch);

		assert.ok(container.innerHTML.includes('Primitives (3)'));
		assert.ok(container.innerHTML.includes('aria-expanded="false"'));
		assert.ok(!container.innerHTML.includes('dof-badge'));
		assert.equal(container.querySelectorAll('.tree-item[data-type]').length, 0);
		assert.ok(!container.innerHTML.includes(line.id));

		const toggleBtn = container.querySelector('#primitives-tree-toggle');
		assert.ok(toggleBtn);
		toggleBtn.click();

		assert.ok(container.innerHTML.includes('aria-expanded="true"'));
		assert.equal(container.querySelectorAll('.tree-item[data-type]').length, 3);
		assert.ok(container.innerHTML.includes(line.id));
		assert.ok(container.innerHTML.includes(p1.id));
		assert.ok(container.innerHTML.includes(p2.id));

		container.querySelector('#primitives-tree-toggle')!.click();
		assert.ok(container.innerHTML.includes('aria-expanded="false"'));
		assert.equal(container.querySelectorAll('.tree-item[data-type]').length, 0);
	});

	it('shows Selected Primitives list when multiple primitives are selected while Primitives tree stays collapsed', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);
		const circle = sketch.addCircle(p1.id, 25);

		const container = createSidebarContainer();
		new Sidebar(container, sketch);

		// Single selection shows single-entity inspector, not Selected Primitives list
		sketch.selectEntity(line.id, 'line', false);
		assert.ok(!container.innerHTML.includes('Selected Primitives'));
		assert.ok(container.innerHTML.includes('insp-line-length'));

		// Multi-selection shows Selected Primitives list
		sketch.selectEntities(
			[
				{ id: line.id, type: 'line' },
				{ id: circle.id, type: 'circle' },
				{ id: p2.id, type: 'point' },
			],
			false
		);

		assert.ok(container.innerHTML.includes('Selected Primitives (3)'));
		assert.ok(container.innerHTML.includes('aria-expanded="false"'));
		const rows = container.querySelectorAll('.tree-item[data-type]');
		assert.equal(rows.length, 3);
		assert.ok(rows.some(r => r.getAttribute('data-id') === line.id));
		assert.ok(rows.some(r => r.getAttribute('data-id') === circle.id));
		assert.ok(rows.some(r => r.getAttribute('data-id') === p2.id));

		// Shift-click removes one item from selection
		const p2Row = rows.find(r => r.getAttribute('data-id') === p2.id)!;
		p2Row.click({ shiftKey: true });
		assert.ok(container.innerHTML.includes('Selected Primitives (2)'));
		assert.equal(sketch.selection.pointIds.has(p2.id), false);

		// Normal click focuses single primitive inspector
		const lineRow = container.querySelectorAll('.tree-item[data-type]').find(r => r.getAttribute('data-id') === line.id)!;
		lineRow.click();
		assert.ok(!container.innerHTML.includes('Selected Primitives'));
		assert.ok(container.innerHTML.includes('insp-line-length'));

		// Clear button clears multi-selection
		sketch.selectEntities(
			[
				{ id: line.id, type: 'line' },
				{ id: circle.id, type: 'circle' },
			],
			false
		);
		assert.ok(container.innerHTML.includes('Selected Primitives (2)'));
		container.querySelector('#btn-clear-selection')!.click();
		assert.ok(!container.innerHTML.includes('Selected Primitives'));
	});

	it('excludes spline handle points and lines from Primitives count and Selected Primitives list', () => {
		const sketch = new SketchDocument();
		const sp1 = sketch.addPoint({ x: 0, y: 0 });
		const sp2 = sketch.addPoint({ x: 40, y: 20 });
		const sp3 = sketch.addPoint({ x: 80, y: 0 });
		const spline = sketch.addFitSpline([sp1.id, sp2.id, sp3.id]);
		const line = sketch.addLine(spline.pointIds[0], spline.pointIds[2]);

		const container = createSidebarContainer();
		new Sidebar(container, sketch);

		// 3 fit points + 1 spline + 1 line = 5 visible primitives (handle points/lines excluded)
		assert.ok(container.innerHTML.includes('Primitives (5)'));

		const handleLine = sketch.lines.get(spline.tangentLineIds![0])!;
		const handlePointId = handleLine.p1Id === sp1.id ? handleLine.p2Id : handleLine.p1Id;

		sketch.selectEntities(
			[
				{ id: spline.id, type: 'spline' },
				{ id: line.id, type: 'line' },
				{ id: handlePointId, type: 'point' },
				...spline.tangentLineIds!.map(id => ({ id, type: 'line' as const })),
			],
			false
		);

		assert.ok(container.innerHTML.includes('Selected Primitives (2)'));
		const rows = container.querySelectorAll('.tree-item[data-type]');
		assert.equal(rows.length, 2);
	});

	it('caps rendered Selected Primitives items at 200 and reports remaining count', () => {
		const sketch = new SketchDocument();
		const items: Array<{ id: string; type: 'point' }> = [];
		for (let i = 0; i < 205; i++) {
			const pt = sketch.addPoint({ x: i, y: 0 });
			items.push({ id: pt.id, type: 'point' });
		}

		const container = createSidebarContainer();
		new Sidebar(container, sketch);
		sketch.selectEntities(items, false);

		assert.ok(container.innerHTML.includes('Selected Primitives (205)'));
		assert.equal(container.querySelectorAll('.tree-item[data-type]').length, 200);
		assert.ok(container.innerHTML.includes('...and 5 more selected'));
	});
});

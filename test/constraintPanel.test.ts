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

	it('DistanceConstraint renders dimension value and fx expression without edit button', () => {
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
		const badgeIndex = html.indexOf('<span class="inspector-expr-badge">fx</span>');
		const valueIndex = html.indexOf('<strong>50 mm</strong>');
		assert.ok(badgeIndex >= 0 && badgeIndex < valueIndex, 'Should render compact fx badge before value');
		assert.ok(!html.includes('>fx: len / 2<'), 'Should not render full formula text next to value');
		assert.ok(!html.includes('btn-insp-edit-dim'), 'Should not render edit dimension button');
		assert.ok(html.includes('inspector-inline-editor'), 'Should render inline dimension editor');

		const restored = deserializeConstraint(serializeConstraint(c));
		assert.ok(restored instanceof DistanceConstraint);
		assert.equal(restored.sidebarPanel.render(mockCtx), html);
	});

	it('DistanceConstraint supports inline editing on click, Enter, Escape, and blur', () => {
		const doc = new SketchDocument();
		doc.addParameter('len', '80');
		const p1 = doc.addPoint({ x: 0, y: 0 }, true);
		const p2 = doc.addPoint({ x: 50, y: 0 });
		doc.addLine(p1.id, p2.id);
		const c = doc.addDistanceConstraint(p1.id, p2.id, 50)!;

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
		const input = makeEl(['pattern-num-input', 'inspector-dim-input'], '50');
		const previewEl = makeEl(['dim-eval-preview', 'inspector-dim-preview', 'hidden']);

		const selectorMap = new Map<string, any>([
			[`.inspector-value-display[data-constraint-id="${c.id}"]`, displayBtn],
			[`[data-dim-editor="${c.id}"]`, editorEl],
			[`[data-dim-wrap="${c.id}"]`, wrapEl],
			[`#insp-dim-input-${c.id}`, input],
			[`#insp-dim-preview-${c.id}`, previewEl],
		]);
		const mockContainer: any = {
			contains: () => false,
			querySelector: (sel: string) => selectorMap.get(sel) ?? null,
			querySelectorAll: () => [],
		};
		let renderCalls = 0;
		const mockCtx: any = {
			sketch: doc,
			renderPrimitivesSublist: () => '',
			requestRender: () => {
				renderCalls++;
			},
		};

		c.sidebarPanel.bindEvents(mockContainer, mockCtx);

		// Click opens inline editor
		displayBtn.dispatch('click');
		assert.equal(displayBtn.classList.contains('hidden'), true);
		assert.equal(editorEl.classList.contains('hidden'), false);
		assert.equal(input.value, '50');

		// Escape cancels without changing constraint
		input.value = '99';
		input.dispatch('keydown', { key: 'Escape' });
		assert.equal(c.targetDistance, 50);
		assert.equal(displayBtn.classList.contains('hidden'), false);
		assert.equal(editorEl.classList.contains('hidden'), true);

		// Re-open, type expression, verify live preview and commit via Enter
		displayBtn.dispatch('click');
		input.value = 'len / 2';
		input.dispatch('input');
		assert.equal(previewEl.classList.contains('hidden'), false);
		assert.equal(previewEl.textContent, '= 40.0 mm');

		input.dispatch('keydown', { key: 'Enter' });
		assert.equal(c.targetDistance, 40);
		assert.equal(c.expression, 'len / 2');
		assert.equal(editorEl.classList.contains('hidden'), true);
		assert.equal(renderCalls, 1);

		// Invalid expression keeps editor open with error on Enter
		displayBtn.dispatch('click');
		assert.equal(input.value, 'len / 2');
		input.value = 'unknown_var + 1';
		input.dispatch('keydown', { key: 'Enter' });
		assert.equal(editorEl.classList.contains('hidden'), false);
		assert.equal(wrapEl.classList.contains('error'), true);
		assert.equal(c.targetDistance, 40);

		// Blur on valid numeric value commits it
		input.value = '65';
		input.dispatch('blur', {});
		assert.equal(c.targetDistance, 65);
		assert.equal(c.expression, undefined);
		assert.equal(editorEl.classList.contains('hidden'), true);
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

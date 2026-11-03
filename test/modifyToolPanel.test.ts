import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModifyToolPanel } from '../src/ui/panels/tools/modifyToolPanel';

describe('ModifyToolPanel Integration', () => {
	it('renders header, steps, params, actions and hint correctly', () => {
		let currentPhase = 'step1';
		let count = 2;
		let dist = 10;
		let applied = false;
		let cancelled = false;

		const panel = new ModifyToolPanel({
			iconName: 'mirror',
			title: 'Custom Modify',
			description: 'Description of custom modify',
			steps: [
				{
					id: 'step1',
					num: 1,
					title: 'First Step',
					getValue: () => 'Step 1 Value',
					isActive: () => currentPhase === 'step1',
					showClear: () => count > 0,
					onSelect: () => {
						currentPhase = 'step1';
					},
					onClear: () => {
						count = 0;
					},
				},
				{
					id: 'step2',
					num: 2,
					title: 'Second Step',
					getValue: () => 'Step 2 Value',
					isActive: () => currentPhase === 'step2',
					onSelect: () => {
						currentPhase = 'step2';
					},
				},
			],
			params: [
				{ type: 'header', label: 'SECTION 1' },
				{
					type: 'field',
					id: 'test-dist-input',
					label: 'Distance',
					unit: 'mm',
					getValue: () => dist,
					onInput: val => {
						dist = val;
					},
				},
			],
			canApply: () => count > 0,
			applyLabel: 'Apply Custom',
			onApply: () => {
				applied = true;
			},
			onCancel: () => {
				cancelled = true;
			},
			getHint: () => (count > 0 ? 'Ready to apply' : 'Select items first'),
		});

		const html = panel.render();

		assert.ok(html.includes('tool-panel-card'), 'Uses the shared tool panel card class');
		assert.ok(html.includes('Custom Modify'), 'Renders title');
		assert.ok(html.includes('Description of custom modify'), 'Renders description');
		assert.ok(html.includes('First Step'), 'Renders step 1');
		assert.ok(html.includes('Second Step'), 'Renders step 2');
		assert.ok(html.includes('SECTION 1'), 'Renders header param');
		assert.ok(html.includes('test-dist-input'), 'Renders field param');
		assert.ok(html.includes('Apply Custom'), 'Renders apply label');
		assert.ok(!html.includes('disabled'), 'Apply button should not be disabled when canApply is true');
		assert.ok(html.includes('Ready to apply'), 'Renders hint');

		// Handle keydown Enter / Esc
		const handledEnter = panel.handleKeyDown({ key: 'Enter' } as any);
		assert.equal(handledEnter, true);
		assert.equal(applied, true);

		const handledEsc = panel.handleKeyDown({ key: 'Escape' } as any);
		assert.equal(handledEsc, true);
		assert.equal(cancelled, true);
	});
});

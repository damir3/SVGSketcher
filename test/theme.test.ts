import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLORS } from '../src/canvas/styles';
import {
	CANVAS_COLOR_TOKENS,
	DARK_THEME,
	DEFAULT_THEME,
	LIGHT_THEME,
	THEMES,
	canvasColorVariable,
	findTheme,
	resolveCanvasColorVariables,
	themeCssVariables,
} from '../src/theme/themes';

test('light theme is the default and both built-in themes are registered', () => {
	assert.equal(DEFAULT_THEME, LIGHT_THEME);
	assert.deepEqual(
		THEMES.map(theme => theme.id),
		['light', 'dark']
	);
	assert.equal(findTheme('dark'), DARK_THEME);
	assert.equal(findTheme('missing'), undefined);
	assert.equal(new Set(THEMES.map(theme => theme.id)).size, THEMES.length, 'theme ids are unique');
});

test('every theme defines the same set of CSS variables', () => {
	const expected = Object.keys(themeCssVariables(DEFAULT_THEME)).sort();
	for (const theme of THEMES) {
		const vars = themeCssVariables(theme);
		assert.deepEqual(Object.keys(vars).sort(), expected, theme.id);
		for (const [name, value] of Object.entries(vars)) {
			assert.ok(value.trim().length > 0, `${theme.id}: ${name} is empty`);
		}
	}
});

test('canvas colors reference theme variables', () => {
	const defined = new Set(Object.keys(themeCssVariables(DEFAULT_THEME)));
	for (const token of CANVAS_COLOR_TOKENS) {
		assert.equal(COLORS[token], `var(${canvasColorVariable(token)})`);
		assert.ok(defined.has(canvasColorVariable(token)));
	}
	assert.equal(canvasColorVariable('selectedBg'), '--canvas-selected-bg');
	assert.equal(canvasColorVariable('patternAxis1'), '--canvas-pattern-axis-1');
});

test('canvas color variables resolve to concrete palette colors for export', () => {
	const markup = `<path stroke="${COLORS.primary}" fill="${COLORS.selectedBg}" data-x="var(--unknown)"/>`;
	assert.equal(
		resolveCanvasColorVariables(markup),
		`<path stroke="${LIGHT_THEME.canvas.primary}" fill="${LIGHT_THEME.canvas.selectedBg}" data-x="var(--unknown)"/>`
	);
	assert.ok(resolveCanvasColorVariables(markup, DARK_THEME).includes(DARK_THEME.canvas.primary));
});

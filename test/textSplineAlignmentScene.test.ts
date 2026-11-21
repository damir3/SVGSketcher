import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel } from '../src/kernel';
import { loadFontFromFile, getFontSync } from '../src/canvas/fonts';
import { SketchDocument } from '../src/model/sketch';
import { generateTextSvgPathData } from '../src/math/textPath';
import { prepareTextGlyphs } from '../src/math/textGlyphs';
import { parseTextSvg } from './helpers/parseTextSvg';

// Keep the imported model, full bilingual text and exported outlines together.
const svg = readFileSync(new URL('./fixtures/textSplineAlignment.svg', import.meta.url), 'utf8');
const snapshot = JSON.parse(svg.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1]).snapshot;

test('the imported wave spline renders the complete right-aligned bilingual text', async () => {
	const previousDocument = globalThis.document;
	const fontBytes = readFileSync(new URL('../public/fonts/Arial.ttf', import.meta.url));
	await loadFontFromFile(new Blob([fontBytes]));
	const font = getFontSync('Arial')!;
	assert.ok(font);
	const sketch = new SketchDocument();
	sketch.restoreSnapshot(snapshot);
	const text = sketch.texts.get('Text-1')!;
	const curve = sketch.toGeoCurve(text.targetPrimitiveId!, text.targetPrimitiveType)!;
	assert.equal(curve.type, 'spline');
	if (curve.type !== 'spline') return;
	assert.equal(curve.bezierSegments.length, 5);
	assert.equal(text.alignment, 'right');
	assert.equal(text.fitToPath, false);
	const element = () => ({
		attributes: new Map<string, string>(),
		children: [] as any[],
		style: {},
		setAttribute(key: string, value: string) {
			this.attributes.set(key, value);
		},
		appendChild(child: any) {
			this.children.push(child);
		},
	});
	try {
		globalThis.document = { createElementNS: () => element() } as any;
		const firstPositions: number[] = [];
		for (const alignment of ['left', 'center', 'right'] as const) {
			text.alignment = alignment;
			const options = { ...text.serialize(), coordSystem: 'cad' as const };
			const input = prepareTextGlyphs(options, font, curve)!;
			assert.equal(input.glyphs.length, 47, 'both lines are shaped into one run');
			const commands = getGeometryKernel().textGeometry!(input);
			assert.ok(commands.length > 0);
			const group = element();
			text.render({
				sketch,
				viewport: { zoom: 4, panX: 612, panY: 359 },
				targetGroup: group as any,
				isSelected: true,
				color: '#0284c7',
				showGizmos: false,
			});
			const d = group.children[0].children[0].attributes.get('d');
			assert.equal(d, generateTextSvgPathData(options, font, curve), 'editor renders the complete generated path');
			const parsed = parseTextSvg(d);
			const parsedLast = parsed.at(-1)!;
			assert.ok(parsedLast.type !== 'Z');
			if (alignment === 'right')
				assert.ok(parsedLast.x > 120, 'the browser can parse the path through its final glyph');
			const first = commands[0];
			assert.ok(first.type !== 'Z');
			firstPositions.push(first.x);
			if (alignment === 'right') {
				const last = commands.at(-1)!;
				assert.ok(last.type !== 'Z' && last.x > 120, 'last character reaches the right endpoint');
			}
		}
		assert.ok(firstPositions[0] < firstPositions[1] && firstPositions[1] < firstPositions[2]);
	} finally {
		globalThis.document = previousDocument;
	}
});

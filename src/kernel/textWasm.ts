import type { TextCommand, TextGeometryKernel } from './textTypes';
import { packRegionCurves } from './regionWasm';

export type TextGeometryBinding = (
	glyphs: Float64Array,
	outlines: Float64Array,
	geometry: Float64Array,
	settings: Float64Array
) => Float64Array;
const tags = ['M', 'L', 'Q', 'C', 'Z'] as const;
export function createWasmTextGeometry(binding: TextGeometryBinding): TextGeometryKernel {
	return input => {
		const glyphs: number[] = [],
			outlines: number[] = [];
		for (const glyph of input.glyphs) {
			glyphs.push(glyph.line, glyph.advance, glyph.commands.length);
			for (const c of glyph.commands) {
				outlines.push(tags.indexOf(c.type));
				if (c.type === 'Q' || c.type === 'C') outlines.push(c.x1, c.y1);
				if (c.type === 'C') outlines.push(c.x2, c.y2);
				if (c.type !== 'Z') outlines.push(c.x, c.y);
			}
		}
		const geometry =
			input.mode === 'text'
				? new Float64Array(input.rectangle?.flatMap(p => [p.x, p.y]) ?? [])
				: packRegionCurves(input.curve ? [input.curve] : []);
		const settings = new Float64Array([
			['text', 'text_on_path'].indexOf(input.mode),
			input.height,
			input.unitsPerEm,
			input.ascender,
			input.descender,
			input.capHeight,
			input.characterSpacing,
			['left', 'center', 'right'].indexOf(input.alignment),
			['top', 'middle', 'bottom'].indexOf(input.verticalAlignment),
			Number(input.flipHorizontal) +
				2 * Number(input.flipVertical) +
				4 * Number(input.fitToPath) +
				8 * Number(input.placement === 'below') +
				16 * Number(input.svg),
			input.lineCount,
		]);
		if (
			!glyphs.every(Number.isFinite) ||
			!outlines.every(Number.isFinite) ||
			!geometry.every(Number.isFinite) ||
			!settings.every(Number.isFinite)
		)
			throw new Error('Non-finite text geometry input');
		const data = binding(new Float64Array(glyphs), new Float64Array(outlines), geometry, settings);
		if (!data.every(Number.isFinite)) throw new Error('Invalid WASM text coordinates');
		if (!data.length) return [];
		const commands: TextCommand[] = [];
		let at = 0;
		for (const glyph of input.glyphs)
			for (const c of glyph.commands) {
				const tag = data[at++];
				if (tag !== tags.indexOf(c.type)) throw new Error('Invalid WASM text command sequence');
				const read = () => {
					if (at >= data.length) throw new Error('Truncated WASM text command');
					return data[at++];
				};
				if (tag === 4) commands.push({ type: 'Z' });
				else if (tag === 0 || tag === 1) commands.push({ type: tags[tag], x: read(), y: read() });
				else if (tag === 2) commands.push({ type: 'Q', x1: read(), y1: read(), x: read(), y: read() });
				else commands.push({ type: 'C', x1: read(), y1: read(), x2: read(), y2: read(), x: read(), y: read() });
			}
		if (at !== data.length) throw new Error('Trailing WASM text geometry data');
		return commands;
	};
}

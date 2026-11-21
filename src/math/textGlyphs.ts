import type * as opentype from 'opentype.js';
import type { GeoCurve } from './intersection';
import type { TextLayoutOptions } from './textPath';
import type { TextGeometryInput, TextGlyph } from '../kernel/textTypes';

/** Extract font-owned data only; all placement, spacing and geometric transforms belong to the kernel. */
export function prepareTextGlyphs(
	options: TextLayoutOptions,
	font: opentype.Font,
	curve?: GeoCurve | null
): TextGeometryInput | null {
	if (!options.text || options.height <= 0) return null;
	if (options.mode === 'text' ? !options.rectangleCorners : !curve) return null;
	const lines = options.mode === 'text' ? options.text.split(/\r?\n/) : [options.text.replace(/\r?\n+/g, ' ')];
	const glyphs: TextGlyph[] = [];
	// A glyph's outline is immutable within one request; repeated letters share extraction work.
	const outlines = new Map<opentype.Glyph, TextGlyph['commands']>();
	for (const [line, text] of lines.entries()) {
		for (const glyph of font.stringToGlyphs(text)) {
			let commands = outlines.get(glyph);
			if (!commands) {
				commands = glyph.getPath(0, 0, options.height).commands;
				outlines.set(glyph, commands);
			}
			glyphs.push({ line, advance: glyph.advanceWidth || 0, commands });
		}
	}
	if (options.mode === 'text_on_path' && !glyphs.length) return null;
	return {
		mode: options.mode,
		height: options.height,
		unitsPerEm: font.unitsPerEm,
		ascender: options.mode === 'text' ? font.ascender || 0 : 0,
		descender: options.mode === 'text' ? font.descender || 0 : 0,
		capHeight:
			options.mode === 'text_on_path' && (options.placement === 'below' ? !options.flipVertical : options.flipVertical)
				? font.charToGlyph('H').getBoundingBox().y2
				: 0,
		characterSpacing: options.characterSpacing,
		alignment: options.alignment,
		verticalAlignment: options.verticalAlignment ?? 'middle',
		placement: options.placement,
		fitToPath: options.fitToPath,
		flipHorizontal: options.flipHorizontal,
		flipVertical: options.flipVertical,
		svg: options.coordSystem === 'svg',
		lineCount: lines.length,
		glyphs,
		...(options.mode === 'text' ? { rectangle: options.rectangleCorners } : { curve: curve! }),
	};
}

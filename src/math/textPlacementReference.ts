import type * as opentype from 'opentype.js';
import { serializeTextPath } from './textSvg';
import type { GeoCurve } from './intersection';
import { generateTextSvgPathData as legacy, type TextLayoutOptions } from './textPathReference';
import { createPathEvaluator } from './curvePathReference';
import { Vec2 } from './vector';
import type { BezierSegment } from './splineReference';

/** Grow only the reference path so its legacy clamping still preserves an overlong aligned run. */
export function extendOpenTextPath(options: TextLayoutOptions, font: opentype.Font, curve: GeoCurve): GeoCurve {
	if (options.fitToPath || (curve.type !== 'segment' && (curve.type !== 'spline' || curve.isClosed))) return curve;
	const glyphs = font.stringToGlyphs(options.text.replace(/\r?\n+/g, ' '));
	const scale = options.height / font.unitsPerEm,
		spacing = options.characterSpacing / 100;
	let total = 0;
	for (const [i, glyph] of glyphs.entries()) {
		const width = (glyph.advanceWidth || 0) * scale;
		total += width + (i < glyphs.length - 1 ? width * spacing : 0);
	}
	const path = createPathEvaluator(curve),
		extra = total - path.length;
	if (extra <= 0 || path.length <= 1e-3) return curve;
	const before = options.alignment === 'right' ? extra : options.alignment === 'center' ? extra / 2 : 0;
	const after = extra - before;
	const start = path.getSampleAtDistance(0),
		end = path.getSampleAtDistance(path.length);
	const a = start.point.clone().addScaledVector(start.tangent, -before);
	const b = end.point.clone().addScaledVector(end.tangent, after);
	if (curve.type === 'segment') return { ...curve, p1: a, p2: b };
	const line = (p: Vec2, q: Vec2): BezierSegment => [p, p.clone().lerp(q, 1 / 3), p.clone().lerp(q, 2 / 3), q];
	return {
		...curve,
		bezierSegments: [
			...(before > 0 ? [line(a, start.point)] : []),
			...curve.bezierSegments,
			...(after > 0 ? [line(end.point, b)] : []),
		],
	};
}

/** Adapt corrected placement while keeping the frozen layout arithmetic independent. */
export function generateTextSvgPathData(
	options: TextLayoutOptions,
	font: opentype.Font,
	curve?: GeoCurve | null,
	serialize: (path: opentype.Path) => string = serializeTextPath
): string {
	if (!options.text || options.height <= 0 || options.mode !== 'text_on_path' || !curve)
		return legacy(options, font, curve, serialize);
	const target = extendOpenTextPath(options, font, curve);
	if (options.placement !== 'below' || options.flipVertical) return legacy(options, font, target, serialize);
	const gap = options.height - font.charToGlyph('H').getBoundingBox().y2 * (options.height / font.unitsPerEm);
	const adapted: opentype.Font = Object.create(font);
	adapted.stringToGlyphs = text =>
		font.stringToGlyphs(text).map(glyph => {
			const adjusted: opentype.Glyph = Object.create(glyph);
			adjusted.getPath = (...args) => {
				const path = glyph.getPath(...args),
					shifted: opentype.Path = Object.create(path);
				shifted.commands = path.commands.map(c => {
					if (c.type === 'Z') return { ...c };
					if (c.type === 'C') return { ...c, y: c.y - gap, y1: c.y1 - gap, y2: c.y2 - gap };
					if (c.type === 'Q') return { ...c, y: c.y - gap, y1: c.y1 - gap };
					return { ...c, y: c.y - gap };
				});
				return shifted;
			};
			return adjusted;
		});
	return legacy(options, adapted, target, serialize);
}

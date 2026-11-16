import * as opentype from 'opentype.js';
import { Vec2 } from './vector';
import type { GeoCurve } from './intersection';
import { createCurvePath as createPathEvaluator } from './curvePath';

export interface TextLayoutOptions {
	mode: 'text' | 'text_on_path';
	text: string;
	height: number; // in mm
	characterSpacing: number; // in %
	verticalAlignment?: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	alignment: 'left' | 'center' | 'right';
	rectangleCorners?: [Vec2, Vec2, Vec2, Vec2]; // p0 (TL), p1 (TR), p2 (BR), p3 (BL) in CAD coords
	coordSystem?: 'cad' | 'svg';
}

export { type CurveSample, type PathEvaluator } from './curvePath';
export { createCurvePath as createPathEvaluator } from './curvePath';

/**
 * Generates an SVG path data string (d="...") representing the text.
 */
export function generateTextSvgPathData(
	options: TextLayoutOptions,
	font: opentype.Font,
	targetCurve?: GeoCurve | null
): string {
	if (!options.text || options.height <= 0) {
		return '';
	}

	const isSvgCoord = options.coordSystem === 'svg';
	let effectiveHeight = options.height;
	let scale = effectiveHeight / font.unitsPerEm;
	const spacingRatio = options.characterSpacing / 100;

	const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;
	const pathObj = new PathClass();

	if (options.mode === 'text' && options.rectangleCorners) {
		const [p0, p1, _p2, p3] = options.rectangleCorners;
		const width = p0.distanceTo(p1);
		const height = p0.distanceTo(p3);

		if (width <= 1e-3 || height <= 1e-3) return '';

		const center = new Vec2().midpoint(p0, _p2);
		const ux = new Vec2().subVectors(p1, p0).normalizeOrUnitX();
		const uy = new Vec2().subVectors(p0, p3).normalizeOrUnitX();

		const lines = (options.text || '').split(/\r?\n/);
		const numLines = Math.max(1, lines.length);
		const lineHeight = effectiveHeight * 1.25;
		const totalBlockHeight = (numLines - 1) * lineHeight;

		const ascender = (font.ascender || font.unitsPerEm * 0.8) * scale;
		const descender = (font.descender || -font.unitsPerEm * 0.2) * scale;
		const textMidY = (ascender + descender) / 2;

		let firstLineBaselineY = 0;
		const vAlign = options.verticalAlignment ?? 'middle';
		if (vAlign === 'top') {
			firstLineBaselineY = height / 2 - 1 - ascender;
		} else if (vAlign === 'bottom') {
			firstLineBaselineY = -height / 2 + 1 - descender + totalBlockHeight;
		} else {
			firstLineBaselineY = totalBlockHeight / 2 - textMidY;
		}

		const blockTop = firstLineBaselineY + ascender;
		const blockBottom = firstLineBaselineY - (numLines - 1) * lineHeight + descender;
		const blockCenterY = (blockTop + blockBottom) / 2;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const lineStr = lines[lineIdx];
			const lineGlyphs = font.stringToGlyphs(lineStr);
			if (lineGlyphs.length === 0) continue;

			const lineRawWidths = lineGlyphs.map(g => (g.advanceWidth || 0) * scale);
			const lineCharSpacings = lineRawWidths.map(w => w * spacingRatio);
			let lineTotalWidth = 0;
			for (let i = 0; i < lineRawWidths.length; i++) {
				lineTotalWidth += lineRawWidths[i] + (i < lineRawWidths.length - 1 ? lineCharSpacings[i] : 0);
			}

			let startX = 0;
			if (options.alignment === 'center') {
				startX = -lineTotalWidth / 2;
			} else if (options.alignment === 'right') {
				startX = width / 2 - lineTotalWidth - 1;
			} else {
				startX = -width / 2 + 1;
			}

			const lineBaselineY = firstLineBaselineY - lineIdx * lineHeight;

			let curX = startX;
			for (let i = 0; i < lineGlyphs.length; i++) {
				const g = lineGlyphs[i];
				const w = lineRawWidths[i];
				const gPath = g.getPath(0, 0, effectiveHeight);

				for (const cmd of gPath.commands) {
					const transformLocal = (x: number, y: number): Vec2 => {
						// In opentype, -y is upwards (above baseline).
						let lx = curX + x;
						let ly = lineBaselineY - y;

						if (options.flipHorizontal) {
							lx = 2 * startX + lineTotalWidth - lx;
						}
						if (options.flipVertical) {
							ly = 2 * blockCenterY - ly;
						}

						// Map to CAD coordinates
						const cad = center.clone().addScaledVector(ux, lx).addScaledVector(uy, ly);

						if (isSvgCoord) {
							return new Vec2(cad.x, -cad.y);
						}
						return cad;
					};

					appendTransformedCommand(pathObj, cmd, transformLocal);
				}

				curX += w + (i < lineGlyphs.length - 1 ? lineCharSpacings[i] : 0);
			}
		}
	} else if (options.mode === 'text_on_path' && targetCurve) {
		const singleLineText = options.text.replace(/\r?\n+/g, ' ');
		const glyphs = font.stringToGlyphs(singleLineText);
		if (glyphs.length === 0) return '';

		const rawWidths = glyphs.map(g => (g.advanceWidth || 0) * scale);
		const charSpacings = rawWidths.map(w => w * spacingRatio);
		let totalTextWidth = 0;
		for (let i = 0; i < rawWidths.length; i++) {
			totalTextWidth += rawWidths[i] + (i < rawWidths.length - 1 ? charSpacings[i] : 0);
		}
		const evaluator = createPathEvaluator(targetCurve);
		const curveLen = evaluator.length;
		if (curveLen <= 1e-3) return '';

		let extraGap = 0;
		if (options.fitToPath) {
			const unspacedTotal = rawWidths.reduce((a, b) => a + b, 0);
			if (glyphs.length <= 1) {
				extraGap = 0;
			} else {
				const remaining = curveLen - unspacedTotal;
				const gaps = Math.max(1, glyphs.length - 1);
				extraGap = remaining / gaps;
			}
			totalTextWidth = curveLen;
		}

		let startDist = 0;
		if (!options.fitToPath) {
			if (options.alignment === 'center') {
				startDist = Math.max(0, (curveLen - totalTextWidth) / 2);
			} else if (options.alignment === 'right') {
				startDist = Math.max(0, curveLen - totalTextWidth);
			} else {
				startDist = 0;
			}
		}

		const below = options.placement === 'below';
		let normalOffset = below ? -effectiveHeight : 0.5;
		if (options.flipVertical) {
			// Use the flat cap line above the path and the baseline below it.
			normalOffset = below ? 0 : font.charToGlyph('H').getBoundingBox().y2 * scale;
		}
		const normalDirection = options.flipVertical ? 1 : -1;

		// Font metrics and glyph layout stay in JS; request every geometric frame together.
		let curDist = startDist;
		const distances = rawWidths.map((w, i) => {
			const midDist = curDist + w / 2;
			curDist += w + (options.fitToPath ? extraGap : charSpacings[i]);
			return options.flipHorizontal ? 2 * startDist + totalTextWidth - midDist : midDist;
		});
		const samples = evaluator.getSamplesAtDistances(distances);
		for (let i = 0; i < glyphs.length; i++) {
			const g = glyphs[i];
			const w = rawWidths[i];
			const sample = samples[i];
			let tan = sample.tangent;
			let norm = sample.normal;

			if (options.flipHorizontal) {
				tan = tan.clone().negate();
			}

			const gPath = g.getPath(0, 0, effectiveHeight);

			for (const cmd of gPath.commands) {
				const transformCurve = (x: number, y: number): Vec2 => {
					const dx = x - w / 2;
					const dy = normalOffset + normalDirection * y;

					const cad = sample.point.clone().addScaledVector(tan, dx).addScaledVector(norm, dy);

					if (isSvgCoord) {
						return new Vec2(cad.x, -cad.y);
					}
					return cad;
				};

				appendTransformedCommand(pathObj, cmd, transformCurve);
			}
		}
	}

	return pathObj.toPathData(2);
}

function appendTransformedCommand(
	targetPath: opentype.Path,
	cmd: opentype.PathCommand,
	transform: (x: number, y: number) => Vec2
): void {
	switch (cmd.type) {
		case 'M': {
			const p = transform(cmd.x, cmd.y);
			targetPath.moveTo(p.x, p.y);
			break;
		}
		case 'L': {
			const p = transform(cmd.x, cmd.y);
			targetPath.lineTo(p.x, p.y);
			break;
		}
		case 'Q': {
			const c1 = transform(cmd.x1, cmd.y1);
			const p = transform(cmd.x, cmd.y);
			targetPath.quadraticCurveTo(c1.x, c1.y, p.x, p.y);
			break;
		}
		case 'C': {
			const c1 = transform(cmd.x1, cmd.y1);
			const c2 = transform(cmd.x2, cmd.y2);
			const p = transform(cmd.x, cmd.y);
			targetPath.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
			break;
		}
		case 'Z': {
			targetPath.close();
			break;
		}
	}
}

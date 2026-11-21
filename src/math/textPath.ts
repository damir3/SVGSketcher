import * as opentype from 'opentype.js';
import { serializeTextPath } from './textSvg';
import type { GeoCurve } from './intersection';
import type { Vec2 } from './vector';
import { prepareTextGlyphs } from './textGlyphs';
import { getGeometryKernel } from '../kernel';

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

export { type CurveSample, type PathEvaluator, createCurvePath as createPathEvaluator } from './curvePath';

/** Extract font outlines in JS; place and transform the complete text in one native query. */
export function generateTextSvgPathData(
	options: TextLayoutOptions,
	font: opentype.Font,
	targetCurve?: GeoCurve | null
): string {
	const kernel = getGeometryKernel().textGeometry;
	if (!kernel) throw new Error('Text geometry requires the Rust/WASM kernel');
	const input = prepareTextGlyphs(options, font, targetCurve);
	if (!input) return '';
	const commands = kernel(input);
	const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;
	const path = new PathClass();
	path.commands = commands;
	return serializeTextPath(path);
}

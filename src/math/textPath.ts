import * as opentype from 'opentype.js';
import { serializeTextPath } from './textSvg';
import type { GeoCurve } from './intersection';
import type { TextLayoutOptions } from './textPathReference';
import { generateTextSvgPathData as reference } from './textPlacementReference';
import { prepareTextGlyphs } from './textGlyphs';
import { getGeometryKernel } from '../kernel';

export type { TextLayoutOptions } from './textPathReference';
export { type CurveSample, type PathEvaluator, createCurvePath as createPathEvaluator } from './curvePath';

/** Extract font outlines in JS; place and transform the complete text in one native query. */
export function generateTextSvgPathData(
	options: TextLayoutOptions,
	font: opentype.Font,
	targetCurve?: GeoCurve | null
): string {
	const kernel = getGeometryKernel().textGeometry;
	if (!kernel) return reference(options, font, targetCurve);
	const input = prepareTextGlyphs(options, font, targetCurve);
	if (!input) return '';
	const commands = kernel(input);
	const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;
	const path = new PathClass();
	path.commands = commands;
	return serializeTextPath(path);
}

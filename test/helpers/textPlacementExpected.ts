import type * as opentype from 'opentype.js';
import { serializeTextPath } from '../../src/math/textSvg';
import { generateTextSvgPathData as reference } from '../../src/math/textPlacementReference';
import type { TextLayoutOptions } from '../../src/math/textPath';
import type { GeoCurve } from '../../src/math/intersection';

/** Capture unrounded coordinates from the independent JS layout for intentional placement corrections. */
export function textPlacementExpected(options: TextLayoutOptions, font: opentype.Font, curve?: GeoCurve | null) {
	let commands: opentype.PathCommand[] = [];
	const svg = reference(options, font, curve, path => {
		commands = structuredClone(path.commands);
		return serializeTextPath(path);
	});
	return { commands, svg };
}

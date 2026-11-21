import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { Vec2 } from '../../src/math/vector';
import type { TextLayoutOptions } from '../../src/math/textPath';
import type { GeoCurve } from '../../src/math/intersection';
import { hydrateQueryCurve } from './hydrateQueryCurve';

const ot = (opentype as any).default ?? opentype;
export function textFonts(): Record<string, opentype.Font> {
	const outline = new ot.Path();
	outline.moveTo(0, 0);
	outline.lineTo(400, 0);
	outline.quadraticCurveTo(650, 350, 400, 700);
	outline.bezierCurveTo(300, 800, -100, 400, 0, 0);
	outline.close();
	outline.moveTo(100, 100);
	outline.lineTo(200, 100);
	outline.lineTo(150, 250);
	outline.close();
	const glyph = (name: string, unicode: number | undefined, advanceWidth: number, path = outline) =>
		new ot.Glyph({ name, unicode, advanceWidth, path });
	const synthetic = new ot.Font({
		familyName: 'Kernel geometry fixture',
		styleName: 'Regular',
		unitsPerEm: 1000,
		ascender: 800,
		descender: -200,
		glyphs: [
			glyph('.notdef', undefined, 500),
			glyph('A', 65, 600),
			glyph('H', 72, 700),
			glyph('B', 66, 550),
			glyph('space', 32, 250, new ot.Path()),
			glyph('zero', 90, 0),
		],
	});
	const fonts: Record<string, opentype.Font> = { synthetic };
	for (const [key, file] of [
		['arial', 'Arial.ttf'],
		['times', 'TimesNewRoman.ttf'],
		['courier', 'CourierNew.ttf'],
	]) {
		const data = readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url));
		fonts[key] = ot.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	}
	return fonts;
}

export function textGeometryScenes() {
	const scenes: { name: string; font: string; options: TextLayoutOptions; curve?: GeoCurve }[] = [];
	const base: TextLayoutOptions = {
		mode: 'text',
		text: 'A B\nHZ',
		height: 4.5,
		characterSpacing: 17,
		alignment: 'left',
		placement: 'above',
		fitToPath: false,
		flipHorizontal: false,
		flipVertical: false,
		rectangleCorners: [new Vec2(-20, 15), new Vec2(25, 27), new Vec2(30, -5), new Vec2(-15, -17)],
	};
	for (const alignment of ['left', 'center', 'right'] as const)
		for (const verticalAlignment of ['top', 'middle', 'bottom'] as const)
			for (const flipHorizontal of [false, true])
				for (const flipVertical of [false, true])
					for (const coordSystem of ['cad', 'svg'] as const)
						scenes.push({
							name: `rectangle/${alignment}/${verticalAlignment}/${flipHorizontal}/${flipVertical}/${coordSystem}`,
							font: 'synthetic',
							options: { ...base, alignment, verticalAlignment, flipHorizontal, flipVertical, coordSystem },
						});
	for (const font of ['arial', 'times', 'courier'])
		for (const alignment of ['left', 'center', 'right'] as const)
			for (const flip of [false, true])
				scenes.push({
					name: `${font}/rectangle/${alignment}/${flip}`,
					font,
					options: {
						...base,
						text: 'Abé\r\n\nWi',
						alignment,
						verticalAlignment: alignment === 'left' ? 'top' : alignment === 'right' ? 'bottom' : 'middle',
						flipHorizontal: flip,
						flipVertical: !flip,
						coordSystem: 'svg',
					},
				});
	const line: GeoCurve = { id: 'text-line', type: 'segment', p1: new Vec2(-13, 7), p2: new Vec2(22, 13) };
	for (const alignment of ['left', 'center', 'right'] as const)
		for (const fitToPath of [false, true])
			for (const placement of ['above', 'below'] as const)
				for (const flipHorizontal of [false, true])
					for (const flipVertical of [false, true])
						scenes.push({
							name: `line/${alignment}/${fitToPath}/${placement}/${flipHorizontal}/${flipVertical}`,
							font: 'synthetic',
							options: {
								...base,
								mode: 'text_on_path',
								text: 'A\r\n\nB Z',
								alignment,
								fitToPath,
								placement,
								flipHorizontal,
								flipVertical,
								coordSystem: flipVertical ? 'svg' : 'cad',
							},
							curve: line,
						});
	const paths = JSON.parse(readFileSync(new URL('../fixtures/kernelCurvePaths.json', import.meta.url), 'utf8'));
	for (const [i, c] of paths.cases.entries())
		for (const flip of [false, true])
			scenes.push({
				name: `curve/${c.curve.id}/${flip}`,
				font: i % 2 ? 'arial' : 'synthetic',
				options: {
					...base,
					mode: 'text_on_path',
					text: 'AH B',
					height: i % 3 ? 3 : 20,
					characterSpacing: i % 2 ? -40 : 250,
					alignment: ['left', 'center', 'right'][i % 3] as TextLayoutOptions['alignment'],
					fitToPath: flip,
					flipHorizontal: flip,
					flipVertical: !flip,
					placement: i % 2 ? 'above' : 'below',
					coordSystem: 'svg',
				},
				curve: hydrateQueryCurve(c.curve),
			});
	for (const text of ['', ' ', 'A', 'Z', '\n', '\nA\n\n', 'A\r\nB', 'A'.repeat(30)])
		for (const mode of ['text', 'text_on_path'] as const)
			scenes.push({
				name: `special/${mode}/${JSON.stringify(text)}`,
				font: 'synthetic',
				options: { ...base, mode, text, fitToPath: true, flipHorizontal: true, flipVertical: true },
				curve: line,
			});
	for (const height of [0, -1, 0.001])
		scenes.push({ name: `height/${height}`, font: 'synthetic', options: { ...base, height } });
	scenes.push({
		name: 'rectangle/degenerate',
		font: 'synthetic',
		options: { ...base, rectangleCorners: [new Vec2(), new Vec2(), new Vec2(), new Vec2()] },
	});
	scenes.push({
		name: 'path/degenerate',
		font: 'synthetic',
		options: { ...base, mode: 'text_on_path' },
		curve: { ...line, p1: new Vec2(), p2: new Vec2() },
	});
	return scenes;
}

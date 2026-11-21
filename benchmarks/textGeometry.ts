import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getFontSync } from '../src/canvas/fonts';
import { getGeometryKernel } from '../src/kernel';
import { hydrateQueryCurve } from '../test/helpers/hydrateQueryCurve';
import { generateTextSvgPathData } from '../src/math/textPath';
import type { TextLayoutOptions } from '../src/math/textPath';
import { Vec2 } from '../src/math/vector';
import { summarize } from './stats';

if (!getGeometryKernel().textGeometry) throw new Error('Run with the test/helpers/wasmKernel.ts preload');
const font = getFontSync('Arial', false, false);
assert.ok(font);
const fixtures = JSON.parse(readFileSync(new URL('../test/fixtures/kernelCurvePaths.json', import.meta.url), 'utf8'));
const base: TextLayoutOptions = {
	mode: 'text_on_path',
	text: 'Geometry Rust '.repeat(30),
	height: 3,
	characterSpacing: 5,
	alignment: 'center',
	placement: 'above',
	fitToPath: true,
	flipHorizontal: true,
	flipVertical: true,
	coordSystem: 'svg',
};
const scenes = [
	{
		name: 'rectangle',
		options: {
			...base,
			mode: 'text' as const,
			text: 'Geometry Rust '.repeat(15) + '\n' + 'Sketcher '.repeat(20),
			rectangleCorners: [new Vec2(0, 30), new Vec2(200, 30), new Vec2(200, 0), new Vec2(0, 0)] as [
				Vec2,
				Vec2,
				Vec2,
				Vec2,
			],
		},
		curve: undefined,
	},
	...['segment', 'ellipse', 'spline'].map(kind => ({
		name: kind,
		options: base,
		curve: hydrateQueryCurve(fixtures.cases.find((c: any) => c.curve.type === kind).curve),
	})),
];
for (const scene of scenes) {
	const samples: number[] = [];
	for (let i = -2; i < 5; i++) {
		const start = performance.now();
		const svg = generateTextSvgPathData(scene.options, font, scene.curve);
		const elapsed = performance.now() - start;
		assert.ok(svg.length > 0);
		if (i >= 0) samples.push(elapsed);
	}
	console.log(JSON.stringify({ scene: scene.name, backend: 'rust', milliseconds: summarize(samples) }));
}

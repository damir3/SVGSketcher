import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getFontSync } from '../src/canvas/fonts';
import { getGeometryKernel } from '../src/kernel';
import { hydrateQueryCurve } from '../src/kernel/queryReference';
import { generateTextSvgPathData } from '../src/math/textPath';
import { generateTextSvgPathData as reference } from '../src/math/textPlacementReference';
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
		curve: hydrateQueryCurve(fixtures.cases.find(c => c.curve.type === kind).curve),
	})),
];
for (const scene of scenes) {
	const expected = reference(scene.options, font, scene.curve),
		actual = generateTextSvgPathData(scene.options, font, scene.curve);
	const a = actual.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [],
		b = expected.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [];
	assert.equal(a.length, b.length);
	for (let i = 0; i < a.length; i++)
		if (Number.isNaN(Number(b[i]))) assert.equal(a[i], b[i]);
		else assert.ok(Math.abs(Number(a[i]) - Number(b[i])) <= 0.010000001);
	for (const [backend, query] of [
		['typescript', reference],
		['rust', generateTextSvgPathData],
	] as const) {
		const samples: number[] = [];
		for (let i = -2; i < 5; i++) {
			const start = performance.now();
			query(scene.options, font, scene.curve);
			const elapsed = performance.now() - start;
			if (i >= 0) samples.push(elapsed);
		}
		console.log(
			JSON.stringify({
				scene: scene.name,
				characters: scene.options.text.length,
				backend,
				milliseconds: summarize(samples),
			})
		);
	}
}

import assert from 'node:assert/strict';
import * as opentype from 'opentype.js';
import { serializeTextPath } from '../src/math/textSvg';
import { parseTextSvg } from './helpers/parseTextSvg';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmGeometryKernel } from '../src/kernel/wasm';
import { createWasmTextGeometry } from '../src/kernel/textWasm';
import type { TextGeometryInput } from '../src/kernel/textTypes';
import { createPathEvaluator, generateTextSvgPathData } from '../src/math/textPath';
import { prepareTextGlyphs } from '../src/math/textGlyphs';
import { Vec2 } from '../src/math/vector';
import { hydrateQueryCurve } from './helpers/hydrateQueryCurve';
import { textFonts } from './helpers/textGeometryScenes';

const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelTextGeometry.json', import.meta.url), 'utf8'));
const fonts = textFonts(),
	native = !!getGeometryKernel().textGeometry;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function compare(actual: any, expected: any, path = '') {
	if (typeof expected === 'number') {
		assert.ok(
			typeof actual === 'number' && Math.abs(actual - expected) <= 1e-10 + Math.abs(expected) * 2e-12,
			`${path}: ${actual} != ${expected}`
		);
		return;
	}
	if (expected && typeof expected === 'object') {
		assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
		for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
	} else assert.equal(actual, expected, path);
}
function compareSvg(actual: string, expected: string) {
	parseTextSvg(actual);
	parseTextSvg(expected);
	const a = actual.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [],
		b = expected.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g) ?? [];
	assert.equal(a.length, b.length, 'SVG structure');
	for (let i = 0; i < a.length; i++) {
		if (Number.isNaN(Number(b[i]))) assert.equal(a[i], b[i]);
		else assert.ok(Math.abs(Number(a[i]) - Number(b[i])) <= 0.010000001, 'only two-decimal rounding may differ');
	}
}
function hydrate(f: any) {
	return {
		options: {
			...f.options,
			...(f.options.rectangleCorners ? { rectangleCorners: f.options.rectangleCorners.map(Vec2.from) } : {}),
		},
		curve: f.curve ? hydrateQueryCurve(f.curve) : undefined,
	};
}
for (const f of fixture.cases)
	test(`native text layout preserves unrounded geometry: ${f.name}`, () => {
		const { options, curve } = hydrate(f),
			input = prepareTextGlyphs(options, fonts[f.font], curve);
		assert.deepEqual(plain(input), f.input, 'font extraction retains pre-routing data and the corrected cap metric');
		const expected = f.expectedWasm ?? f.expected;
		const before = plain({ options, curve, input });
		if (native && input) compare(getGeometryKernel().textGeometry!(input), expected.commands, f.name);
		const svg = generateTextSvgPathData(options, fonts[f.font], curve);
		const expectedPath = new PathClass();
		expectedPath.commands = expected.commands;
		compareSvg(svg, serializeTextPath(expectedPath));
		assert.deepEqual(plain({ options, curve, input }), before);
	});

test('the complete text uses one native call without curve or spline callbacks', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js'),
		previous = getGeometryKernel();
	let calls = 0;
	try {
		setGeometryKernel(
			createWasmGeometryKernel({
				...bindings,
				text_geometry(...args) {
					calls++;
					return bindings.text_geometry(...args);
				},
				curve_path() {
					throw new Error('unexpected JS curve callback');
				},
				spline_geometry() {
					throw new Error('unexpected JS spline callback');
				},
				intersect_pairs() {
					throw new Error('unexpected intersection callback');
				},
			})
		);
		for (const f of fixture.cases.filter(c => c.name.startsWith('rectangle/') || c.name.startsWith('curve/'))) {
			const { options, curve } = hydrate(f),
				before = calls;
			generateTextSvgPathData(options, fonts[f.font], curve);
			assert.equal(calls, before + 1);
		}
	} finally {
		setGeometryKernel(previous);
	}
});

test('repeated glyph outlines are extracted once per request without retaining a font cache between requests', () => {
	const glyph = fonts.synthetic.charToGlyph('A'),
		original = glyph.getPath;
	let calls = 0;
	try {
		glyph.getPath = function (...args) {
			calls++;
			return original.apply(this, args);
		};
		const { options } = hydrate(fixture.cases[0]);
		options.text = 'AAAA\nAA';
		const first = prepareTextGlyphs(options, fonts.synthetic)!;
		assert.equal(calls, 1);
		assert.equal(first.glyphs[0].commands, first.glyphs[5].commands);
		const second = prepareTextGlyphs(options, fonts.synthetic)!;
		assert.equal(calls, 2);
		assert.notEqual(first.glyphs[0].commands, second.glyphs[0].commands);
	} finally {
		glyph.getPath = original;
	}
});

const simple: TextGeometryInput = {
	mode: 'text',
	height: 10,
	unitsPerEm: 1000,
	ascender: 800,
	descender: -200,
	capHeight: 700,
	characterSpacing: 0,
	alignment: 'left',
	verticalAlignment: 'middle',
	placement: 'above',
	fitToPath: false,
	flipHorizontal: false,
	flipVertical: false,
	svg: false,
	lineCount: 1,
	glyphs: [
		{
			line: 0,
			advance: 600,
			commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Q', x1: 1, y1: 2, x: 3, y: 4 }, { type: 'Z' }],
		},
	],
	rectangle: [new Vec2(0, 20), new Vec2(40, 20), new Vec2(40, 0), new Vec2(0, 0)],
};
test('below placement touches the capital line for real fonts and both coordinate systems', () => {
	const line = { id: 'cap-line', type: 'segment' as const, p1: new Vec2(0, 0), p2: new Vec2(100, 0) };
	for (const font of [fonts.arial, fonts.times, fonts.courier])
		for (const height of [3, 10])
			for (const flipHorizontal of [false, true])
				for (const flipVertical of [false, true])
					for (const coordSystem of ['cad', 'svg'] as const) {
						const options = {
							mode: 'text_on_path' as const,
							text: 'HHH',
							height,
							characterSpacing: 10,
							placement: 'below' as const,
							fitToPath: true,
							alignment: 'center' as const,
							flipHorizontal,
							flipVertical,
							coordSystem,
						};
						const result = generateTextSvgPathData(options, font, line);
						const coordinates = result.match(/[-+]?(?:\d*\.)?\d+/g)!.map(Number);
						const y = coordinates.filter((_, i) => i % 2 === 1).map(v => (coordSystem === 'svg' ? -v : v));
						assert.ok(Math.abs(Math.max(...y)) < 1e-12, 'capital line or vertically flipped baseline touches the path');
						const cap = font.charToGlyph('H').getBoundingBox().y2 * (height / font.unitsPerEm);
						assert.ok(Math.abs(Math.min(...y) + cap) <= 0.005001, 'glyph height and the below side remain unchanged');
					}
});

test('overlong spline text retains signed alignment and continues along endpoint tangents', { skip: !native }, () => {
	const curves = [
		{
			id: 'forward',
			type: 'spline' as const,
			bezierSegments: [[new Vec2(0, 0), new Vec2(10, 0), new Vec2(20, 0), new Vec2(30, 0)]],
		},
		{
			id: 'reverse',
			type: 'spline' as const,
			bezierSegments: [[new Vec2(30, 0), new Vec2(20, 0), new Vec2(10, 0), new Vec2(0, 0)]],
		},
		{
			id: 'curved',
			type: 'spline' as const,
			bezierSegments: [[new Vec2(0, 0), new Vec2(10, 15), new Vec2(20, -15), new Vec2(30, 0)]],
		},
	];
	for (const curve of curves) {
		const path = createPathEvaluator(curve as any),
			count = Math.ceil(path.length / 6) + 4,
			width = count * 6;
		for (const alignment of ['left', 'center', 'right'] as const)
			for (const flipHorizontal of [false, true])
				for (const svg of [false, true]) {
					const start =
						alignment === 'right' ? path.length - width : alignment === 'center' ? (path.length - width) / 2 : 0;
					const input: TextGeometryInput = {
						...simple,
						mode: 'text_on_path',
						curve: curve as any,
						rectangle: undefined,
						alignment,
						flipHorizontal,
						svg,
						placement: 'below',
						flipVertical: true,
						glyphs: Array.from({ length: count }, () => ({
							line: 0,
							advance: 600,
							commands: [
								{ type: 'M' as const, x: 0, y: 0 },
								{ type: 'L' as const, x: 6, y: 0 },
							],
						})),
					};
					const commands = getGeometryKernel().textGeometry!(input);
					for (let i = 0; i < count; i++) {
						const mid = i * 6 + 3,
							distance = flipHorizontal ? start + width - mid : start + mid;
						const edge = Math.max(0, Math.min(path.length, distance));
						const frame = path.getSampleAtDistance(edge),
							expected = frame.point.clone().addScaledVector(frame.tangent, distance - edge);
						const a = commands[i * 2] as { x: number; y: number },
							b = commands[i * 2 + 1] as { x: number; y: number };
						const actual = new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2);
						if (svg) actual.y = -actual.y;
						assert.ok(
							actual.distanceTo(expected) < 1e-8,
							`${curve.id}/${alignment}/${flipHorizontal}/${i}: glyph frame preserves its distance`
						);
					}
				}
	}
});

test('text adapter validates command order, complete coordinates, trailing data and native failures', () => {
	for (const values of [[0], [0, NaN, 0], [5, 0, 0], [1, 0, 0], [0, 1, 7, 2, 2, 3], [0, 1, 7, 2, 2, 3, 4, 5, 4, 0]])
		assert.throws(() => createWasmTextGeometry(() => new Float64Array(values))(simple), /WASM text/);
	const expected = [0, 1, 7, 2, 2, 9, 4, 11, 4];
	assert.equal(createWasmTextGeometry(() => new Float64Array(expected))(simple).length, 3);
	assert.deepEqual(createWasmTextGeometry(() => new Float64Array())(simple), []);
	assert.throws(
		() =>
			createWasmTextGeometry(() => {
				throw new Error('native text failure');
			})(simple),
		/native text failure/
	);
	for (const height of [NaN, Infinity])
		assert.throws(
			() =>
				createWasmTextGeometry(() => {
					throw new Error('unexpected call');
				})({ ...simple, height }),
			/Non-finite text/
		);
});

test('compiled text decoder validates flags, counts, outline arity and geometry', { skip: !native }, async () => {
	const bindings = await import('../public/kernel/sketcher_wasm.js');
	const query = bindings.text_geometry;
	const settings = [0, 10, 1000, 800, -200, 700, 0, 0, 1, 0, 1],
		glyphs = new Float64Array([0, 600, 1]);
	const outlines = new Float64Array([0, 0, 0]),
		rectangle = new Float64Array([0, 20, 40, 20, 40, 0, 0, 0]);
	for (const [index, value] of [
		[0, 2],
		[2, 0],
		[7, 3],
		[8, -1],
		[9, 32],
		[10, 0],
		[1, Infinity],
	]) {
		const bad = [...settings];
		bad[index] = value;
		assert.throws(() => query(glyphs, outlines, rectangle, new Float64Array(bad)), /text/);
	}
	for (const bad of [[0], [0, 600, 2], [1, 600, 1], [0, NaN, 1]])
		assert.throws(() => query(new Float64Array(bad), outlines, rectangle, new Float64Array(settings)), /text/);
	for (const bad of [[9], [0], [2, 0, 0], [0, 0, 0, 4]])
		assert.throws(() => query(glyphs, new Float64Array(bad), rectangle, new Float64Array(settings)), /text/);
	assert.throws(() => query(glyphs, outlines, new Float64Array(), new Float64Array(settings)), /text/);
	assert.throws(() => query(glyphs, outlines, new Float64Array(), new Float64Array([1, ...settings.slice(1)])), /text/);
	assert.throws(() => createWasmGeometryKernel({ ...bindings, text_geometry: undefined as any }), /no text geometry/);
});

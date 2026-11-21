import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmTracePostprocess } from '../src/kernel/tracePostprocessWasm';
import { loadTracePostprocessKernel } from '../src/kernel/imageTraceLoader';
import { buildTraceGeometry } from '../src/model/imageTrace/build';
import { applyTraceRelations } from './helpers/tracePostprocessCases';
import { SketchDocument } from '../src/model/sketch';
import { DEFAULT_TRACE_SETTINGS, cloneTraceSettings } from '../src/model/imageTrace/types';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelTracePostprocess.json', import.meta.url), 'utf8'));
const traceFixture = JSON.parse(readFileSync(new URL('./fixtures/kernelImageTrace.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().tracePostprocess;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function compare(a: any, b: any, path = '', tolerance = 1e-10) {
	if (typeof b === 'number')
		assert.ok(Object.is(a, b) || Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${path}: ${a} != ${b}`);
	else if (b && typeof b === 'object') {
		assert.deepEqual(Object.keys(a), Object.keys(b), path);
		for (const key of Object.keys(b)) compare(a[key], b[key], path + '/' + key, tolerance);
	} else assert.deepEqual(a, b, path);
}
for (const [i, f] of fixture.placements.entries())
	test(`trace placement preserves original coordinates and winding ${i}`, { skip: !native }, () => {
		const before = plain(f.input);
		compare(plain(native!.place(f.input)), f.expected);
		assert.deepEqual(f.input, before);
	});
for (const [i, f] of fixture.relations.entries())
	test(`trace relation grouping and rejection feedback preserve order ${i}`, { skip: !native }, () => {
		const before = plain(f.input);
		assert.deepEqual(applyTraceRelations(f.input, native!), f.expected);
		assert.deepEqual(native!.relations(f.input), f.expected);
		assert.deepEqual(f.input, before);
	});
for (const [i, f] of fixture.displacements.entries())
	test(`trace displacement keeps strict threshold ${i}`, { skip: !native }, () =>
		assert.deepEqual(native!.moved(f.original, f.current, f.threshold), f.expected)
	);

const sources = [
	traceFixture.cases.find((f: any) => f.shape === 'rectangle'),
	traceFixture.cases.find((f: any) => f.shape === 'ring'),
	traceFixture.cases.find((f: any) => f.shape === 'junction' && f.settings.mode === 'centerline'),
	traceFixture.cases.find((f: any) => f.shape === 'wave' && f.settings.mode === 'centerline'),
	traceFixture.cases.find((f: any) => f.shape === 'ellipse' && f.settings.useSplines),
	traceFixture.cases.find((f: any) => f.shape === 'disk'),
];

test('an independently loaded Rust postprocessor works when the kernel omits tracePostprocess', {
	skip: !native,
}, async () => {
	const previous = getGeometryKernel();
	const doc = new SketchDocument();
	const image = doc.addImage({
		fileName: 'trace.png',
		x: 0,
		y: 0,
		width: 80,
		height: 64,
		angle: 0,
		opacity: 1,
	});
	doc.clearHistory();
	const before = doc.takeSnapshot();
	const result = { ...structuredClone(sources[0].expected), elapsedMs: 0 };
	const settings = cloneTraceSettings(DEFAULT_TRACE_SETTINGS);
	try {
		setGeometryKernel({ ...previous, tracePostprocess: undefined });
		assert.throws(() => buildTraceGeometry(doc, result, image, settings), /requires the Rust\/WASM kernel/);
		assert.deepEqual(doc.takeSnapshot(), before);
		assert.equal(doc.canUndo(), false);
		const kernel = await loadTracePostprocessKernel(new URL('../public/kernel/sketcher_wasm.js', import.meta.url).href);
		compare(plain(kernel.place(fixture.placements[0].input)), fixture.placements[0].expected);
		assert.equal(buildTraceGeometry(doc, result, image, settings, kernel).entities.length, result.stats.lines);
	} finally {
		setGeometryKernel(previous);
	}
});

for (const source of sources)
	for (const angle of [0, 27.5, -90])
		for (const allRelations of [false, true])
			test(`trace build keeps geometry, image action and history: ${source.name}/${angle}/${allRelations}`, {
				skip: !native,
			}, () => {
				const settings = {
					...cloneTraceSettings(source.settings),
					angleTolerance: 3,
					afterConvert: (angle === 0 ? 'keep' : angle > 0 ? 'dim' : 'delete') as 'keep' | 'dim' | 'delete',
				};
				if (allRelations)
					settings.constraints = {
						tangent: true,
						horizontalVertical: true,
						parallelPerpendicular: true,
						equal: true,
						concentric: true,
					};
				const doc = new SketchDocument();
				const image = doc.addImage({
					fileName: 'trace.png',
					x: 13,
					y: -21,
					width: source.expected.width * 0.7,
					height: source.expected.height * 0.7,
					angle,
					opacity: 1,
				});
				doc.clearHistory();
				const snapshot = () => {
					const state = doc.takeSnapshot();
					return { ...state, constraints: state.constraints.sort((a, b) => a.id.localeCompare(b.id)) };
				};
				const before = snapshot();
				const result = { ...structuredClone(source.expected), elapsedMs: 0 };
				const built = buildTraceGeometry(doc, result, image, settings);
				assert.deepEqual(result, { ...source.expected, elapsedMs: 0 });
				assert.deepEqual(
					{
						lines: built.entities.filter(x => x.type === 'line').length,
						arcs: doc.arcs.size,
						circles: doc.circles.size,
						splines: doc.splines.size,
					},
					result.stats
				);
				assert.equal(doc.images.get(image.id)?.opacity, angle === 0 ? 1 : angle > 0 ? 0.3 : undefined);
				const converted = snapshot();
				assert.equal(doc.undo(), true);
				assert.deepEqual(snapshot(), before);
				assert.equal(doc.redo(), true);
				compare(plain(snapshot()), plain(converted), 'redo', 1e-8);
			});

test('trace build uses one placement query and grouped inference', { skip: !native }, () => {
	const previous = getGeometryKernel(),
		source = sources[0],
		doc = new SketchDocument();
	const image = doc.addImage({
		id: 'Image-1',
		fileName: 'trace.png',
		x: 0,
		y: 0,
		width: 80,
		height: 64,
		angle: 0,
		opacity: 1,
	});
	let placements = 0,
		relations = 0,
		displacements = 0;
	try {
		setGeometryKernel({
			...previous,
			tracePostprocess: {
				place(input) {
					placements++;
					return native!.place(input);
				},
				relations(input) {
					relations++;
					return native!.relations(input);
				},
				moved(a, b, t) {
					displacements++;
					return native!.moved(a, b, t);
				},
			},
		});
		const before = plain(source.expected);
		buildTraceGeometry(
			doc,
			{ ...structuredClone(source.expected), elapsedMs: 0 },
			image,
			cloneTraceSettings(DEFAULT_TRACE_SETTINGS)
		);
		assert.equal(placements, 1);
		assert.equal(relations, 1);
		assert.ok(displacements >= 1);
		assert.deepEqual(plain(source.expected), before);
	} finally {
		setGeometryKernel(previous);
	}
});
for (const operation of ['place', 'relations', 'moved'] as const)
	test(`trace postprocess ${operation} failure rolls back geometry and history`, { skip: !native }, () => {
		const previous = getGeometryKernel(),
			doc = new SketchDocument(),
			source = sources[0],
			image = doc.addImage({
				id: 'Image-1',
				fileName: 'trace.png',
				x: 0,
				y: 0,
				width: 80,
				height: 64,
				angle: 0,
				opacity: 1,
			});
		doc.clearHistory();
		const before = plain(doc.takeSnapshot());
		try {
			setGeometryKernel({
				...previous,
				tracePostprocess: {
					...native!,
					[operation]() {
						throw Error('native failure');
					},
				},
			});
			assert.throws(
				() =>
					buildTraceGeometry(
						doc,
						{ ...structuredClone(source.expected), elapsedMs: 0 },
						image,
						cloneTraceSettings(DEFAULT_TRACE_SETTINGS)
					),
				/native failure/
			);
			assert.equal(doc.isInTransaction(), false);
			assert.deepEqual(plain(doc.takeSnapshot()), before);
			assert.equal(doc.undo(), false);
		} finally {
			setGeometryKernel(previous);
		}
	});
test('trace postprocess rejects malformed native packets and outputs', { skip: !native }, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (mode: number, data: number[], settings: number[]) =>
		wasm.trace_postprocess(mode, new Float64Array(data), new Float64Array(settings));
	for (const [mode, data, settings] of [
		[99, [], []],
		[0, [], []],
		[0, [], [80, 64, 1, 0, 0, 80, 64, 0, 1e20, 0, 0]],
		[0, [0, 0], [0, 64, 1, 0, 0, 80, 64, 0, 1, 0, 0]],
		[0, [0, 0, 0, 0, 2], [80, 64, 1, 0, 0, 80, 64, 0, 1, 0, 1]],
		[1, [], [0, 0, 3, 1, 1, 16, 0, 0]],
		[1, [2, 0, 0, 1, 1], [1, 0, 3, 1, 1, 0, 0, 0]],
		[1, [], [1e20, 0, 3, 1, 1, 0, 0, 0]],
		[2, [NaN, 0, 0, 0], [1]],
		[2, [0, 0, 1], [1]],
		[2, [], []],
	] as Array<[number, number[], number[]]>)
		assert.throws(() => call(mode, data, settings));
	assert.throws(() => createWasmTracePostprocess(() => new Float64Array()).place(fixture.placements[0].input));
	assert.throws(() =>
		createWasmTracePostprocess(() => new Float64Array([0, 1, 0, 0, 0, 0, 0, 0])).relations(fixture.relations[0].input)
	);
	for (const out of [[1], [0, 0], [-1], [NaN]])
		assert.throws(() =>
			createWasmTracePostprocess(() => new Float64Array(out)).moved([{ x: 0, y: 0 }], [{ x: 1, y: 1 }], 0)
		);
	assert.throws(
		() =>
			createWasmTracePostprocess(() => {
				throw Error('native failure');
			}).moved([], [], 1),
		/native failure/
	);
});

test('excessive displacement drops inferred constraints and restores the traced shape', { skip: !native }, () => {
	const settings = {
		...cloneTraceSettings(DEFAULT_TRACE_SETTINGS),
		tolerance: 1e-5,
		angleTolerance: 30,
		constraints: {
			tangent: false,
			horizontalVertical: true,
			parallelPerpendicular: false,
			equal: false,
			concentric: false,
		},
	};
	const result = {
		width: 80,
		height: 64,
		yScale: 1,
		threshold: 128,
		vertices: [
			{ x: 0, y: 0 },
			{ x: 20, y: 4 },
			{ x: 40, y: 0 },
		],
		paths: [
			{
				segments: [
					{ kind: 'line' as const, a: 0, b: 1 },
					{ kind: 'line' as const, a: 1, b: 2 },
				],
				closed: false,
				tangent: [false, false],
			},
		],
		circles: [],
		closedSplines: [],
		stats: { lines: 2, arcs: 0, circles: 0, splines: 0 },
		elapsedMs: 0,
	};
	const make = () => {
		const doc = new SketchDocument(),
			image = doc.addImage({
				id: 'Image-1',
				fileName: 'trace.png',
				x: 0,
				y: 0,
				width: 80,
				height: 64,
				angle: 0,
				opacity: 1,
			});
		doc.clearHistory();
		return { doc, image };
	};
	const { doc, image } = make();
	const actual = buildTraceGeometry(doc, result, image, settings);
	assert.equal(actual.constraints.dropped, 2);
	assert.equal(actual.constraints.added, 0);
	const points = [...doc.points.values()];
	compare(
		points.map(p => ({ x: p.x, y: p.y })),
		[
			{ x: -40, y: 32 },
			{ x: -20, y: 28 },
			{ x: 0, y: 32 },
		]
	);
});

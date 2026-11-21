import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { createWasmTransform } from '../src/kernel/transformWasm';
import { createWasmConstraintErrors } from '../src/kernel/inspectionWasm';
import { transformGeometry } from '../src/math/transform';
import { applyTransform, createTransform, getTransformSelection } from '../src/model/transform';
import { prepareTransformPreview } from '../src/model/transformPreview';
import { constraintMaxErrors } from '../src/solver/constraintMaxErrors';
import { SketchDocument } from '../src/model/sketch';
import {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
	SketchText,
} from '../src/model/types';
import { DistanceConstraint, HorizontalConstraint, OffsetConstraint } from '../src/solver/constraints';
import { Vec2 } from '../src/math/vector';
import { Viewport } from '../src/canvas/viewport';
import { renderTransformPreview } from '../src/canvas/modifyPreviews';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelTransform.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().transform;
function compare(actual: any, expected: any, path = '', tolerance = 1e-12) {
	if (typeof expected === 'number') {
		assert.ok(
			Object.is(actual, expected) || Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
			`${path}: ${actual} != ${expected}`
		);
	} else if (expected && typeof expected === 'object') {
		assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
		for (const key of Object.keys(expected)) compare(actual[key], expected[key], path + '/' + key, tolerance);
	} else assert.deepEqual(actual, expected, path);
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function affinePoint(center: Vec2, values: { x: number; y: number; angle: number; scale: number }, p: { x: number; y: number }) {
	const rad = (values.angle * Math.PI) / 180;
	const c = Math.cos(rad),
		s = Math.sin(rad);
	const dx = (p.x - center.x) * values.scale,
		dy = (p.y - center.y) * values.scale;
	return new Vec2(center.x + dx * c - dy * s + values.x, center.y + dx * s + dy * c + values.y);
}

for (const f of fixture.cases)
	test(`batch transform preserves original math: ${f.name}`, () => {
		const input = plain(f.input),
			before = plain(input);
		compare(transformGeometry(input), f.expected, 'active');
		assert.deepEqual(input, before);
		const transform = createTransform(Vec2.from(input.center), {
			...input.translation,
			angle: input.angleDegrees,
			scale: input.scale,
		});
		input.points.forEach((p: any, i: number) => compare(plain(transform.point(p)), f.expected.points[i]));
		input.vectors.forEach((p: any, i: number) => compare(plain(transform.rotate(p)), f.expected.vectors[i]));
	});

function mixedSketch() {
	const doc = new SketchDocument();
	const add = (id: string, x: number, y: number) => {
		doc.points.set(id, new SketchPoint(id, x, y));
		return id;
	};
	const a = add('p1', 0, 0),
		b = add('p2', 10, 0),
		c = add('p3', 0, 10),
		center = add('center', 0, 0);
	const major = add('major', 16, 0),
		minor = add('minor', 0, 6);
	doc.lines.set('line', new SketchLine({ id: 'line', p1Id: a, p2Id: b, lineType: 'solid' }));
	doc.circles.set('circle', new SketchCircle({ id: 'circle', centerId: center, radius: 10 }));
	doc.arcs.set(
		'arc',
		new SketchArc({ id: 'arc', centerId: center, startPointId: a, endPointId: c, radius: 10, clockwise: true })
	);
	doc.ellipses.set('ellipse', new SketchEllipse('ellipse', center, major, minor));
	doc.ellipticalArcs.set('ellarc', new SketchEllipticalArc('ellarc', center, major, minor, major, minor, true));
	const fitIds = [add('f1', 20, 0), add('f2', 30, 12), add('f3', 40, 2)];
	const offsetIds = [add('o1', 20, 3), add('o2', 30, 15), add('o3', 40, 5)];
	doc.splines.set('fit', new SketchSpline('fit', 'fit', fitIds));
	doc.splines.set('offset', new SketchSpline('offset', 'fit', offsetIds));
	const controlIds = [add('s1', -20, 0), add('s2', -18, 10), add('s3', -8, -2), add('s4', -5, 4)];
	doc.splines.set('control', new SketchSpline('control', 'control', controlIds));
	doc.texts.set(
		'text',
		new SketchText({
			id: 'text',
			mode: 'text_on_path',
			text: 'Test',
			targetPrimitiveId: 'fit',
			targetPrimitiveType: 'spline',
			height: 5,
		})
	);
	doc.constraints.set('h', new HorizontalConstraint('h', a, b));
	doc.constraints.set('d', new DistanceConstraint('d', a, b, 10));
	doc.constraints.set(
		'offset-dim',
		new OffsetConstraint(
			'offset-dim',
			[
				{
					kind: 'spline',
					origSplineId: 'fit',
					offSplineId: 'offset',
					points: offsetIds.map((id, i) => ({
						pointId: id,
						basePos: doc.points.get(fitIds[i])!.clone(),
						normal: { x: 0, y: 1 },
						side: 1,
					})),
				},
			],
			3
		)
	);
	doc.rebuildParamManager();
	doc.clearHistory();
	return doc;
}
function selectAll(doc: SketchDocument) {
	doc.selectEntities(
		[...Array.from(doc.getCurvePrimitives(), p => ({ id: p.id, type: p.type })), ...doc.texts.values()].map(p => ({
			id: p.id,
			type: p.type,
		}))
	);
	return getTransformSelection(doc)!;
}
for (const source of [
	'mixed',
	'offset-pattern-line11',
	'offset-rectangle-reference-distance',
	'offset-polygon-source-dimension',
]) {
	for (const copy of [false, true])
		for (const values of [
			{ x: 7, y: -3, angle: 0, scale: 1 },
			{ x: 0, y: 0, angle: 27.5, scale: 1 },
			{ x: 5, y: 9, angle: -90, scale: 1.5 },
		]) {
			test(`document transform preserves constraints, IDs, selection and history: ${source}/${copy}/${values.angle}/${values.scale}`, () => {
				const doc = (() => {
					if (source === 'mixed') return mixedSketch();
					const d = new SketchDocument();
					d.restoreSnapshot(JSON.parse(readFileSync(new URL(`./fixtures/${source}.json`, import.meta.url), 'utf8')));
					d.clearHistory();
					return d;
				})();
				const selection = selectAll(doc);
				const normalized = () => {
					const state = plain(doc.takeSnapshot());
					state.constraints.sort((a: any, b: any) => a.id.localeCompare(b.id));
					return state;
				};
				const before = normalized();
				const beforePointCount = doc.points.size;
				const beforeSelectedLines = new Set(doc.selection.lineIds);
				const removed = applyTransform(doc, selection, values, copy);
				assert.ok(Number.isInteger(removed) && removed >= 0);
				if (copy) {
					assert.ok(doc.points.size > beforePointCount);
					for (const id of beforeSelectedLines) assert.ok(!doc.selection.lineIds.has(id));
				} else {
					assert.equal(doc.points.size, beforePointCount);
					assert.deepEqual([...doc.selection.lineIds], [...beforeSelectedLines]);
				}
				if (source === 'mixed' && values.angle === 0 && values.scale === 1) {
					assert.equal(removed, 0);
				}
				const after = normalized();
				assert.equal(doc.undo(), true);
				const undone = normalized();
				assert.equal(undone.points.length, before.points.length);
				assert.deepEqual(
					undone.points.map((p: any) => p.id),
					before.points.map((p: any) => p.id)
				);
				if (source !== 'mixed') compare(undone, before, 'undo', 1e-4);
				assert.equal(doc.redo(), true);
				const redone = normalized();
				assert.equal(redone.points.length, after.points.length);
				assert.deepEqual(
					redone.points.map((p: any) => p.id),
					after.points.map((p: any) => p.id)
				);
				if (source !== 'mixed') {
					compare(redone, after, 'redo', 1e-4);
					assert.equal(doc.undo(), true);
					compare(normalized(), undone, 'second-undo', 1e-4);
				}
			});
		}
}

test('one apply batches geometry and all before/after constraint errors', { skip: !native }, () => {
	const previous = getGeometryKernel(),
		doc = mixedSketch(),
		selection = selectAll(doc);
	let calls = 0,
		checks = 0;
	try {
		setGeometryKernel({
			...previous,
			transform(input) {
				calls++;
				assert.ok(input.vectors.length);
				assert.ok(input.sizes.length);
				return native!(input);
			},
			constraintErrors(input) {
				checks++;
				return previous.constraintErrors!(input);
			},
		});
		applyTransform(doc, selection, { x: 5, y: 7, angle: 30, scale: 1 }, true);
		assert.equal(calls, 1);
		assert.equal(checks, 1);
	} finally {
		setGeometryKernel(previous);
	}
});

test('preview batches fit and control spline controls and reuses their curve snapshots', { skip: !native }, () => {
	const previous = getGeometryKernel(),
		doc = mixedSketch(),
		selection = selectAll(doc),
		values = { x: 5, y: 7, angle: 30, scale: 1.5 };
	const expected = { point: (p: { x: number; y: number }) => affinePoint(selection.center, values, p) };
	let calls = 0;
	try {
		setGeometryKernel({
			...previous,
			transform(input) {
				calls++;
				return native!(input);
			},
		});
		const prepared = prepareTransformPreview(doc, selection.previewIds, selection.center, values);
		assert.equal(calls, 1);
		for (const id of selection.previewIds) {
			const primitive = doc.getPrimitive(id);
			if (!primitive) continue;
			if (primitive.type === 'spline') {
				assert.ok(prepared.geometries.has(id));
				const geometry = prepared.geometries.get(id)!;
				if (geometry.type === 'spline')
					for (const segment of geometry.bezierSegments)
						for (const p of segment) compare(plain(prepared.point(p.x, p.y)), plain(expected.point(p)));
			}
			primitive.renderTransformed({
				sketch: doc,
				viewport: new Viewport(),
				geometry: prepared.geometries.get(id),
				transformPoint: prepared.point,
			});
		}
		assert.equal(calls, 1);
		const point = doc.points.get('f2')!;
		point.y += 10;
		const next = prepareTransformPreview(doc, selection.previewIds, selection.center, values);
		compare(plain(next.point(point.x, point.y)), plain(expected.point(point)));
		assert.equal(calls, 2);
	} finally {
		setGeometryKernel(previous);
	}
});

test('native maximum residuals retain grouping, weights and callback compatibility', () => {
	const params = new Map([
		['a.x', 0],
		['a.y', 0],
		['b.x', 10],
		['b.y', 2],
	]);
	const checks = [new HorizontalConstraint('h', 'a', 'b'), new DistanceConstraint('d', 'a', 'b', 10)];
	for (const weight of [0, -3, 1e-8, 1e8])
		for (const c of checks) {
			c.weight = weight;
			const expected = c.evaluate(params).reduce((max, r) => Math.max(max, Math.abs(r)), 0) / (Math.abs(weight) || 1);
			compare(constraintMaxErrors([{ constraint: c, values: params }])[0], expected);
		}
	let calls = 0;
	checks[0].evaluate = () => {
		calls++;
		return [3, 4];
	};
	checks[0].weight = 2;
	assert.equal(constraintMaxErrors([{ constraint: checks[0], values: params }])[0], 2);
	assert.equal(calls, 1);
});

test('native failures and overflow do not commit geometry or history', { skip: !native }, () => {
	const previous = getGeometryKernel();
	for (const operation of ['transform', 'constraintErrors'] as const) {
		const doc = new SketchDocument();
		const a = doc.addPoint({ x: 0, y: 0 }),
			b = doc.addPoint({ x: 10, y: 0 });
		doc.addLine(a.id, b.id);
		doc.addDistanceConstraint(a.id, b.id, 10);
		doc.addHorizontalConstraint(a.id, b.id);
		doc.clearHistory();
		const selection = selectAll(doc),
			before = plain(doc.takeSnapshot());
		try {
			setGeometryKernel({
				...previous,
				[operation]() {
					throw Error('native failure');
				},
			});
			assert.throws(() => applyTransform(doc, selection, { x: 1, y: 2, angle: 0, scale: 1 }, true), /native failure/);
			compare(plain(doc.takeSnapshot()), before);
			assert.equal(doc.undo(), false);
		} finally {
			setGeometryKernel(previous);
		}
	}
	const doc = mixedSketch(),
		selection = selectAll(doc),
		before = plain(doc.takeSnapshot());
	assert.throws(() => applyTransform(doc, selection, { x: 1e308, y: 0, angle: 0, scale: 1e308 }, true), /too large/);
	compare(plain(doc.takeSnapshot()), before);
	assert.equal(doc.undo(), false);
});

test('transform and maximum-error adapters reject malformed packets and preserve native errors', {
	skip: !native,
}, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (data: number[], settings: number[]) =>
		wasm.transform_geometry(new Float64Array(data), new Float64Array(settings));
	for (const [data, settings] of [
		[[], []],
		[[], [0, 0, 0, 0, 0, 1, 1e20, 0, 0]],
		[[], [0, 0, 0, 0, 0, 1, -1, 0, 0]],
		[[0], [0, 0, 0, 0, 0, 1, 1, 0, 0]],
		[
			[NaN, 0],
			[0, 0, 0, 0, 0, 1, 1, 0, 0],
		],
		[[], [0, 0, 0, 0, 0, NaN, 0, 0, 0]],
	] as number[][][])
		assert.throws(() => call(data, settings));
	const input = fixture.cases[0].input;
	assert.throws(() => createWasmTransform(() => new Float64Array())(input), /Invalid WASM/);
	assert.throws(
		() =>
			createWasmTransform(() => {
				throw Error('native failure');
			})(input),
		/native failure/
	);
	assert.throws(
		() =>
			createWasmConstraintErrors(() => new Float64Array())({
				nativeConstraints: new Float64Array(),
				rowCounts: [0],
				weights: [1],
			}),
		/Invalid WASM/
	);
	assert.throws(() => wasm.constraint_max_errors(new Float64Array(), new Float64Array([1e20]), new Float64Array([1])));
	assert.throws(() => wasm.constraint_max_errors(new Float64Array(), new Float64Array([0]), new Float64Array()));
});

test('custom constraint overrides evaluate via JS residual callback during transform', () => {
	const previous = getGeometryKernel(),
		doc = new SketchDocument();
	const a = doc.addPoint({ x: 0, y: 0 }),
		b = doc.addPoint({ x: 10, y: 0 }),
		line = doc.addLine(a.id, b.id);
	const horizontal = doc.addHorizontalConstraint(a.id, b.id);
	let calls = 0;
	class CustomHorizontal extends HorizontalConstraint {
		override evaluate(values: Map<string, number>) {
			calls++;
			return super.evaluate(values);
		}
	}
	doc.constraints.set(horizontal.id, new CustomHorizontal(horizontal.id, a.id, b.id));
	doc.selectEntity(line.id, 'line');
	try {
		setGeometryKernel({
			...previous,
			constraintErrors() {
				throw Error('custom formula must evaluate via JS residual callback');
			},
		});
		assert.equal(applyTransform(doc, getTransformSelection(doc)!, { x: 3, y: 2, angle: 0, scale: 1 }, false), 0);
		assert.equal(a.x, 3);
		assert.equal(b.x, 13);
		assert.ok(calls >= 2);
	} finally {
		setGeometryKernel(previous);
	}
});

test('native maximum errors keep NaN propagation and zero-row groups', { skip: !native }, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (data: number[], groups: number[], weights: number[]) =>
		Array.from(wasm.constraint_max_errors(new Float64Array(data), new Float64Array(groups), new Float64Array(weights)));
	assert.deepEqual(call([0, 0, 0, -2, 0, 0, 2, -1, 3, -1, 4], [0, 2, 0], [1, -2, 0]), [0, 4, 0]);
	assert.ok(Number.isNaN(call([0, 0, 0, 0, -1e308, 0, 2, -1, 1e308, -1, 0], [2], [0])[0]));
});

test('full preview uses one native transform and draws the same paths as the original callback', {
	skip: !native,
}, async () => {
	const { renderTransformedObjects } = await import('../src/canvas/modifyPreviews');
	class Element {
		attributes: Record<string, string> = {};
		children: Element[] = [];
		style = {};
		constructor(readonly tag: string) {}
		setAttribute(key: string, value: unknown) {
			this.attributes[key] = String(value);
		}
		appendChild(child: Element) {
			this.children.push(child);
			return child;
		}
	}
	const doc = mixedSketch(),
		selection = selectAll(doc),
		viewport = new Viewport(),
		values = { x: 5, y: 7, angle: 27.5, scale: 1.5 };
	const previous = getGeometryKernel(),
		previousDocument = globalThis.document;
	let calls = 0,
		overlays = 0;
	try {
		globalThis.document = { createElementNS: (_ns: string, tag: string) => new Element(tag) } as unknown as Document;
		setGeometryKernel({
			...previous,
			transform(input) {
				calls++;
				return native!(input);
			},
		});
		const target = new Element('g');
		renderTransformPreview(
			doc,
			viewport,
			selection.previewIds,
			selection.center,
			values,
			target as unknown as SVGGElement,
			'#abc',
			() => {
				overlays++;
			}
		);
		assert.equal(calls, 1);
		assert.equal(overlays, 1);
		const reference = new Element('g');
		renderTransformedObjects(doc, viewport, selection.previewIds, (x, y) => affinePoint(selection.center, values, { x, y }), {
			targetGroup: reference as unknown as SVGGElement,
			baseColor: '#abc',
			transformScale: values.scale,
			drawVertices: true,
		});
		assert.deepEqual(plain(target.children.slice(0, -1)), plain(reference.children));
	} finally {
		globalThis.document = previousDocument;
		setGeometryKernel(previous);
	}
});

test('batched maximum errors match independent pre-migration residual fixtures', { skip: !native }, async () => {
	const { deserializeConstraint } = await import('../src/solver/constraints/serialization');
	const { describeNativeConstraint, compileNativeConstraints } = await import('../src/solver/nativeConstraints');
	const entries: Array<{ constraint: any; values: Map<string, number> }> = [],
		expected: number[] = [];
	for (const file of [
		'kernelConstraints',
		'kernelAxisConstraints',
		'kernelCurvedConstraints',
		'kernelPatternConstraints',
		'kernelSplineConstraints',
	]) {
		const source = JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`, import.meta.url), 'utf8'));
		for (const f of source.cases) {
			if (f.kind === 'automatic') continue;
			const c = deserializeConstraint(f.constraint);
			if (!c || !describeNativeConstraint(c)) continue;
			const values = new Map<string, number>(Object.entries(f.params));
			if (compileNativeConstraints([c], values, new Map()).fallbackAll.length) continue;
			entries.push({ constraint: c, values });
			expected.push(
				f.expected.residuals.reduce((max: number, r: number) => Math.max(max, Math.abs(r)), 0) /
					(Math.abs(c.weight) || 1)
			);
		}
	}
	const previous = getGeometryKernel();
	let calls = 0;
	try {
		setGeometryKernel({
			...previous,
			constraintErrors(input) {
				calls++;
				return previous.constraintErrors!(input);
			},
		});
		const actual = constraintMaxErrors(entries);
		assert.ok(actual.length > 200);
		assert.equal(calls, 1);
		actual.forEach((value, i) => compare(value, expected[i], entries[i].constraint.type + '/' + i));
	} finally {
		setGeometryKernel(previous);
	}
});

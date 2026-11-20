import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { copyGeometry, patternDirections } from '../src/math/copyGeometry';
import { copyReference } from '../src/math/copyReference';
import { createWasmCopy } from '../src/kernel/copyWasm';
import { prepareCopies } from '../src/model/copyGeometry';
import { copyScene } from './helpers/copyScenes';
import * as active from '../src/model/patterns';
import * as original from '../src/model/patternsReference';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';
import { MirrorTool as OriginalMirror } from '../src/canvas/tools/modify/mirrorReference';
import { CircularPatternTool } from '../src/canvas/tools/modify/circularPattern';
import { RectangularPatternTool } from '../src/canvas/tools/modify/rectangularPattern';
import * as previews from '../src/canvas/modifyPreviews';
import * as originalPreviews from '../src/canvas/modifyPreviewsReference';
import { Viewport } from '../src/canvas/viewport';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kernelCopies.json', import.meta.url), 'utf8'));
const native = getGeometryKernel().copies;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function compare(a: any, b: any, path = '', tolerance = 1e-8) {
	if (typeof b === 'number')
		assert.ok(Object.is(a, b) || Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${path}: ${a} != ${b}`);
	else if (b && typeof b === 'object') {
		assert.deepEqual(Object.keys(a), Object.keys(b), path);
		for (const key of Object.keys(b)) compare(a[key], b[key], path + '/' + key, tolerance);
	} else assert.deepEqual(a, b, path);
}
test('copy fixtures identify independent pre-migration sources', () => {
	for (const [file, hash] of Object.entries(fixture.sourceHashes))
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL('../' + file, import.meta.url)))
				.digest('hex'),
			hash
		);
});
for (const [f, c] of fixture.cases.entries())
	test(`copy geometry retains old arithmetic: ${f}/${c.operation.type}`, () => {
		const input = plain({ points: fixture.points, operations: [c.operation] }),
			before = plain(input);
		compare(plain(copyReference(input.points, input.operations)[0]), c.expected, 'reference', 1e-12);
		compare(plain(copyGeometry(input.points, input.operations)[0]), c.expected, 'active', 1e-12);
		assert.deepEqual(input, before);
	});
const context = (doc: any) => ({ sketch: doc, showToast() {}, setTool() {}, requestRender() {} });
for (const axis of ['axis_x', 'axis_y', 'oblique'])
	test(`mirror preserves constraints, shared points, handles and winding: ${axis}`, () => {
		const left = copyScene(),
			right = copyScene();
		const setup = (s: typeof left) => {
			let id = axis;
			if (axis === 'oblique') {
				const a = s.doc.addPoint({ x: 2, y: 3 }),
					b = s.doc.addPoint({ x: 8, y: 14 });
				id = s.doc.addLine(a.id, b.id).id;
				s.doc.clearHistory();
			}
			return id;
		};
		const a = setup(left),
			b = setup(right);
		const actual = Object.assign(Object.create(MirrorTool.prototype), {
			ctx: context(left.doc),
			state: { selectedObjectIds: new Set(left.ids), mirrorLineId: a },
		});
		const expected = Object.assign(Object.create(OriginalMirror.prototype), {
			ctx: context(right.doc),
			state: { selectedObjectIds: new Set(right.ids), mirrorLineId: b },
		});
		assert.equal(actual.executeMirror(), expected.executeMirror());
		compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), axis);
		assert.deepEqual(
			left.doc.getSelectedPrimitives().map(p => p.id),
			right.doc.getSelectedPrimitives().map(p => p.id)
		);
		assert.equal(left.doc.undo(), right.doc.undo());
		compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'undo');
		assert.equal(left.doc.redo(), right.doc.redo());
		compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'redo');
	});
for (const distribution of ['full', 'partial', 'symmetric'] as const)
	test(`circular create/update/suppression preserves copies: ${distribution}`, () => {
		const left = copyScene(),
			right = copyScene();
		const build = (s: typeof left, api: typeof active) => {
			s.doc.beginTransaction();
			const copies = [1, 3].map(i => api.generateCircularPatternCopy(s.doc, 'origin', s.ids, i, 4, distribution, 725)!);
			const c = api.addCircularPatternConstraint(s.doc, 'origin', s.ids, distribution, 725, 4, true, [2], copies)!;
			s.doc.commitTransaction();
			return c;
		};
		const a = build(left, active),
			b = build(right, original);
		compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'create');
		for (const updates of [
			{ quantity: 5, totalAngle: -110, suppressedIndices: [1] },
			{ distribution: 'symmetric' as const, totalAngle: 270, suppression: false },
			{ quantity: 2 },
		]) {
			assert.equal(
				active.updateCircularPattern(left.doc, a.id, updates),
				original.updateCircularPattern(right.doc, b.id, updates)
			);
			compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'update');
		}
	});
for (const direction of ['one_direction', 'symmetric'] as const)
	test(`rectangular create/update/suppression preserves copies: ${direction}`, () => {
		const left = copyScene(),
			right = copyScene();
		const build = (s: typeof left, api: typeof active) => {
			s.doc.beginTransaction();
			const copies = [
				[0, 1],
				[1, 0],
				[1, 1],
			].map(
				([i, j]) =>
					api.generateRectangularPatternCopy(
						s.doc,
						s.ids,
						i,
						j,
						30,
						direction,
						-20,
						direction,
						{ x: 0.6, y: 0.8 },
						{ x: -0.8, y: 0.6 }
					)!
			);
			const c = api.addRectangularPatternConstraint(
				s.doc,
				s.ids,
				null,
				null,
				2,
				30,
				direction,
				2,
				-20,
				direction,
				false,
				[],
				copies
			)!;
			s.doc.commitTransaction();
			return c;
		};
		const a = build(left, active),
			b = build(right, original);
		compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'create');
		for (const updates of [
			{ quantity1: 3, distance1: 25, suppression: true, suppressedIndices: [1001] },
			{ quantity2: 3, direction2: 'symmetric' as const, suppression: false },
			{ distance1: 0 },
		]) {
			assert.equal(
				active.updateRectangularPattern(left.doc, a.id, updates),
				original.updateRectangularPattern(right.doc, b.id, updates)
			);
			compare(plain(left.doc.takeSnapshot()), plain(right.doc.takeSnapshot()), 'update');
		}
	});
test('tools batch all copies and keep source coordinates fresh', { skip: !native }, () => {
	const previous = getGeometryKernel();
	for (const kind of ['mirror', 'circular', 'rectangular']) {
		const { doc, ids } = copyScene();
		let calls = 0,
			geometryCalls = 0;
		try {
			setGeometryKernel({
				...previous,
				copies(points, ops) {
					calls++;
					if (points.length) geometryCalls++;
					return native!(points, ops);
				},
			});
			if (kind === 'mirror') {
				const tool = Object.assign(Object.create(MirrorTool.prototype), {
					ctx: context(doc),
					state: { selectedObjectIds: new Set(ids), mirrorLineId: 'axis_x' },
				});
				assert.equal(tool.executeMirror(), true);
			}
			if (kind === 'circular') {
				const tool = Object.assign(Object.create(CircularPatternTool.prototype), {
					ctx: context(doc),
					popup: { hide() {} },
					state: {
						selectedObjectIds: new Set(ids),
						centerPointId: 'origin',
						distribution: 'full',
						angle: 360,
						quantity: 4,
						suppression: true,
						suppressedIndices: new Set([2]),
					},
				});
				assert.equal(tool.executeCircularPattern(), true);
			}
			if (kind === 'rectangular') {
				const tool = Object.assign(Object.create(RectangularPatternTool.prototype), {
					ctx: context(doc),
					popup: { hide() {} },
					state: {
						selectedObjectIds: new Set(ids),
						line1Id: null,
						line2Id: null,
						distance1: 30,
						distance2: 20,
						quantity1: 3,
						quantity2: 2,
						direction1: 'symmetric',
						direction2: 'one_direction',
						suppression: true,
						suppressedIndices: new Set([1001]),
					},
				});
				assert.equal(tool.executeRectangularPattern(), true);
			}
			assert.equal(geometryCalls, 1, kind);
			assert.ok(calls >= 1);
		} finally {
			setGeometryKernel(previous);
		}
	}
	const { doc, ids } = copyScene(),
		point = doc.points.get(doc.lines.get(ids[0])!.p1Id)!;
	const prepared = prepareCopies(doc, ids, [{ type: 'translation', offset: { x: 5, y: 7 } }])[0];
	point.x += 100;
	assert.equal(prepared.point(point.id, point).x, point.x + 5);
});
class Element {
	attributes: Record<string, string> = {};
	children: Element[] = [];
	style = {};
	constructor(readonly tag: string) {}
	set innerHTML(_v: string) {
		this.children = [];
	}
	get innerHTML() {
		return '';
	}
	setAttribute(k: string, v: unknown) {
		this.attributes[k] = String(v);
	}
	appendChild(child: Element) {
		this.children.push(child);
		return child;
	}
}
for (const mode of ['mirror', 'circular', 'rectangular'])
	test(`full ${mode} preview matches original SVG and metadata`, () => {
		const originalDocument = globalThis.document;
		const { doc, ids } = copyScene(),
			viewport = new Viewport();
		try {
			globalThis.document = { createElementNS: (_ns: string, tag: string) => new Element(tag) } as unknown as Document;
			const run = (api: typeof previews) => {
				const targetGroup = new Element('g'),
					checkboxGroup = new Element('g'),
					checkboxPositions = new Map(),
					gizmoHandles = new Map();
				let handle: unknown;
				if (mode === 'mirror') api.renderMirrorPreview(doc, viewport, targetGroup as any, new Set(ids), 'axis_y');
				if (mode === 'circular')
					handle = api.renderPatternPreview(doc, viewport, {
						targetGroup: targetGroup as any,
						checkboxGroup: checkboxGroup as any,
						checkboxPositions,
						selectedObjectIds: new Set(ids),
						centerPointId: 'origin',
						distribution: 'symmetric',
						angle: -725,
						quantity: 5,
						suppression: true,
						suppressedIndices: new Set([2]),
						angleHandleEnabled: true,
					});
				if (mode === 'rectangular')
					api.renderRectangularPatternPreview(doc, viewport, {
						targetGroup: targetGroup as any,
						checkboxGroup: checkboxGroup as any,
						checkboxPositions,
						gizmoHandles,
						highlight: {
							selectedObjectIds: new Set(ids),
							line1Id: null,
							line2Id: null,
							quantity1: 3,
							quantity2: 2,
							distance1: 30,
							distance2: -20,
							direction1: 'symmetric',
							direction2: 'one_direction',
							suppression: true,
							suppressedIndices: new Set([1001]),
						},
					});
				return plain({
					targetGroup,
					checkboxGroup,
					positions: [...checkboxPositions],
					gizmos: [...gizmoHandles],
					handle,
				});
			};
			compare(run(previews), run(originalPreviews), mode);
		} finally {
			globalThis.document = originalDocument;
		}
	});
test('copy protocol rejects malformed packets and propagates failures', { skip: !native }, async () => {
	const wasm = await import('../public/kernel/sketcher_wasm.js');
	const call = (p: number[], ops: number[]) => wasm.copy_geometry(new Float64Array(p), new Float64Array(ops));
	for (const [p, ops] of [
		[[0], []],
		[[], [0, 0]],
		[[], [99]],
		[[], [NaN]],
		[
			[NaN, 0],
			[4, 0, 0],
		],
		[[], [1, 0, 0, 4, 3, 90, 1]],
		[[], [5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
	] as number[][][])
		assert.throws(() => call(p, ops));
	assert.throws(() =>
		createWasmCopy(() => new Float64Array())([{ x: 0, y: 0 }], [{ type: 'translation', offset: { x: 0, y: 0 } }])
	);
	assert.throws(
		() =>
			createWasmCopy(() => {
				throw Error('native failure');
			})([], []),
		/native failure/
	);
	const { doc, ids } = copyScene(),
		before = plain(doc.takeSnapshot()),
		previous = getGeometryKernel();
	try {
		setGeometryKernel({
			...previous,
			copies() {
				throw Error('native failure');
			},
		});
		const tool = Object.assign(Object.create(MirrorTool.prototype), {
			ctx: context(doc),
			state: { selectedObjectIds: new Set(ids), mirrorLineId: 'axis_x' },
		});
		assert.throws(() => tool.executeMirror(), /native failure/);
		assert.deepEqual(plain(doc.takeSnapshot()), before);
		assert.equal(doc.undo(), false);
	} finally {
		setGeometryKernel(previous);
	}
});

for (const kind of ['circular', 'rectangular'])
	test(`native failure rolls back ${kind} parameter edits`, { skip: !native }, async () => {
		const { SketchDocument } = await import('../src/model/sketch');
		const doc = new SketchDocument(),
			a = doc.addPoint({ x: 10, y: 2 }),
			b = doc.addPoint({ x: 20, y: 2 }),
			line = doc.addLine(a.id, b.id);
		let id: string;
		doc.beginTransaction();
		if (kind === 'circular') {
			const copy = active.generateCircularPatternCopy(doc, 'origin', [line.id], 1, 2, 'full', 360)!;
			id = active.addCircularPatternConstraint(doc, 'origin', [line.id], 'full', 360, 2, false, [], [copy])!.id;
		} else {
			const copy = active.generateRectangularPatternCopy(
				doc,
				[line.id],
				1,
				0,
				30,
				'one_direction',
				0,
				'one_direction',
				{ x: 1, y: 0 },
				{ x: 0, y: 1 }
			)!;
			id = active.addRectangularPatternConstraint(
				doc,
				[line.id],
				null,
				null,
				2,
				30,
				'one_direction',
				1,
				0,
				'one_direction',
				false,
				[],
				[copy]
			)!.id;
		}
		doc.commitTransaction();
		doc.clearHistory();
		const before = plain(doc.takeSnapshot()),
			previous = getGeometryKernel();
		try {
			setGeometryKernel({
				...previous,
				copies() {
					throw Error('native failure');
				},
			});
			assert.throws(
				() =>
					kind === 'circular'
						? active.updateCircularPattern(doc, id, { quantity: 3, totalAngle: 90 })
						: active.updateRectangularPattern(doc, id, { quantity1: 3, distance1: 40 }),
				/native failure/
			);
			assert.equal(doc.isInTransaction(), false);
			compare(plain(doc.takeSnapshot()), before);
			assert.equal(doc.undo(), false);
		} finally {
			setGeometryKernel(previous);
		}
	});

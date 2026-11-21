import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getGeometryKernel, setGeometryKernel } from '../src/kernel';
import { copyGeometry } from '../src/math/copyGeometry';
import { createWasmCopy } from '../src/kernel/copyWasm';
import { prepareCopies } from '../src/model/copyGeometry';
import { copyScene } from './helpers/copyScenes';
import * as active from '../src/model/patterns';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';
import { CircularPatternTool } from '../src/canvas/tools/modify/circularPattern';
import { RectangularPatternTool } from '../src/canvas/tools/modify/rectangularPattern';
import * as previews from '../src/canvas/modifyPreviews';
import { Viewport } from '../src/canvas/viewport';
import { checkConstraints } from '../src/solver/constraintInspection';
import { CircularPatternConstraint, RectangularPatternConstraint, SymmetryConstraint } from '../src/solver/constraints';
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
for (const [f, c] of fixture.cases.entries())
	test(`copy geometry retains old arithmetic: ${f}/${c.operation.type}`, () => {
		const input = plain({ points: fixture.points, operations: [c.operation] }),
			before = plain(input);
		compare(plain(copyGeometry(input.points, input.operations)[0]), c.expected, 'active', 1e-12);
		assert.deepEqual(input, before);
	});
const context = (doc: any) => ({ sketch: doc, showToast() {}, setTool() {}, requestRender() {} });
for (const axis of ['axis_x', 'axis_y', 'oblique'] as const)
	test(`mirror preserves constraints, shared points, handles and winding: ${axis}`, () => {
		const scene = copyScene();
		let mirrorLineId: string = axis;
		if (axis === 'oblique') {
			const a = scene.doc.addPoint({ x: 2, y: 3 }),
				b = scene.doc.addPoint({ x: 8, y: 14 });
			mirrorLineId = scene.doc.addLine(a.id, b.id).id;
			scene.doc.clearHistory();
		}
		const before = plain(scene.doc.takeSnapshot());
		const beforeCounts = {
			points: scene.doc.points.size,
			lines: scene.doc.lines.size,
			circles: scene.doc.circles.size,
			arcs: scene.doc.arcs.size,
			ellipses: scene.doc.ellipses.size,
			ellipticalArcs: scene.doc.ellipticalArcs.size,
			splines: scene.doc.splines.size,
		};
		const tool = Object.assign(Object.create(MirrorTool.prototype), {
			ctx: context(scene.doc),
			state: { selectedObjectIds: new Set(scene.ids), mirrorLineId },
		});
		assert.equal(tool.executeMirror(), true);
		const after = plain(scene.doc.takeSnapshot());
		// On axis_x, (0,0) and (-20,0) lie on the axis and are reused; on axis_y, (0,0) and (0,6) are reused.
		const expectedNewPoints = axis === 'oblique' ? 21 : 19;
		assert.equal(scene.doc.points.size, beforeCounts.points + expectedNewPoints);
		assert.equal(scene.doc.lines.size, beforeCounts.lines + 7);
		assert.equal(scene.doc.circles.size, beforeCounts.circles * 2);
		assert.equal(scene.doc.arcs.size, beforeCounts.arcs * 2);
		assert.equal(scene.doc.ellipses.size, beforeCounts.ellipses * 2);
		assert.equal(scene.doc.ellipticalArcs.size, beforeCounts.ellipticalArcs * 2);
		assert.equal(scene.doc.splines.size, beforeCounts.splines * 2);
		// Winding reverses on mirrored arcs and elliptical arcs.
		assert.deepEqual(
			[...scene.doc.arcs.values()].map(a => a.clockwise),
			[true, false]
		);
		assert.deepEqual(
			[...scene.doc.ellipticalArcs.values()].map(a => a.clockwise),
			[true, false]
		);
		// Symmetry constraints are created for every non-reused point and are satisfied.
		const symmetry = [...scene.doc.constraints.values()].filter(
			(c): c is SymmetryConstraint => c instanceof SymmetryConstraint
		);
		assert.equal(symmetry.length, expectedNewPoints);
		const check = checkConstraints(symmetry, scene.doc.paramManager.getCurrentValues());
		assert.equal(check.satisfied, true);
		assert.ok(check.error < 1e-6, `${axis} symmetry error ${check.error}`);
		// Selection contains the newly created mirrored primitives (standalone point (0,6) on axis_y is reused).
		assert.equal(scene.doc.getSelectedPrimitives().length, axis === 'axis_y' ? 7 : 8);
		assert.equal(scene.doc.undo(), true);
		compare(plain(scene.doc.takeSnapshot()), before, 'undo');
		assert.equal(scene.doc.redo(), true);
		compare(plain(scene.doc.takeSnapshot()), after, 'redo');
	});
for (const distribution of ['full', 'partial', 'symmetric'] as const)
	test(`circular create/update/suppression preserves copies: ${distribution}`, () => {
		const scene = copyScene();
		const sourceSnapshot = plain(scene.doc.takeSnapshot());
		scene.doc.beginTransaction();
		const copies = [1, 3].map(
			i => active.generateCircularPatternCopy(scene.doc, 'origin', scene.ids, i, 4, distribution, 725)!
		);
		const constraint = active.addCircularPatternConstraint(
			scene.doc,
			'origin',
			scene.ids,
			distribution,
			725,
			4,
			true,
			[2],
			copies
		)!;
		scene.doc.commitTransaction();
		assert.ok(constraint instanceof CircularPatternConstraint);
		assert.equal(constraint.copies.length, 2);
		assert.deepEqual(constraint.suppressedIndices, [2]);
		assert.equal(scene.doc.circles.size, 3);
		assert.equal(scene.doc.arcs.size, 3);
		assert.equal(scene.doc.splines.size, 6);
		const initialCheck = checkConstraints([constraint], scene.doc.paramManager.getCurrentValues());
		assert.equal(initialCheck.satisfied, true);
		assert.ok(initialCheck.error < 1e-6);

		const steps = [
			{ updates: { quantity: 5, totalAngle: -110, suppressedIndices: [1] }, expectedCopies: 3 },
			{ updates: { distribution: 'symmetric' as const, totalAngle: 270, suppression: false }, expectedCopies: 4 },
			{ updates: { quantity: 2 }, expectedCopies: 1 },
		];
		for (const { updates, expectedCopies } of steps) {
			assert.equal(active.updateCircularPattern(scene.doc, constraint.id, updates), true);
			assert.equal(constraint.copies.length, expectedCopies);
			assert.equal(scene.doc.circles.size, 1 + expectedCopies);
			assert.equal(scene.doc.arcs.size, 1 + expectedCopies);
			assert.equal(scene.doc.splines.size, 2 * (1 + expectedCopies));
			const check = checkConstraints([constraint], scene.doc.paramManager.getCurrentValues());
			assert.equal(check.satisfied, true);
			assert.ok(check.error < 1e-6);
		}
		const finalCircular = plain(scene.doc.takeSnapshot());
		assert.equal(scene.doc.undo(), true);
		assert.equal(scene.doc.redo(), true);
		compare(plain(scene.doc.takeSnapshot()), finalCircular, 'circular/redo');
		// Source points remain present in the sketch.
		for (const p of sourceSnapshot.points) {
			assert.ok(scene.doc.points.has(p.id), `missing source point ${p.id}`);
		}
	});
for (const direction of ['one_direction', 'symmetric'] as const)
	test(`rectangular create/update/suppression preserves copies: ${direction}`, () => {
		const scene = copyScene();
		const dirA = scene.doc.addPoint({ x: 0, y: 0 }),
			dirB = scene.doc.addPoint({ x: 6, y: 8 });
		const dirLine = scene.doc.addLine(dirA.id, dirB.id);
		const sourceSnapshot = plain(scene.doc.takeSnapshot());
		scene.doc.beginTransaction();
		const copies = [
			[0, 1],
			[1, 0],
			[1, 1],
		].map(
			([i, j]) =>
				active.generateRectangularPatternCopy(
					scene.doc,
					scene.ids,
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
		const constraint = active.addRectangularPatternConstraint(
			scene.doc,
			scene.ids,
			dirLine.id,
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
		scene.doc.commitTransaction();
		assert.ok(constraint instanceof RectangularPatternConstraint);
		assert.equal(scene.doc.constraints.has(constraint.id), true);
		assert.equal(constraint.copies.length, 3);
		assert.equal(scene.doc.circles.size, 4);
		assert.equal(scene.doc.splines.size, 8);
		const initialCheck = checkConstraints([constraint], scene.doc.paramManager.getCurrentValues());
		assert.equal(initialCheck.satisfied, true);
		assert.ok(initialCheck.error < 1e-6);

		const steps = [
			{ updates: { quantity1: 3, distance1: 25, suppression: true, suppressedIndices: [1001] }, expectedCopies: 4 },
			{ updates: { quantity2: 3, direction2: 'symmetric' as const, suppression: false }, expectedCopies: 8 },
			{ updates: { distance1: 0 }, expectedCopies: 2 },
		];
		for (const { updates, expectedCopies } of steps) {
			assert.equal(active.updateRectangularPattern(scene.doc, constraint.id, updates), true);
			assert.equal(constraint.copies.length, expectedCopies);
			assert.equal(scene.doc.circles.size, 1 + expectedCopies);
			assert.equal(scene.doc.arcs.size, 1 + expectedCopies);
			assert.equal(scene.doc.splines.size, 2 * (1 + expectedCopies));
			const check = checkConstraints([constraint], scene.doc.paramManager.getCurrentValues());
			assert.equal(check.satisfied, true);
			assert.ok(check.error < 1e-6);
		}
		const finalRect = plain(scene.doc.takeSnapshot());
		assert.equal(scene.doc.undo(), true);
		assert.equal(scene.doc.redo(), true);
		compare(plain(scene.doc.takeSnapshot()), finalRect, 'rectangular/redo');
		for (const p of sourceSnapshot.points) {
			assert.ok(scene.doc.points.has(p.id), `missing source point ${p.id}`);
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
for (const mode of ['mirror', 'circular', 'rectangular'] as const)
	test(`full ${mode} preview renders expected SVG elements and metadata`, () => {
		const originalDocument = globalThis.document;
		const { doc, ids } = copyScene(),
			viewport = new Viewport();
		try {
			globalThis.document = { createElementNS: (_ns: string, tag: string) => new Element(tag) } as unknown as Document;
			const targetGroup = new Element('g'),
				checkboxGroup = new Element('g'),
				checkboxPositions = new Map<string, { x: number; y: number }>(),
				gizmoHandles = new Map<string, unknown>();
			let handle: { x: number; y: number; worldX: number; worldY: number; copyIndex: number } | null | undefined;
			if (mode === 'mirror') previews.renderMirrorPreview(doc, viewport, targetGroup as any, new Set(ids), 'axis_y');
			if (mode === 'circular')
				handle = previews.renderPatternPreview(doc, viewport, {
					targetGroup: targetGroup as any,
					checkboxGroup: checkboxGroup as any,
					checkboxPositions: checkboxPositions as any,
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
				previews.renderRectangularPatternPreview(doc, viewport, {
					targetGroup: targetGroup as any,
					checkboxGroup: checkboxGroup as any,
					checkboxPositions: checkboxPositions as any,
					gizmoHandles: gizmoHandles as any,
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

			const expectedCounts = { mirror: 23, circular: 114, rectangular: 136 };
			assert.equal(targetGroup.children.length, expectedCounts[mode]);
			if (mode === 'mirror') {
				assert.equal(checkboxGroup.children.length, 0);
				assert.equal(checkboxPositions.size, 0);
				assert.equal(gizmoHandles.size, 0);
			}
			if (mode === 'circular') {
				assert.equal(checkboxGroup.children.length, 4);
				assert.deepEqual([...checkboxPositions.keys()], ['tool-1', 'tool-2', 'tool-3', 'tool-4']);
				assert.ok(handle && Number.isFinite(handle.worldX) && Number.isFinite(handle.worldY));
				assert.equal(handle.copyIndex, 4);
			}
			if (mode === 'rectangular') {
				assert.equal(checkboxGroup.children.length, 5);
				assert.deepEqual([...checkboxPositions.keys()], ['tool-1', 'tool-1000', 'tool-1001', 'tool-2000', 'tool-2001']);
				assert.deepEqual([...gizmoHandles.keys()], ['gizmo-1', 'gizmo-2']);
			}
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

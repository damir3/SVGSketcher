import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import type { SVGRenderer as Renderer, RenderOptions } from '../src/canvas/renderer';
import { Viewport } from '../src/canvas/viewport';
import { SketchDocument } from '../src/model/sketch';
import {
	calculateChamferGeometry,
	commitChamferToSketch,
	findChamferCandidateForPoint,
	type ChamferCandidate,
	type ChamferMode,
} from '../src/math/chamfer';

register('./helpers/rawSvgLoader.mjs', import.meta.url);
const { SVGRenderer } = await import('../src/canvas/renderer');
class SvgElement {
	attributes = new Map<string, string>();
	children: SvgElement[] = [];
	parent: SvgElement | null = null;
	style = {};
	classList = { add: (name: string) => this.setAttribute('class', `${this.getAttribute('class') ?? ''} ${name}`) };
	setAttribute(name: string, value: string) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
	set innerHTML(_value: string) {
		this.children = [];
	}
	appendChild(child: SvgElement) {
		if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child);
		child.parent = this;
		this.children.push(child);
	}
}
const coordinates = (element: SvgElement) => ['x1', 'y1', 'x2', 'y2'].map(key => element.getAttribute(key));
function render(sketch: SketchDocument, mode: ChamferMode, flip: boolean, candidate: ChamferCandidate | null = null) {
	const geometry = new SvgElement(),
		preview = new SvgElement(),
		viewport = new Viewport(800, 600),
		previous = globalThis.document;
	viewport.zoom = 2.5;
	viewport.panX = 350;
	viewport.panY = 290;
	const renderer: Renderer = Object.assign(Object.create(SVGRenderer.prototype), {
		geometryGroup: geometry,
		pointGroup: new SvgElement(),
		chamferGroup: preview,
		chamferGizmoHandles: [],
	});
	const state: NonNullable<RenderOptions['chamferState']> = {
		candidate,
		firstLine: null,
		hoverPointId: null,
		mode,
		flip,
	};
	try {
		(globalThis as any).document = { createElementNS: () => new SvgElement() };
		renderer['renderGeometry'](sketch, viewport, { chamferState: state });
		renderer.renderChamferPreviews(viewport, state);
	} finally {
		globalThis.document = previous;
	}
	return {
		line(id: string) {
			const group = geometry.children.find(c => c.getAttribute('data-id') === id);
			assert.ok(group);
			// The hit target is followed by the visible line, including highlighted preview lines.
			const visible = group.children[1];
			assert.ok(visible);
			return coordinates(visible);
		},
		// The two corner cut guides and vertex marker precede the chamfer segment.
		chamfer: candidate ? coordinates(preview.children[3]) : null,
	};
}
for (const mode of ['equal_distance', 'two_distance', 'distance_angle'] as const)
	for (const flip of [false, true])
		for (const reversed of [false, true])
			test(`${mode}, flip=${flip}, reversed=${reversed}: adjacent chamfers match previews and preserve both shared-line cuts`, () => {
				const sketch = new SketchDocument();
				const { left, right, shared } = sketch.withDeferredSolve(() => {
					const left = sketch.addPoint({ x: 0, y: 0 }),
						right = sketch.addPoint({ x: 100, y: 0 }),
						shared = sketch.addLine(left.id, right.id);
					sketch.addLine(left.id, sketch.addPoint({ x: 0, y: 100 }).id);
					sketch.addLine(right.id, sketch.addPoint({ x: 100, y: 100 }).id);
					return { left, right, shared };
				});
				sketch.clearHistory();
				const snapshots = [sketch.takeSnapshot()],
					created: string[] = [];
				const ids = reversed ? [right.id, left.id] : [left.id, right.id];
				let retainedFirstCut: string | undefined;
				for (const id of ids) {
					const candidate = findChamferCandidateForPoint(sketch, id)!;
					assert.ok(candidate);
					candidate.result = calculateChamferGeometry(candidate, mode, 5, 3, 30, flip);
					assert.ok(candidate.result.isValid);
					const before = sketch.takeSnapshot(),
						preview = render(sketch, mode, flip, candidate);
					assert.deepEqual(sketch.takeSnapshot(), before, 'preview changed the document');
					const previewShared = preview.line(shared.id),
						previewOther = preview.line(candidate.line2.id);
					const result = commitChamferToSketch(sketch, candidate, mode, 5, 3, 30, flip, {
						dist1: '5',
						dist2: '3',
						angle: '30',
					});
					assert.ok(result);
					created.push(result.chamferLineId);
					const committed = render(sketch, mode, flip);
					assert.deepEqual(
						committed.line(result.chamferLineId),
						preview.chamfer,
						'committed chamfer differs from preview'
					);
					assert.deepEqual(committed.line(shared.id), previewShared, 'shared line differs from preview');
					assert.deepEqual(committed.line(candidate.line2.id), previewOther);
					if (retainedFirstCut)
						assert.ok(
							shared.p1Id === retainedFirstCut || shared.p2Id === retainedFirstCut,
							'second chamfer lost the first cut'
						);
					else retainedFirstCut = result.p1Id;
					assert.ok(sketch.lastSolverResult!.finalError < 1e-8);
					snapshots.push(sketch.takeSnapshot());
				}
				assert.notEqual(shared.p1Id, left.id);
				assert.notEqual(shared.p2Id, right.id);
				assert.equal(sketch.lines.size, 5);
				assert.equal(sketch.undo(), true);
				assert.deepEqual(sketch.takeSnapshot(), snapshots[1]);
				assert.equal(sketch.undo(), true);
				assert.deepEqual(sketch.takeSnapshot(), snapshots[0]);
				assert.equal(sketch.canUndo(), false);
				assert.equal(sketch.redo(), true);
				assert.equal(sketch.redo(), true);
				for (const id of created) assert.ok(sketch.lines.has(id));
				assert.deepEqual(sketch.takeSnapshot(), snapshots[2]);
			});

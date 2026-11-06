import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { SelectTool } from '../src/canvas/tools/selection/select';
import { HighlightManager } from '../src/canvas/highlightManager';
import { DistanceConstraint } from '../src/solver/constraints';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import { vec, type Vec2 } from '../src/math/vector';

function createMockSvgElement(tagName = 'g', attrs: Record<string, string> = {}): any {
	const children: any[] = [];
	const attributes = new Map<string, string>(Object.entries(attrs));
	const classNames = new Set<string>((attrs.class || '').split(/\s+/).filter(Boolean));
	return {
		tagName: tagName.toUpperCase(),
		style: {},
		attributes,
		classList: {
			add: (cls: string) => classNames.add(cls),
			remove: (cls: string) => classNames.delete(cls),
			contains: (cls: string) => classNames.has(cls),
		},
		getAttribute: (name: string) =>
			name === 'class' ? Array.from(classNames).join(' ') : (attributes.get(name) ?? null),
		setAttribute: (name: string, val: string) => {
			attributes.set(name, String(val));
		},
		hasAttribute: (name: string) => attributes.has(name),
		appendChild: (child: any) => {
			children.push(child);
			return child;
		},
		cloneNode: function (deep = true) {
			const clone = createMockSvgElement(tagName, Object.fromEntries(attributes.entries()));
			if (deep) {
				for (const c of children) {
					clone.appendChild(c.cloneNode(true));
				}
			}
			return clone;
		},
		querySelector: (sel: string) => {
			for (const c of children) {
				if (sel === 'rect' && c.tagName === 'RECT') return c;
			}
			return null;
		},
		querySelectorAll: (sel: string) => {
			const res: any[] = [];
			function collect(node: any) {
				for (const c of node.children) {
					if (sel.startsWith('[data-id="')) {
						const match = sel.match(/\[data-id="([^"]+)"\]/);
						if (match && c.getAttribute('data-id') === match[1]) {
							res.push(c);
						}
					} else if (sel.startsWith('.constraint-badge')) {
						if (c.classList.contains('constraint-badge')) {
							res.push(c);
						}
					}
					collect(c);
				}
			}
			collect({ children });
			return res;
		},
		closest: function (sel: string) {
			if (sel === '[data-id]' && attributes.has('data-id')) {
				return this;
			}
			return null;
		},
		children,
	};
}

function createMockContext(sketch: SketchDocument, svgRoot: any): ToolContext {
	const viewport = {
		zoom: 1,
		panX: 0,
		panY: 0,
		screenToWorld: (p: { x: number; y: number }) => vec(p.x, p.y),
		worldToScreen: (p: { x: number; y: number }) => vec(p.x, p.y),
	} as any;

	const renderer = {
		previewGroup: createMockSvgElement('g'),
		clearPreviews: () => {},
	} as any;

	let ctx: ToolContext;
	const highlightManager = new HighlightManager(svgRoot as any, () => ctx);

	ctx = {
		sketch,
		viewport,
		renderer,
		svg: svgRoot as any,
		highlightManager,
		isConstructionMode: false,
		requestRender: () => {},
		setCursor: () => {},
		findPointNear: (screen: Vec2, radius = 10) => {
			for (const pt of sketch.points.values()) {
				const s = viewport.worldToScreen(pt);
				const dx = s.x - screen.x;
				const dy = s.y - screen.y;
				if (Math.hypot(dx, dy) <= radius) {
					return pt;
				}
			}
			return null;
		},
		findLineNear: (screen: Vec2, threshold = 10) => {
			for (const l of sketch.lines.values()) {
				const d = l.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return l;
			}
			return null;
		},
		findCircleNear: (screen: Vec2, threshold = 10) => {
			for (const c of sketch.circles.values()) {
				const d = c.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return c;
			}
			return null;
		},
		findArcNear: (screen: Vec2, threshold = 10) => {
			for (const a of sketch.arcs.values()) {
				const d = a.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return a;
			}
			return null;
		},
		findEllipseNear: (screen: Vec2, threshold = 10) => {
			for (const e of sketch.ellipses.values()) {
				const d = e.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return e;
			}
			return null;
		},
		findEllipticalArcNear: (screen: Vec2, threshold = 10) => {
			for (const a of sketch.ellipticalArcs.values()) {
				const d = a.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return a;
			}
			return null;
		},
		findSplineNear: (screen: Vec2, threshold = 10) => {
			for (const s of sketch.splines.values()) {
				const d = s.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return s;
			}
			return null;
		},
		findConstraintNear: (screen: Vec2, threshold = 18) => {
			let closestDist = threshold;
			let found: any = null;
			for (const c of sketch.constraints.values()) {
				if (!c.distanceTo) continue;
				const d = c.distanceTo(screen, sketch, viewport, closestDist);
				if (d !== null && d < closestDist) {
					closestDist = d;
					found = c;
				}
			}
			return found;
		},
		toGeoCurve: (type: any, id: string) => sketch.toGeoCurve(id, type),
		findTrimTarget: () => null,
		applySnapConstraintIfNeeded: () => {},
		applyAutoOrientationConstraint: () => {},
		getAxisSnappedWorldPos: (_s, t) => t,
		isSnapModifierPressed: false,
	};
	return ctx;
}

describe('Select Tool Hover Mechanism', () => {
	it('has id "select" and defaultCursor "default"', () => {
		const tool = new SelectTool();
		assert.strictEqual(tool.id, 'select');
		assert.strictEqual(tool.defaultCursor, 'default');
	});

	it('highlights hovered element with select-hover class', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG = createMockSvgElement('g', {
			'data-id': line.id,
			'data-type': 'line',
			class: 'sketch-entity sketch-line',
		});
		svgRoot.appendChild(lineG);

		const ctx = createMockContext(sketch, svgRoot);
		const tool = new SelectTool();
		tool.activate(ctx);

		const toolEvent: ToolMouseEvent = {
			raw: {} as MouseEvent,
			screen: vec(50, 2),
			client: vec(50, 2),
			world: vec(50, 2),
			snap: null,
			effectiveWorld: vec(50, 2),
			effectiveScreen: vec(50, 2),
		};

		assert.strictEqual(tool.isHighlightEnabled(), true);
		assert.strictEqual(tool.getHighlightClass({ type: 'line', id: line.id }), 'select-hover');
		assert.strictEqual(tool.canHighlight({ type: 'line', id: line.id }), true);

		ctx.highlightManager!.update(tool, toolEvent.screen, toolEvent.raw?.target as SVGElement);
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), line.id);
		assert.strictEqual(lineG.classList.contains('select-hover'), true);

		// Move mouse away
		ctx.highlightManager!.update(tool, vec(50, 80));
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), null);
		assert.strictEqual(lineG.classList.contains('select-hover'), false);
	});

	it('prioritizes vertex point when hovered near an endpoint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const ctx = createMockContext(sketch, svgRoot);
		const tool = new SelectTool();
		tool.activate(ctx);

		const target = ctx.highlightManager!.update(tool, vec(2, 1));
		assert.ok(target);
		assert.strictEqual(target.type, 'point');
		assert.strictEqual(target.id, p1.id);
	});

	it('synchronizes select-hover across multiple elements with same data-id (e.g. badges)', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 0 });
		const line1 = sketch.addLine(p1.id, p2.id);

		const p3 = sketch.addPoint({ x: 0, y: 50 });
		const p4 = sketch.addPoint({ x: 50, y: 50 });
		const line2 = sketch.addLine(p3.id, p4.id);

		const c = sketch.addEqualLengthConstraint(line1.id, line2.id);

		const svgRoot = createMockSvgElement('svg');
		const badge1 = createMockSvgElement('g', { 'data-id': c.id, 'data-type': 'constraint', class: 'constraint-badge' });
		const rect1 = createMockSvgElement('rect', { x: '20', y: '-10', width: '18', height: '18' });
		badge1.appendChild(rect1);

		const badge2 = createMockSvgElement('g', { 'data-id': c.id, 'data-type': 'constraint', class: 'constraint-badge' });
		const rect2 = createMockSvgElement('rect', { x: '20', y: '40', width: '18', height: '18' });
		badge2.appendChild(rect2);

		svgRoot.appendChild(badge1);
		svgRoot.appendChild(badge2);

		const ctx = createMockContext(sketch, svgRoot);
		const tool = new SelectTool();
		tool.activate(ctx);

		// Hover near badge1
		const toolEvent: ToolMouseEvent = {
			raw: {} as MouseEvent,
			screen: vec(25, -2),
			client: vec(25, -2),
			world: vec(25, -2),
			snap: null,
			effectiveWorld: vec(25, -2),
			effectiveScreen: vec(25, -2),
		};

		ctx.highlightManager!.update(tool, toolEvent.screen, toolEvent.raw?.target as SVGElement);
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), c.id);
		assert.strictEqual(badge1.classList.contains('select-hover'), true);
		assert.strictEqual(badge2.classList.contains('select-hover'), true);

		// Clear hover
		ctx.highlightManager!.clear();
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), null);
		assert.strictEqual(badge1.classList.contains('select-hover'), false);
		assert.strictEqual(badge2.classList.contains('select-hover'), false);
	});

	it('allows hovering and selecting spline tangent handles', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 50, y: 50 });
		const p3 = sketch.addPoint({ x: 100, y: 0 });
		const s = sketch.addFitSpline([p1.id, p2.id, p3.id]);

		const svgRoot = createMockSvgElement('svg');
		const ctx = createMockContext(sketch, svgRoot);
		const tool = new SelectTool();
		tool.activate(ctx);

		// Find handle point on the first tangent handle line
		const handleLineId = s.tangentLineIds![0];
		const handleLine = sketch.lines.get(handleLineId)!;
		const handlePt = sketch.points.get(handleLine.p1Id)!;

		const target = ctx.highlightManager!.update(tool, vec(handlePt.x, handlePt.y));
		assert.ok(target);
		assert.strictEqual(target.type, 'point');
		assert.strictEqual(target.id, handlePt.id);
	});

	it('does not highlight origin or coordinate axes on hover', () => {
		const sketch = new SketchDocument();
		const svgRoot = createMockSvgElement('svg');
		const axisXG = createMockSvgElement('g', {
			'data-id': 'axis_x',
			'data-type': 'line',
			class: 'sketch-entity sketch-line sketch-axis-line',
		});
		const axisYG = createMockSvgElement('g', {
			'data-id': 'axis_y',
			'data-type': 'line',
			class: 'sketch-entity sketch-line sketch-axis-line',
		});
		const originG = createMockSvgElement('g', {
			'data-id': 'origin',
			'data-type': 'point',
			class: 'sketch-origin-marker',
		});
		svgRoot.appendChild(axisXG);
		svgRoot.appendChild(axisYG);
		svgRoot.appendChild(originG);

		const ctx = createMockContext(sketch, svgRoot);
		const tool = new SelectTool();
		tool.activate(ctx);

		assert.strictEqual(tool.canHighlight({ type: 'point', id: 'origin' }), false);
		assert.strictEqual(tool.canHighlight({ type: 'line', id: 'axis_x' }), false);
		assert.strictEqual(tool.canHighlight({ type: 'line', id: 'axis_y' }), false);

		// Hover directly over origin (0, 0)
		const targetOrigin = ctx.highlightManager!.update(tool, vec(0, 0), originG as unknown as SVGElement);
		assert.strictEqual(targetOrigin, null);
		assert.strictEqual(originG.classList.contains('select-hover'), false);
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), null);

		// Hover over X axis (100, 0)
		const targetAxisX = ctx.highlightManager!.update(tool, vec(100, 0), axisXG as unknown as SVGElement);
		assert.strictEqual(targetAxisX, null);
		assert.strictEqual(axisXG.classList.contains('select-hover'), false);
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), null);

		// Hover over Y axis (0, 100)
		const targetAxisY = ctx.highlightManager!.update(tool, vec(0, 100), axisYG as unknown as SVGElement);
		assert.strictEqual(targetAxisY, null);
		assert.strictEqual(axisYG.classList.contains('select-hover'), false);
		assert.strictEqual(ctx.highlightManager!.getHoveredId(), null);
	});

	it('selecting a primitive with constraints does not auto-select its constraints', () => {
		const sketch = new SketchDocument();
		const line = sketch.addLine(0, 0, 50, 0);
		sketch.addDistanceConstraint(line.p1Id, line.p2Id, 50);

		sketch.selectEntity(line.id, 'line');
		assert.strictEqual(sketch.selection.lineIds.size, 1);
		assert.strictEqual(sketch.selection.lineIds.has(line.id), true);
		assert.strictEqual(sketch.selection.constraintIds.size, 0);
	});
});

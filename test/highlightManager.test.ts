import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { HighlightManager } from '../src/canvas/highlightManager';
import { BaseTool } from '../src/canvas/tools/base';
import type { ToolContext } from '../src/canvas/tools/types';
import type { HoverTarget } from '../src/canvas/tools/hoverTarget';
import { vec, type Vec2 } from '../src/math/vector';
import { ConstraintTool } from '../src/canvas/tools/constraints/constraint';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';
import { MirrorTool } from '../src/canvas/tools/modify/mirror';
import { CircularPatternTool } from '../src/canvas/tools/modify/circularPattern';
import { RectangularPatternTool } from '../src/canvas/tools/modify/rectangularPattern';

function createMockSvgElement(tagName = 'g', attrs: Record<string, string> = {}): any {
	const children: any[] = [];
	const attributes = new Map<string, string>(Object.entries(attrs));
	const classNames = new Set<string>((attrs.class || '').split(/\s+/).filter(Boolean));
	const styles: Record<string, string> = {};

	return {
		tagName: tagName.toUpperCase(),
		style: {
			setProperty: (prop: string, val: string) => {
				styles[prop] = val;
			},
			removeProperty: (prop: string) => {
				delete styles[prop];
			},
			getPropertyValue: (prop: string) => styles[prop] || '',
		},
		attributes,
		classList: {
			add: (cls: string) => classNames.add(cls),
			remove: (cls: string) => classNames.delete(cls),
			contains: (cls: string) => classNames.has(cls),
		},
		getAttribute: (name: string) => (name === 'class' ? Array.from(classNames).join(' ') : (attributes.get(name) ?? null)),
		setAttribute: (name: string, val: string) => {
			attributes.set(name, String(val));
		},
		appendChild: (child: any) => {
			children.push(child);
			return child;
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
					}
					collect(c);
				}
			}
			collect({ children });
			return res;
		},
		children,
	};
}

function createMockContext(sketch: SketchDocument, svgRoot: any, rendererExtras: Record<string, any> = {}): ToolContext {
	const viewport = {
		zoom: 1,
		panX: 0,
		panY: 0,
		screenToWorld: (x: number, y: number) => vec(x, y),
		worldToScreen: (x: number, y: number) => vec(x, y),
	} as any;

	const ctx: any = {
		sketch,
		viewport,
		renderer: {
			clearPreviews: () => {},
			rectangularGizmoHandles: new Map(),
			patternCheckboxPositions: new Map(),
			...rendererExtras,
		},
		svg: svgRoot as any,
		isConstructionMode: false,
		requestRender: () => {},
		setCursor: () => {},
		showToast: () => {},
		findPointNear: (screen: Vec2, radius = 14) => {
			for (const pt of sketch.points.values()) {
				const dx = pt.x - screen.x;
				const dy = pt.y - screen.y;
				if (Math.hypot(dx, dy) <= radius) return pt;
			}
			return null;
		},
		findLineNear: (screen: Vec2, threshold = 18) => {
			for (const l of sketch.lines.values()) {
				const d = l.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return l;
			}
			return null;
		},
		findCircleNear: (screen: Vec2, threshold = 18) => {
			for (const c of sketch.circles.values()) {
				const d = c.distanceTo(screen, sketch, viewport, threshold);
				if (d !== null && d <= threshold) return c;
			}
			return null;
		},
		findArcNear: () => null,
		findSplineNear: () => null,
	};
	return ctx;
}

class TestCustomTool extends BaseTool {
	readonly id = 'select' as const;
	enabled = true;
	customClass = 'custom-hover';
	customColor: string | null = null;
	rejectedId: string | null = null;

	override isHighlightEnabled(): boolean {
		return this.enabled;
	}

	override getHighlightClass(_target: HoverTarget): string {
		return this.customClass;
	}

	override getHighlightColor(_target: HoverTarget): string | null {
		return this.customColor;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (this.rejectedId && target.id === this.rejectedId) return false;
		return true;
	}
}

describe('HighlightManager centralized highlighting', () => {
	it('does not highlight when tool has isHighlightEnabled() = false', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const tool = new TestCustomTool();
		tool.enabled = false;

		const target = manager.update(tool, vec(50, 0));
		assert.strictEqual(target, null);
		assert.strictEqual(manager.getHoveredId(), null);
		assert.strictEqual(lineG.classList.contains('custom-hover'), false);
	});

	it('respects canHighlight() predicate to reject disallowed targets', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const tool = new TestCustomTool();
		tool.rejectedId = line.id;

		const target = manager.update(tool, vec(50, 0));
		assert.strictEqual(target, null);
		assert.strictEqual(manager.getHoveredId(), null);
		assert.strictEqual(lineG.classList.contains('custom-hover'), false);
	});

	it('applies custom class and custom color styling when tool provides them', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const tool = new TestCustomTool();
		tool.customClass = 'danger-hover';
		tool.customColor = '#ef4444';

		const target = manager.update(tool, vec(50, 0));
		assert.ok(target);
		assert.strictEqual(target.id, line.id);
		assert.strictEqual(lineG.classList.contains('danger-hover'), true);
		assert.strictEqual(lineG.style.getPropertyValue('--custom-hover-color'), '#ef4444');

		// Clear highlight
		manager.clear();
		assert.strictEqual(lineG.classList.contains('danger-hover'), false);
		assert.strictEqual(lineG.style.getPropertyValue('--custom-hover-color'), '');
	});

	it('refreshes highlight after DOM re-render without losing hover state', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG1 = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG1);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const tool = new TestCustomTool();

		manager.update(tool, vec(50, 0));
		assert.strictEqual(lineG1.classList.contains('custom-hover'), true);

		// Simulate SVG re-render (children wiped and replaced with new DOM elements)
		svgRoot.children.length = 0;
		const lineG2 = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG2);

		assert.strictEqual(lineG2.classList.contains('custom-hover'), false);

		// Refresh should re-apply hover class to new DOM elements!
		manager.refresh(tool);
		assert.strictEqual(lineG2.classList.contains('custom-hover'), true);
	});

	it('clears hover state during refresh if entity was deleted from sketch', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const lineG = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(lineG);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const tool = new TestCustomTool();

		manager.update(tool, vec(50, 0));
		assert.strictEqual(manager.getHoveredId(), line.id);

		// Delete entity from sketch
		sketch.removeEntity(line.id);

		manager.refresh(tool);
		assert.strictEqual(manager.getHoveredId(), null);
	});
});

describe('Constraint and Transform tools hovering', () => {
	it('ConstraintTool: highlights only compatible entities for the active constraint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);
		const center = sketch.addPoint(200, 200);
		const circle = sketch.addCircle(center.id, 30);

		const svgRoot = createMockSvgElement('svg');
		const p1El = createMockSvgElement('g', { 'data-id': p1.id });
		const lineEl = createMockSvgElement('g', { 'data-id': line.id });
		const circleEl = createMockSvgElement('g', { 'data-id': circle.id });
		svgRoot.appendChild(p1El);
		svgRoot.appendChild(lineEl);
		svgRoot.appendChild(circleEl);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);

		// Fixed constraint: only points
		const fixedTool = new ConstraintTool('fixed');
		fixedTool.activate(ctx);
		// Over point -> highlight
		let target = manager.update(fixedTool, vec(0, 0));
		assert.strictEqual(target?.id, p1.id);
		// Over line -> rejected
		target = manager.update(fixedTool, vec(50, 0));
		assert.strictEqual(target, null);

		// Parallel constraint: only lines
		const parallelTool = new ConstraintTool('parallel');
		parallelTool.activate(ctx);
		// Over point -> rejected
		target = manager.update(parallelTool, vec(0, 0));
		assert.strictEqual(target, null);
		// Over line -> highlight
		target = manager.update(parallelTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);

		// Concentric constraint: circles/arcs
		const concentricTool = new ConstraintTool('concentric');
		concentricTool.activate(ctx);
		// Over line -> rejected
		target = manager.update(concentricTool, vec(50, 0));
		assert.strictEqual(target, null);
		// Over circle perimeter -> highlight (circle center is 200, 200, radius 30 -> (230, 200))
		target = manager.update(concentricTool, vec(230, 200));
		assert.strictEqual(target?.id, circle.id);
	});

	it('DimensionTool: highlights in step 0 and 1, disabled in step 2', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line1 = sketch.addLine(p1.id, p2.id);
		const p3 = sketch.addPoint(0, 50);
		const p4 = sketch.addPoint(100, 50);
		const line2 = sketch.addLine(p3.id, p4.id);

		const svgRoot = createMockSvgElement('svg');
		const line1El = createMockSvgElement('g', { 'data-id': line1.id });
		const line2El = createMockSvgElement('g', { 'data-id': line2.id });
		svgRoot.appendChild(line1El);
		svgRoot.appendChild(line2El);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const dimTool = new DimensionTool();
		dimTool.activate(ctx);

		// Step 0: can highlight line1
		let target = manager.update(dimTool, vec(50, 0));
		assert.strictEqual(target?.id, line1.id);

		// Switch to step 1 with line1 selected
		dimTool.state = { step: 1, line1Id: line1.id, line2Id: null, point1Id: null, point2Id: null };
		// Hovering line1 again -> rejected (already selected as first entity)
		target = manager.update(dimTool, vec(50, 0));
		assert.strictEqual(target, null);
		// Hovering line2 -> allowed
		target = manager.update(dimTool, vec(50, 50));
		assert.strictEqual(target?.id, line2.id);

		// Step 2: dimension placement phase -> highlighting disabled
		dimTool.state = { step: 2, line1Id: line1.id, line2Id: line2.id, point1Id: null, point2Id: null };
		target = manager.update(dimTool, vec(50, 50));
		assert.strictEqual(target, null);
	});

	it('MirrorTool: highlights all primitives in objects phase, only lines in mirror_line phase', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const p1El = createMockSvgElement('g', { 'data-id': p1.id });
		const lineEl = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(p1El);
		svgRoot.appendChild(lineEl);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const mirrorTool = new MirrorTool();
		mirrorTool.activate(ctx);

		// Phase: 'objects' -> both points and lines are highlightable
		mirrorTool.setPhase('objects');
		let target = manager.update(mirrorTool, vec(0, 0));
		assert.strictEqual(target?.id, p1.id);
		target = manager.update(mirrorTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);

		// Phase: 'mirror_line' -> points rejected, only lines highlightable
		mirrorTool.setPhase('mirror_line');
		target = manager.update(mirrorTool, vec(0, 0));
		assert.strictEqual(target, null);
		target = manager.update(mirrorTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);
	});

	it('CircularPatternTool: highlights primitives in objects phase, only points in center_point phase, disables over checkboxes', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const p1El = createMockSvgElement('g', { 'data-id': p1.id });
		const lineEl = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(p1El);
		svgRoot.appendChild(lineEl);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const circTool = new CircularPatternTool();
		circTool.activate(ctx);

		// Phase: 'objects' -> point and line highlightable
		circTool.setPhase('objects');
		let target = manager.update(circTool, vec(0, 0));
		assert.strictEqual(target?.id, p1.id);
		target = manager.update(circTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);

		// Phase: 'center_point' -> only point highlightable
		circTool.setPhase('center_point');
		target = manager.update(circTool, vec(50, 0));
		assert.strictEqual(target, null);
		target = manager.update(circTool, vec(0, 0));
		assert.strictEqual(target?.id, p1.id);

		// Suppression checkbox hover: disables highlighting
		circTool.state!.suppression = true;
		(ctx.renderer as any).patternCheckboxPositions.set('test_copy', {
			constraintId: null,
			x: 0,
			y: 0,
			copyIndex: 1,
		});
		target = manager.update(circTool, vec(0, 0));
		assert.strictEqual(target, null);
	});

	it('RectangularPatternTool: highlights primitives in objects phase, only lines in direction phases, disables over handles and dragging', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const svgRoot = createMockSvgElement('svg');
		const p1El = createMockSvgElement('g', { 'data-id': p1.id });
		const lineEl = createMockSvgElement('g', { 'data-id': line.id });
		svgRoot.appendChild(p1El);
		svgRoot.appendChild(lineEl);

		const ctx = createMockContext(sketch, svgRoot);
		const manager = new HighlightManager(svgRoot, () => ctx);
		const rectTool = new RectangularPatternTool();
		rectTool.activate(ctx);

		// Phase: 'objects' -> point and line highlightable
		rectTool.setPhase('objects');
		let target = manager.update(rectTool, vec(0, 0));
		assert.strictEqual(target?.id, p1.id);
		target = manager.update(rectTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);

		// Phase: 'direction1' -> only line highlightable
		rectTool.setPhase('direction1');
		target = manager.update(rectTool, vec(0, 0));
		assert.strictEqual(target, null);
		target = manager.update(rectTool, vec(50, 0));
		assert.strictEqual(target?.id, line.id);

		// Over gizmo handle -> disables highlighting
		(ctx.renderer as any).rectangularGizmoHandles.set('handle1', {
			constraintId: null,
			axis: 1,
			x: 50,
			y: 0,
		});
		target = manager.update(rectTool, vec(50, 0));
		assert.strictEqual(target, null);

		// Dragging gizmo -> disables highlighting
		(ctx.renderer as any).rectangularGizmoHandles.clear();
		(rectTool as any).gizmoDragState = {
			axis: 1,
			startMouseWorld: vec(0, 0),
			centroidWorld: vec(0, 0),
			u: vec(1, 0),
			startDistance: 10,
		};
		target = manager.update(rectTool, vec(50, 0));
		assert.strictEqual(target, null);
	});
});

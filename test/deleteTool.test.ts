import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { DeleteTool } from '../src/canvas/tools/modify/delete';
import { HighlightManager } from '../src/canvas/highlightManager';
import { DistanceConstraint, AngleConstraint } from '../src/solver/constraints';
import type { ToolContext, ToolMouseEvent } from '../src/canvas/tools/types';
import { vec, type Vec2 } from '../src/math/vector';
import { COLORS } from '../src/canvas/styles';

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
		getAttribute: (name: string) => (name === 'class' ? Array.from(classNames).join(' ') : (attributes.get(name) ?? null)),
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
					if (sel === '*' || sel.includes(c.tagName.toLowerCase())) {
						res.push(c);
					}
					collect(c);
				}
			}
			collect({ children });
			return res;
		},
		closest: (sel: string) => {
			if (sel === '[data-id]' && attributes.has('data-id')) {
				return createMockSvgElement(tagName, Object.fromEntries(attributes.entries()));
			}
			return null;
		},
		children,
	};
}

function createMockDeleteContext(sketch: SketchDocument): { ctx: ToolContext; toasts: string[] } {
	const toasts: string[] = [];
	const viewport = {
		zoom: 1,
		panX: 0,
		panY: 0,
		worldToScreen: (x: number, y: number) => ({ x, y }),
		screenToWorld: (x: number, y: number) => ({ x, y }),
	};

	const svgObj = {
		querySelectorAll: (sel: string) => [] as any,
		querySelector: (sel: string) => null,
	};
	let ctx: ToolContext;
	const highlightManager = new HighlightManager(svgObj as any, () => ctx);

	ctx = {
		sketch,
		viewport: viewport as any,
		renderer: {
			clearPreviews: () => {},
		} as any,
		svg: svgObj as any,
		highlightManager,
		isConstructionMode: false,
		requestRender: () => {},
		setTool: () => {},
		setCursor: () => {},
		showToast: (msg: string) => {
			toasts.push(msg);
		},
		findSnap: () => null,
		findPointNear: (screen: Vec2, threshold = 16) => {
			let bestD = threshold;
			let bestPt = null;
			for (const p of sketch.points.values()) {
				const d = Math.hypot(screen.x - p.x, screen.y - p.y);
				if (d < bestD) {
					bestD = d;
					bestPt = p;
				}
			}
			return bestPt;
		},
		findLineNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestL = null;
			for (const line of sketch.lines.values()) {
				const d = line.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestL = line;
				}
			}
			return bestL;
		},
		findCircleNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestC = null;
			for (const circle of sketch.circles.values()) {
				const d = circle.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestC = circle;
				}
			}
			return bestC;
		},
		findArcNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestA = null;
			for (const arc of sketch.arcs.values()) {
				const d = arc.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestA = arc;
				}
			}
			return bestA;
		},
		findEllipseNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestE = null;
			for (const ellipse of sketch.ellipses.values()) {
				const d = ellipse.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestE = ellipse;
				}
			}
			return bestE;
		},
		findEllipticalArcNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestEA = null;
			for (const arc of sketch.ellipticalArcs.values()) {
				const d = arc.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestEA = arc;
				}
			}
			return bestEA;
		},
		findSplineNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestS = null;
			for (const spline of sketch.splines.values()) {
				const d = spline.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestS = spline;
				}
			}
			return bestS;
		},
		findConstraintNear: (screen: Vec2, threshold = 18) => {
			let bestD = threshold;
			let bestC = null;
			for (const c of sketch.constraints.values()) {
				if (!c.distanceTo) continue;
				const d = c.distanceTo(screen, sketch, viewport as any, bestD);
				if (d !== null && d < bestD) {
					bestD = d;
					bestC = c;
				}
			}
			return bestC;
		},
		toGeoCurve: (type, id) => sketch.toGeoCurve(id, type),
	};

	return { ctx, toasts };
}

function createToolMouseEvent(screen: Vec2, targetEl?: any): ToolMouseEvent {
	return {
		raw: { target: targetEl ?? {} } as any,
		screen,
		client: screen,
		world: screen,
		snap: null,
		effectiveWorld: screen,
		effectiveScreen: screen,
	};
}

describe('Delete Tool', () => {
	it('has id "delete" and does not snap', () => {
		const tool = new DeleteTool();
		assert.equal(tool.id, 'delete');
		assert.equal(tool.shouldSnap(), false);
	});

	it('detects and deletes a line when clicked in the middle', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const { ctx, toasts } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		const target = ctx.highlightManager!.update(tool, vec(50, 0));
		assert.ok(target);
		assert.equal(target.id, line.id);

		tool.onMouseDown(createToolMouseEvent(vec(50, 0)));
		assert.equal(sketch.lines.has(line.id), false);
		assert.ok(toasts.includes('Deleted'));
	});

	it('prioritizes vertex point when clicked near an endpoint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		sketch.addLine(p1.id, p2.id);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		// Cursor at (2, 1) - within 14px of p1 at (0, 0)
		const target = ctx.highlightManager!.update(tool, vec(2, 1));
		assert.ok(target);
		assert.equal(target.id, p1.id);

		tool.onMouseDown(createToolMouseEvent(vec(2, 1)));
		assert.equal(sketch.points.has(p1.id), false);
	});

	it('detects and deletes a circle', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(50, 50);
		const circle = sketch.addCircle(center.id, 20);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		// Perimeter is at x = 70, y = 50
		const target = ctx.highlightManager!.update(tool, vec(70, 50));
		assert.ok(target);
		assert.equal(target.id, circle.id);

		tool.onMouseDown(createToolMouseEvent(vec(70, 50)));
		assert.equal(sketch.circles.has(circle.id), false);
	});

	it('detects and deletes an arc', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(0, 0);
		const start = sketch.addPoint(20, 0);
		const end = sketch.addPoint(0, 20);
		const arc = sketch.addArc(center.id, start.id, end.id, 20);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		const midAngle = Math.PI / 4;
		const midPos = vec(20 * Math.cos(midAngle), 20 * Math.sin(midAngle));
		const target = ctx.highlightManager!.update(tool, midPos);
		assert.ok(target);
		assert.equal(target.id, arc.id);

		tool.onMouseDown(createToolMouseEvent(midPos));
		assert.equal(sketch.arcs.has(arc.id), false);
	});

	it('detects and deletes a dimensional constraint', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		sketch.addLine(p1.id, p2.id);
		const distConstraint = sketch.addDistanceConstraint(p1.id, p2.id, 100);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		// Distance constraint dimension line is offset (by default offsetScreen = 32px, ny = 1)
		const target = ctx.highlightManager!.update(tool, vec(50, 32));
		assert.ok(target);
		assert.equal(target.id, distConstraint!.id);

		tool.onMouseDown(createToolMouseEvent(vec(50, 32)));
		assert.equal(sketch.constraints.has(distConstraint!.id), false);
	});

	it('detects constraint badge in SVG DOM via bounding rect proximity', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);
		const hConstraint = sketch.addHorizontalConstraint(line.id);
		assert.ok(hConstraint);

		const { ctx } = createMockDeleteContext(sketch);

		// Mock badge element in ctx.svg
		const badgeRect = createMockSvgElement('rect', {
			x: '40',
			y: '-20',
			width: '18',
			height: '18',
		});
		const badgeG = createMockSvgElement('g', {
			class: 'constraint-badge',
			'data-id': hConstraint.id,
			'data-type': 'constraint',
		});
		badgeG.appendChild(badgeRect);

		ctx.svg.querySelectorAll = (sel: string) => {
			if (sel === '.constraint-badge[data-id]') {
				return [badgeG] as any;
			}
			return [] as any;
		};

		const tool = new DeleteTool();
		tool.activate(ctx);

		// Hover near badge rect (45, -15)
		const target = ctx.highlightManager!.update(tool, vec(45, -15));
		assert.ok(target);
		assert.equal(target.id, hConstraint.id);

		tool.onMouseDown(createToolMouseEvent(vec(45, -15)));
		assert.equal(sketch.constraints.has(hConstraint.id), false);
	});

	it('does not target spline handle lines or spline handle points', () => {
		const sketch = new SketchDocument();
		const fitPoints = [
			sketch.addPoint(0, 0),
			sketch.addPoint(50, 50),
			sketch.addPoint(100, 0),
		];
		const spline = sketch.addFitSpline(fitPoints.map(p => p.id));
		assert.ok(spline);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		// Tangent lines should not be deleted
		assert.ok(spline.tangentLineIds && spline.tangentLineIds.length > 0);
		const handleLine = sketch.lines.get(spline.tangentLineIds[0]);
		assert.ok(handleLine);

		const hp1 = sketch.points.get(handleLine.p1Id)!;
		const midHandle = vec((hp1.x + 1), (hp1.y + 1));
		const target = ctx.highlightManager!.update(tool, midHandle);
		if (target) {
			assert.notEqual(target.id, handleLine.id);
			assert.notEqual(target.id, handleLine.p1Id);
			assert.notEqual(target.id, handleLine.p2Id);
		}
	});

	it('highlights hovered element with delete-hover class', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const lineEl = createMockSvgElement('g', { 'data-id': line.id });
		const { ctx } = createMockDeleteContext(sketch);
		ctx.svg.querySelectorAll = (sel: string) => {
			if (sel === `[data-id="${line.id}"]`) return [lineEl];
			return [];
		};

		const tool = new DeleteTool();
		tool.activate(ctx);

		assert.equal(tool.isHighlightEnabled(), true);
		assert.equal(tool.getHighlightClass({ type: 'line', id: line.id }), 'delete-hover');
		assert.equal(tool.canHighlight({ type: 'line', id: line.id }), true);

		ctx.highlightManager!.update(tool, vec(50, 0));
		assert.ok(lineEl.classList.contains('delete-hover'));

		tool.cancel();
		assert.equal(lineEl.classList.contains('delete-hover'), false);
	});

	it('supports undo/redo after deleting an entity', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const line = sketch.addLine(p1.id, p2.id);

		const { ctx } = createMockDeleteContext(sketch);
		const tool = new DeleteTool();
		tool.activate(ctx);

		tool.onMouseDown(createToolMouseEvent(vec(50, 0)));
		assert.equal(sketch.lines.has(line.id), false);

		sketch.undo();
		assert.equal(sketch.lines.has(line.id), true);

		sketch.redo();
		assert.equal(sketch.lines.has(line.id), false);
	});
});

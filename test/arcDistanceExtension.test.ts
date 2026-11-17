import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import { Viewport } from '../src/canvas/viewport';
import { findConstraintNear } from '../src/canvas/hitTesting';
import { SelectTool, type SelectInteractionHost } from '../src/canvas/tools/selection/select';
import { renderLinearDimensionVisual, type LinearDimensionVisualOptions } from '../src/canvas/dimensionGeometry';

class SvgElement {
	attributes: Record<string, string> = {};
	children: SvgElement[] = [];
	textContent = '';
	style = {};
	constructor(readonly tag: string) {}
	setAttribute(name: string, value: string) {
		this.attributes[name] = String(value);
	}
	appendChild(child: SvgElement) {
		this.children.push(child);
	}
}

for (const clockwise of [false, true]) {
	for (const startAngle of [0, Math.PI * 0.75]) {
		for (const beyondEnd of [false, true]) {
			test(`radial gap continues an arc to its arrow (clockwise=${clockwise}, start=${startAngle}, end=${beyondEnd})`, () => {
				const sketch = new SketchDocument();
				const center = sketch.addPoint(new Vec2());
				const sign = clockwise ? 1 : -1;
				const endAngle = startAngle + (sign * Math.PI) / 2;
				const start = sketch.addPoint(Vec2.fromPolar(100, -startAngle));
				const end = sketch.addPoint(Vec2.fromPolar(100, -endAngle));
				const arc = sketch.addArc(center.id, start.id, end.id, 100, clockwise);
				const circle = sketch.addCircle(center.id, 250);
				const c = sketch.addCircleDistanceConstraint(arc.id, circle.id)!;
				const viewport = Object.assign(new Viewport(800, 600), { zoom: 1, panX: 0, panY: 0 });
				const angle = beyondEnd ? endAngle + (sign * Math.PI) / 4 : startAngle - (sign * Math.PI) / 4;
				const cursor = Vec2.fromPolar(300, angle);
				c.moveLabelTo(cursor, sketch, viewport);
				let visual: LinearDimensionVisualOptions | undefined;
				c.renderDimension(sketch, viewport, {} as SVGGElement, false, options => {
					visual = options;
				});
				assert.ok(visual);
				assert.deepEqual(visual.extensionLines, [], 'radial arrows have no straight tangent caps');
				assert.equal(visual.arcExtensions?.length, 1);
				const extension = visual.arcExtensions![0];
				const endpoint = beyondEnd ? endAngle : startAngle;
				assert.ok(extension.from.distanceTo(Vec2.fromPolar(100, endpoint)) < 1e-7);
				assert.equal(extension.clockwise, beyondEnd ? clockwise : !clockwise);
				assert.ok(visual.d1.distanceTo(Vec2.fromPolar(100, angle)) < 1e-7);
				assert.ok(visual.d2.distanceTo(Vec2.fromPolar(250, angle)) < 1e-7);
				const overshoot = beyondEnd ? sign : -sign;
				assert.ok(extension.to.distanceTo(Vec2.fromPolar(100, angle + overshoot * 0.04)) < 1e-7);
				assert.ok(c.distanceTo(Vec2.fromPolar(100, (angle + endpoint) / 2), sketch, viewport)! < 1e-7);
				const previous = globalThis.document;
				const parent = new SvgElement('g');
				try {
					globalThis.document = {
						createElementNS: (_ns: string, tag: string) => new SvgElement(tag),
					} as unknown as Document;
					renderLinearDimensionVisual({ ...visual, parent: parent as unknown as SVGGElement });
				} finally {
					globalThis.document = previous;
				}
				const children = parent.children[0].children;
				const path = children.find(child => child.attributes.class === 'dimension-arc-extension');
				assert.ok(path);
				assert.ok(path.attributes.d.includes(' A 100.00 100.00 '));
				assert.equal(path.attributes.fill, 'none');
				assert.ok(
					children
						.filter(child => child.tag === 'line')
						.every(child => {
							const from = new Vec2(Number(child.attributes.x1), Number(child.attributes.y1));
							const to = new Vec2(Number(child.attributes.x2), Number(child.attributes.y2));
							return Math.abs(from.cross(to)) < 1e-5;
						}),
					'all straight dimension lines stay on the radial ray'
				);
				for (const visibleAngle of [startAngle, endAngle, startAngle + (sign * Math.PI) / 4]) {
					c.moveLabelTo(Vec2.fromPolar(300, visibleAngle), sketch, viewport);
					c.renderDimension(sketch, viewport, {} as SVGGElement, false, options => {
						visual = options;
					});
					assert.deepEqual(visual.arcExtensions, [], 'no continuation on the existing sweep or its endpoints');
				}
			});
		}
	}
}

test('radial gap extends each arc independently and scales its continuation with zoom', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2());
	const arcs = [100, 250].map(radius =>
		sketch.addArc(
			center.id,
			sketch.addPoint(new Vec2(radius, 0)).id,
			sketch.addPoint(new Vec2(0, radius)).id,
			radius,
			false
		)
	);
	const c = sketch.addCircleDistanceConstraint(arcs[0].id, arcs[1].id)!;
	const viewport = new Viewport(800, 600);
	viewport.zoom = 3;
	c.moveLabelTo(viewport.worldToScreen(new Vec2(0, -300)), sketch, viewport);
	c.renderDimension(sketch, viewport, {} as SVGGElement, false, options => {
		assert.deepEqual(options.extensionLines, []);
		assert.deepEqual(
			options.arcExtensions?.map(extension => extension.radius),
			[300, 750]
		);
		for (const extension of options.arcExtensions!) {
			assert.ok(Math.abs(extension.to.distanceTo(extension.center) - extension.radius) < 1e-7);
		}
	});
});

test('clicking empty canvas deselects an arc-to-arc distance with visible arc extensions', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2());
	const arcs = [100, 250].map(radius =>
		sketch.addArc(
			center.id,
			sketch.addPoint(new Vec2(radius, 0)).id,
			sketch.addPoint(new Vec2(0, radius)).id,
			radius,
			false
		)
	);
	const c = sketch.addCircleDistanceConstraint(arcs[0].id, arcs[1].id)!;
	const viewport = new Viewport(800, 600);
	c.moveLabelTo(viewport.worldToScreen(new Vec2(0, -300)), sketch, viewport);
	const extensionPoint = viewport.worldToScreen(Vec2.fromPolar(100, -Math.PI / 4));
	assert.equal(findConstraintNear(sketch, viewport, extensionPoint), c, 'curved extension remains selectable');
	const empty = viewport.worldToScreen(new Vec2(-500, 500));
	assert.ok(c.distanceTo(empty, sketch, viewport)! > 100);
	assert.equal(findConstraintNear(sketch, viewport, empty), null);
	sketch.selectEntity(c.id, 'constraint', false);
	const host = {
		sketch,
		viewport,
		activeTool: 'select',
		findSnap: () => null,
		render: () => {},
	} as unknown as SelectInteractionHost;
	SelectTool.handleMouseDown(
		host,
		{ target: { closest: () => null, getAttribute: () => null } } as unknown as MouseEvent,
		empty,
		null
	);
	assert.equal(sketch.selection.constraintIds.size, 0);
	assert.equal(host.isDraggingConstraint, undefined);
	assert.equal(host.isBoxSelecting, true);
});

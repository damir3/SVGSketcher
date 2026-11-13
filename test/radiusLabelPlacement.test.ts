import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasInteraction } from '../src/canvas/interaction';
import { Viewport } from '../src/canvas/viewport';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { RadiusConstraint } from '../src/solver/constraints/radius';
import { serializeConstraint, deserializeConstraint } from '../src/solver/constraints/serialization';

class SvgElement {
	attributes: Record<string, string> = {};
	children: SvgElement[] = [];
	style = {};
	constructor(readonly tag: string) {}
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	appendChild(child: SvgElement) {
		this.children.push(child);
	}
}

function render(constraint: RadiusConstraint, sketch: SketchDocument, viewport: Viewport) {
	const previous = globalThis.document;
	const parent = new SvgElement('g');
	try {
		globalThis.document = { createElementNS: (_ns: string, tag: string) => new SvgElement(tag) } as unknown as Document;
		constraint.renderDimension(sketch, viewport, parent as unknown as SVGGElement);
	} finally {
		globalThis.document = previous;
	}
	return parent.children[0].children;
}

for (const mode of ['radius', 'diameter'] as const) {
	for (const zoom of [1, 3]) {
		test(`${mode} follows the cursor inside and at the shelf start outside, zoom=${zoom}`, () => {
			const sketch = new SketchDocument();
			const center = sketch.addPoint(new Vec2(0, 0));
			const circle = sketch.addCircle(center.id, 100);
			const constraint = sketch.addRadiusConstraint(circle.id, 100, mode)!;
			const viewport = Object.assign(new Viewport(800, 600), { zoom, panX: 0, panY: 0 });
			const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
				sketch,
				viewport,
				isDraggingConstraint: true,
				draggedConstraintId: constraint.id,
				hasDragged: true,
				getScreenPos: (e: { position: Vec2 }) => e.position,
				isSnapModifier: () => false,
				render: () => {},
			});
			for (const cursor of [
				new Vec2(30, 20),
				new Vec2(-25, -15),
				new Vec2(0, 0),
				new Vec2(200 * zoom, 40),
				new Vec2(-200 * zoom, -40),
			]) {
				interaction['handleMouseMove']({ position: cursor } as unknown as MouseEvent);
				const anchor = constraint.getLabelAnchor(sketch, viewport)!;
				assert.ok(anchor.distanceTo(cursor) < 1e-8);
				const elements = render(constraint, sketch, viewport);
				if (cursor.length() < 100 * zoom) {
					const label = elements.find(el => el.attributes.class === 'dimension-label')!;
					const [x, y] = label.attributes.transform
						.match(/translate\(([^,]+), ([^)]+)\)/)!
						.slice(1)
						.map(Number);
					let angle = Math.atan2(cursor.y, cursor.x);
					if (cursor.length() === 0) angle = constraint.leaderAngle!;
					if (angle > Math.PI / 2 - 1e-4) angle -= Math.PI;
					else if (angle <= -Math.PI / 2) angle += Math.PI;
					assert.ok(Math.hypot(x - cursor.x - 8.5 * Math.sin(angle), y - cursor.y + 8.5 * Math.cos(angle)) < 0.11);
					const lines = elements.filter(el => el.tag === 'line');
					assert.equal(lines.length, 1, 'inside dimension line stays continuous');
					assert.ok(constraint.distanceTo(new Vec2(x, y), sketch, viewport)! < 1e-8);
					assert.ok(constraint.distanceTo(cursor, sketch, viewport)! < 1e-8);
				} else {
					const shelf = elements.filter(el => el.tag === 'line').at(-1)!;
					assert.equal(Number(shelf.attributes.x1), cursor.x);
					assert.equal(Number(shelf.attributes.y1), cursor.y);
					assert.equal(shelf.attributes.y1, shelf.attributes.y2);
				}
			}
		});
	}
}

test('new labels stay inside near the cursor, fit at the rim, and retain their position after reload', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(0, 0));
	const circle = sketch.addCircle(center.id, 100);
	const viewport = Object.assign(new Viewport(800, 600), { zoom: 1, panX: 0, panY: 0 });
	const constraint = sketch.addRadiusConstraint(circle.id, 100, 'diameter')!;
	for (const cursor of [new Vec2(300, 0), new Vec2(-300, 0), new Vec2(0, 300), new Vec2(0, -300)]) {
		constraint.placeLabelInsideNear(cursor, sketch, viewport);
		const anchor = constraint.getLabelAnchor(sketch, viewport)!;
		assert.ok(anchor.length() > 50 && anchor.length() < 100);
		assert.ok(anchor.dot(cursor) > 0);
		const restored = deserializeConstraint(serializeConstraint(constraint)) as RadiusConstraint;
		assert.ok(restored.getLabelAnchor(sketch, viewport)!.distanceTo(anchor) < 1e-8);
	}
	constraint.moveLabelTo(new Vec2(99, 0), sketch, viewport);
	const anchor = constraint.getLabelAnchor(sketch, viewport)!;
	assert.ok(anchor.x < 99 && anchor.x > 50, 'label clamps inward when its center alone would fit');
});

test('arc labels follow the cursor outside the sweep while the arrow stays on the arc', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2(0, 0));
	const start = sketch.addPoint(new Vec2(100, 0));
	const end = sketch.addPoint(new Vec2(0, 100));
	const arc = sketch.addArc(center.id, start.id, end.id, 100, false);
	const viewport = Object.assign(new Viewport(800, 600), { zoom: 1, panX: 0, panY: 0 });
	const constraint = sketch.addRadiusConstraint(arc.id, 100)!;
	for (const cursor of [new Vec2(-30, -20), new Vec2(-200, -80)]) {
		constraint.moveLabelTo(cursor, sketch, viewport);
		assert.ok(constraint.getLabelAnchor(sketch, viewport)!.distanceTo(cursor) < 1e-8);
		const elements = render(constraint, sketch, viewport);
		const radial = elements.find(el => el.attributes['marker-end'])!;
		assert.equal(Number(radial.attributes.x2), 0);
		assert.equal(Number(radial.attributes.y2), -100);
		assert.ok(constraint.distanceTo(cursor, sketch, viewport)! < 1e-8);
	}
});

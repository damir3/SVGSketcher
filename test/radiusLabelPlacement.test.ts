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

for (const clockwise of [false, true]) {
	for (const startAngle of [0, Math.PI * 0.75]) {
		for (const beyondEnd of [false, true]) {
			test(`arc extension follows the nearest endpoint: clockwise=${clockwise}, start=${startAngle}, end=${beyondEnd}`, () => {
				const sketch = new SketchDocument();
				const center = sketch.addPoint(new Vec2(0, 0));
				const sign = clockwise ? 1 : -1;
				const endAngle = startAngle + (sign * Math.PI) / 2;
				const start = sketch.addPoint(Vec2.fromPolar(100, -startAngle));
				const end = sketch.addPoint(Vec2.fromPolar(100, -endAngle));
				const arc = sketch.addArc(center.id, start.id, end.id, 100, clockwise);
				const viewport = Object.assign(new Viewport(800, 600), { zoom: 1, panX: 0, panY: 0 });
				const constraint = sketch.addRadiusConstraint(arc.id, 100)!;
				const angle = beyondEnd ? endAngle + (sign * Math.PI) / 4 : startAngle - (sign * Math.PI) / 4;
				for (const distance of [40, 200]) {
					const cursor = Vec2.fromPolar(distance, angle);
					constraint.moveLabelTo(cursor, sketch, viewport);
					assert.ok(constraint.getLabelAnchor(sketch, viewport)!.distanceTo(cursor) < 1e-8);
					const elements = render(constraint, sketch, viewport);
					const arrow = elements.find(el => el.attributes['marker-end'])!;
					const edge = Vec2.fromPolar(100, angle);
					assert.ok(new Vec2(Number(arrow.attributes.x2), Number(arrow.attributes.y2)).distanceTo(edge) < 0.1);
					const arrowStart = new Vec2(Number(arrow.attributes.x1), Number(arrow.attributes.y1));
					assert.ok(
						arrowStart.distanceTo(distance > 100 ? cursor : new Vec2()) < 0.1,
						'outside arrow points inward from the leader, inside arrow points outward from the center'
					);
					const extension = elements.find(el => el.tag === 'path')!;
					assert.ok(extension, 'extends the arc instead of clamping the arrow to an endpoint');
					const [x, y] = extension.attributes.d
						.match(/^M ([^ ]+) ([^ ]+)/)!
						.slice(1)
						.map(Number);
					const endpointAngle = beyondEnd ? endAngle : startAngle;
					assert.ok(new Vec2(x, y).distanceTo(Vec2.fromPolar(100, endpointAngle)) < 0.01);
					const midpoint = Vec2.fromPolar(100, (angle + endpointAngle) / 2);
					assert.ok(constraint.distanceTo(midpoint, sketch, viewport)! < 1e-8, 'curved extension can be selected');
				}
				constraint.moveLabelTo(Vec2.fromPolar(200, startAngle + (sign * Math.PI) / 4), sketch, viewport);
				assert.ok(
					!render(constraint, sketch, viewport).some(el => el.tag === 'path'),
					'no extension within the arc sweep'
				);
			});
		}
	}
}

test('arc diameter arrows stay inside even when the label is outside the arc and its sweep', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2());
	const start = sketch.addPoint(new Vec2(100, 0));
	const end = sketch.addPoint(new Vec2(0, 100));
	const arc = sketch.addArc(center.id, start.id, end.id, 100, false);
	const viewport = Object.assign(new Viewport(800, 600), { zoom: 1, panX: 0, panY: 0 });
	const constraint = sketch.addRadiusConstraint(arc.id, 100, 'diameter')!;
	for (const cursor of [new Vec2(30, -20), new Vec2(200, -80), new Vec2(-200, -80)]) {
		constraint.moveLabelTo(cursor, sketch, viewport);
		const lines = render(constraint, sketch, viewport).filter(el => el.tag === 'line');
		const diameter = lines.find(el => el.attributes['marker-start'])!;
		assert.ok(diameter.attributes['marker-end'], 'both arrowheads belong to the diameter line');
		const a = new Vec2(Number(diameter.attributes.x1), Number(diameter.attributes.y1));
		const b = new Vec2(Number(diameter.attributes.x2), Number(diameter.attributes.y2));
		assert.ok(a.clone().add(b).length() < 0.1, 'diameter line joins opposite sides through the center');
		assert.ok(Math.abs(a.length() - 100) < 0.1);
		assert.ok(
			lines.filter(el => el !== diameter).every(el => !el.attributes['marker-start'] && !el.attributes['marker-end']),
			'leader and shelf have no external arrows'
		);
	}
});

for (const kind of ['circle', 'arc'] as const) {
	for (const zoom of [1, 2, 4]) {
		test(`${kind} diameter arrows flip only when the screen diameter is below 40px, zoom=${zoom}`, () => {
			const sketch = new SketchDocument();
			const radius = 10;
			const center = sketch.addPoint(new Vec2());
			const start = sketch.addPoint(new Vec2(radius, 0));
			const end = sketch.addPoint(new Vec2(0, radius));
			const entity =
				kind === 'circle'
					? sketch.addCircle(center.id, radius)
					: sketch.addArc(center.id, start.id, end.id, radius, false);
			const constraint = sketch.addRadiusConstraint(entity.id, radius, 'diameter')!;
			const viewport = Object.assign(new Viewport(800, 600), { zoom, panX: 0, panY: 0 });
			for (const angle of [0, Math.PI / 4, Math.PI]) {
				constraint.leaderAngle = angle;
				constraint.leaderOffset = 50;
				const lines = render(constraint, sketch, viewport).filter(el => el.tag === 'line');
				const arrows = lines.filter(el => el.attributes['marker-start'] || el.attributes['marker-end']);
				const outside = radius * zoom * 2 < 40;
				assert.equal(arrows.length, outside ? 2 : 1);
				if (outside) {
					for (const arrow of arrows) {
						const from = new Vec2(Number(arrow.attributes.x1), Number(arrow.attributes.y1));
						const to = new Vec2(Number(arrow.attributes.x2), Number(arrow.attributes.y2));
						assert.ok(from.length() > radius * zoom);
						assert.ok(Math.abs(to.length() - radius * zoom) < 0.1);
						assert.ok(Math.abs(from.distanceTo(to) - 24) < 0.1);
						assert.ok(!arrow.attributes['marker-start']);
					}
					const tail = Vec2.fromPolar(radius * zoom + 22, angle + Math.PI);
					assert.ok(constraint.distanceTo(tail, sketch, viewport)! < 1e-8, 'outside arrow tails can be selected');
				} else {
					assert.ok(arrows[0].attributes['marker-start'] && arrows[0].attributes['marker-end']);
				}
			}
		});
	}
}

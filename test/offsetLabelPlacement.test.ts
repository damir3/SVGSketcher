import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SketchDocument } from '../src/model/sketch';
import { Vec2 } from '../src/math/vector';
import { SelectTool, type SelectInteractionHost } from '../src/canvas/tools/selection/select';
import { findConstraintNear } from '../src/canvas/hitTesting';
import { renderLinearDimensionVisual } from '../src/canvas/dimensionGeometry';
import type { ConstraintRenderContext } from '../src/solver/constraints/renderContext';
import { Viewport } from '../src/canvas/viewport';
import { OffsetConstraint, type OffsetPair } from '../src/solver/constraints/offset';
import { serializeConstraint, deserializeConstraint } from '../src/solver/constraints/serialization';

const viewport = Object.assign(new Viewport(800, 600), { zoom: 2, panX: 50, panY: 300 });

function linePair(sketch: SketchDocument, a: Vec2, b: Vec2, c: Vec2, d: Vec2): OffsetPair {
	const [p1, p2, p3, p4] = [a, b, c, d].map(p => sketch.addPoint(p));
	return {
		kind: 'line',
		origLineId: sketch.addLine(p1.id, p2.id).id,
		origP1Id: p1.id,
		origP2Id: p2.id,
		offLineId: sketch.addLine(p3.id, p4.id).id,
		offP1Id: p3.id,
		offP2Id: p4.id,
		side: 1,
	};
}

test('offset label moves freely, follows the nearest contour segment, and survives serialization', () => {
	const sketch = new SketchDocument();
	const pairs = [
		linePair(sketch, new Vec2(0, 0), new Vec2(100, 0), new Vec2(0, 10), new Vec2(100, 10)),
		linePair(sketch, new Vec2(100, 0), new Vec2(100, 100), new Vec2(90, 0), new Vec2(90, 100)),
	];
	const constraint = new OffsetConstraint('offset', pairs, 10);
	constraint.moveLabelTo(viewport.worldToScreen(new Vec2(30, -40)), sketch, viewport);
	assert.deepEqual(constraint.getDimensionWorldPoints(sketch), { a: new Vec2(30, 0), b: new Vec2(30, 10) });
	const cursor = viewport.worldToScreen(new Vec2(140, 70));
	constraint.moveLabelTo(cursor, sketch, viewport);
	assert.deepEqual(constraint.getLabelScreenPos(sketch, viewport), cursor.clone().add(new Vec2(0, -8.5)));
	assert.deepEqual(constraint.getDimensionWorldPoints(sketch), { a: new Vec2(100, 70), b: new Vec2(90, 70) });
	assert.equal(constraint.distanceTo(cursor, sketch, viewport), 0);
	const restored = deserializeConstraint(serializeConstraint(constraint)) as OffsetConstraint;
	assert.deepEqual(restored.getLabelScreenPos(sketch, viewport), constraint.getLabelScreenPos(sketch, viewport));
	assert.deepEqual(restored.getDimensionWorldPoints(sketch), constraint.getDimensionWorldPoints(sketch));
	assert.equal(constraint.targetDistance, 10);
});

test('offset leader clamps to finite segment endpoints beyond the contour', () => {
	const sketch = new SketchDocument();
	const pair = linePair(sketch, new Vec2(0, 0), new Vec2(100, 0), new Vec2(0, 10), new Vec2(100, 10));
	const constraint = new OffsetConstraint('offset', [pair], 10);
	constraint.moveLabelTo(viewport.worldToScreen(new Vec2(200, 40)), sketch, viewport);
	assert.deepEqual(constraint.getDimensionWorldPoints(sketch), { a: new Vec2(100, 0), b: new Vec2(100, 10) });
});

test('offset arc attachment follows the cursor and clamps outside the sweep', () => {
	const sketch = new SketchDocument();
	const center = sketch.addPoint(new Vec2());
	const addArc = (radius: number) => {
		const start = sketch.addPoint(new Vec2(radius, 0));
		const end = sketch.addPoint(new Vec2(0, radius));
		return sketch.addArc(center.id, start.id, end.id, radius, false);
	};
	const original = addArc(50);
	const offset = addArc(60);
	const constraint = new OffsetConstraint(
		'offset',
		[
			{
				kind: 'circle',
				origId: original.id,
				offId: offset.id,
				origCenterId: center.id,
				offCenterId: center.id,
				side: 1,
			},
		],
		10
	);
	constraint.moveLabelTo(viewport.worldToScreen(new Vec2(100, 100)), sketch, viewport);
	let points = constraint.getDimensionWorldPoints(sketch)!;
	assert.ok(points.a.distanceTo(Vec2.fromPolar(50, Math.PI / 4)) < 1e-8);
	assert.ok(points.b.distanceTo(Vec2.fromPolar(60, Math.PI / 4)) < 1e-8);
	constraint.moveLabelTo(viewport.worldToScreen(new Vec2(-100, 20)), sketch, viewport);
	points = constraint.getDimensionWorldPoints(sketch)!;
	assert.ok(points.a.distanceTo(new Vec2(0, 50)) < 1e-8);
	assert.ok(points.b.distanceTo(new Vec2(0, 60)) < 1e-8);
});

test('grabbing the initial offset text starts a drag and moves the label', () => {
	const sketch = new SketchDocument();
	const pair = linePair(sketch, new Vec2(0, 0), new Vec2(100, 0), new Vec2(0, 10), new Vec2(100, 10));
	const constraint = new OffsetConstraint('offset', [pair], 10);
	sketch.constraints.set(constraint.id, constraint);
	// The text is 8.5px to the right of the vertical dimension, beyond the 8px line hit threshold.
	const initialText = viewport.worldToScreen(new Vec2(50, 5)).add(new Vec2(8.5, 0));
	assert.deepEqual(constraint.getLabelScreenPos(sketch, viewport), initialText);
	assert.equal(findConstraintNear(sketch, viewport, initialText), constraint);
	const host = {
		sketch,
		viewport,
		activeTool: 'select',
		findSnap: () => null,
		render: () => {},
	} as unknown as SelectInteractionHost;
	const event = { target: { closest: () => null, getAttribute: () => null } } as unknown as MouseEvent;
	SelectTool.handleMouseDown(host, event, initialText, null);
	assert.equal(host.isDraggingConstraint, true);
	assert.equal(host.draggedConstraintId, constraint.id);
	assert.ok(host.preDragSnapshot);
	const cursor = viewport.worldToScreen(new Vec2(80, 80));
	const expectedLabel = cursor.clone().add(new Vec2(8.5, 0));
	assert.equal(SelectTool.handleDragMouseMove(host, event, cursor, viewport.screenToWorld(cursor)), true);
	assert.deepEqual(constraint.getLabelScreenPos(sketch, viewport), expectedLabel);
	SelectTool.handleMouseUp(host);
	assert.equal(host.isDraggingConstraint, false);
	assert.deepEqual(constraint.getLabelScreenPos(sketch, viewport), expectedLabel);
});

class SvgElement {
	attributes: Record<string, string> = {};
	children: SvgElement[] = [];
	style = {};
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	appendChild(child: SvgElement) {
		this.children.push(child);
	}
}

for (const cursorWorld of [new Vec2(30, -40), new Vec2(200, 40)]) {
	test(`moved offset dimension keeps every line collinear at ${cursorWorld.x},${cursorWorld.y}`, () => {
		const sketch = new SketchDocument();
		const pair = linePair(sketch, new Vec2(0, 0), new Vec2(100, 0), new Vec2(0, 10), new Vec2(100, 10));
		const constraint = new OffsetConstraint('offset', [pair], 10);
		constraint.moveLabelTo(viewport.worldToScreen(cursorWorld), sketch, viewport);
		const parent = new SvgElement();
		const previous = globalThis.document;
		try {
			globalThis.document = { createElementNS: () => new SvgElement() } as unknown as Document;
			constraint.render({
				sketch,
				viewport,
				targetGroup: parent,
				isSelected: false,
				renderLinearDimensionVisual,
			} as unknown as ConstraintRenderContext);
		} finally {
			globalThis.document = previous;
		}
		const points = constraint.getDimensionWorldPoints(sketch)!;
		const start = viewport.worldToScreen(points.a);
		const direction = viewport.worldToScreen(points.b).sub(start);
		const lines = parent.children[0].children.filter(child => child.attributes.x1 !== undefined);
		assert.ok(lines.length > 1, 'dimension includes a straight extension for the moved text');
		for (const line of lines) {
			for (const end of ['1', '2']) {
				const point = new Vec2(Number(line.attributes['x' + end]), Number(line.attributes['y' + end]));
				assert.ok(Math.abs(point.sub(start).cross(direction)) < 1e-7, 'no angled leader or horizontal shelf');
			}
		}
		assert.equal(constraint.distanceTo(constraint.getLabelScreenPos(sketch, viewport), sketch, viewport), 0);
	});
}

for (const skew of [false, true]) {
	for (const reverse of [false, true]) {
		test(`corner offset chooses the nearest normal instead of the vertex diagonal (skew=${skew}, reverse=${reverse})`, () => {
			const sketch = new SketchDocument();
			const tangents = skew
				? [new Vec2(0.1, 1).normalize(), new Vec2(-1, -0.7).normalize()]
				: [new Vec2(0, 1), new Vec2(-1, 0)];
			const normals = [new Vec2(tangents[0].y, -tangents[0].x), new Vec2(-tangents[1].y, tangents[1].x)];
			const determinant = normals[0].cross(normals[1]);
			const corner = new Vec2(
				(10 * (normals[1].y - normals[0].y)) / determinant,
				(10 * (normals[0].x - normals[1].x)) / determinant
			);
			const pairs = tangents.map(tangent => {
				const origEnd = tangent.clone().multiplyScalar(100);
				const offEnd = corner.clone().addScaledVector(tangent, 100);
				return reverse
					? linePair(sketch, origEnd, new Vec2(), offEnd, corner)
					: linePair(sketch, new Vec2(), origEnd, corner, offEnd);
			});
			const constraint = new OffsetConstraint('corner', reverse ? pairs.slice().reverse() : pairs, 10);
			for (let i = 0; i < 2; i++) {
				const cursor = normals[i]
					.clone()
					.multiplyScalar(50)
					.addScaledVector(normals[1 - i], 15);
				constraint.moveLabelTo(viewport.worldToScreen(cursor), sketch, viewport);
				const points = constraint.getDimensionWorldPoints(sketch)!;
				const dimension = points.b.clone().sub(points.a);
				assert.ok(Math.abs(dimension.length() - 10) < 1e-8, 'arrow span equals the offset, not the corner diagonal');
				assert.ok(
					Math.abs(dimension.dot(tangents[i])) < 1e-8,
					'dimension is perpendicular to the nearest correct side'
				);
				assert.ok(points.a.length() < 1e-8, 'normal starts at the original corner');
				assert.ok(
					points.b.distanceTo(normals[i].clone().multiplyScalar(10)) < 1e-8,
					'offset arrow lies inside the side rather than at its corner'
				);
			}
		});
	}
}

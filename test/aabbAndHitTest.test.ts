import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasInteraction } from '../src/canvas/interaction';
import { Viewport } from '../src/canvas/viewport';
import {
	pointIntersectsAABB,
	segmentIntersectsAABB,
	circleIntersectsAABB,
	arcIntersectsAABB,
	ellipseIntersectsAABB,
	ellipticalArcIntersectsAABB,
} from '../src/math/aabb';
import {
	distanceToPoint,
	distanceToSegment,
	distanceToCircle,
	distanceToArc,
	distanceToEllipse,
	distanceToEllipticalArc,
	distanceToLinearDimension,
} from '../src/math/hitTest';
import { Vec2 } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';
import { RadiusConstraint } from '../src/solver/constraints/radius';
import { DimensionTool } from '../src/canvas/tools/constraints/dimension';

it('box selection requires containment from the left and includes crossings from the right', () => {
	const sketch = new SketchDocument();
	const viewport = new Viewport(800, 600);
	const interaction: CanvasInteraction = Object.assign(Object.create(CanvasInteraction.prototype), {
		sketch,
		viewport,
	});
	const inside = sketch.addPoint(new Vec2(12, 12));
	const outside = sketch.addPoint(new Vec2(25, 12));
	const line = sketch.addLine(inside.id, outside.id);
	const circle = sketch.addCircle(inside.id, 3);
	const center = sketch.addPoint(new Vec2(0, 0));
	const arcStart = sketch.addPoint(new Vec2(12, 16));
	const arcEnd = sketch.addPoint(new Vec2(16, 12));
	const arc = sketch.addArc(center.id, arcStart.id, arcEnd.id, 20, true);
	const longArc = sketch.addArc(center.id, arcStart.id, arcEnd.id, 20, false);
	const left = viewport.worldToScreen(new Vec2(10, 20));
	const right = viewport.worldToScreen(new Vec2(20, 10));

	interaction['finishBoxSelection'](left, right, false);
	assert.ok(sketch.selection.pointIds.has(inside.id));
	assert.ok(!sketch.selection.lineIds.has(line.id));
	assert.ok(!sketch.selection.circleIds.has(circle.id));
	assert.deepEqual([...sketch.selection.arcIds], [arc.id]);

	interaction['finishBoxSelection'](right, left, false);
	assert.ok(sketch.selection.lineIds.has(line.id));
	assert.ok(sketch.selection.circleIds.has(circle.id));
	assert.ok(sketch.selection.arcIds.has(longArc.id));
});

describe('AABB Geometry Intersections', () => {
	const min = new Vec2(10, 10);
	const max = new Vec2(50, 50);

	it('pointIntersectsAABB detects points inside, on boundary, and outside', () => {
		assert.equal(pointIntersectsAABB(new Vec2(25, 25), min, max), true);
		assert.equal(pointIntersectsAABB(new Vec2(10, 50), min, max), true);
		assert.equal(pointIntersectsAABB(new Vec2(5, 25), min, max), false);
		assert.equal(pointIntersectsAABB(new Vec2(25, 60), min, max), false);
	});

	it('segmentIntersectsAABB detects segments inside, crossing, and outside', () => {
		// Inside
		assert.equal(segmentIntersectsAABB(new Vec2(20, 20), new Vec2(40, 40), min, max), true);
		// Crossing completely through
		assert.equal(segmentIntersectsAABB(new Vec2(0, 30), new Vec2(60, 30), min, max), true);
		// Diagonal crossing
		assert.equal(segmentIntersectsAABB(new Vec2(0, 0), new Vec2(60, 60), min, max), true);
		// Completely outside
		assert.equal(segmentIntersectsAABB(new Vec2(0, 0), new Vec2(5, 5), min, max), false);
		assert.equal(segmentIntersectsAABB(new Vec2(60, 10), new Vec2(60, 50), min, max), false);
		// Skimming outside near corner
		assert.equal(segmentIntersectsAABB(new Vec2(0, 60), new Vec2(60, 0), min, max), true);
		assert.equal(segmentIntersectsAABB(new Vec2(0, 110), new Vec2(110, 0), min, max), false);
	});

	it('circleIntersectsAABB detects circles intersecting or outside', () => {
		// Center inside
		assert.equal(circleIntersectsAABB(new Vec2(25, 25), 5, min, max), true);
		// Center outside, edge crossing
		assert.equal(circleIntersectsAABB(new Vec2(0, 25), 15, min, max), true);
		// Center outside, not reaching
		assert.equal(circleIntersectsAABB(new Vec2(0, 25), 8, min, max), false);
		// Center outside, radius encompasses the entire AABB without intersecting border
		assert.equal(circleIntersectsAABB(new Vec2(-50, -50), 200, min, max), false);
	});

	it('arcIntersectsAABB respects angular span of the arc', () => {
		const center = new Vec2(0, 30);
		const radius = 20;
		// Circle reaches x=10..20, inside AABB
		// Arc 1: Facing right towards AABB (-45 deg to +45 deg)
		const startRight = new Vec2(radius * Math.cos(-Math.PI / 4), 30 + radius * Math.sin(-Math.PI / 4));
		const endRight = new Vec2(radius * Math.cos(Math.PI / 4), 30 + radius * Math.sin(Math.PI / 4));
		assert.equal(arcIntersectsAABB(center, radius, startRight, endRight, true, min, max), true);

		// Arc 2: Facing left away from AABB (135 deg to 225 deg)
		const startLeft = new Vec2(radius * Math.cos((3 * Math.PI) / 4), 30 + radius * Math.sin((3 * Math.PI) / 4));
		const endLeft = new Vec2(radius * Math.cos((-3 * Math.PI) / 4), 30 + radius * Math.sin((-3 * Math.PI) / 4));
		assert.equal(arcIntersectsAABB(center, radius, startLeft, endLeft, true, min, max), false);
	});

	it('ellipseIntersectsAABB and ellipticalArcIntersectsAABB detect intersection accurately', () => {
		const center = new Vec2(30, 30);
		const majorPt = new Vec2(45, 30); // rx = 15
		const minorPt = new Vec2(30, 40); // ry = 10

		// Ellipse inside AABB
		assert.equal(ellipseIntersectsAABB(center, majorPt, minorPt, min, max), true);

		// Ellipse outside AABB
		const farCenter = new Vec2(100, 100);
		const farMajor = new Vec2(110, 100);
		const farMinor = new Vec2(100, 105);
		assert.equal(ellipseIntersectsAABB(farCenter, farMajor, farMinor, min, max), false);

		// Elliptical arc crossing
		const startPt = new Vec2(45, 30);
		const endPt = new Vec2(30, 40);
		assert.equal(ellipticalArcIntersectsAABB(center, majorPt, minorPt, startPt, endPt, true, min, max), true);
	});
});

describe('Hit Testing and Distance Mathematics', () => {
	it('distanceToPoint calculates accurate euclidean distance', () => {
		const p1 = new Vec2(10, 20);
		const p2 = new Vec2(13, 24);
		assert.equal(distanceToPoint(p1, p2), 5);
	});

	it('distanceToSegment calculates perpendicular and endpoint clamped distances', () => {
		const p1 = new Vec2(0, 0);
		const p2 = new Vec2(10, 0);

		// Directly above midpoint -> perpendicular distance 5
		assert.equal(distanceToSegment(new Vec2(5, 5), p1, p2), 5);
		// Beyond right endpoint -> distance to (10, 0)
		assert.equal(distanceToSegment(new Vec2(14, 3), p1, p2), 5);
		// Beyond left endpoint -> distance to (0, 0)
		assert.equal(distanceToSegment(new Vec2(-3, -4), p1, p2), 5);
	});

	it('distanceToCircle calculates radial distance to circle perimeter', () => {
		const center = new Vec2(20, 20);
		const radius = 10;

		// On perimeter
		assert.equal(distanceToCircle(new Vec2(30, 20), center, radius), 0);
		// 5 units outside
		assert.equal(distanceToCircle(new Vec2(35, 20), center, radius), 5);
		// 3 units inside
		assert.equal(distanceToCircle(new Vec2(20, 27), center, radius), 3);
	});

	it('distanceToArc returns perimeter distance when within angular span, null when outside', () => {
		const center = new Vec2(0, 0);
		const radius = 100;
		// Arc from 0 deg (100, 0) to 90 deg (0, 100) clockwise
		const start = new Vec2(100, 0);
		const end = new Vec2(0, 100);

		// At 45 deg, radius 102 -> distance is 2
		const queryInsideSpan = new Vec2(102 * Math.cos(Math.PI / 4), 102 * Math.sin(Math.PI / 4));
		const dInside = distanceToArc(queryInsideSpan, center, radius, start, end, true, 18);
		assert.ok(dInside !== null);
		assert.ok(Math.abs(dInside - 2) < 1e-4);

		// At 180 deg (-100, 0) -> far outside angular span
		const queryOutsideSpan = new Vec2(-100, 0);
		const dOutside = distanceToArc(queryOutsideSpan, center, radius, start, end, true, 18);
		assert.equal(dOutside, null);
	});

	it('distanceToEllipse and distanceToEllipticalArc calculate distance accurately', () => {
		const center = new Vec2(0, 0);
		const majorPt = new Vec2(20, 0); // rx = 20
		const minorPt = new Vec2(0, 10); // ry = 10

		// Point near top vertex (0, 10)
		const dTop = distanceToEllipse(new Vec2(0, 13), center, majorPt, minorPt);
		assert.ok(dTop !== null);
		assert.ok(Math.abs(dTop - 3) < 0.1);

		// Degenerate ellipse
		assert.equal(distanceToEllipse(new Vec2(5, 5), center, center, minorPt), null);

		// Elliptical arc
		const start = new Vec2(20, 0);
		const end = new Vec2(0, 10);
		const dArc = distanceToEllipticalArc(new Vec2(0, 13), center, majorPt, minorPt, start, end, true, 18);
		assert.ok(dArc !== null);
		assert.ok(Math.abs(dArc - 3) < 0.1);
	});

	it('distanceToLinearDimension measures distance to the dimension line', () => {
		const d1 = new Vec2(10, 50);
		const d2 = new Vec2(90, 50);
		assert.equal(distanceToLinearDimension(new Vec2(50, 55), d1, d2), 5);
	});
});

describe('Polymorphic Primitive and Constraint Hit Testing', () => {
	const viewport = {
		zoom: 1,
		worldToScreen: (p: { x: number; y: number }) => new Vec2(p.x, p.y),
		screenToWorld: (p: { x: number; y: number }) => new Vec2(p.x, p.y),
	} as any;

	it('primitives implement distanceTo and intersectsAABB polymorphically', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 10, y: 10 });
		const p2 = sketch.addPoint({ x: 50, y: 10 });
		const line = sketch.addLine(p1.id, p2.id);
		const circleCenter = sketch.addPoint({ x: 100, y: 100 });
		const circle = sketch.addCircle(circleCenter.id, 25);
		const arcCenter = sketch.addPoint({ x: 200, y: 200 });
		const arcStart = sketch.addPoint({ x: 225, y: 200 });
		const arcEnd = sketch.addPoint({ x: 200, y: 225 });
		const arc = sketch.addArc(arcCenter.id, arcStart.id, arcEnd.id, 25, true);

		// Point hit test and AABB
		assert.equal(p1.distanceTo(new Vec2(13, 14), sketch, viewport), 5);
		assert.equal(p1.intersectsAABB(new Vec2(0, 0), new Vec2(20, 20), sketch), true);
		assert.equal(p1.intersectsAABB(new Vec2(30, 30), new Vec2(40, 40), sketch), false);

		// Line hit test and AABB
		assert.equal(line.distanceTo(new Vec2(30, 14), sketch, viewport), 4);
		assert.equal(line.intersectsAABB(new Vec2(20, 0), new Vec2(40, 20), sketch), true);
		assert.equal(line.intersectsAABB(new Vec2(60, 60), new Vec2(80, 80), sketch), false);

		// Circle hit test and AABB
		assert.equal(circle.distanceTo(new Vec2(100, 128), sketch, viewport), 3);
		assert.equal(circle.intersectsAABB(new Vec2(80, 80), new Vec2(120, 120), sketch), true);
		assert.equal(circle.intersectsAABB(new Vec2(0, 0), new Vec2(20, 20), sketch), false);

		// Arc hit test and AABB
		const dArc = arc.distanceTo(new Vec2(218, 218), sketch, viewport);
		assert.ok(dArc !== null && dArc < 2);
		assert.equal(arc.intersectsAABB(new Vec2(190, 190), new Vec2(230, 230), sketch), true);
		assert.equal(arc.intersectsAABB(new Vec2(0, 0), new Vec2(50, 50), sketch), false);
	});

	it('constraints implement distanceTo polymorphically', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 100, y: 0 });
		const distC = sketch.addDistanceConstraint(p1.id, p2.id);
		assert.ok(distC);
		distC.offset = 20;

		// Hit test distance constraint leader / line
		const d = distC.distanceTo?.(new Vec2(50, 22), sketch, viewport);
		assert.ok(d !== null && d < 5);

		// Base constraints without dimensions return null
		const fixedC = sketch.addFixedConstraint(p1.id);
		assert.ok(fixedC);
		assert.equal(fixedC.distanceTo?.(new Vec2(0, 0), sketch, viewport), null);
	});

	it('keeps the dragged radial label and the leader on the same ray after restoring the sketch', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(new Vec2(0, 0));
		const circle = sketch.addCircle(center.id, 25);
		const dimension = sketch.addRadiusConstraint(circle.id, 25, 'diameter');
		assert.ok(dimension);

		const legacy = deserializeConstraint(serializeConstraint(dimension));
		assert.ok(legacy instanceof RadiusConstraint);
		assert.equal(legacy.leaderOffset, undefined);
		assert.ok(legacy.getLabelAnchor(sketch, viewport));

		dimension.moveLabelTo(new Vec2(60, 80), sketch, viewport);
		assert.ok(Math.abs(dimension.leaderOffset! - 75) < 1e-9);

		const restored = deserializeConstraint(serializeConstraint(dimension));
		assert.ok(restored instanceof RadiusConstraint);
		const label = restored.getLabelAnchor(sketch, viewport);
		assert.ok(label);
		assert.ok(Math.hypot(label.x - 60, label.y - 80) < 1e-9);
		assert.equal(restored.distanceTo(new Vec2(75, 85), sketch, viewport), 0);
		assert.ok(restored.distanceTo(new Vec2(45, 85), sketch, viewport)! > 10);
		assert.ok(restored.distanceTo(new Vec2(30, 40), sketch, viewport)! < 1e-9);
		assert.ok(restored.distanceTo(new Vec2(-12, -16), sketch, viewport)! < 1e-9);
		restored.displayMode = 'radius';
		assert.equal(restored.distanceTo(new Vec2(-12, -16), sketch, viewport), 20);

		restored.moveLabelTo(new Vec2(-60, 80), sketch, viewport);
		assert.equal(restored.distanceTo(new Vec2(-75, 85), sketch, viewport), 0);
		assert.ok(restored.distanceTo(new Vec2(-45, 85), sketch, viewport)! > 10);
	});

	it('creates a radial constraint and opens its editor only after clicking the label position', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(new Vec2(0, 0));
		const circle = sketch.addCircle(center.id, 100);
		const opened: Array<{ constraint: RadiusConstraint; client: { x: number; y: number } }> = [];
		const tool = new DimensionTool();
		const ctx = {
			sketch,
			viewport,
			renderer: { clearPreviews: () => {} },
			showToast: () => {},
			requestRender: () => {},
			setCursor: () => {},
			findSnap: () => null,
			findPointNear: () => null,
			onEditDimension: (constraint: RadiusConstraint, client: { x: number; y: number }) => {
				assert.equal(sketch.constraints.get(constraint.id), constraint);
				opened.push({ constraint, client });
			},
		} as unknown as Parameters<DimensionTool['activate']>[0];
		const selectCircle = {
			screen: new Vec2(100, 0),
			raw: {
				target: { closest: () => ({ getAttribute: (name: string) => (name === 'data-id' ? circle.id : 'circle') }) },
			},
		} as unknown as Parameters<DimensionTool['onMouseDown']>[0];
		tool.activate(ctx);
		tool.onMouseDown(selectCircle);
		assert.equal(sketch.constraints.size, 0);
		assert.equal(opened.length, 0);
		tool.cancel();
		assert.equal(sketch.constraints.size, 0);

		sketch.selectEntity(circle.id, 'circle');
		tool.activate(ctx);
		assert.equal(sketch.constraints.size, 0);
		const position = new Vec2(40, 30);
		const client = new Vec2(140, 130);
		tool.onMouseDown({ screen: position, client } as Parameters<DimensionTool['onMouseDown']>[0]);
		assert.equal(opened.length, 1);
		const { constraint } = opened[0];
		assert.equal(constraint.displayMode, 'diameter');
		assert.equal(constraint.leaderOffset, -50);
		assert.equal(opened[0].client, client);
		const anchor = constraint.getLabelAnchor(sketch, viewport);
		assert.ok(anchor && Math.hypot(anchor.x - position.x, anchor.y - position.y) < 1e-9);
		assert.equal(constraint.distanceTo(new Vec2(25, 35), sketch, viewport), 0);
		assert.equal(sketch.undo(), true);
		assert.equal(sketch.constraints.size, 0);
	});

	it('clamps a dragged arc dimension to its sweep and keeps the leader radial', () => {
		const sketch = new SketchDocument();
		const center = sketch.addPoint(new Vec2(0, 0));
		const start = sketch.addPoint(new Vec2(25, 0));
		const end = sketch.addPoint(new Vec2(0, 25));
		const arc = sketch.addArc(center.id, start.id, end.id, 25, true);
		const dimension = sketch.addRadiusConstraint(arc.id, 25, 'radius');
		assert.ok(dimension);

		dimension.moveLabelTo(new Vec2(-60, 80), sketch, viewport);
		assert.equal(dimension.leaderAngle, Math.PI / 2);
		assert.ok(dimension.distanceTo(new Vec2(0, 60), sketch, viewport)! < 1e-9);
		assert.ok(dimension.distanceTo(new Vec2(0, 100), sketch, viewport)! < 1e-9);
		dimension.moveLabelTo(new Vec2(0, 12), sketch, viewport);
		assert.equal(dimension.leaderOffset, -13);
		assert.equal(dimension.distanceTo(new Vec2(0, 12), sketch, viewport), 0);
	});

	it('primitives and SketchDocument implement toGeoCurve polymorphically', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint({ x: 0, y: 0 });
		const p2 = sketch.addPoint({ x: 10, y: 0 });
		const line = sketch.addLine(p1.id, p2.id);

		const cCenter = sketch.addPoint({ x: 50, y: 50 });
		const circle = sketch.addCircle(cCenter.id, 20);

		const aCenter = sketch.addPoint({ x: 100, y: 100 });
		const aStart = sketch.addPoint({ x: 120, y: 100 });
		const aEnd = sketch.addPoint({ x: 100, y: 120 });
		const arc = sketch.addArc(aCenter.id, aStart.id, aEnd.id, 20, true);

		const eCenter = sketch.addPoint({ x: 200, y: 200 });
		const eMajor = sketch.addPoint({ x: 240, y: 200 });
		const eMinor = sketch.addPoint({ x: 200, y: 220 });
		const ellipse = sketch.addEllipse(eCenter.id, eMajor.id, eMinor.id);

		const eaStart = sketch.addPoint({ x: 240, y: 200 });
		const eaEnd = sketch.addPoint({ x: 200, y: 220 });
		const ellipticalArc = sketch.addEllipticalArc(eCenter.id, eMajor.id, eMinor.id, eaStart.id, eaEnd.id, true);

		const sp1 = sketch.addPoint({ x: 0, y: 0 });
		const sp2 = sketch.addPoint({ x: 10, y: 20 });
		const sp3 = sketch.addPoint({ x: 20, y: 0 });
		const spline = sketch.addFitSpline([sp1.id, sp2.id, sp3.id]);

		// Point
		assert.equal(p1.toGeoCurve(sketch), null);
		assert.equal(sketch.toGeoCurve(p1.id, 'point'), null);

		// Line -> GeoSegment
		const geoLine = line.toGeoCurve(sketch);
		assert.ok(geoLine && geoLine.type === 'segment');
		assert.deepEqual(geoLine.p1, new Vec2(0, 0));
		assert.deepEqual(geoLine.p2, new Vec2(10, 0));
		assert.deepEqual(sketch.toGeoCurve(line.id, 'line'), geoLine);

		// Circle -> GeoCircle
		const geoCircle = circle.toGeoCurve(sketch);
		assert.ok(geoCircle && geoCircle.type === 'circle');
		assert.deepEqual(geoCircle.center, new Vec2(50, 50));
		assert.equal(geoCircle.radius, 20);
		assert.deepEqual(sketch.toGeoCurve(circle.id, 'circle'), geoCircle);

		// Arc -> GeoArc
		const geoArc = arc.toGeoCurve(sketch);
		assert.ok(geoArc && geoArc.type === 'arc');
		assert.deepEqual(geoArc.center, new Vec2(100, 100));
		assert.equal(geoArc.radius, 20);
		assert.deepEqual(sketch.toGeoCurve(arc.id, 'arc'), geoArc);

		// Ellipse -> GeoEllipse
		const geoEllipse = ellipse.toGeoCurve(sketch);
		assert.ok(geoEllipse && geoEllipse.type === 'ellipse');
		assert.deepEqual(geoEllipse.center, new Vec2(200, 200));
		assert.deepEqual(geoEllipse.majorAxisPoint, new Vec2(240, 200));
		assert.deepEqual(geoEllipse.minorAxisPoint, new Vec2(200, 220));
		assert.deepEqual(sketch.toGeoCurve(ellipse.id, 'ellipse'), geoEllipse);

		// EllipticalArc -> GeoEllipticalArc
		const geoEllipticalArc = ellipticalArc.toGeoCurve(sketch);
		assert.ok(geoEllipticalArc && geoEllipticalArc.type === 'elliptical_arc');
		assert.deepEqual(geoEllipticalArc.center, new Vec2(200, 200));
		assert.deepEqual(geoEllipticalArc.majorAxisPoint, new Vec2(240, 200));
		assert.deepEqual(geoEllipticalArc.minorAxisPoint, new Vec2(200, 220));
		assert.deepEqual(sketch.toGeoCurve(ellipticalArc.id, 'ellipticalArc'), geoEllipticalArc);

		// Spline -> GeoSpline
		const geoSpline = spline.toGeoCurve(sketch);
		assert.ok(geoSpline && geoSpline.type === 'spline');
		assert.ok(geoSpline.bezierSegments.length > 0);
		assert.deepEqual(sketch.toGeoCurve(spline.id, 'spline'), geoSpline);

		// Non-existent id returns null
		assert.equal(sketch.toGeoCurve('unknown-id', 'line'), null);
	});
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
	distanceToRadiusDimension,
} from '../src/math/hitTest';
import { vec } from '../src/math/vector';
import { SketchDocument } from '../src/model/sketch';

describe('AABB Geometry Intersections', () => {
	const minX = 10,
		minY = 10,
		maxX = 50,
		maxY = 50;

	it('pointIntersectsAABB detects points inside, on boundary, and outside', () => {
		assert.equal(pointIntersectsAABB(25, 25, minX, minY, maxX, maxY), true);
		assert.equal(pointIntersectsAABB(10, 50, minX, minY, maxX, maxY), true);
		assert.equal(pointIntersectsAABB(5, 25, minX, minY, maxX, maxY), false);
		assert.equal(pointIntersectsAABB(25, 60, minX, minY, maxX, maxY), false);
	});

	it('segmentIntersectsAABB detects segments inside, crossing, and outside', () => {
		// Inside
		assert.equal(segmentIntersectsAABB(20, 20, 40, 40, minX, minY, maxX, maxY), true);
		// Crossing completely through
		assert.equal(segmentIntersectsAABB(0, 30, 60, 30, minX, minY, maxX, maxY), true);
		// Diagonal crossing
		assert.equal(segmentIntersectsAABB(0, 0, 60, 60, minX, minY, maxX, maxY), true);
		// Completely outside
		assert.equal(segmentIntersectsAABB(0, 0, 5, 5, minX, minY, maxX, maxY), false);
		assert.equal(segmentIntersectsAABB(60, 10, 60, 50, minX, minY, maxX, maxY), false);
		// Skimming outside near corner
		assert.equal(segmentIntersectsAABB(0, 60, 60, 0, minX, minY, maxX, maxY), true);
		assert.equal(segmentIntersectsAABB(0, 110, 110, 0, minX, minY, maxX, maxY), false);
	});

	it('circleIntersectsAABB detects circles intersecting or outside', () => {
		// Center inside
		assert.equal(circleIntersectsAABB(25, 25, 5, minX, minY, maxX, maxY), true);
		// Center outside, edge crossing
		assert.equal(circleIntersectsAABB(0, 25, 15, minX, minY, maxX, maxY), true);
		// Center outside, not reaching
		assert.equal(circleIntersectsAABB(0, 25, 8, minX, minY, maxX, maxY), false);
		// Center outside, radius encompasses the entire AABB without intersecting border
		assert.equal(circleIntersectsAABB(-50, -50, 200, minX, minY, maxX, maxY), false);
	});

	it('arcIntersectsAABB respects angular span of the arc', () => {
		const center = vec(0, 30);
		const radius = 20;
		// Circle reaches x=10..20, inside AABB
		// Arc 1: Facing right towards AABB (-45 deg to +45 deg)
		const startRight = vec(radius * Math.cos(-Math.PI / 4), 30 + radius * Math.sin(-Math.PI / 4));
		const endRight = vec(radius * Math.cos(Math.PI / 4), 30 + radius * Math.sin(Math.PI / 4));
		assert.equal(
			arcIntersectsAABB(center, radius, startRight, endRight, true, minX, minY, maxX, maxY),
			true
		);

		// Arc 2: Facing left away from AABB (135 deg to 225 deg)
		const startLeft = vec(radius * Math.cos((3 * Math.PI) / 4), 30 + radius * Math.sin((3 * Math.PI) / 4));
		const endLeft = vec(radius * Math.cos((-3 * Math.PI) / 4), 30 + radius * Math.sin((-3 * Math.PI) / 4));
		assert.equal(
			arcIntersectsAABB(center, radius, startLeft, endLeft, true, minX, minY, maxX, maxY),
			false
		);
	});

	it('ellipseIntersectsAABB and ellipticalArcIntersectsAABB detect intersection accurately', () => {
		const center = vec(30, 30);
		const majorPt = vec(45, 30); // rx = 15
		const minorPt = vec(30, 40); // ry = 10

		// Ellipse inside AABB
		assert.equal(ellipseIntersectsAABB(center, majorPt, minorPt, minX, minY, maxX, maxY), true);

		// Ellipse outside AABB
		const farCenter = vec(100, 100);
		const farMajor = vec(110, 100);
		const farMinor = vec(100, 105);
		assert.equal(ellipseIntersectsAABB(farCenter, farMajor, farMinor, minX, minY, maxX, maxY), false);

		// Elliptical arc crossing
		const startPt = vec(45, 30);
		const endPt = vec(30, 40);
		assert.equal(
			ellipticalArcIntersectsAABB(center, majorPt, minorPt, startPt, endPt, true, minX, minY, maxX, maxY),
			true
		);
	});
});

describe('Hit Testing and Distance Mathematics', () => {
	it('distanceToPoint calculates accurate euclidean distance', () => {
		const p1 = vec(10, 20);
		const p2 = vec(13, 24);
		assert.equal(distanceToPoint(p1, p2), 5);
	});

	it('distanceToSegment calculates perpendicular and endpoint clamped distances', () => {
		const p1 = vec(0, 0);
		const p2 = vec(10, 0);

		// Directly above midpoint -> perpendicular distance 5
		assert.equal(distanceToSegment(vec(5, 5), p1, p2), 5);
		// Beyond right endpoint -> distance to (10, 0)
		assert.equal(distanceToSegment(vec(14, 3), p1, p2), 5);
		// Beyond left endpoint -> distance to (0, 0)
		assert.equal(distanceToSegment(vec(-3, -4), p1, p2), 5);
	});

	it('distanceToCircle calculates radial distance to circle perimeter', () => {
		const center = vec(20, 20);
		const radius = 10;

		// On perimeter
		assert.equal(distanceToCircle(vec(30, 20), center, radius), 0);
		// 5 units outside
		assert.equal(distanceToCircle(vec(35, 20), center, radius), 5);
		// 3 units inside
		assert.equal(distanceToCircle(vec(20, 27), center, radius), 3);
	});

	it('distanceToArc returns perimeter distance when within angular span, null when outside', () => {
		const center = vec(0, 0);
		const radius = 100;
		// Arc from 0 deg (100, 0) to 90 deg (0, 100) clockwise
		const start = vec(100, 0);
		const end = vec(0, 100);

		// At 45 deg, radius 102 -> distance is 2
		const queryInsideSpan = vec(102 * Math.cos(Math.PI / 4), 102 * Math.sin(Math.PI / 4));
		const dInside = distanceToArc(queryInsideSpan, center, radius, start, end, true, 18);
		assert.ok(dInside !== null);
		assert.ok(Math.abs(dInside - 2) < 1e-4);

		// At 180 deg (-100, 0) -> far outside angular span
		const queryOutsideSpan = vec(-100, 0);
		const dOutside = distanceToArc(queryOutsideSpan, center, radius, start, end, true, 18);
		assert.equal(dOutside, null);
	});

	it('distanceToEllipse and distanceToEllipticalArc calculate distance accurately', () => {
		const center = vec(0, 0);
		const majorPt = vec(20, 0); // rx = 20
		const minorPt = vec(0, 10); // ry = 10

		// Point near top vertex (0, 10)
		const dTop = distanceToEllipse(vec(0, 13), center, majorPt, minorPt);
		assert.ok(dTop !== null);
		assert.ok(Math.abs(dTop - 3) < 0.1);

		// Degenerate ellipse
		assert.equal(distanceToEllipse(vec(5, 5), center, center, minorPt), null);

		// Elliptical arc
		const start = vec(20, 0);
		const end = vec(0, 10);
		const dArc = distanceToEllipticalArc(vec(0, 13), center, majorPt, minorPt, start, end, true, 18);
		assert.ok(dArc !== null);
		assert.ok(Math.abs(dArc - 3) < 0.1);
	});

	it('distanceToLinearDimension and distanceToRadiusDimension compute valid distance metrics', () => {
		const d1 = vec(10, 50);
		const d2 = vec(90, 50);
		assert.equal(distanceToLinearDimension(vec(50, 55), d1, d2), 5);

		const sc = vec(100, 100);
		const sr = 40;
		const dRad = distanceToRadiusDimension(vec(140, 100), sc, sr, 0);
		assert.ok(dRad >= 0);
	});
});

describe('Polymorphic Primitive and Constraint Hit Testing', () => {
	const viewport = {
		zoom: 1,
		worldToScreen: (x: number, y: number) => ({ x, y }),
		screenToWorld: (x: number, y: number) => ({ x, y }),
	} as any;

	it('primitives implement distanceTo and intersectsAABB polymorphically', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(10, 10);
		const p2 = sketch.addPoint(50, 10);
		const line = sketch.addLine(p1.id, p2.id);
		const circleCenter = sketch.addPoint(100, 100);
		const circle = sketch.addCircle(circleCenter.id, 25);
		const arcCenter = sketch.addPoint(200, 200);
		const arcStart = sketch.addPoint(225, 200);
		const arcEnd = sketch.addPoint(200, 225);
		const arc = sketch.addArc(arcCenter.id, arcStart.id, arcEnd.id, 25, true);

		// Point hit test and AABB
		assert.equal(p1.distanceTo(vec(13, 14), sketch, viewport), 5);
		assert.equal(p1.intersectsAABB(0, 0, 20, 20, sketch), true);
		assert.equal(p1.intersectsAABB(30, 30, 40, 40, sketch), false);

		// Line hit test and AABB
		assert.equal(line.distanceTo(vec(30, 14), sketch, viewport), 4);
		assert.equal(line.intersectsAABB(20, 0, 40, 20, sketch), true);
		assert.equal(line.intersectsAABB(60, 60, 80, 80, sketch), false);

		// Circle hit test and AABB
		assert.equal(circle.distanceTo(vec(100, 128), sketch, viewport), 3);
		assert.equal(circle.intersectsAABB(80, 80, 120, 120, sketch), true);
		assert.equal(circle.intersectsAABB(0, 0, 20, 20, sketch), false);

		// Arc hit test and AABB
		const dArc = arc.distanceTo(vec(218, 218), sketch, viewport);
		assert.ok(dArc !== null && dArc < 2);
		assert.equal(arc.intersectsAABB(190, 190, 230, 230, sketch), true);
		assert.equal(arc.intersectsAABB(0, 0, 50, 50, sketch), false);
	});

	it('constraints implement distanceTo polymorphically', () => {
		const sketch = new SketchDocument();
		const p1 = sketch.addPoint(0, 0);
		const p2 = sketch.addPoint(100, 0);
		const distC = sketch.addDistanceConstraint(p1.id, p2.id);
		assert.ok(distC);
		distC.offset = 20;

		// Hit test distance constraint leader / line
		const d = distC.distanceTo?.(vec(50, 22), sketch, viewport);
		assert.ok(d !== null && d < 5);

		// Base constraints without dimensions return null
		const fixedC = sketch.addFixedConstraint(p1.id);
		assert.ok(fixedC);
		assert.equal(fixedC.distanceTo?.(vec(0, 0), sketch, viewport), null);
	});
});

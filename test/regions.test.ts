import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import { findSketchRegions, pointInRegion } from '../src/math/regions';
import { SketchArc } from '../src/model/primitives/arc';

function addTriangle(sketch: SketchDocument) {
	const a = sketch.addPoint({ x: -50, y: 0 });
	const b = sketch.addPoint({ x: 50, y: 0 });
	const c = sketch.addPoint({ x: 0, y: 80 });
	sketch.addLine(a.id, b.id);
	sketch.addLine(a.id, c.id);
	sketch.addLine(b.id, c.id);
}

describe('sketch regions', () => {
	it('represents a circle inside a triangle as a circle and a ring with a hole', () => {
		const sketch = new SketchDocument();
		addTriangle(sketch);
		const center = sketch.addPoint({ x: 0, y: 30 });
		sketch.addCircle(center.id, 10);

		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, 2);
		const ring = regions.find(region => region.holes.length === 1);
		assert.ok(ring);
		assert.match(ring.path, / A /);
		assert.ok(
			regions.some(region => (region.path.match(/ A /g) ?? []).length <= 2),
			'a full circle should export as two SVG arc commands'
		);
		assert.equal(pointInRegion({ x: 30, y: 20 }, ring), true);
		assert.equal(pointInRegion({ x: 0, y: 30 }, ring), false);
		assert.equal(
			regions.some(region => pointInRegion({ x: 0, y: 30 }, region)),
			true
		);
	});

	it('splits the triangle and circle into distinct faces when the circle crosses its sides', () => {
		const sketch = new SketchDocument();
		addTriangle(sketch);
		const center = sketch.addPoint({ x: 0, y: 10 });
		sketch.addCircle(center.id, 25);

		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, 3);
		assert.ok(regions.every(region => region.holes.length === 0));
	});

	it('wraps a closed fit spline at its parameter seam when intersected by a circle', () => {
		const sketch = new SketchDocument();
		const fitPoints = [
			[-30, 0],
			[0, 30],
			[30, 0],
			[0, -30],
		].map(([x, y]) => sketch.addPoint({ x: x, y: y }));
		sketch.addFitSpline(
			fitPoints.map(point => point.id),
			undefined,
			false,
			undefined,
			true
		);
		const center = sketch.addPoint({ x: 20, y: 0 });
		sketch.addCircle(center.id, 20);

		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, 3);
		assert.ok(
			regions.some(region => / C /.test(region.path)),
			'region export should preserve the spline as cubic Bezier commands'
		);
		assert.ok(
			regions.every(region => (region.path.match(/ C /g) ?? []).length < region.points.length / 2),
			'adjacent spline pieces should be merged for export'
		);
		assert.ok(regions.every(region => region.area > 100));
		assert.ok(regions.every(region => region.holes.length === 0));
	});

	it('recomputes regions after scene geometry changes', () => {
		const sketch = new SketchDocument();
		addTriangle(sketch);
		const center = sketch.addPoint({ x: 0, y: 30 });
		const circle = sketch.addCircle(center.id, 10);
		assert.equal(findSketchRegions(sketch).length, 2);

		center.y = 10;
		circle.radius = 25;
		assert.equal(findSketchRegions(sketch).length, 3);
	});

	it('keeps a near-start arc intersection attached to the arc endpoint', () => {
		const sketch = new SketchDocument();
		const points = [
			[-50, 0],
			[50, 0],
			[0, 80],
			[-29.33988764044944, 33.056179775280896],
			[21.573033707865168, 45.48314606741573],
			[-32.83845726811989, 9.091778684039767],
			[-11.21040915447891, 35.32580000706726],
			[-6.91778061141625, 60.96899286972153],
			[-31.271751336149997, 51.864921805696845],
			[-8.7803395269661, 65.95145675685424],
		].map(([x, y]) => sketch.addPoint({ x: x, y: y }));
		const [a, b, c, chordA, chordB, danglingStart, arcStart, arcEnd, arcCenter, sideEnd] = points;
		sketch.addLine(a.id, b.id);
		sketch.addLine(a.id, c.id);
		sketch.addLine(b.id, c.id);
		sketch.addLine(chordA.id, chordB.id);
		sketch.addLine(danglingStart.id, arcStart.id);
		sketch.addLine(arcEnd.id, sideEnd.id);
		sketch.arcs.set(
			'regression-arc',
			new SketchArc({
				id: 'regression-arc',
				centerId: arcCenter.id,
				startPointId: arcStart.id,
				endPointId: arcEnd.id,
				radius: 26,
				clockwise: false,
			})
		);

		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, 3);
		assert.ok(regions.every(region => region.area > 100));
	});

	it('does not create an extra face where an arc joins two chords on a triangle side', () => {
		const sketch = new SketchDocument();
		const point = (x: number, y: number) => sketch.addPoint({ x: x, y: y });
		const a = point(-50, 0),
			b = point(50, 0),
			apex = point(0, 80);
		const lowSide = point(-35.122184280743056, 23.804505150811124);
		const lowArc = point(13.768391043199205, 9.818342243160393);
		const highSide = point(-24.67485501335101, 40.520231978638385);
		const highArc = point(18.978781456610243, 28.032203732365492);
		const center = point(16.37028613255977, 18.926217049142615);
		sketch.addLine(a.id, b.id);
		sketch.addLine(a.id, apex.id);
		sketch.addLine(b.id, apex.id);
		sketch.addLine(lowSide.id, lowArc.id);
		sketch.addLine(highSide.id, highArc.id);
		sketch.arcs.set(
			'joined-arc',
			new SketchArc({
				id: 'joined-arc',
				centerId: center.id,
				startPointId: highArc.id,
				endPointId: lowArc.id,
				radius: 9.47223498139914,
				clockwise: true,
			})
		);

		assert.equal(findSketchRegions(sketch).length, 2);
	});
});

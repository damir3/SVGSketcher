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

	it('closes rounded contours when imported arc endpoints are slightly off their radius', () => {
		const sketch = new SketchDocument();
		const point = (x: number, y: number) => sketch.addPoint({ x, y });
		const bottomLeft = point(10.000329374076054, 2.3199333184040677e-10);
		const bottomRight = point(89.99133437857454, 4.846103017568557e-8);
		const rightBottom = point(99.99999846215046, 9.993022795502009);
		const rightTop = point(99.99999847253227, 65.00425680998654);
		const topRight = point(90.0014644988888, 74.99999940445858);
		const topLeft = point(10.00642344659919, 74.9999994422763);
		const leftTop = point(-1.432332305514949e-8, 65.02166892897797);
		const leftBottom = point(-4.9638171605798694e-9, 10.002218733327375);
		const topLeftCenter = point(9.999988317649173, 65.00000049562668);
		const topRightCenter = point(89.99999892534929, 64.99999945861987);
		const bottomRightCenter = point(89.99999967389357, 9.99999817529173);
		const bottomLeftCenter = point(9.999999871994534, 9.999999997559033);

		sketch.addLine(bottomLeft.id, bottomRight.id);
		sketch.addLine(rightBottom.id, rightTop.id);
		sketch.addLine(topRight.id, topLeft.id);
		sketch.addLine(leftTop.id, leftBottom.id);
		const addArc = (
			id: string,
			centerId: string,
			startPointId: string,
			endPointId: string,
			clockwise: boolean
		) =>
			sketch.arcs.set(
				id,
				new SketchArc({ id, centerId, startPointId, endPointId, radius: 10, clockwise })
			);
		addArc('round-tl', topLeftCenter.id, topLeft.id, leftTop.id, false);
		addArc('round-tr', topRightCenter.id, rightTop.id, topRight.id, false);
		addArc('round-br', bottomRightCenter.id, bottomRight.id, rightBottom.id, false);
		addArc('round-bl', bottomLeftCenter.id, bottomLeft.id, leftBottom.id, true);

		const regions = findSketchRegions(sketch);
		assert.equal(regions.length, 1);
		assert.ok(regions[0].area > 7000);
		assert.equal((regions[0].path.match(/ A /g) ?? []).length, 4);
		assert.equal(pointInRegion({ x: 50, y: 35 }, regions[0]), true);
	});
});

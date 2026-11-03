import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SketchDocument } from '../src/model/sketch';
import {
	SketchPoint,
	SketchLine,
	SketchCircle,
	SketchArc,
	SketchEllipse,
	SketchEllipticalArc,
	SketchSpline,
} from '../src/model/types';
import { PrimitivePanel } from '../src/ui/panels/primitives';
import { serializePrimitive } from '../src/model/primitives/serialization';

describe('Primitive snapshot serialization', () => {
	it('stores data only and restores every primitive class with fresh UI panels', () => {
		const sketch = new SketchDocument();
		sketch.points.set('Point-1', new SketchPoint({ id: 'Point-1', x: 1, y: 2 }));
		sketch.points.set('Point-2', new SketchPoint({ id: 'Point-2', x: 3, y: 4 }));
		sketch.points.set('Point-3', new SketchPoint({ id: 'Point-3', x: 5, y: 6 }));
		sketch.lines.set('Line-1', new SketchLine({ id: 'Line-1', p1Id: 'Point-1', p2Id: 'Point-2', isSplineHandle: true, parentSplineId: 'Spline-1' }));
		sketch.circles.set('Circle-1', new SketchCircle({ id: 'Circle-1', centerId: 'Point-1', radius: 5 }));
		sketch.arcs.set('Arc-1', new SketchArc({ id: 'Arc-1', centerId: 'Point-1', startPointId: 'Point-2', endPointId: 'Point-3', radius: 5, clockwise: true }));
		sketch.ellipses.set('Ellipse-1', new SketchEllipse({ id: 'Ellipse-1', centerId: 'Point-1', majorAxisPointId: 'Point-2', minorAxisPointId: 'Point-3' }));
		sketch.ellipticalArcs.set('EllipticalArc-1', new SketchEllipticalArc({
			id: 'EllipticalArc-1', centerId: 'Point-1', majorAxisPointId: 'Point-2', minorAxisPointId: 'Point-3',
			startPointId: 'Point-2', endPointId: 'Point-3', clockwise: true,
		}));
		const spline = new SketchSpline({ id: 'Spline-1', splineType: 'control', pointIds: ['Point-1', 'Point-2'], knots: [0, 0.5, 1] });
		sketch.splines.set(spline.id, spline);

		const snapshot = sketch.takeSnapshot();
		for (const collection of [snapshot.points, snapshot.lines, snapshot.circles, snapshot.arcs, snapshot.ellipses, snapshot.ellipticalArcs, snapshot.splines ?? []]) {
			for (const item of collection) assert.equal('sidebarPanel' in item, false);
		}
		spline.pointIds[0] = 'Point-mutated';
		spline.knots![0] = -1;
		assert.deepEqual(snapshot.splines![0].pointIds, ['Point-1', 'Point-2']);
		assert.deepEqual(snapshot.splines![0].knots, [0, 0.5, 1]);

		const restored = new SketchDocument();
		restored.restoreSnapshot(snapshot);
		for (const [actual, expected] of [
			[restored.points.get('Point-1'), SketchPoint],
			[restored.lines.get('Line-1'), SketchLine],
			[restored.circles.get('Circle-1'), SketchCircle],
			[restored.arcs.get('Arc-1'), SketchArc],
			[restored.ellipses.get('Ellipse-1'), SketchEllipse],
			[restored.ellipticalArcs.get('EllipticalArc-1'), SketchEllipticalArc],
			[restored.splines.get('Spline-1'), SketchSpline],
		] as const) {
			assert.ok(actual instanceof expected);
			assert.ok(actual!.sidebarPanel instanceof PrimitivePanel);
		}
		assert.deepEqual(serializePrimitive(restored.splines.get('Spline-1')!), snapshot.splines![0]);
	});
});

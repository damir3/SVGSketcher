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
import { findSketchRegions } from '../src/math/regions';

describe('Primitive snapshot serialization', () => {
	it('stores data only and restores every primitive class with fresh UI panels', () => {
		const sketch = new SketchDocument();
		sketch.points.set('Point-1', new SketchPoint({ id: 'Point-1', x: 1, y: 2 }));
		sketch.points.set('Point-2', new SketchPoint({ id: 'Point-2', x: 3, y: 4 }));
		sketch.points.set('Point-3', new SketchPoint({ id: 'Point-3', x: 5, y: 6 }));
		sketch.lines.set(
			'Line-1',
			new SketchLine({
				id: 'Line-1',
				p1Id: 'Point-1',
				p2Id: 'Point-2',
				lineType: 'spline_handle',
				parentSplineId: 'Spline-1',
			})
		);
		sketch.circles.set('Circle-1', new SketchCircle({ id: 'Circle-1', centerId: 'Point-1', radius: 5 }));
		sketch.arcs.set(
			'Arc-1',
			new SketchArc({
				id: 'Arc-1',
				centerId: 'Point-1',
				startPointId: 'Point-2',
				endPointId: 'Point-3',
				radius: 5,
				clockwise: true,
			})
		);
		sketch.ellipses.set(
			'Ellipse-1',
			new SketchEllipse({
				id: 'Ellipse-1',
				centerId: 'Point-1',
				majorAxisPointId: 'Point-2',
				minorAxisPointId: 'Point-3',
			})
		);
		sketch.ellipticalArcs.set(
			'EllipticalArc-1',
			new SketchEllipticalArc({
				id: 'EllipticalArc-1',
				centerId: 'Point-1',
				majorAxisPointId: 'Point-2',
				minorAxisPointId: 'Point-3',
				startPointId: 'Point-2',
				endPointId: 'Point-3',
				clockwise: true,
			})
		);
		const spline = new SketchSpline({
			id: 'Spline-1',
			splineType: 'control',
			pointIds: ['Point-1', 'Point-2'],
			knots: [0, 0.5, 1],
		});
		sketch.splines.set(spline.id, spline);

		const snapshot = sketch.takeSnapshot();
		for (const collection of [
			snapshot.points,
			snapshot.lines,
			snapshot.circles,
			snapshot.arcs,
			snapshot.ellipses,
			snapshot.ellipticalArcs,
			snapshot.splines ?? [],
		]) {
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
		assert.equal(restored.lines.get('Line-1')?.lineType, 'spline_handle');
		assert.equal('isSplineHandle' in snapshot.lines[0], false);
	});

	it('exports centerlines as a separate layer and restores their type even when the layer is hidden', () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint({ x: 0, y: 0 });
		const b = sketch.addPoint({ x: 40, y: 0 });
		const c = sketch.addPoint({ x: 40, y: 40 });
		sketch.addLine(a.id, b.id);
		sketch.addLine(b.id, c.id);
		const axis = sketch.addLine(c.id, a.id, 'centerline');
		const circle = sketch.addCircle(b.id, 15, 'centerline');
		const arc = sketch.addArc(b.id, a.id, c.id, 40, false, 'centerline');
		assert.equal(findSketchRegions(sketch).length, 0);

		const exported = sketch.exportSVG(undefined, 2, { strokeWidth: 0.5 });
		assert.match(
			exported,
			/<g id="centerlines" transform="scale\(2\)" stroke-dasharray="6 2 1 2">\s*<line [^>]+>\s*<circle [^>]+>\s*<path /
		);
		assert.doesNotMatch(exported, /<g id="construction"/);

		const hidden = sketch.exportSVG(undefined, 2, { engineeringLines: false });
		assert.doesNotMatch(hidden, /<g id="centerlines"/);
		const reopened = new SketchDocument();
		assert.equal(reopened.importSVG(hidden).success, true);
		assert.equal(reopened.lines.get(axis.id)?.lineType, 'centerline');
		assert.equal(reopened.lines.get(axis.id)?.isConstruction, true);
		assert.equal(reopened.circles.get(circle.id)?.lineType, 'centerline');
		assert.equal(reopened.arcs.get(arc.id)?.lineType, 'centerline');
		reopened.setLineType(axis.id, 'solid');
		assert.equal(findSketchRegions(reopened).length, 1);
	});

	it('exports engineering lines in their own SVG groups and preserves styles in the sketch', () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint({ x: 0, y: 0 });
		const b = sketch.addPoint({ x: 20, y: 0 });
		const c = sketch.addPoint({ x: 0, y: 20 });
		const axis = sketch.addLine(a.id, b.id, 'centerline');
		const hidden = sketch.addArc(a.id, b.id, c.id, 20, false, 'hidden');
		const phantom = sketch.addCircle(a.id, 5, 'phantom');
		const cut = sketch.addLine(b.id, c.id, 'cutting_plane');
		assert.equal(findSketchRegions(sketch).length, 0);

		const svg = sketch.exportSVG(undefined, 1, { strokeWidth: 1 });
		assert.match(svg, /"format": "svg-sketcher",\s*"version": 1,/);
		assert.match(svg, /<g id="centerlines"/);
		assert.match(svg, /<g id="hidden-lines"[^>]*stroke-dasharray="5 3">\s*<path /);
		assert.match(svg, /<g id="phantom-lines"[^>]*stroke-dasharray="12 4 2 4 2 4">\s*<circle /);
		assert.match(svg, /<g id="cutting-planes"[^>]*stroke-dasharray="9 5 1 5">/);
		const cutGroup = svg.match(/<g id="cutting-planes"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? '';
		assert.match(cutGroup, /<line [^>]*stroke-width="1"/);
		assert.equal([...cutGroup.matchAll(/<path [^>]*stroke-dasharray="none"/g)].length, 2);
		assert.equal([...cutGroup.matchAll(/<text [^>]*>A<\/text>/g)].length, 2);

		const reopened = new SketchDocument();
		const hiddenLayer = sketch.exportSVG(undefined, 1, { engineeringLines: false });
		assert.doesNotMatch(hiddenLayer, /<g id="(?:centerlines|hidden-lines|phantom-lines|cutting-planes)"/);
		assert.equal(reopened.importSVG(hiddenLayer).success, true);
		assert.equal(reopened.lines.get(axis.id)?.lineType, 'centerline');
		assert.equal(reopened.arcs.get(hidden.id)?.lineType, 'hidden');
		assert.equal(reopened.circles.get(phantom.id)?.lineType, 'phantom');
		assert.equal(reopened.lines.get(cut.id)?.lineType, 'cutting_plane');

		assert.equal(reopened.importSVG(svg.replace('"version": 1', '"version": 2')).success, true);
		assert.match(reopened.exportSVG(), /"version": 1,/);
		assert.deepEqual(reopened.importSVG(svg.replace('"version": 1', '"version": 3')), {
			success: false,
			error: 'Unsupported Sketcher SVG version 3',
		});
		const mixed = svg.replace('"lineType": "cutting_plane"', '"isConstruction": true');
		assert.equal(reopened.importSVG(mixed).success, true);
		assert.equal(reopened.lines.get(cut.id)?.lineType, 'construction');
		assert.equal(reopened.arcs.get(hidden.id)?.lineType, 'hidden');
	});

	it('opens SVG version 1 with construction and spline-handle flags in place of line types', () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint({ x: 0, y: 0 }, true);
		const b = sketch.addPoint({ x: 20, y: 0 }, true);
		const c = sketch.addPoint({ x: 0, y: 20 }, true);
		const line = sketch.addLine(a.id, b.id);
		const circle = sketch.addCircle(a.id, 5, 'construction');
		const arc = sketch.addArc(a.id, b.id, c.id, 20);
		const spline = sketch.addFitSpline([a.id, b.id, c.id]);
		const handleId = spline.tangentLineIds![0];
		const snapshot = sketch.takeSnapshot();
		const file = {
			format: 'svg-sketcher',
			version: 1,
			snapshot: {
				...snapshot,
				lines: snapshot.lines.map(({ lineType, ...line }) =>
					lineType === 'spline_handle' ? { ...line, isConstruction: true, isSplineHandle: true } : line
				),
				circles: [{ type: 'circle', id: circle.id, centerId: a.id, radius: 5, isConstruction: true }],
				arcs: [
					{ type: 'arc', id: arc.id, centerId: a.id, startPointId: b.id, endPointId: c.id, radius: 20 },
				],
			},
		};
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="sketcher-metadata"><![CDATA[${JSON.stringify(file)}]]></metadata></svg>`;
		const reopened = new SketchDocument();
		assert.equal(reopened.importSVG(svg).success, true);
		assert.equal(reopened.lines.get(line.id)?.lineType, 'solid');
		assert.equal(reopened.lines.get(handleId)?.lineType, 'spline_handle');
		assert.equal(reopened.lines.get(handleId)?.isAutomaticSplineHandle, true);
		assert.equal(reopened.circles.get(circle.id)?.lineType, 'construction');
		assert.equal(reopened.arcs.get(arc.id)?.lineType, 'solid');
		assert.match(reopened.exportSVG(), /"lineType": "spline_handle"/);
	});

	it('saves construction geometry and its constraints only in the editable SVG metadata', () => {
		const sketch = new SketchDocument();
		const a = sketch.addPoint({ x: 0, y: 0 }, true);
		const b = sketch.addPoint({ x: 25, y: 0 }, true);
		sketch.addLine(a.id, b.id);
		const baseline = sketch.exportSVG();

		const c = sketch.addPoint({ x: 500, y: 0 }, true);
		const d = sketch.addPoint({ x: 600, y: 0 }, true);
		sketch.addLine(a.id, c.id, 'construction');
		sketch.addDistanceConstraint(c.id, d.id, 100);
		sketch.addCircle(d.id, 25, 'construction');
		sketch.addFitSpline([c.id, d.id], undefined, true);
		const svg = sketch.exportSVG();
		assert.equal(svg.match(/viewBox="[^"]+"/)?.[0], baseline.match(/viewBox="[^"]+"/)?.[0]);
		assert.equal(svg.split('</metadata>')[1], baseline.split('</metadata>')[1]);

		const reopened = new SketchDocument();
		assert.equal(reopened.importSVG(svg).success, true);
		assert.deepEqual(
			JSON.parse(JSON.stringify(reopened.takeSnapshot())),
			JSON.parse(JSON.stringify(sketch.takeSnapshot()))
		);
	});
});

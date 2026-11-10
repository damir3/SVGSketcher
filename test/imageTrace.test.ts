import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTraceGeometry } from '../src/model/imageTrace/build';
import { filterTracePrimitives, traceImage, type TraceInput } from '../src/model/imageTrace/trace';
import { cloneTraceSettings, DEFAULT_TRACE_SETTINGS, type ImageTraceSettings } from '../src/model/imageTrace/types';
import { SketchDocument } from '../src/model/sketch';

function makeImage(width: number, height: number, inside: (x: number, y: number) => boolean): TraceInput {
	const gray = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// 4x supersampling for anti-aliased edges.
			let dark = 0;
			for (let sy = 0; sy < 2; sy++) {
				for (let sx = 0; sx < 2; sx++) if (inside(x + 0.25 + sx * 0.5, y + 0.25 + sy * 0.5)) dark++;
			}
			gray[y * width + x] = 255 - (dark / 4) * 255;
		}
	}
	return { gray, width, height, yScale: 1, pixelSize: 1 };
}

function settings(changes: Partial<ImageTraceSettings> = {}): ImageTraceSettings {
	return { ...cloneTraceSettings(DEFAULT_TRACE_SETTINGS), ...changes };
}

describe('image tracing', () => {
	it('traces a filled disk as a single circle', () => {
		const image = makeImage(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 40);
		const result = traceImage(image, settings());
		assert.equal(result.circles.length, 1);
		assert.equal(result.paths.length, 0);
		assert.ok(Math.abs(result.circles[0].radius - 40) < 1);
		assert.ok(Math.abs(result.circles[0].center.x - 60) < 1);
	});

	it('traces a filled rectangle outline as four lines', () => {
		const image = makeImage(160, 120, (x, y) => x > 20 && x < 140 && y > 30 && y < 90);
		const result = traceImage(image, settings());
		assert.equal(result.paths.length, 1);
		assert.deepEqual(result.stats, { lines: 4, arcs: 0, circles: 0, splines: 0 });
		assert.equal(result.vertices.length, 4);
	});

	it('traces a rounded rectangle as lines joined tangentially by arcs', () => {
		const r = 20;
		const inside = (x: number, y: number) => {
			const cx = Math.min(Math.max(x, 20 + r), 180 - r);
			const cy = Math.min(Math.max(y, 20 + r), 120 - r);
			return Math.hypot(x - cx, y - cy) < r;
		};
		const result = traceImage(makeImage(200, 140, inside), settings());
		assert.equal(result.paths.length, 1);
		assert.equal(result.stats.lines, 4);
		assert.equal(result.stats.arcs, 4);
		assert.equal(result.paths[0].tangent.filter(Boolean).length, 8);
	});

	it('traces a stroked line as a single centerline segment', () => {
		const image = makeImage(160, 60, (x, y) => x > 20 && x < 140 && Math.abs(y - 30) < 3);
		const result = traceImage(image, settings({ mode: 'centerline' }));
		assert.equal(result.stats.lines, 1);
		assert.equal(result.stats.arcs + result.stats.splines, 0);
	});

	it('traces a stroked ring as a centerline circle', () => {
		const image = makeImage(120, 120, (x, y) => Math.abs(Math.hypot(x - 60, y - 60) - 40) < 3);
		for (const centerlineAlgorithm of ['zhang-suen', 'guo-hall'] as const) {
			const result = traceImage(image, settings({ mode: 'centerline', centerlineAlgorithm }));
			assert.equal(result.circles.length, 1, centerlineAlgorithm);
			assert.ok(Math.abs(result.circles[0].radius - 40) < 1.5);
		}
	});

	it('shares junction vertices between centerline paths', () => {
		// A "T" shape.
		const image = makeImage(
			160,
			140,
			(x, y) => (Math.abs(y - 30) < 3 && x > 20 && x < 140) || (Math.abs(x - 80) < 3 && y > 30 && y < 120)
		);
		const result = traceImage(image, settings({ mode: 'centerline' }));
		assert.equal(result.stats.lines, 3);
		const uses = new Map<number, number>();
		for (const path of result.paths) {
			for (const segment of path.segments) {
				uses.set(segment.a, (uses.get(segment.a) ?? 0) + 1);
				uses.set(segment.b, (uses.get(segment.b) ?? 0) + 1);
			}
		}
		assert.ok([...uses.values()].includes(3));
	});

	it('supports the pixel-edge outline algorithm', () => {
		const image = makeImage(160, 120, (x, y) => x > 20 && x < 140 && y > 30 && y < 90);
		const result = traceImage(image, settings({ outlineAlgorithm: 'pixel-edges' }));
		assert.equal(result.stats.lines, 4);
	});

	it('omits disabled circles and converts them in spline mode', () => {
		const disk = makeImage(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 40);
		assert.deepEqual(traceImage(disk, settings({ useCircles: false })).stats, {
			lines: 0,
			arcs: 0,
			circles: 0,
			splines: 0,
		});
		const outlineResult = traceImage(disk, settings({ useSplines: true, useCircles: false, includeSplines: false }));
		assert.deepEqual(outlineResult.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
		assert.equal(outlineResult.closedSplines.length, 1);
		assert.equal(outlineResult.closedSplines[0].points.length, 4);
		assert.equal(outlineResult.paths.length, 0);

		const ring = makeImage(120, 120, (x, y) => Math.abs(Math.hypot(x - 60, y - 60) - 40) < 3);
		const centerResult = traceImage(ring, settings({ mode: 'centerline', useSplines: true }));
		assert.deepEqual(centerResult.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
		assert.equal(centerResult.closedSplines.length, 1);
		assert.equal(centerResult.closedSplines[0].points.length, 4);
		assert.equal(centerResult.paths.length, 0);
	});

	it('converts closed line loops into a single closed spline in spline mode', () => {
		const rect = makeImage(160, 120, (x, y) => x > 20 && x < 140 && y > 30 && y < 90);
		const traceSettings = settings({ useSplines: true });
		const result = traceImage(rect, traceSettings);
		assert.deepEqual(result.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
		assert.equal(result.closedSplines.length, 1);
		assert.equal(result.closedSplines[0].points.length, 4);
		assert.equal(result.paths.length, 0);

		const sketch = new SketchDocument();
		const img = sketch.addImage({
			id: 'Image-rect',
			fileName: 'rect.png',
			x: 0,
			y: 0,
			width: 160,
			height: 120,
			angle: 0,
			opacity: 1,
		});
		buildTraceGeometry(sketch, result, img, traceSettings);
		assert.equal(sketch.splines.size, 1);
		assert.equal([...sketch.lines.values()].filter(l => !l.isSplineHandle).length, 0);
		const spline = [...sketch.splines.values()][0];
		assert.equal(spline.isClosed, true);
	});

	it('converts open lines to splines in spline mode', () => {
		const image = makeImage(160, 60, (x, y) => x > 20 && x < 140 && Math.abs(y - 30) < 3);
		const result = traceImage(image, settings({ mode: 'centerline', useSplines: true }));
		assert.deepEqual(result.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
		assert.equal(result.closedSplines.length, 0);
		assert.equal(result.paths.length, 1);
	});

	it('omits disabled lines and arcs and keeps the remaining segments disconnected', () => {
		const r = 20;
		const inside = (x: number, y: number) => {
			const cx = Math.min(Math.max(x, 20 + r), 180 - r);
			const cy = Math.min(Math.max(y, 20 + r), 120 - r);
			return Math.hypot(x - cx, y - cy) < r;
		};
		const img = makeImage(200, 140, inside);

		const result = traceImage(img, settings());
		const noArcs = filterTracePrimitives(result, settings({ useArcs: false }));
		assert.deepEqual(noArcs.stats, { lines: 4, arcs: 0, circles: 0, splines: 0 });
		assert.equal(noArcs.paths.length, 4);
		assert.ok(noArcs.paths.every(path => !path.closed && path.segments.length === 1 && !path.tangent[0]));

		const noLines = filterTracePrimitives(result, settings({ useLines: false }));
		assert.deepEqual(noLines.stats, { lines: 0, arcs: 4, circles: 0, splines: 0 });

		const neither = filterTracePrimitives(result, settings({ useLines: false, useArcs: false }));
		assert.deepEqual(neither.stats, { lines: 0, arcs: 0, circles: 0, splines: 0 });
		assert.deepEqual(result.stats, { lines: 4, arcs: 4, circles: 0, splines: 0 });
		assert.equal(result.paths.length, 1);
		assert.equal(result.paths[0].closed, true);

		const converted = traceImage(img, settings({ useSplines: true }));
		assert.deepEqual(converted.stats, { lines: 0, arcs: 0, circles: 0, splines: 1 });
		assert.equal(converted.closedSplines.length, 1);

		const withFiltersDisabled = traceImage(
			img,
			settings({ useSplines: true, useLines: false, useArcs: false, useCircles: false, includeSplines: false })
		);
		assert.deepEqual(withFiltersDisabled.stats, converted.stats);
	});
});

describe('image trace geometry', () => {
	const r = 20;
	const roundedRect = (x: number, y: number) => {
		const cx = Math.min(Math.max(x, 20 + r), 180 - r);
		const cy = Math.min(Math.max(y, 20 + r), 120 - r);
		return Math.hypot(x - cx, y - cy) < r;
	};
	const sketchImage = {
		id: 'Image-1',
		fileName: 'shape.png',
		x: 50,
		y: 20,
		width: 200,
		height: 140,
		angle: 0,
		opacity: 1,
	};

	it('creates connected constrained primitives in one undo step', () => {
		const sketch = new SketchDocument();
		const image = sketch.addImage({ ...sketchImage });
		const traceSettings = settings();
		const result = traceImage(makeImage(200, 140, roundedRect), traceSettings);
		// The worker transfers coordinates through structured clone.
		const built = buildTraceGeometry(sketch, structuredClone(result), image, traceSettings);

		assert.equal(sketch.lines.size, 4);
		assert.equal(sketch.arcs.size, 4);
		assert.equal(built.entities.length, 8);
		// Lines and arcs share their end points: 8 junction points plus 4 arc centers.
		assert.equal(sketch.points.size, 12);
		const types = [...sketch.constraints.values()].map(c => c.type);
		assert.equal(types.filter(t => t === 'tangent_line_circle').length, 8);
		assert.equal(types.filter(t => t === 'horizontal').length + types.filter(t => t === 'vertical').length, 4);
		assert.notEqual(sketch.lastSolverResult?.status, 'OVER_CONSTRAINED');

		// World placement: the image spans x 50 ± 100, y 20 ± 70, so the top edge (pixel y = 20) is at y = 70.
		const top = [...sketch.lines.values()].find(line => {
			const p1 = sketch.points.get(line.p1Id)!;
			return Math.abs(p1.y - 70) < 1;
		});
		assert.ok(top);

		sketch.undo();
		assert.equal(sketch.lines.size, 0);
		assert.equal(sketch.points.size, 0);
		assert.equal(sketch.images.size, 1);
	});

	it('removes the image when requested', () => {
		const sketch = new SketchDocument();
		const image = sketch.addImage({ ...sketchImage });
		const traceSettings = settings({ afterConvert: 'delete' });
		const result = traceImage(makeImage(200, 140, roundedRect), traceSettings);
		buildTraceGeometry(sketch, result, image, traceSettings);
		assert.equal(sketch.images.size, 0);
		assert.equal(sketch.arcs.size, 4);
	});

	it('falls back to a spline on curves that are not lines or circular arcs without creating tiny segments', () => {
		// A sinusoidal wave in centerline mode includes spline segments.
		const image = makeImage(
			200,
			100,
			(x, y) => x > 15 && x < 185 && Math.abs(y - (50 + 22 * Math.sin(((x - 15) / 170) * Math.PI * 2))) < 2.5
		);
		const traceSettings = settings({ mode: 'centerline', autoMinSegment: false, minSegment: 230 });
		const result = traceImage(image, traceSettings);
		assert.ok(result.stats.splines > 0);
		const noSplines = traceImage(image, { ...traceSettings, includeSplines: false });
		assert.deepEqual(noSplines.stats, { ...result.stats, splines: 0 });

		const sketch = new SketchDocument();
		const img = sketch.addImage({ ...sketchImage, width: 200, height: 100 });
		buildTraceGeometry(sketch, result, img, traceSettings);
		assert.equal(sketch.splines.size, result.stats.splines);
	});

	it('infers concentric and equal-radius constraints for concentric rings', () => {
		const image = makeImage(160, 160, (x, y) => {
			const d = Math.hypot(x - 80, y - 80);
			return d < 55 && d > 30;
		});
		const traceSettings = settings({
			constraints: {
				tangent: true,
				horizontalVertical: true,
				parallelPerpendicular: false,
				equal: true,
				concentric: true,
			},
		});
		const result = traceImage(image, traceSettings);
		assert.equal(result.circles.length, 2);

		const sketch = new SketchDocument();
		const img = sketch.addImage({ ...sketchImage, width: 160, height: 160 });
		buildTraceGeometry(sketch, result, img, traceSettings);
		assert.equal(sketch.circles.size, 2);
		const hasConcentric = [...sketch.constraints.values()].some(c => c.type === 'concentric');
		assert.ok(hasConcentric);
	});
});

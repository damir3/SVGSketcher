import { SketchDocument } from '../../src/model/sketch';
import type { OffsetChain, OffsetPrimitiveGeom } from '../../src/math/offset';
import { Vec2 } from '../../src/math/vector';
import { readFileSync } from 'node:fs';

/** A narrow dumbbell, with independent line, circular, spline and elliptical-arc variants. */
export function mixedOffsetScene(kind: 'lines' | 'arcs' | 'mixed' | 'arc-neck', reversed = false, rotation = 0) {
	const sketch = new SketchDocument();
	const positions = [
		[-30, -15],
		[-10, -15],
		[-10, -3],
		[10, -3],
		[10, -15],
		[30, -15],
		[30, 15],
		[10, 15],
		[10, 3],
		[-10, 3],
		[-10, 15],
		[-30, 15],
	].map(([x, y]) => new Vec2(x, y));
	const items: OffsetChain['items'] = [];
	sketch.withDeferredSolve(() => {
		const points = positions.map(p => sketch.addPoint(p));
		for (let i = 0; i < points.length; i++) {
			const a = points[i],
				b = points[(i + 1) % points.length];
			let id: string, type: OffsetChain['items'][number]['type'];
			if (kind !== 'lines' && (i === 5 || i === 11 || (kind === 'arc-neck' && (i === 2 || i === 8)))) {
				const c = sketch.addPoint(
					i === 5 ? new Vec2(30, 0) : i === 11 ? new Vec2(-30, 0) : i === 2 ? new Vec2(0, -20) : new Vec2(0, 20)
				);
				id = sketch.addArc(c.id, a.id, b.id, c.distanceTo(a), i === 2 || i === 8).id;
				type = 'arc';
			} else if ((kind === 'mixed' || kind === 'arc-neck') && i === 0) {
				id = sketch.addFitSpline([a.id, b.id], undefined, false, undefined, false, [
					{ h1: new Vec2(-36, -11), h2: new Vec2(-24, -19) },
					{ h1: new Vec2(-16, -19), h2: new Vec2(-4, -11) },
				]).id;
				type = 'spline';
			} else if (kind === 'mixed' && i === 6) {
				const c = sketch.addPoint(new Vec2(20, 15)),
					major = sketch.addPoint(new Vec2(30, 15)),
					minor = sketch.addPoint(new Vec2(20, 27));
				id = sketch.addEllipticalArc(c.id, major.id, minor.id, a.id, b.id, false).id;
				type = 'elliptical_arc';
			} else {
				id = sketch.addLine(a.id, b.id).id;
				type = 'line';
			}
			items.push({ id, type, startPointId: a.id, endPointId: b.id });
		}
	});
	if (reversed) {
		items.reverse();
		for (const item of items) {
			[item.startPointId, item.endPointId] = [item.endPointId, item.startPointId];
			item.reversed = true;
		}
	}
	const ordered = [...items.slice(rotation), ...items.slice(0, rotation)];
	const chain: OffsetChain = { items: ordered, isClosed: true, firstSelectedId: ordered[0].id };
	sketch.clearHistory();
	return { sketch, chain };
}

export function offsetContourGroups(primitives: OffsetPrimitiveGeom[]): OffsetPrimitiveGeom[][] {
	const groups: OffsetPrimitiveGeom[][] = [];
	for (const p of primitives) {
		if (groups.at(-1) && (groups.at(-1)![0].contourIndex ?? 0) === (p.contourIndex ?? 0)) groups.at(-1)!.push(p);
		else groups.push([p]);
	}
	return groups;
}

/** A closed chain whose right offset component consists of only a fragment of its open source spline. */
export function openSplineLoopScene() {
	const original = new SketchDocument();
	original.restoreSnapshot(
		JSON.parse(
			readFileSync(new URL('../fixtures/spline-internal-offset.svg', import.meta.url), 'utf8').match(
				/<!\[CDATA\[([\s\S]*?)\]\]>/
			)![1]
		).snapshot
	);
	const source = original.splines.get('Spline-1')!,
		curves = source.toGeoCurve(original)!.bezierSegments!;
	const sketch = new SketchDocument();
	let chain!: OffsetChain;
	sketch.withDeferredSolve(() => {
		const points = curves.map(c => sketch.addPoint(c[0]));
		const handles = points.map((p, i) => ({
			h1: Vec2.from(curves[(i + curves.length - 1) % curves.length][2]),
			h2: Vec2.from(curves[i][1]),
		}));
		const spline = sketch.addFitSpline(
			points.map(p => p.id),
			undefined,
			false,
			undefined,
			false,
			handles
		);
		const line = sketch.addLine(points.at(-1)!.id, points[0].id);
		chain = {
			isClosed: true,
			items: [
				{ id: spline.id, type: 'spline', startPointId: points[0].id, endPointId: points.at(-1)!.id },
				{ id: line.id, type: 'line', startPointId: points.at(-1)!.id, endPointId: points[0].id },
			],
		};
	});
	sketch.clearHistory();
	return { sketch, chain };
}

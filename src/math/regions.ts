import type { SketchDocument } from '../model/sketch';
import { getGeometryKernel } from '../kernel';
import { getAllGeoCurves, getSplineSelfIntersections, type GeoCurve, type GeoSpline } from './intersection';
import { extractSplineInterval } from './spline';
import { Vec2 } from './vector';
import { findCurveRegions as findCurveRegionsReference, type SketchRegion } from './regionsReference';

export { pointInRegion, type SketchRegion } from './regionsReference';

function splitSelfIntersectingSplines(curves: GeoCurve[]): GeoCurve[] {
	let result: GeoCurve[] | undefined;
	for (let curveIndex = 0; curveIndex < curves.length; curveIndex++) {
		const curve = curves[curveIndex];
		if (curve.type !== 'spline' || curve.bezierSegments.length === 0) {
			result?.push(curve);
			continue;
		}
		const segs = curve.bezierSegments;
		const rawCuts: number[] = [];
		for (const { paramA, paramB } of getSplineSelfIntersections(segs, !!curve.isClosed)) {
			rawCuts.push(paramA, paramB);
		}
		const cuts = rawCuts
			.filter(t => t > 1e-5 && t < 1 - 1e-5)
			.sort((a, b) => a - b)
			.filter((t, idx, all) => idx === 0 || Math.abs(t - all[idx - 1]) > 1e-6);
		if (cuts.length === 0) {
			result?.push(curve);
			continue;
		}
		if (!result) result = curves.slice(0, curveIndex);
		const stops = [0, ...cuts, 1];
		const intervals: Array<[number, number]> =
			curve.isClosed && cuts.length >= 2
				? cuts.map((t, k) => [t, cuts[(k + 1) % cuts.length]])
				: Array.from({ length: stops.length - 1 }, (_, k) => [stops[k], stops[k + 1]]);
		intervals.forEach(([t0, t1], idx) => {
			const sub = extractSplineInterval(segs, t0, t1);
			if (sub.length === 0) return;
			const piece: GeoSpline = {
				...curve,
				id: `${curve.id}#self#${curveIndex}#${idx}`,
				isClosed: false,
				bezierSegments: sub,
			};
			result!.push(piece);
		});
	}
	return result ?? curves;
}

/** SVG formatting stays in JS; all boundary geometry and topology come from the kernel. */
function formatPath(commands: Float64Array): string {
	const parts: string[] = [];
	let i = 0;
	const point = () => `${commands[i++].toFixed(5)} ${(-commands[i++]).toFixed(5)}`;
	while (i < commands.length) {
		const tag = commands[i++];
		if (tag === 0) parts.push(`M ${point()}`);
		else if (tag === 1) parts.push(`L ${point()}`);
		else if (tag === 2) parts.push(`C ${point()} ${point()} ${point()}`);
		else if (tag === 3) {
			const rx = commands[i++],
				ry = commands[i++],
				rotation = commands[i++],
				large = commands[i++],
				sweep = commands[i++];
			parts.push(`A ${rx.toFixed(5)} ${ry.toFixed(5)} ${rotation.toFixed(5)} ${large} ${sweep} ${point()}`);
		} else parts.push('Z');
	}
	return parts.join(' ');
}

export function findSketchRegions(sketch: SketchDocument): SketchRegion[] {
	return findCurveRegions(getAllGeoCurves(sketch).filter(curve => !curve.isConstruction));
}

export function findCurveRegions(curves: GeoCurve[]): SketchRegion[] {
	const kernel = getGeometryKernel();
	if (!kernel.findRegions) return findCurveRegionsReference(splitSelfIntersectingSplines(curves));
	return kernel.findRegions(curves).map(region => ({
		points: region.rings[0].points.map(Vec2.from),
		holes: region.rings.slice(1).map(ring => ring.points.map(Vec2.from)),
		area: region.area,
		path: region.rings.map(ring => formatPath(ring.commands)).join(' '),
	}));
}

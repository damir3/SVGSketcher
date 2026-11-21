import type { SketchDocument } from '../model/sketch';
import { getGeometryKernel } from '../kernel';
import { getAllGeoCurves, type GeoCurve } from './intersection';
import { Vec2 } from './vector';
import { getQueryKernel } from './queries';

export interface SketchRegion {
	points: Vec2[];
	holes: Vec2[][];
	area: number;
	path: string;
}

export function regionsContainingPoint(point: Vec2, regions: readonly SketchRegion[]): boolean[] {
	return getQueryKernel().contains(regions, point);
}
export function pointInRegion(point: Vec2, region: SketchRegion): boolean {
	return regionsContainingPoint(point, [region])[0];
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
	const findRegions = getGeometryKernel().findRegions;
	if (!findRegions) throw new Error('Region construction requires the Rust/WASM kernel');
	return findRegions(curves).map(region => ({
		points: region.rings[0].points.map(Vec2.from),
		holes: region.rings.slice(1).map(ring => ring.points.map(Vec2.from)),
		area: region.area,
		path: region.rings.map(ring => formatPath(ring.commands)).join(' '),
	}));
}

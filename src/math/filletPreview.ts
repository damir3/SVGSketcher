import type { SketchDocument } from '../model/sketch';
import { isFilletAtStart, type FilletCandidate } from './fillet';
import { extractSplineInterval, type BezierSegment } from './spline';
import type { Vec2 } from './vector';

export interface FilletPreviewTrim {
	start?: { point: Vec2; param: number };
	end?: { point: Vec2; param: number };
}

export function collectFilletPreviewTrims(
	sketch: SketchDocument,
	fillets: readonly FilletCandidate[]
): Map<string, FilletPreviewTrim> {
	const trims = new Map<string, FilletPreviewTrim>();
	for (const f of fillets) {
		const r = f.result;
		if (!r) continue;
		for (const [primitive, point, param, hint] of [
			[f.primitive1, r.t1, r.param1, f.endPointId1],
			[f.primitive2, r.t2, r.param2, f.endPointId2],
		] as const) {
			let start: string | undefined, end: string | undefined;
			if (primitive.type === 'line') {
				const line = sketch.lines.get(primitive.id);
				start = line?.p1Id;
				end = line?.p2Id;
			} else if (primitive.type === 'arc') {
				const arc = sketch.arcs.get(primitive.id);
				start = arc?.startPointId;
				end = arc?.endPointId;
			} else {
				const spline = sketch.splines.get(primitive.id);
				start = spline?.pointIds[0];
				end = spline?.pointIds.at(-1);
			}
			if (!start || !end) continue;
			const atStart = isFilletAtStart(sketch, start, end, param, hint, r.cornerVertex);
			const trim = trims.get(primitive.id) ?? {};
			trim[atStart ? 'start' : 'end'] = { point, param };
			trims.set(primitive.id, trim);
		}
	}
	return trims;
}

/** Exact retained cubics, with the preview's tangent points as visible endpoints. */
export function filletSplinePreview(
	segments: BezierSegment[],
	type: 'fit' | 'control',
	trim: FilletPreviewTrim
): BezierSegment[] {
	const a = Math.max(0, Math.min(1, trim.start?.param ?? 0));
	const b = Math.max(0, Math.min(1, trim.end?.param ?? 1));
	if (a >= b) return [];
	// Interval extraction may share whole cubics with the source; only change cloned arrays.
	const result = extractSplineInterval(segments, a, b).map(segment => [...segment] as BezierSegment);
	if (!result.length) return result;
	if (trim.start) {
		const first = result[0];
		if (type === 'fit' && trim.start.param < 0) first[1] = first[1].clone().add(trim.start.point.clone().sub(first[0]));
		first[0] = trim.start.point;
	}
	if (trim.end) {
		const last = result[result.length - 1];
		if (type === 'fit' && trim.end.param > 1) last[2] = last[2].clone().add(trim.end.point.clone().sub(last[3]));
		last[3] = trim.end.point;
	}
	return result;
}

import { packRegionCurves } from './regionWasm';
import type { OffsetKernel, KernelOffsetPrimitive, KernelOffsetSide } from './offsetTypes';
export type OffsetBinding = (curves: Float64Array, items: Float64Array, settings: Float64Array) => Float64Array;
export function createWasmOffsetKernel(binding: OffsetBinding): OffsetKernel {
	return {
		calculate(items, closed, reference, direction, d1, d2, flip) {
			const curves = items.flatMap(item => (item.curve ? [item.curve] : [])),
				records: number[] = [];
			let index = 0;
			for (const item of items)
				records.push(
					item.curve ? index++ : -1,
					['line', 'arc', 'spline', 'circle', 'ellipse', 'elliptical_arc'].indexOf(item.kind),
					Number(!!item.reversed) + 2 * Number(!!(item.endpointReversed ?? item.reversed)),
					Number(!!item.gizmoClockwise)
				);
			const data = binding(
				packRegionCurves(curves),
				new Float64Array(records),
				new Float64Array([
					Number(closed),
					reference,
					['one_side', 'two_sides', 'symmetric'].indexOf(direction),
					d1,
					d2,
					Number(flip),
				])
			);
			const fail = (): never => {
				throw new Error('Invalid WASM offset result');
			};
			if (!data.every(Number.isFinite)) fail();
			let cursor = 0;
			const read = () => {
				if (cursor >= data.length) fail();
				return data[cursor++];
			};
			const count = () => {
				const n = read();
				if (!Number.isSafeInteger(n) || n < 0 || n > data.length - cursor) fail();
				return n;
			};
			const point = () => ({ x: read(), y: read() });
			const flag = () => {
				const value = read();
				if (value !== 0 && value !== 1) fail();
				return value === 1;
			};
			const code = (max = 4) => {
				const value = read();
				if (!Number.isInteger(value) || value < 0 || value > max) fail();
				return value;
			};
			const errors = [
				undefined,
				undefined,
				'Offset distance exceeds circle radius',
				'Offset collapses arc radius',
				'No primitives selected in chain',
			];
			const error = code(),
				gizmoAnchor = point(),
				gizmoNormal = point(),
				total = count();
			if (total !== (items.length ? (direction === 'one_side' ? 1 : 2) : 0)) fail();
			const sides: KernelOffsetSide[] = [];
			for (let s = 0; s < total; s++) {
				const error = code(3),
					side = read(),
					distance = read(),
					n = count();
				if ((side !== 1 && side !== -1) || (error === 0 && (distance < 0 || n === 0)) || (error !== 0 && n !== 0))
					fail();
				const primitives: KernelOffsetPrimitive[] = [];
				let previousContour = 0;
				let previousSource = -1;
				for (let i = 0; i < n; i++) {
					const source = read(),
						contour = read(),
						tag = read(),
						slots = count(),
						end = cursor + slots;
					if (
						!Number.isInteger(source) ||
						source < 0 ||
						(contour === previousContour && source <= previousSource) ||
						!Number.isInteger(contour) ||
						contour < previousContour ||
						contour > previousContour + 1 ||
						contour > i ||
						(!closed && contour !== 0) ||
						source >= items.length ||
						!Number.isInteger(tag) ||
						tag < 0 ||
						tag > 3 ||
						end > data.length
					)
						fail();
					previousContour = contour;
					previousSource = source;
					const sourceId = items[source].sourceId;
					let p: KernelOffsetPrimitive;
					if (tag === 0) {
						if (slots !== 4 || items[source].kind !== 'line') fail();
						p = { sourceId, type: 'line', p1: point(), p2: point() };
					} else if (tag === 1) {
						if (slots !== 8 || items[source].kind !== 'arc') fail();
						const center = point(),
							start = point(),
							end = point(),
							radius = read(),
							clockwise = flag();
						if (radius <= 0.1) fail();
						p = { sourceId, type: 'arc', center, start, end, radius, clockwise };
					} else if (tag === 2) {
						if (slots !== 3 || items[source].kind !== 'circle' || items.length !== 1) fail();
						const circleCenter = point(),
							circleRadius = read();
						if (circleRadius <= 0.1) fail();
						p = { sourceId, type: 'circle', circleCenter, circleRadius };
					} else {
						const length = count(),
							isSplineClosed = flag(),
							basis = flag(),
							tangents = flag(),
							handles = flag();
						const expected =
							5 + length * 2 + (basis ? length * 4 : 0) + (tangents ? 4 : 0) + (handles ? length * 4 : 0);
						if (length < 2 || slots !== expected) fail();
						const points = () => Array.from({ length }, point);
						p = { sourceId, type: 'spline', fitPoints: points(), isSplineClosed };
						if (basis) {
							p.fitBases = points();
							p.fitNormals = points();
						}
						if (tangents) {
							p.startTangent = point();
							p.endTangent = point();
						}
						if (handles) p.handles = Array.from({ length }, () => ({ h1: point(), h2: point() }));
					}
					if (cursor !== end) fail();
					if (contour) p.contourIndex = contour;
					primitives.push(p);
				}
				if (previousContour === 0) {
					if (n > items.length) fail();
				} else {
					const ends = (p: KernelOffsetPrimitive) =>
						p.type === 'line'
							? [p.p1!, p.p2!]
							: p.type === 'arc'
								? [p.start!, p.end!]
								: p.type === 'spline'
									? [p.fitPoints![0], p.fitPoints!.at(-1)!]
									: undefined;
					for (let start = 0; start < n; ) {
						let end = start + 1;
						while (end < n && (primitives[end].contourIndex ?? 0) === (primitives[start].contourIndex ?? 0)) end++;
						if (end - start === 1 && (primitives[start].type !== 'spline' || !primitives[start].isSplineClosed)) fail();
						for (let i = start; i < end; i++) {
							const a = ends(primitives[i]),
								b = ends(primitives[i + 1 < end ? i + 1 : start]);
							if (
								!a ||
								!b ||
								Math.hypot(a[1].x - b[0].x, a[1].y - b[0].y) > 1e-6 ||
								(end - start > 1 && primitives[i].isSplineClosed)
							)
								fail();
						}
						start = end;
					}
				}
				sides.push({
					primitives,
					side,
					distance,
					isValid: error === 0,
					...(errors[error] ? { errorMessage: errors[error] } : {}),
				});
			}
			const firstError = sides.find(s => !s.isValid);
			if (
				cursor !== data.length ||
				(items.length === 0
					? error !== 4
					: error !== (firstError ? (firstError.errorMessage ? errors.indexOf(firstError.errorMessage) : 1) : 0))
			)
				fail();
			return { sides, gizmoAnchor, gizmoNormal, isValid: error === 0, errorMessage: errors[error] };
		},
	};
}

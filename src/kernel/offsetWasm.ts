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
			const splitSpline =
				closed && items.length === 1 && items[0].curve?.type === 'spline' && !!items[0].curve.isClosed;
			for (let s = 0; s < total; s++) {
				const error = code(3),
					side = read(),
					distance = read(),
					n = count();
				if (
					(side !== 1 && side !== -1) ||
					(error === 0 && (distance < 0 || n === 0 || (!splitSpline && n > items.length))) ||
					(error !== 0 && n !== 0)
				)
					fail();
				const primitives: KernelOffsetPrimitive[] = [];
				let previousSource = -1;
				for (let i = 0; i < n; i++) {
					const source = read(),
						tag = read(),
						slots = count(),
						end = cursor + slots;
					if (
						!Number.isInteger(source) ||
						source < 0 ||
						source < previousSource ||
						(source === previousSource && !splitSpline) ||
						source >= items.length ||
						!Number.isInteger(tag) ||
						tag < 0 ||
						tag > 3 ||
						end > data.length
					)
						fail();
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
					if (cursor !== end || (n > items.length && (p.type !== 'spline' || !p.isSplineClosed))) fail();
					primitives.push(p);
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

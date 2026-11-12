import { packRegionCurves } from './regionWasm';
import type { EditingCurve, EditingKernel } from './editingTypes';
import type { Point2 } from './types';

export type EditingBinding = (curves: Float64Array, settings: Float64Array) => Float64Array;

export function createWasmEditingKernel(binding: EditingBinding): EditingKernel {
	const fail = (): never => {
		throw new Error('Invalid WASM editing result');
	};
	function query(mode: number, target: EditingCurve, curves: readonly EditingCurve[], cursor: Point2 = { x: 0, y: 0 }) {
		// Legacy synthetic extension curves must still skip equal IDs, including reserved-name collisions.
		const reserved =
			mode !== 2
				? undefined
				: target.type === 'segment' || target.type === 'spline'
					? '__extend_ray__'
					: target.type === 'arc'
						? '__extend_circle__'
						: target.type === 'elliptical_arc'
							? '__extend_ellipse__'
							: undefined;
		const targetIndex = curves.findIndex(curve => curve.id === target.id);
		const indices: number[] = [],
			others: EditingCurve[] = [];
		curves.forEach((curve, index) => {
			if (curve.id !== target.id && curve.id !== reserved) {
				indices.push(index);
				others.push(curve);
			}
		});
		const data = binding(
			packRegionCurves([target, ...others]),
			new Float64Array([mode, cursor.x, cursor.y, Number(target.type === 'spline' && target.splineType === 'control')])
		);
		if (!data.every(Number.isFinite)) fail();
		const source = (value: number) => {
			if (value === -1) return undefined;
			if (target.type === 'spline' && value === indices.length) {
				return targetIndex === -1 ? curves.length : targetIndex;
			}
			if (!Number.isInteger(value) || value < 0 || value >= indices.length) fail();
			return indices[value];
		};
		const limit = target.type === 'circle' || target.type === 'ellipse' ? Math.PI * 2 : 1;
		const parameter = (value: number) => {
			if (!Number.isFinite(value) || value < 0 || value > limit) fail();
			return value;
		};
		const flag = (value: number) => {
			if (value !== 0 && value !== 1) fail();
			return value === 1;
		};
		return { data, source, parameter, flag };
	}
	return {
		intersections(target, curves) {
			const { data, source, parameter } = query(0, target, curves),
				count = data[0];
			if (!Number.isSafeInteger(count) || count < 0 || data.length !== 1 + count * 4) fail();
			return Array.from({ length: count }, (_, i) => {
				const offset = 1 + i * 4,
					index = source(data[offset + 3]);
				if (index === undefined) fail();
				const param = parameter(data[offset + 2]);
				if (i > 0 && param < data[offset - 2]) fail();
				return { point: { x: data[offset], y: data[offset + 1] }, param, source: index };
			});
		},
		trim(target, curves, cursor) {
			const { data, source, parameter, flag } = query(1, target, curves, cursor);
			if (data.length !== 9) fail();
			const startSource = source(data[6]),
				endSource = source(data[7]),
				whole = flag(data[8]);
			if (whole && (startSource !== undefined || endSource !== undefined)) fail();
			return {
				interval: [parameter(data[0]), parameter(data[1])],
				start: { x: data[2], y: data[3] },
				end: { x: data[4], y: data[5] },
				startSource,
				endSource,
				whole,
			};
		},
		extend(target, curves, cursor) {
			const { data, source, flag } = query(2, target, curves, cursor);
			if (data.length === 1 && data[0] === 0) return null;
			if (data.length !== 8 || data[0] !== 1 || target.type === 'circle' || target.type === 'ellipse') fail();
			const index = source(data[6]),
				fullLoop = flag(data[7]);
			if (fullLoop && (index !== undefined || (target.type !== 'arc' && target.type !== 'elliptical_arc'))) fail();
			return {
				edge: flag(data[1]) ? 'end' : 'start',
				from: { x: data[2], y: data[3] },
				to: { x: data[4], y: data[5] },
				source: index,
				fullLoop,
			};
		},
	};
}

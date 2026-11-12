import type { KernelRegion, KernelRegionRing, RegionKernel, RegionKernelCurve } from './regionTypes';
import type { Point2 } from './types';

export type RegionBinding = (data: Float64Array) => Float64Array;

export function packRegionCurves(curves: readonly RegionKernelCurve[]): Float64Array {
	let size = 0;
	for (const curve of curves)
		size +=
			4 +
			(curve.type === 'segment'
				? 4
				: curve.type === 'circle'
					? 3
					: curve.type === 'ellipse'
						? 6
						: curve.type === 'arc'
							? 7
							: curve.type === 'elliptical_arc'
								? 10
								: curve.bezierSegments.length * 8);
	const out = new Float64Array(size),
		ids = new Map<string, number>();
	let offset = 0;
	const point = (p: Point2) => {
		out[offset++] = p.x;
		out[offset++] = p.y;
	};
	for (const curve of curves) {
		if (!ids.has(curve.id)) ids.set(curve.id, ids.size);
		const header = offset;
		offset += 4;
		const tag = ['segment', 'circle', 'ellipse', 'arc', 'elliptical_arc', 'spline'].indexOf(curve.type);
		out[header] = tag;
		out[header + 1] = ids.get(curve.id)!;
		out[header + 2] =
			curve.type === 'spline'
				? Number(!!curve.isClosed)
				: curve.type === 'arc' || curve.type === 'elliptical_arc'
					? Number(curve.clockwise)
					: 0;
		if (curve.type === 'segment') {
			point(curve.p1);
			point(curve.p2);
		} else if (curve.type === 'spline') {
			for (const cubic of curve.bezierSegments) for (const p of cubic) point(p);
		} else {
			point(curve.center);
			if (curve.type === 'circle' || curve.type === 'arc') out[offset++] = curve.radius;
			else {
				point(curve.majorAxisPoint);
				point(curve.minorAxisPoint);
			}
			if (curve.type === 'arc' || curve.type === 'elliptical_arc') {
				point(curve.start);
				point(curve.end);
			}
		}
		out[header + 3] = offset - header - 4;
	}
	return out;
}

export function createWasmRegionKernel(binding: RegionBinding): RegionKernel {
	return curves => {
		if (!curves.length) return [];
		const data = binding(packRegionCurves(curves));
		let offset = 0;
		const fail = () => {
			throw new Error('Invalid WASM region result');
		};
		const count = () => {
			const n = data[offset++];
			if (!Number.isSafeInteger(n) || n < 0 || n > data.length - offset) fail();
			return n;
		};
		if (!data.every(Number.isFinite)) fail();
		const total = count(),
			regions: KernelRegion[] = [];
		for (let r = 0; r < total; r++) {
			const area = data[offset++];
			if (!Number.isFinite(area)) fail();
			const ringCount = count();
			if (ringCount < 1) fail();
			const rings: KernelRegionRing[] = [];
			for (let k = 0; k < ringCount; k++) {
				const n = count();
				if (n < 3 || n * 2 > data.length - offset) fail();
				const points: Point2[] = [];
				for (let i = 0; i < n; i++) points.push({ x: data[offset++], y: data[offset++] });
				const slots = count();
				if (slots < 4) fail();
				const commands = data.slice(offset, offset + slots);
				offset += slots;
				let cursor = 0,
					closed = false;
				const arity = [2, 2, 6, 7, 0];
				while (cursor < commands.length) {
					const tag = commands[cursor++];
					if (!Number.isInteger(tag) || !(tag in arity)) fail();
					if (cursor === 1 && tag !== 0) fail();
					if ((tag === 0 && cursor !== 1) || (tag === 4 && cursor !== commands.length)) fail();
					if (tag === 4) closed = true;
					if (
						tag === 3 &&
						(commands[cursor] < 0 ||
							commands[cursor + 1] < 0 ||
							![0, 1].includes(commands[cursor + 3]) ||
							![0, 1].includes(commands[cursor + 4]))
					)
						fail();
					cursor += arity[tag];
					if (cursor > commands.length) fail();
				}
				if (!closed) fail();
				rings.push({ points, commands });
			}
			regions.push({ area, rings });
		}
		if (offset !== data.length) fail();
		return regions;
	};
}

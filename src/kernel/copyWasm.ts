import type { CopyKernel, CopyOperation } from './copyTypes';
export type CopyBinding = (points: Float64Array, operations: Float64Array) => Float64Array;
export function packCopyOperation(op: CopyOperation): number[] {
	const p = (v: { x: number; y: number }) => [v.x, v.y];
	switch (op.type) {
		case 'mirror':
			return [0, ...p(op.a), ...p(op.b)];
		case 'circular':
			return [
				1,
				...p(op.center),
				op.quantity,
				['full', 'partial', 'symmetric'].indexOf(op.distribution),
				op.angle,
				op.index,
			];
		case 'rectangular':
			return [
				2,
				...p(op.u1),
				...p(op.u2),
				op.distance1,
				op.distance2,
				Number(op.direction1 === 'symmetric'),
				Number(op.direction2 === 'symmetric'),
				op.i,
				op.j,
			];
		case 'rotation':
			return [3, ...p(op.center), op.angle];
		case 'translation':
			return [4, ...p(op.offset)];
		case 'directions':
			return [
				5,
				Number(!!op.line1),
				...(op.line1 ? op.line1.flatMap(p) : [0, 0, 0, 0]),
				Number(!!op.line2),
				...(op.line2 ? op.line2.flatMap(p) : [0, 0, 0, 0]),
			];
	}
}
export function createWasmCopy(binding: CopyBinding): CopyKernel {
	return (points, operations) => {
		const data = new Float64Array(points.length * 2);
		points.forEach((p, i) => {
			data[2 * i] = p.x;
			data[2 * i + 1] = p.y;
		});
		const requests = operations.flatMap(packCopyOperation);
		if (!data.every(Number.isFinite) || !requests.every(Number.isFinite)) throw Error('Non-finite copy geometry input');
		const out = binding(data, new Float64Array(requests)),
			stride = 6 + 3 * points.length;
		if (out.length !== operations.length * stride) throw Error('Invalid WASM copy geometry result');
		return operations.map((_, i) => {
			let at = i * stride;
			const flag = () => {
				const value = out[at++];
				if (![0, 1].includes(value)) throw Error('Invalid WASM copy geometry flag');
				return !!value;
			};
			const valid = flag(),
				angle = out[at++],
				offset = { x: out[at++], y: out[at++] },
				normal = { x: out[at++], y: out[at++] };
			const result: { x: number; y: number }[] = [],
				near: boolean[] = [];
			for (let j = 0; j < points.length; j++) {
				result.push({ x: out[at++], y: out[at++] });
				near.push(flag());
			}
			return { valid, angle, offset, normal, points: result, near };
		});
	};
}

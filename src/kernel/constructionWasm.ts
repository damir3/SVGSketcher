import { CONSTRUCTION_ARITIES, CONSTRUCTION_MODES, type ConstructionKernel } from './constructionTypes';
export type ConstructionBinding = (mode: number, data: Float64Array) => Float64Array;
const sizes = [3, 3, 3, 2, 3, 3, 3, 5, 7, 5, 9, 8, 1, 19, 1, 4, -1, 2, 1];
export function createWasmConstruction(binding: ConstructionBinding): ConstructionKernel {
	return (mode, input) => {
		const tag = CONSTRUCTION_MODES.indexOf(mode);
		if (tag < 0 || input.length !== CONSTRUCTION_ARITIES[tag] || !input.every(Number.isFinite))
			throw new Error('Invalid construction input');
		const data = binding(tag, new Float64Array(input));
		if (data.length === 1 && data[0] === 0) return null;
		const size = mode === 'polygon_vertices' ? input[3] * 2 : sizes[tag];
		if (data[0] !== 1 || data.length !== size + 1 || !data.every(Number.isFinite))
			throw new Error('Invalid WASM construction result');
		const out = Array.from(data.slice(1));
		if (
			((mode === 'arc_three_point' || mode === 'arc_tangent' || mode === 'arc_center') && ![0, 1].includes(out[3])) ||
			(mode === 'arc_through' && ![0, 1].includes(out[0]))
		)
			throw new Error('Invalid WASM construction flags');
		return out;
	};
}

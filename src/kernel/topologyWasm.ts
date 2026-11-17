import type { TopologyInput, TopologyKernel, TopologySnapshot } from './topologyTypes';

export type TopologyBinding = (
	points: Float64Array,
	links: Float64Array,
	endpoints: Float64Array,
	settings: Float64Array
) => Float64Array;

export function createWasmTopologyKernel(binding: TopologyBinding): TopologyKernel {
	const run = (input: TopologyInput, mode: number, tolerance: number, root = -1) => {
		const points = new Float64Array(
			input.points.flatMap(p => [Number(!!p.position), Number(p.listed), p.position?.x ?? 0, p.position?.y ?? 0])
		);
		const output = binding(
			points,
			new Float64Array(input.links.flat()),
			new Float64Array(input.endpoints.flat()),
			new Float64Array([mode, tolerance, input.origin, root])
		);
		if (!output.every(Number.isFinite)) throw new Error('Invalid WASM topology result');
		let at = 0;
		const read = (max: number) => {
			const value = output[at++];
			if (!Number.isSafeInteger(value) || value < 0 || value > max)
				throw new Error('Invalid WASM topology index or count');
			return value;
		};
		const members = () => {
			const count = read(input.points.length),
				result: number[] = [];
			for (let i = 0; i < count; i++) result.push(read(input.points.length - 1));
			if (new Set(result).size !== count) throw new Error('Duplicate WASM topology member');
			return result;
		};
		const done = () => {
			if (at !== output.length) throw new Error('Trailing WASM topology data');
		};
		return { read, members, done };
	};
	return {
		group(input, root, tolerance) {
			const data = run(input, 0, tolerance, root),
				group = data.members();
			if (group[0] !== root) throw new Error('Invalid WASM topology root');
			data.done();
			return group;
		},
		prepare(input, tolerance): TopologySnapshot {
			const data = run(input, 1, tolerance),
				count = data.read(input.points.length);
			const labels = input.points.map(() => data.read(count - 1));
			const groups: TopologySnapshot['groups'] = [];
			const memberships: Set<number>[] = [];
			for (let i = 0; i < count; i++) {
				const members = data.members(),
					included = new Set(members),
					total = data.read(input.endpoints.length);
				const connections: TopologySnapshot['groups'][number]['connections'] = [];
				let previous = -1;
				for (let j = 0; j < total; j++) {
					const primitive = data.read(input.endpoints.length - 1),
						connected = data.read(input.points.length - 1),
						other = data.read(input.points.length - 1);
					const [a, b] = input.endpoints[primitive];
					if (
						primitive <= previous ||
						!included.has(connected) ||
						included.has(other) ||
						!((a === connected && b === other) || (b === connected && a === other))
					)
						throw new Error('Invalid WASM topology connection');
					previous = primitive;
					connections.push({ primitive, connected, other });
				}
				if (!members.length) throw new Error('Empty WASM topology component');
				groups.push({ members, connections });
				memberships.push(included);
			}
			for (const [point, label] of labels.entries()) {
				if (!memberships[label].has(point)) throw new Error('Invalid WASM topology label');
			}
			data.done();
			return { labels, groups };
		},
	};
}

import type { Point2 } from './types';

export interface TopologyInput {
	points: readonly { position?: Point2; listed: boolean }[];
	links: readonly (readonly [number, number])[];
	endpoints: readonly (readonly [number, number])[];
	origin: number;
}
export interface TopologyConnection {
	primitive: number;
	connected: number;
	other: number;
}
export interface TopologySnapshot {
	labels: number[];
	groups: { members: number[]; connections: TopologyConnection[] }[];
}
export interface TopologyKernel {
	group(input: TopologyInput, root: number, tolerance: number): number[];
	prepare(input: TopologyInput, tolerance: number): TopologySnapshot;
}

/** Parameter references and formula records shared by the native constraint compilers. */
export interface Ref {
	id: string | null;
	fallback: number;
}

export interface Description {
	kind: number;
	refs: Ref[];
	a: number;
	b: number;
	numeric?: boolean;
	/** Row count for one record within a composite constraint. */
	equations?: number;
}

export const point = (id: string): Ref[] => {
	if (id === 'origin' || id === 'axis_x' || id === 'axis_y')
		return [constant(id === 'axis_x' ? 1 : 0), constant(id === 'axis_y' ? 1 : 0)];
	return [
		{ id: `${id}.x`, fallback: 0 },
		{ id: `${id}.y`, fallback: 0 },
	];
};
export const scalar = (id: string, fallback = 0): Ref => ({ id, fallback });
export const constant = (fallback: number): Ref => ({ id: null, fallback });

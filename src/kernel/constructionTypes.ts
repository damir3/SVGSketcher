/** Pure numeric construction queries; document IDs, selection and popup state stay in the editor. */
export const CONSTRUCTION_MODES = [
	'circumcircle',
	'circle_preview',
	'circle_chord',
	'line_intersection',
	'circle_two_tangent',
	'circle_two_tangent_radius',
	'circle_three_tangent',
	'arc_three_point',
	'arc_tangent',
	'arc_center',
	'slot_centers',
	'slot_outline',
	'slot_radius',
	'arc_slot',
	'arc_slot_radius',
	'polygon_edge',
	'polygon_vertices',
	'point_at_distance',
	'arc_through',
] as const;
export type ConstructionMode = (typeof CONSTRUCTION_MODES)[number];
/** Null denotes an ordinary degenerate construction, not a boundary/decoder error. */
export type ConstructionKernel = (mode: ConstructionMode, data: readonly number[]) => number[] | null;
export const CONSTRUCTION_ARITIES = [6, 6, 7, 10, 10, 11, 12, 11, 11, 9, 6, 9, 8, 9, 5, 6, 6, 6, 8] as const;

import type { Vec2 } from '../../math/vector';

export type PrimitiveType =
	| 'point'
	| 'line'
	| 'circle'
	| 'arc'
	| 'ellipse'
	| 'elliptical_arc'
	| 'spline';

/**
 * Common polymorphic interface for all sketch geometric primitives.
 */
export interface ISketchPrimitive {
	readonly id: string;
	readonly type: PrimitiveType;
	isConstruction?: boolean;

	/**
	 * Calculates Euclidean distance in screen pixels from a screen position to the primitive.
	 * Returns null if the primitive is degenerate or cursor is outside active span.
	 */
	distanceTo(screen: Vec2, sketch: any, viewport: any, thresholdPx?: number): number | null;

	/**
	 * Checks if this primitive is inside or intersects an axis-aligned bounding box (world coordinates).
	 */
	intersectsAABB(minX: number, minY: number, maxX: number, maxY: number, sketch?: any): boolean;
}

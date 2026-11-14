import { Vec2 } from '../../math/vector';
import type { GeoCurve } from '../../math/intersection';
import type { IInspectable } from '../../ui/panels/inspector/types';

export type PrimitiveType = 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';

export interface PrimitiveSnapCandidate {
	type: 'line' | 'circle' | 'ellipse' | 'spline';
	id: string;
	dist: number;
	worldPos: Vec2;
	screenPos: Vec2;
}

/**
 * Common polymorphic interface for all sketch geometric primitives.
 */
export interface ISketchPrimitive extends IInspectable {
	readonly id: string;
	readonly type: PrimitiveType;
	isConstruction?: boolean;

	/**
	 * Returns all defining point IDs of this primitive.
	 */
	getPointIds(sketch?: any): string[];

	/**
	 * Calculates Euclidean distance in screen pixels from a screen position to the primitive.
	 * Returns null if the primitive is degenerate or cursor is outside active span.
	 */
	distanceTo(screen: Vec2, sketch: any, viewport: any, thresholdPx?: number): number | null;

	/**
	 * Checks if this primitive is inside or intersects an axis-aligned bounding box (world coordinates).
	 */
	intersectsAABB(min: Vec2, max: Vec2, sketch?: any): boolean;

	/**
	 * Converts the sketch primitive into a normalized GeoCurve representation for geometric operations.
	 * Returns null if the primitive is degenerate or not a curve (e.g. points).
	 */
	toGeoCurve(sketch: any): GeoCurve | null;

	/**
	 * Finds the closest snap point on this primitive within maxDistPx (in screen pixels).
	 */
	snapTo(
		screenPos: Vec2,
		sketch: any,
		viewport: any,
		maxDistPx: number,
		tolerancePx?: number
	): PrimitiveSnapCandidate | null;

	/**
	 * Updates this primitive's geometry during an interactive drag in select mode.
	 */
	drag(
		sketch: any,
		startWorld: Vec2,
		currentWorld: Vec2,
		initialPoints: ReadonlyMap<string, Vec2>,
		event: { shiftKey?: boolean; altKey?: boolean }
	): void;
}

export function translatePrimitivePoints(
	sketch: any,
	startWorld: Vec2,
	currentWorld: Vec2,
	initialPoints: ReadonlyMap<string, Vec2>
): void {
	const dir = new Vec2().subVectors(currentWorld, startWorld);
	for (const [pid, startPos] of initialPoints.entries()) {
		const pt = sketch.points.get(pid);
		if (pt && !pt.fixed) {
			pt.addVectors(startPos, dir);
		}
	}
	sketch.solve();
}

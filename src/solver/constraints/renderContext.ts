import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import type { LinearDimensionVisualOptions } from '../../canvas/dimensionGeometry';
import type { Vec2 } from '../../math/vector';

export type { LinearDimensionVisualOptions };

const TWO_PI = 2 * Math.PI;

export interface ConstraintRenderContext {
	readonly sketch: SketchDocument;
	readonly viewport: Viewport;
	readonly targetGroup: SVGGElement;
	isSelected: boolean;
	readonly lineBadgeCounts?: Map<string, number>;

	renderBadge(id: string, position: Vec2, label: string, color?: string): void;
	renderBadgeOnSegment(id: string, p1Id: string, p2Id: string, label: string): void;
	renderBadgeOnCircle(id: string, circleId: string, label: string): void;
	renderLinearDimensionVisual(opts: LinearDimensionVisualOptions): void;

	readonly patternCheckboxGroup?: SVGGElement;
	readonly patternCheckboxPositions?: Map<string, { x: number; y: number; copyIndex: number; constraintId?: string }>;
	readonly rectangularGizmoHandles?: Map<string, { x: number; y: number; axis: 1 | 2; constraintId?: string }>;

	renderTransformedObjects?(
		objectIds: Iterable<string>,
		transform:
			| { center: { x: number; y: number }; angleDeg: number }
			| Vec2
			| ((x: number, y: number) => { x: number; y: number }),
		options: {
			targetGroup?: SVGGElement;
			baseColor?: string;
			opacity?: number;
			drawVertices?: boolean;
			skipRender?: boolean;
		}
	): { x: number; y: number }[];
	renderPatternSuppressionCheckbox?(
		centroid: { x: number; y: number },
		k: number,
		isSuppressed: boolean,
		constraintId?: string
	): void;
	renderRectangularPatternGizmos?(
		viewport: Viewport,
		centroidWorld: { x: number; y: number },
		u1: { x: number; y: number },
		u2: { x: number; y: number },
		distance1: number,
		distance2: number,
		options: {
			targetGroup: SVGGElement;
			constraintId?: string;
		}
	): void;
}

export function isConstraintOnlySelected(constraintId: string, sketch: SketchDocument): boolean {
	const sel = sketch.selection;
	return (
		sel.constraintIds.has(constraintId) &&
		sel.pointIds.size === 0 &&
		sel.lineIds.size === 0 &&
		sel.circleIds.size === 0 &&
		sel.arcIds.size === 0 &&
		sel.ellipseIds.size === 0 &&
		sel.ellipticalArcIds.size === 0
	);
}

export function isAngleNearArc(
	arc: { startPointId: string; endPointId: string; clockwise?: boolean },
	center: Vec2,
	point: Vec2,
	sketch: SketchDocument,
	viewport: Viewport,
	rScreen: number
): boolean {
	const start = sketch.points.get(arc.startPointId);
	const end = sketch.points.get(arc.endPointId);
	if (!start || !end) return true;

	const sCenter = viewport.worldToScreen(center);
	const ss = viewport.worldToScreen(start);
	const se = viewport.worldToScreen(end);
	const as = sCenter.angleToPoint(ss);
	const ae = sCenter.angleToPoint(se);
	const aPt = sCenter.angleToPoint(point);
	const clockwise = !!arc.clockwise;

	let totalSweep = 0;
	let ptSweep = 0;
	if (clockwise) {
		totalSweep = (ae - as) % TWO_PI;
		if (totalSweep < 0) totalSweep += TWO_PI;
		ptSweep = (aPt - as) % TWO_PI;
		if (ptSweep < 0) ptSweep += TWO_PI;
	} else {
		totalSweep = (as - ae) % TWO_PI;
		if (totalSweep < 0) totalSweep += TWO_PI;
		ptSweep = (as - aPt) % TWO_PI;
		if (ptSweep < 0) ptSweep += TWO_PI;
	}

	if (ptSweep > totalSweep) {
		const excessAngle = Math.min(ptSweep - totalSweep, TWO_PI - ptSweep);
		if (excessAngle * rScreen > 60) {
			return false;
		}
	}
	return true;
}

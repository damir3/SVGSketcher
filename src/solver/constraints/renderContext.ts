import type { SketchDocument } from '../../model/sketch';
import type { Viewport } from '../../canvas/viewport';
import type { LinearDimensionVisualOptions } from '../../canvas/dimensionGeometry';

export type { LinearDimensionVisualOptions };

export interface ConstraintRenderContext {
	readonly sketch: SketchDocument;
	readonly viewport: Viewport;
	readonly targetGroup: SVGGElement;
	isSelected: boolean;
	readonly lineBadgeCounts?: Map<string, number>;

	renderBadge(id: string, x: number, y: number, label: string, color?: string): void;
	renderBadgeOnSegment(id: string, p1Id: string, p2Id: string, label: string): void;
	renderBadgeOnCircle(id: string, circleId: string, label: string): void;
	renderLinearDimensionVisual(opts: LinearDimensionVisualOptions): void;
	renderDashedExtensionLines?(
		g: SVGGElement,
		sCenter: { x: number; y: number },
		angle: number,
		rScreen: number,
		sp1: { x: number; y: number },
		sp2: { x: number; y: number },
		color: string
	): void;

	readonly patternCheckboxGroup?: SVGGElement;
	readonly patternCheckboxPositions?: Map<string, { x: number; y: number; copyIndex: number; constraintId?: string }>;
	readonly rectangularGizmoHandles?: Map<string, { x: number; y: number; axis: 1 | 2; constraintId?: string }>;

	isConstraintOnlySelected?(constraintId: string): boolean;
	renderTransformedObjects?(
		objectIds: Iterable<string>,
		transform:
			| { center: { x: number; y: number }; angleDeg: number }
			| { dx: number; dy: number }
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
	isAngleNearArc?(
		arc: { startPointId: string; endPointId: string; clockwise?: boolean },
		center: { x: number; y: number },
		px: number,
		py: number,
		rScreen: number
	): boolean;
}

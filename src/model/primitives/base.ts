import { Vec2 } from '../../math/vector';
import type { GeoCurve } from '../../math/intersection';
import type { FilletPreviewTrim } from '../../math/filletPreview';
import type { IInspectable } from '../../ui/panels/inspector/types';
import { createSvgElement } from '../../canvas/svg';
import type { SvgAttrs } from '../../canvas/styles';

export type PrimitiveType = 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';

export interface PrimitiveSnapCandidate {
	type: 'line' | 'circle' | 'ellipse' | 'spline';
	id: string;
	dist: number;
	worldPos: Vec2;
	screenPos: Vec2;
}

export interface PrimitiveRenderContext {
	readonly sketch: any;
	readonly viewport: any;
	readonly geometryGroup: SVGGElement;
	readonly pointGroup: SVGGElement;
	readonly options: any;
	readonly isSelected: boolean;
	readonly baseColor: string;
	readonly hasConflict: boolean;
	readonly isPointConstrained: (pointId: string) => boolean;
	readonly activeSplineIds: ReadonlySet<string>;
	readonly lineCuts: ReadonlyMap<string, ReadonlyMap<string, Vec2>>;
	readonly filletTrims: ReadonlyMap<string, FilletPreviewTrim>;
	readonly splinePointInfo: ReadonlyMap<string, { splineId: string; isHandleDot: boolean }>;
	readonly deferTangentGroup: (group: SVGGElement) => void;
}

export interface PrimitiveTransformRenderOptions {
	/** Optional curve snapshot prepared by a batched preview. */
	readonly geometry?: GeoCurve | null;
	readonly sketch: any;
	readonly viewport: any;
	readonly transformPoint: (x: number, y: number) => { x: number; y: number };
	readonly targetGroup?: SVGGElement;
	readonly strokeAttrs?: SvgAttrs;
	readonly transformScale?: number;
	readonly invertWinding?: boolean;
	readonly drawVertex?: (screenPt: Vec2, worldPt: { x: number; y: number }) => void;
}

export function isPointIdConstrained(pointId: string, constrainedParams?: ReadonlySet<string>): boolean {
	return !!constrainedParams?.has(`${pointId}.x`) && constrainedParams.has(`${pointId}.y`);
}

export function createPrimitiveSvgGroup(
	primitive: { id: string; type: PrimitiveType },
	isSelected: boolean,
	parent: SVGGElement,
	extraClass = ''
): SVGGElement {
	const typeClass = `sketch-${primitive.type.replace('_', '-')}`;
	const classes = ['sketch-entity', typeClass, isSelected ? 'is-selected' : '', extraClass].filter(Boolean).join(' ');
	return createSvgElement(
		'g',
		{
			'data-id': primitive.id,
			'data-type': primitive.type,
			class: classes,
		},
		parent
	);
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
	 * Checks whether all degrees of freedom of this primitive are constrained.
	 */
	isConstrained(sketch: any, constrainedParams?: ReadonlySet<string>): boolean;

	/**
	 * Renders this primitive onto the SVG canvas layers.
	 */
	render(ctx: PrimitiveRenderContext): void;

	/**
	 * Renders a transformed copy of this primitive (or computes its transformed points when targetGroup is omitted).
	 */
	renderTransformed(opts: PrimitiveTransformRenderOptions): Array<{ x: number; y: number }>;

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

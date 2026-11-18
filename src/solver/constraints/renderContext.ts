import type { SketchDocument } from '../../model/sketch';
import { getSelectionCount } from '../../model/selection';
import type { Viewport } from '../../canvas/viewport';
import type { LinearDimensionVisualOptions } from '../../canvas/dimensionGeometry';
import { Vec2 } from '../../math/vector';
import { createSvgElement, createSvgLine, createSvgPath, createSvgRect } from '../../canvas/svg';
import {
	COLORS,
	CHECKBOX_HALO_ATTRS,
	CHECKBOX_ACTIVE_ATTRS,
	CHECKBOX_CHECKMARK_ATTRS,
	CHECKBOX_SUPPRESSED_ATTRS,
	CHECKBOX_SUPPRESSED_DASH_ATTRS,
} from '../../canvas/styles';

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

export function getPatternBaseColor(sketch: SketchDocument): string {
	const status = sketch.lastSolverResult?.status;
	return status === 'OVER_CONSTRAINED'
		? COLORS.conflict
		: status === 'CONVERGED'
			? COLORS.constrained
			: COLORS.unconstrained;
}

export function renderPatternSuppressionCheckbox(
	parent: SVGElement,
	centroid: { x: number; y: number },
	k: number,
	isSuppressed: boolean,
	constraintId?: string
): void {
	const cbG = createSvgElement(
		'g',
		{
			class: 'pattern-suppression-checkbox',
			style: 'cursor: pointer;',
			'data-copy-k': String(k),
			...(constraintId ? { 'data-constraint-id': constraintId } : {}),
		},
		parent
	);

	// Outer halo / shadow
	createSvgRect(Vec2.from(centroid).subScalar(11), new Vec2(22, 22), CHECKBOX_HALO_ATTRS, cbG);
	createSvgRect(
		Vec2.from(centroid).subScalar(9),
		new Vec2(18, 18),
		isSuppressed ? CHECKBOX_SUPPRESSED_ATTRS : CHECKBOX_ACTIVE_ATTRS,
		cbG
	);
	if (!isSuppressed) {
		createSvgPath(
			`M ${centroid.x - 4.5} ${centroid.y} L ${centroid.x - 1.5} ${centroid.y + 3.5} L ${centroid.x + 5} ${centroid.y - 3.5}`,
			CHECKBOX_CHECKMARK_ATTRS,
			cbG
		);
	} else {
		createSvgLine(
			new Vec2(centroid.x - 4, centroid.y),
			new Vec2(centroid.x + 4, centroid.y),
			CHECKBOX_SUPPRESSED_DASH_ATTRS,
			cbG
		);
	}
}

export function renderPatternConstraintCopy(opts: {
	ctx: ConstraintRenderContext;
	constraintId: string;
	copyIndex: number;
	isSuppressed: boolean;
	copy?: { pointPairs: ReadonlyArray<{ patternPtId: string }> };
	sourceObjectIds: readonly string[];
	transform: { center: { x: number; y: number }; angleDeg: number } | Vec2;
	baseColor: string;
	fallbackScreenCentroid: () => { x: number; y: number };
}): void {
	const { ctx, constraintId, copyIndex, isSuppressed, copy, sourceObjectIds, transform, baseColor } = opts;

	let copyWorldPoints: Array<{ x: number; y: number }> = [];
	if (copy && copy.pointPairs.length > 0 && !isSuppressed) {
		for (const pair of copy.pointPairs) {
			const pt = ctx.sketch.points.get(pair.patternPtId);
			if (pt) copyWorldPoints.push(pt);
		}
	} else if (ctx.renderTransformedObjects) {
		copyWorldPoints = ctx.renderTransformedObjects(sourceObjectIds, transform, {
			targetGroup: ctx.targetGroup,
			baseColor,
			opacity: 0.25,
			drawVertices: true,
			skipRender: !isSuppressed,
		});
	}
	const copyCentroid = copyWorldPoints.length
		? ctx.viewport.worldToScreen(Vec2.centroid(copyWorldPoints))
		: opts.fallbackScreenCentroid();

	ctx.patternCheckboxPositions?.set(`c-${constraintId}-${copyIndex}`, {
		x: copyCentroid.x,
		y: copyCentroid.y,
		copyIndex,
		constraintId,
	});
	if (ctx.patternCheckboxGroup) {
		renderPatternSuppressionCheckbox(ctx.patternCheckboxGroup, copyCentroid, copyIndex, isSuppressed, constraintId);
	}
}

export function pointBadgePos(
	sketch: SketchDocument,
	viewport: Viewport,
	pointId: string,
	dx = 0,
	dy = 14
): Vec2 | null {
	const pt = sketch.points.get(pointId);
	return pt ? viewport.worldToScreen(pt).add({ x: dx, y: dy }) : null;
}

export function renderPointBadge(
	ctx: ConstraintRenderContext,
	id: string,
	pointId: string,
	label: string,
	dx = 0,
	dy = 14,
	color: string = COLORS.primary
): void {
	const pos = pointBadgePos(ctx.sketch, ctx.viewport, pointId, dx, dy);
	if (pos) ctx.renderBadge(id, pos, label, color);
}

export function isConstraintOnlySelected(constraintId: string, sketch: SketchDocument): boolean {
	const sel = sketch.selection;
	return sel.constraintIds.has(constraintId) && getSelectionCount(sketch) === sel.constraintIds.size;
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
	const as = sCenter.angleToPoint(viewport.worldToScreen(start));
	const ae = sCenter.angleToPoint(viewport.worldToScreen(end));
	const aPt = sCenter.angleToPoint(point);
	const sign = arc.clockwise ? 1 : -1;
	const positive = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
	const totalSweep = positive(sign * (ae - as));
	const ptSweep = positive(sign * (aPt - as));

	return !(ptSweep > totalSweep && Math.min(ptSweep - totalSweep, TWO_PI - ptSweep) * rScreen > 60);
}

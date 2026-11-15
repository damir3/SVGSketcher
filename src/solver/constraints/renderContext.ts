import type { SketchDocument } from '../../model/sketch';
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

	if (!isSuppressed) {
		// Active checkbox (blue filled with white checkmark)
		createSvgRect(Vec2.from(centroid).subScalar(9), new Vec2(18, 18), CHECKBOX_ACTIVE_ATTRS, cbG);

		createSvgPath(
			`M ${centroid.x - 4.5} ${centroid.y} L ${centroid.x - 1.5} ${centroid.y + 3.5} L ${centroid.x + 5} ${centroid.y - 3.5}`,
			CHECKBOX_CHECKMARK_ATTRS,
			cbG
		);
	} else {
		// Suppressed checkbox (grey outline with red dash)
		createSvgRect(Vec2.from(centroid).subScalar(9), new Vec2(18, 18), CHECKBOX_SUPPRESSED_ATTRS, cbG);

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

	let copyCentroid: { x: number; y: number };
	if (copy && copy.pointPairs.length > 0 && !isSuppressed) {
		const pts: Vec2[] = [];
		for (const pair of copy.pointPairs) {
			const pt = ctx.sketch.points.get(pair.patternPtId);
			if (pt) pts.push(pt);
		}
		copyCentroid = pts.length > 0 ? ctx.viewport.worldToScreen(Vec2.centroid(pts)) : opts.fallbackScreenCentroid();
	} else if (ctx.renderTransformedObjects) {
		const copyWorldPoints = ctx.renderTransformedObjects(sourceObjectIds, transform, {
			targetGroup: ctx.targetGroup,
			baseColor,
			opacity: 0.25,
			drawVertices: true,
			skipRender: !isSuppressed,
		});
		copyCentroid =
			copyWorldPoints.length > 0
				? ctx.viewport.worldToScreen(Vec2.centroid(copyWorldPoints))
				: opts.fallbackScreenCentroid();
	} else {
		copyCentroid = opts.fallbackScreenCentroid();
	}

	if (ctx.patternCheckboxPositions) {
		ctx.patternCheckboxPositions.set(`c-${constraintId}-${copyIndex}`, {
			x: copyCentroid.x,
			y: copyCentroid.y,
			copyIndex,
			constraintId,
		});
	}

	if (ctx.patternCheckboxGroup) {
		renderPatternSuppressionCheckbox(ctx.patternCheckboxGroup, copyCentroid, copyIndex, isSuppressed, constraintId);
	}
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

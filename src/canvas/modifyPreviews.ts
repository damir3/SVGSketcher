import type { ChamferCandidate, ChamferMode } from '../math/chamfer';
import type { FilletCandidate } from '../math/fillet';
import type { OffsetChain, OffsetDirection, OffsetGeometryResult } from '../math/offset';
import { fitPointsToBezier, getSplineSvgPath } from '../math/spline';
import { Vec2 } from '../math/vector';
import type { SketchDocument } from '../model/sketch';
import type { TransformValues } from '../model/transform';
import { prepareTransformPreview } from '../model/transformPreview';
import type { GeoCurve } from '../math/intersection';
import {
	buildPointParamMap,
	computePatternCopyAngle,
	computeRectangularPatternDirections,
	computeRectangularPatternOffset,
	getPatternBaseColor,
	renderPatternSuppressionCheckbox,
} from '../solver/constraints';
import { formatDimensionValue } from './dimensionGeometry';
import { GIZMO_DISTANCE_PX } from './distances';
import {
	CHAMFER_CUT_LINE_ATTRS,
	CHAMFER_HIGHLIGHT_ATTRS,
	COLORS,
	FILLET_ARC_ATTRS,
	FILLET_GIZMO_SQUARE_ATTRS,
	FILLET_WEDGE_ATTRS,
	GIZMO_ARROW_ATTRS,
	GIZMO_GUIDE_ATTRS,
	GIZMO_POINT_ATTRS,
	getCopyStrokeAttrs,
	MIRROR_PREVIEW_LINE_ATTRS,
	MIRROR_PREVIEW_VERTEX_ATTRS,
	OFFSET_CHAIN_ATTRS,
	OFFSET_PREVIEW_ATTRS,
	PATTERN_CENTER_CROSSHAIR_ATTRS,
	PATTERN_CENTER_DOT_ATTRS,
	PATTERN_CENTER_RING_ATTRS,
	RECT_PATTERN_PILL_ATTRS,
	RECT_PATTERN_PILL_TEXT_ATTRS,
	STROKE_WIDTH,
	type SvgAttrs,
} from './styles';
import {
	createSvgArrow,
	createSvgCircle,
	createSvgElement,
	createSvgGizmoCircle,
	createSvgGizmoDashedLine,
	createSvgLine,
	createSvgPath,
	createSvgRect,
	createSvgText,
	getArcSvgPath,
} from './svg';
import { calculateObjectsCentroid } from './tools/modify/utils';
import type { Viewport } from './viewport';
import type { XY } from '../math/vector';

export type ScreenHandlePos = XY | { screenX: number; screenY: number };

export function getHandleScreenPos(handle: ScreenHandlePos): Vec2 {
	return 'x' in handle ? new Vec2(handle.x, handle.y) : new Vec2(handle.screenX, handle.screenY);
}

/** Returns the first handle within `maxDistance` screen pixels of `screen`. */
export function hitGizmoHandle<T extends ScreenHandlePos>(
	screen: XY,
	handles: Iterable<T | null | undefined> | null | undefined,
	maxDistance = GIZMO_DISTANCE_PX,
	predicate?: (handle: T) => boolean
): T | null {
	if (!handles) return null;
	for (const handle of handles) {
		if (!handle || (predicate && !predicate(handle))) continue;
		if (getHandleScreenPos(handle).distanceTo(screen) <= maxDistance) {
			return handle;
		}
	}
	return null;
}

function unitDirBetween(from: XY, to: XY): Vec2 {
	const v = new Vec2().subVectors(to, from);
	const len = v.length();
	return len > 0 ? v.divideScalar(len) : v;
}

const GIZMO_ARROW_LENGTH = 16;
const GIZMO_ARROW_HALF_WIDTH = 6.5;

function renderGizmoArrow(options: {
	tip: XY;
	dir: XY;
	targetGroup: SVGGElement;
	color?: string;
	arrowAttrs?: SvgAttrs;
	guide?: {
		from: XY;
		attrs?: SvgAttrs;
		to?: 'base' | 'tip';
		minDistance?: number;
	};
}): { base: Vec2; center: Vec2 } {
	const u = Vec2.from(options.dir);
	const tip = Vec2.from(options.tip);
	const base = tip.clone().addScaledVector(u, -GIZMO_ARROW_LENGTH);
	const center = tip.clone().addScaledVector(u, -GIZMO_ARROW_LENGTH * 0.5);

	if (options.guide) {
		const guideEnd = options.guide.to === 'tip' ? tip : base;
		if (
			options.guide.minDistance === undefined ||
			Vec2.from(options.guide.from).distanceTo(guideEnd) > options.guide.minDistance
		) {
			if (options.guide.attrs) {
				createSvgLine(options.guide.from, guideEnd, options.guide.attrs, options.targetGroup);
			} else {
				createSvgGizmoDashedLine(options.guide.from, guideEnd, options.targetGroup);
			}
		}
	}

	const attrs: SvgAttrs =
		options.color || options.arrowAttrs
			? {
					...GIZMO_ARROW_ATTRS,
					...(options.color ? { fill: options.color } : undefined),
					...options.arrowAttrs,
				}
			: GIZMO_ARROW_ATTRS;
	createSvgArrow(tip, u, GIZMO_ARROW_LENGTH, GIZMO_ARROW_HALF_WIDTH, attrs, options.targetGroup);
	return { base, center };
}

export interface OffsetGizmoHandle {
	type: 'dist1' | 'dist2';
	screenX: number;
	screenY: number;
	worldPos: Vec2;
	normal: Vec2;
	currentValue: number;
}

export interface ChamferGizmoHandle {
	type: 'dist1' | 'dist2' | 'angle';
	screenX: number;
	screenY: number;
	worldPos: Vec2;
	dir?: Vec2;
	currentValue: number;
}

export interface FilletGizmoHandle {
	screenX: number;
	screenY: number;
	worldMidArc: Vec2;
	worldBisectorDir: Vec2;
	radius: number;
}

export interface PatternAngleHandle {
	x: number;
	y: number;
	worldX: number;
	worldY: number;
	copyIndex: number;
}

export interface PatternCheckboxPosition {
	x: number;
	y: number;
	copyIndex: number;
	constraintId?: string;
}

export interface RectangularGizmoHandle {
	x: number;
	y: number;
	axis: 1 | 2;
	constraintId?: string;
}

export interface MirrorHighlight {
	selectedObjectIds: Set<string>;
	mirrorLineId: string | null;
}

export interface PatternHighlight {
	selectedObjectIds: Set<string>;
	centerPointId: string | null;
	distribution: 'full' | 'partial' | 'symmetric';
	angle: number;
	angleHandleEnabled: boolean;
	quantity: number;
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export interface RectangularPatternHighlight {
	selectedObjectIds: Set<string>;
	line1Id: string | null;
	line2Id: string | null;
	quantity1: number;
	distance1: number;
	direction1: 'one_direction' | 'symmetric';
	quantity2: number;
	distance2: number;
	direction2: 'one_direction' | 'symmetric';
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export interface FilletPreviewState {
	pendingFillets: FilletCandidate[];
	activeFilletId?: string | null;
	selectedPrimitive1?: { type: 'line' | 'arc' | 'spline'; id: string } | null;
	hoverPointId?: string | null;
}

export interface ChamferPreviewState {
	candidate: ChamferCandidate | null;
	firstLine: { id: string; clickPos: Vec2 } | null;
	hoverPointId: string | null;
	mode: ChamferMode;
	flip: boolean;
}

export interface OffsetPreviewState {
	chain: OffsetChain | null;
	geomResult: OffsetGeometryResult | null;
	direction: OffsetDirection;
	dist1: number;
	dist2: number;
	flip: boolean;
}

export interface RenderTransformedOptions {
	geometries?: ReadonlyMap<string, GeoCurve | null>;
	targetGroup?: SVGGElement;
	baseColor?: string;
	opacity?: number;
	isSuppressed?: boolean;
	drawVertices?: boolean;
	strokeWidth?: number;
	skipRender?: boolean;
	transformScale?: number;
	invertWinding?: boolean;
	vertexRadius?: number;
	vertexAttrs?: SvgAttrs;
	deduplicateVertices?: boolean;
}

export function renderTransformedObjects(
	sketch: SketchDocument,
	viewport: Viewport,
	objectIds: Iterable<string>,
	transform:
		| { center: { x: number; y: number }; angleDeg: number }
		| Vec2
		| ((x: number, y: number) => { x: number; y: number }),
	options: RenderTransformedOptions
): Array<{ x: number; y: number }> {
	let transformPoint: (x: number, y: number) => { x: number; y: number };
	if (typeof transform === 'function') {
		transformPoint = transform;
	} else if ('angleDeg' in transform) {
		const rad = (transform.angleDeg * Math.PI) / 180;
		const center = transform.center;
		transformPoint = (x, y) => new Vec2(x, y).rotateAround(center, rad);
	} else {
		transformPoint = (x, y) => new Vec2(x, y).add(transform);
	}

	const copyWorldPoints: Array<{ x: number; y: number }> = [];
	const targetGroup = options.skipRender ? undefined : options.targetGroup;
	const opacity = options.opacity ?? 1.0;
	const baseColor = options.baseColor ?? COLORS.unconstrained;
	const strokeWidth = options.strokeWidth ?? STROKE_WIDTH.normal;
	const seenVertices = options.deduplicateVertices ? new Set<string>() : null;

	const drawVertex = (screenPt: Vec2, worldPt: { x: number; y: number }) => {
		if (!options.drawVertices || !targetGroup) return;
		if (seenVertices) {
			const key = `${Math.round(worldPt.x * 100)},${Math.round(worldPt.y * 100)}`;
			if (seenVertices.has(key)) return;
			seenVertices.add(key);
		}
		createSvgCircle(
			screenPt,
			options.vertexRadius ?? 3,
			options.vertexAttrs ?? {
				fill: options.transformScale !== undefined || baseColor === COLORS.constrained ? baseColor : COLORS.primary,
				stroke: COLORS.white,
				'stroke-width': STROKE_WIDTH.normal,
				opacity,
				'pointer-events': 'none',
			},
			targetGroup
		);
	};

	const getAttrs = (isConstruction: boolean) => {
		const attrs = getCopyStrokeAttrs(isConstruction, baseColor, opacity, strokeWidth);
		return options.transformScale === undefined ? attrs : { ...attrs, stroke: baseColor };
	};

	for (const objId of objectIds) {
		const prim = sketch.getPrimitive(objId);
		if (!prim) continue;
		const pts = prim.renderTransformed({
			geometry: options.geometries?.get(objId),
			sketch,
			viewport,
			transformPoint,
			targetGroup,
			strokeAttrs: targetGroup ? getAttrs(!!prim.isConstruction) : undefined,
			transformScale: options.transformScale,
			invertWinding: options.invertWinding,
			drawVertex,
		});
		copyWorldPoints.push(...pts);
	}

	return copyWorldPoints;
}

export function renderTransformPreview(
	sketch: SketchDocument,
	viewport: Viewport,
	ids: ReadonlySet<string>,
	center: Vec2,
	values: TransformValues,
	targetGroup: SVGGElement,
	color: string,
	renderTextOverlay?: (textTargetGroup: SVGGElement) => void
): void {
	const transform = prepareTransformPreview(sketch, ids, center, values);
	renderTransformedObjects(sketch, viewport, ids, transform.point, {
		geometries: transform.geometries,
		targetGroup,
		baseColor: color,
		transformScale: values.scale,
		drawVertices: true,
	});

	if (sketch.selection.textIds.size === 0 || !renderTextOverlay) return;
	const from = viewport.worldToScreen(center);
	const to = viewport.worldToScreen(transform.point(center.x, center.y));
	const textPreview = createSvgElement(
		'g',
		{
			transform: `translate(${to.x}, ${to.y}) rotate(${-values.angle % 360}) scale(${values.scale}) translate(${-from.x}, ${-from.y})`,
		},
		targetGroup
	);
	renderTextOverlay(textPreview);
}

export function renderRectangularPatternGizmos(
	viewport: Viewport,
	centroidWorld: { x: number; y: number },
	u1: { x: number; y: number },
	u2: { x: number; y: number },
	distance1: number,
	distance2: number,
	options: {
		targetGroup: SVGGElement;
		constraintId?: string;
		gizmoHandles: Map<string, RectangularGizmoHandle>;
	}
): void {
	const sCtr = viewport.worldToScreen(centroidWorld);
	const u1Screen = unitDirBetween(sCtr, viewport.worldToScreen(new Vec2().addVectors(centroidWorld, u1)));
	const u2Screen = unitDirBetween(sCtr, viewport.worldToScreen(new Vec2().addVectors(centroidWorld, u2)));

	const h1World = Vec2.from(centroidWorld).addScaledVector(u1, distance1);
	const h1Screen = viewport.worldToScreen(h1World);

	const h2World = Vec2.from(centroidWorld).addScaledVector(u2, distance2);
	const h2Screen = viewport.worldToScreen(h2World);

	const gizmoG = createSvgElement('g', { class: 'rectangular-pattern-gizmos' }, options.targetGroup);

	const renderArrow = (
		from: { x: number; y: number },
		to: { x: number; y: number },
		dirScreen: { x: number; y: number },
		color: string,
		axisNum: 1 | 2,
		distVal: number
	) => {
		const isNegative = distVal < -1e-3;
		const arrowDir = Vec2.from(dirScreen).multiplyScalar(isNegative ? -1 : 1);
		const perp = arrowDir.clone().perpendicular();
		const offsetDist = 48;

		const tip = Vec2.from(to).addScaledVector(arrowDir, offsetDist);
		const { base: baseCenter, center } = renderGizmoArrow({
			tip,
			dir: arrowDir,
			color,
			arrowAttrs: { 'data-axis': String(axisNum) },
			guide: {
				from,
				to: 'base',
				attrs: {
					stroke: color,
					'stroke-width': 2.5,
					'stroke-dasharray': 'none',
					opacity: 0.9,
					'pointer-events': 'none',
				},
			},
			targetGroup: gizmoG,
		});

		const key = options.constraintId ? `gizmo-${axisNum}-${options.constraintId}` : `gizmo-${axisNum}`;
		options.gizmoHandles.set(key, {
			x: center.x,
			y: center.y,
			axis: axisNum,
			constraintId: options.constraintId,
		});

		const labelText = `${formatDimensionValue(distVal, 1)} mm`;
		const pillWidth = labelText.length * 6.8 + 14;
		const isHorizontal = Math.abs(arrowDir.x) >= Math.abs(arrowDir.y);

		let pillX: number;
		let pillY: number;

		if (isHorizontal) {
			const maxY = Math.max(from.y, tip.y, baseCenter.y + Math.abs(perp.y) * GIZMO_ARROW_HALF_WIDTH);
			pillX = center.x;
			pillY = maxY + 16;
		} else {
			const maxX = Math.max(from.x, tip.x, baseCenter.x + Math.abs(perp.x) * GIZMO_ARROW_HALF_WIDTH);
			pillX = maxX + 10 + pillWidth * 0.5;
			pillY = center.y;
		}

		createSvgRect(
			new Vec2(pillX - pillWidth * 0.5, pillY - 10),
			new Vec2(pillWidth, 20),
			{
				...RECT_PATTERN_PILL_ATTRS,
				stroke: color,
			},
			gizmoG
		);

		createSvgText(new Vec2(pillX, pillY + 3.5), labelText, RECT_PATTERN_PILL_TEXT_ATTRS, gizmoG);
	};

	renderArrow(sCtr, h1Screen, u1Screen, COLORS.patternAxis1, 1, distance1);
	renderArrow(sCtr, h2Screen, u2Screen, COLORS.patternAxis2, 2, distance2);
}

export function renderMirrorPreview(
	sketch: SketchDocument,
	viewport: Viewport,
	targetGroup: SVGGElement,
	selectedObjectIds: Set<string>,
	mirrorLineId: string | null
): void {
	targetGroup.innerHTML = '';
	if (!mirrorLineId) return;

	const line = sketch.getLine(mirrorLineId);
	if (!line) return;
	const pA = sketch.points.get(line.p1Id);
	const pB = sketch.points.get(line.p2Id);
	if (!pA || !pB) return;

	const sA = viewport.worldToScreen(pA);
	const sB = viewport.worldToScreen(pB);

	const dir = new Vec2().subVectors(pB, pA);
	const lineLen = dir.length();
	if (lineLen < 1e-6) return;

	const normal = dir.clone().perpendicular().divideScalar(lineLen);

	// Highlight mirror line: bright gold/amber centerline
	const previewStart =
		mirrorLineId === 'axis_x' ? new Vec2(0, sA.y) : mirrorLineId === 'axis_y' ? new Vec2(sA.x, 0) : sA;
	const previewEnd =
		mirrorLineId === 'axis_x'
			? new Vec2(viewport.width, sA.y)
			: mirrorLineId === 'axis_y'
				? new Vec2(sA.x, viewport.height)
				: sB;
	createSvgLine(previewStart, previewEnd, MIRROR_PREVIEW_LINE_ATTRS, targetGroup);

	if (selectedObjectIds.size === 0) return;

	const baseColor = getPatternBaseColor(sketch);
	const idsToMirror = [...selectedObjectIds].filter(id => id !== mirrorLineId);
	renderTransformedObjects(sketch, viewport, idsToMirror, (x, y) => new Vec2(x, y).reflectAcrossLine(pA, normal), {
		targetGroup,
		baseColor,
		opacity: 0.5,
		drawVertices: true,
		invertWinding: true,
		vertexRadius: 3.5,
		vertexAttrs: {
			...MIRROR_PREVIEW_VERTEX_ATTRS,
			opacity: 0.5,
		},
		deduplicateVertices: true,
	});
}

export function renderPatternPreview(
	sketch: SketchDocument,
	viewport: Viewport,
	options: {
		targetGroup: SVGGElement;
		checkboxGroup: SVGGElement;
		checkboxPositions: Map<string, PatternCheckboxPosition>;
		selectedObjectIds: Set<string>;
		centerPointId: string | null;
		distribution: 'full' | 'partial' | 'symmetric';
		angle: number;
		quantity: number;
		suppression: boolean;
		suppressedIndices: Set<number>;
		angleHandleEnabled?: boolean;
	}
): PatternAngleHandle | null {
	const {
		targetGroup,
		checkboxGroup,
		checkboxPositions,
		selectedObjectIds,
		centerPointId,
		distribution,
		angle,
		quantity,
		suppression,
		suppressedIndices,
		angleHandleEnabled = false,
	} = options;
	targetGroup.innerHTML = '';
	if (!centerPointId) return null;

	const centerPt = sketch.points.get(centerPointId);
	if (!centerPt) return null;

	const sCtr = viewport.worldToScreen(centerPt);

	// Render center point marker: amber target crosshair & concentric ring
	createSvgCircle(sCtr, 12, PATTERN_CENTER_RING_ATTRS, targetGroup);
	createSvgLine(
		new Vec2(sCtr.x - 16, sCtr.y),
		new Vec2(sCtr.x + 16, sCtr.y),
		PATTERN_CENTER_CROSSHAIR_ATTRS,
		targetGroup
	);
	createSvgLine(
		new Vec2(sCtr.x, sCtr.y - 16),
		new Vec2(sCtr.x, sCtr.y + 16),
		PATTERN_CENTER_CROSSHAIR_ATTRS,
		targetGroup
	);
	createSvgCircle(sCtr, 4, PATTERN_CENTER_DOT_ATTRS, targetGroup);

	if (selectedObjectIds.size === 0) return null;

	const N = Math.max(2, Math.round(quantity));
	const baseColor = getPatternBaseColor(sketch);
	let lastVisibleCopyIndex = N - 1;
	if (suppression) {
		while (lastVisibleCopyIndex > 0 && suppressedIndices.has(lastVisibleCopyIndex)) lastVisibleCopyIndex--;
	}

	let angleHandle: PatternAngleHandle | null = null;

	for (let k = 1; k < N; k++) {
		const aDeg = computePatternCopyAngle(k, N, distribution, angle);
		const isSuppressed = suppressedIndices.has(k);
		const copyOpacity = isSuppressed ? 0.15 : 0.5;

		const copyWorldPoints = renderTransformedObjects(
			sketch,
			viewport,
			selectedObjectIds,
			{ center: centerPt, angleDeg: aDeg },
			{
				targetGroup,
				baseColor,
				opacity: copyOpacity,
				isSuppressed,
				drawVertices: true,
				strokeWidth: STROKE_WIDTH.normal,
			}
		);

		const worldCentroid =
			copyWorldPoints.length > 0
				? Vec2.centroid(copyWorldPoints)
				: Vec2.fromPolar(40, (aDeg * Math.PI) / 180).add(centerPt);
		const copyCentroid =
			copyWorldPoints.length > 0
				? viewport.worldToScreen(worldCentroid)
				: Vec2.fromPolar(40, (aDeg * Math.PI) / 180).add(sCtr);

		checkboxPositions.set(`tool-${k}`, {
			x: copyCentroid.x,
			y: copyCentroid.y,
			copyIndex: k,
		});

		if (suppression) {
			renderPatternSuppressionCheckbox(checkboxGroup, copyCentroid, k, isSuppressed);
		}
		if (angleHandleEnabled && k === lastVisibleCopyIndex) {
			const direction = angle < 0 ? -1 : 1;
			const dirVector = unitDirBetween(sCtr, copyCentroid).perpendicular().multiplyScalar(-direction);
			const { base } = renderGizmoArrow({
				tip: Vec2.from(copyCentroid).addScaledVector(dirVector, 30),
				dir: dirVector,
				guide: { from: copyCentroid, to: 'base' },
				targetGroup,
			});
			angleHandle = {
				x: base.x,
				y: base.y,
				worldX: worldCentroid.x,
				worldY: worldCentroid.y,
				copyIndex: k,
			};
		}
	}

	return angleHandle;
}

export function renderRectangularPatternPreview(
	sketch: SketchDocument,
	viewport: Viewport,
	options: {
		targetGroup: SVGGElement;
		checkboxGroup: SVGGElement;
		checkboxPositions: Map<string, PatternCheckboxPosition>;
		gizmoHandles: Map<string, RectangularGizmoHandle>;
		highlight: RectangularPatternHighlight;
	}
): void {
	const { targetGroup, checkboxGroup, checkboxPositions, gizmoHandles, highlight } = options;
	targetGroup.innerHTML = '';
	if (highlight.selectedObjectIds.size === 0) return;

	const centroidWorld = calculateObjectsCentroid(sketch, highlight.selectedObjectIds);
	if (!centroidWorld) return;

	const paramMap = buildPointParamMap(sketch);
	const line1 = highlight.line1Id ? sketch.lines.get(highlight.line1Id) : null;
	const line2 = highlight.line2Id ? sketch.lines.get(highlight.line2Id) : null;
	const { u1, u2 } = computeRectangularPatternDirections(
		paramMap,
		line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
		line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
	);

	const maxI = Math.abs(highlight.distance1) > 1e-6 ? highlight.quantity1 : 1;
	const maxJ = Math.abs(highlight.distance2) > 1e-6 ? highlight.quantity2 : 1;
	const baseColor = getPatternBaseColor(sketch);

	for (let i = 0; i < maxI; i++) {
		for (let j = 0; j < maxJ; j++) {
			if (i === 0 && j === 0) continue;
			const copyIndex = i * 1000 + j;
			const isSuppressed = highlight.suppressedIndices.has(copyIndex);
			const copyOpacity = isSuppressed ? 0.15 : 0.5;
			const offset = computeRectangularPatternOffset(
				i,
				j,
				highlight.distance1,
				highlight.direction1,
				highlight.distance2,
				highlight.direction2,
				u1,
				u2
			);

			const copyWorldPoints = renderTransformedObjects(sketch, viewport, highlight.selectedObjectIds, offset, {
				targetGroup,
				baseColor,
				opacity: copyOpacity,
				isSuppressed,
				drawVertices: true,
				strokeWidth: STROKE_WIDTH.normal,
			});

			const copyCentroid = viewport.worldToScreen(
				copyWorldPoints.length > 0 ? Vec2.centroid(copyWorldPoints) : centroidWorld.clone().add(offset)
			);

			checkboxPositions.set(`tool-${copyIndex}`, {
				x: copyCentroid.x,
				y: copyCentroid.y,
				copyIndex,
			});

			if (highlight.suppression) {
				renderPatternSuppressionCheckbox(checkboxGroup, copyCentroid, copyIndex, isSuppressed);
			}
		}
	}

	renderRectangularPatternGizmos(viewport, centroidWorld, u1, u2, highlight.distance1, highlight.distance2, {
		targetGroup,
		gizmoHandles,
	});
}

export function renderFilletPreviews(
	viewport: Viewport,
	targetGroup: SVGGElement,
	state: FilletPreviewState
): FilletGizmoHandle | null {
	let gizmoHandle: FilletGizmoHandle | null = null;

	for (const pf of state.pendingFillets) {
		const res = pf.result;
		if (!res) continue;

		const sV = viewport.worldToScreen(res.cornerVertex);
		const sT1 = viewport.worldToScreen(res.t1);
		const sT2 = viewport.worldToScreen(res.t2);
		const sCenter = viewport.worldToScreen(res.center);
		const sMid = viewport.worldToScreen(res.midArc);
		const sRadius = res.radius * viewport.zoom;

		const sweepWedgeFlag = res.clockwise ? 0 : 1;
		const wedgePath = `M ${sT1.x} ${sT1.y} L ${sV.x} ${sV.y} L ${sT2.x} ${sT2.y} A ${sRadius.toFixed(2)} ${sRadius.toFixed(2)} 0 0 ${sweepWedgeFlag} ${sT1.x} ${sT1.y} Z`;
		createSvgPath(wedgePath, FILLET_WEDGE_ATTRS, targetGroup);

		const arcD = getArcSvgPath(sCenter, sT1, sT2, sRadius, res.clockwise);
		createSvgPath(arcD, FILLET_ARC_ATTRS, targetGroup);

		const isActive =
			pf.id === state.activeFilletId ||
			(!state.activeFilletId && pf === state.pendingFillets[state.pendingFillets.length - 1]);
		if (isActive) {
			createSvgCircle(sCenter, 4, GIZMO_POINT_ATTRS, targetGroup);

			const uDir = unitDirBetween(sCenter, sMid);
			const lineEnd = sCenter.clone().addScaledVector(uDir, sRadius + 45);

			createSvgGizmoDashedLine(sCenter, lineEnd, targetGroup);

			const sqSize = 6;
			createSvgRect(
				new Vec2(lineEnd.x - sqSize * 0.5, lineEnd.y - sqSize * 0.5),
				new Vec2(sqSize, sqSize),
				FILLET_GIZMO_SQUARE_ATTRS,
				targetGroup
			);

			renderGizmoArrow({
				tip: sMid,
				dir: uDir.clone().negate(),
				targetGroup,
			});

			gizmoHandle = {
				screenX: sMid.x,
				screenY: sMid.y,
				worldMidArc: res.midArc,
				worldBisectorDir: res.bisectorDir,
				radius: res.radius,
			};
		}
	}

	return gizmoHandle;
}

export function renderChamferPreviews(
	viewport: Viewport,
	targetGroup: SVGGElement,
	state: ChamferPreviewState,
	gizmoHandles: ChamferGizmoHandle[]
): void {
	const cand = state.candidate;
	if (!cand || !cand.result) return;
	const res = cand.result;

	const sV = viewport.worldToScreen(cand.vertexPos);
	const sT1 = viewport.worldToScreen(res.t1);
	const sT2 = viewport.worldToScreen(res.t2);

	createSvgLine(sT1, sV, CHAMFER_CUT_LINE_ATTRS, targetGroup);
	createSvgLine(sT2, sV, CHAMFER_CUT_LINE_ATTRS, targetGroup);
	createSvgCircle(sV, 3.5, GIZMO_POINT_ATTRS, targetGroup);
	createSvgLine(sT1, sT2, CHAMFER_HIGHLIGHT_ATTRS, targetGroup);
	createSvgCircle(sT1, 3, GIZMO_POINT_ATTRS, targetGroup);
	createSvgCircle(sT2, 3, GIZMO_POINT_ATTRS, targetGroup);

	const screenScale = new Vec2(viewport.zoom, -viewport.zoom);
	const uSDir1 = cand.dir1.clone().multiply(screenScale).normalize();
	const uSDir2 = cand.dir2.clone().multiply(screenScale).normalize();

	const pushDistArrow = (
		type: 'dist1' | 'dist2',
		tip: Vec2,
		uSDir: Vec2,
		worldPos: Vec2,
		dir: Vec2,
		val: number,
		guideFrom?: Vec2
	) => {
		const { center } = renderGizmoArrow({
			tip,
			dir: uSDir,
			guide: guideFrom ? { from: guideFrom, to: 'base', minDistance: 4 } : undefined,
			targetGroup,
		});
		gizmoHandles.push({
			type,
			screenX: center.x,
			screenY: center.y,
			worldPos,
			dir,
			currentValue: val,
		});
	};

	if (state.mode === 'equal_distance') {
		const sMid = new Vec2().midpoint(sT1, sT2);
		const uSBis = unitDirBetween(sV, sMid);
		const bisectorWorld = new Vec2().addVectors(cand.dir1, cand.dir2).normalizeOrUnitX();
		pushDistArrow(
			'dist1',
			Vec2.from(sMid).addScaledVector(uSBis, -2),
			uSBis,
			res.midPoint,
			bisectorWorld,
			res.dist1,
			sV
		);
	} else if (state.mode === 'two_distance') {
		pushDistArrow('dist1', sT1.clone().addScaledVector(uSDir1, -3.5), uSDir1, res.t1, cand.dir1, res.dist1);
		pushDistArrow('dist2', sT2.clone().addScaledVector(uSDir2, -3.5), uSDir2, res.t2, cand.dir2, res.dist2);
	} else if (state.mode === 'distance_angle') {
		const [distType, sRef, uSDirRef, tRef, dirRef, distVal, sOther] = !state.flip
			? (['dist1', sT1, uSDir1, res.t1, cand.dir1, res.dist1, sT2] as const)
			: (['dist2', sT2, uSDir2, res.t2, cand.dir2, res.dist2, sT1] as const);

		pushDistArrow(distType, sRef.clone().addScaledVector(uSDirRef, -3.5), uSDirRef, tRef, dirRef, distVal);

		const uSChamfer = unitDirBetween(sRef, sOther);

		const arcR = 100;
		const circle = sRef.clone().addScaledVector(uSChamfer, arcR);
		createSvgGizmoDashedLine(sRef, circle, targetGroup);

		const vV = new Vec2().subVectors(sV, sRef);
		if (vV.length() > 1e-4) {
			const angV = vV.signedAngle();
			let diff = uSChamfer.signedAngle() - angV;
			while (diff > Math.PI) diff -= 2 * Math.PI;
			while (diff < -Math.PI) diff += 2 * Math.PI;

			const start = Vec2.fromPolar(arcR, angV).add(sRef);
			createSvgGizmoDashedLine(sRef, start, targetGroup);

			if (Math.abs(diff) > 1e-3) {
				const sweepFlag = diff > 0 ? 1 : 0;
				createSvgPath(
					`M ${start.x} ${start.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${circle.x} ${circle.y}`,
					GIZMO_GUIDE_ATTRS,
					targetGroup
				);
			}
		}

		createSvgGizmoCircle(circle, targetGroup);
		gizmoHandles.push({
			type: 'angle',
			screenX: circle.x,
			screenY: circle.y,
			worldPos: tRef,
			currentValue: res.angleDeg,
		});
	}
}

export function renderOffsetPreviews(
	sketch: SketchDocument,
	viewport: Viewport,
	targetGroup: SVGGElement,
	state: OffsetPreviewState,
	gizmoHandles: OffsetGizmoHandle[]
): void {
	const { chain, geomResult, direction, dist1, dist2, flip } = state;
	if (!chain || !geomResult) return;

	for (const it of chain.items) {
		sketch.getPrimitive(it.id, it.type)?.renderTransformed({
			sketch,
			viewport,
			transformPoint: (x, y) => ({ x, y }),
			targetGroup,
			strokeAttrs: OFFSET_CHAIN_ATTRS,
		});
	}

	for (const side of geomResult.sides) {
		for (const prim of side.primitives) {
			if (prim.type === 'line' && prim.p1 && prim.p2) {
				createSvgLine(
					viewport.worldToScreen(prim.p1),
					viewport.worldToScreen(prim.p2),
					OFFSET_PREVIEW_ATTRS,
					targetGroup
				);
			} else if (prim.type === 'circle' && prim.circleCenter && prim.circleRadius) {
				createSvgCircle(
					viewport.worldToScreen(prim.circleCenter),
					prim.circleRadius * viewport.zoom,
					OFFSET_PREVIEW_ATTRS,
					targetGroup
				);
			} else if (prim.type === 'arc' && prim.center && prim.start && prim.end && prim.radius) {
				const d = getArcSvgPath(
					viewport.worldToScreen(prim.center),
					viewport.worldToScreen(prim.start),
					viewport.worldToScreen(prim.end),
					prim.radius * viewport.zoom,
					!!prim.clockwise
				);
				createSvgPath(d, OFFSET_PREVIEW_ATTRS, targetGroup);
			} else if (prim.type === 'spline' && prim.fitPoints && prim.fitPoints.length >= 2) {
				const beziers = fitPointsToBezier(prim.fitPoints, prim.handles);
				const d = getSplineSvgPath(beziers, p => viewport.worldToScreen(p), !!prim.isSplineClosed);
				createSvgPath(d, OFFSET_PREVIEW_ATTRS, targetGroup);
			}
		}
	}

	const anchor = geomResult.gizmoAnchor;
	const norm = geomResult.gizmoNormal;
	const sAnchor = viewport.worldToScreen(anchor);

	const renderGizmoArrowForSide = (type: 'dist1' | 'dist2', offsetVal: number, sign: number) => {
		const targetWorld = anchor.clone().addScaledVector(norm, sign * offsetVal);
		const sTarget = viewport.worldToScreen(targetWorld);
		const uDir = unitDirBetween(sAnchor, sTarget);
		const { center } = renderGizmoArrow({
			tip: sTarget,
			dir: uDir,
			guide: { from: sAnchor, to: 'tip' },
			targetGroup,
		});

		gizmoHandles.push({
			type,
			screenX: center.x,
			screenY: center.y,
			worldPos: targetWorld,
			normal: norm.clone().multiplyScalar(sign),
			currentValue: offsetVal,
		});
	};

	if (direction === 'one_side') {
		renderGizmoArrowForSide('dist1', dist1, flip ? -1 : 1);
	} else if (direction === 'two_sides') {
		renderGizmoArrowForSide('dist1', dist1, !flip ? 1 : -1);
		renderGizmoArrowForSide('dist2', dist2, !flip ? -1 : 1);
	} else if (direction === 'symmetric') {
		renderGizmoArrowForSide('dist1', dist1, 1);
		renderGizmoArrowForSide('dist1', dist1, -1);
	}
}

import { ORIGIN, Vec2 } from '../math/vector';
import type { SketchDocument } from '../model/sketch';
import { COLORS, HIT_AREA_STROKE_ATTRS, MIRROR_LINE_ATTRS, STROKE_WIDTH } from './styles';
import { createSvgCircle, createSvgElement, createSvgLine, createSvgPath, createSvgText } from './svg';
import { GRID_SUBDIVISIONS } from './gridSpacing';
import type { Viewport } from './viewport';

export interface GridRenderState {
	showGrid: boolean;
	mirrorLineId?: string | null;
	patternCenterPointId?: string | null;
}

export function getGridRenderKey(sketch: SketchDocument, viewport: Viewport, state: GridRenderState): string {
	const isXMirror = state.mirrorLineId === 'axis_x';
	const isYMirror = state.mirrorLineId === 'axis_y';
	const isXSelected = !isXMirror && sketch.selection.lineIds.has('axis_x');
	const isYSelected = !isYMirror && sketch.selection.lineIds.has('axis_y');
	const isOriginSelected = sketch.selection.pointIds.has('origin');
	const isPatternCenter = state.patternCenterPointId === 'origin';
	return [
		state.showGrid ? 1 : 0,
		viewport.zoom,
		viewport.panX,
		viewport.panY,
		viewport.width,
		viewport.height,
		isXMirror ? 1 : 0,
		isYMirror ? 1 : 0,
		isXSelected ? 1 : 0,
		isYSelected ? 1 : 0,
		isOriginSelected ? 1 : 0,
		isPatternCenter ? 1 : 0,
	].join('|');
}

function renderOriginAxis(
	id: 'axis_x' | 'axis_y',
	start: Vec2,
	end: Vec2,
	baseColor: string,
	isSelected: boolean,
	isMirror: boolean,
	parent: SVGGElement
): void {
	const axisG = createSvgElement(
		'g',
		{
			'data-id': id,
			'data-type': 'line',
			class: `sketch-entity sketch-line sketch-axis-line${isSelected ? ' is-selected selected' : ''}`,
		},
		parent
	);
	createSvgLine(start, end, HIT_AREA_STROKE_ATTRS, axisG);
	createSvgLine(
		start,
		end,
		isMirror
			? MIRROR_LINE_ATTRS
			: {
					stroke: isSelected ? COLORS.selected : baseColor,
					'stroke-width': isSelected ? STROKE_WIDTH.selected : STROKE_WIDTH.dimension,
				},
		axisG
	);
}

export function renderGridAndAxes(
	gridGroup: SVGGElement,
	originAxisGroup: SVGGElement,
	sketch: SketchDocument,
	viewport: Viewport,
	state: GridRenderState
): void {
	gridGroup.innerHTML = '';
	originAxisGroup.innerHTML = '';
	if (!state.showGrid) return;

	const origin = viewport.worldToScreen(ORIGIN);

	const { step, subStep } = viewport.getGridStep();
	const minWorld = viewport.screenToWorld(new Vec2(0, viewport.height));
	const maxWorld = viewport.screenToWorld(new Vec2(viewport.width, 0));

	const start = new Vec2(Math.floor(minWorld.x / subStep) * subStep, Math.floor(minWorld.y / subStep) * subStep);
	const end = new Vec2(Math.ceil(maxWorld.x / subStep) * subStep, Math.ceil(maxWorld.y / subStep) * subStep);

	const showSubGrid = subStep * viewport.zoom >= 6;
	let dMinor = '';
	let dMajor = '';

	const axisY = Math.max(8, Math.min(viewport.height - 40, origin.y));
	const axisX = Math.max(8, Math.min(viewport.width - 30, origin.x));
	const labelsG = createSvgElement('g', { class: 'grid-labels', 'pointer-events': 'none' }, originAxisGroup);

	for (const axis of ['x', 'y'] as const) {
		const minVal = axis === 'x' ? start.x : start.y;
		const maxVal = axis === 'x' ? end.x : end.y;
		for (let v = minVal; v <= maxVal; v += subStep) {
			const s = viewport.worldToScreen(axis === 'x' ? new Vec2(v, 0) : new Vec2(0, v));
			const isMajor = Math.abs(Math.round(v / subStep) % GRID_SUBDIVISIONS) === 0;
			const seg =
				axis === 'x'
					? `M ${s.x.toFixed(1)} 0 L ${s.x.toFixed(1)} ${viewport.height} `
					: `M 0 ${s.y.toFixed(1)} L ${viewport.width} ${s.y.toFixed(1)} `;
			if (isMajor) {
				dMajor += seg;
				const cleanVal = parseFloat((Math.round(v / step) * step).toFixed(6));
				if (Math.abs(cleanVal) > 1e-4) {
					if (axis === 'x') {
						const anchor = new Vec2(s.x, axisY + 4);
						createSvgText(
							anchor,
							cleanVal.toString(),
							{
								class: 'grid-label',
								transform: `rotate(-90 ${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)})`,
								'text-anchor': 'end',
							},
							labelsG
						);
					} else {
						createSvgText(
							new Vec2(axisX + 8, s.y),
							cleanVal.toString(),
							{
								class: 'grid-label',
								'text-anchor': 'start',
							},
							labelsG
						);
					}
				}
			} else if (showSubGrid) {
				dMinor += seg;
			}
		}
	}

	if (showSubGrid && dMinor) {
		createSvgPath(
			dMinor,
			{ stroke: COLORS.gridMinor, 'stroke-width': STROKE_WIDTH.minorGrid, fill: 'none' },
			gridGroup
		);
	}
	if (dMajor) {
		createSvgPath(
			dMajor,
			{ stroke: COLORS.gridMajor, 'stroke-width': STROKE_WIDTH.majorGrid, fill: 'none' },
			gridGroup
		);
	}

	const isXMirror = state.mirrorLineId === 'axis_x';
	const isYMirror = state.mirrorLineId === 'axis_y';
	const isXSelected = !isXMirror && sketch.selection.lineIds.has('axis_x');
	const isYSelected = !isYMirror && sketch.selection.lineIds.has('axis_y');
	const isOriginSelected = sketch.selection.pointIds.has('origin');

	renderOriginAxis(
		'axis_x',
		new Vec2(0, origin.y),
		new Vec2(viewport.width, origin.y),
		COLORS.xAxis,
		isXSelected,
		isXMirror,
		originAxisGroup
	);
	renderOriginAxis(
		'axis_y',
		new Vec2(origin.x, 0),
		new Vec2(origin.x, viewport.height),
		COLORS.yAxis,
		isYSelected,
		isYMirror,
		originAxisGroup
	);

	// Origin marker target (CAD surveyor style)
	const isPatternCenter = state.patternCenterPointId === 'origin';
	const originMarkerG = createSvgElement(
		'g',
		{
			'data-id': 'origin',
			'data-type': 'point',
			class: `sketch-entity sketch-point sketch-origin-marker${isOriginSelected ? ' is-selected selected' : ''}`,
		},
		originAxisGroup
	);

	const r = 8;
	const quarterFill = isOriginSelected
		? COLORS.selected
		: isPatternCenter
			? COLORS.patternCenter
			: COLORS.originQuarter;
	for (const sign of [1, -1] as const) {
		createSvgPath(
			`M ${origin.x} ${origin.y} L ${origin.x + sign * r} ${origin.y} A ${r} ${r} 0 0 0 ${origin.x} ${origin.y - sign * r} Z`,
			{ fill: quarterFill },
			originMarkerG
		);
	}

	createSvgCircle(
		origin,
		r,
		{
			fill: 'none',
			stroke: isOriginSelected ? COLORS.selected : isPatternCenter ? COLORS.patternCenter : COLORS.construction,
			'stroke-width': isOriginSelected || isPatternCenter ? STROKE_WIDTH.selected : STROKE_WIDTH.dimension,
		},
		originMarkerG
	);

	// Transparent hit target circle so clicking/hovering near (0,0) is easy
	createSvgCircle(origin, 14, { fill: COLORS.hitTransparent, stroke: 'none' }, originMarkerG);
}

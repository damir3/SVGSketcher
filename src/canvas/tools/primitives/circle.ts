import {
	circlePreview,
	circleChord,
	lineIntersection,
	circleTwoTangent,
	circleThreeTangent,
} from '../../../math/construction';
import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { getCircumcircle, Vec2 } from '../../../math/vector';
import { createSvgCircle, createSvgLine } from '../../svg';
import { applyDrawingLineStyle, AUX_RAY_ATTRS, COLORS, getPreviewStrokeAttrs } from '../../styles';
import { getRoundCurveLineType } from '../../../model/lineTypes';
import { ToolPopup } from '../../../ui/tool-popup';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { findHoverTarget } from '../hoverTarget';
import { dispatchToolModeChange } from '../modeChangeEvent';

export type CircleMode = 'center_diameter' | 'two_point' | 'three_point' | 'two_tangent' | 'three_tangent';

type TangentLine = { p: Vec2; n: Vec2 };
type CircleGeometry = { center: Vec2; radius: number };

export class CircleTool extends BaseTool {
	readonly id = 'circle' as const;

	readonly popup = new ToolPopup<'radius'>({
		className: 'circle-popup',
		defaultOffset: new Vec2(150, 40),
		fields: [
			{
				id: 'radius',
				label: 'Radius',
				type: 'dimension',
				unit: 'mm',
				defaultValue: 10,
				min: 0.1,
				step: 0.1,
				lockable: true,
			},
		],
		onKeyDown: e => this.sidebarPanel.handleKeyDown(e),
	});

	private drawingStep = 0;
	private points: Vec2[] = [];
	private centerId: string | null = null;
	private center: Vec2 | null = null;
	private lineIds: string[] = [];
	private _mode: CircleMode = 'center_diameter';
	private onStateChange?: () => void;
	private lastCursorWorld: Vec2 = new Vec2(0, 0);

	readonly sidebarPanel = new VariationToolPanel<CircleMode>({
		title: 'Circle Tool',
		description: 'Select circle creation method:',
		modes: [
			{
				id: 'center_diameter',
				label: 'Center',
				title: 'Center Diameter Circle (Alt+1)',
				iconName: 'circle_center',
			},
			{
				id: 'two_point',
				label: '2-Point',
				title: '2-Point Circle (Alt+2)',
				iconName: 'circle_2point',
			},
			{
				id: 'three_point',
				label: '3-Point',
				title: '3-Point Circle (Alt+3)',
				iconName: 'circle_3point',
			},
			{
				id: 'two_tangent',
				label: '2-Tangent',
				title: '2-Tangent Circle (Alt+4)',
				iconName: 'circle_2tangent',
			},
			{
				id: 'three_tangent',
				label: '3-Tangent',
				title: '3-Tangent Circle (Alt+5)',
				iconName: 'circle_3tangent',
			},
		],
		getCurrentMode: () => this._mode,
		onSelectMode: mode => this.setMode(mode),
		onCancel: () => this.ctx?.setTool('select'),
		getHint: () => this.hint(),
		bindStateChange: callback => {
			this.onStateChange = callback;
		},
	});

	get mode(): CircleMode {
		return this._mode;
	}

	get step(): number {
		return this.drawingStep;
	}

	setMode(mode: CircleMode): void {
		if (mode === this._mode) return;

		this.cancel();
		this._mode = mode;
		dispatchToolModeChange('circle', mode);
		this.onStateChange?.();
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab' && this.drawingStep > 0 && this.popup.isOpen()) {
			e.preventDefault();
			this.popup.cycleFocus(e.shiftKey);
			return true;
		}
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.popup.setSketch(ctx.sketch);
		this.popup.onCommit = () => this.commitPopupValue();
		this.popup.onCancel = () => this.ctx.setTool('select');
		this.popup.onChange = () => this.ctx.requestRender();
	}

	override deactivate(): void {
		this.popup.hide();
		this.cancel();
		super.deactivate();
	}

	override shouldSnap(): boolean {
		return this._mode === 'center_diameter'
			? this.drawingStep === 0
			: this._mode === 'two_point' || this._mode === 'three_point';
	}

	override isHighlightEnabled(): boolean {
		return (
			(this._mode === 'two_tangent' || this._mode === 'three_tangent') &&
			this.drawingStep < (this._mode === 'two_tangent' ? 2 : 3)
		);
	}

	override getHoverTargetOptions() {
		return { allowAxes: false, allowOrigin: false };
	}

	private hint(): string {
		const prompts: Record<CircleMode, string[]> = {
			center_diameter: ['1. Click center point', '2. Set radius'],
			two_point: ['1. Click first diameter endpoint', '2. Click second diameter endpoint'],
			three_point: ['1. Click first point', '2. Click second point', '3. Click third point'],
			two_tangent: ['1. Select first tangent line', '2. Select second tangent line', '3. Set radius'],
			three_tangent: ['1. Select first tangent line', '2. Select second tangent line', '3. Select third tangent line'],
		};

		return prompts[this._mode][Math.min(this.drawingStep, prompts[this._mode].length - 1)];
	}

	private notify(): void {
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	private finish(center: Vec2, radius: number, existingCenterId?: string, dimensionMode?: 'radius' | 'diameter'): void {
		const sketch = this.ctx.sketch;
		const point = existingCenterId ? sketch.points.get(existingCenterId)! : sketch.addPoint(center);
		const circle = sketch.addCircle(point.id, Math.max(radius, 0.1), getRoundCurveLineType(this.ctx.lineType));

		if (this._mode === 'three_tangent' || this._mode === 'two_tangent') {
			for (const lineId of this.lineIds) {
				sketch.addTangentConstraint(lineId, circle.id);
			}
		}

		if (dimensionMode) {
			const constraint = sketch.addRadiusConstraint(circle.id, radius, dimensionMode);
			const expression = this.popup.getExpression('radius');
			if (constraint) {
				if (expression) constraint.expression = expression;
				constraint.placeLabelInsideNear(
					this.ctx.viewport.worldToScreen(this.lastCursorWorld),
					sketch,
					this.ctx.viewport
				);
			}
		}

		sketch.commitTransaction();
		this.resetToolState();
		this.popup.resetField('radius', dimensionMode === 'diameter' ? 20 : 10);
		this.notify();
	}

	private start(): void {
		if (this.drawingStep === 0) this.ctx.sketch.beginTransaction();
	}

	private commitPopupValue(): void {
		if (!this.popup.isLocked('radius')) return;

		const value = this.popup.getNumericValue('radius', 10);

		if (this._mode === 'center_diameter' && this.center) {
			this.finish(this.center, value / 2, this.centerId!, 'diameter');
			return;
		}

		if (this._mode === 'three_point' && this.points.length === 2) {
			const circle = this.getThreePointCircleForDiameter(value, this.lastCursorWorld);
			if (!circle) {
				this.ctx.showToast('Diameter must be at least the distance between the first two points');
				return;
			}

			this.finish(circle.center, value / 2, undefined, 'diameter');
			return;
		}

		if (this._mode === 'two_tangent' && this.lineIds.length === 2) {
			const center = this.twoLineCenter(value, this.lastCursorWorld);
			if (!center) {
				this.ctx.showToast('The selected lines are parallel');
				this.cancel();
				return;
			}

			this.finish(center, value, undefined, 'radius');
		}

		// 2-Point uses its final click to position the circle, so Enter locks the value and keeps the tool waiting.
	}

	override onMouseDown(e: ToolMouseEvent): void {
		this.lastCursorWorld = e.snap?.worldPos ?? e.world;
		const sketch = this.ctx.sketch;

		if (this._mode === 'center_diameter') {
			if (!this.drawingStep) {
				this.start();
				const snap = e.snap;

				if (snap?.type === 'point' && snap.id && sketch.points.has(snap.id)) {
					this.centerId = snap.id;
					this.center = snap.worldPos;
				} else {
					this.center = snap ? snap.worldPos : e.world;
					const point = sketch.addPoint(this.center);
					this.centerId = point.id;
					this.ctx.applySnapConstraintIfNeeded?.(point.id, snap);
				}

				this.drawingStep = 1;
				this.openRadiusPopup(e.screen);
				this.notify();
			} else {
				const locked = this.popup.isLocked('radius');
				const radius = locked
					? this.popup.getNumericValue('radius', 20) / 2
					: Math.max(5, this.center!.distanceTo(e.world));
				this.finish(this.center!, radius, this.centerId!, locked ? 'diameter' : undefined);
			}

			return;
		}

		if (this._mode === 'two_point' || this._mode === 'three_point') {
			this.start();
			this.points.push(e.snap?.worldPos ?? e.world);
			this.drawingStep++;

			if (
				(this._mode === 'two_point' && this.drawingStep === 1) ||
				(this._mode === 'three_point' && this.drawingStep === 2)
			) {
				this.openRadiusPopup(e.screen);
			}

			if (this._mode === 'two_point' && this.points.length === 2) {
				const [a, cursor] = this.points;
				const locked = this.popup.isLocked('radius');
				const diameter = locked ? this.popup.getNumericValue('radius', 20) : a.distanceTo(cursor);
				const directionLength = a.distanceTo(cursor);
				const b = locked && directionLength > 1e-9 ? a.clone().lerp(cursor, diameter / directionLength) : cursor;

				this.finish(new Vec2().midpoint(a, b), diameter / 2, undefined, locked ? 'diameter' : undefined);
				return;
			}

			if (this._mode === 'three_point' && this.points.length === 3) {
				const circle = getCircumcircle(this.points[0], this.points[1], this.points[2]);
				if (!circle) {
					this.ctx.showToast('The three points must not be collinear');
					this.cancel();
					return;
				}

				const locked = this.popup.isLocked('radius');
				const finalCircle = locked
					? this.getThreePointCircleForDiameter(this.popup.getNumericValue('radius', 20), this.points[2])
					: circle;
				if (!finalCircle) {
					this.ctx.showToast('Diameter must be at least the distance between the first two points');
					return;
				}

				this.finish(finalCircle.center, finalCircle.radius, undefined, locked ? 'diameter' : undefined);
				return;
			}

			this.notify();
			return;
		}

		if (this._mode === 'two_tangent' && this.drawingStep === 2) {
			const locked = this.popup.isLocked('radius');
			const circle = this.resolveTwoTangentCircle(e.world);

			if (!circle) {
				this.ctx.showToast('The selected lines are parallel');
				this.cancel();
				return;
			}

			this.finish(circle.center, circle.radius, undefined, locked ? 'radius' : undefined);
			return;
		}

		const target =
			this.ctx.highlightManager?.getHoveredTarget() ??
			findHoverTarget(this.ctx, e.screen, e.raw?.target as SVGElement, this.getHoverTargetOptions());
		if (!target || target.type !== 'line' || !sketch.lines.has(target.id) || this.lineIds.includes(target.id)) {
			return;
		}

		this.start();
		this.lineIds.push(target.id);
		this.markLine(target.id, true);
		this.drawingStep++;

		if (this._mode === 'two_tangent' && this.lineIds.length === 2) {
			this.openRadiusPopup(e.screen, 'Radius', 10);
		}

		if (this._mode === 'three_tangent' && this.lineIds.length === 3) {
			this.finishThreeTangent();
		} else {
			this.notify();
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		this.lastCursorWorld = e.snap?.worldPos ?? e.world;

		if (this._mode === 'center_diameter' && this.drawingStep === 1 && !this.popup.isLocked('radius')) {
			this.popup.updateValues({
				radius: 2 * Math.max(5, this.center!.distanceTo(e.effectiveWorld)),
			});
		}

		if (this._mode === 'two_point' && this.drawingStep > 0 && !this.popup.isLocked('radius')) {
			this.popup.updateValues({
				radius: Math.max(5, this.points[0].distanceTo(e.effectiveWorld)),
			});
		}

		if (this._mode === 'three_point' && this.drawingStep === 2 && !this.popup.isLocked('radius')) {
			const circle = this.getThreePointCircle(e.effectiveWorld);
			if (circle) this.popup.updateValues({ radius: 2 * circle.radius });
		}

		if (this._mode === 'two_tangent' && this.drawingStep === 2 && !this.popup.isLocked('radius')) {
			const circle = this.getTwoTangentCircle(e.world);
			if (circle) this.popup.updateValues({ radius: circle.radius });
		}

		if (this.popup.isOpen()) this.popup.updatePosition(e.screen);
	}

	private getLine(lineId: string): TangentLine | null {
		const line = this.ctx.sketch.lines.get(lineId);
		if (!line) return null;

		const pointA = this.ctx.sketch.points.get(line.p1Id);
		const pointB = this.ctx.sketch.points.get(line.p2Id);
		if (!pointA || !pointB) return null;

		const dir = new Vec2().subVectors(pointB, pointA);
		const length = dir.length();
		if (length < 1e-9) return null;

		return {
			p: pointA.clone(),
			n: dir.clone().perpendicular().divideScalar(length),
		};
	}

	private markLine(id: string, active: boolean): void {
		for (const element of Array.from(this.ctx.svg.querySelectorAll(`[data-id="${id}"]`))) {
			element.classList.toggle('circle-tangent-selected', active);
		}
	}

	private finishThreeTangent(): void {
		const lines = this.lineIds.map(id => this.getLine(id));
		if (lines.some(line => !line)) {
			this.cancel();
			return;
		}

		const circle = this.solveThreeLines(lines as TangentLine[]);
		if (!circle) {
			this.ctx.showToast('The selected lines do not define a circle');
			this.cancel();
			return;
		}

		this.finish(circle.center, circle.radius);
	}

	private solveThreeLines(lines: TangentLine[]): CircleGeometry | null {
		return circleThreeTangent(lines);
	}

	private getThreePointCircle(cursor: Vec2): CircleGeometry | null {
		return circlePreview(this.points[0], this.points[1], cursor);
	}

	private getThreePointCircleForDiameter(diameter: number, cursor: Vec2): CircleGeometry | null {
		return circleChord(this.points[0], this.points[1], cursor, diameter);
	}

	override renderPreview(ctx: ToolRenderContext): void {
		for (const id of this.lineIds) {
			const line = this.ctx.sketch.lines.get(id);
			const pointA = line && this.ctx.sketch.points.get(line.p1Id);
			const pointB = line && this.ctx.sketch.points.get(line.p2Id);
			if (!pointA || !pointB) continue;

			const screenA = ctx.viewport.worldToScreen(pointA);
			const screenB = ctx.viewport.worldToScreen(pointB);
			createSvgLine(
				screenA,
				screenB,
				{
					stroke: COLORS.selectedHover,
					'stroke-width': 3,
					'stroke-dasharray': '6 4',
					opacity: 0.95,
					'pointer-events': 'none',
				},
				ctx.targetGroup
			);
		}

		if (this._mode === 'center_diameter' && this.drawingStep === 1 && this.center) {
			this.renderCenterDiameterPreview(ctx);
			return;
		}

		if (this._mode === 'two_tangent' && this.drawingStep === 2) {
			this.renderTwoTangentPreview(ctx);
			return;
		}

		const cursor = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
		if (this._mode === 'two_point' && this.drawingStep === 1 && this.points[0]) {
			this.renderTwoPointPreview(ctx, cursor);
			return;
		}

		if (this._mode === 'three_point' && this.drawingStep === 1 && this.points[0]) {
			this.drawPointMarker(ctx, this.points[0]);
			return;
		}

		if (this._mode === 'three_point' && this.drawingStep === 2 && this.points.length === 2) {
			this.renderThreePointPreview(ctx, cursor);
			return;
		}

		if (this._mode === 'three_tangent' && this.drawingStep === 2) {
			this.renderThreeTangentPreview(ctx);
		}
	}

	private renderCenterDiameterPreview(ctx: ToolRenderContext): void {
		const cursor = this.shouldSnap() && ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
		const radius = this.popup.isLocked('radius')
			? this.popup.getNumericValue('radius', 20) / 2
			: this.center!.distanceTo(cursor);
		const dir = new Vec2().subVectors(cursor, this.center!);
		const length = dir.length() || 1;
		const edge = ctx.viewport.worldToScreen(this.center!.clone().addScaledVector(dir, radius / length));
		const centerScreen = ctx.viewport.worldToScreen(this.center!);
		const radiusPixels = radius * ctx.viewport.zoom;

		createSvgCircle(
			centerScreen,
			radiusPixels,
			applyDrawingLineStyle(getPreviewStrokeAttrs(ctx.isConstruction), getRoundCurveLineType(this.ctx.lineType)),
			ctx.targetGroup
		);
		createSvgLine(centerScreen.clone().multiplyScalar(2).sub(edge), edge, AUX_RAY_ATTRS, ctx.targetGroup);
	}

	private renderTwoTangentPreview(ctx: ToolRenderContext): void {
		const circle = this.resolveTwoTangentCircle(ctx.cursorWorld);
		if (!circle) return;

		this.drawPreviewCircle(ctx, circle.center, circle.radius);
		const intersection = this.lineIntersection();
		if (!intersection) return;

		const b = new Vec2().subVectors(circle.center, intersection);
		const length = b.length() || 1;
		const dir = b
			.clone()
			.perpendicular()
			.multiplyScalar((circle.radius * 1) / length);
		const pointA = ctx.viewport.worldToScreen(new Vec2().subVectors(circle.center, dir));
		const pointB = ctx.viewport.worldToScreen(new Vec2().addVectors(circle.center, dir));
		createSvgLine(pointA, pointB, AUX_RAY_ATTRS, ctx.targetGroup);
	}

	private renderTwoPointPreview(ctx: ToolRenderContext, cursor: Vec2): void {
		const firstPoint = this.points[0];
		const dir = new Vec2().subVectors(cursor, firstPoint);
		const length = dir.length() || 1;
		const diameter = this.popup.isLocked('radius') ? this.popup.getNumericValue('radius', 20) : dir.length();
		const secondPoint = this.popup.isLocked('radius')
			? firstPoint.clone().addScaledVector(dir, diameter / length)
			: cursor;
		const center = new Vec2().midpoint(firstPoint, secondPoint);
		const screenA = ctx.viewport.worldToScreen(firstPoint);
		const screenB = ctx.viewport.worldToScreen(secondPoint);

		this.drawPreviewCircle(ctx, center, diameter / 2);
		createSvgLine(screenA, screenB, AUX_RAY_ATTRS, ctx.targetGroup);
		this.drawPointMarker(ctx, firstPoint);
	}

	private renderThreePointPreview(ctx: ToolRenderContext, cursor: Vec2): void {
		const circle = this.popup.isLocked('radius')
			? this.getThreePointCircleForDiameter(this.popup.getNumericValue('radius', 20), cursor)
			: this.getThreePointCircle(cursor);

		if (circle) {
			this.drawPreviewCircle(ctx, circle.center, circle.radius);

			const firstPoint = ctx.viewport.worldToScreen(this.points[0]);
			const center = ctx.viewport.worldToScreen(circle.center);
			const dir = new Vec2().subVectors(firstPoint, center);
			const length = dir.length() || 1;
			const radiusPixels = circle.radius * ctx.viewport.zoom;

			createSvgLine(
				center.clone().addScaledVector(dir, -radiusPixels / length),
				center.clone().addScaledVector(dir, radiusPixels / length),
				AUX_RAY_ATTRS,
				ctx.targetGroup
			);
		}

		this.drawPointMarker(ctx, this.points[0]);
		this.drawPointMarker(ctx, this.points[1]);
	}

	private renderThreeTangentPreview(ctx: ToolRenderContext): void {
		const hover = this.ctx.highlightManager?.getHoveredTarget();
		if (!hover || hover.type !== 'line' || this.lineIds.includes(hover.id)) return;

		const lines = [...this.lineIds, hover.id].map(id => this.getLine(id));
		if (!lines.every(Boolean)) return;

		const circle = this.solveThreeLines(lines as TangentLine[]);
		if (circle) this.drawPreviewCircle(ctx, circle.center, circle.radius);
	}

	private drawPointMarker(ctx: ToolRenderContext, point: Vec2): void {
		const screen = ctx.viewport.worldToScreen(point);
		createSvgCircle(
			screen,
			4,
			{
				fill: COLORS.selectedHover,
				stroke: COLORS.background,
				'stroke-width': 1.5,
				'pointer-events': 'none',
			},
			ctx.targetGroup
		);
	}

	private drawPreviewCircle(ctx: ToolRenderContext, center: Vec2, radius: number): void {
		if (!Number.isFinite(radius) || radius <= 0) return;

		const screenCenter = ctx.viewport.worldToScreen(center);
		const screenEdge = ctx.viewport.worldToScreen(new Vec2(center.x + radius, center.y));
		const radiusPixels = screenCenter.distanceTo(screenEdge);
		createSvgCircle(
			screenCenter,
			radiusPixels,
			applyDrawingLineStyle(getPreviewStrokeAttrs(ctx.isConstruction), getRoundCurveLineType(this.ctx.lineType)),
			ctx.targetGroup
		);
	}

	private openRadiusPopup(screen: Vec2, label = 'Diameter', defaultValue = 20): void {
		this.popup.setFieldLabel('radius', label);
		this.popup.resetField('radius', defaultValue);
		this.popup.show(screen);
	}

	private resolveTwoTangentCircle(cursor: Vec2): CircleGeometry | null {
		if (!this.popup.isLocked('radius')) return this.getTwoTangentCircle(cursor);
		const radius = this.popup.getNumericValue('radius', 10);
		const center = this.twoLineCenter(radius, cursor);
		return center ? { center, radius } : null;
	}

	private lineIntersection(offsetA = 0, offsetB = 0): Vec2 | null {
		const a = this.getLine(this.lineIds[0]),
			b = this.getLine(this.lineIds[1]);
		return a && b ? lineIntersection(a, b, offsetA, offsetB) : null;
	}

	private getTwoTangentCircle(cursor: Vec2): CircleGeometry | null {
		const a = this.getLine(this.lineIds[0]),
			b = this.getLine(this.lineIds[1]);
		return a && b ? circleTwoTangent(a, b, cursor) : null;
	}

	private twoLineCenter(radius: number, cursor: Vec2): Vec2 | null {
		const a = this.getLine(this.lineIds[0]),
			b = this.getLine(this.lineIds[1]);
		return a && b ? (circleTwoTangent(a, b, cursor, radius)?.center ?? null) : null;
	}

	override cancel(): void {
		if (this.drawingStep > 0) this.ctx.sketch.rollbackTransaction();
		this.resetToolState();
		this.ctx?.renderer.clearPreviews();
		this.ctx?.requestRender();
	}

	private resetToolState(): void {
		for (const id of this.lineIds) this.markLine(id, false);
		this.popup.hide();
		this.drawingStep = 0;
		this.points = [];
		this.centerId = null;
		this.center = null;
		this.lineIds = [];
	}
}

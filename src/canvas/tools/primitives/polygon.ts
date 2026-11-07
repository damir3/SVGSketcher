import { BaseTool } from '../base';
import { dispatchToolModeChange } from '../modeChangeEvent';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { addScaled, angleFromTo, cross, dist, mid, sub, vec, type Vec2 } from '../../../math/vector';
import { ToolPopup } from '../../../ui/tool-popup';
import { VariationToolPanel } from '../../../ui/panels/tools/variationToolPanel';
import { renderPolygonPreviewVisual } from '../../previewHelpers';
import { createSvgLine } from '../../svg';
import { getPreviewStrokeAttrs } from '../../styles';

export type PolygonMode = 'circumscribed' | 'inscribed' | 'edge';

const MIN_POINT_DISTANCE = 0.001;

export class PolygonTool extends BaseTool {
	readonly id = 'polygon' as const;
	declare readonly sidebarPanel: VariationToolPanel<PolygonMode>;
	readonly popup: ToolPopup<'sides' | 'radius' | 'size'>;

	private _mode: PolygonMode = 'circumscribed';
	private sides = 6;
	private size = 0;
	private sizeLocked = false;
	private currentAngle = 0;
	private startPointId: string | null = null;
	private edgeEnd: ToolMouseEvent | null = null;
	private edgeCursor: ToolMouseEvent | null = null;
	private onStateChange?: () => void;

	constructor() {
		super();
		this.sidebarPanel = new VariationToolPanel<PolygonMode>({
			title: 'Polygon Tool',
			description: 'Select polygon creation method:',
			dataAttribute: 'data-polygon-mode',
			modes: [
				{
					id: 'circumscribed',
					label: 'Circumscribed',
					title: 'Circumscribed Polygon (Alt+1)',
					iconName: 'polygon',
				},
				{
					id: 'inscribed',
					label: 'Inscribed',
					title: 'Inscribed Polygon (Alt+2)',
					iconName: 'polygon_inscribed',
				},
				{
					id: 'edge',
					label: 'Edge',
					title: 'Edge Polygon (Alt+3)',
					iconName: 'polygon_edge',
				},
			],
			getCurrentMode: () => this.mode,
			onSelectMode: mode => this.setMode(mode),
			onCancel: () => this.ctx?.setTool('select'),
			getHint: () => this.getStepHint(),
			bindStateChange: cb => {
				this.onStateChange = cb;
			},
		});

		this.popup = new ToolPopup<'sides' | 'radius' | 'size'>({
			className: 'polygon-popup',
			defaultOffset: { x: 50, y: 0 },
			fields: [
				{
					id: 'radius',
					label: 'Radius',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 0,
				},
				{
					id: 'size',
					label: 'Size',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 0,
					visible: false,
				},
				{
					id: 'sides',
					label: 'Sides',
					type: 'integer',
					defaultValue: 6,
					min: 3,
					max: 100,
					step: 1,
				},
			],
			onKeyDown: e => this.sidebarPanel.handleKeyDown(e),
		});
		this.popup.onChange = id => {
			this.sides = this.popup.getNumericValue('sides', 6);
			if (id === this.sizeField) {
				this.size = Math.max(0, this.popup.getNumericValue(id));
				this.sizeLocked = true;
			}
			this.ctx.requestRender();
		};
		this.popup.onCommit = () => this.confirm();
		this.popup.onCancel = () => {
			this.cancel();
			this.ctx.setTool('select');
		};
	}

	get mode(): PolygonMode {
		return this._mode;
	}

	private get sizeField(): 'radius' | 'size' {
		return this.mode === 'edge' ? 'size' : 'radius';
	}

	private get startPoint(): Vec2 | undefined {
		return this.startPointId ? this.ctx.sketch.points.get(this.startPointId) : undefined;
	}

	setMode(mode: PolygonMode): void {
		if (this._mode === mode) return;
		this._mode = mode;
		this.cancel();
		dispatchToolModeChange('polygon', mode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	private getStepHint(): string {
		if (this.mode === 'edge') {
			if (!this.startPointId) return '1. Click to place the first edge endpoint';
			if (!this.edgeEnd) return '2. Click to place the second edge endpoint';
			return '3. Click on the side where the polygon should extend';
		}
		if (!this.startPointId) return '1. Click to place the center point';
		return this.mode === 'inscribed' ? '2. Click to place a vertex' : '2. Click to set the distance to a side';
	}

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.popup.setSketch(ctx.sketch);
		ctx.showToast(`Polygon: ${this.mode === 'edge' ? 'Click the first edge endpoint' : 'Click center point'}`);
	}

	override shouldSnap(): boolean {
		return this.edgeEnd === null;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		if (!this.startPointId) {
			sketch.beginTransaction();
			this.startPointId = this.placePoint(e);
			this.size = 0;
			this.sizeLocked = false;
			this.currentAngle = 0;
			this.popup.setFieldVisible('radius', this.mode !== 'edge');
			this.popup.setFieldVisible('size', this.mode === 'edge');
			this.popup.setValue('sides', this.sides);
			this.popup.setValue(this.sizeField, 0);
			this.popup.show(e.client);
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		const anchor = this.startPoint;
		if (!anchor) {
			this.cancel();
			return;
		}

		if (this.mode !== 'edge') {
			this.commitCenteredPolygon(e);
		} else if (!this.edgeEnd) {
			const end = this.getEdgeEnd(anchor, e.effectiveWorld);
			const length = dist(anchor, end);
			if (length < MIN_POINT_DISTANCE) return;
			this.edgeEnd = e;
			this.edgeCursor = null;
			if (!this.sizeLocked) this.updateSize(length);
			this.popup.updatePosition(e.client);
			this.onStateChange?.();
			this.ctx.requestRender();
		} else {
			this.commitEdgePolygon(e.world);
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const anchor = this.startPoint;
		if (!anchor) return;
		if (this.mode === 'edge') {
			this.edgeCursor = e;
		} else {
			this.currentAngle = angleFromTo(anchor, e.effectiveWorld);
		}
		if (!this.sizeLocked && !this.edgeEnd) {
			this.updateSize(dist(anchor, e.effectiveWorld));
		}
		this.popup.updatePosition(e.client);
	}

	private updateSize(size: number): void {
		this.size = size;
		this.popup.setValue(this.sizeField, size);
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const anchor = this.startPoint;
		if (!anchor) return;

		const { targetGroup, viewport, isConstruction } = ctx;
		if (this.mode === 'edge') {
			const end = this.getEdgeEnd(anchor, this.edgeEnd?.effectiveWorld ?? ctx.snap?.worldPos ?? ctx.cursorWorld);
			const side = this.edgeEnd ? this.getEdgeSide(anchor, end, ctx.cursorWorld) : 0;
			const geometry = side ? this.getEdgeGeometry(anchor, end, side < 0) : null;
			if (geometry) {
				renderPolygonPreviewVisual(
					targetGroup,
					viewport.worldToScreen(geometry.center),
					geometry.center,
					this.sides,
					geometry.radius,
					geometry.angle,
					isConstruction,
					viewport,
					{ radiusToVertex: true, showGuide: false }
				);
			} else {
				createSvgLine(
					viewport.worldToScreen(anchor),
					viewport.worldToScreen(end),
					getPreviewStrokeAttrs(isConstruction),
					targetGroup
				);
			}
			return;
		}

		if (this.size < MIN_POINT_DISTANCE) return;
		renderPolygonPreviewVisual(
			targetGroup,
			viewport.worldToScreen(anchor),
			anchor,
			this.sides,
			this.size,
			this.currentAngle,
			isConstruction,
			viewport,
			{ radiusToVertex: this.mode === 'inscribed' }
		);
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (!this.startPointId) return;
		if (e.key === 'Tab' && this.popup.isOpen()) {
			e.preventDefault();
			this.popup.cycleFocus(e.shiftKey);
			return true;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			this.confirm();
			return true;
		}
	}

	private confirm(): void {
		const created = this.mode === 'edge' ? this.commitEdgePolygon() : this.commitCenteredPolygon();
		if (created) this.ctx.setTool('select');
	}

	override cancel(): void {
		if (!this.startPointId) return;
		this.ctx.sketch.rollbackTransaction();
		this.resetDrawing();
		this.ctx.requestRender();
	}

	private resetDrawing(): void {
		this.startPointId = null;
		this.edgeEnd = null;
		this.edgeCursor = null;
		this.popup.hide();
		this.ctx.renderer.clearPreviews();
		this.onStateChange?.();
	}

	private placePoint(e: ToolMouseEvent): string {
		const { sketch } = this.ctx;
		const { snap } = e;
		if (snap?.type === 'point' && snap.id && sketch.points.has(snap.id)) return snap.id;
		const point = sketch.addPoint(e.effectiveWorld);
		this.ctx.applySnapConstraintIfNeeded?.(point.id, snap);
		return point.id;
	}

	private getEdgeEnd(start: Vec2, target: Vec2): Vec2 {
		if (!this.sizeLocked) return target;
		const angle = angleFromTo(start, target);
		return addScaled(start, vec(Math.cos(angle), Math.sin(angle)), this.size);
	}

	private getEdgeSide(start: Vec2, end: Vec2, toward: Vec2): number {
		const length = dist(start, end);
		if (length < MIN_POINT_DISTANCE) return 0;
		const signedDistance = cross(sub(end, start), sub(toward, start)) / length;
		return Math.abs(signedDistance) < MIN_POINT_DISTANCE ? 0 : Math.sign(signedDistance);
	}

	private getEdgeGeometry(start: Vec2, end: Vec2, reversed: boolean) {
		const edge = sub(end, start);
		const length = dist(start, end);
		const halfAngle = Math.PI / this.sides;
		const normal = vec(-edge.y / length, edge.x / length);
		const apothem = length / (2 * Math.tan(halfAngle));
		const center = addScaled(mid(start, end), normal, reversed ? -apothem : apothem);
		const angle = angleFromTo(center, reversed ? end : start);
		return { center, radius: length / (2 * Math.sin(halfAngle)), angle };
	}

	private commitEdgePolygon(direction?: Vec2): boolean {
		const startId = this.startPointId;
		const start = this.startPoint;
		if (!startId || !start) return false;

		const endEvent = this.edgeEnd ?? this.edgeCursor;
		const end = this.getEdgeEnd(start, endEvent?.effectiveWorld ?? start);
		if (dist(start, end) < MIN_POINT_DISTANCE) return false;
		const toward = direction ?? (this.edgeEnd ? this.edgeCursor?.world : undefined);
		const side = toward ? this.getEdgeSide(start, end, toward) : 0;
		if (direction && side === 0) return false;

		const { sketch } = this.ctx;
		const endId = endEvent && !this.sizeLocked ? this.placePoint(endEvent) : sketch.addPoint(end).id;
		const endPoint = sketch.points.get(endId)!;
		if (dist(start, endPoint) < MIN_POINT_DISTANCE) {
			this.cancel();
			return false;
		}
		const reversed = side < 0;
		const geometry = this.getEdgeGeometry(start, endPoint, reversed);
		const centerId = sketch.addPoint(geometry.center).id;
		const vertexIds = reversed ? [endId, startId] : [startId, endId];
		return this.commitPolygon(centerId, geometry.radius, geometry.angle, this.sizeLocked, vertexIds);
	}

	private commitCenteredPolygon(e?: ToolMouseEvent): boolean {
		const centerId = this.startPointId;
		const center = this.startPoint;
		if (!centerId || !center) return false;

		const radius = this.sizeLocked || !e ? this.size : dist(center, e.effectiveWorld);
		if (radius < MIN_POINT_DISTANCE) return false;
		const angle = e ? angleFromTo(center, e.effectiveWorld) : this.currentAngle;
		if (e && this.mode === 'inscribed' && !this.sizeLocked) {
			const vertexId = this.placePoint(e);
			const vertex = this.ctx.sketch.points.get(vertexId)!;
			return this.commitPolygon(centerId, dist(center, vertex), angleFromTo(center, vertex), false, [vertexId]);
		}
		return this.commitPolygon(centerId, radius, angle, this.sizeLocked);
	}

	private commitPolygon(
		centerId: string,
		radius: number,
		angle: number,
		lockSize: boolean,
		vertexIds?: string[]
	): boolean {
		const { sketch } = this.ctx;
		const lockRadius = lockSize && this.mode !== 'edge';
		const expression = lockSize ? this.popup.getExpression(this.sizeField) : undefined;
		const polygon = sketch.addPolygon(centerId, radius, this.sides, angle, this.ctx.isConstructionMode, lockRadius, {
			radiusToVertex: this.mode !== 'circumscribed',
			vertexIds,
			radiusExpression: lockRadius ? expression : undefined,
		});
		if (!polygon) {
			this.cancel();
			return false;
		}

		let dimension = polygon.vertexDistanceConstraint ?? polygon.distanceConstraint;
		if (lockSize && this.mode === 'edge') {
			const [start, end] = polygon.vertices;
			dimension = sketch.addDistanceConstraint(start.id, end.id, this.size) ?? undefined;
			if (dimension && expression) dimension.expression = expression;
		}
		sketch.commitTransaction();
		this.resetDrawing();
		sketch.selectEntity((dimension ?? polygon.constraint).id, 'constraint', false);
		this.ctx.showToast(`Polygon created (${polygon.vertices.length} vertices)`);
		this.ctx.requestRender();
		return true;
	}
}

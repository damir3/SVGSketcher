import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../../../math/ellipse';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { Vec2 } from '../../../math/vector';
import {
	renderEllipseMajorAxisPreviewVisual,
	renderEllipsePreviewVisual,
	renderEllipticalArcStartPreviewVisual,
	renderEllipticalArcPreviewVisual,
} from '../../previewHelpers';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { ToolPopup } from '../../../ui/tool-popup';
import { dispatchToolModeChange } from '../modeChangeEvent';

const TWO_PI = 2 * Math.PI;

export type EllipseMode = 'ellipse' | 'elliptical_arc';

export class EllipseTool extends BaseTool {
	readonly id = 'ellipse' as const;
	readonly popup = new ToolPopup<'major' | 'minor'>({
		className: 'ellipse-popup',
		fields: [
			{ id: 'major', label: 'Major Radius', type: 'dimension', unit: 'mm', lockable: true, min: 0.1 },
			{ id: 'minor', label: 'Minor Radius', type: 'dimension', unit: 'mm', lockable: true, min: 0.1 },
		],
		onKeyDown: e => this.sidebarPanel?.handleKeyDown?.(e) || this.onKeyDown(e),
	});
	private lastPointer: ToolMouseEvent | null = null;
	private _mode: EllipseMode;

	private drawingStep: 0 | 1 | 2 | 3 | 4 = 0;
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;
	private majPtId: string | null = null;
	private majWorldPos: Vec2 | null = null;
	private minPtId: string | null = null;
	private minWorldPos: Vec2 | null = null;
	private startPtId: string | null = null;
	private startWorldPtPos: Vec2 | null = null;
	private ellipticalArcPrevAngle: number | null = null;
	private ellipticalArcTotalAngle = 0;

	onModeChange?: (mode: EllipseMode) => void;
	onStateChange?: () => void;

	constructor(initialMode: EllipseMode = 'ellipse') {
		super();
		this._mode = initialMode;

		this.sidebarPanel = new VariationToolPanel<EllipseMode>({
			title: 'Ellipse Tool',
			description: 'Select ellipse creation method:',
			dataAttribute: 'data-ellipse-mode',
			cancelButtonId: 'btn-ellipse-cancel-icon',
			modes: [
				{
					id: 'ellipse',
					label: 'Ellipse',
					title: 'Ellipse (Alt+1)',
					iconName: 'ellipse',
				},
				{
					id: 'elliptical_arc',
					label: 'Elliptical Arc',
					title: 'Elliptical Arc (Alt+2)',
					iconName: 'elliptical_arc',
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
		this.popup.onChange = () => this.ctx.requestRender();
		this.popup.onLockChange = () => this.ctx.requestRender();
		this.popup.onCancel = () => this.ctx.setTool('select');
	}

	getStepHint(): string {
		if (this.drawingStep === 0) return '1. Click to place center point';
		if (this.drawingStep === 1) return '2. Click to set major axis endpoint';
		if (this.drawingStep === 2) return '3. Click to set minor axis radius';
		if (this.drawingStep === 3) return '4. Click to set arc start point';
		return '5. Click to set arc end point';
	}

	get mode(): EllipseMode {
		return this._mode;
	}

	get step(): number {
		return this.drawingStep;
	}

	setMode(newMode: EllipseMode): void {
		if (this._mode === newMode) return;
		this.cancel();
		this._mode = newMode;
		dispatchToolModeChange('ellipse', newMode);
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.popup.setSketch(ctx.sketch);
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (!this.popup.isOpen() || !this.lastPointer) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			this.onMouseDown(this.lastPointer);
			return true;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			this.popup.cycleFocus(e.shiftKey);
			return true;
		}
	}

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override shouldSnap(): boolean {
		return this.drawingStep === 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		this.lastPointer = e;
		const { sketch } = this.ctx;
		const snap = this.shouldSnap() ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			const pt = this.acquirePoint(snap ? snap.worldPos : world, snap);
			this.centerId = pt.id;
			this.centerWorldPos = pt.pos;
			this.drawingStep = 1;
			this.popup.resetField('major', 0);
			this.popup.resetField('minor', 0);
			this.popup.setFieldReadOnly('major', false);
			this.popup.setFieldReadOnly('minor', true);
			this.popup.show(e.client);
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const center = this.centerWorldPos!;
			const position = this.getMajorPoint(center, world);
			if (!this.popup.isLocked('major') && center.distanceTo(position) < 2) return;
			this.majPtId = sketch.addPoint(position).id;
			this.majWorldPos = position;
			this.drawingStep = 2;
			this.popup.updateValueIfUnlocked('major', center.distanceTo(position));
			this.popup.setFieldReadOnly('major', true);
			this.popup.setFieldReadOnly('minor', false);
			this.popup.updatePosition(e.client);
			this.popup.focus('minor');
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const center = this.centerWorldPos!;
			const position = this.getMinorPoint(center, this.majWorldPos!, world);
			const point = sketch.addPoint(position);
			this.minPtId = point.id;
			this.minWorldPos = position;
			this.popup.updateValueIfUnlocked('minor', center.distanceTo(position));

			if (this._mode === 'ellipse') {
				sketch.addEllipse(this.centerId!, this.majPtId!, point.id, this.ctx.isConstructionMode);
				this.constrainRadii();
				sketch.commitTransaction();
				this.cancel();
				this.ctx.requestRender();
				this.ctx.showToast('Ellipse created');
			} else {
				this.drawingStep = 3;
				this.popup.setFieldReadOnly('minor', true);
				this.onStateChange?.();
				this.ctx.requestRender();
			}
		} else if (this.drawingStep === 3) {
			const effectiveWorld = snap ? snap.worldPos : world;
			const proj = this.projectOntoEllipseWorld(effectiveWorld);
			if (!proj) return;

			const pt = this.acquirePoint(proj, snap, this.centerId, this.majPtId, this.minPtId);
			this.startPtId = pt.id;
			this.startWorldPtPos = pt.pos;
			const params = this.getScreenArcParams(this.ctx.viewport, this.startWorldPtPos, this.startWorldPtPos);
			this.ellipticalArcPrevAngle = params?.tA ?? null;
			this.ellipticalArcTotalAngle = 0;
			this.drawingStep = 4;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 4) {
			const effectiveWorld = snap ? snap.worldPos : world;
			const proj = this.projectOntoEllipseWorld(effectiveWorld);
			if (!proj) return;

			const params = this.getScreenArcParams(this.ctx.viewport, this.startWorldPtPos!, effectiveWorld);
			if (!params) return;
			if (this.ellipticalArcPrevAngle !== null) {
				this.ellipticalArcTotalAngle =
					(this.ellipticalArcTotalAngle + this.normalizeAngle(params.tB - this.ellipticalArcPrevAngle)) % TWO_PI;
			}
			const clockwise = this.resolveArcClockwise(params.tA, params.tB);
			const endPtId = this.acquirePoint(proj, snap, this.centerId, this.majPtId, this.minPtId, this.startPtId).id;

			sketch.addEllipticalArc(
				this.centerId!,
				this.majPtId!,
				this.minPtId!,
				this.startPtId!,
				endPtId,
				clockwise,
				this.ctx.isConstructionMode
			);
			this.constrainRadii();
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
			this.ctx.showToast('Elliptical arc created');
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		this.lastPointer = e;
		if (this.centerWorldPos) {
			if (this.drawingStep === 1) {
				this.popup.updateValueIfUnlocked('major', this.centerWorldPos.distanceTo(e.world));
			} else if (this.drawingStep === 2 && this.majWorldPos) {
				const minor = this.getMinorPoint(this.centerWorldPos, this.majWorldPos, e.world);
				this.popup.updateValueIfUnlocked('minor', this.centerWorldPos.distanceTo(minor));
			}
			this.popup.updatePosition(e.client);
		}
		const effectiveWorld = this.shouldSnap() && e.snap ? e.snap.worldPos : e.world;

		if (this.drawingStep === 4 && this.startWorldPtPos) {
			const params = this.getScreenArcParams(this.ctx.viewport, this.startWorldPtPos, effectiveWorld);
			if (params) {
				if (this.ellipticalArcPrevAngle === null) {
					this.ellipticalArcPrevAngle = params.tA;
					this.ellipticalArcTotalAngle = 0;
				}
				this.ellipticalArcTotalAngle =
					(this.ellipticalArcTotalAngle + this.normalizeAngle(params.tB - this.ellipticalArcPrevAngle)) % TWO_PI;
				this.ellipticalArcPrevAngle = params.tB;
			}
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const effectiveWorld = this.shouldSnap() && ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;

		if (this.drawingStep === 1 && this.centerWorldPos) {
			const start = ctx.viewport.worldToScreen(this.centerWorldPos);
			const end = ctx.viewport.worldToScreen(this.getMajorPoint(this.centerWorldPos, effectiveWorld));
			renderEllipseMajorAxisPreviewVisual(ctx.targetGroup, start, end);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.majWorldPos) {
			const center = ctx.viewport.worldToScreen(this.centerWorldPos);
			const major = ctx.viewport.worldToScreen(this.majWorldPos);
			const minor = ctx.viewport.worldToScreen(
				this.getMinorPoint(this.centerWorldPos, this.majWorldPos, effectiveWorld)
			);
			renderEllipsePreviewVisual(ctx.targetGroup, center, major, minor, ctx.isConstruction);
		} else if (this.drawingStep === 3 && this.centerWorldPos && this.majWorldPos && this.minWorldPos) {
			renderEllipticalArcStartPreviewVisual(
				ctx.targetGroup,
				ctx.viewport.worldToScreen(this.centerWorldPos),
				ctx.viewport.worldToScreen(this.majWorldPos),
				ctx.viewport.worldToScreen(this.minWorldPos),
				ctx.viewport.worldToScreen(effectiveWorld)
			);
		} else if (this.drawingStep === 4 && this.startWorldPtPos) {
			const params = this.getScreenArcParams(ctx.viewport, this.startWorldPtPos, effectiveWorld);
			if (params) {
				renderEllipticalArcPreviewVisual(
					ctx.targetGroup,
					params.sc,
					params.smaj,
					params.smin,
					params.sA,
					params.sB,
					this.resolveArcClockwise(params.tA, params.tB),
					ctx.isConstruction
				);
			}
		}
	}

	private acquirePoint(
		fallbackPos: Vec2,
		snap: ToolMouseEvent['snap'],
		...excludeIds: Array<string | null>
	): { id: string; pos: Vec2 } {
		const { sketch } = this.ctx;
		if (snap?.type === 'point' && snap.id && !excludeIds.includes(snap.id) && sketch.points.has(snap.id)) {
			return { id: snap.id, pos: snap.worldPos };
		}
		const pt = sketch.addPoint(fallbackPos);
		this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
		return { id: pt.id, pos: pt.clone() };
	}

	private projectOntoEllipseWorld(targetWorld: Vec2): Vec2 | null {
		if (!this.centerWorldPos || !this.majWorldPos || !this.minWorldPos) return null;
		const rx = this.centerWorldPos.distanceTo(this.majWorldPos);
		const ry = this.centerWorldPos.distanceTo(this.minWorldPos);
		if (rx < 0.1 || ry < 0.1) return null;
		const axisU = new Vec2().subVectors(this.majWorldPos, this.centerWorldPos).divideScalar(rx);
		const axisV = new Vec2().subVectors(this.minWorldPos, this.centerWorldPos).divideScalar(ry);
		const radii = new Vec2(rx, ry);
		const param = ellipseParameterAtPoint(targetWorld, this.centerWorldPos, radii, axisU, axisV);
		return ellipsePointAtParameter(param, this.centerWorldPos, radii, axisU, axisV);
	}

	private getScreenArcParams(viewport: ToolRenderContext['viewport'], worldA: Vec2, worldB: Vec2) {
		if (!this.centerWorldPos || !this.majWorldPos || !this.minWorldPos) return null;
		if (
			this.centerWorldPos.distanceTo(this.majWorldPos) < 0.1 ||
			this.centerWorldPos.distanceTo(this.minWorldPos) < 0.1
		) {
			return null;
		}
		const sc = viewport.worldToScreen(this.centerWorldPos);
		const smaj = viewport.worldToScreen(this.majWorldPos);
		const smin = viewport.worldToScreen(this.minWorldPos);
		const sA = viewport.worldToScreen(worldA);
		const sB = viewport.worldToScreen(worldB);
		const r = sc.distancesTo(smaj, smin);
		const paramRadii = new Vec2(Math.max(r.x, 0.1), Math.max(r.y, 0.1));
		const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));
		return {
			sc,
			smaj,
			smin,
			sA,
			sB,
			tA: ellipseParameterAtPoint(sA, sc, paramRadii, axisU, axisV),
			tB: ellipseParameterAtPoint(sB, sc, paramRadii, axisU, axisV),
		};
	}

	private normalizeAngle(angle: number): number {
		while (angle > Math.PI) angle -= TWO_PI;
		while (angle < -Math.PI) angle += TWO_PI;
		return angle;
	}

	private resolveArcClockwise(tStart: number, tEnd: number): boolean {
		return Math.abs(this.ellipticalArcTotalAngle) < 0.001
			? this.normalizeAngle(tEnd - tStart) >= 0
			: this.ellipticalArcTotalAngle >= 0;
	}

	private getMajorPoint(center: Vec2, cursor: Vec2): Vec2 {
		if (!this.popup.isLocked('major')) return cursor;
		const { axisU } = ellipseAxes(center.angleToPoint(cursor));
		return center.clone().addScaledVector(axisU, this.popup.getNumericValue('major', 0.1));
	}

	private getMinorPoint(center: Vec2, major: Vec2, cursor: Vec2): Vec2 {
		const { axisV } = ellipseAxes(center.angleToPoint(major));
		const projection = new Vec2().subVectors(cursor, center).dot(axisV);
		const radius = this.popup.isLocked('minor')
			? this.popup.getNumericValue('minor', 0.1)
			: Math.max(1, Math.abs(projection));
		return center.clone().addScaledVector(axisV, projection < 0 ? -radius : radius);
	}

	private constrainRadii(): void {
		const { sketch } = this.ctx;
		for (const [field, id] of [
			['major', this.majPtId],
			['minor', this.minPtId],
		] as const) {
			if (!id || !this.popup.isLocked(field)) continue;
			const constraint = sketch.addDistanceConstraint(this.centerId!, id, this.popup.getNumericValue(field, 0.1));
			const expression = this.popup.getExpression(field);
			if (constraint && expression) constraint.expression = expression;
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx?.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.popup.hide();
			this.lastPointer = null;
			this.centerId = null;
			this.centerWorldPos = null;
			this.majPtId = null;
			this.majWorldPos = null;
			this.minPtId = null;
			this.minWorldPos = null;
			this.startPtId = null;
			this.startWorldPtPos = null;
			this.ellipticalArcPrevAngle = null;
			this.ellipticalArcTotalAngle = 0;
			this.ctx?.renderer.clearPreviews();
			this.onStateChange?.();
			this.ctx?.requestRender();
		}
	}
}

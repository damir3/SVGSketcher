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
		const step = this.drawingStep;
		if (this._mode === 'ellipse') {
			if (step === 0) return '1. Click to place center point';
			if (step === 1) return '2. Click to set major axis endpoint';
			return '3. Click to set minor axis radius';
		} else {
			if (step === 0) return '1. Click to place center point';
			if (step === 1) return '2. Click to set major axis endpoint';
			if (step === 2) return '3. Click to set minor axis radius';
			if (step === 3) return '4. Click to set arc start point';
			return '5. Click to set arc end point';
		}
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
			let cId: string;
			if (snap && snap.type === 'point' && snap.id && sketch.points.has(snap.id)) {
				cId = snap.id;
				this.centerWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos);
				cId = pt.id;
				this.centerWorldPos = pt.clone();
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerId = cId;
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
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const minWorld = this.minWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const rxVal = centerWorld.distanceTo(majWorld);
			const ryVal = centerWorld.distanceTo(minWorld);
			if (rxVal < 0.1 || ryVal < 0.1) return;

			const axisU = new Vec2().subVectors(majWorld, centerWorld).divideScalar(rxVal);
			const axisV = new Vec2().subVectors(minWorld, centerWorld).divideScalar(ryVal);

			const radii = new Vec2(rxVal, ryVal);
			const t = ellipseParameterAtPoint(effectiveWorld, centerWorld, radii, axisU, axisV);
			const proj = ellipsePointAtParameter(t, centerWorld, radii, axisU, axisV);

			let startPtId: string;
			if (
				snap &&
				snap.type === 'point' &&
				snap.id &&
				snap.id !== this.centerId &&
				snap.id !== this.majPtId &&
				snap.id !== this.minPtId &&
				sketch.points.has(snap.id)
			) {
				startPtId = snap.id;
				this.startWorldPtPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(proj);
				startPtId = pt.id;
				this.startWorldPtPos = pt.clone();
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.startPtId = startPtId;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld);
			const sMin = this.ctx.viewport.worldToScreen(minWorld);
			const sStart = this.ctx.viewport.worldToScreen(this.startWorldPtPos);
			const r = sCenter.distancesTo(sMaj, sMin);
			const paramRadii = new Vec2(Math.max(r.x, 0.1), Math.max(r.y, 0.1));
			const { axisU: screenAxisU, axisV: screenAxisV } = ellipseAxes(sCenter.angleToPoint(sMaj));
			this.ellipticalArcPrevAngle = ellipseParameterAtPoint(sStart, sCenter, paramRadii, screenAxisU, screenAxisV);
			this.ellipticalArcTotalAngle = 0;
			this.drawingStep = 4;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 4) {
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const minWorld = this.minWorldPos!;
			const startWorld = this.startWorldPtPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const rxVal = centerWorld.distanceTo(majWorld);
			const ryVal = centerWorld.distanceTo(minWorld);
			if (rxVal < 0.1 || ryVal < 0.1) return;

			const axisU = new Vec2().subVectors(majWorld, centerWorld).divideScalar(rxVal);
			const axisV = new Vec2().subVectors(minWorld, centerWorld).divideScalar(ryVal);

			const radii = new Vec2(rxVal, ryVal);
			const te = ellipseParameterAtPoint(effectiveWorld, centerWorld, radii, axisU, axisV);
			const proj = ellipsePointAtParameter(te, centerWorld, radii, axisU, axisV);

			// Screen orientation calculation for clockwise flag
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld);
			const sMin = this.ctx.viewport.worldToScreen(minWorld);
			const sStart = this.ctx.viewport.worldToScreen(startWorld);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld);

			const r = sCenter.distancesTo(sMaj, sMin);
			const paramRadii = new Vec2(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

			const { axisU: screenAxisU, axisV: screenAxisV } = ellipseAxes(sCenter.angleToPoint(sMaj));

			const ts_sc = ellipseParameterAtPoint(sStart, sCenter, paramRadii, screenAxisU, screenAxisV);
			const te_sc = ellipseParameterAtPoint(sCur, sCenter, paramRadii, screenAxisU, screenAxisV);
			if (this.ellipticalArcPrevAngle !== null) {
				let dAngle = te_sc - this.ellipticalArcPrevAngle;
				while (dAngle > Math.PI) dAngle -= TWO_PI;
				while (dAngle < -Math.PI) dAngle += TWO_PI;
				this.ellipticalArcTotalAngle += dAngle;
			}
			this.ellipticalArcTotalAngle = this.ellipticalArcTotalAngle % TWO_PI;
			let clockwise = this.ellipticalArcTotalAngle >= 0;
			if (Math.abs(this.ellipticalArcTotalAngle) < 0.001) {
				let delta = te_sc - ts_sc;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			let endPtId: string;
			if (
				snap &&
				snap.type === 'point' &&
				snap.id &&
				snap.id !== this.centerId &&
				snap.id !== this.majPtId &&
				snap.id !== this.minPtId &&
				snap.id !== this.startPtId &&
				sketch.points.has(snap.id)
			) {
				endPtId = snap.id;
			} else {
				const pt = sketch.addPoint(proj);
				endPtId = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

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

		if (this.drawingStep === 4 && this.centerWorldPos && this.majWorldPos && this.minWorldPos && this.startWorldPtPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;
			const startWorld = this.startWorldPtPos;

			const rxVal = centerWorld.distanceTo(majWorld);
			const ryVal = centerWorld.distanceTo(minWorld);
			if (rxVal >= 0.1 && ryVal >= 0.1) {
				const sc = this.ctx.viewport.worldToScreen(centerWorld);
				const smaj = this.ctx.viewport.worldToScreen(majWorld);
				const smin = this.ctx.viewport.worldToScreen(minWorld);
				const ss = this.ctx.viewport.worldToScreen(startWorld);
				const se = this.ctx.viewport.worldToScreen(effectiveWorld);

				const r = sc.distancesTo(smaj, smin);
				const paramRadii = new Vec2(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

				const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));

				const ts = ellipseParameterAtPoint(ss, sc, paramRadii, axisU, axisV);
				const te = ellipseParameterAtPoint(se, sc, paramRadii, axisU, axisV);

				if (this.ellipticalArcPrevAngle === null) {
					this.ellipticalArcPrevAngle = ts;
					this.ellipticalArcTotalAngle = 0;
				}

				let dAngle = te - this.ellipticalArcPrevAngle;
				while (dAngle > Math.PI) dAngle -= TWO_PI;
				while (dAngle < -Math.PI) dAngle += TWO_PI;

				this.ellipticalArcTotalAngle += dAngle;
				this.ellipticalArcPrevAngle = te;
				this.ellipticalArcTotalAngle = this.ellipticalArcTotalAngle % TWO_PI;
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
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;

			const sc = ctx.viewport.worldToScreen(centerWorld);
			const smaj = ctx.viewport.worldToScreen(majWorld);
			const smin = ctx.viewport.worldToScreen(minWorld);
			const ss = ctx.viewport.worldToScreen(effectiveWorld);

			renderEllipticalArcStartPreviewVisual(ctx.targetGroup, sc, smaj, smin, ss);
		} else if (
			this.drawingStep === 4 &&
			this.centerWorldPos &&
			this.majWorldPos &&
			this.minWorldPos &&
			this.startWorldPtPos
		) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;
			const startWorld = this.startWorldPtPos;

			const rxVal = centerWorld.distanceTo(majWorld);
			const ryVal = centerWorld.distanceTo(minWorld);
			if (rxVal >= 0.1 && ryVal >= 0.1) {
				const sc = ctx.viewport.worldToScreen(centerWorld);
				const smaj = ctx.viewport.worldToScreen(majWorld);
				const smin = ctx.viewport.worldToScreen(minWorld);
				const ss = ctx.viewport.worldToScreen(startWorld);
				const se = ctx.viewport.worldToScreen(effectiveWorld);

				const { axisU, axisV } = ellipseAxes(sc.angleToPoint(smaj));

				const r = sc.distancesTo(smaj, smin);
				const paramRadii = new Vec2(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

				const ts = ellipseParameterAtPoint(ss, sc, paramRadii, axisU, axisV);
				const te = ellipseParameterAtPoint(se, sc, paramRadii, axisU, axisV);

				let clockwise = this.ellipticalArcTotalAngle >= 0;
				if (Math.abs(this.ellipticalArcTotalAngle) < 0.001) {
					let delta = te - ts;
					while (delta > Math.PI) delta -= TWO_PI;
					while (delta < -Math.PI) delta += TWO_PI;
					clockwise = delta >= 0;
				}

				renderEllipticalArcPreviewVisual(ctx.targetGroup, sc, smaj, smin, ss, se, clockwise, ctx.isConstruction);
			}
		}
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

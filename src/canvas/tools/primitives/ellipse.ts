import { ellipseAxes, ellipseParameterAtPoint, ellipsePointAtParameter } from '../../../math/ellipse';
import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { angleFromTo, dot, dist, distancesFrom, vec, sub, type Vec2 } from '../../../math/vector';
import {
	renderEllipseMajorAxisPreviewVisual,
	renderEllipsePreviewVisual,
	renderEllipticalArcStartPreviewVisual,
	renderEllipticalArcPreviewVisual,
} from '../../previewHelpers';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { dispatchToolModeChange } from '../modeChangeEvent';

const TWO_PI = 2 * Math.PI;

export type EllipseMode = 'ellipse' | 'elliptical_arc';

export class EllipseTool extends BaseTool {
	readonly id = 'ellipse' as const;
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

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override shouldSnap(): boolean {
		return this.drawingStep === 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
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
				this.centerWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerId = cId;
			this.drawingStep = 1;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const centerWorld = this.centerWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (dist(centerWorld, effectiveWorld) < 2) {
				return;
			}

			let p1Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId && sketch.points.has(snap.id)) {
				p1Id = snap.id;
				this.majWorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld);
				p1Id = pt.id;
				this.majWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.majPtId = p1Id;
			this.drawingStep = 2;
			this.onStateChange?.();
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const majLen = dist(centerWorld, majWorld);
			if (majLen < 0.1) return;

			const u = vec((majWorld.x - centerWorld.x) / majLen, (majWorld.y - centerWorld.y) / majLen);
			const v = vec(-u.y, u.x);

			const dir = sub(effectiveWorld, centerWorld);
			const projection = dot(dir, v);
			const ryVal = Math.max(1, Math.abs(projection));
			const sign = projection < 0 ? -1 : 1;

			const minorAxisPos = { x: centerWorld.x + sign * ryVal * v.x, y: centerWorld.y + sign * ryVal * v.y };

			let p2Id: string;
			if (
				snap &&
				snap.type === 'point' &&
				snap.id &&
				snap.id !== this.centerId &&
				snap.id !== this.majPtId &&
				sketch.points.has(snap.id)
			) {
				p2Id = snap.id;
				this.minWorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(minorAxisPos);
				p2Id = pt.id;
				this.minWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			if (this._mode === 'ellipse') {
				sketch.addEllipse(this.centerId!, this.majPtId!, p2Id, this.ctx.isConstructionMode);
				sketch.commitTransaction();
				this.cancel();
				this.ctx.requestRender();
				this.ctx.showToast('Ellipse created');
			} else {
				this.minPtId = p2Id;
				this.drawingStep = 3;
				this.onStateChange?.();
				this.ctx.requestRender();
			}
		} else if (this.drawingStep === 3) {
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const minWorld = this.minWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);
			if (rxVal < 0.1 || ryVal < 0.1) return;

			const axisU = vec((majWorld.x - centerWorld.x) / rxVal, (majWorld.y - centerWorld.y) / rxVal);
			const axisV = vec((minWorld.x - centerWorld.x) / ryVal, (minWorld.y - centerWorld.y) / ryVal);

			const radii = vec(rxVal, ryVal);
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
				this.startWorldPtPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.startPtId = startPtId;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld);
			const sMin = this.ctx.viewport.worldToScreen(minWorld);
			const sStart = this.ctx.viewport.worldToScreen(this.startWorldPtPos);
			const r = distancesFrom(sCenter, sMaj, sMin);
			const paramRadii = vec(Math.max(r.x, 0.1), Math.max(r.y, 0.1));
			const { axisU: screenAxisU, axisV: screenAxisV } = ellipseAxes(angleFromTo(sCenter, sMaj));
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

			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);
			if (rxVal < 0.1 || ryVal < 0.1) return;

			const axisU = vec((majWorld.x - centerWorld.x) / rxVal, (majWorld.y - centerWorld.y) / rxVal);
			const axisV = vec((minWorld.x - centerWorld.x) / ryVal, (minWorld.y - centerWorld.y) / ryVal);

			const radii = vec(rxVal, ryVal);
			const te = ellipseParameterAtPoint(effectiveWorld, centerWorld, radii, axisU, axisV);
			const proj = ellipsePointAtParameter(te, centerWorld, radii, axisU, axisV);

			// Screen orientation calculation for clockwise flag
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld);
			const sMin = this.ctx.viewport.worldToScreen(minWorld);
			const sStart = this.ctx.viewport.worldToScreen(startWorld);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld);

			const r = distancesFrom(sCenter, sMaj, sMin);
			const paramRadii = vec(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

			const { axisU: screenAxisU, axisV: screenAxisV } = ellipseAxes(angleFromTo(sCenter, sMaj));

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
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
			this.ctx.showToast('Elliptical arc created');
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const effectiveWorld = this.shouldSnap() && e.snap ? e.snap.worldPos : e.world;

		if (this.drawingStep === 4 && this.centerWorldPos && this.majWorldPos && this.minWorldPos && this.startWorldPtPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;
			const startWorld = this.startWorldPtPos;

			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);
			if (rxVal >= 0.1 && ryVal >= 0.1) {
				const sc = this.ctx.viewport.worldToScreen(centerWorld);
				const smaj = this.ctx.viewport.worldToScreen(majWorld);
				const smin = this.ctx.viewport.worldToScreen(minWorld);
				const ss = this.ctx.viewport.worldToScreen(startWorld);
				const se = this.ctx.viewport.worldToScreen(effectiveWorld);

				const r = distancesFrom(sc, smaj, smin);
				const paramRadii = vec(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

				const { axisU, axisV } = ellipseAxes(angleFromTo(sc, smaj));

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
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld);
			const rx = dist(this.centerWorldPos, effectiveWorld);
			renderEllipseMajorAxisPreviewVisual(ctx.targetGroup, s1, s2, rx, ctx.isConstruction);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.majWorldPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;

			const majLen = dist(centerWorld, majWorld);
			if (majLen >= 0.1) {
				const u = vec((majWorld.x - centerWorld.x) / majLen, (majWorld.y - centerWorld.y) / majLen);
				const v = vec(-u.y, u.x);

				const dir = sub(effectiveWorld, centerWorld);
				const projection = dot(dir, v);
				const ryVal = Math.max(1, Math.abs(projection));
				const sign = projection < 0 ? -1 : 1;

				const sc = ctx.viewport.worldToScreen(centerWorld);
				const smaj = ctx.viewport.worldToScreen(majWorld);
				const sminWorld = vec(centerWorld.x + sign * ryVal * v.x, centerWorld.y + sign * ryVal * v.y);
				const smin = ctx.viewport.worldToScreen(sminWorld);

				renderEllipsePreviewVisual(ctx.targetGroup, sc, smaj, smin, majLen, ryVal, ctx.isConstruction);
			}
		} else if (this.drawingStep === 3 && this.centerWorldPos && this.majWorldPos && this.minWorldPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;
			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);

			const sc = ctx.viewport.worldToScreen(centerWorld);
			const smaj = ctx.viewport.worldToScreen(majWorld);
			const smin = ctx.viewport.worldToScreen(minWorld);
			const ss = ctx.viewport.worldToScreen(effectiveWorld);

			renderEllipticalArcStartPreviewVisual(ctx.targetGroup, sc, smaj, smin, ss, rxVal, ryVal, ctx.isConstruction);
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

			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);
			if (rxVal >= 0.1 && ryVal >= 0.1) {
				const sc = ctx.viewport.worldToScreen(centerWorld);
				const smaj = ctx.viewport.worldToScreen(majWorld);
				const smin = ctx.viewport.worldToScreen(minWorld);
				const ss = ctx.viewport.worldToScreen(startWorld);
				const se = ctx.viewport.worldToScreen(effectiveWorld);

				const { axisU, axisV } = ellipseAxes(angleFromTo(sc, smaj));

				const r = distancesFrom(sc, smaj, smin);
				const paramRadii = vec(Math.max(r.x, 0.1), Math.max(r.y, 0.1));

				const ts = ellipseParameterAtPoint(ss, sc, paramRadii, axisU, axisV);
				const te = ellipseParameterAtPoint(se, sc, paramRadii, axisU, axisV);

				let clockwise = this.ellipticalArcTotalAngle >= 0;
				if (Math.abs(this.ellipticalArcTotalAngle) < 0.001) {
					let delta = te - ts;
					while (delta > Math.PI) delta -= TWO_PI;
					while (delta < -Math.PI) delta += TWO_PI;
					clockwise = delta >= 0;
				}

				renderEllipticalArcPreviewVisual(
					ctx.targetGroup,
					sc,
					smaj,
					smin,
					ss,
					se,
					rxVal,
					ryVal,
					clockwise,
					ctx.isConstruction
				);
			}
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx?.sketch.rollbackTransaction();
			this.drawingStep = 0;
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

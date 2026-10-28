import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import {
	renderEllipseMajorAxisPreviewVisual,
	renderEllipsePreviewVisual,
	renderEllipticalArcStartPreviewVisual,
	renderEllipticalArcPreviewVisual,
} from '../../previewHelpers';

const TWO_PI = 2 * Math.PI;

export class EllipticalArcTool extends BaseTool {
	readonly id = 'elliptical_arc' as const;

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

	get step(): number {
		return this.drawingStep;
	}

	override isBusy(): boolean {
		return this.drawingStep > 0;
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
			if (snap && snap.type === 'point' && snap.id) {
				cId = snap.id;
				this.centerWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				cId = pt.id;
				this.centerWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerId = cId;
			this.drawingStep = 1;
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const centerWorld = this.centerWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (dist(centerWorld, effectiveWorld) < 2) return;

			let p1Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId) {
				p1Id = snap.id;
				this.majWorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld.x, effectiveWorld.y);
				p1Id = pt.id;
				this.majWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.majPtId = p1Id;
			this.drawingStep = 2;
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const majLen = dist(centerWorld, majWorld);
			if (majLen < 0.1) return;

			const ux = (majWorld.x - centerWorld.x) / majLen;
			const uy = (majWorld.y - centerWorld.y) / majLen;
			const vx = -uy;
			const vy = ux;

			const dx = effectiveWorld.x - centerWorld.x;
			const dy = effectiveWorld.y - centerWorld.y;
			let ryVal = Math.abs(dx * vx + dy * vy);
			if (ryVal < 1) ryVal = 1;
			const sign = dx * vx + dy * vy < 0 ? -1 : 1;

			const minX = centerWorld.x + sign * ryVal * vx;
			const minY = centerWorld.y + sign * ryVal * vy;

			let p2Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId && snap.id !== this.majPtId) {
				p2Id = snap.id;
				this.minWorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(minX, minY);
				p2Id = pt.id;
				this.minWorldPos = vec(pt.x, pt.y);
				if (snap && snap.type === 'line' && snap.lineId) {
					sketch.addPointOnLineConstraint(pt.id, snap.lineId);
					this.ctx.showToast('Point constrained to line');
				}
			}
			this.minPtId = p2Id;
			this.drawingStep = 3;
			this.ctx.requestRender();
		} else if (this.drawingStep === 3) {
			const centerWorld = this.centerWorldPos!;
			const majWorld = this.majWorldPos!;
			const minWorld = this.minWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;

			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);
			if (rxVal < 0.1 || ryVal < 0.1) return;

			const ux = (majWorld.x - centerWorld.x) / rxVal;
			const uy = (majWorld.y - centerWorld.y) / rxVal;
			const vx = (minWorld.x - centerWorld.x) / ryVal;
			const vy = (minWorld.y - centerWorld.y) / ryVal;

			const dx = effectiveWorld.x - centerWorld.x;
			const dy = effectiveWorld.y - centerWorld.y;
			const u = dx * ux + dy * uy;
			const v = dx * vx + dy * vy;
			const t = Math.atan2(v / ryVal, u / rxVal);

			const projX = centerWorld.x + rxVal * Math.cos(t) * ux + ryVal * Math.sin(t) * vx;
			const projY = centerWorld.y + rxVal * Math.cos(t) * uy + ryVal * Math.sin(t) * vy;

			let startPtId: string;
			if (
				snap &&
				snap.type === 'point' &&
				snap.id &&
				snap.id !== this.centerId &&
				snap.id !== this.majPtId &&
				snap.id !== this.minPtId
			) {
				startPtId = snap.id;
				this.startWorldPtPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(projX, projY);
				startPtId = pt.id;
				this.startWorldPtPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.startPtId = startPtId;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
			const sMin = this.ctx.viewport.worldToScreen(minWorld.x, minWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(this.startWorldPtPos.x, this.startWorldPtPos.y);
			const rx_s = Math.max(Math.hypot(sMaj.x - sCenter.x, sMaj.y - sCenter.y), 0.1);
			const ry_s = Math.max(Math.hypot(sMin.x - sCenter.x, sMin.y - sCenter.y), 0.1);
			const theta = Math.atan2(sMaj.y - sCenter.y, sMaj.x - sCenter.x);
			const ux_s = Math.cos(theta);
			const uy_s = Math.sin(theta);
			const vx_s = -Math.sin(theta);
			const vy_s = Math.cos(theta);
			const us = (sStart.x - sCenter.x) * ux_s + (sStart.y - sCenter.y) * uy_s;
			const vs = (sStart.x - sCenter.x) * vx_s + (sStart.y - sCenter.y) * vy_s;
			this.ellipticalArcPrevAngle = Math.atan2(vs / ry_s, us / rx_s);
			this.ellipticalArcTotalAngle = 0;
			this.drawingStep = 4;
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

			const ux = (majWorld.x - centerWorld.x) / rxVal;
			const uy = (majWorld.y - centerWorld.y) / rxVal;
			const vx = (minWorld.x - centerWorld.x) / ryVal;
			const vy = (minWorld.y - centerWorld.y) / ryVal;

			const dx = effectiveWorld.x - centerWorld.x;
			const dy = effectiveWorld.y - centerWorld.y;
			const u = dx * ux + dy * uy;
			const v = dx * vx + dy * vy;
			const te = Math.atan2(v / ryVal, u / rxVal);

			const projX = centerWorld.x + rxVal * Math.cos(te) * ux + ryVal * Math.sin(te) * vx;
			const projY = centerWorld.y + rxVal * Math.cos(te) * uy + ryVal * Math.sin(te) * vy;

			// Screen orientation calculation for clockwise flag
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sMaj = this.ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
			const sMin = this.ctx.viewport.worldToScreen(minWorld.x, minWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			const rx_s = Math.max(Math.hypot(sMaj.x - sCenter.x, sMaj.y - sCenter.y), 0.1);
			const ry_s = Math.max(Math.hypot(sMin.x - sCenter.x, sMin.y - sCenter.y), 0.1);

			const theta = Math.atan2(sMaj.y - sCenter.y, sMaj.x - sCenter.x);
			const ux_s = Math.cos(theta);
			const uy_s = Math.sin(theta);
			const vx_s = -Math.sin(theta);
			const vy_s = Math.cos(theta);

			const us = (sStart.x - sCenter.x) * ux_s + (sStart.y - sCenter.y) * uy_s;
			const vs = (sStart.x - sCenter.x) * vx_s + (sStart.y - sCenter.y) * vy_s;
			const ue = (sCur.x - sCenter.x) * ux_s + (sCur.y - sCenter.y) * uy_s;
			const ve = (sCur.x - sCenter.x) * vx_s + (sCur.y - sCenter.y) * vy_s;

			const ts_sc = Math.atan2(vs / ry_s, us / rx_s);
			const te_sc = Math.atan2(ve / ry_s, ue / rx_s);
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
				snap.id !== this.startPtId
			) {
				endPtId = snap.id;
			} else {
				const pt = sketch.addPoint(projX, projY);
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

		if (
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
				const sc = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
				const smaj = this.ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
				const smin = this.ctx.viewport.worldToScreen(minWorld.x, minWorld.y);
				const ss = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
				const se = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

				const rx_s = Math.max(Math.hypot(smaj.x - sc.x, smaj.y - sc.y), 0.1);
				const ry_s = Math.max(Math.hypot(smin.x - sc.x, smin.y - sc.y), 0.1);

				const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
				const ux_s = Math.cos(theta);
				const uy_s = Math.sin(theta);
				const vx_s = -Math.sin(theta);
				const vy_s = Math.cos(theta);

				const us = (ss.x - sc.x) * ux_s + (ss.y - sc.y) * uy_s;
				const vs = (ss.x - sc.x) * vx_s + (ss.y - sc.y) * vy_s;
				const ue = (se.x - sc.x) * ux_s + (se.y - sc.y) * uy_s;
				const ve = (se.x - sc.x) * vx_s + (se.y - sc.y) * vy_s;

				const ts = Math.atan2(vs / ry_s, us / rx_s);
				const te = Math.atan2(ve / ry_s, ue / rx_s);

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
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const rx = dist(this.centerWorldPos, effectiveWorld);
			renderEllipseMajorAxisPreviewVisual(ctx.targetGroup, s1, s2, rx, ctx.isConstruction);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.majWorldPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const majLen = dist(centerWorld, majWorld);
			if (majLen >= 0.1) {
				const ux = (majWorld.x - centerWorld.x) / majLen;
				const uy = (majWorld.y - centerWorld.y) / majLen;
				const vx = -uy;
				const vy = ux;

				const dx = effectiveWorld.x - centerWorld.x;
				const dy = effectiveWorld.y - centerWorld.y;
				let ryVal = Math.abs(dx * vx + dy * vy);
				if (ryVal < 1) ryVal = 1;
				const sign = dx * vx + dy * vy < 0 ? -1 : 1;

				const sc = ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
				const smaj = ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
				const sminWorld = vec(centerWorld.x + sign * ryVal * vx, centerWorld.y + sign * ryVal * vy);
				const smin = ctx.viewport.worldToScreen(sminWorld.x, sminWorld.y);

				renderEllipsePreviewVisual(ctx.targetGroup, sc, smaj, smin, majLen, ryVal, ctx.isConstruction);
			}
		} else if (this.drawingStep === 3 && this.centerWorldPos && this.majWorldPos && this.minWorldPos) {
			const centerWorld = this.centerWorldPos;
			const majWorld = this.majWorldPos;
			const minWorld = this.minWorldPos;
			const rxVal = dist(centerWorld, majWorld);
			const ryVal = dist(centerWorld, minWorld);

			const sc = ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const smaj = ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
			const smin = ctx.viewport.worldToScreen(minWorld.x, minWorld.y);
			const ss = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			renderEllipticalArcStartPreviewVisual(
				ctx.targetGroup,
				sc,
				smaj,
				smin,
				ss,
				rxVal,
				ryVal,
				ctx.isConstruction
			);
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
				const sc = ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
				const smaj = ctx.viewport.worldToScreen(majWorld.x, majWorld.y);
				const smin = ctx.viewport.worldToScreen(minWorld.x, minWorld.y);
				const ss = ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
				const se = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

				const theta = Math.atan2(smaj.y - sc.y, smaj.x - sc.x);
				const ux_s = Math.cos(theta);
				const uy_s = Math.sin(theta);
				const vx_s = -Math.sin(theta);
				const vy_s = Math.cos(theta);

				const us = (ss.x - sc.x) * ux_s + (ss.y - sc.y) * uy_s;
				const vs = (ss.x - sc.x) * vx_s + (ss.y - sc.y) * vy_s;
				const ue = (se.x - sc.x) * ux_s + (se.y - sc.y) * uy_s;
				const ve = (se.x - sc.x) * vx_s + (se.y - sc.y) * vy_s;

				const rx_s = Math.max(Math.hypot(smaj.x - sc.x, smaj.y - sc.y), 0.1);
				const ry_s = Math.max(Math.hypot(smin.x - sc.x, smin.y - sc.y), 0.1);

				const ts = Math.atan2(vs / ry_s, us / rx_s);
				const te = Math.atan2(ve / ry_s, ue / rx_s);

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
			this.ctx.sketch.rollbackTransaction();
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
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

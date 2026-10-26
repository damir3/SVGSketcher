import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';

const TWO_PI = 2 * Math.PI;

export class ArcCenterTool extends BaseTool {
	readonly id = 'arc_center' as const;

	private drawingStep: 0 | 1 | 2 = 0;
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;
	private arcPoint1Id: string | null = null;
	private arcPoint1WorldPos: Vec2 | null = null;
	private arcCenterPrevAngle: number | null = null;
	private arcCenterTotalAngle = 0;

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
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
			if (dist(centerWorld, effectiveWorld) < 2) {
				return;
			}

			let p1Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId) {
				p1Id = snap.id;
				this.arcPoint1WorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld.x, effectiveWorld.y);
				p1Id = pt.id;
				this.arcPoint1WorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.arcPoint1Id = p1Id;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(this.arcPoint1WorldPos.x, this.arcPoint1WorldPos.y);
			this.arcCenterPrevAngle = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			this.arcCenterTotalAngle = 0;
			this.drawingStep = 2;
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const centerWorld = this.centerWorldPos!;
			const startWorld = this.arcPoint1WorldPos!;
			const radius = Math.max(1, dist(centerWorld, startWorld));

			const effectiveWorld = snap ? snap.worldPos : world;
			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

			if (this.arcCenterPrevAngle !== null) {
				let dAngle = acur - this.arcCenterPrevAngle;
				while (dAngle > Math.PI) dAngle -= TWO_PI;
				while (dAngle < -Math.PI) dAngle += TWO_PI;
				this.arcCenterTotalAngle += dAngle;
			}

			this.arcCenterTotalAngle = this.arcCenterTotalAngle % TWO_PI;

			let clockwise = this.arcCenterTotalAngle >= 0;
			if (Math.abs(this.arcCenterTotalAngle) < 0.001) {
				let delta = acur - as;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
			const endWorldX = centerWorld.x + radius * Math.cos(worldAngle);
			const endWorldY = centerWorld.y + radius * Math.sin(worldAngle);

			let endPointId: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.centerId && snap.id !== this.arcPoint1Id) {
				endPointId = snap.id;
			} else {
				const pt = sketch.addPoint(endWorldX, endWorldY);
				endPointId = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			sketch.addArc(
				this.centerId!,
				this.arcPoint1Id!,
				endPointId,
				radius,
				clockwise,
				this.ctx.isConstructionMode
			);
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
			this.ctx.showToast('Centerpoint arc created');
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = e.snap ? e.snap.worldPos : e.world;
			const s1 = this.ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			this.ctx.renderer.renderCirclePreview(s1, s2, radius, this.ctx.isConstructionMode, true);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.arcPoint1WorldPos) {
			const centerWorld = this.centerWorldPos;
			const startWorld = this.arcPoint1WorldPos;
			const radius = Math.max(1, dist(centerWorld, startWorld));
			const effectiveWorld = e.snap ? e.snap.worldPos : e.world;

			const sCenter = this.ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = this.ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const sr = radius * this.ctx.viewport.zoom;

			const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

			if (this.arcCenterPrevAngle === null) {
				this.arcCenterPrevAngle = as;
				this.arcCenterTotalAngle = 0;
			}

			let dAngle = acur - this.arcCenterPrevAngle;
			while (dAngle > Math.PI) dAngle -= TWO_PI;
			while (dAngle < -Math.PI) dAngle += TWO_PI;

			this.arcCenterTotalAngle += dAngle;
			this.arcCenterPrevAngle = acur;
			this.arcCenterTotalAngle = this.arcCenterTotalAngle % TWO_PI;

			let clockwise = this.arcCenterTotalAngle >= 0;
			if (Math.abs(this.arcCenterTotalAngle) < 0.001) {
				let delta = acur - as;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
			const endWorld = vec(
				centerWorld.x + radius * Math.cos(worldAngle),
				centerWorld.y + radius * Math.sin(worldAngle)
			);
			const sEnd = this.ctx.viewport.worldToScreen(endWorld.x, endWorld.y);

			let sweepAngle = 0;
			if (clockwise) {
				sweepAngle = (acur - as) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			} else {
				sweepAngle = (as - acur) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			}

			this.ctx.renderer.renderArcPreview(
				sCenter,
				sStart,
				sEnd,
				sr,
				clockwise,
				radius,
				sweepAngle,
				this.ctx.isConstructionMode
			);
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			this.ctx.renderer.renderCirclePreview(s1, s2, radius, ctx.isConstruction, true);
		} else if (this.drawingStep === 2 && this.centerWorldPos && this.arcPoint1WorldPos) {
			const centerWorld = this.centerWorldPos;
			const startWorld = this.arcPoint1WorldPos;
			const radius = Math.max(1, dist(centerWorld, startWorld));
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;

			const sCenter = ctx.viewport.worldToScreen(centerWorld.x, centerWorld.y);
			const sStart = ctx.viewport.worldToScreen(startWorld.x, startWorld.y);
			const sCur = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const sr = radius * ctx.viewport.zoom;

			const as = Math.atan2(sStart.y - sCenter.y, sStart.x - sCenter.x);
			const acur = Math.atan2(sCur.y - sCenter.y, sCur.x - sCenter.x);

			let clockwise = this.arcCenterTotalAngle >= 0;
			if (Math.abs(this.arcCenterTotalAngle) < 0.001) {
				let delta = acur - as;
				while (delta > Math.PI) delta -= TWO_PI;
				while (delta < -Math.PI) delta += TWO_PI;
				clockwise = delta >= 0;
			}

			const worldAngle = Math.atan2(effectiveWorld.y - centerWorld.y, effectiveWorld.x - centerWorld.x);
			const endWorld = vec(
				centerWorld.x + radius * Math.cos(worldAngle),
				centerWorld.y + radius * Math.sin(worldAngle)
			);
			const sEnd = ctx.viewport.worldToScreen(endWorld.x, endWorld.y);

			let sweepAngle = 0;
			if (clockwise) {
				sweepAngle = (acur - as) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			} else {
				sweepAngle = (as - acur) % TWO_PI;
				if (sweepAngle < 0) sweepAngle += TWO_PI;
			}

			this.ctx.renderer.renderArcPreview(
				sCenter,
				sStart,
				sEnd,
				sr,
				clockwise,
				radius,
				sweepAngle,
				ctx.isConstruction
			);
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.centerId = null;
			this.centerWorldPos = null;
			this.arcPoint1Id = null;
			this.arcPoint1WorldPos = null;
			this.arcCenterPrevAngle = null;
			this.arcCenterTotalAngle = 0;
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

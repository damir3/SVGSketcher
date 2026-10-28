import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import { renderEllipseMajorAxisPreviewVisual, renderEllipsePreviewVisual } from '../../previewHelpers';

export class EllipseTool extends BaseTool {
	readonly id = 'ellipse' as const;

	private drawingStep: 0 | 1 | 2 = 0;
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;
	private majPtId: string | null = null;
	private majWorldPos: Vec2 | null = null;

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
			if (dist(centerWorld, effectiveWorld) < 2) {
				return;
			}

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
			} else {
				const pt = sketch.addPoint(minX, minY);
				p2Id = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			sketch.addEllipse(
				this.centerId!,
				this.majPtId!,
				p2Id,
				this.ctx.isConstructionMode
			);
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
			this.ctx.showToast('Ellipse created');
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
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

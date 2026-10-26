import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';

export class CircleTool extends BaseTool {
	readonly id = 'circle' as const;

	private drawingStep: 0 | 1 = 0;
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			let pId: string;
			if (snap && snap.type === 'point' && snap.id) {
				pId = snap.id;
				this.centerWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				pId = pt.id;
				this.centerWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerId = pId;
			this.drawingStep = 1;
		} else {
			const curPos = snap ? snap.worldPos : world;
			const radius = Math.max(5, dist(this.centerWorldPos!, curPos));
			sketch.addCircle(this.centerId!, radius, this.ctx.isConstructionMode);
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = e.snap ? e.snap.worldPos : e.world;
			const s1 = this.ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			this.ctx.renderer.renderCirclePreview(s1, s2, radius, this.ctx.isConstructionMode, false);
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			this.ctx.renderer.renderCirclePreview(s1, s2, radius, ctx.isConstruction, false);
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.centerId = null;
			this.centerWorldPos = null;
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

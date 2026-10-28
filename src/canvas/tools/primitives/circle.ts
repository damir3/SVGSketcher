import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import { createSvgCircle, createSvgLine, renderTooltip } from '../../svg';
import { getPreviewStrokeAttrs, AUX_RAY_ATTRS } from '../../styles';

export class CircleTool extends BaseTool {
	readonly id = 'circle' as const;

	private drawingStep: 0 | 1 = 0;
	private centerId: string | null = null;
	private centerWorldPos: Vec2 | null = null;

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

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = this.shouldSnap() && ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s1 = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const radius = dist(this.centerWorldPos, effectiveWorld);
			const rPx = Math.hypot(s2.x - s1.x, s2.y - s1.y);

			createSvgCircle(s1.x, s1.y, rPx, getPreviewStrokeAttrs(ctx.isConstruction, false), ctx.targetGroup);
			createSvgLine(s1.x, s1.y, s2.x, s2.y, AUX_RAY_ATTRS, ctx.targetGroup);
			renderTooltip(ctx.targetGroup, s2.x + 12, s2.y - 12, `R ${radius.toFixed(1)} mm`);
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

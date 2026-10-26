import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import {
	getAllGeoCurves,
	getTrimCandidate,
	executeBreak,
} from '../../../math/intersection';
import { renderBreakPreviewVisual } from '../../previewHelpers';

export class BreakTool extends BaseTool {
	readonly id = 'break' as const;

	override onMouseDown(e: ToolMouseEvent): void {
		const target = this.ctx.findTrimTarget?.(e.screen, 18);
		if (!target) return;

		const allCurves = getAllGeoCurves(this.ctx.sketch);
		const candidate = getTrimCandidate(target, allCurves, e.world);
		if (!candidate || candidate.isWholeEntity) return;

		this.ctx.sketch.beginTransaction();
		executeBreak(this.ctx.sketch, candidate);
		this.ctx.sketch.commitTransaction();
		this.ctx.showToast('Broken');
		this.ctx.requestRender();
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const target = this.ctx.findTrimTarget?.(ctx.cursorScreen, 18);
		if (target) {
			const allCurves = getAllGeoCurves(this.ctx.sketch);
			const candidate = getTrimCandidate(target, allCurves, ctx.cursorWorld);
			if (candidate) {
				renderBreakPreviewVisual(ctx.targetGroup, candidate, ctx.viewport);
			}
		}
	}

	override cancel(): void {
		this.ctx.renderer.clearPreviews();
	}
}

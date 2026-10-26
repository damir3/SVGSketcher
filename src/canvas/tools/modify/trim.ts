import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import {
	getAllGeoCurves,
	getTrimCandidate,
	executeTrim,
} from '../../../math/intersection';
import { renderTrimPreviewVisual } from '../../previewHelpers';

export class TrimTool extends BaseTool {
	readonly id = 'trim' as const;

	override onMouseDown(e: ToolMouseEvent): void {
		const target = this.ctx.findTrimTarget?.(e.screen, 18);
		if (!target) return;

		const allCurves = getAllGeoCurves(this.ctx.sketch);
		const candidate = getTrimCandidate(target, allCurves, e.world);
		if (!candidate) return;

		this.ctx.sketch.beginTransaction();
		executeTrim(this.ctx.sketch, candidate);
		this.ctx.sketch.commitTransaction();
		this.ctx.showToast('Trimmed');
		this.ctx.requestRender();
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const target = this.ctx.findTrimTarget?.(ctx.cursorScreen, 18);
		if (target) {
			const allCurves = getAllGeoCurves(this.ctx.sketch);
			const candidate = getTrimCandidate(target, allCurves, ctx.cursorWorld);
			if (candidate) {
				renderTrimPreviewVisual(ctx.targetGroup, candidate, ctx.viewport);
			}
		}
	}

	override cancel(): void {
		this.ctx.renderer.clearPreviews();
	}
}

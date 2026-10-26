import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import {
	getAllGeoCurves,
	getTrimCandidate,
	executeTrim,
} from '../../../math/intersection';

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

		// Refresh preview under current cursor
		const newCurves = getAllGeoCurves(this.ctx.sketch);
		const newTarget = this.ctx.findTrimTarget?.(e.screen, 18);
		if (newTarget) {
			const newCand = getTrimCandidate(newTarget, newCurves, e.world);
			if (newCand) {
				this.ctx.renderer.renderTrimPreview(newCand, this.ctx.viewport);
			} else {
				this.ctx.renderer.clearPreviews();
			}
		} else {
			this.ctx.renderer.clearPreviews();
		}
		this.ctx.requestRender();
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const target = this.ctx.findTrimTarget?.(e.screen, 18);
		if (target) {
			const allCurves = getAllGeoCurves(this.ctx.sketch);
			const candidate = getTrimCandidate(target, allCurves, e.world);
			if (candidate) {
				this.ctx.renderer.renderTrimPreview(candidate, this.ctx.viewport);
				return;
			}
		}
		this.ctx.renderer.clearPreviews();
	}

	override cancel(): void {
		this.ctx.renderer.clearPreviews();
	}
}

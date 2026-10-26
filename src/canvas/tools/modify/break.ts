import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import {
	getAllGeoCurves,
	getTrimCandidate,
	executeBreak,
} from '../../../math/intersection';

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

		// Refresh preview under current cursor
		const newCurves = getAllGeoCurves(this.ctx.sketch);
		const newTarget = this.ctx.findTrimTarget?.(e.screen, 18);
		if (newTarget) {
			const newCand = getTrimCandidate(newTarget, newCurves, e.world);
			if (newCand) {
				this.ctx.renderer.renderBreakPreview(newCand, this.ctx.viewport);
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
				this.ctx.renderer.renderBreakPreview(candidate, this.ctx.viewport);
				return;
			}
		}
		this.ctx.renderer.clearPreviews();
	}

	override cancel(): void {
		this.ctx.renderer.clearPreviews();
	}
}

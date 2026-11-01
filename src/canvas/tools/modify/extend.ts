import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { getAllGeoCurves } from '../../../math/intersection';
import {
	findExtendTarget,
	findExtendCandidate,
	executeExtend,
} from '../../../math/extend';
import { renderExtendPreviewVisual } from '../../previewHelpers';
import type { HoverTarget } from '../hoverTarget';

export class ExtendTool extends BaseTool {
	readonly id = 'extend' as const;

	override isHighlightEnabled(): boolean {
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'line') {
			const line = this.ctx.sketch.lines.get(target.id);
			if (!line || line.isSplineHandle) return false;
			return true;
		}
		if (target.type === 'arc' || target.type === 'elliptical_arc') {
			return true;
		}
		if (target.type === 'spline') {
			const spline = this.ctx.sketch.splines.get(target.id);
			if (!spline || (spline.isClosed && spline.splineType !== 'control')) return false;
			return true;
		}
		return false;
	}

	override getHighlightClass(): string {
		return 'select-hover';
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const target = findExtendTarget(this.ctx, e.screen, 18);
		if (!target) return;

		const allCurves = getAllGeoCurves(this.ctx.sketch);
		const candidate = findExtendCandidate(this.ctx.sketch, target, allCurves, e.world);
		if (!candidate) return;

		this.ctx.sketch.beginTransaction();
		const res = executeExtend(this.ctx.sketch, candidate);
		if (res) {
			this.ctx.sketch.commitTransaction();
			this.ctx.showToast('Extended');
			this.ctx.requestRender();
		} else {
			this.ctx.sketch.rollbackTransaction();
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const target = findExtendTarget(this.ctx, ctx.cursorScreen, 18);
		if (target) {
			const allCurves = getAllGeoCurves(this.ctx.sketch);
			const candidate = findExtendCandidate(this.ctx.sketch, target, allCurves, ctx.cursorWorld);
			if (candidate) {
				renderExtendPreviewVisual(ctx.targetGroup, candidate, ctx.viewport);
			}
		}
	}

	override cancel(): void {
		this.ctx.renderer.clearPreviews();
	}
}

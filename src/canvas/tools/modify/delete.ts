import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import { findHoverTarget, type HoverTarget, type FindHoverTargetOptions } from '../hoverTarget';

export type DeleteTarget = HoverTarget;

export class DeleteTool extends BaseTool {
	readonly id = 'delete' as const;

	override shouldSnap(): boolean {
		return false;
	}

	override isHighlightEnabled(): boolean {
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		return target.id !== 'origin' && target.id !== 'axis_x' && target.id !== 'axis_y';
	}

	override getHighlightClass(_target: HoverTarget): string {
		return 'delete-hover';
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: false };
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const target =
			this.ctx?.highlightManager?.getHoveredTarget() ??
			findHoverTarget(this.ctx, e.screen, e.raw?.target as SVGElement, this.getHoverTargetOptions());
		if (!target) return;
		if (target.id === 'origin' || target.id === 'axis_x' || target.id === 'axis_y') return;

		this.ctx?.highlightManager?.clear();
		this.ctx.sketch.beginTransaction();
		this.ctx.sketch.removeEntity(target.id);
		this.ctx.sketch.commitTransaction();
		this.ctx.showToast('Deleted');
		this.ctx.requestRender();
	}

	override cancel(): void {
		this.ctx?.highlightManager?.clear();
		this.ctx.renderer.clearPreviews();
	}
}

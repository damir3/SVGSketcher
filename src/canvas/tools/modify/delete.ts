import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import type { Vec2 } from '../../../math/vector';
import { findHoverTarget, type HoverTarget } from '../hoverTarget';

export type DeleteTarget = HoverTarget;

export class DeleteTool extends BaseTool {
	readonly id = 'delete' as const;
	private hoveredId: string | null = null;

	override shouldSnap(): boolean {
		return false;
	}

	findTarget(screen: Vec2, rawTarget?: SVGElement): DeleteTarget | null {
		return findHoverTarget(this.ctx, screen, rawTarget, { allowSplineHandles: false });
	}

	clearHover(): void {
		this.updateHoverHighlight(null);
	}

	private updateHoverHighlight(targetId: string | null): void {
		if (this.hoveredId === targetId) return;
		if (this.ctx.svg && typeof this.ctx.svg.querySelectorAll === 'function') {
			if (this.hoveredId) {
				for (const el of Array.from(this.ctx.svg.querySelectorAll(`[data-id="${this.hoveredId}"]`))) {
					el.classList?.remove?.('delete-hover');
				}
			}
			if (targetId) {
				for (const el of Array.from(this.ctx.svg.querySelectorAll(`[data-id="${targetId}"]`))) {
					el.classList?.add?.('delete-hover');
				}
			}
		}
		this.hoveredId = targetId;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const target = this.findTarget(e.screen, e.raw.target as SVGElement);
		if (!target) return;

		this.updateHoverHighlight(null);
		this.ctx.sketch.beginTransaction();
		this.ctx.sketch.removeEntity(target.id);
		this.ctx.sketch.commitTransaction();
		this.ctx.showToast('Deleted');
		this.ctx.requestRender();
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const target = this.findTarget(ctx.cursorScreen);
		this.updateHoverHighlight(target?.id ?? null);
	}

	override cancel(): void {
		this.updateHoverHighlight(null);
		this.ctx.renderer.clearPreviews();
	}
}

import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import { findHoverTarget, type HoverTarget } from '../hoverTarget';
import type { Vec2 } from '../../../math/vector';

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';
	private hoveredId: string | null = null;

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
	}

	override deactivate(): void {
		this.clearHover();
		super.deactivate();
	}

	override cancel(): void {
		this.clearHover();
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	clearHover(): void {
		this.updateHoverHighlight(null);
	}

	getHoveredId(): string | null {
		return this.hoveredId;
	}

	findTarget(screen: Vec2, rawTarget?: SVGElement): HoverTarget | null {
		return findHoverTarget(this.ctx, screen, rawTarget, { allowSplineHandles: true });
	}

	updateHoverHighlight(targetId: string | null): void {
		if (this.hoveredId === targetId) return;
		if (this.ctx.svg && typeof this.ctx.svg.querySelectorAll === 'function') {
			if (this.hoveredId) {
				for (const el of Array.from(this.ctx.svg.querySelectorAll(`[data-id="${this.hoveredId}"]`))) {
					el.classList?.remove?.('select-hover');
				}
			}
			if (targetId) {
				for (const el of Array.from(this.ctx.svg.querySelectorAll(`[data-id="${targetId}"]`))) {
					el.classList?.add?.('select-hover');
				}
			}
		}
		this.hoveredId = targetId;
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const target = this.findTarget(e.screen, e.raw?.target as SVGElement);
		this.updateHoverHighlight(target?.id ?? null);
	}
}


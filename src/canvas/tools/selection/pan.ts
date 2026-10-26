import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import type { Vec2 } from '../../../math/vector';

export class PanTool extends BaseTool {
	readonly id = 'pan' as const;
	override readonly defaultCursor = 'grab';

	private isPanning = false;
	private lastMouseScreen: Vec2 = { x: 0, y: 0 };

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.isPanning = false;
	}

	override deactivate(): void {
		this.isPanning = false;
	}

	override isBusy(): boolean {
		return this.isPanning;
	}

	override cancel(): void {
		this.isPanning = false;
		this.ctx.setCursor(this.defaultCursor);
	}

	override onMouseDown(e: ToolMouseEvent): boolean {
		this.isPanning = true;
		this.lastMouseScreen = e.screen;
		this.ctx.setCursor('grabbing');
		return true;
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.isPanning) {
			const dx = e.screen.x - this.lastMouseScreen.x;
			const dy = e.screen.y - this.lastMouseScreen.y;
			this.ctx.viewport.pan(dx, dy);
			this.lastMouseScreen = e.screen;
			this.ctx.requestRender();
		}
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		if (this.isPanning) {
			this.isPanning = false;
			this.ctx.setCursor(this.defaultCursor);
		}
	}
}

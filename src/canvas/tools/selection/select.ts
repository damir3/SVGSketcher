import { BaseTool } from '../base';
import type { ToolContext } from '../types';

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}
}

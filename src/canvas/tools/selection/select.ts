import { BaseTool } from '../base';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';

	override isHighlightEnabled(): boolean {
		return true;
	}

	override getHighlightClass(_target: HoverTarget): string {
		return 'select-hover';
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: true };
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}
}

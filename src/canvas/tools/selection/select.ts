import { BaseTool } from '../base';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';

	override isHighlightEnabled(): boolean {
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		return target.id !== 'origin' && target.id !== 'axis_x' && target.id !== 'axis_y';
	}

	override getHighlightClass(_target: HoverTarget): string {
		return 'select-hover';
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: true, allowAxes: false, allowOrigin: false };
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}
}

import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';

export class PointTool extends BaseTool {
	readonly id = 'point' as const;

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const finalPos = e.snap?.worldPos ?? e.world;

		sketch.beginTransaction();
		const pt = sketch.addPoint(finalPos);
		this.ctx.applySnapConstraintIfNeeded?.(pt.id, e.snap);
		sketch.commitTransaction();

		this.ctx.requestRender();
	}
}

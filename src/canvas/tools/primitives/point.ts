import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';

export class PointTool extends BaseTool {
	readonly id = 'point' as const;

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const finalX = e.snap ? e.snap.worldPos.x : e.world.x;
		const finalY = e.snap ? e.snap.worldPos.y : e.world.y;

		sketch.beginTransaction();
		const pt = sketch.addPoint(finalX, finalY);
		this.ctx.applySnapConstraintIfNeeded?.(pt.id, e.snap);
		sketch.commitTransaction();

		this.ctx.requestRender();
	}
}

import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import type { Vec2 } from '../../../math/vector';
import { createSvgRect, renderTooltip } from '../../svg';
import { getPreviewStrokeAttrs } from '../../styles';

export class RectangleTool extends BaseTool {
	readonly id = 'rectangle' as const;

	private drawingStep: 0 | 1 = 0;
	private startWorldPos: Vec2 | null = null;
	private startSnapLineId: string | null = null;
	private startSnapCircleId: string | null = null;

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			this.startWorldPos = snap ? snap.worldPos : world;
			this.startSnapLineId = snap && snap.type === 'line' ? snap.lineId ?? null : null;
			this.startSnapCircleId = snap && snap.type === 'circle' ? snap.circleId ?? null : null;
			this.drawingStep = 1;
		} else {
			const c1 = this.startWorldPos!;
			const c2 = snap ? snap.worldPos : world;

			sketch.beginTransaction();

			// Create 4 corners
			const p0 = sketch.addPoint(c1.x, c1.y);
			const p1 = sketch.addPoint(c2.x, c1.y);
			const p2 = sketch.addPoint(c2.x, c2.y);
			const p3 = sketch.addPoint(c1.x, c2.y);

			if (this.startSnapLineId) {
				sketch.addPointOnLineConstraint(p0.id, this.startSnapLineId);
			} else if (this.startSnapCircleId) {
				sketch.addPointOnCircleConstraint(p0.id, this.startSnapCircleId);
			}
			if (snap && snap.type === 'line' && snap.lineId) {
				sketch.addPointOnLineConstraint(p2.id, snap.lineId);
			} else if (snap && snap.type === 'circle' && snap.circleId) {
				sketch.addPointOnCircleConstraint(p2.id, snap.circleId);
			}
			this.startSnapLineId = null;
			this.startSnapCircleId = null;

			// Create 4 lines
			sketch.addLine(p0.id, p1.id, this.ctx.isConstructionMode);
			sketch.addLine(p1.id, p2.id, this.ctx.isConstructionMode);
			sketch.addLine(p2.id, p3.id, this.ctx.isConstructionMode);
			sketch.addLine(p3.id, p0.id, this.ctx.isConstructionMode);

			// Add standard rectangular constraints
			sketch.addHorizontalConstraint(p0.id, p1.id);
			sketch.addVerticalConstraint(p1.id, p2.id);
			sketch.addHorizontalConstraint(p3.id, p2.id);
			sketch.addVerticalConstraint(p0.id, p3.id);

			sketch.commitTransaction();

			this.cancel();
			this.ctx.requestRender();
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.startWorldPos) {
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const w = Math.abs(effectiveWorld.x - this.startWorldPos.x);
			const h = Math.abs(effectiveWorld.y - this.startWorldPos.y);

			const rx = Math.min(s1.x, s2.x);
			const ry = Math.min(s1.y, s2.y);
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			createSvgRect(rx, ry, rw, rh, getPreviewStrokeAttrs(ctx.isConstruction), ctx.targetGroup);
			renderTooltip(ctx.targetGroup, s2.x + 12, s2.y - 12, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.drawingStep = 0;
			this.startWorldPos = null;
			this.startSnapLineId = null;
			this.startSnapCircleId = null;
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

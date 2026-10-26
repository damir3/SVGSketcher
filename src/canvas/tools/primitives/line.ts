import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';

export class LineTool extends BaseTool {
	readonly id = 'line' as const;

	private drawingStep: 0 | 1 = 0;
	private startPointId: string | null = null;
	private startWorldPos: Vec2 | null = null;

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			// Step 1: Start Point
			let pId: string;
			if (snap && snap.type === 'point' && snap.id) {
				pId = snap.id;
				this.startWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				pId = pt.id;
				this.startWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.startPointId = pId;
			this.drawingStep = 1;
		} else {
			// Step 2: End Point
			let p2Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
				p2Id = snap.id;
			} else {
				let ptPos = snap ? snap.worldPos : world;
				if (this.startWorldPos && this.ctx.getAxisSnappedWorldPos) {
					const axisSnap = this.ctx.getAxisSnappedWorldPos(this.startWorldPos, ptPos, snap);
					ptPos = axisSnap.pos;
				}
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				p2Id = pt.id;
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}

			sketch.addLine(this.startPointId!, p2Id, this.ctx.isConstructionMode);
			this.ctx.applyAutoOrientationConstraint?.(this.startPointId!, p2Id);
			sketch.commitTransaction();

			const hitPrimitive =
				snap !== null &&
				((snap.type === 'point' && snap.id !== undefined && snap.id !== this.startPointId) ||
					snap.type === 'line' ||
					snap.type === 'circle');

			if (hitPrimitive) {
				this.drawingStep = 0;
				this.startPointId = null;
				this.startWorldPos = null;
				this.ctx.renderer.clearPreviews();
			} else {
				// Chain to next line
				sketch.beginTransaction();
				this.startPointId = p2Id;
				const p2 = sketch.getPoint(p2Id);
				this.startWorldPos = p2 ? vec(p2.x, p2.y) : (snap ? snap.worldPos : world);
			}
			this.ctx.requestRender();
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 1 && this.startWorldPos) {
			const s1 = this.ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
			let effectiveWorld = e.effectiveWorld;
			let axisBadge: 'H' | 'V' | undefined;

			if (this.ctx.getAxisSnappedWorldPos) {
				const axisSnap = this.ctx.getAxisSnappedWorldPos(this.startWorldPos, effectiveWorld, e.snap);
				effectiveWorld = axisSnap.pos;
				axisBadge = axisSnap.axis === 'horizontal' ? 'H' : axisSnap.axis === 'vertical' ? 'V' : undefined;
			}
			const s2 = this.ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			const length = dist(this.startWorldPos, effectiveWorld);
			const angleDeg =
				(Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
				Math.PI;

			this.ctx.renderer.renderLinePreview(s1, s2, length, angleDeg, this.ctx.isConstructionMode, axisBadge);
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.startWorldPos) {
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
			let effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			let axisBadge: 'H' | 'V' | undefined;

			if (this.ctx.getAxisSnappedWorldPos) {
				const axisSnap = this.ctx.getAxisSnappedWorldPos(this.startWorldPos, effectiveWorld, ctx.snap);
				effectiveWorld = axisSnap.pos;
				axisBadge = axisSnap.axis === 'horizontal' ? 'H' : axisSnap.axis === 'vertical' ? 'V' : undefined;
			}
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);

			const length = dist(this.startWorldPos, effectiveWorld);
			const angleDeg =
				(Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
				Math.PI;

			this.ctx.renderer.renderLinePreview(s1, s2, length, angleDeg, ctx.isConstruction, axisBadge);
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.startPointId = null;
			this.startWorldPos = null;
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

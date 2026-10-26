import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, getCircumcircle, type Vec2 } from '../../../math/vector';
import { renderLinePreviewVisual, renderArcPreviewVisual } from '../../previewHelpers';

const TWO_PI = 2 * Math.PI;

export class ArcTool extends BaseTool {
	readonly id = 'arc' as const;

	private drawingStep: 0 | 1 | 2 = 0;
	private startPointId: string | null = null;
	private startWorldPos: Vec2 | null = null;
	private arcPoint2Id: string | null = null;
	private arcPoint2WorldPos: Vec2 | null = null;

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
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
			this.ctx.requestRender();
		} else if (this.drawingStep === 1) {
			const p1World = this.startWorldPos!;
			const effectiveWorld = snap ? snap.worldPos : world;
			if (dist(p1World, effectiveWorld) < 2) {
				return;
			}

			let p2Id: string;
			if (snap && snap.type === 'point' && snap.id && snap.id !== this.startPointId) {
				p2Id = snap.id;
				this.arcPoint2WorldPos = snap.worldPos;
			} else {
				const pt = sketch.addPoint(effectiveWorld.x, effectiveWorld.y);
				p2Id = pt.id;
				this.arcPoint2WorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.arcPoint2Id = p2Id;
			this.drawingStep = 2;
			this.ctx.requestRender();
		} else if (this.drawingStep === 2) {
			const p1 = this.startWorldPos!;
			const p2 = this.arcPoint2WorldPos!;
			const p3 = snap ? snap.worldPos : world;

			const circum = getCircumcircle(p1, p2, p3);
			if (!circum || circum.radius < 1 || circum.radius > 50000) {
				this.ctx.showToast('Cannot form arc from collinear points');
				return;
			}

			const s1 = this.ctx.viewport.worldToScreen(p1.x, p1.y);
			const s2 = this.ctx.viewport.worldToScreen(p2.x, p2.y);
			const s3 = this.ctx.viewport.worldToScreen(p3.x, p3.y);
			const sc = this.ctx.viewport.worldToScreen(circum.center.x, circum.center.y);

			const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
			const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
			const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

			let sweepCW = (ae - as) % TWO_PI;
			if (sweepCW < 0) sweepCW += TWO_PI;
			let testCW = (a3 - as) % TWO_PI;
			if (testCW < 0) testCW += TWO_PI;

			const clockwise = testCW > 0 && testCW < sweepCW;

			const centerPt = sketch.addPoint(circum.center.x, circum.center.y);
			sketch.addArc(
				centerPt.id,
				this.startPointId!,
				this.arcPoint2Id!,
				circum.radius,
				clockwise,
				this.ctx.isConstructionMode
			);
			sketch.commitTransaction();
			this.cancel();
			this.ctx.requestRender();
			this.ctx.showToast('3-point arc created');
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.startWorldPos) {
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);
			const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const s2 = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
			const length = dist(this.startWorldPos, effectiveWorld);
			const angleDeg =
				(Math.atan2(effectiveWorld.y - this.startWorldPos.y, effectiveWorld.x - this.startWorldPos.x) * 180) /
				Math.PI;
			renderLinePreviewVisual(ctx.targetGroup, s1, s2, length, angleDeg, ctx.isConstruction);
		} else if (this.drawingStep === 2 && this.startWorldPos && this.arcPoint2WorldPos) {
			const p1 = this.startWorldPos;
			const p2 = this.arcPoint2WorldPos;
			const p3 = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
			const circum = getCircumcircle(p1, p2, p3);

			const s1 = ctx.viewport.worldToScreen(p1.x, p1.y);
			const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);

			if (!circum || circum.radius < 1 || circum.radius > 50000) {
				const length = dist(p1, p2);
				const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
				renderLinePreviewVisual(ctx.targetGroup, s1, s2, length, angleDeg, ctx.isConstruction);
			} else {
				const sc = ctx.viewport.worldToScreen(circum.center.x, circum.center.y);
				const s3 = ctx.viewport.worldToScreen(p3.x, p3.y);
				const sr = circum.radius * ctx.viewport.zoom;

				const as = Math.atan2(s1.y - sc.y, s1.x - sc.x);
				const ae = Math.atan2(s2.y - sc.y, s2.x - sc.x);
				const a3 = Math.atan2(s3.y - sc.y, s3.x - sc.x);

				let sweepCW = (ae - as) % TWO_PI;
				if (sweepCW < 0) sweepCW += TWO_PI;
				let testCW = (a3 - as) % TWO_PI;
				if (testCW < 0) testCW += TWO_PI;

				const clockwise = testCW > 0 && testCW < sweepCW;
				renderArcPreviewVisual(
					ctx.targetGroup,
					sc,
					s1,
					s2,
					sr,
					clockwise,
					circum.radius,
					undefined,
					ctx.isConstruction
				);
			}
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.startPointId = null;
			this.startWorldPos = null;
			this.arcPoint2Id = null;
			this.arcPoint2WorldPos = null;
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}
}

import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import { PolygonPopup } from '../../../ui/polygon-popup';
import type { SketchPoint, SketchLine } from '../../../model/types';
import type { PatternCopyData, PointToLineDistanceConstraint } from '../../../solver/constraints';
import { createSvgCircle, createSvgLine, createSvgPath } from '../../svg';
import {
	GUIDE_OUTLINE_ATTRS,
	AUX_RAY_ATTRS,
	POLYGON_VERTEX_ATTRS,
	POLYGON_CENTER_ATTRS,
	POLYGON_RADIUS_HANDLE_ATTRS,
	getPreviewStrokeAttrs,
} from '../../styles';

export class PolygonTool extends BaseTool {
	readonly id = 'polygon' as const;

	readonly popup: PolygonPopup;
	sides = 6;
	radius = 50;
	radiusLocked = false;
	currentAngle = 0;

	drawingStep: 0 | 1 = 0;
	centerPtId: string | null = null;
	centerWorldPos: Vec2 | null = null;

	constructor() {
		super();
		this.popup = new PolygonPopup();
		this.popup.onValuesChange = (sides, radius, isRadiusChanged) => {
			this.sides = sides;
			if (isRadiusChanged) {
				this.radius = radius;
				this.radiusLocked = true;
			}
			if (this.drawingStep === 1 && this.centerWorldPos) {
				this.ctx.requestRender();
			}
		};
		this.popup.onCommit = () => {
			if (this.drawingStep === 1 && this.centerPtId) {
				const hasRadiusConstraint = this.radiusLocked || this.popup.isRadiusLocked();
				this.commitPolygon(
					this.centerPtId,
					this.sides,
					this.radius,
					this.currentAngle,
					hasRadiusConstraint
				);
			}
		};
		this.popup.onCancel = () => {
			this.cancel();
			this.ctx.setTool('select');
			this.ctx.requestRender();
		};
	}

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.ctx.showToast('Polygon: Click center point');
	}

	override deactivate(): void {
		this.popup.hide();
		super.deactivate();
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			sketch.beginTransaction();
			let cId: string;
			if (snap && snap.type === 'point' && snap.id) {
				cId = snap.id;
				this.centerWorldPos = snap.worldPos;
			} else {
				const ptPos = snap ? snap.worldPos : world;
				const pt = sketch.addPoint(ptPos.x, ptPos.y);
				cId = pt.id;
				this.centerWorldPos = vec(pt.x, pt.y);
				this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
			}
			this.centerPtId = cId;
			this.radiusLocked = false;
			this.currentAngle = 0;
			this.drawingStep = 1;

			const sCtr = this.ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			this.popup.show(sCtr, this.sides, 50);
			this.ctx.requestRender();
		} else {
			const curPos = snap ? snap.worldPos : world;
			const currentDist = dist(this.centerWorldPos!, curPos);
			const radius = this.radiusLocked ? this.radius : Math.max(1, currentDist);
			const angleRad = Math.atan2(
				curPos.y - this.centerWorldPos!.y,
				curPos.x - this.centerWorldPos!.x
			);
			this.commitPolygon(
				this.centerPtId!,
				this.sides,
				radius,
				angleRad,
				this.radiusLocked
			);
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const effectiveWorld = e.effectiveWorld;
			const s1 = this.ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);

			if (!this.radiusLocked) {
				this.radius = Math.max(1, dist(this.centerWorldPos, effectiveWorld));
				this.popup.updateRadius(this.radius);
			}
			this.currentAngle = Math.atan2(
				effectiveWorld.y - this.centerWorldPos.y,
				effectiveWorld.x - this.centerWorldPos.x
			);

			if (this.popup.isOpen()) {
				this.popup.updatePosition(s1);
			}
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 1 && this.centerWorldPos) {
			const sCtr = ctx.viewport.worldToScreen(this.centerWorldPos.x, this.centerWorldPos.y);
			const N = Math.max(3, Math.round(this.sides));
			const R = this.radius / Math.cos(Math.PI / N);
			const sInradius = this.radius * ctx.viewport.zoom;

			// 1. Inscribed guide circle
			createSvgCircle(sCtr.x, sCtr.y, sInradius, GUIDE_OUTLINE_ATTRS, ctx.targetGroup);

			// 2. Auxiliary ray from center to current point
			const midWorld: Vec2 = {
				x: this.centerWorldPos.x + this.radius * Math.cos(this.currentAngle),
				y: this.centerWorldPos.y + this.radius * Math.sin(this.currentAngle),
			};
			const midScreen = ctx.viewport.worldToScreen(midWorld.x, midWorld.y);
			createSvgLine(sCtr.x, sCtr.y, midScreen.x, midScreen.y, AUX_RAY_ATTRS, ctx.targetGroup);

			// 3. Polygon vertices in world coordinates, transformed to screen
			const baseAngle = this.currentAngle - Math.PI / N;
			const step = (2 * Math.PI) / N;
			const pts: Vec2[] = [];
			for (let i = 0; i < N; i++) {
				const a = baseAngle + i * step;
				const wx = this.centerWorldPos.x + R * Math.cos(a);
				const wy = this.centerWorldPos.y + R * Math.sin(a);
				pts.push(ctx.viewport.worldToScreen(wx, wy));
			}

			// 4. Polygon outline path
			if (pts.length >= 3) {
				let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
				for (let i = 1; i < pts.length; i++) {
					d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
				}
				d += ' Z';
				createSvgPath(d, getPreviewStrokeAttrs(ctx.isConstruction), ctx.targetGroup);
			}

			// 5. Draw vertex dots
			for (const pt of pts) {
				createSvgCircle(pt.x, pt.y, 2.5, POLYGON_VERTEX_ATTRS, ctx.targetGroup);
			}

			// 6. Center marker
			createSvgCircle(sCtr.x, sCtr.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

			// 7. Midpoint marker on incircle
			createSvgCircle(midScreen.x, midScreen.y, 2.5, POLYGON_RADIUS_HANDLE_ATTRS, ctx.targetGroup);
		}
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab') {
			if (this.drawingStep === 1 && this.popup.isOpen()) {
				e.preventDefault();
				this.popup.cycleFocus(e.shiftKey);
				return true;
			}
		} else if (e.key === 'Enter') {
			if (this.drawingStep === 1 && this.centerPtId) {
				e.preventDefault();
				const hasRadiusConstraint = this.radiusLocked || this.popup.isRadiusLocked();
				this.commitPolygon(
					this.centerPtId,
					this.sides,
					this.radius,
					this.currentAngle,
					hasRadiusConstraint
				);
				return true;
			}
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx.sketch.rollbackTransaction();
			this.drawingStep = 0;
			this.centerPtId = null;
			this.centerWorldPos = null;
			this.radiusLocked = false;
			this.popup.hide();
			this.ctx.renderer.clearPreviews();
			this.ctx.requestRender();
		}
	}

	private commitPolygon(
		centerPtId: string,
		sides: number,
		inradius: number,
		angleRad: number,
		addDistanceConstraint = false
	): void {
		const N = Math.max(3, Math.round(sides));
		const r = Math.max(0.1, inradius);
		const centerPt = this.ctx.sketch.points.get(centerPtId);
		if (!centerPt) {
			this.cancel();
			return;
		}

		const R = r / Math.cos(Math.PI / N);
		const baseAngle = angleRad - Math.PI / N;
		const step = (2 * Math.PI) / N;

		const vertices: SketchPoint[] = [];
		for (let k = 0; k < N; k++) {
			const a = baseAngle + k * step;
			const vx = centerPt.x + R * Math.cos(a);
			const vy = centerPt.y + R * Math.sin(a);
			const pt = this.ctx.sketch.addPoint(vx, vy, false);
			vertices.push(pt);
		}

		const lines: SketchLine[] = [];
		for (let k = 0; k < N; k++) {
			const nextK = (k + 1) % N;
			const line = this.ctx.sketch.addLine(vertices[k].id, vertices[nextK].id, this.ctx.isConstructionMode);
			lines.push(line);
		}

		const copies: PatternCopyData[] = [];
		for (let k = 1; k < N; k++) {
			copies.push({
				copyIndex: k,
				pointPairs: [{ sourcePtId: vertices[0].id, patternPtId: vertices[k].id }],
				createdEntityIds: [{ id: vertices[k].id, type: 'point' }],
			});
		}

		const constraint = this.ctx.sketch.addCircularPatternConstraint(
			centerPtId,
			[vertices[0].id],
			'full',
			360,
			N,
			false,
			[],
			copies,
			undefined,
			true // isReadOnly
		);

		let distConstraint: PointToLineDistanceConstraint | null = null;
		if (addDistanceConstraint && lines.length > 0) {
			distConstraint = this.ctx.sketch.addPointToLineDistanceConstraint(centerPtId, lines[0].id, r);
		}

		this.ctx.sketch.commitTransaction();
		this.ctx.sketch.solve();

		this.popup.hide();
		this.drawingStep = 0;
		this.centerPtId = null;
		this.centerWorldPos = null;
		this.ctx.renderer.clearPreviews();

		if (distConstraint) {
			this.ctx.sketch.selectEntity(distConstraint.id, 'constraint', false);
		} else if (constraint) {
			this.ctx.sketch.selectEntity(constraint.id, 'constraint', false);
		}

		this.ctx.showToast(`Polygon created (${N} vertices)`);
		this.ctx.requestRender();
	}
}

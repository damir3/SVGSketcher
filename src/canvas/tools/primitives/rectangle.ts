import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext, SnapResult } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import { createSvgCircle, createSvgLine, createSvgPath, createSvgRect } from '../../svg';
import {
	AUX_AXIS_ATTRS,
	POLYGON_CENTER_ATTRS,
	getPreviewStrokeAttrs,
} from '../../styles';
import { RectanglePopup, type RectangleMode } from '../../../ui/rectangle-popup';
export type { RectangleMode };

export class RectangleTool extends BaseTool {
	readonly id = 'rectangle' as const;

	readonly popup: RectanglePopup;
	private _mode: RectangleMode = 'corner';
	private drawingStep: 0 | 1 | 2 = 0;

	private startWorldPos: Vec2 | null = null;
	private secondWorldPos: Vec2 | null = null;
	private lastEffectiveWorld: Vec2 | null = null;
	private startSnap: SnapResult | null = null;
	private secondSnap: SnapResult | null = null;

	width = 50;
	height = 30;
	radius = 0;
	isWidthLocked = false;
	isHeightLocked = false;
	isRadiusLocked = false;

	onModeChange?: (mode: RectangleMode) => void;
	onStateChange?: () => void;

	constructor(initialMode: RectangleMode = 'corner') {
		super();
		this._mode = initialMode;
		this.popup = new RectanglePopup();

		this.popup.onValuesChange = (w, h, r, isWLocked, isHLocked, isRLocked) => {
			this.width = w;
			this.height = h;
			this.radius = r;
			this.isWidthLocked = isWLocked;
			this.isHeightLocked = isHLocked;
			this.isRadiusLocked = isRLocked;
			this.ctx?.requestRender();
		};

		this.popup.onCommit = () => {
			if (this.drawingStep > 0 && this.startWorldPos) {
				this.commitFromCurrentValues();
			}
		};

		this.popup.onCancel = () => {
			this.cancel();
			this.ctx?.setTool('select');
			this.ctx?.requestRender();
		};
	}

	get mode(): RectangleMode {
		return this._mode;
	}

	get step(): number {
		return this.drawingStep;
	}

	setMode(newMode: RectangleMode): void {
		if (this._mode === newMode) return;
		this.cancel();
		this._mode = newMode;
		this.popup.setMode(newMode);
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override isBusy(): boolean {
		return this.drawingStep > 0;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.popup.setMode(this._mode);
		this.updateToastHint();
	}

	override deactivate(): void {
		this.popup.hide();
		this.cancel();
		super.deactivate();
	}

	private updateToastHint(): void {
		if (!this.ctx) return;
		switch (this._mode) {
			case 'corner':
				this.ctx.showToast(this.drawingStep === 0 ? 'Rectangle: Click first corner' : 'Rectangle: Click opposite corner');
				break;
			case 'center':
				this.ctx.showToast(this.drawingStep === 0 ? 'Center Rectangle: Click center point' : 'Center Rectangle: Click corner point');
				break;
			case 'three_point':
				if (this.drawingStep === 0) this.ctx.showToast('3-Point Rectangle: Click first corner');
				else if (this.drawingStep === 1) this.ctx.showToast('3-Point Rectangle: Click second corner (base line)');
				else this.ctx.showToast('3-Point Rectangle: Click to set height');
				break;
			case 'rounded':
				if (this.drawingStep === 0) this.ctx.showToast('Rounded Rectangle: Click first corner');
				else if (this.drawingStep === 1) this.ctx.showToast('Rounded Rectangle: Click opposite corner');
				else this.ctx.showToast('Rounded Rectangle: Pull inward to set corner radius');
				break;
		}
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const snap = e.snap;
		const world = e.world;

		if (this.drawingStep === 0) {
			this.ctx.sketch.beginTransaction();
			this.startWorldPos = snap ? snap.worldPos : world;
			this.startSnap = snap ?? null;

			// Reset locks and initial dimensions for the new rectangle
			this.isWidthLocked = false;
			this.isHeightLocked = false;
			this.isRadiusLocked = false;
			this.width = 0.1;
			this.height = 0.1;
			this.radius = 0;
			this.popup.resetValues(0.1, 0.1, 0);

			this.drawingStep = 1;
			this.popup.show(e.screen, this.width, this.height, this.radius, this._mode);
			this.updateToastHint();
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		if (this.drawingStep === 1) {
			const effectiveWorld = e.effectiveWorld;

			if (this._mode === 'corner') {
				const c2 = this.computeCornerSecondPoint(effectiveWorld);
				this.commitCorner(this.startWorldPos!, c2, snap);
			} else if (this._mode === 'center') {
				const halfDims = this.computeCenterHalfDims(effectiveWorld);
				this.commitCenter(this.startWorldPos!, halfDims.w, halfDims.h, snap, effectiveWorld);
			} else if (this._mode === 'three_point') {
				this.secondWorldPos = this.computeThreePointSecondPoint(effectiveWorld);
				this.secondSnap = snap ?? null;
				this.drawingStep = 2;
				this.updateToastHint();
				this.onStateChange?.();
				this.ctx.requestRender();
			} else if (this._mode === 'rounded') {
				const c2 = this.computeCornerSecondPoint(effectiveWorld);
				this.secondSnap = snap ?? null;
				if (this.isRadiusLocked || this.popup.isRadiusLocked()) {
					this.commitRounded(this.startWorldPos!, c2, this.radius, this.secondSnap);
				} else {
					this.secondWorldPos = c2;
					this.radius = 0;
					this.drawingStep = 2;
					this.popup.updateDimensions(this.width, this.height, 0);
					this.updateToastHint();
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			}
			return;
		}

		if (this.drawingStep === 2) {
			const effectiveWorld = e.effectiveWorld;

			if (this._mode === 'three_point') {
				const p3 = this.computeThreePointHeightPoint(effectiveWorld);
				this.commitThreePoint(this.startWorldPos!, this.secondWorldPos!, p3, snap);
			} else if (this._mode === 'rounded') {
				this.commitRounded(this.startWorldPos!, this.secondWorldPos!, this.radius, this.secondSnap);
			}
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 0 || !this.startWorldPos) return;

		const effectiveWorld = e.effectiveWorld;
		this.lastEffectiveWorld = effectiveWorld;

		if (this._mode === 'corner') {
			const dx = effectiveWorld.x - this.startWorldPos.x;
			const dy = effectiveWorld.y - this.startWorldPos.y;
			if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dx));
			if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dy));
			this.popup.updateDimensions(this.width, this.height);
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'center') {
			const dx = effectiveWorld.x - this.startWorldPos.x;
			const dy = effectiveWorld.y - this.startWorldPos.y;
			if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dx) * 2);
			if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dy) * 2);
			this.popup.updateDimensions(this.width, this.height);
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'three_point') {
			if (this.drawingStep === 1) {
				const d = dist(this.startWorldPos, effectiveWorld);
				if (!this.isWidthLocked) this.width = Math.max(0.1, d);
				this.popup.updateDimensions(this.width, this.height);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const V = vec(this.secondWorldPos.x - this.startWorldPos.x, this.secondWorldPos.y - this.startWorldPos.y);
				const baseLen = Math.hypot(V.x, V.y);
				const n = baseLen > 1e-4 ? vec(-V.y / baseLen, V.x / baseLen) : vec(0, 1);
				const offset = vec(effectiveWorld.x - this.secondWorldPos.x, effectiveWorld.y - this.secondWorldPos.y);
				const proj = offset.x * n.x + offset.y * n.y;
				if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(proj));
				this.popup.updateDimensions(this.width, this.height);
			}
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'rounded') {
			if (this.drawingStep === 1) {
				const dx = effectiveWorld.x - this.startWorldPos.x;
				const dy = effectiveWorld.y - this.startWorldPos.y;
				if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dx));
				if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dy));
				const maxR = Math.max(0.1, Math.min(this.width, this.height) / 2);
				if (!this.isRadiusLocked) {
					this.radius = 0;
				} else {
					this.radius = Math.min(this.radius, maxR);
				}
				this.popup.updateDimensions(this.width, this.height, this.radius);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const c1 = this.startWorldPos;
				const c2 = this.secondWorldPos;
				const minX = Math.min(c1.x, c2.x);
				const maxX = Math.max(c1.x, c2.x);
				const minY = Math.min(c1.y, c2.y);
				const maxY = Math.max(c1.y, c2.y);
				const maxR = Math.min(maxX - minX, maxY - minY) / 2;

				if (!this.isRadiusLocked) {
					const isInside =
						effectiveWorld.x >= minX &&
						effectiveWorld.x <= maxX &&
						effectiveWorld.y >= minY &&
						effectiveWorld.y <= maxY;

					if (!isInside) {
						this.radius = 0;
					} else {
						const inwardSignX = Math.sign(c1.x - c2.x) || 1;
						const inwardSignY = Math.sign(c1.y - c2.y) || 1;
						const pullX = (effectiveWorld.x - c2.x) * inwardSignX;
						const pullY = (effectiveWorld.y - c2.y) * inwardSignY;

						if (pullX <= 0 || pullY <= 0) {
							this.radius = 0;
						} else {
							const pull = Math.min(pullX, pullY);
							this.radius = Math.min(maxR, Math.max(0, pull));
						}
					}
				}
				this.popup.updateDimensions(this.width, this.height, this.radius);
			}
			this.popup.updatePosition(e.screen);
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 0 || !this.startWorldPos) return;

		const effectiveWorld = ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
		const previewAttrs = getPreviewStrokeAttrs(ctx.isConstruction);

		if (this._mode === 'corner') {
			const c1 = this.startWorldPos;
			const c2 = this.computeCornerSecondPoint(effectiveWorld);
			const s1 = ctx.viewport.worldToScreen(c1.x, c1.y);
			const s2 = ctx.viewport.worldToScreen(c2.x, c2.y);

			const rx = Math.min(s1.x, s2.x);
			const ry = Math.min(s1.y, s2.y);
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			createSvgRect(rx, ry, rw, rh, previewAttrs, ctx.targetGroup);
		} else if (this._mode === 'center') {
			const C = this.startWorldPos;
			const halfDims = this.computeCenterHalfDims(effectiveWorld);
			const minX = C.x - halfDims.w;
			const maxX = C.x + halfDims.w;
			const minY = C.y - halfDims.h;
			const maxY = C.y + halfDims.h;

			const s1 = ctx.viewport.worldToScreen(minX, maxY);
			const s2 = ctx.viewport.worldToScreen(maxX, minY);
			const sc = ctx.viewport.worldToScreen(C.x, C.y);

			const rx = Math.min(s1.x, s2.x);
			const ry = Math.min(s1.y, s2.y);
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			createSvgRect(rx, ry, rw, rh, previewAttrs, ctx.targetGroup);
			createSvgLine(s1.x, s1.y, s2.x, s2.y, AUX_AXIS_ATTRS, ctx.targetGroup);
			createSvgLine(s1.x, s2.y, s2.x, s1.y, AUX_AXIS_ATTRS, ctx.targetGroup);
			createSvgCircle(sc.x, sc.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
		} else if (this._mode === 'three_point') {
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos.x, this.startWorldPos.y);

			if (this.drawingStep === 1) {
				const p2 = this.computeThreePointSecondPoint(effectiveWorld);
				const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				createSvgLine(s1.x, s1.y, s2.x, s2.y, previewAttrs, ctx.targetGroup);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const p2 = this.secondWorldPos;
				const p3 = this.computeThreePointHeightPoint(effectiveWorld);
				const V = vec(p2.x - this.startWorldPos.x, p2.y - this.startWorldPos.y);
				const baseLen = Math.hypot(V.x, V.y);
				const n = baseLen > 1e-4 ? vec(-V.y / baseLen, V.x / baseLen) : vec(0, 1);
				const offset = vec(p3.x - p2.x, p3.y - p2.y);
				const hSigned = offset.x * n.x + offset.y * n.y;

				const p0 = this.startWorldPos;
				const p1 = p2;
				const pCorner2 = p3;
				const pCorner3 = vec(p0.x + hSigned * n.x, p0.y + hSigned * n.y);

				const s0 = ctx.viewport.worldToScreen(p0.x, p0.y);
				const sPt1 = ctx.viewport.worldToScreen(p1.x, p1.y);
				const sPt2 = ctx.viewport.worldToScreen(pCorner2.x, pCorner2.y);
				const sPt3 = ctx.viewport.worldToScreen(pCorner3.x, pCorner3.y);

				const pathD = `M ${s0.x.toFixed(1)} ${s0.y.toFixed(1)} L ${sPt1.x.toFixed(1)} ${sPt1.y.toFixed(1)} L ${sPt2.x.toFixed(1)} ${sPt2.y.toFixed(1)} L ${sPt3.x.toFixed(1)} ${sPt3.y.toFixed(1)} Z`;
				createSvgPath(pathD, previewAttrs, ctx.targetGroup);
			}
		} else if (this._mode === 'rounded') {
			const c1 = this.startWorldPos;
			const c2 = this.drawingStep === 2 && this.secondWorldPos ? this.secondWorldPos : this.computeCornerSecondPoint(effectiveWorld);
			const s1 = ctx.viewport.worldToScreen(c1.x, c1.y);
			const s2 = ctx.viewport.worldToScreen(c2.x, c2.y);

			const rx = Math.min(s1.x, s2.x);
			const ry = Math.min(s1.y, s2.y);
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			const maxR = Math.max(0, Math.min(this.width, this.height) / 2);
			const effectiveR = Math.max(0, Math.min(this.radius, maxR));
			const sr = effectiveR * ctx.viewport.zoom;

			createSvgRect(rx, ry, rw, rh, { ...previewAttrs, rx: sr, ry: sr }, ctx.targetGroup);
		}
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab') {
			if (this.drawingStep > 0 && this.popup.isOpen()) {
				e.preventDefault();
				this.popup.cycleFocus(e.shiftKey);
				return true;
			}
		} else if (e.key === 'Enter') {
			if (this.drawingStep > 0 && this.startWorldPos) {
				e.preventDefault();
				this.commitFromCurrentValues();
				return true;
			}
		}
	}

	override cancel(): void {
		if (this.drawingStep > 0) {
			this.ctx?.sketch.rollbackTransaction();
			this.ctx?.renderer.clearPreviews();
			this.ctx?.requestRender();
		}
		this.resetState();
		this.popup.hide();
	}

	private resetState(): void {
		this.drawingStep = 0;
		this.startWorldPos = null;
		this.secondWorldPos = null;
		this.lastEffectiveWorld = null;
		this.startSnap = null;
		this.secondSnap = null;
		this.isWidthLocked = false;
		this.isHeightLocked = false;
		this.isRadiusLocked = false;
		this.width = 50;
		this.height = 30;
		this.radius = 0;
		this.popup.resetValues(50, 30, 0);
		this.updateToastHint();
		this.onStateChange?.();
	}

	// =========================================================================
	// Computations for Points
	// =========================================================================

	private computeCornerSecondPoint(effectiveWorld: Vec2): Vec2 {
		const c1 = this.startWorldPos!;
		const dx = effectiveWorld.x - c1.x;
		const dy = effectiveWorld.y - c1.y;

		const signX = Math.sign(dx) || 1;
		const signY = Math.sign(dy) || 1;

		const c2x = this.isWidthLocked ? c1.x + signX * this.width : effectiveWorld.x;
		const c2y = this.isHeightLocked ? c1.y + signY * this.height : effectiveWorld.y;

		return vec(c2x, c2y);
	}

	private computeCenterHalfDims(effectiveWorld: Vec2): { w: number; h: number } {
		const C = this.startWorldPos!;
		const halfW = this.isWidthLocked ? this.width / 2 : Math.abs(effectiveWorld.x - C.x);
		const halfH = this.isHeightLocked ? this.height / 2 : Math.abs(effectiveWorld.y - C.y);
		return { w: Math.max(0.05, halfW), h: Math.max(0.05, halfH) };
	}

	private computeThreePointSecondPoint(effectiveWorld: Vec2): Vec2 {
		const P1 = this.startWorldPos!;
		const vx = effectiveWorld.x - P1.x;
		const vy = effectiveWorld.y - P1.y;
		const d = Math.hypot(vx, vy);

		if (this.isWidthLocked) {
			const dirX = d > 1e-4 ? vx / d : 1;
			const dirY = d > 1e-4 ? vy / d : 0;
			return vec(P1.x + dirX * this.width, P1.y + dirY * this.width);
		}
		return effectiveWorld;
	}

	private computeThreePointHeightPoint(effectiveWorld: Vec2): Vec2 {
		const P1 = this.startWorldPos!;
		const P2 = this.secondWorldPos!;
		const V = vec(P2.x - P1.x, P2.y - P1.y);
		const baseLen = Math.hypot(V.x, V.y);
		const n = baseLen > 1e-4 ? vec(-V.y / baseLen, V.x / baseLen) : vec(0, 1);

		const offset = vec(effectiveWorld.x - P2.x, effectiveWorld.y - P2.y);
		const proj = offset.x * n.x + offset.y * n.y;

		let signedH = proj;
		if (this.isHeightLocked) {
			const signH = Math.sign(proj) || 1;
			signedH = signH * this.height;
		}

		return vec(P2.x + signedH * n.x, P2.y + signedH * n.y);
	}

	private commitFromCurrentValues(): void {
		if (this._mode === 'corner') {
			const c1 = this.startWorldPos!;
			const eff = this.lastEffectiveWorld ?? vec(c1.x + this.width, c1.y + this.height);
			const dx = eff.x - c1.x;
			const dy = eff.y - c1.y;
			const signX = Math.sign(dx) || 1;
			const signY = Math.sign(dy) || 1;
			const c2 = vec(c1.x + signX * this.width, c1.y + signY * this.height);
			this.commitCorner(c1, c2, null);
		} else if (this._mode === 'center') {
			const C = this.startWorldPos!;
			this.commitCenter(C, this.width / 2, this.height / 2);
		} else if (this._mode === 'three_point') {
			const P1 = this.startWorldPos!;
			const P2 = this.secondWorldPos ?? (this.lastEffectiveWorld ? this.computeThreePointSecondPoint(this.lastEffectiveWorld) : vec(P1.x + this.width, P1.y));
			const V = vec(P2.x - P1.x, P2.y - P1.y);
			const baseLen = Math.hypot(V.x, V.y);
			const n = baseLen > 1e-4 ? vec(-V.y / baseLen, V.x / baseLen) : vec(0, 1);
			const eff = this.lastEffectiveWorld ?? vec(P2.x + n.x * this.height, P2.y + n.y * this.height);
			const offset = vec(eff.x - P2.x, eff.y - P2.y);
			const proj = offset.x * n.x + offset.y * n.y;
			const signH = Math.sign(proj) || 1;
			const P3 = vec(P2.x + signH * n.x * this.height, P2.y + signH * n.y * this.height);
			this.commitThreePoint(P1, P2, P3, null);
		} else if (this._mode === 'rounded') {
			const c1 = this.startWorldPos!;
			const eff = this.lastEffectiveWorld ?? vec(c1.x + this.width, c1.y + this.height);
			const dx = eff.x - c1.x;
			const dy = eff.y - c1.y;
			const signX = Math.sign(dx) || 1;
			const signY = Math.sign(dy) || 1;
			const c2 = this.secondWorldPos ?? vec(c1.x + signX * this.width, c1.y + signY * this.height);
			this.commitRounded(c1, c2, this.radius, this.secondSnap);
		}
	}

	// =========================================================================
	// Commit Methods
	// =========================================================================

	private commitCorner(c1: Vec2, c2: Vec2, snap: SnapResult | null): void {
		const { sketch } = this.ctx;

		const minX = Math.min(c1.x, c2.x);
		const maxX = Math.max(c1.x, c2.x);
		const minY = Math.min(c1.y, c2.y);
		const maxY = Math.max(c1.y, c2.y);

		const p0 = sketch.addPoint(minX, minY);
		const p1 = sketch.addPoint(maxX, minY);
		const p2 = sketch.addPoint(maxX, maxY);
		const p3 = sketch.addPoint(minX, maxY);

		const pts = [p0, p1, p2, p3];
		const findClosest = (target: Vec2) => {
			let closest = pts[0];
			let minD = Infinity;
			for (const p of pts) {
				const d = Math.hypot(p.x - target.x, p.y - target.y);
				if (d < minD) {
					minD = d;
					closest = p;
				}
			}
			return closest;
		};

		const ptC1 = findClosest(c1);
		const ptC2 = findClosest(c2);

		if (this.startSnap) {
			this.ctx.applySnapConstraintIfNeeded?.(ptC1.id, this.startSnap);
		}
		if (snap) {
			this.ctx.applySnapConstraintIfNeeded?.(ptC2.id, snap);
		}

		const isConst = this.ctx.isConstructionMode;
		sketch.addLine(p0.id, p1.id, isConst);
		sketch.addLine(p1.id, p2.id, isConst);
		sketch.addLine(p2.id, p3.id, isConst);
		sketch.addLine(p3.id, p0.id, isConst);

		sketch.addHorizontalConstraint(p0.id, p1.id);
		sketch.addVerticalConstraint(p1.id, p2.id);
		sketch.addHorizontalConstraint(p3.id, p2.id);
		sketch.addVerticalConstraint(p0.id, p3.id);

		if (this.isWidthLocked || this.popup.isWidthLocked()) {
			sketch.addDistanceConstraint(p0.id, p1.id, this.width);
		}
		if (this.isHeightLocked || this.popup.isHeightLocked()) {
			sketch.addDistanceConstraint(p1.id, p2.id, this.height);
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Rectangle created');
	}

	private commitCenter(
		center: Vec2,
		halfW: number,
		halfH: number,
		snap: SnapResult | null = null,
		effectiveWorld: Vec2 | null = null
	): void {
		const { sketch } = this.ctx;

		let centerPtId: string;
		if (this.startSnap && this.startSnap.type === 'point' && this.startSnap.id && sketch.points.has(this.startSnap.id)) {
			centerPtId = this.startSnap.id;
		} else {
			const cpt = sketch.addPoint(center.x, center.y);
			centerPtId = cpt.id;
			if (this.startSnap) {
				this.ctx.applySnapConstraintIfNeeded?.(centerPtId, this.startSnap);
			}
		}

		const minX = center.x - halfW;
		const maxX = center.x + halfW;
		const minY = center.y - halfH;
		const maxY = center.y + halfH;

		const p0 = sketch.addPoint(minX, minY);
		const p1 = sketch.addPoint(maxX, minY);
		const p2 = sketch.addPoint(maxX, maxY);
		const p3 = sketch.addPoint(minX, maxY);

		if (snap && effectiveWorld) {
			const pts = [p0, p1, p2, p3];
			let closest = pts[0];
			let minD = Infinity;
			for (const p of pts) {
				const d = Math.hypot(p.x - effectiveWorld.x, p.y - effectiveWorld.y);
				if (d < minD) {
					minD = d;
					closest = p;
				}
			}
			this.ctx.applySnapConstraintIfNeeded?.(closest.id, snap);
		}

		const isConst = this.ctx.isConstructionMode;
		sketch.addLine(p0.id, p1.id, isConst);
		sketch.addLine(p1.id, p2.id, isConst);
		sketch.addLine(p2.id, p3.id, isConst);
		sketch.addLine(p3.id, p0.id, isConst);

		// Diagonal construction lines
		const d1 = sketch.addLine(p0.id, p2.id, true);
		sketch.addLine(p1.id, p3.id, true);

		sketch.addHorizontalConstraint(p0.id, p1.id);
		sketch.addVerticalConstraint(p1.id, p2.id);
		sketch.addHorizontalConstraint(p3.id, p2.id);
		sketch.addVerticalConstraint(p0.id, p3.id);

		sketch.addMidpointConstraint(centerPtId, d1.id);

		if (this.isWidthLocked || this.popup.isWidthLocked()) {
			sketch.addDistanceConstraint(p0.id, p1.id, this.width);
		}
		if (this.isHeightLocked || this.popup.isHeightLocked()) {
			sketch.addDistanceConstraint(p1.id, p2.id, this.height);
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Center rectangle created');
	}

	private commitThreePoint(p1: Vec2, p2: Vec2, p3: Vec2, snap: SnapResult | null = null): void {
		const { sketch } = this.ctx;

		const V = vec(p2.x - p1.x, p2.y - p1.y);
		const baseLen = Math.hypot(V.x, V.y);
		const n = baseLen > 1e-4 ? vec(-V.y / baseLen, V.x / baseLen) : vec(0, 1);
		const offset = vec(p3.x - p2.x, p3.y - p2.y);
		const hSigned = offset.x * n.x + offset.y * n.y;

		const pCorner0 = sketch.addPoint(p1.x, p1.y);
		const pCorner1 = sketch.addPoint(p2.x, p2.y);
		const pCorner2 = sketch.addPoint(p3.x, p3.y);
		const pCorner3 = sketch.addPoint(p1.x + hSigned * n.x, p1.y + hSigned * n.y);

		if (this.startSnap) {
			this.ctx.applySnapConstraintIfNeeded?.(pCorner0.id, this.startSnap);
		}
		if (this.secondSnap) {
			this.ctx.applySnapConstraintIfNeeded?.(pCorner1.id, this.secondSnap);
		}
		if (snap) {
			this.ctx.applySnapConstraintIfNeeded?.(pCorner2.id, snap);
		}

		const isConst = this.ctx.isConstructionMode;
		const l0 = sketch.addLine(pCorner0.id, pCorner1.id, isConst);
		const l1 = sketch.addLine(pCorner1.id, pCorner2.id, isConst);
		const l2 = sketch.addLine(pCorner2.id, pCorner3.id, isConst);
		const l3 = sketch.addLine(pCorner3.id, pCorner0.id, isConst);

		sketch.addParallelConstraint(l0.id, l2.id);
		sketch.addParallelConstraint(l1.id, l3.id);
		sketch.addPerpendicularConstraint(l0.id, l1.id);
		sketch.addEqualLengthConstraint(l0.id, l2.id);

		if (this.isWidthLocked || this.popup.isWidthLocked()) {
			sketch.addDistanceConstraint(pCorner0.id, pCorner1.id, this.width);
		}
		if (this.isHeightLocked || this.popup.isHeightLocked()) {
			sketch.addDistanceConstraint(pCorner1.id, pCorner2.id, this.height);
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('3-point rectangle created');
	}

	private commitRounded(c1: Vec2, c2: Vec2, radius: number, snap: SnapResult | null = null): void {
		const { sketch } = this.ctx;

		const minX = Math.min(c1.x, c2.x);
		const maxX = Math.max(c1.x, c2.x);
		const minY = Math.min(c1.y, c2.y);
		const maxY = Math.max(c1.y, c2.y);

		const w = maxX - minX;
		const h = maxY - minY;
		const r = Math.min(radius, w / 2, h / 2);

		if (r < 0.05) {
			this.commitCorner(c1, c2, snap);
			return;
		}

		const isConst = this.ctx.isConstructionMode;

		// 1. Points on straight segments and arc centers
		const ptTopStart = sketch.addPoint(minX + r, maxY);
		const ptTopEnd = sketch.addPoint(maxX - r, maxY);
		const centerTR = sketch.addPoint(maxX - r, maxY - r);

		const ptRightStart = sketch.addPoint(maxX, maxY - r);
		const ptRightEnd = sketch.addPoint(maxX, minY + r);
		const centerBR = sketch.addPoint(maxX - r, minY + r);

		const ptBottomStart = sketch.addPoint(maxX - r, minY);
		const ptBottomEnd = sketch.addPoint(minX + r, minY);
		const centerBL = sketch.addPoint(minX + r, minY + r);

		const ptLeftStart = sketch.addPoint(minX, minY + r);
		const ptLeftEnd = sketch.addPoint(minX, maxY - r);
		const centerTL = sketch.addPoint(minX + r, maxY - r);

		// 2. Lines
		const topLine = sketch.addLine(ptTopStart.id, ptTopEnd.id, isConst);
		const rightLine = sketch.addLine(ptRightStart.id, ptRightEnd.id, isConst);
		const bottomLine = sketch.addLine(ptBottomStart.id, ptBottomEnd.id, isConst);
		const leftLine = sketch.addLine(ptLeftStart.id, ptLeftEnd.id, isConst);

		// 3. Corner Arcs (clockwise = true in screen space)
		const trArc = sketch.addArc(centerTR.id, ptTopEnd.id, ptRightStart.id, r, true, isConst);
		const brArc = sketch.addArc(centerBR.id, ptRightEnd.id, ptBottomStart.id, r, true, isConst);
		const blArc = sketch.addArc(centerBL.id, ptBottomEnd.id, ptLeftStart.id, r, true, isConst);
		const tlArc = sketch.addArc(centerTL.id, ptLeftEnd.id, ptTopStart.id, r, true, isConst);

		// 4. Constraints
		sketch.addHorizontalConstraint(ptTopStart.id, ptTopEnd.id);
		sketch.addHorizontalConstraint(ptBottomStart.id, ptBottomEnd.id);
		sketch.addVerticalConstraint(ptLeftStart.id, ptLeftEnd.id);
		sketch.addVerticalConstraint(ptRightStart.id, ptRightEnd.id);

		sketch.addTangentConstraint(topLine.id, trArc.id);
		sketch.addTangentConstraint(rightLine.id, trArc.id);
		sketch.addTangentConstraint(rightLine.id, brArc.id);
		sketch.addTangentConstraint(bottomLine.id, brArc.id);
		sketch.addTangentConstraint(bottomLine.id, blArc.id);
		sketch.addTangentConstraint(leftLine.id, blArc.id);
		sketch.addTangentConstraint(leftLine.id, tlArc.id);
		sketch.addTangentConstraint(topLine.id, tlArc.id);

		sketch.addEqualRadiusConstraint(trArc.id, brArc.id);
		sketch.addEqualRadiusConstraint(brArc.id, blArc.id);
		sketch.addEqualRadiusConstraint(blArc.id, tlArc.id);

		if (this.isRadiusLocked || this.popup.isRadiusLocked()) {
			sketch.addRadiusConstraint(trArc.id, r);
		}
		if (this.isWidthLocked || this.popup.isWidthLocked()) {
			sketch.addDistanceConstraint(ptTopStart.id, ptTopEnd.id, Math.max(0.1, w - 2 * r));
		}
		if (this.isHeightLocked || this.popup.isHeightLocked()) {
			sketch.addDistanceConstraint(ptLeftStart.id, ptLeftEnd.id, Math.max(0.1, h - 2 * r));
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Rounded rectangle created');
	}
}

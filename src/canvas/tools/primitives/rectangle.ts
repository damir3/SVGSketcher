import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext, SnapResult } from '../types';
import { Vec2 } from '../../../math/vector';
import { createSvgCircle, createSvgLine, createSvgPath, createSvgRect } from '../../svg';
import { AUX_AXIS_ATTRS, PREVIEW_POINT_ATTRS, getPreviewStrokeAttrs } from '../../styles';
import { ToolPopup } from '../../../ui/tool-popup';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { dispatchToolModeChange } from '../modeChangeEvent';

export type RectangleMode = 'corner' | 'center' | 'three_point' | 'rounded';

export class RectangleTool extends BaseTool {
	readonly id = 'rectangle' as const;

	readonly popup: ToolPopup<'width' | 'height' | 'radius'>;
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
		this.popup = new ToolPopup<'width' | 'height' | 'radius'>({
			className: 'rectangle-popup',
			defaultOffset: new Vec2(150, 40),
			fields: [
				{
					id: 'width',
					label: 'Width',
					type: 'dimension',
					unit: 'mm',
					lockable: true,
					defaultValue: 50.0,
				},
				{
					id: 'height',
					label: 'Height',
					type: 'dimension',
					unit: 'mm',
					lockable: true,
					defaultValue: 30.0,
				},
				{
					id: 'radius',
					label: 'Radius',
					type: 'dimension',
					unit: 'mm',
					lockable: true,
					defaultValue: 0.0,
					visible: this._mode === 'rounded',
				},
			],
			onKeyDown: e => this.sidebarPanel.handleKeyDown(e),
		});

		const syncValuesFromPopup = () => {
			this.width = this.popup.getNumericValue('width', 50);
			this.height = this.popup.getNumericValue('height', 30);
			this.radius = this.popup.getNumericValue('radius', 0);
			this.isWidthLocked = this.popup.isLocked('width');
			this.isHeightLocked = this.popup.isLocked('height');
			this.isRadiusLocked = this.popup.isLocked('radius');
			this.ctx?.requestRender();
		};

		this.popup.onChange = () => syncValuesFromPopup();
		this.popup.onLockChange = () => syncValuesFromPopup();

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

		this.sidebarPanel = new VariationToolPanel<RectangleMode>({
			title: 'Rectangle Tool',
			description: 'Select rectangle creation method:',
			dataAttribute: 'data-rect-mode',
			cancelButtonId: 'btn-rectangle-cancel-icon',
			modes: [
				{
					id: 'corner',
					label: '2-Point',
					title: '2-Point Rectangle (Alt+1)',
					iconName: 'rectangle',
				},
				{
					id: 'center',
					label: 'Center',
					title: 'Center Rectangle (Alt+2)',
					iconName: 'rectangle_center',
				},
				{
					id: 'three_point',
					label: '3-Point',
					title: '3-Point Rectangle (Alt+3)',
					iconName: 'rectangle_3point',
				},
				{
					id: 'rounded',
					label: 'Rounded',
					title: 'Rounded Rectangle (Alt+4)',
					iconName: 'rectangle_rounded',
				},
			],
			getCurrentMode: () => this.mode,
			onSelectMode: mode => this.setMode(mode),
			onCancel: () => this.ctx?.setTool('select'),
			getHint: () => this.getStepHint(),
			bindStateChange: cb => {
				this.onStateChange = cb;
			},
		});
	}

	getStepHint(): string {
		const mode = this._mode;
		const step = this.drawingStep;
		if (mode === 'corner') {
			if (step === 0) return '1. Click to place first corner';
			return '2. Click to place opposite corner';
		} else if (mode === 'center') {
			if (step === 0) return '1. Click to place center point';
			return '2. Click to place corner point';
		} else if (mode === 'three_point') {
			if (step === 0) return '1. Click to place first corner';
			if (step === 1) return '2. Click to place second corner (base line)';
			return '3. Click to set rectangle height';
		} else {
			if (step === 0) return '1. Click to place first corner';
			if (step === 1) return '2. Click to place opposite corner';
			return '3. Click to set corner radius';
		}
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
		dispatchToolModeChange('rectangle', newMode);
		this.popup.setFieldVisible('radius', newMode === 'rounded');
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.popup.setSketch(this.ctx.sketch);
		this.popup.setFieldVisible('radius', this._mode === 'rounded');
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
				this.ctx.showToast(
					this.drawingStep === 0 ? 'Rectangle: Click first corner' : 'Rectangle: Click opposite corner'
				);
				break;
			case 'center':
				this.ctx.showToast(
					this.drawingStep === 0 ? 'Center Rectangle: Click center point' : 'Center Rectangle: Click corner point'
				);
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
			this.popup.resetField('width', 0.1);
			this.popup.resetField('height', 0.1);
			this.popup.resetField('radius', 0);

			this.drawingStep = 1;
			this.popup.setFieldVisible('radius', this._mode === 'rounded');
			this.popup.show(e.screen);
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
				if (this.isRadiusLocked || this.popup.isLocked('radius')) {
					this.commitRounded(this.startWorldPos!, c2, this.radius, this.secondSnap);
				} else {
					this.secondWorldPos = c2;
					this.radius = 0;
					this.drawingStep = 2;
					this.updatePopupDimensions(this.width, this.height, 0);
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

	private updatePopupDimensions(w: number, h: number, r?: number): void {
		this.popup.updateValueIfUnlocked('width', w);
		this.popup.updateValueIfUnlocked('height', h);
		if (r !== undefined) {
			this.popup.updateValueIfUnlocked('radius', r);
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 0 || !this.startWorldPos) return;

		const effectiveWorld = e.effectiveWorld;
		this.lastEffectiveWorld = effectiveWorld;

		if (this._mode === 'corner') {
			const dir = new Vec2().subVectors(effectiveWorld, this.startWorldPos);
			if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dir.x));
			if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dir.y));
			this.updatePopupDimensions(this.width, this.height);
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'center') {
			const dir = new Vec2().subVectors(effectiveWorld, this.startWorldPos);
			if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dir.x) * 2);
			if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dir.y) * 2);
			this.updatePopupDimensions(this.width, this.height);
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'three_point') {
			if (this.drawingStep === 1) {
				const d = this.startWorldPos.distanceTo(effectiveWorld);
				if (!this.isWidthLocked) this.width = Math.max(0.1, d);
				this.updatePopupDimensions(this.width, this.height);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const V = new Vec2().subVectors(this.secondWorldPos, this.startWorldPos);
				const baseLen = V.length();
				const n = baseLen > 1e-4 ? V.clone().perpendicular().divideScalar(baseLen) : new Vec2(0, 1);
				const offset = new Vec2().subVectors(effectiveWorld, this.secondWorldPos);
				const proj = offset.dot(n);
				if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(proj));
				this.updatePopupDimensions(this.width, this.height);
			}
			this.popup.updatePosition(e.screen);
		} else if (this._mode === 'rounded') {
			if (this.drawingStep === 1) {
				const dir = new Vec2().subVectors(effectiveWorld, this.startWorldPos);
				if (!this.isWidthLocked) this.width = Math.max(0.1, Math.abs(dir.x));
				if (!this.isHeightLocked) this.height = Math.max(0.1, Math.abs(dir.y));
				const maxR = Math.max(0.1, Math.min(this.width, this.height) / 2);
				if (!this.isRadiusLocked) {
					this.radius = 0;
				} else {
					this.radius = Math.min(this.radius, maxR);
				}
				this.updatePopupDimensions(this.width, this.height, this.radius);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const c1 = this.startWorldPos;
				const c2 = this.secondWorldPos;
				const min = new Vec2(Math.min(c1.x, c2.x), Math.min(c1.y, c2.y));
				const max = new Vec2(Math.max(c1.x, c2.x), Math.max(c1.y, c2.y));
				const maxR = Math.min(max.x - min.x, max.y - min.y) / 2;

				if (!this.isRadiusLocked) {
					const isInside =
						effectiveWorld.x >= min.x &&
						effectiveWorld.x <= max.x &&
						effectiveWorld.y >= min.y &&
						effectiveWorld.y <= max.y;

					if (!isInside) {
						this.radius = 0;
					} else {
						const inwardSignX = Math.sign(c1.x - c2.x) || 1;
						const inwardSignY = Math.sign(c1.y - c2.y) || 1;
						const pullVector = new Vec2().subVectors(effectiveWorld, c2).multiply(new Vec2(inwardSignX, inwardSignY));

						if (pullVector.x <= 0 || pullVector.y <= 0) {
							this.radius = 0;
						} else {
							const pull = Math.min(pullVector.x, pullVector.y);
							this.radius = Math.min(maxR, Math.max(0, pull));
						}
					}
				}
				this.updatePopupDimensions(this.width, this.height, this.radius);
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
			const s1 = ctx.viewport.worldToScreen(c1);
			const s2 = ctx.viewport.worldToScreen(c2);

			const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			createSvgRect(min, new Vec2(rw, rh), previewAttrs, ctx.targetGroup);
		} else if (this._mode === 'center') {
			const C = this.startWorldPos;
			const halfDims = this.computeCenterHalfDims(effectiveWorld);
			const halfSize = new Vec2(halfDims.w, halfDims.h);
			const worldMin = C.clone().sub(halfSize);
			const worldMax = C.clone().add(halfSize);

			const s1 = ctx.viewport.worldToScreen(new Vec2(worldMin.x, worldMax.y));
			const s2 = ctx.viewport.worldToScreen(new Vec2(worldMax.x, worldMin.y));
			const sc = ctx.viewport.worldToScreen(C);

			const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			createSvgRect(min, new Vec2(rw, rh), previewAttrs, ctx.targetGroup);
			createSvgLine(s1, s2, AUX_AXIS_ATTRS, ctx.targetGroup);
			createSvgLine(new Vec2(s1.x, s2.y), new Vec2(s2.x, s1.y), AUX_AXIS_ATTRS, ctx.targetGroup);
			createSvgCircle(sc, 3, PREVIEW_POINT_ATTRS, ctx.targetGroup);
		} else if (this._mode === 'three_point') {
			const s1 = ctx.viewport.worldToScreen(this.startWorldPos);

			if (this.drawingStep === 1) {
				const p2 = this.computeThreePointSecondPoint(effectiveWorld);
				const s2 = ctx.viewport.worldToScreen(p2);
				createSvgLine(s1, s2, previewAttrs, ctx.targetGroup);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				const p2 = this.secondWorldPos;
				const p3 = this.computeThreePointHeightPoint(effectiveWorld);
				const V = new Vec2().subVectors(p2, this.startWorldPos);
				const baseLen = V.length();
				const n = baseLen > 1e-4 ? V.clone().perpendicular().divideScalar(baseLen) : new Vec2(0, 1);
				const offset = new Vec2().subVectors(p3, p2);
				const hSigned = offset.dot(n);

				const p0 = this.startWorldPos;
				const p1 = p2;
				const pCorner2 = p3;
				const pCorner3 = p0.clone().addScaledVector(n, hSigned);

				const s0 = ctx.viewport.worldToScreen(p0);
				const sPt1 = ctx.viewport.worldToScreen(p1);
				const sPt2 = ctx.viewport.worldToScreen(pCorner2);
				const sPt3 = ctx.viewport.worldToScreen(pCorner3);

				const pathD = `M ${s0.x.toFixed(1)} ${s0.y.toFixed(1)} L ${sPt1.x.toFixed(1)} ${sPt1.y.toFixed(1)} L ${sPt2.x.toFixed(1)} ${sPt2.y.toFixed(1)} L ${sPt3.x.toFixed(1)} ${sPt3.y.toFixed(1)} Z`;
				createSvgPath(pathD, previewAttrs, ctx.targetGroup);
			}
		} else if (this._mode === 'rounded') {
			const c1 = this.startWorldPos;
			const c2 =
				this.drawingStep === 2 && this.secondWorldPos
					? this.secondWorldPos
					: this.computeCornerSecondPoint(effectiveWorld);
			const s1 = ctx.viewport.worldToScreen(c1);
			const s2 = ctx.viewport.worldToScreen(c2);

			const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
			const rw = Math.abs(s2.x - s1.x);
			const rh = Math.abs(s2.y - s1.y);

			const maxR = Math.max(0, Math.min(this.width, this.height) / 2);
			const effectiveR = Math.max(0, Math.min(this.radius, maxR));
			const sr = effectiveR * ctx.viewport.zoom;

			createSvgRect(min, new Vec2(rw, rh), { ...previewAttrs, rx: sr, ry: sr }, ctx.targetGroup);
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
		this.popup.resetField('width', 50);
		this.popup.resetField('height', 30);
		this.popup.resetField('radius', 0);
		this.updateToastHint();
		this.onStateChange?.();
	}

	// =========================================================================
	// Computations for Points
	// =========================================================================

	private computeCornerSecondPoint(effectiveWorld: Vec2): Vec2 {
		const c1 = this.startWorldPos!;
		const dir = new Vec2().subVectors(effectiveWorld, c1);

		const signX = Math.sign(dir.x) || 1;
		const signY = Math.sign(dir.y) || 1;

		const c2 = new Vec2(
			this.isWidthLocked ? c1.x + signX * this.width : effectiveWorld.x,
			this.isHeightLocked ? c1.y + signY * this.height : effectiveWorld.y
		);

		return c2;
	}

	private computeCenterHalfDims(effectiveWorld: Vec2): { w: number; h: number } {
		const C = this.startWorldPos!;
		const halfW = this.isWidthLocked ? this.width / 2 : Math.abs(effectiveWorld.x - C.x);
		const halfH = this.isHeightLocked ? this.height / 2 : Math.abs(effectiveWorld.y - C.y);
		return { w: Math.max(0.05, halfW), h: Math.max(0.05, halfH) };
	}

	private computeThreePointSecondPoint(effectiveWorld: Vec2): Vec2 {
		const P1 = this.startWorldPos!;
		const v = new Vec2().subVectors(effectiveWorld, P1);
		const d = v.length();

		if (this.isWidthLocked) {
			const dir = d > 1e-4 ? v.divideScalar(d) : new Vec2(1, 0);
			return P1.clone().addScaledVector(dir, this.width);
		}
		return effectiveWorld;
	}

	private computeThreePointHeightPoint(effectiveWorld: Vec2): Vec2 {
		const P1 = this.startWorldPos!;
		const P2 = this.secondWorldPos!;
		const V = new Vec2().subVectors(P2, P1);
		const baseLen = V.length();
		const n = baseLen > 1e-4 ? V.clone().perpendicular().divideScalar(baseLen) : new Vec2(0, 1);

		const offset = new Vec2().subVectors(effectiveWorld, P2);
		const proj = offset.dot(n);

		let signedH = proj;
		if (this.isHeightLocked) {
			const signH = Math.sign(proj) || 1;
			signedH = signH * this.height;
		}

		return P2.clone().addScaledVector(n, signedH);
	}

	private commitFromCurrentValues(): void {
		if (this._mode === 'corner') {
			const c1 = this.startWorldPos!;
			const eff = this.lastEffectiveWorld ?? new Vec2(c1.x + this.width, c1.y + this.height);
			const dir = new Vec2().subVectors(eff, c1);
			const signX = Math.sign(dir.x) || 1;
			const signY = Math.sign(dir.y) || 1;
			const c2 = new Vec2(c1.x + signX * this.width, c1.y + signY * this.height);
			this.commitCorner(c1, c2, null);
		} else if (this._mode === 'center') {
			const C = this.startWorldPos!;
			this.commitCenter(C, this.width / 2, this.height / 2);
		} else if (this._mode === 'three_point') {
			const P1 = this.startWorldPos!;
			const P2 =
				this.secondWorldPos ??
				(this.lastEffectiveWorld
					? this.computeThreePointSecondPoint(this.lastEffectiveWorld)
					: new Vec2(P1.x + this.width, P1.y));
			const V = new Vec2().subVectors(P2, P1);
			const baseLen = V.length();
			const n = baseLen > 1e-4 ? V.clone().perpendicular().divideScalar(baseLen) : new Vec2(0, 1);
			const eff = this.lastEffectiveWorld ?? P2.clone().addScaledVector(n, this.height);
			const offset = new Vec2().subVectors(eff, P2);
			const proj = offset.dot(n);
			const signH = Math.sign(proj) || 1;
			const P3 = P2.clone().addScaledVector(n, this.height * signH);
			this.commitThreePoint(P1, P2, P3, null);
		} else if (this._mode === 'rounded') {
			const c1 = this.startWorldPos!;
			const eff = this.lastEffectiveWorld ?? new Vec2(c1.x + this.width, c1.y + this.height);
			const dir = new Vec2().subVectors(eff, c1);
			const signX = Math.sign(dir.x) || 1;
			const signY = Math.sign(dir.y) || 1;
			const c2 = this.secondWorldPos ?? new Vec2(c1.x + signX * this.width, c1.y + signY * this.height);
			this.commitRounded(c1, c2, this.radius, this.secondSnap);
		}
	}

	// =========================================================================
	// Commit Methods
	// =========================================================================

	private commitCorner(c1: Vec2, c2: Vec2, snap: SnapResult | null): void {
		const { sketch } = this.ctx;

		const min = new Vec2(Math.min(c1.x, c2.x), Math.min(c1.y, c2.y));
		const max = new Vec2(Math.max(c1.x, c2.x), Math.max(c1.y, c2.y));

		const p0 = sketch.addPoint(min);
		const p1 = sketch.addPoint(new Vec2(max.x, min.y));
		const p2 = sketch.addPoint(max);
		const p3 = sketch.addPoint(new Vec2(min.x, max.y));

		const pts = [p0, p1, p2, p3];
		const findClosest = (target: Vec2) => {
			let closest = pts[0];
			let minD = Infinity;
			for (const p of pts) {
				const d = target.distanceTo(p);
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

		if (this.isWidthLocked || this.popup.isLocked('width')) {
			const c = sketch.addDistanceConstraint(p0.id, p1.id, this.width);
			const expr = this.popup.getExpression('width');
			if (c && expr) c.expression = expr;
		}
		if (this.isHeightLocked || this.popup.isLocked('height')) {
			const c = sketch.addDistanceConstraint(p1.id, p2.id, this.height);
			const expr = this.popup.getExpression('height');
			if (c && expr) c.expression = expr;
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
		if (
			this.startSnap &&
			this.startSnap.type === 'point' &&
			this.startSnap.id &&
			sketch.points.has(this.startSnap.id)
		) {
			centerPtId = this.startSnap.id;
		} else {
			const cpt = sketch.addPoint(center);
			centerPtId = cpt.id;
			if (this.startSnap) {
				this.ctx.applySnapConstraintIfNeeded?.(centerPtId, this.startSnap);
			}
		}

		const halfSize = new Vec2(halfW, halfH);
		const min = center.clone().sub(halfSize);
		const max = center.clone().add(halfSize);

		const p0 = sketch.addPoint(min);
		const p1 = sketch.addPoint(new Vec2(max.x, min.y));
		const p2 = sketch.addPoint(max);
		const p3 = sketch.addPoint(new Vec2(min.x, max.y));

		if (snap && effectiveWorld) {
			const pts = [p0, p1, p2, p3];
			let closest = pts[0];
			let minD = Infinity;
			for (const p of pts) {
				const d = effectiveWorld.distanceTo(p);
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

		if (this.isWidthLocked || this.popup.isLocked('width')) {
			const c = sketch.addDistanceConstraint(p0.id, p1.id, this.width);
			const expr = this.popup.getExpression('width');
			if (c && expr) c.expression = expr;
		}
		if (this.isHeightLocked || this.popup.isLocked('height')) {
			const c = sketch.addDistanceConstraint(p1.id, p2.id, this.height);
			const expr = this.popup.getExpression('height');
			if (c && expr) c.expression = expr;
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

		const V = new Vec2().subVectors(p2, p1);
		const baseLen = V.length();
		const n = baseLen > 1e-4 ? V.clone().perpendicular().divideScalar(baseLen) : new Vec2(0, 1);
		const offset = new Vec2().subVectors(p3, p2);
		const hSigned = offset.dot(n);

		const pCorner0 = sketch.addPoint(p1);
		const pCorner1 = sketch.addPoint(p2);
		const pCorner2 = sketch.addPoint(p3);
		const pCorner3 = sketch.addPoint(p1.clone().addScaledVector(n, hSigned));

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

		if (this.isWidthLocked || this.popup.isLocked('width')) {
			const c = sketch.addDistanceConstraint(pCorner0.id, pCorner1.id, this.width);
			const expr = this.popup.getExpression('width');
			if (c && expr) c.expression = expr;
		}
		if (this.isHeightLocked || this.popup.isLocked('height')) {
			const c = sketch.addDistanceConstraint(pCorner1.id, pCorner2.id, this.height);
			const expr = this.popup.getExpression('height');
			if (c && expr) c.expression = expr;
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

		const min = new Vec2(Math.min(c1.x, c2.x), Math.min(c1.y, c2.y));
		const max = new Vec2(Math.max(c1.x, c2.x), Math.max(c1.y, c2.y));

		const w = max.x - min.x;
		const h = max.y - min.y;
		const r = Math.min(radius, w / 2, h / 2);

		if (r < 0.05) {
			this.commitCorner(c1, c2, snap);
			return;
		}

		const isConst = this.ctx.isConstructionMode;

		// 1. Points on straight segments and arc centers
		const ptTopStart = sketch.addPoint(new Vec2(min.x + r, max.y));
		const ptTopEnd = sketch.addPoint(new Vec2(max.x - r, max.y));
		const centerTR = sketch.addPoint(max.clone().subScalar(r));

		const ptRightStart = sketch.addPoint(new Vec2(max.x, max.y - r));
		const ptRightEnd = sketch.addPoint(new Vec2(max.x, min.y + r));
		const centerBR = sketch.addPoint(new Vec2(max.x - r, min.y + r));

		const ptBottomStart = sketch.addPoint(new Vec2(max.x - r, min.y));
		const ptBottomEnd = sketch.addPoint(new Vec2(min.x + r, min.y));
		const centerBL = sketch.addPoint(min.clone().addScalar(r));

		const ptLeftStart = sketch.addPoint(new Vec2(min.x, min.y + r));
		const ptLeftEnd = sketch.addPoint(new Vec2(min.x, max.y - r));
		const centerTL = sketch.addPoint(new Vec2(min.x + r, max.y - r));

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

		if (this.isRadiusLocked || this.popup.isLocked('radius')) {
			const c = sketch.addRadiusConstraint(trArc.id, r);
			const expr = this.popup.getExpression('radius');
			if (c && expr) c.expression = expr;
		}
		if (this.isWidthLocked || this.popup.isLocked('width')) {
			const c = sketch.addDistanceConstraint(ptTopStart.id, ptTopEnd.id, Math.max(0.1, w - 2 * r));
			const expr = this.popup.getExpression('width');
			if (c && expr) c.expression = expr;
		}
		if (this.isHeightLocked || this.popup.isLocked('height')) {
			const c = sketch.addDistanceConstraint(ptLeftStart.id, ptLeftEnd.id, Math.max(0.1, h - 2 * r));
			const expr = this.popup.getExpression('height');
			if (c && expr) c.expression = expr;
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Rounded rectangle created');
	}
}

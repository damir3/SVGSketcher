import { BaseTool } from '../base';
import type { SnapResult, ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, projectPointOntoSegment, getCircumcircle, vec, type Vec2 } from '../../../math/vector';
import { createSvgCircle, createSvgLine, createSvgPath, getArcSvgPath } from '../../svg';
import {
	AUX_AXIS_ATTRS,
	AUX_RAY_ATTRS,
	GUIDE_OUTLINE_ATTRS,
	POLYGON_CENTER_ATTRS,
	getPreviewStrokeAttrs,
} from '../../styles';
import { SlotPopup, type SlotMode, type SlotPopupField } from '../../../ui/slot-popup';
export type { SlotMode };

const TWO_PI = 2 * Math.PI;

/**
 * Determines whether the SVG arc from `start` to `end` around `center` must use
 * `clockwise = true` (sweepFlag = 1 in screen space) in order to pass through `midPoint`.
 */
function isArcClockwiseThroughPoint(
	viewport: { worldToScreen(x: number, y: number): Vec2 },
	center: Vec2,
	start: Vec2,
	end: Vec2,
	midPoint: Vec2
): boolean {
	const sc = viewport.worldToScreen(center.x, center.y);
	const ss = viewport.worldToScreen(start.x, start.y);
	const se = viewport.worldToScreen(end.x, end.y);
	const sm = viewport.worldToScreen(midPoint.x, midPoint.y);

	const as = Math.atan2(ss.y - sc.y, ss.x - sc.x);
	const ae = Math.atan2(se.y - sc.y, se.x - sc.x);
	const am = Math.atan2(sm.y - sc.y, sm.x - sc.x);

	let sweepCW = (ae - as) % TWO_PI;
	if (sweepCW < 0) sweepCW += TWO_PI;
	let testCW = (am - as) % TWO_PI;
	if (testCW < 0) testCW += TWO_PI;

	return testCW > 0 && testCW < sweepCW;
}

export class SlotTool extends BaseTool {
	readonly id = 'slot' as const;

	readonly popup: SlotPopup;
	private _mode: SlotMode = 'center_to_center';
	private drawingStep: 0 | 1 | 2 | 3 = 0;

	private firstWorldPos: Vec2 | null = null;
	private secondWorldPos: Vec2 | null = null;
	private lastEffectiveWorld: Vec2 | null = null;

	private firstSnap: SnapResult | null = null;
	private secondSnap: SnapResult | null = null;
	private thirdSnap: SnapResult | null = null;

	// Arc slot specific state
	private arcCenterWorld: Vec2 | null = null;
	private arcStartWorld: Vec2 | null = null;
	private arcEndWorld: Vec2 | null = null;
	private arcRadius = 50;
	private arcCenterPrevAngle: number | null = null;
	private arcCenterTotalAngle = 0;
	private arcWorldSweepSign = 1;

	distance = 50;
	angle = 90;
	radius: number | null = null;
	isDistanceLocked = false;
	isAngleLocked = false;
	isRadiusLocked = false;

	onModeChange?: (mode: SlotMode) => void;
	onStateChange?: () => void;

	constructor(initialMode: SlotMode = 'center_to_center') {
		super();
		this._mode = initialMode;
		this.popup = new SlotPopup();

		this.popup.onValuesChange = (distVal, angleVal, radVal, isDistLocked, isAngLocked, isRadLocked) => {
			this.distance = distVal;
			this.angle = angleVal;
			this.radius = radVal;
			this.isDistanceLocked = isDistLocked;
			this.isAngleLocked = isAngLocked;
			this.isRadiusLocked = isRadLocked;

			if (this._mode === 'center_point_arc' && isDistLocked) {
				this.arcRadius = this.distance;
				this.updateCenterArcEndpointsForRadius();
			}

			if (this._mode === 'overall' && this.radius !== null && (this.isDistanceLocked || this.drawingStep >= 2)) {
				const maxR = Math.max(0.1, this.distance / 2 - 0.1);
				if (this.radius > maxR) {
					this.radius = maxR;
				}
			}

			this.ctx?.requestRender();
		};

		this.popup.onFieldLocked = (field: SlotPopupField) => {
			this.handleFieldLocked(field);
		};

		this.popup.onCommit = () => {
			if (this.drawingStep > 0 && this.firstWorldPos) {
				this.commitFromCurrentValues();
			}
		};

		this.popup.onCancel = () => {
			this.cancel();
			this.ctx?.setTool('select');
			this.ctx?.requestRender();
		};
	}

	get mode(): SlotMode {
		return this._mode;
	}

	get step(): number {
		return this.drawingStep;
	}

	private isLinearMode(): boolean {
		return this._mode === 'center_to_center' || this._mode === 'center_point' || this._mode === 'overall';
	}

	/**
	 * Disables snapping on radius-defining gizmo steps so the cursor adjusts the radius smoothly.
	 */
	override shouldSnap(): boolean {
		if (this.isLinearMode()) {
			return this.drawingStep !== 2;
		}
		if (this._mode === 'three_point_arc') {
			return this.drawingStep !== 2 && this.drawingStep !== 3;
		}
		return this.drawingStep !== 3;
	}

	setMode(newMode: SlotMode): void {
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

	/**
	 * Locks the distance parameter (or arc radius in center_point_arc mode) and advances focus.
	 */
	public lockDistance(value?: number): void {
		if (value !== undefined) {
			this.distance = Math.max(0.1, value);
		}
		if (this._mode === 'center_point_arc') {
			this.arcRadius = this.distance;
		}
		this.isDistanceLocked = true;
		this.popup.setDistanceLocked(true);
		this.popup.updateValues(this.distance, this.angle, this.radius);
		this.handleFieldLocked('distance');
	}

	/**
	 * Locks the sweep angle parameter (for center_point_arc mode) and immediately switches
	 * to the next gizmo (radius) without waiting for a mouse click if on the angle step.
	 */
	public lockAngle(value?: number): void {
		if (value !== undefined) {
			this.angle = Math.max(0.1, Math.min(359.9, value));
		}
		this.isAngleLocked = true;
		this.popup.setAngleLocked(true);
		this.popup.updateValues(this.distance, this.angle, this.radius);
		this.handleFieldLocked('angle');
	}

	/**
	 * Locks the slot radius parameter and immediately commits the slot if on the radius step,
	 * or switches to the next gizmo without waiting for a mouse click on the radius step.
	 */
	public lockRadius(value?: number): void {
		if (value !== undefined) {
			this.radius = Math.max(0.1, value);
		} else if (this.radius === null) {
			const popupRad = this.popup.getRadius();
			if (popupRad === null) return;
			this.radius = popupRad;
		}
		this.isRadiusLocked = true;
		this.popup.setRadiusVisible(true);
		this.popup.setRadiusLocked(true);
		this.popup.updateValues(this.distance, this.angle, this.radius);
		this.handleFieldLocked('radius');
	}

	private enterRadiusStep(): void {
		this.drawingStep = this.isLinearMode() ? 2 : 3;
		if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
			this.radius = null;
		}
		this.popup.setRadiusVisible(true);
		this.popup.updateValues(this.distance, this.angle, this.radius);
		this.popup.focusField('radius');
		this.updateToastHint();
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	private updateCenterArcEndpointsForRadius(): void {
		if (!this.arcCenterWorld) return;
		if (this.arcStartWorld) {
			const theta1 = Math.atan2(
				this.arcStartWorld.y - this.arcCenterWorld.y,
				this.arcStartWorld.x - this.arcCenterWorld.x
			);
			this.arcStartWorld = vec(
				this.arcCenterWorld.x + this.arcRadius * Math.cos(theta1),
				this.arcCenterWorld.y + this.arcRadius * Math.sin(theta1)
			);
			this.secondWorldPos = this.arcStartWorld;
		}
		if (this.arcEndWorld) {
			const theta2 = Math.atan2(
				this.arcEndWorld.y - this.arcCenterWorld.y,
				this.arcEndWorld.x - this.arcCenterWorld.x
			);
			this.arcEndWorld = vec(
				this.arcCenterWorld.x + this.arcRadius * Math.cos(theta2),
				this.arcCenterWorld.y + this.arcRadius * Math.sin(theta2)
			);
		}
	}

	private handleFieldLocked(field: SlotPopupField): void {
		if (field === 'distance') {
			this.isDistanceLocked = true;
			this.popup.setDistanceLocked(true);

			if ((this.isLinearMode() || this._mode === 'three_point_arc') && this.drawingStep >= 2 && this.firstWorldPos && this.secondWorldPos) {
				this.secondWorldPos = this.computeLinearSecondPoint(this.secondWorldPos);
			} else if (this._mode === 'center_point_arc') {
				this.arcRadius = this.distance;
				this.updateCenterArcEndpointsForRadius();
			}

			if (this._mode === 'center_point_arc' && !this.isAngleLocked) {
				this.popup.focusField('angle');
			} else if (this.popup.isRadiusVisible()) {
				this.popup.focusField('radius');
			}
			this.onStateChange?.();
			this.ctx?.requestRender();
			return;
		}

		if (field === 'angle') {
			this.isAngleLocked = true;
			this.popup.setAngleLocked(true);

			if (this._mode === 'center_point_arc') {
				if (this.drawingStep === 2 && this.arcCenterWorld && this.arcStartWorld) {
					// Immediately compute arc end & mid points and advance to step 3 (radius gizmo) without mouse click!
					this.applyLockedCenterArcAngle();
					this.thirdSnap = null;
					if ((this.isRadiusLocked || this.popup.isRadiusLocked()) && this.radius !== null) {
						this.commitArcSlot();
					} else {
						this.enterRadiusStep();
					}
					return;
				}
			}

			if (this.popup.isRadiusVisible()) {
				this.popup.focusField('radius');
			}
			this.onStateChange?.();
			this.ctx?.requestRender();
			return;
		}

		if (field === 'radius') {
			if (this.radius === null) {
				const popupRad = this.popup.getRadius();
				if (popupRad === null) return;
				this.radius = popupRad;
			}
			this.isRadiusLocked = true;
			this.popup.setRadiusLocked(true);

			// If currently on the radius gizmo step, finish immediately without waiting for mouse click!
			if (this.isLinearMode() && this.drawingStep === 2 && this.firstWorldPos && this.secondWorldPos) {
				this.commitLinearSlot();
				return;
			}
			if (!this.isLinearMode() && this.drawingStep === 3 && this.arcCenterWorld && this.arcStartWorld && this.arcEndWorld) {
				this.commitArcSlot();
				return;
			}

			// Otherwise focus the remaining unlocked field
			if (!this.isDistanceLocked) {
				this.popup.focusField('distance');
			} else if (this._mode === 'center_point_arc' && !this.isAngleLocked) {
				this.popup.focusField('angle');
			}
			this.onStateChange?.();
			this.ctx?.requestRender();
		}
	}

	private updateToastHint(): void {
		if (!this.ctx) return;
		switch (this._mode) {
			case 'center_to_center':
				if (this.drawingStep === 0) this.ctx.showToast('Center-to-Center Slot: Click first arc center');
				else if (this.drawingStep === 1) this.ctx.showToast('Center-to-Center Slot: Click second arc center');
				else this.ctx.showToast('Center-to-Center Slot: Move cursor and click or enter radius');
				break;
			case 'center_point':
				if (this.drawingStep === 0) this.ctx.showToast('Center Point Slot: Click slot center point');
				else if (this.drawingStep === 1) this.ctx.showToast('Center Point Slot: Click one arc center');
				else this.ctx.showToast('Center Point Slot: Move cursor and click or enter radius');
				break;
			case 'overall':
				if (this.drawingStep === 0) this.ctx.showToast('Overall Slot: Click first outer edge');
				else if (this.drawingStep === 1) this.ctx.showToast('Overall Slot: Click second outer edge');
				else this.ctx.showToast('Overall Slot: Move cursor and click or enter radius');
				break;
			case 'three_point_arc':
				if (this.drawingStep === 0) this.ctx.showToast('3-Point Arc Slot: Click start center point');
				else if (this.drawingStep === 1) this.ctx.showToast('3-Point Arc Slot: Click end center point');
				else if (this.drawingStep === 2) this.ctx.showToast('3-Point Arc Slot: Click point on arc');
				else this.ctx.showToast('3-Point Arc Slot: Move cursor and click or enter slot radius');
				break;
			case 'center_point_arc':
				if (this.drawingStep === 0) this.ctx.showToast('Center Point Arc Slot: Click arc center point');
				else if (this.drawingStep === 1) this.ctx.showToast('Center Point Arc Slot: Click start point of slot arc');
				else if (this.drawingStep === 2) this.ctx.showToast('Center Point Arc Slot: Click end point or lock angle');
				else this.ctx.showToast('Center Point Arc Slot: Move cursor and click or enter slot radius');
				break;
		}
	}

	override onMouseDown(e: ToolMouseEvent): void {
		if (this.isLinearMode()) {
			this.onMouseDownLinear(e);
		} else if (this._mode === 'three_point_arc') {
			this.onMouseDownThreePointArc(e);
		} else {
			this.onMouseDownCenterPointArc(e);
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.drawingStep === 0 || !this.firstWorldPos) return;

		const effectiveWorld = this.shouldSnap() ? e.effectiveWorld : e.world;
		this.lastEffectiveWorld = effectiveWorld;

		if (this.isLinearMode()) {
			if (this.drawingStep === 1) {
				const d = dist(this.firstWorldPos, effectiveWorld);
				if (!this.isDistanceLocked && !this.popup.isDistanceLocked()) {
					this.distance = Math.max(0.1, d);
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			} else if (this.drawingStep === 2 && this.secondWorldPos) {
				if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
					this.radius = this.computeLinearRadiusFromCursor(e.world);
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			}
			this.popup.updatePosition(e.screen);
			return;
		}

		if (this._mode === 'three_point_arc') {
			if (this.drawingStep === 1) {
				const d = dist(this.firstWorldPos, effectiveWorld);
				if (!this.isDistanceLocked && !this.popup.isDistanceLocked()) {
					this.distance = Math.max(0.1, d);
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			} else if (this.drawingStep === 3 && this.arcCenterWorld) {
				if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
					this.radius = this.computeArcSlotRadiusFromCursor(e.world);
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			}
			this.popup.updatePosition(e.screen);
			return;
		}

		if (this._mode === 'center_point_arc') {
			if (this.drawingStep === 1 && this.arcCenterWorld) {
				const d = dist(this.arcCenterWorld, effectiveWorld);
				if (!this.isDistanceLocked && !this.popup.isDistanceLocked()) {
					this.distance = Math.max(0.1, d);
					this.arcRadius = this.distance;
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			} else if (this.drawingStep === 2 && this.arcCenterWorld && this.arcStartWorld) {
				this.updateCenterArcSweep(effectiveWorld);
				this.popup.updateValues(this.distance, this.angle, this.radius);
			} else if (this.drawingStep === 3 && this.arcCenterWorld) {
				if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
					this.radius = this.computeArcSlotRadiusFromCursor(e.world);
				}
				this.popup.updateValues(this.distance, this.angle, this.radius);
			}
			this.popup.updatePosition(e.screen);
		}
	}

	// =========================================================================
	// Mouse Down Handlers per Mode Category
	// =========================================================================

	private onMouseDownLinear(e: ToolMouseEvent): void {
		const snap = this.shouldSnap() ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			this.ctx.sketch.beginTransaction();
			this.firstWorldPos = snap ? snap.worldPos : world;
			this.firstSnap = snap ?? null;
			this.lastEffectiveWorld = this.firstWorldPos;

			this.isDistanceLocked = false;
			this.isAngleLocked = false;
			this.isRadiusLocked = false;
			this.distance = 50;
			this.radius = null;
			this.popup.resetValues(50, 90, null);

			this.drawingStep = 1;
			this.popup.show(e.screen, this.distance, this.angle, null, this._mode);
			this.popup.focusField('distance');
			this.updateToastHint();
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		if (this.drawingStep === 1) {
			const effectiveWorld = snap ? snap.worldPos : world;
			const p2 = this.computeLinearSecondPoint(effectiveWorld);
			const d = dist(this.firstWorldPos!, p2);
			if (d < 0.5) return;

			this.secondWorldPos = p2;
			this.secondSnap = this.isDistanceLocked || this.popup.isDistanceLocked() ? null : (snap ?? null);
			this.distance = d;

			if ((this.isRadiusLocked || this.popup.isRadiusLocked()) && this.radius !== null) {
				this.commitLinearSlot();
			} else {
				this.enterRadiusStep();
			}
			return;
		}

		if (this.drawingStep === 2) {
			if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
				if (this.radius === null) {
					this.radius = this.computeLinearRadiusFromCursor(world);
				}
			}
			if (this.radius === null) return;
			this.commitLinearSlot();
		}
	}

	private onMouseDownThreePointArc(e: ToolMouseEvent): void {
		const snap = this.shouldSnap() ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			this.ctx.sketch.beginTransaction();
			this.firstWorldPos = snap ? snap.worldPos : world;
			this.firstSnap = snap ?? null;
			this.lastEffectiveWorld = this.firstWorldPos;

			this.isDistanceLocked = false;
			this.isAngleLocked = false;
			this.isRadiusLocked = false;
			this.distance = 50;
			this.radius = null;
			this.popup.resetValues(50, 90, null);

			this.drawingStep = 1;
			this.popup.show(e.screen, this.distance, this.angle, null, this._mode);
			this.popup.focusField('distance');
			this.updateToastHint();
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		if (this.drawingStep === 1) {
			const effectiveWorld = snap ? snap.worldPos : world;
			const p2 = this.computeLinearSecondPoint(effectiveWorld);
			const d = dist(this.firstWorldPos!, p2);
			if (d < 1) return;

			this.secondWorldPos = p2;
			this.secondSnap = this.isDistanceLocked || this.popup.isDistanceLocked() ? null : (snap ?? null);
			this.distance = d;
			this.drawingStep = 2;
			this.popup.updateValues(this.distance, this.angle, this.radius);
			this.updateToastHint();
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		if (this.drawingStep === 2) {
			const p1 = this.firstWorldPos!;
			const p2 = this.secondWorldPos!;
			const p3 = world;

			const circum = getCircumcircle(p1, p2, p3);
			if (!circum || circum.radius < 1 || circum.radius > 50000) {
				this.ctx.showToast('Cannot form arc slot from collinear points');
				return;
			}

			this.arcCenterWorld = circum.center;
			this.arcStartWorld = p1;
			this.arcEndWorld = p2;
			this.arcRadius = circum.radius;
			this.thirdSnap = null;

			// Determine world sweep sign from p1 -> p2 through p3
			const theta1 = Math.atan2(p1.y - circum.center.y, p1.x - circum.center.x);
			const theta2 = Math.atan2(p2.y - circum.center.y, p2.x - circum.center.x);
			const theta3 = Math.atan2(p3.y - circum.center.y, p3.x - circum.center.x);
			const ccwSpan = ((theta2 - theta1) % TWO_PI + TWO_PI) % TWO_PI;
			const ccwMid = ((theta3 - theta1) % TWO_PI + TWO_PI) % TWO_PI;
			this.arcWorldSweepSign = ccwMid > 0 && ccwMid < ccwSpan ? 1 : -1;

			if ((this.isRadiusLocked || this.popup.isRadiusLocked()) && this.radius !== null) {
				this.commitArcSlot();
			} else {
				this.enterRadiusStep();
			}
			return;
		}

		if (this.drawingStep === 3) {
			if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
				if (this.radius === null) {
					this.radius = this.computeArcSlotRadiusFromCursor(world);
				}
			}
			if (this.radius === null) return;
			this.commitArcSlot();
		}
	}

	private onMouseDownCenterPointArc(e: ToolMouseEvent): void {
		const snap = this.shouldSnap() ? e.snap : null;
		const world = e.world;

		if (this.drawingStep === 0) {
			this.ctx.sketch.beginTransaction();
			this.firstWorldPos = snap ? snap.worldPos : world;
			this.firstSnap = snap ?? null;
			this.arcCenterWorld = this.firstWorldPos;
			this.lastEffectiveWorld = this.firstWorldPos;

			this.isDistanceLocked = false;
			this.isAngleLocked = false;
			this.isRadiusLocked = false;
			this.distance = 50;
			this.arcRadius = 50;
			this.angle = 90;
			this.radius = null;
			this.popup.resetValues(50, 90, null);

			this.drawingStep = 1;
			this.popup.show(e.screen, this.distance, this.angle, null, this._mode);
			this.popup.focusField('distance');
			this.updateToastHint();
			this.onStateChange?.();
			this.ctx.requestRender();
			return;
		}

		if (this.drawingStep === 1) {
			const effectiveWorld = snap ? snap.worldPos : world;
			const p1 = this.computeLinearSecondPoint(effectiveWorld);
			const rArc = dist(this.arcCenterWorld!, p1);
			if (rArc < 1) return;

			this.secondWorldPos = p1;
			this.secondSnap = this.isDistanceLocked || this.popup.isDistanceLocked() ? null : (snap ?? null);
			this.arcStartWorld = p1;
			this.arcRadius = rArc;
			this.distance = rArc;

			const theta1 = Math.atan2(p1.y - this.arcCenterWorld!.y, p1.x - this.arcCenterWorld!.x);
			this.arcCenterPrevAngle = theta1;
			this.arcCenterTotalAngle = 0;
			this.arcWorldSweepSign = 1;

			if (this.isAngleLocked || this.popup.isAngleLocked()) {
				this.applyLockedCenterArcAngle();
				this.thirdSnap = null;
				if ((this.isRadiusLocked || this.popup.isRadiusLocked()) && this.radius !== null) {
					this.commitArcSlot();
				} else {
					this.enterRadiusStep();
				}
			} else {
				this.drawingStep = 2;
				this.popup.updateValues(this.distance, this.angle, this.radius);
				this.popup.focusField('angle');
				this.updateToastHint();
				this.onStateChange?.();
				this.ctx.requestRender();
			}
			return;
		}

		if (this.drawingStep === 2) {
			const effectiveWorld = snap ? snap.worldPos : world;
			this.updateCenterArcSweep(effectiveWorld);
			this.thirdSnap =
				this.isAngleLocked || this.popup.isAngleLocked() || this.isDistanceLocked || this.popup.isDistanceLocked()
					? null
					: (snap ?? null);

			if ((this.isRadiusLocked || this.popup.isRadiusLocked()) && this.radius !== null) {
				this.commitArcSlot();
			} else {
				this.enterRadiusStep();
			}
			return;
		}

		if (this.drawingStep === 3) {
			if (!this.isRadiusLocked && !this.popup.isRadiusLocked()) {
				if (this.radius === null) {
					this.radius = this.computeArcSlotRadiusFromCursor(world);
				}
			}
			if (this.radius === null) return;
			this.commitArcSlot();
		}
	}

	// =========================================================================
	// Geometry Computations
	// =========================================================================

	private computeLinearSecondPoint(effectiveWorld: Vec2): Vec2 {
		const p1 = this.firstWorldPos!;
		const vx = effectiveWorld.x - p1.x;
		const vy = effectiveWorld.y - p1.y;
		const d = Math.hypot(vx, vy);

		if (this.isDistanceLocked || this.popup.isDistanceLocked()) {
			const dirX = d > 1e-4 ? vx / d : 1;
			const dirY = d > 1e-4 ? vy / d : 0;
			return vec(p1.x + dirX * this.distance, p1.y + dirY * this.distance);
		}
		return effectiveWorld;
	}

	private computeLinearCenters(
		p1: Vec2,
		p2: Vec2,
		radius: number
	): { c1: Vec2; c2: Vec2; u: Vec2; n: Vec2; effectiveR: number } {
		const vx = p2.x - p1.x;
		const vy = p2.y - p1.y;
		const len = Math.hypot(vx, vy);
		const u = len > 1e-4 ? vec(vx / len, vy / len) : vec(1, 0);
		const n = vec(-u.y, u.x);

		if (this._mode === 'center_to_center') {
			return { c1: p1, c2: p2, u, n, effectiveR: Math.max(0.1, radius) };
		} else if (this._mode === 'center_point') {
			// p1 is midpoint M, p2 is C1; C2 is 2*M - C1
			const c2 = vec(2 * p1.x - p2.x, 2 * p1.y - p2.y);
			return { c1: c2, c2: p2, u, n, effectiveR: Math.max(0.1, radius) };
		} else {
			// overall mode: p1 is outer edge E1, p2 is outer edge E2
			const maxR = Math.max(0.1, len / 2 - 0.1);
			const effectiveR = Math.max(0.1, Math.min(radius, maxR));
			const c1 = vec(p1.x + u.x * effectiveR, p1.y + u.y * effectiveR);
			const c2 = vec(p2.x - u.x * effectiveR, p2.y - u.y * effectiveR);
			return { c1, c2, u, n, effectiveR };
		}
	}

	private computeLinearRadiusFromCursor(effectiveWorld: Vec2): number {
		const p1 = this.firstWorldPos!;
		const p2 = this.secondWorldPos!;

		if (this._mode === 'overall') {
			const vx = p2.x - p1.x;
			const vy = p2.y - p1.y;
			const len = Math.hypot(vx, vy);
			const u = len > 1e-4 ? vec(vx / len, vy / len) : vec(1, 0);
			const n = vec(-u.y, u.x);
			const perpDist = Math.abs((effectiveWorld.x - p1.x) * n.x + (effectiveWorld.y - p1.y) * n.y);
			const maxR = Math.max(0.1, len / 2 - 0.1);
			return Math.max(0.1, Math.min(perpDist > 0.1 ? perpDist : dist(p2, effectiveWorld), maxR));
		}

		const { c1, c2 } = this.computeLinearCenters(p1, p2, this.radius ?? 10);
		const { dist: d } = projectPointOntoSegment(effectiveWorld, c1, c2);
		return Math.max(0.1, d);
	}

	private updateCenterArcSweep(effectiveWorld: Vec2): void {
		const center = this.arcCenterWorld!;
		const start = this.arcStartWorld!;
		const rArc = this.arcRadius;

		const theta1 = Math.atan2(start.y - center.y, start.x - center.x);
		const thetaCur = Math.atan2(effectiveWorld.y - center.y, effectiveWorld.x - center.x);

		if (this.arcCenterPrevAngle === null) {
			this.arcCenterPrevAngle = theta1;
			this.arcCenterTotalAngle = 0;
		}

		let dTheta = thetaCur - this.arcCenterPrevAngle;
		while (dTheta > Math.PI) dTheta -= TWO_PI;
		while (dTheta < -Math.PI) dTheta += TWO_PI;

		this.arcCenterTotalAngle += dTheta;
		this.arcCenterPrevAngle = thetaCur;
		this.arcCenterTotalAngle = this.arcCenterTotalAngle % TWO_PI;

		let sweepSign = this.arcCenterTotalAngle >= 0 ? 1 : -1;
		if (Math.abs(this.arcCenterTotalAngle) < 1e-4) {
			let delta = thetaCur - theta1;
			while (delta > Math.PI) delta -= TWO_PI;
			while (delta < -Math.PI) delta += TWO_PI;
			sweepSign = delta >= 0 ? 1 : -1;
		}
		this.arcWorldSweepSign = sweepSign;

		if (!this.isAngleLocked && !this.popup.isAngleLocked()) {
			const rawSweep =
				sweepSign > 0
					? ((thetaCur - theta1) % TWO_PI + TWO_PI) % TWO_PI
					: ((theta1 - thetaCur) % TWO_PI + TWO_PI) % TWO_PI;
			const clampedSweep = Math.max(0.01, Math.min(TWO_PI - 0.01, rawSweep));
			this.angle = (clampedSweep * 180) / Math.PI;
		}

		this.applyLockedCenterArcAngle(rArc);
	}

	private applyLockedCenterArcAngle(rArc = this.arcRadius): void {
		const center = this.arcCenterWorld!;
		const start = this.arcStartWorld!;
		const theta1 = Math.atan2(start.y - center.y, start.x - center.x);
		const sweepSign = this.arcWorldSweepSign || 1;
		const sweepRad = (Math.max(0.1, Math.min(359.9, this.angle)) * Math.PI) / 180;

		const theta2 = theta1 + sweepSign * sweepRad;
		this.arcEndWorld = vec(center.x + rArc * Math.cos(theta2), center.y + rArc * Math.sin(theta2));
	}

	private computeArcSlotRadiusFromCursor(effectiveWorld: Vec2): number {
		const center = this.arcCenterWorld!;
		const d = dist(center, effectiveWorld);
		const rawR = Math.abs(d - this.arcRadius);
		const maxR = Math.max(0.1, this.arcRadius - 0.5);
		return Math.max(0.1, Math.min(rawR, maxR));
	}

	private computeArcSlotGeometry(
		center: Vec2,
		c1: Vec2,
		c2: Vec2,
		rArc: number,
		sweepSign: number,
		slotRadius: number
	): {
		effectiveR: number;
		p1Inner: Vec2;
		p1Outer: Vec2;
		p2Inner: Vec2;
		p2Outer: Vec2;
		midCenterArc: Vec2;
		midOuterArc: Vec2;
		midInnerArc: Vec2;
		midCap1: Vec2;
		midCap2: Vec2;
	} {
		const maxR = Math.max(0.1, rArc - 0.5);
		const effectiveR = Math.max(0.1, Math.min(slotRadius, maxR));

		const theta1 = Math.atan2(c1.y - center.y, c1.x - center.x);
		const theta2 = Math.atan2(c2.y - center.y, c2.x - center.x);

		const ccwSpan = ((theta2 - theta1) % TWO_PI + TWO_PI) % TWO_PI;
		const span = sweepSign > 0 ? ccwSpan : (TWO_PI - ccwSpan) % TWO_PI;
		const thetaMid = theta1 + sweepSign * (span * 0.5);

		const r1 = vec(Math.cos(theta1), Math.sin(theta1));
		const r2 = vec(Math.cos(theta2), Math.sin(theta2));
		const rMid = vec(Math.cos(thetaMid), Math.sin(thetaMid));

		// Unit tangents pointing from C1 toward C2 along the arc
		const t1 = vec(sweepSign * -r1.y, sweepSign * r1.x);
		const t2 = vec(sweepSign * -r2.y, sweepSign * r2.x);

		const p1Outer = vec(center.x + (rArc + effectiveR) * r1.x, center.y + (rArc + effectiveR) * r1.y);
		const p1Inner = vec(center.x + (rArc - effectiveR) * r1.x, center.y + (rArc - effectiveR) * r1.y);
		const p2Outer = vec(center.x + (rArc + effectiveR) * r2.x, center.y + (rArc + effectiveR) * r2.y);
		const p2Inner = vec(center.x + (rArc - effectiveR) * r2.x, center.y + (rArc - effectiveR) * r2.y);

		const midCenterArc = vec(center.x + rArc * rMid.x, center.y + rArc * rMid.y);
		const midOuterArc = vec(center.x + (rArc + effectiveR) * rMid.x, center.y + (rArc + effectiveR) * rMid.y);
		const midInnerArc = vec(center.x + (rArc - effectiveR) * rMid.x, center.y + (rArc - effectiveR) * rMid.y);
		const midCap1 = vec(c1.x - effectiveR * t1.x, c1.y - effectiveR * t1.y);
		const midCap2 = vec(c2.x + effectiveR * t2.x, c2.y + effectiveR * t2.y);

		return {
			effectiveR,
			p1Inner,
			p1Outer,
			p2Inner,
			p2Outer,
			midCenterArc,
			midOuterArc,
			midInnerArc,
			midCap1,
			midCap2,
		};
	}

	// =========================================================================
	// Preview Rendering
	// =========================================================================

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.drawingStep === 0 || !this.firstWorldPos) return;

		const effectiveWorld = this.shouldSnap() && ctx.snap ? ctx.snap.worldPos : ctx.cursorWorld;
		const previewAttrs = getPreviewStrokeAttrs(ctx.isConstruction);

		if (this.isLinearMode()) {
			const p1 = this.firstWorldPos;
			const p2 =
				this.drawingStep === 2 && this.secondWorldPos
					? this.secondWorldPos
					: this.computeLinearSecondPoint(effectiveWorld);

			const hasRadius = this.radius !== null;
			const { c1, c2, u, n, effectiveR } = this.computeLinearCenters(p1, p2, this.radius ?? 0);

			const sc1 = ctx.viewport.worldToScreen(c1.x, c1.y);
			const sc2 = ctx.viewport.worldToScreen(c2.x, c2.y);
			createSvgLine(sc1.x, sc1.y, sc2.x, sc2.y, AUX_AXIS_ATTRS, ctx.targetGroup);
			createSvgCircle(sc1.x, sc1.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
			createSvgCircle(sc2.x, sc2.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

			if (this._mode === 'center_point') {
				const sm = ctx.viewport.worldToScreen(p1.x, p1.y);
				createSvgCircle(sm.x, sm.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
			} else if (this._mode === 'overall') {
				const se1 = ctx.viewport.worldToScreen(p1.x, p1.y);
				const se2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				createSvgCircle(se1.x, se1.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
				createSvgCircle(se2.x, se2.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
			}

			if (hasRadius && (this.drawingStep === 2 || this.isRadiusLocked || this.popup.isRadiusLocked())) {
				const pt1 = vec(c1.x + effectiveR * n.x, c1.y + effectiveR * n.y);
				const pt2 = vec(c2.x + effectiveR * n.x, c2.y + effectiveR * n.y);
				const pt3 = vec(c2.x - effectiveR * n.x, c2.y - effectiveR * n.y);
				const pt4 = vec(c1.x - effectiveR * n.x, c1.y - effectiveR * n.y);

				const sPt1 = ctx.viewport.worldToScreen(pt1.x, pt1.y);
				const sPt2 = ctx.viewport.worldToScreen(pt2.x, pt2.y);
				const sPt3 = ctx.viewport.worldToScreen(pt3.x, pt3.y);
				const sPt4 = ctx.viewport.worldToScreen(pt4.x, pt4.y);
				const sr = effectiveR * ctx.viewport.zoom;

				createSvgLine(sPt1.x, sPt1.y, sPt2.x, sPt2.y, previewAttrs, ctx.targetGroup);
				createSvgLine(sPt3.x, sPt3.y, sPt4.x, sPt4.y, previewAttrs, ctx.targetGroup);

				const mid1 = vec(c1.x - effectiveR * u.x, c1.y - effectiveR * u.y);
				const mid2 = vec(c2.x + effectiveR * u.x, c2.y + effectiveR * u.y);
				const cw1 = isArcClockwiseThroughPoint(ctx.viewport, c1, pt4, pt1, mid1);
				const cw2 = isArcClockwiseThroughPoint(ctx.viewport, c2, pt2, pt3, mid2);

				createSvgPath(getArcSvgPath(sc1, sPt4, sPt1, sr, cw1), previewAttrs, ctx.targetGroup);
				createSvgPath(getArcSvgPath(sc2, sPt2, sPt3, sr, cw2), previewAttrs, ctx.targetGroup);
			}
			return;
		}

		if (this._mode === 'three_point_arc') {
			const s1 = ctx.viewport.worldToScreen(this.firstWorldPos.x, this.firstWorldPos.y);
			createSvgCircle(s1.x, s1.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

			if (this.drawingStep === 1) {
				const p2 = this.computeLinearSecondPoint(effectiveWorld);
				const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				createSvgLine(s1.x, s1.y, s2.x, s2.y, AUX_AXIS_ATTRS, ctx.targetGroup);
				createSvgCircle(s2.x, s2.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
				return;
			}

			if (this.drawingStep === 2 && this.secondWorldPos) {
				const p1 = this.firstWorldPos;
				const p2 = this.secondWorldPos;
				const p3 = ctx.cursorWorld;
				const circum = getCircumcircle(p1, p2, p3);
				const s2 = ctx.viewport.worldToScreen(p2.x, p2.y);
				createSvgCircle(s2.x, s2.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

				if (!circum || circum.radius < 1 || circum.radius > 50000) {
					createSvgLine(s1.x, s1.y, s2.x, s2.y, AUX_AXIS_ATTRS, ctx.targetGroup);
					return;
				}

				const theta1 = Math.atan2(p1.y - circum.center.y, p1.x - circum.center.x);
				const theta2 = Math.atan2(p2.y - circum.center.y, p2.x - circum.center.x);
				const theta3 = Math.atan2(p3.y - circum.center.y, p3.x - circum.center.x);
				const ccwSpan = ((theta2 - theta1) % TWO_PI + TWO_PI) % TWO_PI;
				const ccwMid = ((theta3 - theta1) % TWO_PI + TWO_PI) % TWO_PI;
				const sweepSign = ccwMid > 0 && ccwMid < ccwSpan ? 1 : -1;

				this.renderArcSlotPreviewGeometry(
					ctx,
					circum.center,
					p1,
					p2,
					circum.radius,
					sweepSign,
					this.radius,
					this.radius !== null && (this.isRadiusLocked || this.popup.isRadiusLocked())
				);
				return;
			}

			if (this.drawingStep === 3 && this.arcCenterWorld && this.arcStartWorld && this.arcEndWorld) {
				this.renderArcSlotPreviewGeometry(
					ctx,
					this.arcCenterWorld,
					this.arcStartWorld,
					this.arcEndWorld,
					this.arcRadius,
					this.arcWorldSweepSign,
					this.radius,
					this.radius !== null
				);
			}
			return;
		}

		if (this._mode === 'center_point_arc') {
			const center = this.arcCenterWorld!;
			const sCenter = ctx.viewport.worldToScreen(center.x, center.y);
			createSvgCircle(sCenter.x, sCenter.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

			if (this.drawingStep === 1) {
				const p1 = this.computeLinearSecondPoint(effectiveWorld);
				const sCur = ctx.viewport.worldToScreen(p1.x, p1.y);
				const rScreen = dist(center, p1) * ctx.viewport.zoom;
				createSvgLine(sCenter.x, sCenter.y, sCur.x, sCur.y, AUX_RAY_ATTRS, ctx.targetGroup);
				createSvgCircle(sCenter.x, sCenter.y, rScreen, GUIDE_OUTLINE_ATTRS, ctx.targetGroup);
				createSvgCircle(sCur.x, sCur.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
				return;
			}

			if (this.drawingStep === 2 && this.arcStartWorld) {
				const c2 = this.arcEndWorld ?? effectiveWorld;
				this.renderArcSlotPreviewGeometry(
					ctx,
					center,
					this.arcStartWorld,
					c2,
					this.arcRadius,
					this.arcWorldSweepSign,
					this.radius,
					this.radius !== null && (this.isRadiusLocked || this.popup.isRadiusLocked())
				);
				return;
			}

			if (this.drawingStep === 3 && this.arcStartWorld && this.arcEndWorld) {
				this.renderArcSlotPreviewGeometry(
					ctx,
					center,
					this.arcStartWorld,
					this.arcEndWorld,
					this.arcRadius,
					this.arcWorldSweepSign,
					this.radius,
					this.radius !== null
				);
			}
		}
	}

	private renderArcSlotPreviewGeometry(
		ctx: ToolRenderContext,
		center: Vec2,
		c1: Vec2,
		c2: Vec2,
		rArc: number,
		sweepSign: number,
		slotRadius: number | null,
		drawSlotOutline: boolean
	): void {
		const geom = this.computeArcSlotGeometry(center, c1, c2, rArc, sweepSign, slotRadius ?? 1);
		const sCenter = ctx.viewport.worldToScreen(center.x, center.y);
		const sc1 = ctx.viewport.worldToScreen(c1.x, c1.y);
		const sc2 = ctx.viewport.worldToScreen(c2.x, c2.y);

		// Centerline arc and key points (no radial construction lines)
		createSvgCircle(sCenter.x, sCenter.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
		createSvgCircle(sc1.x, sc1.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);
		createSvgCircle(sc2.x, sc2.y, 3, POLYGON_CENTER_ATTRS, ctx.targetGroup);

		const cwCenter = isArcClockwiseThroughPoint(ctx.viewport, center, c1, c2, geom.midCenterArc);
		createSvgPath(
			getArcSvgPath(sCenter, sc1, sc2, rArc * ctx.viewport.zoom, cwCenter),
			{ ...AUX_AXIS_ATTRS, fill: 'none' },
			ctx.targetGroup
		);

		if (!drawSlotOutline || slotRadius === null) return;

		const previewAttrs = getPreviewStrokeAttrs(ctx.isConstruction);
		const sP1In = ctx.viewport.worldToScreen(geom.p1Inner.x, geom.p1Inner.y);
		const sP1Out = ctx.viewport.worldToScreen(geom.p1Outer.x, geom.p1Outer.y);
		const sP2In = ctx.viewport.worldToScreen(geom.p2Inner.x, geom.p2Inner.y);
		const sP2Out = ctx.viewport.worldToScreen(geom.p2Outer.x, geom.p2Outer.y);

		const cwOuter = isArcClockwiseThroughPoint(ctx.viewport, center, geom.p1Outer, geom.p2Outer, geom.midOuterArc);
		const cwInner = isArcClockwiseThroughPoint(ctx.viewport, center, geom.p1Inner, geom.p2Inner, geom.midInnerArc);
		const cwCap1 = isArcClockwiseThroughPoint(ctx.viewport, c1, geom.p1Inner, geom.p1Outer, geom.midCap1);
		const cwCap2 = isArcClockwiseThroughPoint(ctx.viewport, c2, geom.p2Outer, geom.p2Inner, geom.midCap2);

		const rOuterScreen = (rArc + geom.effectiveR) * ctx.viewport.zoom;
		const rInnerScreen = (rArc - geom.effectiveR) * ctx.viewport.zoom;
		const rCapScreen = geom.effectiveR * ctx.viewport.zoom;

		createSvgPath(getArcSvgPath(sCenter, sP1Out, sP2Out, rOuterScreen, cwOuter), previewAttrs, ctx.targetGroup);
		createSvgPath(getArcSvgPath(sCenter, sP1In, sP2In, rInnerScreen, cwInner), previewAttrs, ctx.targetGroup);
		createSvgPath(getArcSvgPath(sc1, sP1In, sP1Out, rCapScreen, cwCap1), previewAttrs, ctx.targetGroup);
		createSvgPath(getArcSvgPath(sc2, sP2Out, sP2In, rCapScreen, cwCap2), previewAttrs, ctx.targetGroup);
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab') {
			if (this.drawingStep > 0 && this.popup.isOpen()) {
				e.preventDefault();
				this.popup.cycleFocus(e.shiftKey);
				return true;
			}
		} else if (e.key === 'Enter') {
			if (this.drawingStep > 0 && this.firstWorldPos) {
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
		this.firstWorldPos = null;
		this.secondWorldPos = null;
		this.lastEffectiveWorld = null;
		this.firstSnap = null;
		this.secondSnap = null;
		this.thirdSnap = null;

		this.arcCenterWorld = null;
		this.arcStartWorld = null;
		this.arcEndWorld = null;
		this.arcRadius = 50;
		this.arcCenterPrevAngle = null;
		this.arcCenterTotalAngle = 0;
		this.arcWorldSweepSign = 1;

		this.isDistanceLocked = false;
		this.isAngleLocked = false;
		this.isRadiusLocked = false;
		this.distance = 50;
		this.angle = 90;
		this.radius = null;
		this.popup.resetValues(50, 90, null);
		this.updateToastHint();
		this.onStateChange?.();
	}

	private commitFromCurrentValues(): void {
		if (this.radius === null) return;

		if (this.isLinearMode()) {
			if (!this.firstWorldPos) return;
			if (!this.secondWorldPos) {
				const eff = this.lastEffectiveWorld ?? vec(this.firstWorldPos.x + this.distance, this.firstWorldPos.y);
				this.secondWorldPos = this.computeLinearSecondPoint(eff);
			}
			this.commitLinearSlot();
			return;
		}

		if (this._mode === 'center_point_arc' && this.arcCenterWorld && this.arcStartWorld) {
			if (!this.arcEndWorld) {
				this.applyLockedCenterArcAngle();
			}
			this.commitArcSlot();
			return;
		}

		if (this._mode === 'three_point_arc' && this.arcCenterWorld && this.arcStartWorld && this.arcEndWorld) {
			this.commitArcSlot();
		}
	}

	// =========================================================================
	// Commit Methods
	// =========================================================================

	private addOrReusePoint(pos: Vec2, snap: SnapResult | null, excludeIds: string[] = []): string {
		const { sketch } = this.ctx;
		if (
			snap &&
			snap.type === 'point' &&
			snap.id &&
			sketch.points.has(snap.id) &&
			!excludeIds.includes(snap.id)
		) {
			return snap.id;
		}
		const pt = sketch.addPoint(pos.x, pos.y);
		if (snap) {
			this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
		}
		return pt.id;
	}

	private commitLinearSlot(): void {
		if (this.radius === null) return;
		const { sketch } = this.ctx;
		const p1 = this.firstWorldPos!;
		const p2 = this.secondWorldPos!;
		const { c1, c2, u, n, effectiveR } = this.computeLinearCenters(p1, p2, this.radius);

		const isConst = this.ctx.isConstructionMode;
		const distLocked = this.isDistanceLocked || this.popup.isDistanceLocked();
		const radLocked = this.isRadiusLocked || this.popup.isRadiusLocked();

		let c1Id: string;
		let c2Id: string;
		let centerMidPtId: string | null = null;
		let edge1PtId: string | null = null;
		let edge2PtId: string | null = null;

		if (this._mode === 'center_to_center') {
			c1Id = this.addOrReusePoint(c1, this.firstSnap);
			c2Id = this.addOrReusePoint(c2, this.secondSnap, [c1Id]);
		} else if (this._mode === 'center_point') {
			centerMidPtId = this.addOrReusePoint(p1, this.firstSnap);
			const ptC1 = sketch.addPoint(c1.x, c1.y);
			c1Id = ptC1.id;
			c2Id = this.addOrReusePoint(c2, this.secondSnap, [centerMidPtId, c1Id]);
		} else {
			// overall mode: p1 and p2 are the outer edge points E1 and E2
			edge1PtId = this.addOrReusePoint(p1, this.firstSnap);
			edge2PtId = this.addOrReusePoint(p2, this.secondSnap, [edge1PtId]);
			const ptC1 = sketch.addPoint(c1.x, c1.y);
			const ptC2 = sketch.addPoint(c2.x, c2.y);
			c1Id = ptC1.id;
			c2Id = ptC2.id;
		}

		// 4 tangent points on the straight sides
		const pt1Pos = vec(c1.x + effectiveR * n.x, c1.y + effectiveR * n.y);
		const pt2Pos = vec(c2.x + effectiveR * n.x, c2.y + effectiveR * n.y);
		const pt3Pos = vec(c2.x - effectiveR * n.x, c2.y - effectiveR * n.y);
		const pt4Pos = vec(c1.x - effectiveR * n.x, c1.y - effectiveR * n.y);

		const pt1 = sketch.addPoint(pt1Pos.x, pt1Pos.y);
		const pt2 = sketch.addPoint(pt2Pos.x, pt2Pos.y);
		const pt3 = sketch.addPoint(pt3Pos.x, pt3Pos.y);
		const pt4 = sketch.addPoint(pt4Pos.x, pt4Pos.y);

		// Centerline construction line and side lines
		const axisLine = sketch.addLine(c1Id, c2Id, true);
		const topLine = sketch.addLine(pt1.id, pt2.id, isConst);
		const bottomLine = sketch.addLine(pt3.id, pt4.id, isConst);

		// End-cap arcs
		const mid1 = vec(c1.x - effectiveR * u.x, c1.y - effectiveR * u.y);
		const mid2 = vec(c2.x + effectiveR * u.x, c2.y + effectiveR * u.y);
		const cw1 = isArcClockwiseThroughPoint(this.ctx.viewport, c1, pt4Pos, pt1Pos, mid1);
		const cw2 = isArcClockwiseThroughPoint(this.ctx.viewport, c2, pt2Pos, pt3Pos, mid2);

		const arc1 = sketch.addArc(c1Id, pt4.id, pt1.id, effectiveR, cw1, isConst);
		const arc2 = sketch.addArc(c2Id, pt2.id, pt3.id, effectiveR, cw2, isConst);

		// Geometric constraints
		sketch.addTangentConstraint(topLine.id, arc1.id);
		sketch.addTangentConstraint(topLine.id, arc2.id);
		sketch.addTangentConstraint(bottomLine.id, arc1.id);
		sketch.addTangentConstraint(bottomLine.id, arc2.id);
		sketch.addEqualRadiusConstraint(arc1.id, arc2.id);

		if (this._mode === 'center_point' && centerMidPtId) {
			sketch.addMidpointConstraint(centerMidPtId, axisLine.id);
		}

		if (this._mode === 'overall' && edge1PtId && edge2PtId) {
			sketch.addPointOnCircleConstraint(edge1PtId, arc1.id);
			sketch.addPointOnLineConstraint(edge1PtId, axisLine.id);
			sketch.addPointOnCircleConstraint(edge2PtId, arc2.id);
			sketch.addPointOnLineConstraint(edge2PtId, axisLine.id);
		}

		// Dimensional constraints when locked
		if (distLocked) {
			if (this._mode === 'center_to_center') {
				sketch.addDistanceConstraint(c1Id, c2Id, this.distance);
			} else if (this._mode === 'center_point' && centerMidPtId) {
				sketch.addDistanceConstraint(centerMidPtId, c2Id, this.distance);
			} else if (this._mode === 'overall' && edge1PtId && edge2PtId) {
				sketch.addDistanceConstraint(edge1PtId, edge2PtId, this.distance);
			}
		}

		if (radLocked) {
			sketch.addRadiusConstraint(arc1.id, effectiveR);
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Slot created');
	}

	private commitArcSlot(): void {
		if (this.radius === null) return;
		const { sketch } = this.ctx;
		const center = this.arcCenterWorld!;
		const c1 = this.arcStartWorld!;
		const c2 = this.arcEndWorld!;
		const rArc = this.arcRadius;
		const sweepSign = this.arcWorldSweepSign || 1;

		const geom = this.computeArcSlotGeometry(center, c1, c2, rArc, sweepSign, this.radius);
		const isConst = this.ctx.isConstructionMode;
		const distLocked = this.isDistanceLocked || this.popup.isDistanceLocked();
		const angleLocked = this.isAngleLocked || this.popup.isAngleLocked();
		const radLocked = this.isRadiusLocked || this.popup.isRadiusLocked();

		let centerId: string;
		let c1Id: string;
		let c2Id: string;

		if (this._mode === 'center_point_arc') {
			centerId = this.addOrReusePoint(center, this.firstSnap);
			c1Id = this.addOrReusePoint(c1, this.secondSnap, [centerId]);
			c2Id = this.addOrReusePoint(c2, this.thirdSnap, [centerId, c1Id]);
		} else {
			// three_point_arc: firstSnap = c1, secondSnap = c2
			c1Id = this.addOrReusePoint(c1, this.firstSnap);
			c2Id = this.addOrReusePoint(c2, this.secondSnap, [c1Id]);
			const ptCenter = sketch.addPoint(center.x, center.y);
			centerId = ptCenter.id;
		}

		const p1In = sketch.addPoint(geom.p1Inner.x, geom.p1Inner.y);
		const p1Out = sketch.addPoint(geom.p1Outer.x, geom.p1Outer.y);
		const p2In = sketch.addPoint(geom.p2Inner.x, geom.p2Inner.y);
		const p2Out = sketch.addPoint(geom.p2Outer.x, geom.p2Outer.y);

		const cwCenter = isArcClockwiseThroughPoint(this.ctx.viewport, center, c1, c2, geom.midCenterArc);
		const cwOuter = isArcClockwiseThroughPoint(this.ctx.viewport, center, geom.p1Outer, geom.p2Outer, geom.midOuterArc);
		const cwInner = isArcClockwiseThroughPoint(this.ctx.viewport, center, geom.p1Inner, geom.p2Inner, geom.midInnerArc);
		const cwCap1 = isArcClockwiseThroughPoint(this.ctx.viewport, c1, geom.p1Inner, geom.p1Outer, geom.midCap1);
		const cwCap2 = isArcClockwiseThroughPoint(this.ctx.viewport, c2, geom.p2Outer, geom.p2Inner, geom.midCap2);

		// Centerline construction arc + 4 boundary arcs (no radial construction lines)
		const centerArc = sketch.addArc(centerId, c1Id, c2Id, rArc, cwCenter, true);
		const outerArc = sketch.addArc(centerId, p1Out.id, p2Out.id, rArc + geom.effectiveR, cwOuter, isConst);
		const innerArc = sketch.addArc(centerId, p1In.id, p2In.id, rArc - geom.effectiveR, cwInner, isConst);
		const cap1 = sketch.addArc(c1Id, p1In.id, p1Out.id, geom.effectiveR, cwCap1, isConst);
		const cap2 = sketch.addArc(c2Id, p2Out.id, p2In.id, geom.effectiveR, cwCap2, isConst);

		// Geometric constraints
		sketch.addTangentConstraint(outerArc.id, cap1.id);
		sketch.addTangentConstraint(outerArc.id, cap2.id);
		sketch.addTangentConstraint(innerArc.id, cap1.id);
		sketch.addTangentConstraint(innerArc.id, cap2.id);
		sketch.addEqualRadiusConstraint(cap1.id, cap2.id);

		// Dimensional constraints when locked
		if (distLocked) {
			if (this._mode === 'three_point_arc') {
				sketch.addDistanceConstraint(c1Id, c2Id, this.distance);
			} else if (this._mode === 'center_point_arc') {
				sketch.addRadiusConstraint(centerArc.id, rArc);
			}
		}

		if (this._mode === 'center_point_arc' && angleLocked) {
			sketch.addArcAngleConstraint(centerArc.id, this.angle, rArc * 0.5, sweepSign);
		}

		if (radLocked) {
			sketch.addRadiusConstraint(cap1.id, geom.effectiveR);
		}

		sketch.commitTransaction();
		sketch.solve();

		this.popup.hide();
		this.resetState();
		this.ctx.requestRender();
		this.ctx.showToast('Arc slot created');
	}
}

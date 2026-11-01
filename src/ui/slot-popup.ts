import type { Vec2 } from '../math/vector';
import { parseNumericOrExpression, getExpressionIfValid } from '../math/expression';
import type { SketchDocument } from '../model/sketch';
import { updateExpressionPreview } from './expression-preview';

const LOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>`;
const UNLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z"/></svg>`;

export type SlotMode =
	| 'center_to_center'
	| 'center_point'
	| 'overall'
	| 'three_point_arc'
	| 'center_point_arc';

export type SlotPopupField = 'distance' | 'angle' | 'radius';

export class SlotPopup {
	private container!: HTMLElement;
	private sketch?: SketchDocument;

	public setSketch(sketch: SketchDocument): void {
		this.sketch = sketch;
	}
	private distanceRow!: HTMLElement;
	private distanceLabel!: HTMLElement;
	private angleRow!: HTMLElement;
	private radiusRow!: HTMLElement;

	private distanceInput!: HTMLInputElement;
	private angleInput!: HTMLInputElement;
	private radiusInput!: HTMLInputElement;

	private distanceLockBtn!: HTMLButtonElement;
	private angleLockBtn!: HTMLButtonElement;
	private radiusLockBtn!: HTMLButtonElement;

	private _isOpen = false;
	private _mode: SlotMode = 'center_to_center';
	private _isDistanceLocked = false;
	private _isAngleLocked = false;
	private _isRadiusLocked = false;
	private _isRadiusVisible = false;

	public onValuesChange?: (
		distance: number,
		angle: number,
		radius: number | null,
		isDistanceLocked: boolean,
		isAngleLocked: boolean,
		isRadiusLocked: boolean
	) => void;
	public onFieldLocked?: (field: SlotPopupField) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;

	constructor(sketch?: SketchDocument) {
		this.sketch = sketch;
		if (typeof document === 'undefined') {
			return;
		}

		this.container = document.createElement('div');
		this.container.className = 'slot-popup rectangle-popup hidden';
		this.container.innerHTML = `
			<div class="rectangle-popup-row" data-row="distance">
				<label class="rectangle-popup-label" id="slot-distance-label" for="slot-distance-input">Length</label>
				<div class="rectangle-input-wrapper">
					<input type="text" id="slot-distance-input" value="50.0" autocomplete="off" spellcheck="false" />
					<span class="rectangle-unit">mm</span>
					<button type="button" class="rectangle-lock-btn" id="slot-distance-lock" title="Lock distance dimension">
						${UNLOCK_ICON}
					</button>
				</div>
				<div class="dim-eval-preview hidden" id="slot-distance-eval-preview"></div>
			</div>
			<div class="rectangle-popup-row hidden" data-row="angle">
				<label class="rectangle-popup-label" for="slot-angle-input">Angle</label>
				<div class="rectangle-input-wrapper">
					<input type="text" id="slot-angle-input" value="90.0" autocomplete="off" spellcheck="false" />
					<span class="rectangle-unit">°</span>
					<button type="button" class="rectangle-lock-btn" id="slot-angle-lock" title="Lock sweep angle">
						${UNLOCK_ICON}
					</button>
				</div>
				<div class="dim-eval-preview hidden" id="slot-angle-eval-preview"></div>
			</div>
			<div class="rectangle-popup-row hidden" data-row="radius">
				<label class="rectangle-popup-label" for="slot-radius-input">Radius</label>
				<div class="rectangle-input-wrapper">
					<input type="text" id="slot-radius-input" value="" placeholder="—" autocomplete="off" spellcheck="false" />
					<span class="rectangle-unit">mm</span>
					<button type="button" class="rectangle-lock-btn" id="slot-radius-lock" title="Lock slot radius">
						${UNLOCK_ICON}
					</button>
				</div>
				<div class="dim-eval-preview hidden" id="slot-radius-eval-preview"></div>
			</div>
		`;
		document.body.appendChild(this.container);

		this.distanceRow = this.container.querySelector<HTMLElement>('[data-row="distance"]')!;
		this.distanceLabel = this.container.querySelector<HTMLElement>('#slot-distance-label')!;
		this.angleRow = this.container.querySelector<HTMLElement>('[data-row="angle"]')!;
		this.radiusRow = this.container.querySelector<HTMLElement>('[data-row="radius"]')!;

		this.distanceInput = this.container.querySelector<HTMLInputElement>('#slot-distance-input')!;
		this.angleInput = this.container.querySelector<HTMLInputElement>('#slot-angle-input')!;
		this.radiusInput = this.container.querySelector<HTMLInputElement>('#slot-radius-input')!;

		this.distanceLockBtn = this.container.querySelector<HTMLButtonElement>('#slot-distance-lock')!;
		this.angleLockBtn = this.container.querySelector<HTMLButtonElement>('#slot-angle-lock')!;
		this.radiusLockBtn = this.container.querySelector<HTMLButtonElement>('#slot-radius-lock')!;

		this.setupEvents();
	}

	private setupEvents(): void {
		if (!this.container) return;

		this.container.addEventListener('mousedown', e => e.stopPropagation());
		this.container.addEventListener('click', e => e.stopPropagation());

		// Live input events update preview without advancing step on every keystroke
		this.distanceInput.addEventListener('input', () => {
			this._isDistanceLocked = true;
			this.updateLockVisual(this.distanceLockBtn, true);
			this.updateEvalPreviews();
			this.emitValuesChange();
		});

		this.angleInput.addEventListener('input', () => {
			this._isAngleLocked = true;
			this.updateLockVisual(this.angleLockBtn, true);
			this.updateEvalPreviews();
			this.emitValuesChange();
		});

		this.radiusInput.addEventListener('input', () => {
			const r = this.getRadius();
			if (r !== null) {
				this._isRadiusLocked = true;
				this.updateLockVisual(this.radiusLockBtn, true);
			}
			this.updateEvalPreviews();
			this.emitValuesChange();
		});

		// Lock button clicks lock/unlock and trigger onFieldLocked when locked
		this.distanceLockBtn.addEventListener('click', () => {
			this._isDistanceLocked = !this._isDistanceLocked;
			this.updateLockVisual(this.distanceLockBtn, this._isDistanceLocked);
			this.emitValuesChange();
			if (this._isDistanceLocked) {
				this.onFieldLocked?.('distance');
			}
		});

		this.angleLockBtn.addEventListener('click', () => {
			this._isAngleLocked = !this._isAngleLocked;
			this.updateLockVisual(this.angleLockBtn, this._isAngleLocked);
			this.emitValuesChange();
			if (this._isAngleLocked) {
				this.onFieldLocked?.('angle');
			}
		});

		this.radiusLockBtn.addEventListener('click', () => {
			if (!this._isRadiusLocked && this.getRadius() === null) {
				return;
			}
			this._isRadiusLocked = !this._isRadiusLocked;
			this.updateLockVisual(this.radiusLockBtn, this._isRadiusLocked);
			this.emitValuesChange();
			if (this._isRadiusLocked) {
				this.onFieldLocked?.('radius');
			}
		});

		const handleKeydown = (e: KeyboardEvent, field: SlotPopupField) => {
			if (e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				this.cycleFocus(e.shiftKey);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (field === 'distance') {
					this._isDistanceLocked = true;
					this.updateLockVisual(this.distanceLockBtn, true);
				} else if (field === 'angle') {
					this._isAngleLocked = true;
					this.updateLockVisual(this.angleLockBtn, true);
				} else if (field === 'radius') {
					if (this.getRadius() === null) return;
					this._isRadiusLocked = true;
					this.updateLockVisual(this.radiusLockBtn, true);
				}
				this.emitValuesChange();
				this.onFieldLocked?.(field);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel?.();
			}
		};

		this.distanceInput.addEventListener('keydown', e => handleKeydown(e, 'distance'));
		this.angleInput.addEventListener('keydown', e => handleKeydown(e, 'angle'));
		this.radiusInput.addEventListener('keydown', e => handleKeydown(e, 'radius'));
	}

	private getVisibleInputs(): HTMLInputElement[] {
		const list: HTMLInputElement[] = [];
		if (this.distanceInput && !this.distanceRow?.classList.contains('hidden')) {
			list.push(this.distanceInput);
		}
		if (this._mode === 'center_point_arc' && this.angleInput && !this.angleRow?.classList.contains('hidden')) {
			list.push(this.angleInput);
		}
		if (this._isRadiusVisible && this.radiusInput && !this.radiusRow?.classList.contains('hidden')) {
			list.push(this.radiusInput);
		}
		return list;
	}

	public cycleFocus(reverse = false): void {
		if (!this._isOpen || typeof document === 'undefined') return;
		const inputs = this.getVisibleInputs();
		if (inputs.length === 0) return;

		const active = document.activeElement as HTMLInputElement | null;
		const idx = active ? inputs.indexOf(active) : -1;
		if (idx === -1) {
			this.focusInput(reverse ? inputs[inputs.length - 1] : inputs[0]);
		} else {
			const nextIdx = (idx + (reverse ? inputs.length - 1 : 1)) % inputs.length;
			this.focusInput(inputs[nextIdx]);
		}
	}

	public focusField(field: SlotPopupField): void {
		if (!this._isOpen || typeof document === 'undefined') return;
		if (field === 'distance' && this.distanceInput) {
			this.focusInput(this.distanceInput);
		} else if (field === 'angle' && this.angleInput) {
			this.focusInput(this.angleInput);
		} else if (field === 'radius' && this._isRadiusVisible && this.radiusInput) {
			this.focusInput(this.radiusInput);
		}
	}

	private focusInput(input: HTMLInputElement): void {
		if (!input) return;
		input.focus();
		input.select();
		try {
			input.setSelectionRange(0, input.value.length);
		} catch {
			// Ignore for number inputs in browsers that restrict setSelectionRange
		}
	}

	private updateLockVisual(btn: HTMLButtonElement, isLocked: boolean): void {
		if (!btn) return;
		btn.classList.toggle('locked', isLocked);
		btn.innerHTML = isLocked ? LOCK_ICON : UNLOCK_ICON;
		btn.title = isLocked ? 'Locked (click to unlock)' : 'Unlocked (click to lock)';
	}

	private emitValuesChange(): void {
		this.onValuesChange?.(
			this.getDistance(),
			this.getAngle(),
			this.getRadius(),
			this._isDistanceLocked,
			this._isAngleLocked,
			this._isRadiusLocked
		);
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public isDistanceLocked(): boolean {
		return this._isDistanceLocked;
	}

	public isAngleLocked(): boolean {
		return this._isAngleLocked;
	}

	public isRadiusLocked(): boolean {
		return this._isRadiusLocked;
	}

	public isRadiusVisible(): boolean {
		return this._isRadiusVisible;
	}

	public setRadiusVisible(visible: boolean): void {
		this._isRadiusVisible = visible;
		if (this.radiusRow) {
			this.radiusRow.classList.toggle('hidden', !visible);
		}
	}

	public setDistanceLocked(locked: boolean): void {
		this._isDistanceLocked = locked;
		this.updateLockVisual(this.distanceLockBtn, locked);
	}

	public setAngleLocked(locked: boolean): void {
		this._isAngleLocked = locked;
		this.updateLockVisual(this.angleLockBtn, locked);
	}

	public setRadiusLocked(locked: boolean): void {
		this._isRadiusLocked = locked;
		this.updateLockVisual(this.radiusLockBtn, locked);
	}

	public getDistance(): number {
		if (!this.distanceInput) return 50;
		const val = parseNumericOrExpression(
			this.distanceInput.value,
			50,
			this.sketch?.getParameterValuesMap()
		);
		return isNaN(val) || val <= 0.01 ? 1 : val;
	}

	public getAngle(): number {
		if (!this.angleInput) return 90;
		const val = parseNumericOrExpression(
			this.angleInput.value,
			90,
			this.sketch?.getParameterValuesMap()
		);
		if (isNaN(val) || val <= 0.1) return 1;
		if (val >= 359.9) return 359.9;
		return val;
	}

	public getRadius(): number | null {
		if (!this.radiusInput) return null;
		const raw = this.radiusInput.value.trim();
		if (raw === '') return null;
		const val = parseNumericOrExpression(
			raw,
			NaN,
			this.sketch?.getParameterValuesMap()
		);
		return isNaN(val) || val <= 0.01 ? null : val;
	}

	public getDistanceExpression(): string | undefined {
		if (!this.distanceInput) return undefined;
		return getExpressionIfValid(this.distanceInput.value, this.sketch?.getParameterValuesMap());
	}

	public getAngleExpression(): string | undefined {
		if (!this.angleInput) return undefined;
		return getExpressionIfValid(this.angleInput.value, this.sketch?.getParameterValuesMap());
	}

	public getRadiusExpression(): string | undefined {
		if (!this.radiusInput) return undefined;
		return getExpressionIfValid(this.radiusInput.value, this.sketch?.getParameterValuesMap());
	}

	public setMode(mode: SlotMode): void {
		this._mode = mode;
		const hasAngle = mode === 'center_point_arc';

		if (this.distanceRow) {
			this.distanceRow.classList.remove('hidden');
		}
		if (this.distanceLabel) {
			if (mode === 'center_point_arc') {
				this.distanceLabel.textContent = 'Arc Radius';
			} else if (mode === 'center_point' || mode === 'three_point_arc') {
				this.distanceLabel.textContent = 'Distance';
			} else {
				this.distanceLabel.textContent = 'Length';
			}
		}
		if (this.angleRow) {
			this.angleRow.classList.toggle('hidden', !hasAngle);
		}
		if (this.radiusRow) {
			this.radiusRow.classList.toggle('hidden', !this._isRadiusVisible);
		}
	}

	public resetLocks(): void {
		this._isDistanceLocked = false;
		this._isAngleLocked = false;
		this._isRadiusLocked = false;
		this.updateLockVisual(this.distanceLockBtn, false);
		this.updateLockVisual(this.angleLockBtn, false);
		this.updateLockVisual(this.radiusLockBtn, false);
	}

	public resetValues(distance = 50, angle = 90, radius: number | null = null): void {
		this.resetLocks();
		this.setRadiusVisible(radius !== null);
		if (this.distanceInput) this.distanceInput.value = Number(Math.max(0.1, distance).toFixed(1)).toString();
		if (this.angleInput) this.angleInput.value = Number(Math.max(0.1, angle).toFixed(1)).toString();
		if (this.radiusInput) {
			this.radiusInput.value = radius !== null ? Number(Math.max(0.1, radius).toFixed(1)).toString() : '';
		}
		this.updateEvalPreviews();
	}

	public show(
		screenPos: Vec2,
		distance: number,
		angle: number,
		radius: number | null = null,
		mode: SlotMode = 'center_to_center'
	): void {
		this._isOpen = true;
		this.setRadiusVisible(radius !== null);
		this.setMode(mode);
		this.resetLocks();

		if (!this.container) return;

		if (this.distanceInput) this.distanceInput.value = Number(Math.max(0.1, distance).toFixed(1)).toString();
		if (this.angleInput) this.angleInput.value = Number(Math.max(0.1, angle).toFixed(1)).toString();
		if (this.radiusInput) {
			this.radiusInput.value = radius !== null ? Number(Math.max(0.1, radius).toFixed(1)).toString() : '';
		}
		this.updateEvalPreviews();

		this.container.classList.remove('hidden');
		this.updatePosition(screenPos);
	}

	public hide(): void {
		this._isOpen = false;
		if (!this.container) return;
		this.container.classList.add('hidden');
		this.distanceInput?.blur();
		this.angleInput?.blur();
		this.radiusInput?.blur();
	}

	public updatePosition(screenPos: Vec2): void {
		if (!this._isOpen || !this.container || typeof window === 'undefined') return;
		const popupWidth = 195;
		const popupHeight = 95;

		const left = Math.min(Math.max(screenPos.x + 120, 16), window.innerWidth - popupWidth - 16);
		const top = Math.min(Math.max(screenPos.y + 50, 16), window.innerHeight - popupHeight - 16);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public updateValues(distance: number, angle?: number, radius?: number | null): void {
		if (!this._isOpen || !this.container) return;
		if (!this._isDistanceLocked && this.distanceInput) {
			this.distanceInput.value = Number(Math.max(0.1, distance).toFixed(1)).toString();
		}
		if (angle !== undefined && !this._isAngleLocked && this.angleInput) {
			this.angleInput.value = Number(Math.max(0.1, angle).toFixed(1)).toString();
		}
		if (radius !== undefined && !this._isRadiusLocked && this.radiusInput) {
			this.radiusInput.value = radius !== null ? Number(Math.max(0.1, radius).toFixed(1)).toString() : '';
		}
		this.updateEvalPreviews();
	}

	public updateEvalPreviews(): void {
		const scope = this.sketch?.getParameterValuesMap();
		const distPrev = this.container?.querySelector<HTMLElement>('#slot-distance-eval-preview');
		const distWrap = typeof this.distanceInput?.closest === 'function' ? this.distanceInput.closest<HTMLElement>('.rectangle-input-wrapper') : null;
		if (this.distanceInput) {
			updateExpressionPreview(this.distanceInput.value, 'mm', distPrev ?? null, scope, distWrap);
		}

		const angPrev = this.container?.querySelector<HTMLElement>('#slot-angle-eval-preview');
		const angWrap = typeof this.angleInput?.closest === 'function' ? this.angleInput.closest<HTMLElement>('.rectangle-input-wrapper') : null;
		if (this.angleInput) {
			updateExpressionPreview(this.angleInput.value, '°', angPrev ?? null, scope, angWrap);
		}

		const radPrev = this.container?.querySelector<HTMLElement>('#slot-radius-eval-preview');
		const radWrap = typeof this.radiusInput?.closest === 'function' ? this.radiusInput.closest<HTMLElement>('.rectangle-input-wrapper') : null;
		if (this.radiusInput) {
			updateExpressionPreview(this.radiusInput.value, 'mm', radPrev ?? null, scope, radWrap);
		}
	}
}

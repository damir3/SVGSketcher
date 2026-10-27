import type { Vec2 } from '../math/vector';

const LOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>`;
const UNLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z"/></svg>`;

export type RectangleMode = 'corner' | 'center' | 'three_point' | 'rounded';

export class RectanglePopup {
	private container!: HTMLElement;
	private radiusRow!: HTMLElement;
	private widthInput!: HTMLInputElement;
	private heightInput!: HTMLInputElement;
	private radiusInput!: HTMLInputElement;
	private widthLockBtn!: HTMLButtonElement;
	private heightLockBtn!: HTMLButtonElement;
	private radiusLockBtn!: HTMLButtonElement;

	private _isOpen = false;
	private _mode: RectangleMode = 'corner';
	private _isWidthLocked = false;
	private _isHeightLocked = false;
	private _isRadiusLocked = false;

	public onValuesChange?: (
		width: number,
		height: number,
		radius: number,
		isWidthLocked: boolean,
		isHeightLocked: boolean,
		isRadiusLocked: boolean
	) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;

	constructor() {
		if (typeof document === 'undefined') {
			return;
		}

		this.container = document.createElement('div');
		this.container.className = 'rectangle-popup hidden';
		this.container.innerHTML = `
			<div class="rectangle-popup-row" data-row="width">
				<label class="rectangle-popup-label" for="rect-width-input">Width</label>
				<div class="rectangle-input-wrapper">
					<input type="number" id="rect-width-input" min="0.1" step="0.5" value="50.0" autocomplete="off" />
					<span class="rectangle-unit">mm</span>
					<button type="button" class="rectangle-lock-btn" id="rect-width-lock" title="Lock width dimension">
						${UNLOCK_ICON}
					</button>
				</div>
			</div>
			<div class="rectangle-popup-row" data-row="height">
				<label class="rectangle-popup-label" for="rect-height-input">Height</label>
				<div class="rectangle-input-wrapper">
					<input type="number" id="rect-height-input" min="0.1" step="0.5" value="30.0" autocomplete="off" />
					<span class="rectangle-unit">mm</span>
					<button type="button" class="rectangle-lock-btn" id="rect-height-lock" title="Lock height dimension">
						${UNLOCK_ICON}
					</button>
				</div>
			</div>
			<div class="rectangle-popup-row hidden" data-row="radius">
				<label class="rectangle-popup-label" for="rect-radius-input">Radius</label>
				<div class="rectangle-input-wrapper">
					<input type="number" id="rect-radius-input" min="0" step="0.5" value="0.0" autocomplete="off" />
					<span class="rectangle-unit">mm</span>
					<button type="button" class="rectangle-lock-btn" id="rect-radius-lock" title="Lock corner radius">
						${UNLOCK_ICON}
					</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.container);

		this.radiusRow = this.container.querySelector<HTMLElement>('[data-row="radius"]')!;

		this.widthInput = this.container.querySelector<HTMLInputElement>('#rect-width-input')!;
		this.heightInput = this.container.querySelector<HTMLInputElement>('#rect-height-input')!;
		this.radiusInput = this.container.querySelector<HTMLInputElement>('#rect-radius-input')!;

		this.widthLockBtn = this.container.querySelector<HTMLButtonElement>('#rect-width-lock')!;
		this.heightLockBtn = this.container.querySelector<HTMLButtonElement>('#rect-height-lock')!;
		this.radiusLockBtn = this.container.querySelector<HTMLButtonElement>('#rect-radius-lock')!;

		this.setupEvents();
	}

	private setupEvents(): void {
		if (!this.container) return;

		this.container.addEventListener('mousedown', e => e.stopPropagation());
		this.container.addEventListener('click', e => e.stopPropagation());

		// Input live events
		this.widthInput.addEventListener('input', () => {
			this._isWidthLocked = true;
			this.updateLockVisual(this.widthLockBtn, true);
			this.emitValuesChange();
		});

		this.heightInput.addEventListener('input', () => {
			this._isHeightLocked = true;
			this.updateLockVisual(this.heightLockBtn, true);
			this.emitValuesChange();
		});

		this.radiusInput.addEventListener('input', () => {
			this._isRadiusLocked = true;
			this.updateLockVisual(this.radiusLockBtn, true);
			this.emitValuesChange();
		});

		// Lock button toggles
		this.widthLockBtn.addEventListener('click', () => {
			this._isWidthLocked = !this._isWidthLocked;
			this.updateLockVisual(this.widthLockBtn, this._isWidthLocked);
			this.emitValuesChange();
		});

		this.heightLockBtn.addEventListener('click', () => {
			this._isHeightLocked = !this._isHeightLocked;
			this.updateLockVisual(this.heightLockBtn, this._isHeightLocked);
			this.emitValuesChange();
		});

		this.radiusLockBtn.addEventListener('click', () => {
			this._isRadiusLocked = !this._isRadiusLocked;
			this.updateLockVisual(this.radiusLockBtn, this._isRadiusLocked);
			this.emitValuesChange();
		});

		// Keyboard navigation
		const handleKeydown = (e: KeyboardEvent, field: 'width' | 'height' | 'radius') => {
			if (e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				this.cycleFocus(e.shiftKey);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (field === 'width') {
					this._isWidthLocked = true;
					this.updateLockVisual(this.widthLockBtn, true);
				} else if (field === 'height') {
					this._isHeightLocked = true;
					this.updateLockVisual(this.heightLockBtn, true);
				} else if (field === 'radius') {
					this._isRadiusLocked = true;
					this.updateLockVisual(this.radiusLockBtn, true);
				}
				this.onCommit?.();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel?.();
			}
		};

		this.widthInput.addEventListener('keydown', e => handleKeydown(e, 'width'));
		this.heightInput.addEventListener('keydown', e => handleKeydown(e, 'height'));
		this.radiusInput.addEventListener('keydown', e => handleKeydown(e, 'radius'));
	}

	public cycleFocus(reverse = false): void {
		if (!this._isOpen || typeof document === 'undefined') return;
		const active = document.activeElement;
		const hasRadius = this._mode === 'rounded';

		if (active === this.widthInput) {
			if (reverse) {
				this.focusInput(hasRadius ? this.radiusInput : this.heightInput);
			} else {
				this.focusInput(this.heightInput);
			}
		} else if (active === this.heightInput) {
			if (reverse) {
				this.focusInput(this.widthInput);
			} else {
				this.focusInput(hasRadius ? this.radiusInput : this.widthInput);
			}
		} else if (active === this.radiusInput) {
			if (reverse) {
				this.focusInput(this.heightInput);
			} else {
				this.focusInput(this.widthInput);
			}
		} else {
			if (reverse) {
				this.focusInput(hasRadius ? this.radiusInput : this.heightInput);
			} else {
				this.focusInput(this.widthInput);
			}
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
			this.getWidth(),
			this.getHeight(),
			this.getRadius(),
			this._isWidthLocked,
			this._isHeightLocked,
			this._isRadiusLocked
		);
	}

	public focusInput(input: HTMLInputElement): void {
		if (!input) return;
		input.focus();
		try {
			input.select();
		} catch {
			// ignore selection error on some browser engines
		}
		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				try {
					input.select();
				} catch {}
			});
		}
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public isWidthLocked(): boolean {
		return this._isWidthLocked;
	}

	public isHeightLocked(): boolean {
		return this._isHeightLocked;
	}

	public isRadiusLocked(): boolean {
		return this._isRadiusLocked;
	}

	public setWidthLocked(locked: boolean): void {
		this._isWidthLocked = locked;
		this.updateLockVisual(this.widthLockBtn, locked);
	}

	public setHeightLocked(locked: boolean): void {
		this._isHeightLocked = locked;
		this.updateLockVisual(this.heightLockBtn, locked);
	}

	public setRadiusLocked(locked: boolean): void {
		this._isRadiusLocked = locked;
		this.updateLockVisual(this.radiusLockBtn, locked);
	}

	public getWidth(): number {
		if (!this.widthInput) return 1;
		const val = parseFloat(this.widthInput.value);
		return isNaN(val) || val <= 0.01 ? 1 : val;
	}

	public getHeight(): number {
		if (!this.heightInput) return 1;
		const val = parseFloat(this.heightInput.value);
		return isNaN(val) || val <= 0.01 ? 1 : val;
	}

	public getRadius(): number {
		if (!this.radiusInput) return 0;
		const val = parseFloat(this.radiusInput.value);
		return isNaN(val) || val <= 0 ? 0 : val;
	}

	public setMode(mode: RectangleMode): void {
		this._mode = mode;
		if (this.radiusRow) {
			this.radiusRow.classList.toggle('hidden', mode !== 'rounded');
		}
	}

	public resetLocks(): void {
		this._isWidthLocked = false;
		this._isHeightLocked = false;
		this._isRadiusLocked = false;
		this.updateLockVisual(this.widthLockBtn, false);
		this.updateLockVisual(this.heightLockBtn, false);
		this.updateLockVisual(this.radiusLockBtn, false);
	}

	public resetValues(width = 50, height = 30, radius = 0): void {
		this.resetLocks();
		if (this.widthInput) this.widthInput.value = Number(width.toFixed(1)).toString();
		if (this.heightInput) this.heightInput.value = Number(height.toFixed(1)).toString();
		if (this.radiusInput) this.radiusInput.value = Number(Math.max(0, radius).toFixed(1)).toString();
	}

	public show(
		screenPos: Vec2,
		width: number,
		height: number,
		radius: number,
		mode: RectangleMode = 'corner'
	): void {
		this._isOpen = true;
		this.setMode(mode);
		this.resetLocks();

		if (!this.container) return;

		if (this.widthInput) this.widthInput.value = Number(Math.max(0.1, width).toFixed(1)).toString();
		if (this.heightInput) this.heightInput.value = Number(Math.max(0.1, height).toFixed(1)).toString();
		if (this.radiusInput) this.radiusInput.value = Number(Math.max(0, radius).toFixed(1)).toString();

		this.container.classList.remove('hidden');
		this.updatePosition(screenPos);
	}

	public hide(): void {
		this._isOpen = false;
		this.resetLocks();
		if (!this.container) return;
		this.container.classList.add('hidden');
		this.widthInput?.blur();
		this.heightInput?.blur();
		this.radiusInput?.blur();
	}

	public updatePosition(screenPos: Vec2): void {
		if (!this._isOpen || !this.container) return;
		const popupWidth = 180;
		const popupHeight = this._mode === 'rounded' ? 104 : 72;

		const left = Math.min(Math.max(screenPos.x + 120, 16), window.innerWidth - popupWidth - 16);
		const top = Math.min(Math.max(screenPos.y + 50, 16), window.innerHeight - popupHeight - 16);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public updateDimensions(width: number, height: number, radius?: number): void {
		if (!this._isOpen) return;
		const active = typeof document !== 'undefined' ? document.activeElement : null;
		if (!this._isWidthLocked && this.widthInput && active !== this.widthInput) {
			this.widthInput.value = Number(Math.max(0.1, width).toFixed(1)).toString();
		}
		if (!this._isHeightLocked && this.heightInput && active !== this.heightInput) {
			this.heightInput.value = Number(Math.max(0.1, height).toFixed(1)).toString();
		}
		if (radius !== undefined && !this._isRadiusLocked && this.radiusInput && active !== this.radiusInput) {
			this.radiusInput.value = Number(Math.max(0, radius).toFixed(1)).toString();
		}
	}
}

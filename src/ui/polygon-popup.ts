import type { Vec2 } from '../math/vector';

export class PolygonPopup {
	private container: HTMLElement;
	private sidesInput: HTMLInputElement;
	private radiusInput: HTMLInputElement;
	private _isOpen = false;
	private _isRadiusUserModified = false;

	public onValuesChange?: (sides: number, radius: number, isRadiusChanged: boolean) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;

	constructor() {
		this.container = document.createElement('div');
		this.container.className = 'polygon-popup hidden';
		this.container.innerHTML = `
			<div class="polygon-popup-row">
				<label class="polygon-popup-label" for="poly-sides-input">Sides</label>
				<div class="polygon-input-wrapper">
					<input type="number" id="poly-sides-input" min="3" max="100" step="1" value="6" autocomplete="off" />
				</div>
			</div>
			<div class="polygon-popup-row">
				<label class="polygon-popup-label" for="poly-radius-input">Radius</label>
				<div class="polygon-input-wrapper">
					<input type="number" id="poly-radius-input" min="0.1" step="0.5" value="50.0" autocomplete="off" />
					<span class="polygon-unit">mm</span>
				</div>
			</div>
		`;
		document.body.appendChild(this.container);

		this.sidesInput = this.container.querySelector<HTMLInputElement>('#poly-sides-input')!;
		this.radiusInput = this.container.querySelector<HTMLInputElement>('#poly-radius-input')!;

		this.setupEvents();
	}

	private setupEvents(): void {
		// Prevent mousedown or click on popup from propagating to canvas
		this.container.addEventListener('mousedown', e => {
			e.stopPropagation();
		});
		this.container.addEventListener('click', e => {
			e.stopPropagation();
		});

		// Live update on input
		this.sidesInput.addEventListener('input', () => {
			const sides = this.getSides();
			const radius = this.getRadius();
			this.onValuesChange?.(sides, radius, false);
		});

		this.radiusInput.addEventListener('input', () => {
			this._isRadiusUserModified = true;
			const sides = this.getSides();
			const radius = this.getRadius();
			this.onValuesChange?.(sides, radius, true);
		});

		const handleKeydown = (e: KeyboardEvent, isSides: boolean) => {
			if (e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				if (e.shiftKey) {
					if (isSides) {
						this.focusInput(this.radiusInput);
					} else {
						this.focusInput(this.sidesInput);
					}
				} else {
					if (isSides) {
						this.focusInput(this.radiusInput);
					} else {
						this.focusInput(this.sidesInput);
					}
				}
			} else if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (!isSides) {
					this._isRadiusUserModified = true;
				}
				this.onCommit?.();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel?.();
			}
		};

		this.sidesInput.addEventListener('keydown', e => handleKeydown(e, true));
		this.radiusInput.addEventListener('keydown', e => handleKeydown(e, false));
	}

	private focusInput(input: HTMLInputElement): void {
		input.focus();
		input.select();
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public isRadiusLocked(): boolean {
		return this._isRadiusUserModified;
	}

	public getSides(): number {
		const val = parseInt(this.sidesInput.value, 10);
		if (isNaN(val) || val < 3) return 3;
		if (val > 100) return 100;
		return val;
	}

	public getRadius(): number {
		const val = parseFloat(this.radiusInput.value);
		if (isNaN(val) || val <= 0.01) return 1;
		return val;
	}

	public show(screenPos: Vec2, sides: number, radius: number): void {
		this._isRadiusUserModified = false;
		this.sidesInput.value = Math.max(3, Math.round(sides)).toString();
		this.radiusInput.value = Number(radius.toFixed(1)).toString();
		this.container.classList.remove('hidden');
		this._isOpen = true;
		this.updatePosition(screenPos);
	}

	public hide(): void {
		this.container.classList.add('hidden');
		this._isOpen = false;
		this.sidesInput.blur();
		this.radiusInput.blur();
	}

	public updatePosition(screenPos: Vec2): void {
		if (!this._isOpen) return;
		const popupWidth = 160;
		const popupHeight = 72;

		const left = Math.min(Math.max(screenPos.x + 150, 16), window.innerWidth - popupWidth - 16);
		const top = Math.min(Math.max(screenPos.y + 80, 16), window.innerHeight - popupHeight - 16);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public updateRadius(radius: number): void {
		if (!this._isOpen || this._isRadiusUserModified) return;
		this.radiusInput.value = Number(radius.toFixed(1)).toString();
	}

	public cycleFocus(reverse = false): void {
		if (!this._isOpen) return;
		const active = document.activeElement;
		if (active === this.sidesInput) {
			this.focusInput(this.radiusInput);
		} else if (active === this.radiusInput) {
			this.focusInput(this.sidesInput);
		} else {
			if (reverse) {
				this.focusInput(this.radiusInput);
			} else {
				this.focusInput(this.sidesInput);
			}
		}
	}
}

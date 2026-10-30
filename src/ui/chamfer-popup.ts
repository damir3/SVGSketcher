import type { Vec2 } from '../math/vector';
import type { ChamferMode } from '../math/chamfer';

export class ChamferPopup {
	private container: HTMLElement;

	private labelDist1: HTMLElement;
	private dist1Input: HTMLInputElement;

	private rowDist2: HTMLElement;
	private dist2Input: HTMLInputElement;

	private rowAngle: HTMLElement;
	private angleInput: HTMLInputElement;

	private rowFlip: HTMLElement;
	private flipCheckbox: HTMLInputElement;

	private errorEl: HTMLElement;

	private _isOpen = false;
	private _currentMode: ChamferMode = 'equal_distance';

	public onParamsChange?: (
		mode: ChamferMode,
		dist1: number,
		dist2: number,
		angleDeg: number,
		flip: boolean
	) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;
	public onModeSwitchRequested?: (mode: ChamferMode) => void;

	constructor() {
		this.container = document.createElement('div');
		this.container.className = 'chamfer-popup hidden';
		this.container.innerHTML = `
			<div class="chamfer-popup-row chamfer-row-dist1">
				<label class="chamfer-popup-label" id="chamfer-label-dist1" for="chamfer-dist1-input">Distance</label>
				<div class="chamfer-input-wrapper">
					<input type="number" id="chamfer-dist1-input" min="0.1" step="0.5" value="10.0" autocomplete="off" />
					<span class="chamfer-unit">mm</span>
				</div>
			</div>

			<div class="chamfer-popup-row chamfer-row-dist2 hidden">
				<label class="chamfer-popup-label" for="chamfer-dist2-input">Distance 2</label>
				<div class="chamfer-input-wrapper">
					<input type="number" id="chamfer-dist2-input" min="0.1" step="0.5" value="10.0" autocomplete="off" />
					<span class="chamfer-unit">mm</span>
				</div>
			</div>

			<div class="chamfer-popup-row chamfer-row-angle hidden">
				<label class="chamfer-popup-label" for="chamfer-angle-input">Angle</label>
				<div class="chamfer-input-wrapper">
					<input type="number" id="chamfer-angle-input" min="0" max="179.9" step="1.0" value="45.0" autocomplete="off" />
					<span class="chamfer-unit">°</span>
				</div>
			</div>

			<div class="chamfer-popup-row chamfer-row-flip hidden">
				<label class="chamfer-checkbox-label">
					<input type="checkbox" id="chamfer-flip-checkbox" />
					<span>Flip direction</span>
				</label>
			</div>

			<div class="chamfer-popup-error hidden"></div>
		`;
		document.body.appendChild(this.container);

		this.labelDist1 = this.container.querySelector('#chamfer-label-dist1')!;
		this.dist1Input = this.container.querySelector('#chamfer-dist1-input')!;

		this.rowDist2 = this.container.querySelector('.chamfer-row-dist2')!;
		this.dist2Input = this.container.querySelector('#chamfer-dist2-input')!;

		this.rowAngle = this.container.querySelector('.chamfer-row-angle')!;
		this.angleInput = this.container.querySelector('#chamfer-angle-input')!;

		this.rowFlip = this.container.querySelector('.chamfer-row-flip')!;
		this.flipCheckbox = this.container.querySelector('#chamfer-flip-checkbox')!;

		this.errorEl = this.container.querySelector('.chamfer-popup-error')!;

		this.setupEvents();
	}

	private setupEvents(): void {
		this.container.addEventListener('mousedown', e => e.stopPropagation());
		this.container.addEventListener('click', e => e.stopPropagation());

		const handleInput = () => this.notifyChange();

		this.dist1Input.addEventListener('input', handleInput);
		this.dist2Input.addEventListener('input', handleInput);
		this.angleInput.addEventListener('input', handleInput);
		this.flipCheckbox.addEventListener('change', handleInput);

		const inputs = [this.dist1Input, this.dist2Input, this.angleInput, this.flipCheckbox];
		inputs.forEach(inp => {
			inp.addEventListener('keydown', e => {
				if (e.key === 'Tab') {
					e.preventDefault();
					e.stopPropagation();
					this.cycleFocus(e.shiftKey);
					return;
				}
				if (e.altKey && !e.ctrlKey && !e.metaKey) {
					if (e.code === 'Digit1' || e.code === 'Numpad1') {
						e.preventDefault();
						e.stopPropagation();
						this.setMode('equal_distance');
						this.onModeSwitchRequested?.('equal_distance');
						this.notifyChange();
						return;
					} else if (e.code === 'Digit2' || e.code === 'Numpad2') {
						e.preventDefault();
						e.stopPropagation();
						this.setMode('two_distance');
						this.onModeSwitchRequested?.('two_distance');
						this.notifyChange();
						return;
					} else if (e.code === 'Digit3' || e.code === 'Numpad3') {
						e.preventDefault();
						e.stopPropagation();
						this.setMode('distance_angle');
						this.onModeSwitchRequested?.('distance_angle');
						this.notifyChange();
						return;
					}
				}
				if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					this.onCommit?.();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					this.onCancel?.();
				}
			});
		});
	}

	private notifyChange(): void {
		const p = this.getParams();
		this.onParamsChange?.(p.mode, p.dist1, p.dist2, p.angleDeg, p.flip);
	}

	public setMode(mode: ChamferMode): void {
		this._currentMode = mode;

		if (mode === 'equal_distance') {
			this.labelDist1.textContent = 'Distance';
			this.rowDist2.classList.add('hidden');
			this.rowAngle.classList.add('hidden');
			this.rowFlip.classList.add('hidden');
		} else if (mode === 'two_distance') {
			this.labelDist1.textContent = 'Distance 1';
			this.rowDist2.classList.remove('hidden');
			this.rowAngle.classList.add('hidden');
			this.rowFlip.classList.remove('hidden');
		} else if (mode === 'distance_angle') {
			this.labelDist1.textContent = 'Distance';
			this.rowDist2.classList.add('hidden');
			this.rowAngle.classList.remove('hidden');
			this.rowFlip.classList.remove('hidden');
		}
	}

	public getParams(): {
		mode: ChamferMode;
		dist1: number;
		dist2: number;
		angleDeg: number;
		flip: boolean;
	} {
		const d1 = parseFloat(this.dist1Input.value) || 10;
		const d2 = parseFloat(this.dist2Input.value) || 10;
		const parsedA = parseFloat(this.angleInput.value);
		const a = isNaN(parsedA) ? 45 : parsedA;
		const flip = this.flipCheckbox.checked;

		return {
			mode: this._currentMode,
			dist1: Math.max(0.1, d1),
			dist2: Math.max(0.1, d2),
			angleDeg: Math.max(0, Math.min(179.9, a)),
			flip,
		};
	}

	public updateValues(dist1: number, dist2: number, angleDeg: number): void {
		this.dist1Input.value = Number(dist1.toFixed(1)).toString();
		this.dist2Input.value = Number(dist2.toFixed(1)).toString();
		this.angleInput.value = Number(angleDeg.toFixed(1)).toString();
	}

	public show(
		screenPos: Vec2,
		mode: ChamferMode,
		dist1: number,
		dist2: number,
		angleDeg: number,
		flip: boolean
	): void {
		this.setMode(mode);
		this.updateValues(dist1, dist2, angleDeg);
		this.flipCheckbox.checked = flip;
		this.setError(false);
		this.container.classList.remove('hidden');
		this._isOpen = true;
		this.updatePosition(screenPos);
	}

	public hide(): void {
		this.container.classList.add('hidden');
		this._isOpen = false;
		this.setError(false);
		this.dist1Input.blur();
		this.dist2Input.blur();
		this.angleInput.blur();
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public focus(): void {
		this.focusInput(this.dist1Input);
	}

	public cycleFocus(reverse = false): void {
		if (!this._isOpen || typeof document === 'undefined') return;

		let visibleInputs: HTMLElement[] = [];
		if (this._currentMode === 'equal_distance') {
			visibleInputs = [this.dist1Input];
		} else if (this._currentMode === 'two_distance') {
			visibleInputs = [this.dist1Input, this.dist2Input, this.flipCheckbox];
		} else if (this._currentMode === 'distance_angle') {
			visibleInputs = [this.dist1Input, this.angleInput, this.flipCheckbox];
		}

		if (visibleInputs.length === 0) return;

		const active = document.activeElement;
		const currentIndex = visibleInputs.indexOf(active as HTMLElement);

		if (currentIndex === -1) {
			this.focusInput(reverse ? visibleInputs[visibleInputs.length - 1] : visibleInputs[0]);
		} else {
			const nextIndex = reverse
				? (currentIndex - 1 + visibleInputs.length) % visibleInputs.length
				: (currentIndex + 1) % visibleInputs.length;
			this.focusInput(visibleInputs[nextIndex]);
		}
	}

	private focusInput(el: HTMLElement): void {
		el.focus();
		if (el instanceof HTMLInputElement && el.type !== 'checkbox') {
			el.select();
		}
	}

	public setError(hasError: boolean, message?: string): void {
		const wrappers = this.container.querySelectorAll('.chamfer-input-wrapper');
		if (hasError) {
			wrappers.forEach(w => w.classList.add('error'));
			this.errorEl.textContent = message || 'Invalid parameters';
			this.errorEl.classList.remove('hidden');
		} else {
			wrappers.forEach(w => w.classList.remove('error'));
			this.errorEl.classList.add('hidden');
			this.errorEl.textContent = '';
		}
	}

	public updatePosition(screenPos: Vec2): void {
		if (!this._isOpen) return;
		const popupWidth = 190;
		const popupHeight = this.container.offsetHeight || 130;

		const left = Math.min(Math.max(screenPos.x + 200, 16), window.innerWidth - popupWidth - 16);
		const top = Math.min(Math.max(screenPos.y + 40, 16), window.innerHeight - popupHeight - 16);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public destroy(): void {
		this.container.remove();
	}
}

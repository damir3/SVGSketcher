import type { Vec2 } from '../math/vector';
import type { OffsetDirection } from '../math/offset';

export interface ScreenBoundingBox {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export class OffsetPopup {
	private container: HTMLElement;

	private labelDist1: HTMLElement;
	private dist1Input: HTMLInputElement;

	private rowDist2: HTMLElement;
	private labelDist2: HTMLElement;
	private dist2Input: HTMLInputElement;

	private rowFlip: HTMLElement;
	private flipCheckbox: HTMLInputElement;

	private errorEl: HTMLElement;

	private _isOpen = false;
	private _currentDirection: OffsetDirection = 'one_side';

	public onParamsChange?: (
		direction: OffsetDirection,
		dist1: number,
		dist2: number,
		flip: boolean
	) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;
	public onModeSwitchRequested?: (direction: OffsetDirection) => void;

	constructor() {
		this.container = document.createElement('div');
		this.container.className = 'offset-popup chamfer-popup hidden';
		this.container.innerHTML = `
			<div class="chamfer-popup-row offset-row-dist1">
				<label class="chamfer-popup-label" id="offset-label-dist1" for="offset-dist1-input">Distance</label>
				<div class="chamfer-input-wrapper">
					<input type="number" id="offset-dist1-input" step="0.5" value="10.0" autocomplete="off" />
					<span class="chamfer-unit">mm</span>
				</div>
			</div>

			<div class="chamfer-popup-row offset-row-dist2 hidden">
				<label class="chamfer-popup-label" id="offset-label-dist2" for="offset-dist2-input">Distance 2</label>
				<div class="chamfer-input-wrapper">
					<input type="number" id="offset-dist2-input" step="0.5" value="10.0" autocomplete="off" />
					<span class="chamfer-unit">mm</span>
				</div>
			</div>

			<div class="chamfer-popup-row offset-row-flip">
				<label class="chamfer-checkbox-label">
					<input type="checkbox" id="offset-flip-checkbox" />
					<span>Flip direction</span>
				</label>
			</div>

			<div class="chamfer-popup-error hidden"></div>
		`;
		document.body.appendChild(this.container);

		this.labelDist1 = this.container.querySelector('#offset-label-dist1')!;
		this.dist1Input = this.container.querySelector('#offset-dist1-input')!;

		this.rowDist2 = this.container.querySelector('.offset-row-dist2')!;
		this.labelDist2 = this.container.querySelector('#offset-label-dist2')!;
		this.dist2Input = this.container.querySelector('#offset-dist2-input')!;

		this.rowFlip = this.container.querySelector('.offset-row-flip')!;
		this.flipCheckbox = this.container.querySelector('#offset-flip-checkbox')!;

		this.errorEl = this.container.querySelector('.chamfer-popup-error')!;

		this.setupEvents();
	}

	private setupEvents(): void {
		this.container.addEventListener('mousedown', e => e.stopPropagation());
		this.container.addEventListener('click', e => e.stopPropagation());

		const handleInput = () => this.notifyChange();

		this.dist1Input.addEventListener('input', handleInput);
		this.dist2Input.addEventListener('input', handleInput);
		this.flipCheckbox.addEventListener('change', handleInput);

		const inputs = [this.dist1Input, this.dist2Input, this.flipCheckbox];
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
						this.setDirection('one_side');
						this.onModeSwitchRequested?.('one_side');
						this.notifyChange();
						return;
					} else if (e.code === 'Digit2' || e.code === 'Numpad2') {
						e.preventDefault();
						e.stopPropagation();
						this.setDirection('two_sides');
						this.onModeSwitchRequested?.('two_sides');
						this.notifyChange();
						return;
					} else if (e.code === 'Digit3' || e.code === 'Numpad3') {
						e.preventDefault();
						e.stopPropagation();
						this.setDirection('symmetric');
						this.onModeSwitchRequested?.('symmetric');
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
		const val1 = this.dist1Input.value.trim();
		if (val1 === '-' || val1 === '' || val1 === '.') return;
		const val2 = this.dist2Input.value.trim();
		if (val2 === '-' || val2 === '' || val2 === '.') return;

		const p = this.getParams();
		this.onParamsChange?.(p.direction, p.dist1, p.dist2, p.flip);
	}

	public setDirection(direction: OffsetDirection): void {
		this._currentDirection = direction;

		if (direction === 'one_side') {
			this.labelDist1.textContent = 'Distance';
			this.rowDist2.classList.add('hidden');
			this.rowFlip.classList.remove('hidden');
		} else if (direction === 'two_sides') {
			this.labelDist1.textContent = 'Distance 1';
			this.labelDist2.textContent = 'Distance 2';
			this.rowDist2.classList.remove('hidden');
			this.rowFlip.classList.remove('hidden');
		} else if (direction === 'symmetric') {
			this.labelDist1.textContent = 'Distance';
			this.rowDist2.classList.add('hidden');
			this.rowFlip.classList.add('hidden');
		}
	}

	public getParams(): {
		direction: OffsetDirection;
		dist1: number;
		dist2: number;
		flip: boolean;
	} {
		const rawD1 = parseFloat(this.dist1Input.value);
		const rawD2 = parseFloat(this.dist2Input.value);
		const d1 = isNaN(rawD1) ? 10 : rawD1;
		const d2 = isNaN(rawD2) ? 10 : rawD2;
		const flip = this.flipCheckbox.checked;

		return {
			direction: this._currentDirection,
			dist1: d1,
			dist2: d2,
			flip,
		};
	}

	public updateValues(dist1: number, dist2: number, flip?: boolean): void {
		this.dist1Input.value = Number(dist1.toFixed(1)).toString();
		this.dist2Input.value = Number(dist2.toFixed(1)).toString();
		if (flip !== undefined) {
			this.flipCheckbox.checked = flip;
		}
	}

	public show(
		posOrBBox: Vec2 | ScreenBoundingBox,
		direction: OffsetDirection,
		dist1: number,
		dist2: number,
		flip: boolean
	): void {
		this.setDirection(direction);
		this.updateValues(dist1, dist2, flip);
		this.setError(false);
		this.container.classList.remove('hidden');
		this._isOpen = true;
		this.updatePosition(posOrBBox);
	}

	public hide(): void {
		this.container.classList.add('hidden');
		this._isOpen = false;
		this.setError(false);
		this.dist1Input.blur();
		this.dist2Input.blur();
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
		if (this._currentDirection === 'one_side') {
			visibleInputs = [this.dist1Input, this.flipCheckbox];
		} else if (this._currentDirection === 'two_sides') {
			visibleInputs = [this.dist1Input, this.dist2Input, this.flipCheckbox];
		} else if (this._currentDirection === 'symmetric') {
			visibleInputs = [this.dist1Input];
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
		el.focus?.();
		if ((typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) || el.tagName === 'INPUT') {
			(el as HTMLInputElement).select?.();
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

	/**
	 * Position popup shifted +100px in X relative to gizmo bounding box (or screen point),
	 * centered vertically on the bounding box.
	 */
	public updatePosition(posOrBBox: Vec2 | ScreenBoundingBox): void {
		if (!this._isOpen || typeof window === 'undefined') return;
		const popupWidth = 190;
		const popupHeight = this.container.offsetHeight || 130;

		let refX: number;
		let centerY: number;
		let minBoxX: number;

		if ('minX' in posOrBBox) {
			refX = posOrBBox.maxX;
			minBoxX = posOrBBox.minX;
			centerY = (posOrBBox.minY + posOrBBox.maxY) / 2;
		} else {
			refX = posOrBBox.x;
			minBoxX = posOrBBox.x;
			centerY = posOrBBox.y;
		}

		let left = refX + 120;
		if (left + popupWidth > window.innerWidth - 16) {
			const leftAlt = minBoxX - 100 - popupWidth;
			if (leftAlt >= 16) {
				left = leftAlt;
			} else {
				left = window.innerWidth - popupWidth - 16;
			}
		}
		left = Math.max(16, left);

		const top = Math.min(
			Math.max(centerY, 16),
			window.innerHeight - popupHeight - 16
		);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public destroy(): void {
		this.container.remove();
	}
}

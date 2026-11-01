import type { Vec2 } from '../math/vector';
import { parseNumericOrExpression, getExpressionIfValid } from '../math/expression';
import type { SketchDocument } from '../model/sketch';
import { updateExpressionPreview } from './expression-preview';

export class FilletPopup {
	private container: HTMLElement;
	private radiusInput: HTMLInputElement;
	private errorEl: HTMLElement;
	private _isOpen = false;
	private _isRadiusUserModified = false;
	private sketch?: SketchDocument;

	public setSketch(sketch: SketchDocument): void {
		this.sketch = sketch;
	}

	public isRadiusUserModified(): boolean {
		return this._isRadiusUserModified;
	}

	public onRadiusChange?: (radius: number) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;

	constructor(sketch?: SketchDocument) {
		this.sketch = sketch;
		this.container = document.createElement('div');
		this.container.className = 'fillet-popup hidden';
		this.container.innerHTML = `
			<div class="fillet-popup-row">
				<label class="fillet-popup-label" for="fillet-radius-input">Radius</label>
				<div class="fillet-input-wrapper">
					<input type="text" id="fillet-radius-input" value="10.0" autocomplete="off" spellcheck="false" />
					<span class="fillet-unit">mm</span>
				</div>
				<div class="dim-eval-preview hidden" id="fillet-eval-preview"></div>
			</div>
			<div class="fillet-popup-error hidden"></div>
		`;
		document.body.appendChild(this.container);

		this.radiusInput = this.container.querySelector<HTMLInputElement>('#fillet-radius-input')!;
		this.errorEl = this.container.querySelector<HTMLElement>('.fillet-popup-error')!;
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
		this.radiusInput.addEventListener('input', () => {
			this._isRadiusUserModified = true;
			this.updateEvalPreviews();
			const radius = this.getRadius();
			this.onRadiusChange?.(radius);
		});

		this.radiusInput.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				this._isRadiusUserModified = true;
				this.onCommit?.();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel?.();
			}
		});
	}

	public focus(): void {
		this.radiusInput.focus();
		this.radiusInput.select();
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public getRadius(): number {
		const val = parseNumericOrExpression(
			this.radiusInput.value,
			10,
			this.sketch?.getParameterValuesMap()
		);
		if (isNaN(val) || val <= 0.01) return 1;
		return val;
	}

	public getRadiusExpression(): string | undefined {
		if (!this.radiusInput) return undefined;
		return getExpressionIfValid(this.radiusInput.value, this.sketch?.getParameterValuesMap());
	}

	public show(screenPos: Vec2, radius: number): void {
		this._isRadiusUserModified = false;
		this.setError(false);
		this.radiusInput.value = Number(radius.toFixed(1)).toString();
		this.updateEvalPreviews();
		this.container.classList.remove('hidden');
		this._isOpen = true;
		this.updatePosition(screenPos);
	}

	public hide(): void {
		this.container.classList.add('hidden');
		this._isOpen = false;
		this.setError(false);
		this.radiusInput.blur();
	}

	public setError(hasError: boolean, message?: string): void {
		const wrapper = this.container.querySelector('.fillet-input-wrapper');
		if (hasError) {
			wrapper?.classList.add('error');
			if (message) {
				this.errorEl.textContent = message;
				this.errorEl.classList.remove('hidden');
			}
		} else {
			wrapper?.classList.remove('error');
			this.errorEl.textContent = '';
			this.errorEl.classList.add('hidden');
		}
	}

	public updatePosition(screenPos: Vec2): void {
		if (!this._isOpen) return;
		const popupWidth = 140;
		const popupHeight = 44;

		// Offset to the right and slightly below screen position
		const left = Math.min(Math.max(screenPos.x + 150, 16), window.innerWidth - popupWidth - 16);
		const top = Math.min(Math.max(screenPos.y + 40, 16), window.innerHeight - popupHeight - 16);

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public updateRadius(radius: number): void {
		if (!this._isOpen) return;
		this.radiusInput.value = Number(radius.toFixed(1)).toString();
		this.updateEvalPreviews();
	}

	public updateEvalPreviews(): void {
		const scope = this.sketch?.getParameterValuesMap();
		const prev = this.container?.querySelector<HTMLElement>('#fillet-eval-preview');
		const wrap = typeof this.radiusInput?.closest === 'function' ? this.radiusInput.closest<HTMLElement>('.fillet-input-wrapper') : null;
		if (this.radiusInput) {
			updateExpressionPreview(this.radiusInput.value, 'mm', prev ?? null, scope, wrap);
		}
	}
}

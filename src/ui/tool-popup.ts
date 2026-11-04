import type { Vec2 } from '../math/vector';
import { parseNumericOrExpression, getExpressionIfValid } from '../math/expression';
import type { SketchDocument } from '../model/sketch';
import { updateExpressionPreview } from './expression-preview';

export interface ScreenBoundingBox {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export type ToolPopupFieldType = 'dimension' | 'integer' | 'checkbox';

export interface ToolPopupFieldConfig<TFieldId extends string = string> {
	id: TFieldId;
	label: string;
	type: ToolPopupFieldType;
	unit?: string;
	placeholder?: string;
	defaultValue?: number | string | boolean;
	min?: number;
	max?: number;
	step?: number;
	lockable?: boolean;
	visible?: boolean;
	title?: string;
}

export interface ToolPopupOptions<TFieldId extends string = string> {
	className?: string;
	fields: ToolPopupFieldConfig<TFieldId>[];
	sketch?: SketchDocument;
	defaultOffset?: { x: number; y: number };
	bboxOffset?: { x: number; y: number };
	onKeyDown?: (e: KeyboardEvent) => boolean | void;
}

export const POPUP_LOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>`;
export const POPUP_UNLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z"/></svg>`;

interface FieldElements {
	config: ToolPopupFieldConfig<any>;
	row: HTMLElement;
	labelEl: HTMLElement;
	input: HTMLInputElement;
	wrapperEl?: HTMLElement;
	lockBtn?: HTMLButtonElement;
	evalPreviewEl?: HTMLElement;
	isLocked: boolean;
	isVisible: boolean;
}

export class ToolPopup<TFieldId extends string = string> {
	public container!: HTMLElement;
	protected errorEl!: HTMLElement;
	protected sketch?: SketchDocument;
	protected fieldMap = new Map<TFieldId, FieldElements>();
	protected fieldOrder: TFieldId[] = [];
	protected _isOpen = false;
	protected defaultOffset: { x: number; y: number };
	protected bboxOffset: { x: number; y: number };

	public onChange?: (fieldId: TFieldId, value: number | string | boolean) => void;
	public onLockChange?: (fieldId: TFieldId, locked: boolean) => void;
	public onCommit?: () => void;
	public onCancel?: () => void;
	public onKeyDown?: (e: KeyboardEvent) => boolean | void;

	constructor(options: ToolPopupOptions<TFieldId>) {
		this.sketch = options.sketch;
		this.defaultOffset = options.defaultOffset ?? { x: 150, y: 40 };
		this.bboxOffset = options.bboxOffset ?? { x: 100, y: 0 };
		this.onKeyDown = options.onKeyDown;

		// Initialize fieldMap first so state is available even in headless/Node test environments
		for (const field of options.fields) {
			this.fieldOrder.push(field.id);
			this.fieldMap.set(field.id, {
				config: field,
				row: undefined as any,
				labelEl: undefined as any,
				input: {
					value: field.defaultValue !== undefined ? String(field.defaultValue) : '',
					checked: Boolean(field.defaultValue),
				} as any,
				isLocked: false,
				isVisible: field.visible !== false,
			});
		}

		if (typeof document === 'undefined') {
			return;
		}

		this.container = document.createElement('div');
		const baseClasses = ['tool-popup', 'hidden'];
		if (options.className) {
			baseClasses.push(...options.className.split(' ').filter(Boolean));
		}
		this.container.className = baseClasses.join(' ');

		// Build fields
		for (const field of options.fields) {
			const entry = this.fieldMap.get(field.id)!;
			const row = document.createElement('div');
			row.className = `tool-popup-row ${field.visible === false ? 'hidden' : ''}`;
			row.setAttribute?.('data-field', field.id);

			let labelEl: HTMLElement;
			let input: HTMLInputElement;
			let wrapperEl: HTMLElement | undefined;
			let lockBtn: HTMLButtonElement | undefined;
			let evalPreviewEl: HTMLElement | undefined;

			if (field.type === 'checkbox') {
				const checkLabel = document.createElement('label');
				checkLabel.className = 'tool-popup-checkbox-label';

				input = document.createElement('input');
				input.type = 'checkbox';
				input.id = `tool-popup-input-${field.id}`;
				input.checked = Boolean(field.defaultValue);

				const span = document.createElement('span');
				span.textContent = field.label;
				labelEl = span;

				checkLabel.appendChild(input);
				checkLabel.appendChild(span);
				row.appendChild(checkLabel);
			} else {
				const lbl = document.createElement('label');
				lbl.className = 'tool-popup-label';
				lbl.htmlFor = `tool-popup-input-${field.id}`;
				lbl.textContent = field.label;
				labelEl = lbl;
				row.appendChild(labelEl);

				wrapperEl = document.createElement('div');
				wrapperEl.className = 'tool-popup-input-wrapper';

				input = document.createElement('input');
				input.id = `tool-popup-input-${field.id}`;
				input.autocomplete = 'off';
				input.spellcheck = false;

				if (field.type === 'integer') {
					input.type = 'number';
					if (field.min !== undefined) input.min = String(field.min);
					if (field.max !== undefined) input.max = String(field.max);
					if (field.step !== undefined) input.step = String(field.step);
					input.value = field.defaultValue !== undefined ? String(field.defaultValue) : '0';
				} else {
					input.type = 'text';
					input.value = field.defaultValue !== undefined ? String(field.defaultValue) : '';
				}

				if (field.placeholder) {
					input.placeholder = field.placeholder;
				}

				wrapperEl.appendChild(input);

				if (field.unit) {
					const unitSpan = document.createElement('span');
					unitSpan.className = 'tool-popup-unit';
					unitSpan.textContent = field.unit;
					wrapperEl.appendChild(unitSpan);
				}

				if (field.lockable) {
					lockBtn = document.createElement('button');
					lockBtn.type = 'button';
					lockBtn.className = 'tool-popup-lock-btn';
					lockBtn.title = field.title ?? `Lock ${field.label.toLowerCase()}`;
					lockBtn.innerHTML = POPUP_UNLOCK_ICON;
					wrapperEl.appendChild(lockBtn);
				}

				if (field.type === 'integer') {
					const stepper = document.createElement('span');
					stepper.className = 'tool-popup-stepper';
					for (const [direction, glyph] of [
						['up', '▲'],
						['down', '▼'],
					] as const) {
						const button = document.createElement('button');
						button.type = 'button';
						button.className = `tool-popup-stepper-${direction}`;
						button.setAttribute(
							'aria-label',
							direction === 'up' ? `Increase ${field.label}` : `Decrease ${field.label}`
						);
						button.textContent = glyph;
						button.addEventListener('click', () => {
							const current = Number.parseFloat(input.value) || 0;
							const step = Number(field.step) || 1;
							const min = field.min ?? -Infinity;
							const max = field.max ?? Infinity;
							const next = Math.max(min, Math.min(max, current + (direction === 'up' ? step : -step)));
							input.value = String(next);
							input.dispatchEvent(new Event('input', { bubbles: true }));
							input.dispatchEvent(new Event('change', { bubbles: true }));
						});
						stepper.appendChild(button);
					}
					wrapperEl.appendChild(stepper);
				}

				row.appendChild(wrapperEl);

				if (field.type === 'dimension') {
					evalPreviewEl = document.createElement('div');
					evalPreviewEl.className = 'dim-eval-preview hidden';
					evalPreviewEl.id = `tool-popup-eval-preview-${field.id}`;
					row.appendChild(evalPreviewEl);
				}
			}

			this.container.appendChild(row);

			entry.row = row;
			entry.labelEl = labelEl;
			entry.input = input;
			entry.wrapperEl = wrapperEl;
			entry.lockBtn = lockBtn;
			entry.evalPreviewEl = evalPreviewEl;
		}

		// Error row
		this.errorEl = document.createElement('div');
		this.errorEl.className = 'tool-popup-error hidden';
		this.container.appendChild(this.errorEl);

		if (document.body?.appendChild) {
			document.body.appendChild(this.container);
		}

		this.setupEvents();
		this.updateAllEvalPreviews();
	}

	public setSketch(sketch: SketchDocument): void {
		this.sketch = sketch;
		this.updateAllEvalPreviews();
	}

	public getContainer(): HTMLElement {
		return this.container;
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public show(posOrBBox?: Vec2 | ScreenBoundingBox, ..._args: any[]): void {
		this._isOpen = true;
		if (!this.container) return;
		this.setError(false);
		this.updateAllEvalPreviews();
		this.container.classList?.remove?.('hidden');
		if (posOrBBox) {
			this.updatePosition(posOrBBox);
		}
	}

	public hide(): void {
		this._isOpen = false;
		if (!this.container) return;
		this.container.classList?.add?.('hidden');
		this.setError(false);
		const active = typeof document !== 'undefined' ? document.activeElement : null;
		if (active && this.container.contains?.(active as HTMLElement)) {
			(active as HTMLElement).blur?.();
		}
	}

	public focus(fieldId?: TFieldId): void {
		if (!this.container) return;
		const target = fieldId ? this.fieldMap.get(fieldId) : this.getFirstVisibleField();
		if (target) {
			this.focusFieldElement(target.input);
		}
	}

	public cycleFocus(reverse = false): void {
		if (!this.container) return;
		const visible = this.getVisibleInputElements();
		if (visible.length === 0) return;

		const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		const currentIndex = active ? visible.indexOf(active) : -1;

		if (currentIndex === -1) {
			this.focusFieldElement(reverse ? visible[visible.length - 1] : visible[0]);
		} else {
			const nextIndex = reverse
				? (currentIndex - 1 + visible.length) % visible.length
				: (currentIndex + 1) % visible.length;
			this.focusFieldElement(visible[nextIndex]);
		}
	}

	public updatePosition(posOrBBox: Vec2 | ScreenBoundingBox): void {
		if (!this._isOpen || !this.container || typeof window === 'undefined') return;

		const popupWidth = this.container.offsetWidth || 190;
		const popupHeight = this.container.offsetHeight || 130;

		let left: number;
		let top: number;

		if ('minX' in posOrBBox) {
			// Bounding box positioning
			const refX = posOrBBox.maxX;
			const minBoxX = posOrBBox.minX;
			const centerY = (posOrBBox.minY + posOrBBox.maxY) / 2;

			left = refX + this.bboxOffset.x;
			if (left + popupWidth > window.innerWidth - 16) {
				const leftAlt = minBoxX - this.bboxOffset.x - popupWidth;
				if (leftAlt >= 16) {
					left = leftAlt;
				} else {
					left = window.innerWidth - popupWidth - 16;
				}
			}
			left = Math.max(16, left);

			top = Math.min(
				Math.max(centerY + this.bboxOffset.y - popupHeight / 2, 16),
				window.innerHeight - popupHeight - 16
			);
		} else {
			// Screen coordinate positioning
			left = Math.min(Math.max(posOrBBox.x + this.defaultOffset.x, 16), window.innerWidth - popupWidth - 16);
			top = Math.min(Math.max(posOrBBox.y + this.defaultOffset.y, 16), window.innerHeight - popupHeight - 16);
		}

		this.container.style.left = `${left}px`;
		this.container.style.top = `${top}px`;
	}

	public setError(hasError: boolean, message?: string, fieldId?: TFieldId): void {
		if (!this.container) return;

		if (fieldId) {
			const field = this.fieldMap.get(fieldId);
			if (field?.wrapperEl) {
				if (hasError) field.wrapperEl.classList.add('error');
				else field.wrapperEl.classList.remove('error');
			}
		} else {
			this.fieldMap.forEach(f => {
				if (hasError) f.wrapperEl?.classList.add('error');
				else f.wrapperEl?.classList.remove('error');
			});
		}

		if (hasError) {
			this.errorEl.textContent = message || 'Invalid parameters';
			this.errorEl.classList.remove('hidden');
		} else {
			this.errorEl.textContent = '';
			this.errorEl.classList.add('hidden');
		}
	}

	public setFieldVisible(id: TFieldId, visible: boolean): void {
		const field = this.fieldMap.get(id);
		if (!field) return;
		field.isVisible = visible;
		if (field.row) {
			if (visible) {
				field.row.classList?.remove?.('hidden');
			} else {
				field.row.classList?.add?.('hidden');
			}
		}
	}

	public isFieldVisible(id: TFieldId): boolean {
		const field = this.fieldMap.get(id);
		return field?.isVisible ?? false;
	}

	public isRadiusVisible(): boolean {
		return this.isFieldVisible('radius' as any);
	}

	public get dist1Input(): HTMLInputElement | undefined {
		return this.getInputElement('dist1' as any);
	}

	public get dist2Input(): HTMLInputElement | undefined {
		return this.getInputElement('dist2' as any);
	}

	public get angleInput(): HTMLInputElement | undefined {
		return this.getInputElement('angle' as any);
	}

	public get flipCheckbox(): HTMLInputElement | undefined {
		return this.getInputElement('flip' as any);
	}

	public getExpressions(): Record<TFieldId, string | undefined> {
		const result = {} as Record<TFieldId, string | undefined>;
		for (const id of this.fieldOrder) {
			result[id] = this.getExpression(id);
		}
		return result;
	}

	public getParams(): Record<string, any> {
		const res: Record<string, any> = {};
		for (const id of this.fieldOrder) {
			const field = this.fieldMap.get(id);
			if (!field) continue;
			if (field.config.type === 'checkbox') {
				res[id] = this.getBooleanValue(id);
			} else if (field.config.type === 'integer') {
				res[id] = this.getNumericValue(id);
			} else {
				res[id] = this.getNumericValue(id, Number(field.config.defaultValue ?? 0));
			}
		}
		return res;
	}

	public updateValues(
		val1?: number | string | boolean | Partial<Record<TFieldId, number | string | boolean>>,
		val2?: number | string | boolean,
		val3?: number | string | boolean
	): void {
		if (val1 !== null && typeof val1 === 'object') {
			for (const [id, val] of Object.entries(val1)) {
				this.setValue(id as TFieldId, val as any);
			}
			return;
		}
		const fields = this.fieldOrder;
		if (val1 !== undefined && fields[0]) this.setValue(fields[0], val1 as number | string | boolean);
		if (val2 !== undefined && fields[1]) this.setValue(fields[1], val2);
		if (val3 !== undefined && fields[2]) this.setValue(fields[2], val3);
	}

	public updateValueIfUnlocked(
		id: TFieldId,
		value: number | string | boolean | null | undefined,
		formatNumber = true
	): void {
		if (!this.isLocked(id)) {
			this.setValue(id, value, formatNumber);
		}
	}

	public resetField(id: TFieldId, value?: number | string | boolean): void {
		this.setLocked(id, false);
		if (value !== undefined) {
			this.setValue(id, value);
		}
	}

	public setFieldLabel(id: TFieldId, label: string): void {
		const field = this.fieldMap.get(id);
		if (!field) return;
		if (field.labelEl) {
			field.labelEl.textContent = label;
		}
	}

	public isLocked(id: TFieldId): boolean {
		const field = this.fieldMap.get(id);
		return field?.isLocked ?? false;
	}

	public setLocked(id: TFieldId, locked: boolean, notify = false): void {
		const field = this.fieldMap.get(id);
		if (!field) return;
		field.isLocked = locked;
		this.updateLockUI(field);
		if (notify) {
			this.onLockChange?.(id, locked);
		}
	}

	public getNumericValue(id: TFieldId, fallback = 0): number {
		const field = this.fieldMap.get(id);
		if (!field) return fallback;

		if (field.config.type === 'integer') {
			const val = parseInt(field.input.value, 10);
			if (isNaN(val)) return fallback;
			if (field.config.min !== undefined && val < field.config.min) return field.config.min;
			if (field.config.max !== undefined && val > field.config.max) return field.config.max;
			return val;
		}

		const val = parseNumericOrExpression(field.input.value, fallback, this.sketch?.getParameterValuesMap());
		if (isNaN(val)) return fallback;
		if (field.config.min !== undefined && val < field.config.min) return field.config.min;
		if (field.config.max !== undefined && val > field.config.max) return field.config.max;
		return val;
	}

	public getStringValue(id: TFieldId): string {
		const field = this.fieldMap.get(id);
		return field?.input.value ?? '';
	}

	public getBooleanValue(id: TFieldId): boolean {
		const field = this.fieldMap.get(id);
		return field?.input.checked ?? false;
	}

	public getExpression(id: TFieldId): string | undefined {
		const field = this.fieldMap.get(id);
		if (!field || field.config.type !== 'dimension') return undefined;
		return getExpressionIfValid(field.input.value, this.sketch?.getParameterValuesMap());
	}

	public setValue(id: TFieldId, value: number | string | boolean | null | undefined, formatNumber = true): void {
		const field = this.fieldMap.get(id);
		if (!field) return;

		if (field.config.type === 'checkbox') {
			field.input.checked = Boolean(value);
		} else {
			if (value === null || value === undefined) {
				field.input.value = '';
			} else if (typeof value === 'number') {
				if (field.config.type === 'integer') {
					field.input.value = Math.round(value).toString();
				} else if (formatNumber) {
					field.input.value = Number(value.toFixed(1)).toString();
				} else {
					field.input.value = String(value);
				}
			} else {
				field.input.value = String(value);
			}
			if (field.config.type === 'dimension') {
				this.updateFieldEvalPreview(field);
			}
		}
	}

	public getInputElement(id: TFieldId): HTMLInputElement | undefined {
		return this.fieldMap.get(id)?.input;
	}

	protected setupEvents(): void {
		this.container.addEventListener('mousedown', e => e.stopPropagation());
		this.container.addEventListener('click', e => e.stopPropagation());

		this.fieldMap.forEach((field, id) => {
			if (field.config.type === 'checkbox') {
				field.input.addEventListener('change', () => {
					this.onChange?.(id, field.input.checked);
				});
			} else {
				field.input.addEventListener('input', () => {
					if (field.config.lockable) {
						field.isLocked = true;
						this.updateLockUI(field);
					}
					if (field.config.type === 'dimension') {
						this.updateFieldEvalPreview(field);
					}
					const val =
						field.config.type === 'integer'
							? this.getNumericValue(id)
							: field.config.type === 'dimension'
								? this.getNumericValue(id, Number(field.config.defaultValue ?? 0))
								: field.input.value;
					this.onChange?.(id, val);
				});
			}

			field.input.addEventListener('keydown', e => {
				if (this.onKeyDown?.(e)) {
					return;
				}
				if (e.key === 'Tab') {
					e.preventDefault();
					e.stopPropagation();
					this.cycleFocus(e.shiftKey);
				} else if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					if (field.config.lockable) {
						field.isLocked = true;
						this.updateLockUI(field);
					}
					this.onCommit?.();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					this.onCancel?.();
				}
			});

			if (field.lockBtn) {
				field.lockBtn.addEventListener('click', e => {
					e.stopPropagation();
					field.isLocked = !field.isLocked;
					this.updateLockUI(field);
					this.onLockChange?.(id, field.isLocked);
					field.input.focus();
					field.input.select();
				});
			}
		});
	}

	protected updateLockUI(field: FieldElements): void {
		if (!field.lockBtn) return;
		if (field.isLocked) {
			field.lockBtn.classList.add('locked');
			field.lockBtn.innerHTML = POPUP_LOCK_ICON;
			field.lockBtn.title = `Unlock ${field.config.label.toLowerCase()}`;
		} else {
			field.lockBtn.classList.remove('locked');
			field.lockBtn.innerHTML = POPUP_UNLOCK_ICON;
			field.lockBtn.title = `Lock ${field.config.label.toLowerCase()}`;
		}
	}

	protected updateAllEvalPreviews(): void {
		this.fieldMap.forEach(field => {
			if (field.config.type === 'dimension') {
				this.updateFieldEvalPreview(field);
			}
		});
	}

	protected updateFieldEvalPreview(field: FieldElements): void {
		if (!field.evalPreviewEl) return;
		updateExpressionPreview(
			field.input.value,
			field.config.unit ?? 'mm',
			field.evalPreviewEl,
			this.sketch?.getParameterValuesMap(),
			field.wrapperEl
		);
	}

	protected focusFieldElement(el: HTMLElement): void {
		el.focus?.();
		if (
			(typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) ||
			(el as any)?.tagName === 'INPUT'
		) {
			(el as HTMLInputElement).select?.();
		}
	}

	protected getFirstVisibleField(): FieldElements | undefined {
		for (const id of this.fieldOrder) {
			const field = this.fieldMap.get(id);
			if (field?.isVisible) return field;
		}
		return undefined;
	}

	protected getVisibleInputElements(): HTMLElement[] {
		const visible: HTMLElement[] = [];
		for (const id of this.fieldOrder) {
			const field = this.fieldMap.get(id);
			if (field?.isVisible && field.input) {
				visible.push(field.input);
			}
		}
		return visible;
	}
}

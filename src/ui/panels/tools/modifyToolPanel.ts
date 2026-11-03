import type { IToolPanel } from './types';
import { getToolIcon } from './iconProvider';

export interface ModifyStep {
	id: string;
	num: number;
	title: string;
	getValue: () => string;
	isActive: () => boolean;
	isSelected?: () => boolean;
	showClear?: () => boolean;
	clearTitle?: string;
	onSelect: () => void;
	onClear?: () => void;
}

export type ModifyParamItem =
	| { type: 'header'; label: string; marginTop?: string }
	| {
			type: 'segmented';
			label: string;
			options: Array<{ id: string; label: string }>;
			isVisible?: () => boolean;
			getValue: () => string;
			onSelect: (val: string) => void;
	  }
	| {
			type: 'field';
			id: string;
			label: string;
			unit?: string;
			min?: number;
			max?: number;
			step?: number;
			isVisible?: () => boolean;
			getValue: () => number | string;
			onInput?: (val: number) => void;
			onChange?: (val: number) => void;
	  }
	| {
			type: 'checkbox';
			id: string;
			label: string;
			badge?: () => string;
			marginTop?: string;
			isVisible?: () => boolean;
			isChecked: () => boolean;
			onChange: (checked: boolean) => void;
	  };

export interface ModifyToolPanelOptions {
	iconName: string;
	title: string;
	description: string;
	steps: ModifyStep[];
	params?: ModifyParamItem[];
	renderParams?: () => string;
	bindParams?: (container: HTMLElement) => void;
	canApply: () => boolean;
	applyLabel: string;
	onApply: () => void;
	onCancel: () => void;
	getHint: () => string;
	bindStateChange?: (onUpdate: () => void) => void;
}

export class ModifyToolPanel implements IToolPanel {
	readonly options: ModifyToolPanelOptions;

	constructor(options: ModifyToolPanelOptions) {
		this.options = options;
	}

	render(): string {
		const canApply = this.options.canApply();
		const iconHtml =
			getToolIcon(this.options.iconName) ||
			getToolIcon(this.options.iconName.replace(/_([a-z])/g, (_, g) => g.toUpperCase()));

		const stepsHtml = this.options.steps
			.map(
				(step, idx) => `
			<div class="mirror-step-item ${step.isActive() ? 'active' : ''}">
				<button class="mirror-step-btn btn-modify-step" data-step-index="${idx}" type="button">
					<span class="mirror-step-num">${step.num}</span>
					<div class="mirror-step-info">
						<div class="mirror-step-title">${step.title}</div>
						<div class="mirror-step-value ${step.isSelected?.() ? 'selected-line' : ''}">${step.getValue()}</div>
					</div>
				</button>
				${step.showClear?.() ? `<button class="mirror-step-clear btn-modify-clear" data-step-index="${idx}" title="${step.clearTitle ?? 'Clear'}">✕</button>` : ''}
			</div>
		`
			)
			.join('');

		let paramsHtml = '';
		if (this.options.renderParams) {
			paramsHtml = this.options.renderParams();
		} else if (this.options.params && this.options.params.length > 0) {
			const itemsHtml = this.options.params
				.map((param, idx) => {
					if (param.type === 'header') {
						const mt = param.marginTop ?? '4px';
						return `<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: ${mt};">${param.label}</div>`;
					}
					if (param.isVisible && !param.isVisible()) return '';

					if (param.type === 'segmented') {
						const current = param.getValue();
						return `
							<div class="pattern-param-row">
								<label class="pattern-param-label">${param.label}</label>
								<div class="pattern-segmented-control">
									${param.options
										.map(
											opt => `
										<button type="button" class="seg-btn ${opt.id === current ? 'active' : ''}" data-param-idx="${idx}" data-seg-id="${opt.id}">${opt.label}</button>
									`
										)
										.join('')}
								</div>
							</div>
						`;
					}

					if (param.type === 'field') {
						const val = param.getValue();
						const minAttr = param.min !== undefined ? `min="${param.min}"` : '';
						const maxAttr = param.max !== undefined ? `max="${param.max}"` : '';
						const stepAttr = param.step !== undefined ? `step="${param.step}"` : '';
						const wrapperClass = param.unit ? 'pattern-input-suffix-wrapper' : 'pattern-quantity-wrapper';
						return `
							<div class="pattern-param-row">
								<label class="pattern-param-label" for="${param.id}">${param.label}</label>
								<div class="${wrapperClass}">
									<input type="number" id="${param.id}" data-param-idx="${idx}" value="${val}" ${minAttr} ${maxAttr} ${stepAttr} class="pattern-num-input" />
									${param.unit ? `<span class="pattern-input-suffix">${param.unit}</span>` : ''}
								</div>
							</div>
						`;
					}

					if (param.type === 'checkbox') {
						const isChecked = param.isChecked();
						const badge = param.badge ? param.badge() : '';
						const mt = param.marginTop ? `style="margin-top: ${param.marginTop};"` : '';
						return `
							<div class="pattern-param-row pattern-suppress-row" ${mt}>
								<label class="pattern-checkbox-label">
									<input type="checkbox" id="${param.id}" data-param-idx="${idx}" ${isChecked ? 'checked' : ''} />
									<span>${param.label}</span>
								</label>
								${badge ? `<span class="pattern-suppress-count">${badge}</span>` : ''}
							</div>
						`;
					}

					return '';
				})
				.join('');

			if (itemsHtml.trim()) {
				paramsHtml = `<div class="pattern-params-card">${itemsHtml}</div>`;
			}
		}

		return `
			<div class="sidebar-panel-card tool-panel-card">
				<div class="panel-card-header">
					<div class="panel-card-title">
						<span class="panel-card-icon">${iconHtml}</span>
						<span>${this.options.title}</span>
					</div>
					<button class="btn-panel-close btn-tool-panel-close btn-modify-cancel-icon" title="Cancel (Esc)">✕</button>
				</div>
				<div class="panel-card-desc">
					${this.options.description}
				</div>

				<div class="mirror-steps">
					${stepsHtml}
				</div>

				${paramsHtml}

				<div class="mirror-actions">
					<button class="btn-mirror-ok btn-modify-ok" ${canApply ? '' : 'disabled'} title="${this.options.applyLabel} (Enter)">
						${this.options.applyLabel}
					</button>
					<button class="btn-mirror-cancel btn-modify-cancel" title="Cancel (Esc)">
						Cancel
					</button>
				</div>

				<div class="mirror-hint">
					${this.options.getHint()}
				</div>
			</div>
		`;
	}

	bindEvents(container: HTMLElement): void {
		container.querySelectorAll<HTMLButtonElement>('.btn-modify-step').forEach(btn => {
			btn.addEventListener('click', () => {
				const idx = Number(btn.getAttribute('data-step-index'));
				this.options.steps[idx]?.onSelect();
			});
		});

		container.querySelectorAll<HTMLButtonElement>('.btn-modify-clear').forEach(btn => {
			btn.addEventListener('click', e => {
				e.stopPropagation();
				const idx = Number(btn.getAttribute('data-step-index'));
				this.options.steps[idx]?.onClear?.();
			});
		});

		if (this.options.bindParams) {
			this.options.bindParams(container);
		}

		if (this.options.params) {
			this.options.params.forEach((param, idx) => {
				if (param.type === 'segmented') {
					container.querySelectorAll<HTMLButtonElement>(`.seg-btn[data-param-idx="${idx}"]`).forEach(btn => {
						btn.addEventListener('click', () => {
							const segId = btn.getAttribute('data-seg-id');
							if (segId) param.onSelect(segId);
						});
					});
				} else if (param.type === 'field') {
					const input = container.querySelector<HTMLInputElement>(`#${param.id}`);
					if (input) {
						if (param.onInput) {
							input.addEventListener('input', () => {
								const val = parseFloat(input.value);
								if (!isNaN(val)) param.onInput!(val);
							});
						}
						if (param.onChange) {
							input.addEventListener('change', () => {
								const val = parseFloat(input.value);
								if (!isNaN(val)) param.onChange!(val);
							});
						}
					}
				} else if (param.type === 'checkbox') {
					const cb = container.querySelector<HTMLInputElement>(`#${param.id}`);
					cb?.addEventListener('change', () => {
						param.onChange(cb.checked);
					});
				}
			});
		}

		const btnOk = container.querySelector<HTMLButtonElement>('.btn-modify-ok');
		btnOk?.addEventListener('click', () => {
			this.options.onApply();
		});

		const handleCancel = () => {
			this.options.onCancel();
		};

		const btnCancel = container.querySelector<HTMLButtonElement>('.btn-modify-cancel');
		btnCancel?.addEventListener('click', handleCancel);

		const btnCancelIcon = container.querySelector<HTMLButtonElement>('.btn-modify-cancel-icon');
		btnCancelIcon?.addEventListener('click', handleCancel);

		this.options.bindStateChange?.(() => {
				const card = container.querySelector<HTMLElement>('.tool-panel-card');
			if (card) {
				const temp = document.createElement('div');
				temp.innerHTML = this.render();
				const newCard = temp.firstElementChild;
				if (newCard) {
					card.replaceWith(newCard);
					this.bindEvents(container);
				}
			}
		});
	}

	handleKeyDown(e: KeyboardEvent): boolean {
		if (e.key === 'Escape') {
			this.options.onCancel();
			return true;
		}
		if (e.key === 'Enter' && this.options.canApply()) {
			this.options.onApply();
			return true;
		}
		return false;
	}
}

import type { IToolPanel } from './types';
import { getToolIcon } from './iconProvider';
import { showToast } from '../../toast';

export interface ToolVariationOption<M extends string> {
	id: M;
	label: string;
	title: string;
	icon?: string;
	iconName?: string;
}

export interface VariationToolPanelOptions<M extends string> {
	title: string;
	description: string;
	cardClass?: string;
	selectorClass?: string;
	buttonClass?: string;
	iconClass?: string;
	textClass?: string;
	hintClass?: string;
	dataAttribute?: string;
	cancelButtonId?: string;
	modes: ToolVariationOption<M>[];
	getCurrentMode: () => M;
	onSelectMode: (mode: M) => void;
	onCancel: () => void;
	getHint?: () => string;
	getHeaderIcon?: () => string;
	bindStateChange?: (callback: () => void) => void;
	extraContent?: {
		render: () => string;
		bindEvents: (container: HTMLElement) => void;
	};
}

export class VariationToolPanel<M extends string> implements IToolPanel {
	private options: VariationToolPanelOptions<M>;
	private container?: HTMLElement;

	constructor(options: VariationToolPanelOptions<M>) {
		this.options = options;
	}

	private getCardSelector(): string {
		const { cardClass = 'sidebar-panel-card' } = this.options;
		return '.' + cardClass.trim().split(/\s+/).join('.');
	}

	rerender(): void {
		if (!this.container) return;
		const card = this.container.querySelector<HTMLElement>(this.getCardSelector());
		if (card) {
			const temp = document.createElement('div');
			temp.innerHTML = this.render();
			const newCard = temp.firstElementChild;
			if (newCard) {
				card.replaceWith(newCard);
				this.bindEvents(this.container);
			}
		}
	}

	handleKeyDown(e: KeyboardEvent): boolean {
		if (e.altKey && !e.ctrlKey && !e.metaKey) {
			const digitMatch = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
			if (digitMatch) {
				const index = parseInt(digitMatch[1], 10) - 1;
				if (index >= 0 && index < this.options.modes.length) {
					e.preventDefault();
					const mode = this.options.modes[index];
					this.options.onSelectMode(mode.id);
					this.rerender();
					showToast(mode.title || `${mode.label} (Alt+${index + 1})`);
					return true;
				}
			}
		}
		return false;
	}

	render(): string {
		const {
			title,
			description,
			cardClass = '',
			selectorClass = 'tool-mode-selector',
			buttonClass = 'tool-mode-btn',
			iconClass = 'tool-mode-icon',
			textClass = 'tool-mode-text',
			hintClass = 'tool-mode-hint',
			dataAttribute = 'data-mode',
			cancelButtonId,
			modes,
			getCurrentMode,
			getHint,
			getHeaderIcon,
			extraContent,
		} = this.options;

		const currentMode = getCurrentMode();
		const hint = getHint?.() ?? '';
		const currentOpt = modes.find(m => m.id === currentMode);
		const defaultHeaderIcon = currentOpt ? (currentOpt.icon ?? (currentOpt.iconName ? getToolIcon(currentOpt.iconName) : '')) : '';
		const headerIcon = getHeaderIcon?.() ?? defaultHeaderIcon;
		const cancelIdAttr = cancelButtonId ? `id="${cancelButtonId}"` : '';

		const buttonsHtml = modes
			.map(m => {
				const active = m.id === currentMode ? 'active' : '';
				const iconSvg = m.icon ?? (m.iconName ? getToolIcon(m.iconName) : '');
				return `
					<button class="${buttonClass} ${active}" ${dataAttribute}="${m.id}" type="button" title="${m.title}">
						<span class="${iconClass}">${iconSvg}</span>
						<span class="${textClass}">${m.label}</span>
					</button>
				`;
			})
			.join('');

		const extraHtml = extraContent ? extraContent.render() : '';

		return `
			<div class="sidebar-panel-card ${cardClass}">
				<div class="panel-card-header">
					<div class="panel-card-title">
						<span class="panel-card-icon">${headerIcon}</span>
						<span>${title}</span>
					</div>
					<button class="btn-panel-close btn-tool-panel-close" ${cancelIdAttr} title="Cancel (Esc)">✕</button>
				</div>
				<div class="panel-card-desc">
					${description}
				</div>
				<div class="${selectorClass}">
					${buttonsHtml}
				</div>
				${extraHtml}
				${hint ? `<div class="${hintClass}">${hint}</div>` : ''}
			</div>
		`;
	}

	bindEvents(container: HTMLElement): void {
		this.container = container;
		const {
			dataAttribute = 'data-mode',
			cancelButtonId,
			onSelectMode,
			onCancel,
			extraContent,
			bindStateChange,
		} = this.options;

		const rerenderCard = () => {
			this.rerender();
		};

		// Mode buttons
		const btns = container.querySelectorAll<HTMLButtonElement>(`[${dataAttribute}]`);
		btns.forEach(btn => {
			btn.addEventListener('click', () => {
				const mode = btn.getAttribute(dataAttribute) as M;
				if (mode) {
					onSelectMode(mode);
					rerenderCard();
				}
			});
		});

		// Cancel button (by specific ID or generic class)
		if (cancelButtonId) {
			const cancelBtn = container.querySelector<HTMLButtonElement>(`#${cancelButtonId}`);
			cancelBtn?.addEventListener('click', () => onCancel());
		}
		const genericClose = container.querySelector<HTMLButtonElement>('.btn-tool-panel-close');
		genericClose?.addEventListener('click', () => onCancel());

		// Extra content events (e.g. checkbox in OffsetTool)
		extraContent?.bindEvents(container);

		// Self-update when tool state changes (e.g. step advances during drawing)
		if (bindStateChange) {
			bindStateChange(() => {
				rerenderCard();
			});
		}
	}
}

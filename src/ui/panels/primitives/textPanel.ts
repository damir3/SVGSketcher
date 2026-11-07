import type { InspectorContext, ISidebarPanel } from '../inspector/types';
import type { SketchText } from '../../../model/primitives/text';
import { getToolIcon } from '../tools/iconProvider';
import {
	AVAILABLE_FONTS,
	loadFontFromFile,
	isLocalFontAccessSupported,
	querySystemFonts,
	loadFontAsync,
} from '../../../canvas/fonts';

export interface TextCardData {
	mode: 'text' | 'text_on_path';
	text: string;
	fontFamily: string;
	bold: boolean;
	italic: boolean;
	height: number;
	characterSpacing: number;
	verticalAlignment: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	alignment: 'left' | 'center' | 'right';
}

export interface TextCardCallbacks {
	getData: () => TextCardData;
	setData: (updater: (data: TextCardData) => void, pushHistory?: boolean) => void;
	requestRender?: () => void;
	onClose?: () => void;
	isToolMode?: boolean;
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export function renderTextCardHtml(data: TextCardData, options: { isToolMode?: boolean } = {}): string {
	const isTool = !!options.isToolMode;
	const title = isTool ? 'Text Tool' : 'Text';
	const closeTitle = isTool ? 'Close' : 'Deselect';

	return `
	<div class="sidebar-panel-card tool-panel-card text-tool-card ${isTool ? '' : 'in-inspector'}">
		<div class="panel-card-header">
			<div class="panel-card-title">
				<span class="panel-card-icon">${getToolIcon('text') || 'T'}</span>
				<span>${title}</span>
			</div>
			<button class="btn-panel-close btn-tool-panel-close" id="btn-text-tool-close" title="${closeTitle}">✕</button>
		</div>

		${
			isTool
				? `
		<!-- Mode selection: Text or Text On Path (tool mode only, no Mode label) -->
		<div class="tool-mode-selector" id="text-tool-mode-control" style="margin-bottom: 8px;">
			<button class="tool-mode-button ${data.mode === 'text' ? 'active' : ''}" data-mode="text" type="button" title="Text in Rectangle (Alt+1)">
				<span class="tool-mode-icon">${getToolIcon('text_rect') || getToolIcon('text')}</span>
				<span class="tool-mode-label">Text</span>
			</button>
			<button class="tool-mode-button ${data.mode === 'text_on_path' ? 'active' : ''}" data-mode="text_on_path" type="button" title="Text on Path (Alt+2)">
				<span class="tool-mode-icon">${getToolIcon('text_on_path')}</span>
				<span class="tool-mode-label">Text On Path</span>
			</button>
		</div>
		`
				: ''
		}

		<!-- Multiline Text Input -->
		<div class="pattern-param-row" style="align-items: flex-start; justify-content: space-between;">
			<span class="pattern-param-label" style="margin-top: 4px; flex-shrink: 0;">Text</span>
			<textarea id="text-tool-input-text" class="pattern-num-input" style="width: 80%; min-height: 52px; max-height: 140px; text-align: left; font-size: 11px; padding: 4px 6px; resize: vertical; box-sizing: border-box; line-height: 1.3;" autocomplete="off" spellcheck="false" placeholder="Enter text...">${escapeHtml(data.text)}</textarea>
		</div>

		<!-- Font Select -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Font</span>
			<div style="display: flex; align-items: center; gap: 4px;">
				<select id="text-tool-select-font" class="seg-btn" style="border: 1px solid var(--border-color); border-radius: 4px; padding: 3px 6px; font-size: 10.5px; background: var(--bg-surface-elevated); color: var(--text-primary); cursor: pointer; max-width: 145px;">
					${AVAILABLE_FONTS.map(
						f => `<option value="${f.id}" ${data.fontFamily === f.id ? 'selected' : ''}>${f.name}</option>`
					).join('')}
					${isLocalFontAccessSupported() ? `<option value="__scan_local_fonts__">+ Scan System Fonts...</option>` : ''}
				</select>
				<button type="button" id="text-tool-btn-loadfont" class="seg-btn" title="Load custom font file (.ttf, .otf, .woff)" style="padding: 3px 6px; font-size: 11px;">📁</button>
				<input type="file" id="text-tool-file-font" accept=".ttf,.otf,.woff" style="display: none;" />
			</div>
		</div>

		<!-- Typeface (Bold, Italic toggles) -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Typeface</span>
			<div class="pattern-segmented-control">
				<button type="button" id="text-tool-btn-bold" class="seg-btn ${data.bold ? 'active' : ''}" title="Bold" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('bold')}</button>
				<button type="button" id="text-tool-btn-italic" class="seg-btn ${data.italic ? 'active' : ''}" title="Italic" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('italic')}</button>
			</div>
		</div>

		<!-- Height in mm -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Height</span>
			<div style="display: flex; align-items: center; gap: 4px;">
				<input type="number" id="text-tool-input-height" class="pattern-num-input" value="${data.height}" min="0.5" max="500" step="1" style="width: 60px;" />
				<span style="font-size: 11px; color: var(--text-secondary);">mm</span>
			</div>
		</div>

		${
			data.mode === 'text_on_path'
				? `
		<!-- Fit to Path (label on the left, checkbox on the right) -->
		<div class="pattern-param-row" style="justify-content: space-between;">
			<label for="text-tool-cb-fittopath" class="pattern-param-label" style="cursor: pointer; margin: 0;">Fit to Path</label>
			<input type="checkbox" id="text-tool-cb-fittopath" ${data.fitToPath ? 'checked' : ''} style="cursor: pointer; margin: 0;" />
		</div>
		`
				: ''
		}

		${
			!(data.mode === 'text_on_path' && data.fitToPath)
				? `
		<!-- Character Spacing in % (hidden when fitToPath is enabled on text_on_path) -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Spacing</span>
			<div style="display: flex; align-items: center; gap: 4px;">
				<input type="number" id="text-tool-input-spacing" class="pattern-num-input" value="${data.characterSpacing}" min="-50" max="500" step="5" style="width: 60px;" />
				<span style="font-size: 11px; color: var(--text-secondary);">%</span>
			</div>
		</div>
		`
				: ''
		}

		<!-- Alignment (Horizontal and Vertical) -->
		<div class="pattern-param-row" style="align-items: flex-start; justify-content: space-between;">
			<span class="pattern-param-label" style="margin-top: 4px;">Alignment</span>
			<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
				<div class="pattern-segmented-control">
					<button type="button" class="seg-btn ${data.alignment === 'left' ? 'active' : ''}" data-align="left" title="Align Left" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_left')}</button>
					<button type="button" class="seg-btn ${data.alignment === 'center' ? 'active' : ''}" data-align="center" title="Align Center" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_center')}</button>
					<button type="button" class="seg-btn ${data.alignment === 'right' ? 'active' : ''}" data-align="right" title="Align Right" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_right')}</button>
				</div>
				${
					data.mode === 'text'
						? `
				<div class="pattern-segmented-control">
					<button type="button" class="seg-btn ${data.verticalAlignment === 'top' ? 'active' : ''}" data-valign="top" title="Align Top" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_top')}</button>
					<button type="button" class="seg-btn ${data.verticalAlignment === 'middle' ? 'active' : ''}" data-valign="middle" title="Align Middle" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_middle')}</button>
					<button type="button" class="seg-btn ${data.verticalAlignment === 'bottom' ? 'active' : ''}" data-valign="bottom" title="Align Bottom" style="padding: 3px 8px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('align_bottom')}</button>
				</div>
				`
						: ''
				}
			</div>
		</div>

		${
			data.mode === 'text_on_path'
				? `
		<!-- Placement (Above / Below) - only for Text On Path -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Placement</span>
			<div class="pattern-segmented-control">
				<button type="button" class="seg-btn ${data.placement === 'above' ? 'active' : ''}" data-placement="above" title="Above Path" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('placement_above')}</button>
				<button type="button" class="seg-btn ${data.placement === 'below' ? 'active' : ''}" data-placement="below" title="Below Path" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('placement_below')}</button>
			</div>
		</div>
		`
				: ''
		}

		<!-- Flip (Horizontal / Vertical) -->
		<div class="pattern-param-row">
			<span class="pattern-param-label">Flip</span>
			<div class="pattern-segmented-control">
				<button type="button" id="text-tool-btn-fliph" class="seg-btn ${data.flipHorizontal ? 'active' : ''}" title="Flip Horizontal" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('flip_horizontal')}</button>
				<button type="button" id="text-tool-btn-flipv" class="seg-btn ${data.flipVertical ? 'active' : ''}" title="Flip Vertical" style="padding: 3px 12px; display: inline-flex; align-items: center; justify-content: center;">${getToolIcon('flip_vertical')}</button>
			</div>
		</div>

		${
			isTool
				? `
		<div class="tool-mode-hint">
			${
				data.mode === 'text'
					? 'Click & drag on canvas to draw rectangle frame'
					: 'Click a primitive (line, circle, arc, ellipse, elliptical arc, spline) to place text'
			}
		</div>
		`
				: ''
		}
	</div>
	`;
}

export function bindTextCardEvents(cardEl: HTMLElement, callbacks: TextCardCallbacks, rerender: () => void): void {
	// Close / cancel button
	cardEl.querySelector('#btn-text-tool-close')?.addEventListener('click', () => {
		callbacks.onClose?.();
	});

	// Mode buttons
	cardEl.querySelectorAll<HTMLButtonElement>('#text-tool-mode-control [data-mode]').forEach(btn => {
		btn.addEventListener('click', () => {
			const mode = btn.getAttribute('data-mode') as 'text' | 'text_on_path';
			if (mode && callbacks.getData().mode !== mode) {
				callbacks.setData(d => (d.mode = mode), true);
				rerender();
			}
		});
	});

	// Multiline textarea
	const textarea = cardEl.querySelector<HTMLTextAreaElement>('#text-tool-input-text');
	if (textarea) {
		// Stop propagation of key events to prevent global shortcuts while typing
		textarea.addEventListener('keydown', e => {
			e.stopPropagation();
		});
		textarea.addEventListener('keyup', e => {
			e.stopPropagation();
		});

		// Live canvas update on input without pushing history or re-rendering entire sidebar
		textarea.addEventListener('input', () => {
			callbacks.setData(d => (d.text = textarea.value), false);
			callbacks.requestRender?.();
		});

		// Push history when editing finishes
		textarea.addEventListener('change', () => {
			callbacks.setData(d => (d.text = textarea.value), true);
		});
	}

	// Font select
	const fontSelect = cardEl.querySelector<HTMLSelectElement>('#text-tool-select-font');
	fontSelect?.addEventListener('change', async () => {
		if (fontSelect.value === '__scan_local_fonts__') {
			try {
				await querySystemFonts();
				rerender();
			} catch (err) {
				console.warn('Local Font Access denied or failed:', err);
				rerender();
			}
			return;
		}

		const newFamily = fontSelect.value;
		await loadFontAsync(newFamily, callbacks.getData().bold, callbacks.getData().italic);
		callbacks.setData(d => (d.fontFamily = newFamily), true);
		callbacks.requestRender?.();
	});

	// Load custom font file (.ttf, .otf, .woff)
	const loadFontBtn = cardEl.querySelector<HTMLButtonElement>('#text-tool-btn-loadfont');
	const fontFileInput = cardEl.querySelector<HTMLInputElement>('#text-tool-file-font');
	loadFontBtn?.addEventListener('click', () => {
		fontFileInput?.click();
	});
	fontFileInput?.addEventListener('change', async () => {
		const file = fontFileInput.files?.[0];
		if (!file) return;
		try {
			const info = await loadFontFromFile(file);
			callbacks.setData(d => (d.fontFamily = info.id), true);
			rerender();
			callbacks.requestRender?.();
		} catch (err) {
			console.error('Failed to load font file:', err);
		}
	});

	// Bold toggle
	cardEl.querySelector('#text-tool-btn-bold')?.addEventListener('click', () => {
		callbacks.setData(d => (d.bold = !d.bold), true);
		rerender();
	});

	// Italic toggle
	cardEl.querySelector('#text-tool-btn-italic')?.addEventListener('click', () => {
		callbacks.setData(d => (d.italic = !d.italic), true);
		rerender();
	});

	// Height input
	const heightInput = cardEl.querySelector<HTMLInputElement>('#text-tool-input-height');
	if (heightInput) {
		heightInput.addEventListener('keydown', e => e.stopPropagation());
		heightInput.addEventListener('change', () => {
			const val = parseFloat(heightInput.value);
			if (!Number.isNaN(val) && val > 0) {
				callbacks.setData(d => (d.height = val), true);
				callbacks.requestRender?.();
			}
		});
	}

	// Spacing input
	const spacingInput = cardEl.querySelector<HTMLInputElement>('#text-tool-input-spacing');
	if (spacingInput) {
		spacingInput.addEventListener('keydown', e => e.stopPropagation());
		spacingInput.addEventListener('change', () => {
			const val = parseFloat(spacingInput.value);
			if (!Number.isNaN(val)) {
				callbacks.setData(d => (d.characterSpacing = val), true);
				callbacks.requestRender?.();
			}
		});
	}

	// Horizontal Alignment
	cardEl.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(btn => {
		btn.addEventListener('click', () => {
			const a = btn.getAttribute('data-align') as 'left' | 'center' | 'right';
			if (a && callbacks.getData().alignment !== a) {
				callbacks.setData(d => (d.alignment = a), true);
				rerender();
			}
		});
	});

	// Vertical Alignment (mode === 'text')
	cardEl.querySelectorAll<HTMLButtonElement>('[data-valign]').forEach(btn => {
		btn.addEventListener('click', () => {
			const va = btn.getAttribute('data-valign') as 'top' | 'middle' | 'bottom';
			if (va && callbacks.getData().verticalAlignment !== va) {
				callbacks.setData(d => (d.verticalAlignment = va), true);
				rerender();
			}
		});
	});

	// Placement (mode === 'text_on_path')
	cardEl.querySelectorAll<HTMLButtonElement>('[data-placement]').forEach(btn => {
		btn.addEventListener('click', () => {
			const p = btn.getAttribute('data-placement') as 'above' | 'below';
			if (p && callbacks.getData().placement !== p) {
				callbacks.setData(d => (d.placement = p), true);
				rerender();
			}
		});
	});

	// Fit to path checkbox (mode === 'text_on_path')
	const fitCheckbox = cardEl.querySelector<HTMLInputElement>('#text-tool-cb-fittopath');
	fitCheckbox?.addEventListener('change', () => {
		callbacks.setData(d => (d.fitToPath = fitCheckbox.checked), true);
		rerender();
	});

	// Flip Horizontal
	cardEl.querySelector('#text-tool-btn-fliph')?.addEventListener('click', () => {
		callbacks.setData(d => (d.flipHorizontal = !d.flipHorizontal), true);
		rerender();
	});

	// Flip Vertical
	cardEl.querySelector('#text-tool-btn-flipv')?.addEventListener('click', () => {
		callbacks.setData(d => (d.flipVertical = !d.flipVertical), true);
		rerender();
	});
}

/**
 * Inspector panel attached directly to a SketchText entity.
 * Displayed in the sidebar when the text is selected in SelectTool.
 */
export class TextInspectorPanel implements ISidebarPanel {
	private readonly text: SketchText;
	private container?: HTMLElement;

	constructor(text: SketchText) {
		this.text = text;
	}

	render(_context: InspectorContext): string {
		return renderTextCardHtml(this.text, { isToolMode: false });
	}

	rerender(context: InspectorContext): void {
		if (!this.container) return;
		const card =
			this.container.querySelector<HTMLElement>('.text-tool-card.in-inspector') ??
			this.container.querySelector<HTMLElement>('.text-tool-card');
		if (card) {
			const temp = document.createElement('div');
			temp.innerHTML = this.render(context);
			const newCard = temp.firstElementChild as HTMLElement | null;
			if (newCard) {
				card.replaceWith(newCard);
				this.bindEvents(this.container, context);
			}
		}
	}

	bindEvents(container: HTMLElement, context: InspectorContext): void {
		this.container = container;
		const cardEl =
			container.querySelector<HTMLElement>('.text-tool-card.in-inspector') ??
			container.querySelector<HTMLElement>('.text-tool-card');
		if (!cardEl) return;

		const callbacks: TextCardCallbacks = {
			getData: () => this.text,
			setData: (updater, pushHistory = true) => {
				updater(this.text);
				if (pushHistory) {
					context.sketch.pushHistory();
					context.sketch.notify();
				}
				context.requestRender?.();
			},
			requestRender: () => {
				context.requestRender?.();
			},
			onClose: () => {
				context.sketch.deselectEntity(this.text.id, 'text');
			},
			isToolMode: false,
		};

		bindTextCardEvents(cardEl, callbacks, () => this.rerender(context));
	}
}

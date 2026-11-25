import { updateExpressionPreview } from '../../expression-preview';
import type { InspectorContext } from './types';

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export function formatInlineUnitValue(val: number | string, unit?: string): string {
	if (!unit) return String(val);
	return unit === '°' ? `${val}°` : `${val} ${unit}`;
}

export interface InlineValueControlOptions {
	key: string;
	inputId: string;
	label: string;
	unit?: string;
	displayAttr?: { name: string; value: string };
	getDisplayValue: () => string;
	getInitialInputValue: () => string;
	getExpression?: () => string | undefined;
	validate?: (val: number) => boolean;
	step?: number;
	max?: number;
	commit: (text: string, evaluatedValue: number) => boolean;
}

export function renderInlineValueControl(opts: InlineValueControlOptions): string {
	const expr = opts.getExpression?.();
	const displayTitle = expr ? `fx: ${escapeHtml(expr)} — click to edit` : 'Click to edit';
	const extraAttr = opts.displayAttr ? ` ${opts.displayAttr.name}="${escapeHtml(opts.displayAttr.value)}"` : '';
	const initialValue = opts.getInitialInputValue();

	return `
		<div class="inspector-param-row" data-dim-row="${escapeHtml(opts.key)}">
			<span class="inspector-param-label">${opts.label}:</span>
			<div class="inspector-value-group">
				<button type="button" class="inspector-value-display" data-inline-key="${escapeHtml(opts.key)}"${extraAttr} title="${displayTitle}">
					${expr ? '<span class="inspector-expr-badge">fx</span>' : ''}
					<strong>${opts.getDisplayValue()}</strong>
				</button>
				<div class="inspector-inline-editor hidden" data-dim-editor="${escapeHtml(opts.key)}">
					<div class="pattern-input-suffix-wrapper inspector-dim-input-wrap" data-dim-wrap="${escapeHtml(opts.key)}">
						<input type="text" class="pattern-num-input inspector-dim-input" id="${escapeHtml(opts.inputId)}" value="${escapeHtml(initialValue)}" autocomplete="off" spellcheck="false" />
						${opts.unit ? `<span class="pattern-input-suffix">${opts.unit}</span>` : ''}
					</div>
					<div class="dim-eval-preview inspector-dim-preview hidden" id="insp-dim-preview-${escapeHtml(opts.key)}"></div>
				</div>
			</div>
		</div>
	`;
}

export function bindInlineValueControl(
	container: HTMLElement,
	context: InspectorContext,
	opts: InlineValueControlOptions
): void {
	const displaySelector = opts.displayAttr
		? `.inspector-value-display[${opts.displayAttr.name}="${opts.displayAttr.value}"]`
		: `.inspector-value-display[data-inline-key="${opts.key}"]`;
	const displayBtn =
		container.querySelector<HTMLElement>(displaySelector) ??
		container.querySelector<HTMLElement>(`.inspector-value-display[data-inline-key="${opts.key}"]`);
	const editorEl = container.querySelector<HTMLElement>(`[data-dim-editor="${opts.key}"]`);
	const wrapEl = container.querySelector<HTMLElement>(`[data-dim-wrap="${opts.key}"]`);
	const input = container.querySelector<HTMLInputElement>(`#${opts.inputId}`);
	const previewEl = container.querySelector<HTMLElement>(`#insp-dim-preview-${opts.key}`);
	if (!displayBtn || !editorEl || !input) return;

	const validate = opts.validate ?? (val => !Number.isNaN(val) && Number.isFinite(val));
	const unit = opts.unit ?? '';
	let editing = false;
	let settling = false;
	let openedInitialVal = '';

	const selectAll = () => {
		input.focus?.();
		input.select?.();
		try {
			input.setSelectionRange?.(0, input.value.length);
		} catch {
			// ignore
		}
	};

	const showError = (message: string) => {
		wrapEl?.classList.add('error');
		if (previewEl) {
			previewEl.textContent = message;
			previewEl.classList.remove('hidden');
			previewEl.classList.add('error');
		}
		selectAll();
	};

	const openEditor = () => {
		if (editing) return;
		const initialValue = opts.getInitialInputValue();
		editing = true;
		settling = false;
		openedInitialVal = initialValue;
		input.value = initialValue;
		wrapEl?.classList.remove('error');
		displayBtn.classList.add('hidden');
		editorEl.classList.remove('hidden');
		updateExpressionPreview(input.value, unit, previewEl, context.sketch.getParameterValuesMap(), wrapEl);
		selectAll();
	};

	const closeEditor = (restoreFocus: boolean) => {
		if (!editing) return;
		settling = true;
		editing = false;
		editorEl.classList.add('hidden');
		wrapEl?.classList.remove('error');
		previewEl?.classList.add('hidden');
		displayBtn.classList.remove('hidden');
		if (restoreFocus) displayBtn.focus?.();
		settling = false;
	};

	const commitEditor = (fromEnter: boolean, relatedTarget?: EventTarget | null) => {
		if (!editing || settling) return;
		const text = input.value.trim();
		if (text === openedInitialVal) {
			closeEditor(fromEnter);
			return;
		}
		if (!text) {
			if (fromEnter) showError('! Invalid expression');
			else closeEditor(false);
			return;
		}
		const evalRes = context.sketch.evaluateExpression(text);
		if (!evalRes.isValid || evalRes.value === undefined || !validate(evalRes.value)) {
			if (fromEnter) showError(evalRes.error ? `! ${evalRes.error}` : '! Invalid value');
			else closeEditor(false);
			return;
		}

		if (fromEnter) {
			const updated = opts.commit(text, evalRes.value);
			if (!updated) {
				showError('Failed to solve');
				return;
			}
			settling = true;
			editing = false;
			editorEl.classList.add('hidden');
			displayBtn.classList.remove('hidden');
			input.blur?.();
			settling = false;
			context.requestRender?.();
			(
				container.querySelector<HTMLElement>(displaySelector) ??
				container.querySelector<HTMLElement>(`.inspector-value-display[data-inline-key="${opts.key}"]`)
			)?.focus?.();
			return;
		}

		const keepDomForClick =
			typeof Node !== 'undefined' && relatedTarget instanceof Node && container.contains(relatedTarget);
		settling = true;
		editing = false;
		editorEl.classList.add('hidden');
		wrapEl?.classList.remove('error');
		previewEl?.classList.add('hidden');
		displayBtn.classList.remove('hidden');
		if (keepDomForClick) {
			let updated = false;
			const runUpdate = () => {
				updated = opts.commit(text, evalRes.value!);
			};
			if (context.withoutSidebarRender) context.withoutSidebarRender(runUpdate);
			else runUpdate();
			if (updated) {
				const expr = opts.getExpression?.();
				displayBtn.innerHTML = `${
					expr ? '<span class="inspector-expr-badge">fx</span>' : ''
				}<strong>${opts.getDisplayValue()}</strong>`;
				displayBtn.title = expr ? `fx: ${expr} — click to edit` : 'Click to edit';
			}
		} else if (opts.commit(text, evalRes.value)) {
			context.requestRender?.();
		}
		settling = false;
	};

	displayBtn.addEventListener('click', e => {
		e.stopPropagation();
		openEditor();
	});
	displayBtn.addEventListener('dblclick', e => {
		e.stopPropagation();
		openEditor();
	});
	editorEl.addEventListener('click', e => e.stopPropagation());
	editorEl.addEventListener('dblclick', e => e.stopPropagation());

	input.addEventListener('input', () => {
		updateExpressionPreview(input.value, unit, previewEl, context.sketch.getParameterValuesMap(), wrapEl);
	});

	input.addEventListener('keydown', e => {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEditor(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeEditor(true);
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const stepVal = opts.step ?? (unit === '°' ? 0.5 : 0.1);
			const delta = (e.key === 'ArrowUp' ? 1 : -1) * stepVal;
			const evalRes = context.sketch.evaluateExpression(input.value.trim());
			const parsed = parseFloat(input.value.trim().replace(',', '.'));
			const cur = evalRes.isValid && evalRes.value !== undefined ? evalRes.value : Number.isFinite(parsed) ? parsed : 0;
			const max = opts.max ?? Infinity;
			let nextVal = Math.min(max, Number((cur + delta).toFixed(2)));
			if (!validate(nextVal)) {
				const minPositive = unit === '°' ? 0.1 : 0.01;
				if (validate(minPositive)) nextVal = minPositive;
				else return;
			}
			input.value = nextVal.toString();
			updateExpressionPreview(input.value, unit, previewEl, context.sketch.getParameterValuesMap(), wrapEl);
			selectAll();
		}
	});

	input.addEventListener('blur', e => {
		commitEditor(false, (e as FocusEvent).relatedTarget);
	});
}

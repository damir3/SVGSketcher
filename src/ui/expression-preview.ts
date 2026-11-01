import {
	validateExpression,
	type VariableLookup,
} from '../math/expression';

export interface ExpressionPreviewResult {
	isValid: boolean;
	value?: number;
	error?: string;
}

/**
 * Updates an inline preview element with the evaluated result of a mathematical expression.
 * If the expression is a plain number without variables or operators, the preview is kept hidden.
 * If the expression is a valid formula or variable (e.g. 'w', 'w * 2', '50 + 10'), it displays '= <val> <unit>'.
 * If the expression contains a syntax or evaluation error, it displays '! <error>'.
 */
export function updateExpressionPreview(
	text: string,
	unit: string,
	previewEl: HTMLElement | null,
	scope?: VariableLookup,
	wrapperEl?: HTMLElement | null
): ExpressionPreviewResult {
	if (!previewEl) return { isValid: true };
	const trimmed = text.trim();
	if (!trimmed) {
		previewEl.classList.add('hidden');
		previewEl.textContent = '';
		wrapperEl?.classList.remove('error');
		return { isValid: false };
	}

	const res = validateExpression(trimmed, scope);

	const isPlainNumber =
		!isNaN(Number(trimmed.replace(',', '.'))) && res.referencedVars.length === 0;

	if (isPlainNumber) {
		previewEl.classList.add('hidden');
		previewEl.textContent = '';
		wrapperEl?.classList.remove('error');
		return { isValid: true, value: res.value };
	}

	if (res.isValid && res.value !== undefined) {
		if (Number.isFinite(res.value)) {
			const fmtVal = Number.isInteger(res.value)
				? res.value.toFixed(1)
				: Number(res.value.toFixed(2)).toString();
			previewEl.textContent = `= ${fmtVal} ${unit}`;
			previewEl.classList.remove('hidden', 'error');
			wrapperEl?.classList.remove('error');
			return { isValid: true, value: res.value };
		} else {
			previewEl.textContent = '! Non-finite result';
			previewEl.classList.remove('hidden');
			previewEl.classList.add('error');
			wrapperEl?.classList.add('error');
			return { isValid: false, error: 'Non-finite result' };
		}
	} else {
		previewEl.textContent = `! ${res.error ?? 'Invalid expression'}`;
		previewEl.classList.remove('hidden');
		previewEl.classList.add('error');
		wrapperEl?.classList.add('error');
		return { isValid: false, error: res.error };
	}
}

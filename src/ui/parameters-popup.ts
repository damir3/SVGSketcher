import type { SketchDocument } from '../model/sketch';
import { isValidParameterName } from '../math/expression';
import { ICONS } from './icons';

interface DraftParameterRow {
	name: string;
	expression: string;
	comment: string;
}

export class ParametersPopup {
	private container: HTMLElement;
	private sketch: SketchDocument;
	private isOpen = false;
	private draftRow: DraftParameterRow | null = null;

	constructor(sketch: SketchDocument) {
		this.sketch = sketch;

		this.container = document.createElement('div');
		this.container.className = 'param-modal-backdrop hidden';
		document.body.appendChild(this.container);

		this.render();
		this.setupEvents();

		// Subscribe to sketch changes to update parameters list if undo/redo happens
		this.sketch.onChange(() => {
			if (this.isOpen && !this.isEditingInput() && !this.draftRow) {
				this.renderTableContent();
			}
		});
	}

	private isEditingInput(): boolean {
		const active = document.activeElement;
		return active instanceof HTMLInputElement && this.container.contains(active);
	}

	public show(): void {
		this.isOpen = true;
		this.container.classList.remove('hidden');
		this.sketch.recomputeParametersAndConstraints(false);
		this.renderTableContent();
	}

	public hide(): void {
		if (this.draftRow) {
			if (this.draftRow.name.trim() && this.draftRow.expression.trim()) {
				this.commitDraftRow();
			} else {
				this.draftRow = null;
			}
		}
		this.isOpen = false;
		this.container.classList.add('hidden');
	}

	public toggle(): void {
		if (this.isOpen) {
			this.hide();
		} else {
			this.show();
		}
	}

	private render(): void {
		this.container.innerHTML = `
			<div class="param-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="param-modal-title">
				<div class="param-modal-header">
					<div class="param-modal-title-wrap">
						<div class="param-modal-icon">
							${ICONS.parameters}
						</div>
						<h2 id="param-modal-title" class="param-modal-title">Parameters</h2>
					</div>
					<button type="button" class="btn-modal-close" id="btn-close-param-modal" title="Close (Esc)" aria-label="Close">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>

				<div class="param-modal-body">
					<div class="param-table-container">
						<table class="param-table">
							<thead>
								<tr>
									<th style="width: 22%">Name</th>
									<th style="width: 32%">Expression</th>
									<th style="width: 18%">Value</th>
									<th style="width: 20%">Comment</th>
									<th style="width: 8%; text-align: center;"></th>
								</tr>
							</thead>
							<tbody id="param-table-body">
								<!-- Populated dynamically -->
							</tbody>
						</table>
					</div>

					<div class="param-syntax-hint">
						<strong>Tip:</strong> Expressions support <code>+ - * / ^ ( )</code>, functions (<code>sin</code>, <code>cos</code>, <code>tan</code>, <code>sqrt</code>, <code>min</code>, <code>max</code>), constants (<code>pi</code>, <code>e</code>), and units (<code>mm</code>, <code>cm</code>, <code>m</code>, <code>in</code>, <code>deg</code>, <code>rad</code>).
					</div>
				</div>

				<div class="param-modal-footer">
					<button type="button" class="btn-param-action primary" id="btn-add-param">Add Parameter</button>
					<button type="button" class="btn-param-action" id="btn-close-param-footer">Done</button>
				</div>
			</div>
		`;
	}

	private renderTableContent(): void {
		const tbody = this.container.querySelector<HTMLElement>('#param-table-body');
		if (!tbody) return;

		const params = this.sketch.getAllParameters();
		if (params.length === 0 && !this.draftRow) {
			tbody.innerHTML = '';
			return;
		}

		// Pure evaluation: does NOT trigger notify() or solver solve, preventing infinite loops
		const evalResult = this.sketch.evaluateParameterGraph();

		const committedRowsHtml = params
			.map(p => {
				const errorMsg = evalResult.errors.get(p.name);
				const hasError = !!errorMsg;
				const displayVal = hasError
					? `<span class="param-val-error" title="${errorMsg}">! Error</span>`
					: Number.isInteger(p.value)
						? p.value.toFixed(1)
						: Number(p.value.toFixed(2)).toString();

				return `
				<tr data-param-name="${p.name}">
					<td>
						<input type="text" class="param-cell-input param-name-input ${hasError ? 'error' : ''}" value="${p.name}" spellcheck="false" autocomplete="off" />
					</td>
					<td>
						<input type="text" class="param-cell-input param-expr-input ${hasError ? 'error' : ''}" value="${p.expression}" spellcheck="false" autocomplete="off" />
					</td>
					<td class="param-cell-value">
						${displayVal}
					</td>
					<td>
						<input type="text" class="param-cell-input param-comment-input" value="${p.comment || ''}" spellcheck="false" autocomplete="off" />
					</td>
					<td style="text-align: center;">
						<button type="button" class="btn-param-row-delete" title="Delete parameter" aria-label="Delete parameter">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
							</svg>
						</button>
					</td>
				</tr>
			`;
			})
			.join('');

		let draftRowHtml = '';
		if (this.draftRow) {
			draftRowHtml = `
				<tr data-draft="true">
					<td>
						<input type="text" class="param-cell-input param-name-input" value="${this.draftRow.name}" spellcheck="false" autocomplete="off" />
					</td>
					<td>
						<input type="text" class="param-cell-input param-expr-input" value="${this.draftRow.expression}" spellcheck="false" autocomplete="off" />
					</td>
					<td class="param-cell-value" style="color: var(--text-muted); font-weight: normal;">
						—
					</td>
					<td>
						<input type="text" class="param-cell-input param-comment-input" value="${this.draftRow.comment}" spellcheck="false" autocomplete="off" />
					</td>
					<td style="text-align: center;">
						<button type="button" class="btn-param-row-delete" title="Cancel" aria-label="Cancel">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</td>
				</tr>
			`;
		}

		tbody.innerHTML = committedRowsHtml + draftRowHtml;

		this.bindRowEvents();
	}

	private bindRowEvents(): void {
		// 1. Existing committed rows
		const committedRows = this.container.querySelectorAll<HTMLTableRowElement>('#param-table-body tr[data-param-name]');

		committedRows.forEach(row => {
			const origName = row.getAttribute('data-param-name') || '';
			const nameInput = row.querySelector<HTMLInputElement>('.param-name-input');
			const exprInput = row.querySelector<HTMLInputElement>('.param-expr-input');
			const commentInput = row.querySelector<HTMLInputElement>('.param-comment-input');
			const deleteBtn = row.querySelector<HTMLButtonElement>('.btn-param-row-delete');

			const paramObj = this.sketch.getParameter(origName);
			const origExpr = paramObj?.expression ?? '';
			const origComment = paramObj?.comment ?? '';

			const applyRowUpdate = (isRenaming = false) => {
				if (!nameInput || !exprInput || !commentInput) return;
				const newName = nameInput.value.trim();
				const newExpr = exprInput.value.trim();
				const newComment = commentInput.value.trim();

				// If nothing changed, do not push history or trigger unnecessary re-solve
				if (newName === origName && newExpr === origExpr && newComment === origComment) {
					return;
				}

				if (!newName) {
					nameInput.classList.add('error');
					return;
				}

				if (isRenaming && newName !== origName) {
					const check = isValidParameterName(newName);
					if (!check.isValid) {
						nameInput.classList.add('error');
						nameInput.title = check.error || 'Invalid name';
						return;
					}
				}

				const res = this.sketch.updateParameter(origName, newName, newExpr, newComment);
				if (res.success) {
					this.renderTableContent();
				} else {
					nameInput.classList.add('error');
					nameInput.title = res.error || 'Error';
				}
			};

			nameInput?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					exprInput?.focus();
					exprInput?.select();
				}
			});

			nameInput?.addEventListener('blur', () => {
				if (nameInput.value.trim() !== origName) {
					applyRowUpdate(true);
				}
			});

			exprInput?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					applyRowUpdate(false);
					exprInput.blur();
				}
			});

			exprInput?.addEventListener('blur', () => {
				applyRowUpdate(false);
			});

			commentInput?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					applyRowUpdate(false);
					commentInput.blur();
				}
			});

			commentInput?.addEventListener('blur', () => {
				applyRowUpdate(false);
			});

			// Prevent input blur before click event registers on delete button
			deleteBtn?.addEventListener('mousedown', e => {
				e.preventDefault();
			});

			deleteBtn?.addEventListener('click', e => {
				e.stopPropagation();
				this.sketch.deleteParameter(origName);
				this.renderTableContent();
			});
		});

		// 2. Draft row (newly added parameter awaiting input)
		const draftRowEl = this.container.querySelector<HTMLTableRowElement>('tr[data-draft="true"]');
		if (draftRowEl && this.draftRow) {
			const nameInp = draftRowEl.querySelector<HTMLInputElement>('.param-name-input');
			const exprInp = draftRowEl.querySelector<HTMLInputElement>('.param-expr-input');
			const commentInp = draftRowEl.querySelector<HTMLInputElement>('.param-comment-input');
			const deleteBtn = draftRowEl.querySelector<HTMLButtonElement>('.btn-param-row-delete');

			nameInp?.addEventListener('input', () => {
				if (this.draftRow) this.draftRow.name = nameInp.value;
				nameInp.classList.remove('error');
			});

			nameInp?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					exprInp?.focus();
					exprInp?.select();
				}
			});

			exprInp?.addEventListener('input', () => {
				if (this.draftRow) this.draftRow.expression = exprInp.value;
				exprInp.classList.remove('error');
			});

			exprInp?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.commitDraftRow();
				}
			});

			commentInp?.addEventListener('input', () => {
				if (this.draftRow) this.draftRow.comment = commentInp.value;
			});

			commentInp?.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.commitDraftRow();
				}
			});

			deleteBtn?.addEventListener('mousedown', e => {
				e.preventDefault();
			});

			deleteBtn?.addEventListener('click', e => {
				e.stopPropagation();
				this.draftRow = null;
				this.renderTableContent();
			});

			const handleDraftBlur = () => {
				setTimeout(() => {
					const active = document.activeElement;
					const currentDraftEl = this.container.querySelector('tr[data-draft="true"]');
					if (currentDraftEl && !currentDraftEl.contains(active)) {
						if (this.draftRow) {
							const name = this.draftRow.name.trim();
							const expr = this.draftRow.expression.trim();
							if (!name && !expr) {
								this.draftRow = null;
								this.renderTableContent();
							} else if (name && expr) {
								this.commitDraftRow();
							}
						}
					}
				}, 80);
			};

			nameInp?.addEventListener('blur', handleDraftBlur);
			exprInp?.addEventListener('blur', handleDraftBlur);
			commentInp?.addEventListener('blur', handleDraftBlur);
		}
	}

	private setupEvents(): void {
		// Stop canvas mousemove and interaction when moving over the modal backdrop or dialog
		this.container.addEventListener('mousemove', e => e.stopPropagation());
		this.container.addEventListener('pointermove', e => e.stopPropagation());
		this.setupDragging();

		// Header close button
		this.container.querySelector('#btn-close-param-modal')?.addEventListener('click', e => {
			e.stopPropagation();
			this.hide();
		});

		// Footer close button
		this.container.querySelector('#btn-close-param-footer')?.addEventListener('click', e => {
			e.stopPropagation();
			this.hide();
		});

		// Add Parameter button
		const onAdd = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			this.addNewParameter();
		};
		this.container.querySelector('#btn-add-param')?.addEventListener('click', onAdd);

		// Keyboard: Esc to close
		window.addEventListener('keydown', e => {
			if (this.isOpen && e.key === 'Escape') {
				this.hide();
			}
		});
	}

	private setupDragging(): void {
		const dialog = this.container.querySelector<HTMLElement>('.param-modal-dialog');
		const header = dialog?.querySelector<HTMLElement>('.param-modal-header');
		if (!dialog || !header) return;

		let x = 0;
		let y = 0;
		let drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
		const moveTo = (nextX: number, nextY: number) => {
			const maxX = Math.max(0, (this.container.clientWidth - dialog.offsetWidth) / 2);
			const maxY = Math.max(0, (this.container.clientHeight - dialog.offsetHeight) / 2);
			x = Math.max(-maxX, Math.min(maxX, nextX));
			y = Math.max(-maxY, Math.min(maxY, nextY));
			dialog.style.translate = `${x}px ${y}px`;
		};

		header.addEventListener('pointerdown', e => {
			if (drag || e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
			drag = { pointerId: e.pointerId, offsetX: e.clientX - x, offsetY: e.clientY - y };
			header.setPointerCapture(e.pointerId);
			header.classList.add('dragging');
		});
		header.addEventListener('pointermove', e => {
			if (!this.isOpen || drag?.pointerId !== e.pointerId) return;
			moveTo(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
		});
		header.addEventListener('lostpointercapture', e => {
			if (drag?.pointerId !== e.pointerId) return;
			drag = null;
			header.classList.remove('dragging');
		});

		const observer = new ResizeObserver(() => {
			if (this.isOpen) moveTo(x, y);
		});
		observer.observe(this.container);
		observer.observe(dialog);
	}

	private addNewParameter(): void {
		// If there is already a draft row, commit it if filled, or focus it if empty
		if (this.draftRow) {
			const name = this.draftRow.name.trim();
			const expr = this.draftRow.expression.trim();
			if (name && expr) {
				const committed = this.commitDraftRow();
				if (!committed) return;
			} else {
				const nameInp = this.container.querySelector<HTMLInputElement>('tr[data-draft="true"] .param-name-input');
				nameInp?.focus();
				return;
			}
		}

		this.draftRow = { name: '', expression: '', comment: '' };
		this.renderTableContent();
		const nameInp = this.container.querySelector<HTMLInputElement>('tr[data-draft="true"] .param-name-input');
		nameInp?.focus();
	}

	private commitDraftRow(): boolean {
		if (!this.draftRow) return true;
		const draftRowEl = this.container.querySelector<HTMLTableRowElement>('tr[data-draft="true"]');
		const nameInput = draftRowEl?.querySelector<HTMLInputElement>('.param-name-input');
		const exprInput = draftRowEl?.querySelector<HTMLInputElement>('.param-expr-input');

		const name = this.draftRow.name.trim();
		const expr = this.draftRow.expression.trim();
		const comment = this.draftRow.comment.trim();

		if (!name) {
			nameInput?.classList.add('error');
			nameInput?.focus();
			return false;
		}

		const nameCheck = isValidParameterName(name);
		if (!nameCheck.isValid) {
			if (nameInput) {
				nameInput.classList.add('error');
				nameInput.title = nameCheck.error || 'Invalid name';
				nameInput.focus();
			}
			return false;
		}

		if (this.sketch.parameters.has(name)) {
			if (nameInput) {
				nameInput.classList.add('error');
				nameInput.title = `Parameter '${name}' already exists`;
				nameInput.focus();
			}
			return false;
		}

		if (!expr) {
			exprInput?.classList.add('error');
			exprInput?.focus();
			return false;
		}

		const res = this.sketch.addParameter(name, expr, comment);
		if (res.success) {
			this.draftRow = null;
			this.renderTableContent();
			return true;
		} else {
			if (nameInput) {
				nameInput.classList.add('error');
				nameInput.title = res.error || 'Error adding parameter';
			}
			return false;
		}
	}
}

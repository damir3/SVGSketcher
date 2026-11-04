import type { InspectorContext, ISidebarPanel } from '../inspector/types';
import type { BaseConstraint } from '../../../solver/constraints/base';
import type {
	ConstraintPanelOptions,
	ConstraintSegmentedControl,
	ConstraintFieldConfig,
	ConstraintCheckboxConfig,
} from './types';

export class ConstraintPanel implements ISidebarPanel {
	private options: ConstraintPanelOptions;

	constructor(options: ConstraintPanelOptions | BaseConstraint) {
		if ('constraint' in options) {
			this.options = options;
		} else {
			this.options = { constraint: options };
		}
	}

	private getAllSegmentedControls(): ConstraintSegmentedControl[] {
		const list: ConstraintSegmentedControl[] = [];
		if (this.options.segmentedControls) {
			list.push(...this.options.segmentedControls);
		}
		if (this.options.sections) {
			for (const s of this.options.sections) {
				if (s.segmentedControls) list.push(...s.segmentedControls);
			}
		}
		return list;
	}

	private getAllFields(): ConstraintFieldConfig[] {
		const list: ConstraintFieldConfig[] = [];
		if (this.options.fields) {
			list.push(...this.options.fields);
		}
		if (this.options.sections) {
			for (const s of this.options.sections) {
				if (s.fields) list.push(...s.fields);
			}
		}
		return list;
	}

	private getAllCheckboxes(): ConstraintCheckboxConfig[] {
		const list: ConstraintCheckboxConfig[] = [];
		if (this.options.checkboxes) {
			list.push(...this.options.checkboxes);
		}
		if (this.options.sections) {
			for (const s of this.options.sections) {
				if (s.checkboxes) list.push(...s.checkboxes);
			}
		}
		return list;
	}

	private renderSegmentedControl(sc: ConstraintSegmentedControl, globalIdx: number, context: InspectorContext): string {
		if (sc.isVisible && !sc.isVisible(context)) return '';
		const current = sc.getCurrent(context);
		return `
			<div class="pattern-param-row">
				<label class="pattern-param-label">${sc.label}</label>
				<div class="pattern-segmented-control">
					${sc.options
						.map(
							opt => `
						<button type="button" class="seg-btn insp-cpanel-seg-btn ${opt.id === current ? 'active' : ''}" data-ctrl-idx="${globalIdx}" data-opt-id="${opt.id}">${opt.label}</button>
					`
						)
						.join('')}
				</div>
			</div>
		`;
	}

	private renderField(f: ConstraintFieldConfig, context: InspectorContext): string {
		if (f.isVisible && !f.isVisible(context)) return '';
		const val = f.getValue(context);
		const type = f.type ?? 'number';
		const minAttr = f.min !== undefined ? `min="${f.min}"` : '';
		const maxAttr = f.max !== undefined ? `max="${f.max}"` : '';
		const stepAttr = f.step !== undefined ? `step="${f.step}"` : '';
		return `
			<div class="pattern-param-row">
				<label class="pattern-param-label" for="${f.id}">${f.label}</label>
				<div class="pattern-input-suffix-wrapper">
					<input type="${type}" id="${f.id}" value="${val}" ${minAttr} ${maxAttr} ${stepAttr} class="pattern-num-input" />
					${f.unit ? `<span class="pattern-input-suffix">${f.unit}</span>` : ''}
				</div>
			</div>
		`;
	}

	private renderCheckbox(cb: ConstraintCheckboxConfig, context: InspectorContext): string {
		if (cb.isVisible && !cb.isVisible(context)) return '';
		const isChecked = cb.isChecked(context);
		const hintStr = cb.hint ? cb.hint(context) : '';
		return `
			<div class="pattern-param-row pattern-suppress-row">
				<label class="pattern-checkbox-label">
					<input type="checkbox" id="${cb.id}" ${isChecked ? 'checked' : ''} />
					<span>${cb.label}</span>
				</label>
				${hintStr ? `<span class="pattern-suppress-count">${hintStr}</span>` : ''}
			</div>
		`;
	}

	render(context: InspectorContext): string {
		const c = this.options.constraint;
		const title =
			typeof this.options.title === 'function' ? this.options.title(context) : (this.options.title ?? c.name);

		const iconName =
			typeof this.options.iconName === 'function' ? this.options.iconName(context) : this.options.iconName;
		const iconHtml =
			iconName && context.getIcon
				? context.getIcon(iconName) || context.getIcon(iconName.replace(/_([a-z])/g, (_, g) => g.toUpperCase()))
				: '';

		// Delete button
		let deleteButtonHtml = '';
		if (this.options.deleteButton) {
			const isVisible = this.options.deleteButton.isVisible ? this.options.deleteButton.isVisible(context) : true;
			if (isVisible) {
				const deleteIcon = context.getIcon ? context.getIcon('delete') : '';
				const label = this.options.deleteButton.label ?? 'Delete Constraint';
				deleteButtonHtml = `
					<div style="margin-top: 10px;">
						<button type="button" class="btn-sidebar-delete-constraint" data-delete-id="${c.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; color: #dc2626; background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.2); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
							${deleteIcon} ${label}
						</button>
					</div>
				`;
			}
		}

		// Controls inside params card
		let paramsInnerHtml = '';
		let segCtrlCounter = 0;

		// Top-level Segmented controls
		if (this.options.segmentedControls) {
			for (const sc of this.options.segmentedControls) {
				paramsInnerHtml += this.renderSegmentedControl(sc, segCtrlCounter++, context);
			}
		}

		// Dimension row
		if (this.options.dimension) {
			const dim = this.options.dimension;
			const isVisible = dim.isVisible ? dim.isVisible(context) : true;
			if (isVisible) {
				const isDisabled = dim.isDisabled ? dim.isDisabled(context) : false;
				if (isDisabled) {
					if (dim.disabledContent) {
						paramsInnerHtml += dim.disabledContent(context);
					}
				} else {
					const label = typeof dim.label === 'function' ? dim.label(context) : (dim.label ?? 'Distance');
					const valueStr = dim.getValue(context);
					paramsInnerHtml += `
						<div class="inspector-param-row">
							<span class="inspector-param-label">${label}:</span>
							<div class="inspector-value-group">
								<span class="inspector-value-display" data-constraint-id="${c.id}" title="Double-click to edit">
									<strong>${valueStr}</strong>
									${c.expression ? `<span class="inspector-expr-badge" title="fx: ${c.expression}">fx: ${c.expression}</span>` : ''}
								</span>
								<button type="button" class="btn-insp-edit-dim" data-constraint-id="${c.id}" title="Edit dimension">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
										<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
									</svg>
								</button>
							</div>
						</div>
					`;
				}
			}
		}

		// Top-level Fields
		if (this.options.fields) {
			for (const f of this.options.fields) {
				paramsInnerHtml += this.renderField(f, context);
			}
		}

		// Sections
		if (this.options.sections) {
			for (const section of this.options.sections) {
				if (section.title) {
					paramsInnerHtml += `
						<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 6px; margin-bottom: 2px;">${section.title}</div>
					`;
				}
				if (section.segmentedControls) {
					for (const sc of section.segmentedControls) {
						paramsInnerHtml += this.renderSegmentedControl(sc, segCtrlCounter++, context);
					}
				}
				if (section.fields) {
					for (const f of section.fields) {
						paramsInnerHtml += this.renderField(f, context);
					}
				}
				if (section.checkboxes) {
					for (const cb of section.checkboxes) {
						paramsInnerHtml += this.renderCheckbox(cb, context);
					}
				}
			}
		}

		// Top-level Checkboxes
		if (this.options.checkboxes) {
			for (const cb of this.options.checkboxes) {
				paramsInnerHtml += this.renderCheckbox(cb, context);
			}
		}

		// Extra content (if any)
		if (this.options.extraContent) {
			paramsInnerHtml += this.options.extraContent.render(context);
		}

		const paramsCardHtml =
			paramsInnerHtml.trim().length > 0 ? `<div class="pattern-params-card in-inspector">${paramsInnerHtml}</div>` : '';

		// Read-only rows
		const rowsHtml = (this.options.rows ?? [])
			.filter(r => (r.isVisible ? r.isVisible(context) : true))
			.map(
				r => `
			<div class="inspector-row"><span>${r.label}</span> <strong>${r.getValue(context)}</strong></div>
		`
			)
			.join('');

		const relatedPrimitives = context.sketch.getEntitiesForConstraint(c);
		const primitivesHtml = context.renderPrimitivesSublist(relatedPrimitives);

		return `
			<div class="inspector-card">
				<div class="inspector-card-title">
					${iconHtml ? `<span class="panel-card-icon">${iconHtml}</span>` : ''}
					<span>${title}</span>
				</div>
				${deleteButtonHtml}
				${paramsCardHtml}
				${rowsHtml}
				${primitivesHtml}
			</div>
		`;
	}

	bindEvents(container: HTMLElement, context: InspectorContext): void {
		const c = this.options.constraint;

		// Delete button event
		if (this.options.deleteButton) {
			container
				.querySelectorAll<HTMLButtonElement>(`.btn-sidebar-delete-constraint[data-delete-id="${c.id}"]`)
				.forEach(btn => {
					btn.addEventListener('click', e => {
						e.stopPropagation();
						this.options.deleteButton!.onDelete(context);
					});
				});
		}

		// Segmented controls events
		const allSegmentedControls = this.getAllSegmentedControls();
		if (allSegmentedControls.length > 0) {
			container.querySelectorAll<HTMLButtonElement>('.insp-cpanel-seg-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const ctrlIdxStr = btn.getAttribute('data-ctrl-idx');
					const optId = btn.getAttribute('data-opt-id');
					if (ctrlIdxStr !== null && optId !== null) {
						const ctrlIdx = parseInt(ctrlIdxStr, 10);
						const sc = allSegmentedControls[ctrlIdx];
						if (sc) {
							sc.onSelect(optId, context);
						}
					}
				});
			});
		}

		// Dimension edit events
		if (this.options.dimension) {
			const dim = this.options.dimension;
			const isVisible = dim.isVisible ? dim.isVisible(context) : true;
			const isDisabled = dim.isDisabled ? dim.isDisabled(context) : false;
			if (isVisible && !isDisabled) {
				container
					.querySelectorAll<HTMLButtonElement>(`.btn-insp-edit-dim[data-constraint-id="${c.id}"]`)
					.forEach(btn => {
						btn.addEventListener('click', e => {
							e.stopPropagation();
							const btnRect = btn.getBoundingClientRect();
							const screenPos = { x: btnRect.left - 240, y: btnRect.top - 10 };
							context.onEditDimension?.(c, screenPos);
						});
					});

				container
					.querySelectorAll<HTMLElement>(`.inspector-value-display[data-constraint-id="${c.id}"]`)
					.forEach(el => {
						el.addEventListener('dblclick', e => {
							e.stopPropagation();
							const elRect = el.getBoundingClientRect();
							const screenPos = { x: elRect.left - 240, y: elRect.top - 10 };
							context.onEditDimension?.(c, screenPos);
						});
					});
			}
		}

		// Fields events
		const allFields = this.getAllFields();
		for (const f of allFields) {
			const input = container.querySelector<HTMLInputElement>(`#${f.id}`);
			if (!input) continue;

			if (f.onInput) {
				input.addEventListener('input', () => {
					const val = f.type === 'number' || f.type === undefined ? parseFloat(input.value) : input.value;
					f.onInput!(val, context);
				});
			}

			if (f.onChange) {
				input.addEventListener('change', () => {
					const val = f.type === 'number' || f.type === undefined ? parseFloat(input.value) : input.value;
					f.onChange!(val, context);
				});
			}
		}

		// Checkboxes events
		const allCheckboxes = this.getAllCheckboxes();
		for (const cb of allCheckboxes) {
			const input = container.querySelector<HTMLInputElement>(`#${cb.id}`);
			if (!input) continue;

			input.addEventListener('change', () => {
				cb.onChange(input.checked, context);
			});
		}

		// Extra content events
		if (this.options.extraContent?.bindEvents) {
			this.options.extraContent.bindEvents(container, context);
		}
	}
}

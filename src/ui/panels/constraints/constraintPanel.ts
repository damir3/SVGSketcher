import {
	bindInlineValueControl,
	renderInlineValueControl,
	type InlineValueControlOptions,
} from '../inspector/inlineValueControl';
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

	private collectOptions<K extends 'segmentedControls' | 'fields' | 'checkboxes'>(
		key: K
	): NonNullable<ConstraintPanelOptions[K]> {
		return [...(this.options[key] ?? []), ...(this.options.sections?.flatMap(s => s[key] ?? []) ?? [])] as NonNullable<
			ConstraintPanelOptions[K]
		>;
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
						<button type="button" class="btn-sidebar-delete-constraint" data-delete-id="${c.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--cad-red); background: var(--cad-red-subtle); border: 1px solid var(--cad-red-border-soft); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
							${deleteIcon} ${label}
						</button>
					</div>
				`;
			}
		}

		// Controls inside params card
		let paramsInnerHtml = '';
		let segCtrlCounter = 0;
		const renderSeg = (items?: ConstraintPanelOptions['segmentedControls']) =>
			(items ?? []).map(sc => this.renderSegmentedControl(sc, segCtrlCounter++, context)).join('');
		const renderFields = (items?: ConstraintPanelOptions['fields']) =>
			(items ?? []).map(f => this.renderField(f, context)).join('');
		const renderCheckboxes = (items?: ConstraintPanelOptions['checkboxes']) =>
			(items ?? []).map(cb => this.renderCheckbox(cb, context)).join('');

		// Top-level Segmented controls
		paramsInnerHtml += renderSeg(this.options.segmentedControls);

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
					paramsInnerHtml += renderInlineValueControl(this.createDimensionControlOptions(context, dim));
				}
			}
		}

		// Top-level Fields
		paramsInnerHtml += renderFields(this.options.fields);

		// Sections
		for (const section of this.options.sections ?? []) {
			if (section.title) {
				paramsInnerHtml += `
						<div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 6px; margin-bottom: 2px;">${section.title}</div>
					`;
			}
			paramsInnerHtml += renderSeg(section.segmentedControls);
			paramsInnerHtml += renderFields(section.fields);
			paramsInnerHtml += renderCheckboxes(section.checkboxes);
		}

		// Top-level Checkboxes
		paramsInnerHtml += renderCheckboxes(this.options.checkboxes);

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

		const relatedPrimitives = context.sketch.getEntitiesForConstraint(c, 'sources');
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
		const allSegmentedControls = this.collectOptions('segmentedControls');
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

		// Dimension inline edit events
		if (this.options.dimension) {
			const dim = this.options.dimension;
			const isVisible = dim.isVisible ? dim.isVisible(context) : true;
			const isDisabled = dim.isDisabled ? dim.isDisabled(context) : false;
			if (isVisible && !isDisabled) {
				bindInlineValueControl(container, context, this.createDimensionControlOptions(context, dim));
			}
		}

		// Fields events
		const allFields = this.collectOptions('fields');
		for (const f of allFields) {
			const input = container.querySelector<HTMLInputElement>(`#${f.id}`);
			if (!input) continue;

			const bindFieldEvent = (eventName: 'input' | 'change', handler?: (val: any, ctx: InspectorContext) => void) => {
				if (!handler) return;
				input.addEventListener(eventName, () => {
					const val = f.type === 'number' || f.type === undefined ? parseFloat(input.value) : input.value;
					handler(val, context);
				});
			};
			bindFieldEvent('input', f.onInput);
			bindFieldEvent('change', f.onChange);
		}

		// Checkboxes events
		for (const cb of this.collectOptions('checkboxes')) {
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

	private getDimensionEditInfo(context: InspectorContext): {
		unit: string;
		displayMode?: 'radius' | 'diameter';
		isAngle: boolean;
		initialValue: string;
	} {
		const c = this.options.constraint as any;
		const isDistance = 'targetDistance' in c;
		const isAngle = 'targetAngle' in c;
		let displayMode: 'radius' | 'diameter' | undefined;
		if (!isDistance && !isAngle) {
			const isCircle = context.sketch.circles.has(c.circleId);
			displayMode = c.displayMode ?? (isCircle ? 'diameter' : 'radius');
		}
		const curVal = isDistance
			? c.targetDistance
			: isAngle
				? c.targetAngle
				: displayMode === 'diameter'
					? c.targetRadius * 2
					: c.targetRadius;
		const unit = isAngle ? '°' : 'mm';
		const displayVal = Number(curVal.toFixed(2)).toString();
		return {
			unit,
			displayMode,
			isAngle,
			initialValue: c.expression ?? displayVal,
		};
	}

	private createDimensionControlOptions(
		context: InspectorContext,
		dim: NonNullable<ConstraintPanelOptions['dimension']>
	): InlineValueControlOptions {
		const c = this.options.constraint;
		const label = typeof dim.label === 'function' ? dim.label(context) : (dim.label ?? 'Distance');
		const info = this.getDimensionEditInfo(context);
		return {
			key: c.id,
			inputId: `insp-dim-input-${c.id}`,
			label,
			unit: info.unit,
			displayAttr: { name: 'data-constraint-id', value: c.id },
			getDisplayValue: () => dim.getValue(context),
			getInitialInputValue: () => this.getDimensionEditInfo(context).initialValue,
			getExpression: () => c.expression,
			validate: val => Number.isFinite(val) && val > 0,
			step: info.isAngle ? 0.5 : 0.1,
			max: info.isAngle ? (c.name.includes('Arc') ? 359.9 : 179.9) : Infinity,
			commit: text =>
				context.sketch.updateDimensionalConstraint(c.id, text, this.getDimensionEditInfo(context).displayMode),
		};
	}
}

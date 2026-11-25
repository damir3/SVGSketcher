import {
	bindInlineValueControl,
	formatInlineUnitValue,
	renderInlineValueControl,
	type InlineValueControlOptions,
} from '../inspector/inlineValueControl';
import type { InspectorContext } from '../inspector/types';
import type { IPrimitivePanel, PrimitiveFieldConfig, PrimitivePanelOptions } from './types';

export class PrimitivePanel implements IPrimitivePanel {
	private options: PrimitivePanelOptions;

	constructor(options: PrimitivePanelOptions) {
		this.options = options;
	}

	private createFieldControlOptions(f: PrimitiveFieldConfig, context: InspectorContext): InlineValueControlOptions {
		return {
			key: f.id,
			inputId: f.id,
			label: f.label,
			unit: f.unit,
			displayAttr: { name: 'data-field-id', value: f.id },
			getDisplayValue: () => formatInlineUnitValue(f.getValue(context), f.unit),
			getInitialInputValue: () => String(f.getValue(context)),
			validate: f.validate,
			step: f.unit === '°' ? 0.5 : 0.1,
			commit: (_text, val) => {
				const snapshot = context.sketch.takeSnapshot();
				const result = f.onCommit?.(val, context);
				if (result === false) return false;
				context.sketch.pushSnapshot(snapshot);
				return true;
			},
		};
	}

	render(context: InspectorContext): string {
		const title = typeof this.options.title === 'function' ? this.options.title(context) : this.options.title;
		const fields = this.options.fields ?? [];
		const rows = this.options.rows ?? [];
		const constraints = this.options.getConstraints ? this.options.getConstraints(context) : [];
		const constraintsLabel =
			typeof this.options.constraintsLabel === 'function'
				? this.options.constraintsLabel(context)
				: (this.options.constraintsLabel ?? 'this entity');
		const entityIds =
			typeof this.options.entityIds === 'function' ? this.options.entityIds(context) : (this.options.entityIds ?? []);

		const fieldsHtml =
			fields.length > 0
				? `
			<div class="pattern-params-card in-inspector">
				${fields
					.map(f =>
						f.onCommit
							? renderInlineValueControl(this.createFieldControlOptions(f, context))
							: `<div class="inspector-row"><span>${f.label}:</span> <strong>${formatInlineUnitValue(f.getValue(context), f.unit)}</strong></div>`
					)
					.join('')}
			</div>
		`
				: '';

		const rowsHtml = rows
			.map(
				r => `
			<div class="inspector-row"><span>${r.label}</span> <strong>${r.getValue(context)}</strong></div>
		`
			)
			.join('');

		const constraintsHtml = context.renderConstraintsSublist(constraints, constraintsLabel, entityIds);

		return `
			<div class="inspector-card">
				<div class="inspector-card-title">${title}</div>
				${fieldsHtml}
				${rowsHtml}
				${constraintsHtml}
			</div>
		`;
	}

	bindEvents(container: HTMLElement, context: InspectorContext): void {
		const fields = this.options.fields ?? [];
		for (const f of fields) {
			if (f.onCommit) {
				bindInlineValueControl(container, context, this.createFieldControlOptions(f, context));
			}
		}
	}
}

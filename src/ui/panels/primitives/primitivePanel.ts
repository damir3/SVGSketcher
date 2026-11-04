import type { InspectorContext } from '../inspector/types';
import type { IPrimitivePanel, PrimitivePanelOptions } from './types';

export class PrimitivePanel implements IPrimitivePanel {
	private options: PrimitivePanelOptions;

	constructor(options: PrimitivePanelOptions) {
		this.options = options;
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
					.map(
						f => `
					<div class="pattern-param-row">
						<label class="pattern-param-label" for="${f.id}">${f.label}</label>
						<div class="pattern-input-suffix-wrapper">
							<input type="text" id="${f.id}" value="${f.getValue(context)}" autocomplete="off" spellcheck="false" class="pattern-num-input" />
							${f.unit ? `<span class="pattern-input-suffix">${f.unit}</span>` : ''}
						</div>
					</div>
				`
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

	bindEvents(_container: HTMLElement, context: InspectorContext): void {
		const fields = this.options.fields ?? [];
		for (const f of fields) {
			if (f.onCommit) {
				context.bindInspectorNumberInput(`#${f.id}`, val => f.onCommit!(val, context), f.validate);
			}
		}
	}
}

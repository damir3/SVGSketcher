import type { InspectorContext } from '../inspector/types';

export interface PrimitiveFieldConfig {
	id: string;
	label: string;
	unit?: string;
	getValue: (context: InspectorContext) => number | string;
	onCommit?: (val: number, context: InspectorContext) => void;
	validate?: (val: number) => boolean;
}

export interface PrimitiveRowConfig {
	label: string;
	getValue: (context: InspectorContext) => string;
}

export interface PrimitivePanelOptions {
	title: string | ((context: InspectorContext) => string);
	fields?: PrimitiveFieldConfig[];
	rows?: PrimitiveRowConfig[];
	getConstraints?: (context: InspectorContext) => any[];
	constraintsLabel?: string | ((context: InspectorContext) => string);
	entityIds?: string[] | ((context: InspectorContext) => string[]);
}

export interface IPrimitivePanel {
	render(context: InspectorContext): string;
	bindEvents(container: HTMLElement, context: InspectorContext): void;
}

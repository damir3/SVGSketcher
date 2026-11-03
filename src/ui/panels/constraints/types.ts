import type { InspectorContext } from '../inspector/types';
import type { BaseConstraint } from '../../../solver/constraints/base';

export interface ConstraintDimensionConfig {
	label?: string | ((context: InspectorContext) => string);
	getValue: (context: InspectorContext) => string;
	isVisible?: (context: InspectorContext) => boolean;
	isDisabled?: (context: InspectorContext) => boolean;
	disabledContent?: (context: InspectorContext) => string;
}

export interface ConstraintFieldConfig {
	id: string;
	label: string;
	unit?: string;
	type?: 'number' | 'text';
	min?: number;
	max?: number;
	step?: number;
	isVisible?: (context: InspectorContext) => boolean;
	getValue: (context: InspectorContext) => number | string;
	onInput?: (val: any, context: InspectorContext) => void;
	onChange?: (val: any, context: InspectorContext) => void;
}

export interface ConstraintSegmentedOption<T extends string = string> {
	id: T;
	label: string;
}

export interface ConstraintSegmentedControl<T extends string = string> {
	label: string;
	options: ConstraintSegmentedOption<T>[];
	isVisible?: (context: InspectorContext) => boolean;
	getCurrent: (context: InspectorContext) => T;
	onSelect: (val: T, context: InspectorContext) => void;
}

export interface ConstraintCheckboxConfig {
	id: string;
	label: string;
	hint?: (context: InspectorContext) => string;
	isVisible?: (context: InspectorContext) => boolean;
	isChecked: (context: InspectorContext) => boolean;
	onChange: (checked: boolean, context: InspectorContext) => void;
}

export interface ConstraintRowConfig {
	label: string;
	getValue: (context: InspectorContext) => string;
	isVisible?: (context: InspectorContext) => boolean;
}

export interface ConstraintSectionConfig {
	title?: string;
	segmentedControls?: ConstraintSegmentedControl[];
	fields?: ConstraintFieldConfig[];
	checkboxes?: ConstraintCheckboxConfig[];
}

export interface ConstraintPanelOptions {
	constraint: BaseConstraint;
	title?: string | ((context: InspectorContext) => string);
	iconName?: string | ((context: InspectorContext) => string);
	dimension?: ConstraintDimensionConfig;
	segmentedControls?: ConstraintSegmentedControl[];
	fields?: ConstraintFieldConfig[];
	checkboxes?: ConstraintCheckboxConfig[];
	sections?: ConstraintSectionConfig[];
	rows?: ConstraintRowConfig[];
	deleteButton?: {
		label?: string;
		isVisible?: (context: InspectorContext) => boolean;
		onDelete: (context: InspectorContext) => void;
	};
	extraContent?: {
		render: (context: InspectorContext) => string;
		bindEvents?: (container: HTMLElement, context: InspectorContext) => void;
	};
}

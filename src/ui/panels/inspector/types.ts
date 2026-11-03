import type { SketchDocument } from '../../../model/sketch';
import type { Vec2 } from '../../../math/vector';
import type { PrimitiveType } from '../../../model/primitives/base';

export interface InspectorContext {
	sketch: SketchDocument;
	onEditDimension?: (constraint: any, screenPos: Vec2) => void;
	renderConstraintsSublist(constraints: any[], label: string, entityIds: string[]): string;
	renderPrimitivesSublist(primitives: Array<{ id: string; type: PrimitiveType }>): string;
	bindInspectorNumberInput(
		selector: string,
		onCommit: (value: number, input: HTMLInputElement) => void,
		validator?: (val: number) => boolean
	): void;
	requestRender?: () => void;
	getIcon?: (name: string) => string;
}

export interface ISidebarPanel {
	render(context: InspectorContext): string;
	bindEvents(container: HTMLElement, context: InspectorContext): void;
}

export interface IInspectable {
	sidebarPanel?: ISidebarPanel;
}

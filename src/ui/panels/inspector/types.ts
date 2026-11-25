import type { SketchDocument } from '../../../model/sketch';
import type { PrimitiveType } from '../../../model/primitives/base';

export interface InspectorContext {
	sketch: SketchDocument;
	renderConstraintsSublist(constraints: any[], label: string, entityIds: string[]): string;
	renderPrimitivesSublist(primitives: Array<{ id: string; type: PrimitiveType }>): string;
	bindInspectorNumberInput(
		selector: string,
		onCommit: (value: number, input: HTMLInputElement) => void,
		validator?: (val: number) => boolean
	): void;
	requestRender?: () => void;
	withoutSidebarRender?: (fn: () => void) => void;
	getIcon?: (name: string) => string;
}

export interface ISidebarPanel {
	render(context: InspectorContext): string;
	bindEvents(container: HTMLElement, context: InspectorContext): void;
}

export interface IInspectable {
	sidebarPanel?: ISidebarPanel;
}

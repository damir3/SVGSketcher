import type { ITool, ToolContext, ToolMouseEvent, ToolRenderContext } from './types';
import type { ToolType } from './types';

/**
 * Abstract base class providing common default implementations for tools.
 */
export abstract class BaseTool implements ITool {
	abstract readonly id: ToolType;
	readonly defaultCursor: string = 'crosshair';

	protected ctx!: ToolContext;

	activate(ctx: ToolContext): void {
		this.ctx = ctx;
		ctx.setCursor(this.defaultCursor);
	}

	deactivate(): void {
		this.cancel();
	}

	onMouseDown?(e: ToolMouseEvent): boolean | void;
	onMouseMove?(e: ToolMouseEvent): void;
	onMouseUp?(e: ToolMouseEvent): void;
	onDoubleClick?(e: ToolMouseEvent): void;

	onKeyDown?(e: KeyboardEvent): boolean | void;
	onKeyUp?(e: KeyboardEvent): void;

	renderPreview?(ctx: ToolRenderContext): void;

	getRenderOptions(): Record<string, unknown> {
		return {};
	}

	isBusy(): boolean {
		return false;
	}

	cancel(): void {}
	commit(): void {}

	undoPoint(): boolean {
		return false;
	}

	redoPoint(): boolean {
		return false;
	}
}

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

	onMouseDown(_e: ToolMouseEvent): boolean | void {}
	onMouseMove(_e: ToolMouseEvent): void {}
	onMouseUp(_e: ToolMouseEvent): void {}
	onDoubleClick(_e: ToolMouseEvent): void {}

	onKeyDown(_e: KeyboardEvent): boolean | void {}
	onKeyUp(_e: KeyboardEvent): void {}

	renderPreview(_ctx: ToolRenderContext): void {}

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

import type { Vec2 } from '../math/vector';
import type { ITool, ToolContext } from './tools/types';
import { findHoverTarget, type HoverTarget } from './tools/hoverTarget';

export interface IHighlightManager {
	update(tool: ITool | null, screen: Vec2, rawTarget?: SVGElement): HoverTarget | null;
	refresh(tool: ITool | null): void;
	clear(): void;
	getHoveredTarget(): HoverTarget | null;
	getHoveredId(): string | null;
}

export class HighlightManager implements IHighlightManager {
	private svg: SVGSVGElement;
	private getToolContext: () => ToolContext;
	private currentTarget: HoverTarget | null = null;
	private currentClass: string | null = null;
	private currentColor: string | null = null;

	constructor(svg: SVGSVGElement, getToolContext: () => ToolContext) {
		this.svg = svg;
		this.getToolContext = getToolContext;
	}

	update(tool: ITool | null, screen: Vec2, rawTarget?: SVGElement): HoverTarget | null {
		if (!tool || !tool.isHighlightEnabled || !tool.isHighlightEnabled(screen)) {
			this.clear();
			return null;
		}

		const ctx = this.getToolContext();
		const options = tool.getHoverTargetOptions ? tool.getHoverTargetOptions() : {};
		let target = findHoverTarget(ctx, screen, rawTarget, options);

		if (target && tool.canHighlight && !tool.canHighlight(target)) {
			target = null;
		}

		if (!target) {
			this.clear();
			return null;
		}

		const highlightClass = tool.getHighlightClass ? tool.getHighlightClass(target) : 'select-hover';
		const highlightColor = tool.getHighlightColor ? tool.getHighlightColor(target) : null;

		this.applyHighlight(target, highlightClass, highlightColor);
		return target;
	}

	private applyHighlight(target: HoverTarget, highlightClass: string, highlightColor: string | null): void {
		if (
			this.currentTarget?.id === target.id &&
			this.currentClass === highlightClass &&
			this.currentColor === highlightColor
		) {
			return;
		}

		this.clear();

		this.currentTarget = target;
		this.currentClass = highlightClass;
		this.currentColor = highlightColor;

		if (this.svg && typeof this.svg.querySelectorAll === 'function') {
			const elements = this.svg.querySelectorAll(`[data-id="${target.id}"]`);
			for (const el of Array.from(elements)) {
				el.classList?.add?.(highlightClass);
				if (highlightColor) {
					(el as HTMLElement).style?.setProperty?.('--custom-hover-color', highlightColor);
				}
			}
		}
	}

	clear(): void {
		if (!this.currentTarget) return;

		if (this.svg && typeof this.svg.querySelectorAll === 'function') {
			const elements = this.svg.querySelectorAll(`[data-id="${this.currentTarget.id}"]`);
			for (const el of Array.from(elements)) {
				if (this.currentClass) {
					el.classList?.remove?.(this.currentClass);
				}
				if (this.currentColor) {
					(el as HTMLElement).style?.removeProperty?.('--custom-hover-color');
				}
			}
		}

		this.currentTarget = null;
		this.currentClass = null;
		this.currentColor = null;
	}

	refresh(tool: ITool | null): void {
		if (!this.currentTarget || !this.currentClass) return;

		const ctx = this.getToolContext();
		const exists =
			ctx.sketch.points.has(this.currentTarget.id) ||
			ctx.sketch.lines.has(this.currentTarget.id) ||
			ctx.sketch.circles.has(this.currentTarget.id) ||
			ctx.sketch.arcs.has(this.currentTarget.id) ||
			ctx.sketch.ellipses?.has(this.currentTarget.id) ||
			ctx.sketch.ellipticalArcs?.has(this.currentTarget.id) ||
			ctx.sketch.splines.has(this.currentTarget.id) ||
			ctx.sketch.constraints.has(this.currentTarget.id);

		if (!exists) {
			this.currentTarget = null;
			this.currentClass = null;
			this.currentColor = null;
			return;
		}

		if (!tool || !tool.isHighlightEnabled || !tool.isHighlightEnabled()) {
			this.currentTarget = null;
			this.currentClass = null;
			this.currentColor = null;
			return;
		}

		if (tool.canHighlight && !tool.canHighlight(this.currentTarget)) {
			this.currentTarget = null;
			this.currentClass = null;
			this.currentColor = null;
			return;
		}

		if (this.svg && typeof this.svg.querySelectorAll === 'function') {
			const elements = this.svg.querySelectorAll(`[data-id="${this.currentTarget.id}"]`);
			for (const el of Array.from(elements)) {
				el.classList?.add?.(this.currentClass);
				if (this.currentColor) {
					(el as HTMLElement).style?.setProperty?.('--custom-hover-color', this.currentColor);
				}
			}
		}
	}

	getHoveredTarget(): HoverTarget | null {
		return this.currentTarget;
	}

	getHoveredId(): string | null {
		return this.currentTarget?.id ?? null;
	}
}

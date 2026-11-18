import type { Vec2 } from '../math/vector';
import type { ITool, ToolContext } from './tools/types';
import { findHoverTarget, type HoverTarget } from './tools/hoverTarget';

export interface IHighlightManager {
	update(tool: ITool | null, screen: Vec2, rawTarget?: SVGElement): HoverTarget | null;
	setExternalTarget(target: HoverTarget | null): void;
	clearCanvasHover(): void;
	refresh(tool: ITool | null): void;
	clear(): void;
	getHoveredTarget(): HoverTarget | null;
	getHoveredId(): string | null;
}

export class HighlightManager implements IHighlightManager {
	private svg: SVGSVGElement;
	private getToolContext: () => ToolContext;
	private currentTarget: HoverTarget | null = null;
	private externalTarget: HoverTarget | null = null;
	private currentClass: string | null = null;
	private currentColor: string | null = null;

	constructor(svg: SVGSVGElement, getToolContext: () => ToolContext) {
		this.svg = svg;
		this.getToolContext = getToolContext;
	}

	update(tool: ITool | null, screen: Vec2, rawTarget?: SVGElement): HoverTarget | null {
		this.externalTarget = null;
		if (!tool || !tool.isHighlightEnabled || !tool.isHighlightEnabled(screen)) {
			this.clearHighlightElements();
			return null;
		}

		const ctx = this.getToolContext();
		const options = tool.getHoverTargetOptions ? tool.getHoverTargetOptions() : {};
		let target = findHoverTarget(ctx, screen, rawTarget, options);

		if (target && tool.canHighlight && !tool.canHighlight(target)) {
			target = null;
		}

		if (!target) {
			this.clearHighlightElements();
			return null;
		}

		const highlightClass = tool.getHighlightClass ? tool.getHighlightClass(target) : 'select-hover';
		const highlightColor = tool.getHighlightColor ? tool.getHighlightColor(target) : null;

		this.applyHighlight(target, highlightClass, highlightColor);
		return target;
	}

	setExternalTarget(target: HoverTarget | null): void {
		this.externalTarget = target;
		if (!target) {
			this.clearHighlightElements();
			return;
		}
		this.applyHighlight(target, 'select-hover', null);
	}

	clearCanvasHover(): void {
		if (this.externalTarget) return;
		this.clearHighlightElements();
	}

	private applyHighlight(target: HoverTarget, highlightClass: string, highlightColor: string | null): void {
		if (
			this.currentTarget?.id === target.id &&
			this.currentClass === highlightClass &&
			this.currentColor === highlightColor
		) {
			return;
		}

		this.clearHighlightElements();

		this.currentTarget = target;
		this.currentClass = highlightClass;
		this.currentColor = highlightColor;

		this.applyHighlightToElements(target.id, highlightClass, highlightColor, true);
	}

	private applyHighlightToElements(
		targetId: string,
		classStr: string | null,
		color: string | null,
		add: boolean
	): void {
		if (!this.svg || typeof this.svg.querySelectorAll !== 'function') return;
		const elements = this.svg.querySelectorAll(`[data-id="${targetId}"]`);
		const classes = classStr ? classStr.split(/\s+/).filter(Boolean) : [];
		for (const el of Array.from(elements)) {
			for (const cls of classes) {
				add ? el.classList?.add?.(cls) : el.classList?.remove?.(cls);
			}
			if (color) {
				const style = (el as HTMLElement).style;
				add ? style?.setProperty?.('--custom-hover-color', color) : style?.removeProperty?.('--custom-hover-color');
			}
		}
	}

	private clearHighlightElements(): void {
		if (!this.currentTarget) return;

		this.applyHighlightToElements(this.currentTarget.id, this.currentClass, this.currentColor, false);

		this.currentTarget = null;
		this.currentClass = null;
		this.currentColor = null;
	}

	clear(): void {
		this.externalTarget = null;
		this.clearHighlightElements();
	}

	refresh(tool: ITool | null): void {
		if (!this.currentTarget || !this.currentClass) return;

		const ctx = this.getToolContext();
		const exists =
			this.currentTarget.id === 'origin' ||
			this.currentTarget.id === 'axis_x' ||
			this.currentTarget.id === 'axis_y' ||
			ctx.sketch.points.has(this.currentTarget.id) ||
			ctx.sketch.lines.has(this.currentTarget.id) ||
			ctx.sketch.circles.has(this.currentTarget.id) ||
			ctx.sketch.arcs.has(this.currentTarget.id) ||
			ctx.sketch.ellipses?.has(this.currentTarget.id) ||
			ctx.sketch.ellipticalArcs?.has(this.currentTarget.id) ||
			ctx.sketch.splines.has(this.currentTarget.id) ||
			ctx.sketch.texts?.has(this.currentTarget.id) ||
			ctx.sketch.constraints.has(this.currentTarget.id);

		if (!exists) {
			this.clear();
			return;
		}

		const isExternal = this.externalTarget?.id === this.currentTarget.id;
		if (!isExternal) {
			if (!tool || !tool.isHighlightEnabled || !tool.isHighlightEnabled()) {
				this.clearHighlightElements();
				return;
			}

			if (tool.canHighlight && !tool.canHighlight(this.currentTarget)) {
				this.clearHighlightElements();
				return;
			}
		}

		this.applyHighlightToElements(this.currentTarget.id, this.currentClass, this.currentColor, true);
	}

	getHoveredTarget(): HoverTarget | null {
		return this.currentTarget;
	}

	getHoveredId(): string | null {
		return this.currentTarget?.id ?? null;
	}
}

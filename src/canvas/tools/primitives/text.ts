import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { Vec2 } from '../../../math/vector';
import type { IToolPanel } from '../../../ui/panels/tools/types';
import type { SketchText, TextPathTargetType } from '../../../model/primitives/text';
import { COLORS } from '../../styles';
import {
	createSvgElement,
	createSvgEllipse,
	createSvgLine,
	createSvgPath,
	createSvgRect,
	createSvgText,
	getEllipticalArcSvgPath,
} from '../../svg';
import {
	renderTextCardHtml,
	bindTextCardEvents,
	type TextCardCallbacks,
} from '../../../ui/panels/primitives/textPanel';
import { showToast } from '../../../ui/toast';

export class TextTool extends BaseTool {
	readonly id = 'text' as const;
	override readonly defaultCursor = 'crosshair';

	mode: 'text' | 'text_on_path' = 'text';
	text = 'Text';
	fontFamily = 'Arial';
	bold = false;
	italic = false;
	height = 10;
	characterSpacing = 0;
	verticalAlignment: 'top' | 'middle' | 'bottom' = 'top';
	placement: 'above' | 'below' = 'above';
	fitToPath = false;
	flipHorizontal = false;
	flipVertical = false;
	alignment: 'left' | 'center' | 'right' = 'left';

	activeTextId: string | null = null;

	// Drawing state for mode === 'text'
	private drawingStep: 0 | 1 = 0;
	private startWorld: Vec2 | null = null;
	private currentWorld: Vec2 | null = null;
	private isDragDown = false;

	// Hover candidate for mode === 'text_on_path'
	private hoverCandidate: { id: string; type: TextPathTargetType } | null = null;

	// Rotation gizmo dragging
	private isRotating = false;
	private rotationCenter: Vec2 | null = null;
	private rotationTextId: string | null = null;

	// Center drag gizmo dragging
	private isDraggingCenter = false;
	private dragTextId: string | null = null;
	private dragStartWorld: Vec2 | null = null;
	private dragInitialPoints: Map<string, Vec2> = new Map();

	constructor() {
		super();
		this.sidebarPanel = new TextToolSidebarPanel(this);
	}

	override shouldSnap(): boolean {
		return false;
	}

	override getRenderOptions(): Record<string, unknown> {
		if (this.mode === 'text' && this.drawingStep === 1 && this.activeTextId && this.ctx) {
			const activeText = this.ctx.sketch.texts.get(this.activeTextId);
			const hiddenEntityIds = new Set<string>([this.activeTextId]);
			if (activeText?.rectanglePointIds) {
				for (const pid of activeText.rectanglePointIds) hiddenEntityIds.add(pid);
			}
			if (activeText?.rectangleLineIds) {
				for (const lid of activeText.rectangleLineIds) hiddenEntityIds.add(lid);
			}
			return {
				activeTextId: null,
				hiddenEntityIds,
			};
		}
		return {
			activeTextId: this.activeTextId,
		};
	}

	setActiveText(text: SketchText): void {
		this.activeTextId = text.id;
		this.mode = text.mode;
		this.text = text.text;
		this.fontFamily = text.fontFamily;
		this.bold = text.bold;
		this.italic = text.italic;
		this.height = text.height;
		this.characterSpacing = text.characterSpacing;
		this.verticalAlignment = text.verticalAlignment ?? 'middle';
		this.placement = text.placement;
		this.fitToPath = text.fitToPath;
		this.flipHorizontal = text.flipHorizontal;
		this.flipVertical = text.flipVertical;
		this.alignment = text.alignment;

		if (this.ctx) {
			this.ctx.sketch.selectEntity(text.id, 'text' as any, false);
			this.ctx.requestRender();
		}
	}

	private clearDrawingState(): void {
		this.drawingStep = 0;
		this.startWorld = null;
		this.currentWorld = null;
		this.isDragDown = false;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.clearDrawingState();
		this.hoverCandidate = null;
		this.isRotating = false;
		this.activeTextId = null;
	}

	override deactivate(): void {
		super.deactivate();
		this.clearDrawingState();
		this.hoverCandidate = null;
		this.isRotating = false;
		this.isDraggingCenter = false;
		this.rotationTextId = null;
		this.rotationCenter = null;
		this.dragTextId = null;
		this.dragStartWorld = null;
		this.dragInitialPoints.clear();
		this.activeTextId = null;
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key !== 'Enter') return;

		e.preventDefault();
		if (this.isRotating || this.isDraggingCenter) this.ctx.sketch.commitTransaction();
		this.ctx.setTool('select');
		return true;
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		// 1. Check if clicked rotation gizmo handle
		const gizmo = this.ctx.renderer.textRotationGizmo;
		if (gizmo && e.screen.distanceTo(gizmo.handleScreen) <= 15) {
			this.isRotating = true;
			this.rotationTextId = gizmo.textId;
			this.rotationCenter = gizmo.centerWorld;
			this.ctx.sketch.beginTransaction();
			return;
		}

		// 2. Check if clicked center drag handle
		const dragGizmo = this.ctx.renderer.textDragGizmo;
		if (dragGizmo && e.screen.distanceTo(dragGizmo.centerScreen) <= 15) {
			this.isDraggingCenter = true;
			this.dragTextId = dragGizmo.textId;
			this.dragStartWorld = e.world;
			const text = this.ctx.sketch.texts.get(dragGizmo.textId);
			this.dragInitialPoints.clear();
			if (text?.rectanglePointIds) {
				for (const pid of text.rectanglePointIds) {
					const pt = this.ctx.sketch.points.get(pid);
					if (pt) this.dragInitialPoints.set(pid, pt.clone());
				}
			}
			this.ctx.sketch.beginTransaction();
			return;
		}

		// 3. Check if clicked an existing text object to select it
		const clickedText = this.findTextAt(e.screen);
		if (clickedText) {
			this.setActiveText(clickedText);
			return;
		}

		if (this.mode === 'text') {
			if (this.drawingStep === 0) {
				this.startWorld = e.world;
				this.currentWorld = e.world;
				this.drawingStep = 1;
				this.isDragDown = true;
				this.ctx.requestRender();
			} else {
				this.commitRectangle(e.world);
			}
		} else if (this.mode === 'text_on_path') {
			if (this.hoverCandidate) {
				this.commitTextOnPath(this.hoverCandidate.id, this.hoverCandidate.type);
			}
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.isRotating && this.rotationTextId && this.rotationCenter) {
			this.handleRotationMove(e.world);
			return;
		}

		if (this.isDraggingCenter && this.dragTextId && this.dragStartWorld) {
			this.handleCenterDragMove(e.world);
			return;
		}

		// Update cursor if hovering over gizmo handles
		const rotGizmo = this.ctx.renderer.textRotationGizmo;
		const dragGizmo = this.ctx.renderer.textDragGizmo;
		if (rotGizmo && e.screen.distanceTo(rotGizmo.handleScreen) <= 15) {
			this.ctx.setCursor('grab');
		} else if (dragGizmo && e.screen.distanceTo(dragGizmo.centerScreen) <= 15) {
			this.ctx.setCursor('move');
		} else {
			this.ctx.setCursor(this.defaultCursor);
		}

		if (this.mode === 'text' && this.drawingStep === 1) {
			this.currentWorld = e.world;
			this.ctx.requestRender();
		} else if (this.mode === 'text_on_path') {
			this.hoverCandidate = this.findCurveNear(e.screen);
			this.ctx.requestRender();
		}
	}

	override onMouseUp(e: ToolMouseEvent): void {
		if (this.isRotating) {
			this.isRotating = false;
			this.rotationTextId = null;
			this.rotationCenter = null;
			this.ctx.sketch.commitTransaction();
			this.ctx.requestRender();
			return;
		}

		if (this.isDraggingCenter) {
			this.isDraggingCenter = false;
			this.dragTextId = null;
			this.dragStartWorld = null;
			this.dragInitialPoints.clear();
			this.ctx.sketch.commitTransaction();
			this.ctx.requestRender();
			return;
		}

		if (this.mode === 'text' && this.isDragDown && this.drawingStep === 1 && this.startWorld) {
			this.isDragDown = false;
			const d = this.startWorld.distanceTo(e.world);
			if (d >= 2) {
				this.commitRectangle(e.world);
			}
		}
	}

	private handleCenterDragMove(currentWorld: Vec2): void {
		if (!this.dragStartWorld || this.dragInitialPoints.size === 0) return;
		const text = this.dragTextId ? this.ctx.sketch.texts.get(this.dragTextId) : undefined;
		if (text) {
			text.translateRectangle(this.ctx.sketch, this.dragStartWorld, currentWorld, this.dragInitialPoints);
		} else {
			const dir = new Vec2().subVectors(currentWorld, this.dragStartWorld);
			for (const [pid, initPos] of this.dragInitialPoints) {
				const pt = this.ctx.sketch.points.get(pid);
				if (pt) pt.addVectors(initPos, dir);
			}
			this.ctx.sketch.solve();
		}
		this.ctx.requestRender();
	}

	private handleRotationMove(mouseWorld: Vec2): void {
		if (!this.rotationTextId || !this.rotationCenter) return;
		const text = this.ctx.sketch.texts.get(this.rotationTextId);
		if (text?.rotateRectangleTo(this.ctx.sketch, this.rotationCenter, mouseWorld)) {
			this.ctx.requestRender();
		}
	}

	private getTextStyleProps() {
		return {
			text: this.text,
			fontFamily: this.fontFamily,
			bold: this.bold,
			italic: this.italic,
			height: this.height,
			characterSpacing: this.characterSpacing,
			placement: this.placement,
			fitToPath: this.fitToPath,
			flipHorizontal: this.flipHorizontal,
			flipVertical: this.flipVertical,
			alignment: this.alignment,
		};
	}

	private removeTextRectangle(sketch: typeof this.ctx.sketch, target: SketchText): void {
		for (const lid of target.rectangleLineIds ?? []) sketch.removeEntity(lid);
		for (const pid of target.rectanglePointIds ?? []) sketch.removeEntity(pid);
		target.rectangleLineIds = undefined;
		target.rectanglePointIds = undefined;
	}

	private createTextRectangle(sketch: typeof this.ctx.sketch, min: Vec2, max: Vec2) {
		// Corner order: TL, TR, BR, BL in CAD Y-up coordinates
		const p0 = sketch.addPoint(new Vec2(min.x, max.y), false);
		const p1 = sketch.addPoint(max, false);
		const p2 = sketch.addPoint(new Vec2(max.x, min.y), false);
		const p3 = sketch.addPoint(min, false);

		const l0 = sketch.addLine(p0.id, p1.id, 'construction');
		const l1 = sketch.addLine(p1.id, p2.id, 'construction');
		const l2 = sketch.addLine(p2.id, p3.id, 'construction');
		const l3 = sketch.addLine(p3.id, p0.id, 'construction');

		sketch.addParallelConstraint(l0.id, l2.id);
		sketch.addParallelConstraint(l1.id, l3.id);
		sketch.addPerpendicularConstraint(l0.id, l1.id);

		return {
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id] as [string, string, string, string],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id] as [string, string, string, string],
		};
	}

	private commitRectangle(secondPos: Vec2): void {
		if (!this.startWorld) return;
		const sketch = this.ctx.sketch;

		const min = new Vec2(Math.min(this.startWorld.x, secondPos.x), Math.min(this.startWorld.y, secondPos.y));
		const max = new Vec2(Math.max(this.startWorld.x, secondPos.x), Math.max(this.startWorld.y, secondPos.y));

		if (max.x - min.x < 2 || max.y - min.y < 2) {
			max.x = min.x + 50;
			max.y = min.y + 30;
		}

		sketch.beginTransaction();

		const existingText = this.activeTextId ? sketch.texts.get(this.activeTextId) : null;
		let resultText: SketchText;

		if (existingText) {
			existingText.targetPrimitiveId = undefined;
			existingText.targetPrimitiveType = undefined;

			let reusedRect = false;
			if (existingText.rectanglePointIds && existingText.rectangleLineIds) {
				const pts = existingText.rectanglePointIds.map(id => sketch.points.get(id));
				const hasAllLines = existingText.rectangleLineIds.every(lid => sketch.lines.has(lid));
				if (pts.every(Boolean) && hasAllLines) {
					reusedRect = true;
					const [pt0, pt1, pt2, pt3] = pts as NonNullable<(typeof pts)[number]>[];
					pt0.x = min.x;
					pt0.y = max.y;
					pt1.x = max.x;
					pt1.y = max.y;
					pt2.x = max.x;
					pt2.y = min.y;
					pt3.x = min.x;
					pt3.y = min.y;
					sketch.solve();
				}
			}

			if (!reusedRect) {
				this.removeTextRectangle(sketch, existingText);
				Object.assign(existingText, this.createTextRectangle(sketch, min, max));
			}

			Object.assign(existingText, this.getTextStyleProps(), {
				mode: 'text' as const,
				verticalAlignment: this.verticalAlignment,
			});
			resultText = existingText;
		} else {
			resultText = sketch.addText({
				mode: 'text',
				verticalAlignment: this.verticalAlignment,
				...this.getTextStyleProps(),
				...this.createTextRectangle(sketch, min, max),
			});
		}

		sketch.commitTransaction();
		this.clearDrawingState();
		this.setActiveText(resultText);
		this.ctx.requestRender();
	}

	private commitTextOnPath(primId: string, primType: TextPathTargetType): void {
		const sketch = this.ctx.sketch;
		const existingText = this.activeTextId ? sketch.texts.get(this.activeTextId) : null;

		if (existingText) {
			sketch.beginTransaction();
			if (existingText.mode === 'text' && (existingText.rectanglePointIds || existingText.rectangleLineIds)) {
				this.removeTextRectangle(sketch, existingText);
			}
			Object.assign(existingText, this.getTextStyleProps(), {
				mode: 'text_on_path' as const,
				targetPrimitiveId: primId,
				targetPrimitiveType: primType,
			});
			sketch.commitTransaction();
			this.setActiveText(existingText);
			this.ctx.requestRender();
			return;
		}

		const newText = sketch.addText({
			mode: 'text_on_path',
			...this.getTextStyleProps(),
			targetPrimitiveId: primId,
			targetPrimitiveType: primType,
		});

		this.setActiveText(newText);
		this.ctx.requestRender();
	}

	private findTextAt(screen: Vec2): SketchText | null {
		for (const text of this.ctx.sketch.texts.values()) {
			const d = text.distanceTo(screen, this.ctx.sketch, this.ctx.viewport);
			if (d !== null && d <= 15) {
				return text;
			}
		}
		return null;
	}

	private findCurveNear(screen: Vec2): { id: string; type: TextPathTargetType } | null {
		const line = this.ctx.findLineNear(screen, 12);
		if (line) return { id: line.id, type: 'line' };

		const circle = this.ctx.findCircleNear(screen, 12);
		if (circle) return { id: circle.id, type: 'circle' };

		const arc = this.ctx.findArcNear(screen, 12);
		if (arc) return { id: arc.id, type: 'arc' };

		const spline = this.ctx.findSplineNear(screen, 12);
		if (spline) return { id: spline.id, type: 'spline' };

		const ellipse = this.ctx.findEllipseNear?.(screen, 12);
		if (ellipse) return { id: ellipse.id, type: 'ellipse' };

		const ellipticalArc = this.ctx.findEllipticalArcNear?.(screen, 12);
		if (ellipticalArc) return { id: ellipticalArc.id, type: 'elliptical_arc' };

		return null;
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.mode === 'text' && this.drawingStep === 1 && this.startWorld && this.currentWorld) {
			const s1 = ctx.viewport.worldToScreen(this.startWorld);
			const s2 = ctx.viewport.worldToScreen(this.currentWorld);

			const min = new Vec2(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y));
			const max = new Vec2(Math.max(s1.x, s2.x), Math.max(s1.y, s2.y));
			const w = Math.max(1, max.x - min.x);
			const h = Math.max(1, max.y - min.y);

			createSvgRect(
				min,
				new Vec2(w, h),
				{
					stroke: COLORS.primary,
					'stroke-width': 1.5,
					'stroke-dasharray': '4,4',
					fill: COLORS.primary,
					'fill-opacity': 0.05,
				},
				ctx.targetGroup
			);

			// Preview text with current alignment & vertical alignment
			const hScreen = Math.max(1, this.height * ctx.viewport.zoom);
			const lines = (this.text || '').split(/\r?\n/);
			const numLines = Math.max(1, lines.length);
			const lineHeightPx = hScreen * 1.25;
			const totalBlockHeightPx = (numLines - 1) * lineHeightPx;

			const center = new Vec2(min.x + w / 2, min.y + h / 2);

			let posX = center.x;
			let textAnchor = 'middle';
			if (this.alignment === 'left') {
				posX = min.x + 4;
				textAnchor = 'start';
			} else if (this.alignment === 'right') {
				posX = max.x - 4;
				textAnchor = 'end';
			}

			let startY = center.y;
			if (this.verticalAlignment === 'top') {
				startY = min.y + hScreen / 2 + 4;
			} else if (this.verticalAlignment === 'bottom') {
				startY = max.y - hScreen / 2 - 4 - totalBlockHeightPx;
			} else {
				startY = center.y - totalBlockHeightPx / 2;
			}

			const scaleX = this.flipHorizontal ? -1 : 1;
			const scaleY = this.flipVertical ? -1 : 1;
			const transformAttr =
				this.flipHorizontal || this.flipVertical
					? `translate(${center.x}, ${center.y}) scale(${scaleX}, ${scaleY}) translate(${-center.x}, ${-center.y})`
					: undefined;

			const previewTextG = createSvgElement(
				'g',
				{
					opacity: '0.25',
					...(transformAttr ? { transform: transformAttr } : {}),
				},
				ctx.targetGroup
			);

			for (let i = 0; i < lines.length; i++) {
				const lineY = startY + i * lineHeightPx;
				createSvgText(
					new Vec2(posX, lineY),
					lines[i] || ' ',
					{
						fill: COLORS.primary,
						'font-family': this.fontFamily,
						'font-size': `${hScreen.toFixed(1)}px`,
						'font-weight': this.bold ? 'bold' : 'normal',
						'font-style': this.italic ? 'italic' : 'normal',
						'letter-spacing': `${((this.characterSpacing / 100) * hScreen).toFixed(1)}px`,
						'text-anchor': textAnchor,
						'dominant-baseline': 'central',
					},
					previewTextG
				);
			}
		} else if (this.mode === 'text_on_path' && this.hoverCandidate) {
			// Highlight candidate curve
			const geo = this.ctx.sketch.toGeoCurve(this.hoverCandidate.id, this.hoverCandidate.type);
			const attrs = { stroke: COLORS.primary, 'stroke-width': 3, fill: 'none', 'pointer-events': 'none' };
			const toScreen = (point: Vec2) => ctx.viewport.worldToScreen(point);
			if (geo?.type === 'segment') {
				createSvgLine(toScreen(geo.p1), toScreen(geo.p2), attrs, ctx.targetGroup);
			} else if (geo?.type === 'ellipse' || geo?.type === 'elliptical_arc') {
				const center = toScreen(geo.center);
				const major = toScreen(geo.majorAxisPoint);
				const minor = toScreen(geo.minorAxisPoint);
				if (geo.type === 'ellipse') {
					const transform = `rotate(${center.angleToPointDeg(major)} ${center.x} ${center.y})`;
					createSvgEllipse(center, center.distancesTo(major, minor), { ...attrs, transform }, ctx.targetGroup);
				} else {
					const d = getEllipticalArcSvgPath(
						center,
						major,
						minor,
						toScreen(geo.start),
						toScreen(geo.end),
						geo.clockwise
					);
					createSvgPath(d, attrs, ctx.targetGroup);
				}
			}
		}
	}
}

export class TextToolSidebarPanel implements IToolPanel {
	private readonly tool: TextTool;
	private container?: HTMLElement;

	constructor(tool: TextTool) {
		this.tool = tool;
	}

	handleKeyDown(e: KeyboardEvent): boolean {
		if (!e.altKey || e.ctrlKey || e.metaKey) return false;

		const match = e.code.match(/^(?:Digit|Numpad)([12])$/);
		if (!match) return false;

		const mode = match[1] === '1' ? 'text' : 'text_on_path';
		e.preventDefault();
		if (this.tool.mode !== mode) {
			this.tool.mode = mode;
			this.tool.context?.requestRender();
		}
		this.rerender();
		showToast(mode === 'text' ? 'Text in Rectangle (Alt+1)' : 'Text on Path (Alt+2)');
		return true;
	}

	rerender(): void {
		if (!this.container) return;
		const card = this.container.querySelector<HTMLElement>('.text-tool-card');
		if (card) {
			const temp = document.createElement('div');
			temp.innerHTML = this.render();
			const newCard = temp.firstElementChild;
			if (newCard) {
				card.replaceWith(newCard);
				this.bindEvents(this.container);
			}
		}
	}

	render(): string {
		return renderTextCardHtml(this.tool, { isToolMode: true });
	}

	bindEvents(container: HTMLElement): void {
		this.container = container;
		const cardEl = container.querySelector<HTMLElement>('.text-tool-card');
		if (!cardEl) return;

		const t = this.tool;
		const callbacks: TextCardCallbacks = {
			getData: () => t,
			setData: (updater, pushHistory = true) => {
				const prevMode = t.mode;
				updater(t);
				if (t.activeTextId && t.context) {
					const activeText = t.context.sketch.texts.get(t.activeTextId);
					if (activeText) {
						if (t.mode === prevMode || activeText.mode === t.mode) {
							updater(activeText);
							if (pushHistory) {
								t.context.sketch.pushHistory();
								t.context.sketch.notify();
							}
						}
					}
				}
				t.context?.requestRender();
			},
			requestRender: () => {
				t.context?.requestRender();
			},
			onClose: () => {
				t.context?.setTool('select');
			},
			isToolMode: true,
		};

		bindTextCardEvents(cardEl, callbacks, () => this.rerender());
	}
}

import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, vec, type Vec2 } from '../../../math/vector';
import type { IToolPanel } from '../../../ui/panels/tools/types';
import type { SketchText } from '../../../model/primitives/text';
import { COLORS } from '../../styles';
import { createSvgElement, createSvgLine, createSvgRect, createSvgText } from '../../svg';
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
	private hoverCandidate: { id: string; type: 'line' | 'circle' | 'arc' | 'spline' } | null = null;

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

	override activate(ctx: any): void {
		super.activate(ctx);
		this.drawingStep = 0;
		this.startWorld = null;
		this.currentWorld = null;
		this.isDragDown = false;
		this.hoverCandidate = null;
		this.isRotating = false;
		this.activeTextId = null;
	}

	override deactivate(): void {
		super.deactivate();
		this.drawingStep = 0;
		this.startWorld = null;
		this.currentWorld = null;
		this.isDragDown = false;
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

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		// 1. Check if clicked rotation gizmo handle
		const gizmo = this.ctx.renderer.textRotationGizmo;
		if (gizmo && dist(e.screen, gizmo.handleScreen) <= 15) {
			this.isRotating = true;
			this.rotationTextId = gizmo.textId;
			this.rotationCenter = gizmo.centerWorld;
			this.ctx.sketch.beginTransaction();
			return;
		}

		// 2. Check if clicked center drag handle
		const dragGizmo = this.ctx.renderer.textDragGizmo;
		if (dragGizmo && dist(e.screen, dragGizmo.centerScreen) <= 15) {
			this.isDraggingCenter = true;
			this.dragTextId = dragGizmo.textId;
			this.dragStartWorld = e.world;
			const text = this.ctx.sketch.texts.get(dragGizmo.textId);
			this.dragInitialPoints.clear();
			if (text?.rectanglePointIds) {
				for (const pid of text.rectanglePointIds) {
					const pt = this.ctx.sketch.points.get(pid);
					if (pt) this.dragInitialPoints.set(pid, vec(pt.x, pt.y));
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
		if (rotGizmo && dist(e.screen, rotGizmo.handleScreen) <= 15) {
			this.ctx.setCursor('grab');
		} else if (dragGizmo && dist(e.screen, dragGizmo.centerScreen) <= 15) {
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
			const d = dist(this.startWorld, e.world);
			if (d >= 2) {
				this.commitRectangle(e.world);
			}
		}
	}

	private handleCenterDragMove(currentWorld: Vec2): void {
		if (!this.dragStartWorld || this.dragInitialPoints.size === 0) return;
		const dx = currentWorld.x - this.dragStartWorld.x;
		const dy = currentWorld.y - this.dragStartWorld.y;

		for (const [pid, initPos] of this.dragInitialPoints) {
			const pt = this.ctx.sketch.points.get(pid);
			if (pt) {
				pt.x = initPos.x + dx;
				pt.y = initPos.y + dy;
			}
		}

		this.ctx.sketch.solve();
		this.ctx.requestRender();
	}

	private handleRotationMove(mouseWorld: Vec2): void {
		if (!this.rotationTextId || !this.rotationCenter) return;
		const text = this.ctx.sketch.texts.get(this.rotationTextId);
		if (!text || !text.rectanglePointIds) return;

		const corners = text.getRectangleCorners(this.ctx.sketch);
		if (!corners) return;
		const [p0, p1, p2, p3] = corners;

		const c = this.rotationCenter;
		// Target angle of mouse relative to center
		const mouseAngle = Math.atan2(mouseWorld.y - c.y, mouseWorld.x - c.x);
		// In unrotated rectangle, top center handle is at angle +PI/2
		const targetAngle = mouseAngle - Math.PI / 2;

		const currentAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
		const deltaAngle = targetAngle - currentAngle;

		const rotatePoint = (p: Vec2, center: Vec2, rad: number): Vec2 => {
			const cos = Math.cos(rad);
			const sin = Math.sin(rad);
			const dx = p.x - center.x;
			const dy = p.y - center.y;
			return vec(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
		};

		const pt0 = this.ctx.sketch.points.get(text.rectanglePointIds[0]);
		const pt1 = this.ctx.sketch.points.get(text.rectanglePointIds[1]);
		const pt2 = this.ctx.sketch.points.get(text.rectanglePointIds[2]);
		const pt3 = this.ctx.sketch.points.get(text.rectanglePointIds[3]);

		if (pt0 && pt1 && pt2 && pt3) {
			const np0 = rotatePoint(p0, c, deltaAngle);
			const np1 = rotatePoint(p1, c, deltaAngle);
			const np2 = rotatePoint(p2, c, deltaAngle);
			const np3 = rotatePoint(p3, c, deltaAngle);

			pt0.x = np0.x;
			pt0.y = np0.y;
			pt1.x = np1.x;
			pt1.y = np1.y;
			pt2.x = np2.x;
			pt2.y = np2.y;
			pt3.x = np3.x;
			pt3.y = np3.y;

			this.ctx.sketch.solve();
			this.ctx.requestRender();
		}
	}

	private commitRectangle(secondPos: Vec2): void {
		if (!this.startWorld) return;
		const sketch = this.ctx.sketch;

		let minX = Math.min(this.startWorld.x, secondPos.x);
		let maxX = Math.max(this.startWorld.x, secondPos.x);
		let minY = Math.min(this.startWorld.y, secondPos.y);
		let maxY = Math.max(this.startWorld.y, secondPos.y);

		if (maxX - minX < 2 || maxY - minY < 2) {
			maxX = minX + 50;
			maxY = minY + 30;
		}

		sketch.beginTransaction();

		const existingText = this.activeTextId ? sketch.texts.get(this.activeTextId) : null;

		if (existingText) {
			existingText.targetPrimitiveId = undefined;
			existingText.targetPrimitiveType = undefined;

			let hasAllPointsAndLines = false;
			if (existingText.rectanglePointIds && existingText.rectangleLineIds) {
				const [p0Id, p1Id, p2Id, p3Id] = existingText.rectanglePointIds;
				const pt0 = sketch.points.get(p0Id);
				const pt1 = sketch.points.get(p1Id);
				const pt2 = sketch.points.get(p2Id);
				const pt3 = sketch.points.get(p3Id);
				const hasAllLines = existingText.rectangleLineIds.every(lid => sketch.lines.has(lid));
				if (pt0 && pt1 && pt2 && pt3 && hasAllLines) {
					hasAllPointsAndLines = true;
					pt0.x = minX;
					pt0.y = maxY;
					pt1.x = maxX;
					pt1.y = maxY;
					pt2.x = maxX;
					pt2.y = minY;
					pt3.x = minX;
					pt3.y = minY;
					sketch.solve();
				}
			}

			if (!hasAllPointsAndLines) {
				if (existingText.rectangleLineIds) {
					for (const lid of existingText.rectangleLineIds) {
						sketch.removeEntity(lid);
					}
				}
				if (existingText.rectanglePointIds) {
					for (const pid of existingText.rectanglePointIds) {
						sketch.removeEntity(pid);
					}
				}

				const p0 = sketch.addPoint(minX, maxY, false);
				const p1 = sketch.addPoint(maxX, maxY, false);
				const p2 = sketch.addPoint(maxX, minY, false);
				const p3 = sketch.addPoint(minX, minY, false);

				const l0 = sketch.addLine(p0.id, p1.id, true);
				const l1 = sketch.addLine(p1.id, p2.id, true);
				const l2 = sketch.addLine(p2.id, p3.id, true);
				const l3 = sketch.addLine(p3.id, p0.id, true);

				sketch.addParallelConstraint(l0.id, l2.id);
				sketch.addParallelConstraint(l1.id, l3.id);
				sketch.addPerpendicularConstraint(l0.id, l1.id);

				existingText.rectanglePointIds = [p0.id, p1.id, p2.id, p3.id];
				existingText.rectangleLineIds = [l0.id, l1.id, l2.id, l3.id];
			}

			existingText.mode = 'text';
			existingText.text = this.text;
			existingText.fontFamily = this.fontFamily;
			existingText.bold = this.bold;
			existingText.italic = this.italic;
			existingText.height = this.height;
			existingText.characterSpacing = this.characterSpacing;
			existingText.verticalAlignment = this.verticalAlignment;
			existingText.placement = this.placement;
			existingText.fitToPath = this.fitToPath;
			existingText.flipHorizontal = this.flipHorizontal;
			existingText.flipVertical = this.flipVertical;
			existingText.alignment = this.alignment;

			sketch.commitTransaction();

			this.drawingStep = 0;
			this.startWorld = null;
			this.currentWorld = null;
			this.isDragDown = false;

			this.setActiveText(existingText);
			this.ctx.requestRender();
			return;
		}

		// Add 4 construction points: p0(TL), p1(TR), p2(BR), p3(BL) in CAD Y-up
		const p0 = sketch.addPoint(minX, maxY, false);
		const p1 = sketch.addPoint(maxX, maxY, false);
		const p2 = sketch.addPoint(maxX, minY, false);
		const p3 = sketch.addPoint(minX, minY, false);

		// Add 4 construction lines
		const l0 = sketch.addLine(p0.id, p1.id, true);
		const l1 = sketch.addLine(p1.id, p2.id, true);
		const l2 = sketch.addLine(p2.id, p3.id, true);
		const l3 = sketch.addLine(p3.id, p0.id, true);

		// Add constraints enforcing a rigid rotatable rectangle
		sketch.addParallelConstraint(l0.id, l2.id);
		sketch.addParallelConstraint(l1.id, l3.id);
		sketch.addPerpendicularConstraint(l0.id, l1.id);

		// Add text entity
		const newText = sketch.addText({
			mode: 'text',
			text: this.text,
			fontFamily: this.fontFamily,
			bold: this.bold,
			italic: this.italic,
			height: this.height,
			characterSpacing: this.characterSpacing,
			verticalAlignment: this.verticalAlignment,
			placement: this.placement,
			fitToPath: this.fitToPath,
			flipHorizontal: this.flipHorizontal,
			flipVertical: this.flipVertical,
			alignment: this.alignment,
			rectanglePointIds: [p0.id, p1.id, p2.id, p3.id],
			rectangleLineIds: [l0.id, l1.id, l2.id, l3.id],
		});

		sketch.commitTransaction();

		this.drawingStep = 0;
		this.startWorld = null;
		this.currentWorld = null;
		this.isDragDown = false;

		this.setActiveText(newText);
		this.ctx.requestRender();
	}

	private commitTextOnPath(primId: string, primType: 'line' | 'circle' | 'arc' | 'spline'): void {
		const sketch = this.ctx.sketch;
		const existingText = this.activeTextId ? sketch.texts.get(this.activeTextId) : null;

		if (existingText) {
			sketch.beginTransaction();

			// If transitioning from text mode with a rectangle, clean up rectangle points and lines
			if (existingText.mode === 'text' && (existingText.rectanglePointIds || existingText.rectangleLineIds)) {
				const oldPointIds = existingText.rectanglePointIds;
				const oldLineIds = existingText.rectangleLineIds;
				existingText.rectanglePointIds = undefined;
				existingText.rectangleLineIds = undefined;
				existingText.mode = 'text_on_path';
				if (oldLineIds) {
					for (const lid of oldLineIds) {
						sketch.removeEntity(lid);
					}
				}
				if (oldPointIds) {
					for (const pid of oldPointIds) {
						sketch.removeEntity(pid);
					}
				}
			}

			existingText.mode = 'text_on_path';
			existingText.targetPrimitiveId = primId;
			existingText.targetPrimitiveType = primType;
			existingText.text = this.text;
			existingText.fontFamily = this.fontFamily;
			existingText.bold = this.bold;
			existingText.italic = this.italic;
			existingText.height = this.height;
			existingText.characterSpacing = this.characterSpacing;
			existingText.placement = this.placement;
			existingText.fitToPath = this.fitToPath;
			existingText.flipHorizontal = this.flipHorizontal;
			existingText.flipVertical = this.flipVertical;
			existingText.alignment = this.alignment;

			sketch.commitTransaction();
			this.setActiveText(existingText);
			this.ctx.requestRender();
			return;
		}

		const newText = sketch.addText({
			mode: 'text_on_path',
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

	private findCurveNear(screen: Vec2): { id: string; type: 'line' | 'circle' | 'arc' | 'spline' } | null {
		const line = this.ctx.findLineNear(screen, 12);
		if (line) return { id: line.id, type: 'line' };

		const circle = this.ctx.findCircleNear(screen, 12);
		if (circle) return { id: circle.id, type: 'circle' };

		const arc = this.ctx.findArcNear(screen, 12);
		if (arc) return { id: arc.id, type: 'arc' };

		const spline = this.ctx.findSplineNear(screen, 12);
		if (spline) return { id: spline.id, type: 'spline' };

		return null;
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.mode === 'text' && this.drawingStep === 1 && this.startWorld && this.currentWorld) {
			const s1 = ctx.viewport.worldToScreen(this.startWorld.x, this.startWorld.y);
			const s2 = ctx.viewport.worldToScreen(this.currentWorld.x, this.currentWorld.y);

			const minX = Math.min(s1.x, s2.x);
			const maxX = Math.max(s1.x, s2.x);
			const minY = Math.min(s1.y, s2.y);
			const maxY = Math.max(s1.y, s2.y);
			const w = Math.max(1, maxX - minX);
			const h = Math.max(1, maxY - minY);

			createSvgRect(
				minX,
				minY,
				w,
				h,
				{
					stroke: COLORS.primary,
					'stroke-width': 1.5,
					'stroke-dasharray': '4,4',
					fill: 'rgba(2, 132, 199, 0.05)',
				},
				ctx.targetGroup
			);

			// Preview text with current alignment & vertical alignment
			const hScreen = Math.max(1, this.height * ctx.viewport.zoom);
			const lines = (this.text || '').split(/\r?\n/);
			const numLines = Math.max(1, lines.length);
			const lineHeightPx = hScreen * 1.25;
			const totalBlockHeightPx = (numLines - 1) * lineHeightPx;

			const cx = minX + w / 2;
			const cy = minY + h / 2;

			let posX = cx;
			let textAnchor = 'middle';
			if (this.alignment === 'left') {
				posX = minX + 4;
				textAnchor = 'start';
			} else if (this.alignment === 'right') {
				posX = maxX - 4;
				textAnchor = 'end';
			}

			let startY = cy;
			if (this.verticalAlignment === 'top') {
				startY = minY + hScreen / 2 + 4;
			} else if (this.verticalAlignment === 'bottom') {
				startY = maxY - hScreen / 2 - 4 - totalBlockHeightPx;
			} else {
				startY = cy - totalBlockHeightPx / 2;
			}

			const scaleX = this.flipHorizontal ? -1 : 1;
			const scaleY = this.flipVertical ? -1 : 1;
			const transformAttr =
				this.flipHorizontal || this.flipVertical
					? `translate(${cx}, ${cy}) scale(${scaleX}, ${scaleY}) translate(${-cx}, ${-cy})`
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
					posX,
					lineY,
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
			if (geo) {
				if (geo.type === 'segment') {
					const s1 = ctx.viewport.worldToScreen(geo.p1.x, geo.p1.y);
					const s2 = ctx.viewport.worldToScreen(geo.p2.x, geo.p2.y);
					createSvgLine(s1.x, s1.y, s2.x, s2.y, { stroke: COLORS.primary, 'stroke-width': 3 }, ctx.targetGroup);
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

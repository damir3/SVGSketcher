import { ORIGIN, Vec2 } from '../../math/vector';
import type { SketchDocument } from '../sketch';
import type { IInspectable, ISidebarPanel } from '../../ui/panels/inspector/types';
import { TextInspectorPanel } from '../../ui/panels/primitives/textPanel';
import { createSvgElement, createSvgGizmoCircle, createSvgGizmoDashedLine } from '../../canvas/svg';
import { TEXT_ROTATION_HANDLE_DISTANCE_PX } from '../../canvas/distances';
import { getFontSync, loadFontAsync } from '../../canvas/fonts';
import { generateTextSvgPathData } from '../../math/textPath';

export type TextPathTargetType = 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';

export interface TextRenderOptions {
	sketch: SketchDocument;
	viewport: any;
	targetGroup: SVGGElement;
	isSelected: boolean;
	color: string;
	showGizmos: boolean;
}

export interface TextRenderGizmos {
	rotationGizmo?: {
		textId: string;
		centerWorld: Vec2;
		handleScreen: Vec2;
	};
	dragGizmo?: {
		textId: string;
		centerWorld: Vec2;
		centerScreen: Vec2;
	};
}

export interface TextSnapshot {
	type: 'text';
	id: string;
	mode: 'text' | 'text_on_path';
	text: string;
	fontFamily: string;
	bold: boolean;
	italic: boolean;
	height: number;
	characterSpacing: number;
	verticalAlignment?: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	alignment: 'left' | 'center' | 'right';
	rectanglePointIds?: [string, string, string, string];
	rectangleLineIds?: [string, string, string, string];
	targetPrimitiveId?: string;
	targetPrimitiveType?: TextPathTargetType;
}

export class SketchText implements IInspectable {
	readonly type = 'text' as const;
	id: string;
	mode: 'text' | 'text_on_path';
	text: string;
	fontFamily: string;
	bold: boolean;
	italic: boolean;
	height: number;
	characterSpacing: number;
	verticalAlignment: 'top' | 'middle' | 'bottom';
	placement: 'above' | 'below';
	fitToPath: boolean;
	flipHorizontal: boolean;
	flipVertical: boolean;
	alignment: 'left' | 'center' | 'right';

	rectanglePointIds?: [string, string, string, string];
	rectangleLineIds?: [string, string, string, string];
	targetPrimitiveId?: string;
	targetPrimitiveType?: TextPathTargetType;

	readonly sidebarPanel: ISidebarPanel;

	constructor(data: Omit<TextSnapshot, 'type'>) {
		this.id = data.id;
		this.mode = data.mode;
		this.text = data.text;
		this.fontFamily = data.fontFamily ?? 'Arial';
		this.bold = !!data.bold;
		this.italic = !!data.italic;
		this.height = data.height ?? 10;
		this.characterSpacing = data.characterSpacing ?? 0;
		this.verticalAlignment = data.verticalAlignment ?? 'middle';
		this.placement = data.placement ?? 'above';
		this.fitToPath = !!data.fitToPath;
		this.flipHorizontal = !!data.flipHorizontal;
		this.flipVertical = !!data.flipVertical;
		this.alignment = data.alignment ?? 'left';
		this.rectanglePointIds = data.rectanglePointIds ? [...data.rectanglePointIds] : undefined;
		this.rectangleLineIds = data.rectangleLineIds ? [...data.rectangleLineIds] : undefined;
		this.targetPrimitiveId = data.targetPrimitiveId;
		this.targetPrimitiveType = data.targetPrimitiveType;
		this.sidebarPanel = new TextInspectorPanel(this);
	}

	clone(): SketchText {
		return new SketchText(this.serialize());
	}

	serialize(): TextSnapshot {
		return {
			type: 'text',
			id: this.id,
			mode: this.mode,
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
			rectanglePointIds: this.rectanglePointIds ? [...this.rectanglePointIds] : undefined,
			rectangleLineIds: this.rectangleLineIds ? [...this.rectangleLineIds] : undefined,
			targetPrimitiveId: this.targetPrimitiveId,
			targetPrimitiveType: this.targetPrimitiveType,
		};
	}

	/**
	 * Returns 4 corners of rectangle in world coordinates if in 'text' mode and valid.
	 */
	getRectangleCorners(sketch: SketchDocument): [Vec2, Vec2, Vec2, Vec2] | null {
		if (this.mode !== 'text' || !this.rectanglePointIds) return null;
		const [p0Id, p1Id, p2Id, p3Id] = this.rectanglePointIds;
		const p0 = sketch.points.get(p0Id);
		const p1 = sketch.points.get(p1Id);
		const p2 = sketch.points.get(p2Id);
		const p3 = sketch.points.get(p3Id);
		if (!p0 || !p1 || !p2 || !p3) return null;
		return [p0.clone(), p1.clone(), p2.clone(), p3.clone()];
	}

	captureRectanglePoints(sketch: SketchDocument): Map<string, Vec2> {
		const initialPoints = new Map<string, Vec2>();
		if (this.rectanglePointIds) {
			for (const pid of this.rectanglePointIds) {
				const pt = sketch.points.get(pid);
				if (pt) initialPoints.set(pid, pt.clone());
			}
		}
		return initialPoints;
	}

	translateRectangle(
		sketch: SketchDocument,
		startWorld: Vec2,
		currentWorld: Vec2,
		initialPoints: ReadonlyMap<string, Vec2>
	): void {
		const dir = new Vec2().subVectors(currentWorld, startWorld);
		for (const [pid, initPos] of initialPoints) {
			const pt = sketch.points.get(pid);
			if (pt) {
				pt.addVectors(initPos, dir);
			}
		}
		sketch.solve();
	}

	rotateRectangleTo(sketch: SketchDocument, centerWorld: Vec2, mouseWorld: Vec2): boolean {
		if (!this.rectanglePointIds) return false;
		const corners = this.getRectangleCorners(sketch);
		if (!corners) return false;
		const [p0, p1, p2, p3] = corners;
		const pt0 = sketch.points.get(this.rectanglePointIds[0]);
		const pt1 = sketch.points.get(this.rectanglePointIds[1]);
		const pt2 = sketch.points.get(this.rectanglePointIds[2]);
		const pt3 = sketch.points.get(this.rectanglePointIds[3]);
		if (!pt0 || !pt1 || !pt2 || !pt3) return false;

		const targetAngle = centerWorld.angleToPoint(mouseWorld) - Math.PI / 2;
		const deltaAngle = targetAngle - p0.angleToPoint(p1);
		pt0.copy(p0.clone().rotateAround(centerWorld, deltaAngle));
		pt1.copy(p1.clone().rotateAround(centerWorld, deltaAngle));
		pt2.copy(p2.clone().rotateAround(centerWorld, deltaAngle));
		pt3.copy(p3.clone().rotateAround(centerWorld, deltaAngle));
		sketch.solve();
		return true;
	}

	/**
	 * Returns distance in screen pixels to this text object.
	 */
	distanceTo(screenPos: Vec2, sketch: SketchDocument, viewport: any): number | null {
		if (this.mode === 'text') {
			const corners = this.getRectangleCorners(sketch);
			if (!corners) return null;
			const [p0, p1, p2, p3] = corners;
			const world = viewport.screenToWorld(screenPos);

			// Test if inside oriented rectangle
			const u = new Vec2().subVectors(p1, p0);
			const v = new Vec2().subVectors(p3, p0);
			const uLenSq = u.lengthSq();
			const vLenSq = v.lengthSq();
			if (uLenSq < 1e-9 || vLenSq < 1e-9) return null;

			const rel = new Vec2().subVectors(world, p0);
			const projU = rel.dot(u) / uLenSq;
			const projV = rel.dot(v) / vLenSq;

			if (projU >= 0 && projU <= 1 && projV >= 0 && projV <= 1) {
				return 0; // Directly inside rectangle
			}

			// Distance to center in screen pixels
			const centerWorld = new Vec2().midpoint(p0, p2);
			const centerScreen = viewport.worldToScreen(centerWorld);
			return screenPos.distanceTo(centerScreen);
		}

		if (this.mode === 'text_on_path' && this.targetPrimitiveId) {
			const prim = sketch.getPrimitive(this.targetPrimitiveId, this.targetPrimitiveType);
			if (prim && typeof (prim as any).distanceTo === 'function') {
				return (prim as any).distanceTo(screenPos, sketch, viewport);
			}
		}

		return null;
	}

	render(opts: TextRenderOptions): TextRenderGizmos {
		const { sketch, viewport, targetGroup, isSelected, color, showGizmos } = opts;
		const hScreen = Math.max(1, this.height * viewport.zoom);
		const fontFam = this.fontFamily || 'Arial, sans-serif';
		const gizmos: TextRenderGizmos = {};

		if (this.mode === 'text') {
			const corners = this.getRectangleCorners(sketch);
			if (!corners) return gizmos;

			const [p0, p1, p2, p3] = corners;
			const cWorld = new Vec2().midpoint(p0, p2);
			const sCenter = viewport.worldToScreen(cWorld);
			const widthWorld = p0.distanceTo(p1);
			const heightWorld = p0.distanceTo(p3);
			const wScreen = widthWorld * viewport.zoom;
			const hBoxScreen = heightWorld * viewport.zoom;

			const angleCad = p0.angleToPoint(p1);
			const angleScreenDeg = (-angleCad * 180) / Math.PI;

			const textG = createSvgElement(
				'g',
				{
					class: `sketch-text-entity ${isSelected ? 'selected' : ''}`,
					transform: `translate(${sCenter.x.toFixed(2)}, ${sCenter.y.toFixed(2)}) rotate(${angleScreenDeg.toFixed(2)})`,
					'data-id': this.id,
					'data-text-id': this.id,
					cursor: 'pointer',
				},
				targetGroup
			);

			createSvgElement(
				'rect',
				{
					x: -wScreen / 2,
					y: -hBoxScreen / 2,
					width: wScreen,
					height: hBoxScreen,
					fill: 'rgba(0, 0, 0, 0.001)',
					'data-id': this.id,
					'data-text-id': this.id,
				},
				textG
			);

			const scaleX = this.flipHorizontal ? -1 : 1;
			const scaleY = this.flipVertical ? -1 : 1;
			const innerG =
				this.flipHorizontal || this.flipVertical
					? createSvgElement('g', { transform: `scale(${scaleX}, ${scaleY})` }, textG)
					: textG;

			let posX = 0;
			let textAnchor = 'middle';
			if (this.alignment === 'left') {
				if (this.flipHorizontal) {
					posX = wScreen / 2 - 4;
					textAnchor = 'end';
				} else {
					posX = -wScreen / 2 + 4;
					textAnchor = 'start';
				}
			} else if (this.alignment === 'right') {
				if (this.flipHorizontal) {
					posX = -wScreen / 2 + 4;
					textAnchor = 'start';
				} else {
					posX = wScreen / 2 - 4;
					textAnchor = 'end';
				}
			}

			const letterSpacingPx = (this.characterSpacing / 100) * hScreen;
			const lines = (this.text || '').split(/\r?\n/);
			const numLines = Math.max(1, lines.length);
			const lineHeightPx = hScreen * 1.25;
			const totalBlockHeightPx = (numLines - 1) * lineHeightPx;

			let startY = 0;
			const vAlign = this.verticalAlignment ?? 'middle';
			if (vAlign === 'top') {
				startY = this.flipVertical ? hBoxScreen / 2 - hScreen / 2 - 3 : -hBoxScreen / 2 + hScreen / 2 + 3;
			} else if (vAlign === 'bottom') {
				startY = this.flipVertical
					? -hBoxScreen / 2 + hScreen / 2 + 3 + totalBlockHeightPx
					: hBoxScreen / 2 - hScreen / 2 - 3 - totalBlockHeightPx;
			} else {
				startY = this.flipVertical ? totalBlockHeightPx / 2 : -totalBlockHeightPx / 2;
			}

			const textEl = createSvgElement(
				'text',
				{
					x: posX,
					y: startY,
					fill: color,
					'font-family': fontFam,
					'font-size': `${hScreen.toFixed(1)}px`,
					'font-weight': this.bold ? 'bold' : 'normal',
					'font-style': this.italic ? 'italic' : 'normal',
					'letter-spacing': `${letterSpacingPx.toFixed(1)}px`,
					'text-anchor': textAnchor,
					'dominant-baseline': 'central',
					'data-id': this.id,
					'data-text-id': this.id,
				},
				innerG
			);

			for (let i = 0; i < lines.length; i++) {
				const lineY = this.flipVertical ? startY - i * lineHeightPx : startY + i * lineHeightPx;
				createSvgElement(
					'tspan',
					{
						x: posX,
						y: lineY.toFixed(1),
						'data-id': this.id,
						'data-text-id': this.id,
					},
					textEl,
					lines[i] || ' '
				);
			}

			if (showGizmos) {
				const stemLen = TEXT_ROTATION_HANDLE_DISTANCE_PX;
				const topEdgeY = -hBoxScreen / 2;
				const handleY = topEdgeY - stemLen;

				createSvgGizmoDashedLine(new Vec2(0, topEdgeY), new Vec2(0, handleY), textG);

				createSvgGizmoCircle(new Vec2(0, handleY), textG);

				const rad = (angleScreenDeg * Math.PI) / 180;
				const handleScreen = new Vec2(0, handleY).rotateAround(ORIGIN, rad).add(sCenter);

				gizmos.rotationGizmo = {
					textId: this.id,
					centerWorld: cWorld,
					handleScreen,
				};

				createSvgGizmoCircle(ORIGIN, textG);

				gizmos.dragGizmo = {
					textId: this.id,
					centerWorld: cWorld,
					centerScreen: sCenter,
				};
			}
		} else if (this.mode === 'text_on_path' && this.targetPrimitiveId) {
			const curve = sketch.toGeoCurve(this.targetPrimitiveId, this.targetPrimitiveType);
			if (!curve) return gizmos;

			const font = getFontSync(this.fontFamily, this.bold, this.italic);
			if (!font) {
				loadFontAsync(this.fontFamily, this.bold, this.italic);
			}

			const pathData = font
				? generateTextSvgPathData(
						{
							mode: 'text_on_path',
							text: this.text,
							height: this.height,
							characterSpacing: this.characterSpacing,
							placement: this.placement,
							fitToPath: this.fitToPath,
							flipHorizontal: this.flipHorizontal,
							flipVertical: this.flipVertical,
							alignment: this.alignment,
							coordSystem: 'cad',
						},
						font,
						curve
					)
				: '';

			if (pathData) {
				const textPathG = createSvgElement(
					'g',
					{
						class: `sketch-text-entity ${isSelected ? 'selected' : ''}`,
						transform: `matrix(${viewport.zoom}, 0, 0, ${-viewport.zoom}, ${viewport.panX.toFixed(2)}, ${viewport.panY.toFixed(2)})`,
						'data-id': this.id,
						'data-text-id': this.id,
						cursor: 'pointer',
					},
					targetGroup
				);

				createSvgElement(
					'path',
					{
						d: pathData,
						fill: color,
						'data-id': this.id,
						'data-text-id': this.id,
						cursor: 'pointer',
					},
					textPathG
				);
			}
		}

		return gizmos;
	}
}

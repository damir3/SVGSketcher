import type { Vec2 } from '../../math/vector';
import { dist, dot, mid, vec } from '../../math/vector';
import type { SketchDocument } from '../sketch';
import type { IInspectable, ISidebarPanel } from '../../ui/panels/inspector/types';
import { TextInspectorPanel } from '../../ui/panels/primitives/textPanel';

export type TextPathTargetType = 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline';

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
		return [vec(p0.x, p0.y), vec(p1.x, p1.y), vec(p2.x, p2.y), vec(p3.x, p3.y)];
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
			const u = vec(p1.x - p0.x, p1.y - p0.y);
			const v = vec(p3.x - p0.x, p3.y - p0.y);
			const uLenSq = dot(u, u);
			const vLenSq = dot(v, v);
			if (uLenSq < 1e-9 || vLenSq < 1e-9) return null;

			const rel = vec(world.x - p0.x, world.y - p0.y);
			const projU = dot(rel, u) / uLenSq;
			const projV = dot(rel, v) / vLenSq;

			if (projU >= 0 && projU <= 1 && projV >= 0 && projV <= 1) {
				return 0; // Directly inside rectangle
			}

			// Distance to center in screen pixels
			const centerWorld = mid(p0, p2);
			const centerScreen = viewport.worldToScreen(centerWorld);
			return dist(screenPos, centerScreen);
		}

		if (this.mode === 'text_on_path' && this.targetPrimitiveId) {
			const prim = sketch.getPrimitive(this.targetPrimitiveId, this.targetPrimitiveType);
			if (prim && typeof (prim as any).distanceTo === 'function') {
				return (prim as any).distanceTo(screenPos, sketch, viewport);
			}
		}

		return null;
	}
}

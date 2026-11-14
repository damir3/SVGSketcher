import { BaseTool } from '../base';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import type { ITool, ToolType } from '../types';
import type { SketchDocument } from '../../../model/sketch';
import type { Viewport } from '../../viewport';
import type { SketchLine, SketchCircle, SketchArc } from '../../../model/types';
import type { IConstraint } from '../../../solver/types';
import { DistanceConstraint, RadiusConstraint } from '../../../solver/constraints';
import { DimensionTool } from '../constraints/dimension';
import { AABB, curveContainedInAABB } from '../../../math/aabb';
import type { GeoCurve } from '../../../math/intersection';
import type { Vec2 } from '../../../math/vector';

export class SelectTool extends BaseTool {
	readonly id = 'select' as const;
	override readonly defaultCursor = 'default';

	override isHighlightEnabled(): boolean {
		return true;
	}

	// Leaving select mode must preserve the current selection so modify tools can
	// initialize their object lists from it. Escape still clears via cancel().
	override deactivate(): void {}

	override canHighlight(target: HoverTarget): boolean {
		return target.id !== 'origin' && target.id !== 'axis_x' && target.id !== 'axis_y';
	}

	override getHighlightClass(_target: HoverTarget): string {
		return 'select-hover';
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: true, allowAxes: false, allowOrigin: false };
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	static performBoxSelection(
		sketch: SketchDocument,
		viewport: Viewport,
		s1: Vec2,
		s2: Vec2,
		shiftKey: boolean,
		activeTool: ToolType,
		tool?: ITool | null
	): void {
		const w1 = viewport.screenToWorld(s1);
		const w2 = viewport.screenToWorld(s2);
		const bounds = AABB.fromPoints([w1, w2])!;
		const { min, max } = bounds;
		const crossing = s2.x < s1.x;
		const matches = (entity: {
			intersectsAABB(min: Vec2, max: Vec2, sketch: SketchDocument): boolean;
			toGeoCurve(sketch: SketchDocument): GeoCurve | null;
		}): boolean => {
			if (crossing) return entity.intersectsAABB(min, max, sketch);
			const curve = entity.toGeoCurve(sketch);
			return curve !== null && curveContainedInAABB(curve, min, max);
		};

		const itemsToSelect: Array<{
			id: string;
			type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline' | 'constraint';
		}> = [];

		const hasToolBoxSelect =
			Boolean(tool?.handleBoxSelect) ||
			activeTool === 'mirror' ||
			activeTool === 'circular_pattern' ||
			activeTool === 'rectangular_pattern';

		for (const pt of sketch.points.values()) {
			if (hasToolBoxSelect && sketch.isSplineHandlePoint(pt.id)) continue;
			if (pt.intersectsAABB(min, max, sketch)) {
				itemsToSelect.push({ id: pt.id, type: 'point' });
			}
		}

		for (const prim of sketch.getCurvePrimitives()) {
			if (hasToolBoxSelect && prim.type === 'line' && (prim as SketchLine).isSplineHandle) continue;
			if (matches(prim)) {
				itemsToSelect.push({ id: prim.id, type: prim.type });
			}
		}

		if (tool?.handleBoxSelect) {
			tool.handleBoxSelect(itemsToSelect);
			return;
		}

		sketch.selectEntities(itemsToSelect, activeTool === 'transform' ? 'toggle' : shiftKey);
	}

	static triggerDimensionEditAt(
		e: MouseEvent,
		screen: Vec2,
		clientPos: Vec2,
		deps: {
			sketch: SketchDocument;
			findConstraintNear: (screen: Vec2) => IConstraint | null;
			findLineNear: (screen: Vec2) => SketchLine | null;
			findCircleNear: (screen: Vec2) => SketchCircle | null;
			findArcNear: (screen: Vec2) => SketchArc | null;
			onEditDimension?: (constraint: any, screenPos: Vec2) => void;
			setTool: (tool: ToolType) => void;
			getActiveToolInstance: () => ITool | null;
			render: () => void;
		}
	): boolean {
		const target = e.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type');

		if (!type || (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'constraint')) {
			const hitConstraint = deps.findConstraintNear(screen);
			if (hitConstraint) {
				id = hitConstraint.id;
				type = 'constraint';
			} else {
				const hitLine = deps.findLineNear(screen);
				if (hitLine) {
					id = hitLine.id;
					type = 'line';
				} else {
					const hitCircle = deps.findCircleNear(screen);
					if (hitCircle) {
						id = hitCircle.id;
						type = 'circle';
					} else {
						const hitArc = deps.findArcNear(screen);
						if (hitArc) {
							id = hitArc.id;
							type = 'arc';
						}
					}
				}
			}
		}

		if (!id || !type) return false;
		const { sketch, onEditDimension, setTool, getActiveToolInstance, render } = deps;

		if (type === 'constraint') {
			const constraint = sketch.constraints.get(id);
			if (constraint?.moveLabelTo && onEditDimension) {
				sketch.selectEntity(constraint.id, 'constraint', false);
				render();
				onEditDimension(constraint, clientPos);
				return true;
			}
		} else if (type === 'line') {
			const line = sketch.lines.get(id);
			if (line) {
				let distConstraint = [...sketch.constraints.values()].find(
					(c): c is DistanceConstraint =>
						c instanceof DistanceConstraint &&
						((c.p1Id === line.p1Id && c.p2Id === line.p2Id) || (c.p1Id === line.p2Id && c.p2Id === line.p1Id))
				);
				if (!distConstraint) {
					distConstraint = sketch.addDistanceConstraint(line.p1Id, line.p2Id) ?? undefined;
				}
				if (distConstraint && onEditDimension) {
					sketch.selectEntity(distConstraint.id, 'constraint', false);
					render();
					onEditDimension(distConstraint, clientPos);
					return true;
				}
			}
		} else if (type === 'circle' || type === 'arc') {
			const entity = sketch.circles.get(id) ?? sketch.arcs.get(id);
			if (entity) {
				const radConstraint = [...sketch.constraints.values()].find(
					(c): c is RadiusConstraint => c instanceof RadiusConstraint && c.circleId === entity.id
				);
				if (!radConstraint) {
					sketch.clearSelection();
					setTool('dimension');
					const activeInstance = getActiveToolInstance();
					if (activeInstance instanceof DimensionTool) {
						activeInstance.beginRadiusPlacement(entity.id, true);
						return true;
					}
				}
				if (radConstraint && onEditDimension) {
					sketch.selectEntity(radConstraint.id, 'constraint', false);
					render();
					onEditDimension(radConstraint, clientPos);
					return true;
				}
			}
		}
		return false;
	}
}

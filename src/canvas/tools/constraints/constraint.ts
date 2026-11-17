import { Vec2 } from '../../../math/vector';
import type { SketchDocument } from '../../../model/sketch';
import type { Viewport } from '../../viewport';
import { findAxisNear } from '../../hitTesting';
import { BaseTool } from '../base';
import type { ConstraintToolType, ToolContext, ToolMouseEvent, ToolType } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';

export class ConstraintTool extends BaseTool {
	readonly id: ConstraintToolType;

	constructor(id: ConstraintToolType) {
		super();
		this.id = id;
	}

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.pruneIncompatibleSelection();
	}

	override cancel(): void {
		this.ctx.sketch.clearSelection();
		this.ctx.requestRender();
	}

	override isHighlightEnabled(): boolean {
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'constraint') return false;
		return this.isEntityCompatibleWithConstraint(target.type as any);
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return {
			allowSplineHandles: true,
			allowOrigin: this.isEntityCompatibleWithConstraint('point'),
			allowAxes: this.isEntityCompatibleWithConstraint('line'),
		};
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		if (this.id === 'dimension') return;

		const screen = e.screen;

		if (this.id === 'fixed') {
			const nearPoint = this.ctx.findPointNear(screen);
			if (nearPoint && nearPoint.id !== 'origin') {
				const isNowFixed = this.ctx.sketch.toggleFixedConstraint(nearPoint.id);
				this.ctx.showToast(isNowFixed ? 'Fixed constraint applied' : 'Fixed constraint removed');
				this.ctx.requestRender();
			} else {
				this.ctx.sketch.clearSelection();
				this.ctx.requestRender();
			}
			return true;
		}

		const target = e.raw.target as SVGElement;
		const targetG = target.closest('[data-id]') as SVGElement | null;
		let id = targetG?.getAttribute('data-id');
		let type = targetG?.getAttribute('data-type') as
			| 'point'
			| 'line'
			| 'circle'
			| 'arc'
			| 'ellipse'
			| 'elliptical_arc'
			| 'spline'
			| undefined;

		if (type && !this.isEntityCompatibleWithConstraint(type)) {
			id = undefined;
			type = undefined;
		}

		// Points ALWAYS have top priority when clicking near a point (if points are applicable)
		const canUsePoints = this.isEntityCompatibleWithConstraint('point');
		const nearPoint = canUsePoints ? this.ctx.findPointNear(screen) : null;
		if (nearPoint) {
			id = nearPoint.id;
			type = 'point';
		} else if (
			!type ||
			(type !== 'point' &&
				type !== 'line' &&
				type !== 'circle' &&
				type !== 'arc' &&
				type !== 'ellipse' &&
				type !== 'elliptical_arc' &&
				type !== 'spline')
		) {
			const hitLine = this.ctx.findLineNear(screen);
			if (hitLine) {
				id = hitLine.id;
				type = 'line';
			} else {
				const hitCircle = this.ctx.findCircleNear(screen);
				if (hitCircle) {
					id = hitCircle.id;
					type = 'circle';
				} else {
					const hitArc = this.ctx.findArcNear(screen);
					if (hitArc) {
						id = hitArc.id;
						type = 'arc';
					} else {
						const hitEllipse = this.ctx.findEllipseNear?.(screen);
						if (hitEllipse) {
							id = hitEllipse.id;
							type = 'ellipse';
						} else {
							const hitEllipticalArc = this.ctx.findEllipticalArcNear?.(screen);
							if (hitEllipticalArc) {
								id = hitEllipticalArc.id;
								type = 'elliptical_arc';
							} else {
								const hitSpline = this.ctx.findSplineNear?.(screen);
								if (hitSpline) {
									id = hitSpline.id;
									type = 'spline';
								} else if (this.isEntityCompatibleWithConstraint('line')) {
									const hitAxis = findAxisNear(this.ctx.sketch, this.ctx.viewport, screen);
									if (hitAxis) {
										id = hitAxis.id;
										type = 'line';
									}
								}
							}
						}
					}
				}
			}
		}

		if (id && type) {
			this.handleConstraintEntityClick(id, type);
			return true;
		}

		return false;
	}

	private handleConstraintEntityClick(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): void {
		const constraintType = this.id;
		if (!this.isEntityCompatibleWithConstraint(type)) {
			return;
		}

		const sel = this.ctx.sketch.selection;
		const isAlreadySelected =
			(type === 'point' && sel.pointIds.has(id)) ||
			(type === 'line' && sel.lineIds.has(id)) ||
			(type === 'circle' && sel.circleIds.has(id)) ||
			(type === 'arc' && sel.arcIds.has(id)) ||
			(type === 'ellipse' && sel.ellipseIds.has(id)) ||
			(type === 'elliptical_arc' && sel.ellipticalArcIds.has(id));

		if (isAlreadySelected) {
			this.deselectEntity(id, type);
			this.ctx.requestRender();
			return;
		}

		// Prune incompatible combinations before adding new item
		switch (constraintType) {
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical': {
				if (type === 'line') {
					sel.pointIds.clear();
					sel.lineIds.clear();
				} else if (type === 'point') {
					sel.lineIds.clear();
					if (sel.pointIds.size >= 2) sel.pointIds.clear();
				}
				break;
			}
			case 'distance': {
				if (type === 'line') {
					if (sel.circleIds.size + sel.arcIds.size !== 1 || sel.lineIds.size > 0 || sel.pointIds.size > 0) {
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
					if (sel.pointIds.size > 1) sel.pointIds.clear();
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) sel.lineIds.clear();
					else if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'circle' || type === 'arc') {
					sel.pointIds.clear();
					if (sel.lineIds.size !== 1 || sel.circleIds.size + sel.arcIds.size > 0) sel.lineIds.clear();
					sel.circleIds.clear();
					sel.arcIds.clear();
				} else if (type === 'point') {
					sel.circleIds.clear();
					sel.arcIds.clear();
					if (sel.lineIds.size > 1) sel.lineIds.clear();
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) sel.pointIds.clear();
					else if (sel.pointIds.size >= 2) sel.pointIds.clear();
				}
				break;
			}
			case 'equal': {
				if (type === 'line') {
					sel.circleIds.clear();
					sel.arcIds.clear();
					if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'circle' || type === 'arc') {
					sel.lineIds.clear();
					if (sel.circleIds.size + sel.arcIds.size >= 2) {
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
				}
				break;
			}
			case 'parallel':
			case 'perpendicular': {
				if (sel.lineIds.size >= 2) sel.lineIds.clear();
				break;
			}
			case 'collinear': {
				if (type === 'line') {
					sel.pointIds.clear();
					if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'point') {
					sel.lineIds.clear();
					if (sel.pointIds.size >= 3) sel.pointIds.clear();
				}
				break;
			}
			case 'concentric': {
				if (sel.circleIds.size + sel.arcIds.size >= 2) {
					sel.circleIds.clear();
					sel.arcIds.clear();
				}
				break;
			}
			case 'coincident': {
				if (type === 'point') {
					if (
						sel.pointIds.size >= 2 ||
						(sel.pointIds.size >= 1 &&
							(sel.lineIds.size >= 1 ||
								sel.circleIds.size + sel.arcIds.size >= 1 ||
								sel.ellipseIds.size + sel.ellipticalArcIds.size >= 1 ||
								sel.splineIds.size >= 1))
					) {
						sel.pointIds.clear();
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
						sel.ellipseIds.clear();
						sel.ellipticalArcIds.clear();
						sel.splineIds.clear();
					}
				} else if (
					type === 'line' ||
					type === 'circle' ||
					type === 'arc' ||
					type === 'ellipse' ||
					type === 'elliptical_arc' ||
					type === 'spline'
				) {
					if (
						sel.lineIds.size >= 1 ||
						sel.circleIds.size + sel.arcIds.size >= 1 ||
						sel.ellipseIds.size + sel.ellipticalArcIds.size >= 1 ||
						sel.splineIds.size >= 1 ||
						sel.pointIds.size >= 2
					) {
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
						sel.ellipseIds.clear();
						sel.ellipticalArcIds.clear();
						sel.splineIds.clear();
						if (sel.pointIds.size >= 2) sel.pointIds.clear();
					}
				}
				break;
			}
			case 'tangent': {
				if (type === 'line') {
					if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 2) {
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
				} else if (type === 'circle' || type === 'arc') {
					if (
						sel.circleIds.size + sel.arcIds.size >= 2 ||
						(sel.lineIds.size >= 1 && sel.circleIds.size + sel.arcIds.size >= 1)
					) {
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
				}
				break;
			}
			case 'point_on_line': {
				if (type === 'point' && sel.pointIds.size >= 1) {
					sel.pointIds.clear();
				} else if (type === 'line' && sel.lineIds.size >= 1) {
					sel.lineIds.clear();
				}
				break;
			}
			case 'midpoint': {
				if (type === 'point') {
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) {
						sel.pointIds.clear();
					} else if (sel.lineIds.size === 0) {
						if (sel.pointIds.size >= 3) {
							sel.pointIds.clear();
						}
					}
				} else if (type === 'line') {
					if (sel.lineIds.size >= 1) sel.lineIds.clear();
					if (sel.pointIds.size > 1) sel.pointIds.clear();
				}
				break;
			}
			case 'symmetry': {
				if (type === 'point') {
					if (id === 'origin') {
						if (sel.circleIds.size + sel.arcIds.size > 0) {
							sel.pointIds.clear();
							sel.lineIds.clear();
						} else if (sel.lineIds.size > 0) {
							sel.lineIds.delete('axis_x');
							sel.lineIds.delete('axis_y');
							if (sel.lineIds.size > 2) sel.lineIds.clear();
							sel.pointIds.clear();
						} else if (sel.pointIds.size >= 3) {
							sel.pointIds.clear();
						}
					} else {
						sel.circleIds.clear();
						sel.arcIds.clear();
						if (sel.lineIds.size > 1) {
							sel.lineIds.clear();
						}
						if (sel.lineIds.size === 1) {
							sel.pointIds.delete('origin');
							if (sel.pointIds.size >= 2) sel.pointIds.clear();
						} else if (sel.pointIds.size >= 3 || (sel.pointIds.size >= 2 && !sel.pointIds.has('origin'))) {
							sel.pointIds.clear();
						}
					}
				} else if (type === 'line') {
					if (id === 'axis_x' || id === 'axis_y') {
						sel.lineIds.delete('axis_x');
						sel.lineIds.delete('axis_y');
					}
					if (sel.circleIds.size + sel.arcIds.size > 0) {
						sel.pointIds.clear();
						if (sel.lineIds.size >= 1) sel.lineIds.clear();
					} else if (sel.pointIds.size > 0) {
						if (sel.pointIds.size === 1 && sel.pointIds.has('origin') && id !== 'axis_x' && id !== 'axis_y') {
							if (sel.lineIds.size >= 2) sel.lineIds.clear();
						} else {
							sel.pointIds.delete('origin');
							if (sel.lineIds.size >= 1) sel.lineIds.clear();
							if (sel.pointIds.size > 2) sel.pointIds.clear();
						}
					} else if (sel.lineIds.size >= 3) {
						sel.lineIds.clear();
					}
				} else if (type === 'circle' || type === 'arc') {
					if (sel.pointIds.size > 1 || (sel.pointIds.size === 1 && !sel.pointIds.has('origin'))) {
						sel.pointIds.clear();
					}
					if (sel.lineIds.size > 1) {
						sel.lineIds.clear();
					}
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) {
						sel.pointIds.clear();
					}
					if (sel.circleIds.size + sel.arcIds.size >= 2) {
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
				}
				break;
			}
		}

		this.ctx.sketch.selectEntity(id, type, true);

		if (this.canApplyConstraint(constraintType)) {
			const applied = this.applyConstraint(constraintType);
			if (applied) {
				this.ctx.sketch.clearSelection();
			}
		}

		this.ctx.requestRender();
	}

	private deselectEntity(
		id: string,
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): void {
		const sel = this.ctx.sketch.selection;
		if (type === 'point') sel.pointIds.delete(id);
		else if (type === 'line') sel.lineIds.delete(id);
		else if (type === 'circle') sel.circleIds.delete(id);
		else if (type === 'arc') sel.arcIds.delete(id);
		else if (type === 'ellipse') sel.ellipseIds.delete(id);
		else if (type === 'elliptical_arc') sel.ellipticalArcIds.delete(id);
		else if (type === 'spline') sel.splineIds.delete(id);
	}

	private pruneIncompatibleSelection(): void {
		ConstraintTool.pruneIncompatibleSelection(this.ctx.sketch, this.id);
	}

	static pruneIncompatibleSelection(sketch: SketchDocument, type: string): void {
		const sel = sketch.selection;
		switch (type) {
			case 'fixed': {
				sel.lineIds.clear();
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'coincident': {
				if (sel.lineIds.size > 0 && sel.circleIds.size + sel.arcIds.size > 0) {
					sel.circleIds.clear();
					sel.arcIds.clear();
				}
				break;
			}
			case 'parallel':
			case 'perpendicular': {
				sel.pointIds.clear();
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'collinear': {
				if (sel.lineIds.size > 0) {
					sel.pointIds.clear();
				}
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'concentric': {
				sel.pointIds.clear();
				sel.lineIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'tangent': {
				sel.pointIds.clear();
				if (sel.lineIds.size > 1) sel.lineIds.clear();
				if (sel.circleIds.size + sel.arcIds.size > 2) {
					sel.circleIds.clear();
					sel.arcIds.clear();
				}
				break;
			}
			case 'point_on_line':
			case 'midpoint': {
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical': {
				if (sel.lineIds.size > 0) {
					sel.pointIds.clear();
				}
				sel.circleIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'equal': {
				if (sel.lineIds.size > 0) {
					sel.circleIds.clear();
				} else if (sel.circleIds.size > 0) {
					sel.lineIds.clear();
				}
				sel.pointIds.clear();
				sel.arcIds.clear();
				break;
			}
			case 'dimension':
			case 'distance': {
				break;
			}
		}
		if (sel.lineIds.size > 0 && sel.pointIds.size > 0) {
			for (const lid of sel.lineIds) {
				const l = sketch.lines.get(lid);
				if (l) {
					sel.pointIds.delete(l.p1Id);
					sel.pointIds.delete(l.p2Id);
				}
			}
		}
		if (type !== 'coincident') {
			sel.ellipseIds.clear();
			sel.ellipticalArcIds.clear();
			sel.splineIds.clear();
		}
		sel.constraintIds.clear();
	}

	private isEntityCompatibleWithConstraint(
		entityType: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): boolean {
		switch (this.id) {
			case 'fixed':
				return entityType === 'point';
			case 'coincident':
				return (
					entityType === 'point' ||
					entityType === 'line' ||
					entityType === 'circle' ||
					entityType === 'arc' ||
					entityType === 'ellipse' ||
					entityType === 'elliptical_arc' ||
					entityType === 'spline'
				);
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return entityType === 'line' || entityType === 'point';
			case 'dimension':
			case 'distance':
				return entityType === 'line' || entityType === 'point' || entityType === 'circle' || entityType === 'arc';
			case 'equal':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'parallel':
			case 'perpendicular':
				return entityType === 'line';
			case 'collinear':
				return entityType === 'line' || entityType === 'point';
			case 'tangent':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'concentric':
				return entityType === 'circle' || entityType === 'arc';
			case 'point_on_line':
			case 'midpoint':
				return entityType === 'point' || entityType === 'line';
			case 'symmetry':
				return entityType === 'point' || entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			default:
				return false;
		}
	}

	private canApplyConstraint(type: string): boolean {
		return ConstraintTool.canApplyConstraint(this.ctx.sketch, type);
	}

	static canApplyConstraint(sketch: SketchDocument, type: string): boolean {
		const sel = sketch.selection;
		const pCount = sel.pointIds.size;
		const lCount = sel.lineIds.size;
		const cCount = sel.circleIds.size + sel.arcIds.size;
		const eCount = sel.ellipseIds.size + sel.ellipticalArcIds.size;
		const sCount = sel.splineIds.size;

		switch (type) {
			case 'fixed':
				return pCount >= 1;
			case 'coincident':
				return (
					pCount >= 2 ||
					(pCount === 1 && lCount === 1 && cCount === 0 && eCount === 0 && sCount === 0) ||
					(pCount === 1 && cCount === 1 && lCount === 0 && eCount === 0 && sCount === 0) ||
					(pCount === 1 && eCount === 1 && lCount === 0 && cCount === 0 && sCount === 0) ||
					(pCount === 1 && sCount === 1 && lCount === 0 && cCount === 0 && eCount === 0)
				);
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return (lCount === 1 && pCount === 0 && cCount === 0) || (pCount === 2 && lCount === 0 && cCount === 0);
			case 'dimension':
			case 'distance':
				return (
					(lCount === 1 && pCount === 0 && cCount === 0) ||
					(lCount === 2 && pCount === 0 && cCount === 0) ||
					(pCount === 2 && lCount === 0 && cCount === 0) ||
					(pCount === 3 && lCount === 0 && cCount === 0) ||
					(cCount === 1 && pCount === 0 && lCount === 0) ||
					(cCount === 2 &&
						pCount === 0 &&
						lCount === 0 &&
						sketch.canAddCircleDistanceConstraint(...([...sel.circleIds, ...sel.arcIds] as [string, string]))) ||
					(lCount === 1 && pCount === 1 && cCount === 0) ||
					(lCount === 1 &&
						pCount === 0 &&
						cCount === 1 &&
						sketch.canAddCircleToLineDistanceConstraint([...sel.circleIds, ...sel.arcIds][0], [...sel.lineIds][0]))
				);
			case 'equal':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (cCount === 2 && pCount === 0 && lCount === 0);
			case 'parallel':
			case 'perpendicular':
				return lCount === 2 && pCount === 0 && cCount === 0;
			case 'collinear':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (pCount === 3 && lCount === 0 && cCount === 0);
			case 'tangent':
				return ((lCount === 1 && cCount === 1) || (cCount === 2 && lCount === 0)) && pCount === 0;
			case 'concentric':
				return cCount === 2 && pCount === 0 && lCount === 0;
			case 'point_on_line':
				return pCount === 1 && lCount === 1 && cCount === 0;
			case 'midpoint':
				return (pCount === 1 && lCount === 1 && cCount === 0) || (pCount === 3 && lCount === 0 && cCount === 0);
			case 'symmetry':
				return (
					(pCount === 2 && lCount === 1 && cCount === 0) ||
					(pCount === 3 && sel.pointIds.has('origin') && lCount === 0 && cCount === 0) ||
					(cCount === 2 && lCount === 1 && pCount === 0) ||
					(cCount === 2 && pCount === 1 && sel.pointIds.has('origin') && lCount === 0) ||
					(lCount === 3 && pCount === 0 && cCount === 0) ||
					(lCount === 2 &&
						pCount === 1 &&
						sel.pointIds.has('origin') &&
						!sel.lineIds.has('axis_x') &&
						!sel.lineIds.has('axis_y') &&
						cCount === 0)
				);
			default:
				return false;
		}
	}

	private applyConstraint(type: string): boolean {
		return ConstraintTool.applyConstraintToSelection(type, {
			sketch: this.ctx.sketch,
			viewport: this.ctx.viewport,
			svg: this.ctx.svg,
			showToast: this.ctx.showToast,
			setTool: this.ctx.setTool,
		});
	}

	static applyConstraintToSelection(
		type: string,
		opts: {
			sketch: SketchDocument;
			viewport?: Viewport;
			svg?: SVGSVGElement;
			showToast: (msg: string) => void;
			requestRender?: () => void;
			setTool?: (tool: ToolType) => void;
			onEditDimension?: (constraint: any, screenPos: Vec2) => void;
		}
	): boolean {
		const { sketch } = opts;
		const sel = sketch.selection;
		const pIds = [...sel.pointIds];
		const lIds = [...sel.lineIds];
		const cIds = [...sel.circleIds, ...sel.arcIds];
		const eIds = [...sel.ellipseIds, ...sel.ellipticalArcIds];
		const sIds = [...sel.splineIds];

		let applied = false;
		let toastMsg = '';

		const openDimensionEditor = (
			c: { getLabelScreenPos?(sketch: SketchDocument, viewport: Viewport): Vec2 | null } | null
		) => {
			if (!c || !opts.onEditDimension || !opts.viewport || !opts.svg) return;
			const s = c.getLabelScreenPos?.(sketch, opts.viewport);
			if (!s) return;
			const rect = opts.svg.getBoundingClientRect();
			opts.onEditDimension(c, new Vec2(rect.left + s.x, rect.top + s.y));
		};

		switch (type) {
			case 'fixed': {
				if (pIds.length >= 1) {
					const appliedNow = sketch.toggleFixedConstraints(pIds);
					applied = true;
					toastMsg = appliedNow ? 'Fixed constraint applied' : 'Fixed constraint removed';
				}
				break;
			}
			case 'coincident': {
				if (pIds.length >= 2) {
					applied = sketch.addCoincidentConstraints(pIds);
					if (applied) {
						toastMsg = pIds.includes('origin') ? 'Coincident with (0,0) applied' : 'Coincident constraint applied';
					} else {
						opts.showToast('Cannot make these points coincident');
					}
				} else if (
					pIds.length === 1 &&
					lIds.length === 1 &&
					cIds.length === 0 &&
					eIds.length === 0 &&
					sIds.length === 0
				) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const c = sketch.addPointOnAxisConstraint(pIds[0], axis);
						if (c) {
							applied = true;
							toastMsg = `Point constrained to ${axis.toUpperCase()}-axis`;
						}
					} else {
						const c = sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
						if (c) {
							applied = true;
							toastMsg = 'Point on line constraint applied';
						} else {
							opts.showToast('Cannot constrain point to this line');
						}
					}
				} else if (
					pIds.length === 1 &&
					cIds.length === 1 &&
					lIds.length === 0 &&
					eIds.length === 0 &&
					sIds.length === 0
				) {
					const c = sketch.addPointOnCircleConstraint(pIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on circle constraint applied';
					} else {
						opts.showToast('Cannot constrain point to this circle/arc');
					}
				} else if (
					pIds.length === 1 &&
					eIds.length === 1 &&
					lIds.length === 0 &&
					cIds.length === 0 &&
					sIds.length === 0
				) {
					const c = sketch.addPointOnEllipseConstraint(pIds[0], eIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on ellipse constraint applied';
					} else {
						opts.showToast('Cannot constrain point to this ellipse');
					}
				} else if (
					pIds.length === 1 &&
					sIds.length === 1 &&
					lIds.length === 0 &&
					cIds.length === 0 &&
					eIds.length === 0
				) {
					const c = sketch.addPointOnSplineConstraint(pIds[0], sIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on spline constraint applied';
					} else {
						opts.showToast('Cannot constrain point to this spline');
					}
				}
				break;
			}
			case 'horizontal_vertical': {
				if (lIds.length === 1) {
					const l = sketch.lines.get(lIds[0])!;
					const p1 = sketch.points.get(l.p1Id);
					const p2 = sketch.points.get(l.p2Id);
					if (p1 && p2) {
						const dir = new Vec2().subVectors(p2, p1);
						if (Math.abs(dir.x) >= Math.abs(dir.y)) {
							sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							sketch.addVerticalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				} else if (pIds.length === 2) {
					const p1 = sketch.points.get(pIds[0]);
					const p2 = sketch.points.get(pIds[1]);
					if (p1 && p2) {
						const dir = new Vec2().subVectors(p2, p1);
						if (Math.abs(dir.x) >= Math.abs(dir.y)) {
							sketch.addHorizontalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							sketch.addVerticalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				}
				break;
			}
			case 'horizontal': {
				if (lIds.length === 1) {
					const l = sketch.lines.get(lIds[0])!;
					sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				} else if (pIds.length === 2) {
					sketch.addHorizontalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				}
				break;
			}
			case 'vertical': {
				if (lIds.length === 1) {
					const l = sketch.lines.get(lIds[0])!;
					sketch.addVerticalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				} else if (pIds.length === 2) {
					sketch.addVerticalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				}
				break;
			}
			case 'dimension':
			case 'distance': {
				if (
					opts.setTool &&
					lIds.length === 1 &&
					((pIds.length === 1 && cIds.length === 0) || (pIds.length === 0 && cIds.length === 1))
				) {
					opts.setTool('dimension');
					return true;
				}
				if (lIds.length === 1 && pIds.length === 0 && cIds.length === 1) {
					const c = sketch.addCircleToLineDistanceConstraint(cIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Center-to-line distance constraint applied';
						openDimensionEditor(c);
					}
				} else if (lIds.length === 1 && pIds.length === 1) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const existed = sketch.hasPointToAxisConstraint(pIds[0], axis);
						const c = sketch.addPointToAxisDistanceConstraint(pIds[0], axis);
						applied = true;
						toastMsg = existed
							? `Editing distance to ${axis.toUpperCase()}-axis`
							: `Distance to ${axis.toUpperCase()}-axis applied`;
						openDimensionEditor(c);
					} else {
						const l = sketch.lines.get(lIds[0])!;
						if (pIds[0] !== l.p1Id && pIds[0] !== l.p2Id) {
							const existed = sketch.hasPointToLineDistanceConstraint(pIds[0], lIds[0]);
							const c = sketch.addPointToLineDistanceConstraint(pIds[0], lIds[0]);
							applied = true;
							toastMsg = existed
								? 'Editing point-to-line distance constraint'
								: 'Point-to-line distance constraint applied';
							openDimensionEditor(c);
						}
					}
				} else if (lIds.length === 1 && pIds.length === 0) {
					const l = sketch.lines.get(lIds[0])!;
					const existed = sketch.hasDistanceConstraint(l.p1Id, l.p2Id);
					const c = sketch.addDistanceConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
					openDimensionEditor(c);
				} else if (lIds.length === 2) {
					const existed = sketch.hasAngleConstraint(lIds[0], lIds[1]);
					const c = sketch.addAngleConstraint(lIds[0], lIds[1]);
					if (c) {
						applied = true;
						toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
						openDimensionEditor(c);
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const existed = sketch.hasThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]);
					const c = sketch.addThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = existed ? 'Editing angle constraint' : 'Angle constraint applied';
						openDimensionEditor(c);
					}
				} else if (pIds.length === 2) {
					if (pIds.includes('origin')) {
						const userPtId = pIds[0] === 'origin' ? pIds[1] : pIds[0];
						const existed = sketch.hasOriginConstraint(userPtId);
						const c = sketch.addOriginDistanceConstraint(userPtId);
						applied = true;
						toastMsg = existed ? 'Editing distance to (0,0)' : 'Distance to (0,0) applied';
						openDimensionEditor(c);
					} else {
						const existed = sketch.hasDistanceConstraint(pIds[0], pIds[1]);
						const c = sketch.addDistanceConstraint(pIds[0], pIds[1]);
						applied = true;
						toastMsg = existed ? 'Editing distance constraint' : 'Distance constraint applied';
						openDimensionEditor(c);
					}
				} else if (cIds.length === 2 && lIds.length === 0 && pIds.length === 0) {
					const c = sketch.addCircleDistanceConstraint(cIds[0], cIds[1]);
					if (c) {
						applied = true;
						toastMsg = 'Radial distance constraint applied';
						openDimensionEditor(c);
					}
				} else if (cIds.length === 1) {
					if (!sketch.hasRadiusConstraint(cIds[0])) {
						opts.setTool?.('dimension');
						return true;
					}
					const c = sketch.addRadiusConstraint(cIds[0]);
					applied = true;
					toastMsg = 'Editing radius constraint';
					openDimensionEditor(c);
				}
				break;
			}
			case 'equal': {
				if (lIds.length === 2) {
					sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Equal length constraint applied';
				} else if (cIds.length === 2) {
					sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Equal radius constraint applied';
				}
				break;
			}
			case 'parallel': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const line = sketch.lines.get(userLineId);
						if (line) {
							if (axis === 'x') {
								sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
							} else {
								sketch.addVerticalConstraint(line.p1Id, line.p2Id);
							}
							applied = true;
							toastMsg = `Parallel to ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						sketch.addParallelConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Parallel constraint applied';
					}
				}
				break;
			}
			case 'perpendicular': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const line = sketch.lines.get(userLineId);
						if (line) {
							if (axis === 'x') {
								sketch.addVerticalConstraint(line.p1Id, line.p2Id);
							} else {
								sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
							}
							applied = true;
							toastMsg = `Perpendicular to ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Perpendicular constraint applied';
					}
				}
				break;
			}
			case 'collinear': {
				if (lIds.length === 2) {
					if (lIds.includes('axis_x') || lIds.includes('axis_y')) {
						if (lIds.includes('axis_x') && lIds.includes('axis_y')) break;
						const axis = lIds.includes('axis_x') ? 'x' : 'y';
						const userLineId = lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0];
						const c = sketch.addLineCollinearWithAxisConstraint(userLineId, axis);
						if (c) {
							applied = true;
							toastMsg = `Collinear with ${axis.toUpperCase()}-axis applied`;
						}
					} else {
						sketch.addCollinearConstraint(lIds[0], lIds[1]);
						applied = true;
						toastMsg = 'Collinear constraint applied';
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const c = sketch.addThreePointCollinearConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = 'Collinear constraint applied';
					}
				}
				break;
			}
			case 'concentric': {
				if (cIds.length === 2) {
					sketch.addConcentricConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Concentric constraint applied';
				}
				break;
			}
			case 'tangent': {
				if (lIds.length === 1 && cIds.length === 1) {
					const c = sketch.addTangentConstraint(lIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Tangent constraint applied';
					}
				} else if (cIds.length === 2 && lIds.length === 0) {
					const c = sketch.addTangentConstraint(cIds[0], cIds[1]);
					if (c) {
						applied = true;
						toastMsg = 'Tangent constraint applied';
					}
				}
				break;
			}
			case 'point_on_line': {
				if (pIds.length === 1 && lIds.length === 1) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const c = sketch.addPointOnAxisConstraint(pIds[0], axis);
						if (c) {
							applied = true;
							toastMsg = `Point constrained to ${axis.toUpperCase()}-axis`;
						}
					} else {
						const c = sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
						if (c) {
							applied = true;
							toastMsg = 'Point on line constraint applied';
						} else {
							opts.showToast('Cannot constrain point to this line');
						}
					}
				}
				break;
			}
			case 'midpoint': {
				if (pIds.length === 1 && lIds.length === 1) {
					const c = sketch.addMidpointConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Midpoint constraint applied';
					} else {
						opts.showToast('Cannot constrain midpoint to this line');
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					const c = sketch.addThreePointMidpointConstraint(pIds[0], pIds[1], pIds[2]);
					if (c) {
						applied = true;
						toastMsg = 'Midpoint constraint applied';
					}
				}
				break;
			}
			case 'symmetry': {
				if (pIds.length === 2 && lIds.length === 1) {
					const c = sketch.addSymmetryConstraint(pIds[0], pIds[1], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Symmetry constraint applied';
					} else {
						opts.showToast('Cannot apply symmetry to these entities');
					}
				} else if (pIds.length === 3 && pIds.includes('origin') && lIds.length === 0) {
					const userPts = pIds.filter(id => id !== 'origin');
					const c = sketch.addSymmetryConstraint(userPts[0], userPts[1], 'origin');
					if (c) {
						applied = true;
						toastMsg = 'Symmetry constraint applied';
					}
				} else if (cIds.length === 2 && (lIds.length === 1 || (pIds.length === 1 && pIds[0] === 'origin'))) {
					const symAxisId = lIds.length === 1 ? lIds[0] : 'origin';
					const c1 = sketch.circles.get(cIds[0]) ?? sketch.arcs.get(cIds[0]);
					const c2 = sketch.circles.get(cIds[1]) ?? sketch.arcs.get(cIds[1]);
					if (c1 && c2) {
						sketch.beginTransaction();
						sketch.addSymmetryConstraint(c1.centerId, c2.centerId, symAxisId);
						sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
						sketch.commitTransaction();
						applied = true;
						toastMsg = 'Symmetry & equal radius applied';
					}
				} else if (lIds.length === 3) {
					const builtinAxisIdx = lIds.findIndex(id => id === 'axis_x' || id === 'axis_y');
					const constrIdx = lIds.findIndex(id => sketch.lines.get(id)?.isConstruction);
					const axisId = builtinAxisIdx !== -1 ? lIds[builtinAxisIdx] : constrIdx !== -1 ? lIds[constrIdx] : lIds[2];
					const otherLines = lIds.filter(id => id !== axisId);
					if (otherLines.length === 2) {
						const created = sketch.addLineSymmetryConstraints(otherLines[0], otherLines[1], axisId);
						if (created.length > 0) {
							applied = true;
							toastMsg = 'Line symmetry constraints applied';
						}
					}
				} else if (lIds.length === 2 && pIds.length === 1 && pIds[0] === 'origin') {
					const created = sketch.addLineSymmetryConstraints(lIds[0], lIds[1], 'origin');
					if (created.length > 0) {
						applied = true;
						toastMsg = 'Line symmetry constraints applied';
					}
				}
				break;
			}
		}

		if (applied) {
			if (toastMsg) opts.showToast(toastMsg);
			sketch.solve();
			opts.requestRender?.();
		}

		return applied;
	}
}

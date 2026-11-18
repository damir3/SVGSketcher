import { Vec2 } from '../../../math/vector';
import type { SketchDocument } from '../../../model/sketch';
import { deselectEntity, SELECTION_KEYS } from '../../../model/selection';
import type { Viewport } from '../../viewport';
import { findAxisNear } from '../../hitTesting';
import { BaseTool } from '../base';
import type { ConstraintToolType, ToolContext, ToolMouseEvent, ToolType } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';

const COMPATIBLE_ENTITY_TYPES: Record<string, ReadonlySet<string>> = {
	fixed: new Set(['point']),
	coincident: new Set(['point', 'line', 'circle', 'arc', 'ellipse', 'elliptical_arc', 'spline']),
	horizontal_vertical: new Set(['line', 'point']),
	horizontal: new Set(['line', 'point']),
	vertical: new Set(['line', 'point']),
	dimension: new Set(['line', 'point', 'circle', 'arc']),
	distance: new Set(['line', 'point', 'circle', 'arc']),
	equal: new Set(['line', 'circle', 'arc']),
	parallel: new Set(['line']),
	perpendicular: new Set(['line']),
	collinear: new Set(['line', 'point']),
	tangent: new Set(['line', 'circle', 'arc']),
	concentric: new Set(['circle', 'arc']),
	point_on_line: new Set(['point', 'line']),
	midpoint: new Set(['point', 'line']),
	symmetry: new Set(['point', 'line', 'circle', 'arc']),
};

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
		} else if (!type || !COMPATIBLE_ENTITY_TYPES.coincident.has(type)) {
			const hitFinders: Array<
				['line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline', () => { id: string } | null | undefined]
			> = [
				['line', () => this.ctx.findLineNear(screen)],
				['circle', () => this.ctx.findCircleNear(screen)],
				['arc', () => this.ctx.findArcNear(screen)],
				['ellipse', () => this.ctx.findEllipseNear?.(screen)],
				['elliptical_arc', () => this.ctx.findEllipticalArcNear?.(screen)],
				['spline', () => this.ctx.findSplineNear?.(screen)],
			];
			for (const [candidateType, find] of hitFinders) {
				const hit = find();
				if (hit) {
					id = hit.id;
					type = candidateType;
					break;
				}
			}
			if (!id && this.isEntityCompatibleWithConstraint('line')) {
				const hitAxis = findAxisNear(this.ctx.sketch, this.ctx.viewport, screen);
				if (hitAxis) {
					id = hitAxis.id;
					type = 'line';
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
		const isAlreadySelected = this.ctx.sketch.isEntitySelected(id, type);

		if (isAlreadySelected) {
			this.deselectEntity(id, type);
			this.ctx.requestRender();
			return;
		}

		const clearRadial = () => {
			sel.circleIds.clear();
			sel.arcIds.clear();
		};

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
						clearRadial();
					}
					if (sel.pointIds.size > 1) sel.pointIds.clear();
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) sel.lineIds.clear();
					else if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'circle' || type === 'arc') {
					sel.pointIds.clear();
					if (sel.lineIds.size !== 1 || sel.circleIds.size + sel.arcIds.size > 0) sel.lineIds.clear();
					clearRadial();
				} else if (type === 'point') {
					clearRadial();
					if (sel.lineIds.size > 1) sel.lineIds.clear();
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) sel.pointIds.clear();
					else if (sel.pointIds.size >= 2) sel.pointIds.clear();
				}
				break;
			}
			case 'equal': {
				if (type === 'line') {
					clearRadial();
					if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'circle' || type === 'arc') {
					sel.lineIds.clear();
					if (sel.circleIds.size + sel.arcIds.size >= 2) clearRadial();
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
				if (sel.circleIds.size + sel.arcIds.size >= 2) clearRadial();
				break;
			}
			case 'coincident': {
				const hasCurve =
					sel.lineIds.size >= 1 ||
					sel.circleIds.size + sel.arcIds.size >= 1 ||
					sel.ellipseIds.size + sel.ellipticalArcIds.size >= 1 ||
					sel.splineIds.size >= 1;
				const clearCurves = () => {
					sel.lineIds.clear();
					clearRadial();
					sel.ellipseIds.clear();
					sel.ellipticalArcIds.clear();
					sel.splineIds.clear();
				};
				if (type === 'point') {
					if (sel.pointIds.size >= 2 || (sel.pointIds.size >= 1 && hasCurve)) {
						sel.pointIds.clear();
						clearCurves();
					}
				} else if (hasCurve || sel.pointIds.size >= 2) {
					clearCurves();
					if (sel.pointIds.size >= 2) sel.pointIds.clear();
				}
				break;
			}
			case 'tangent': {
				if (type === 'line') {
					if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 2) {
						sel.lineIds.clear();
						clearRadial();
					}
				} else if (type === 'circle' || type === 'arc') {
					if (
						sel.circleIds.size + sel.arcIds.size >= 2 ||
						(sel.lineIds.size >= 1 && sel.circleIds.size + sel.arcIds.size >= 1)
					) {
						sel.lineIds.clear();
						clearRadial();
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
		deselectEntity(this.ctx.sketch, id, type, false);
	}

	private pruneIncompatibleSelection(): void {
		ConstraintTool.pruneIncompatibleSelection(this.ctx.sketch, this.id);
	}

	static pruneIncompatibleSelection(sketch: SketchDocument, type: string): void {
		const sel = sketch.selection;
		const allowed = COMPATIBLE_ENTITY_TYPES[type];
		for (const primType of ['point', 'line', 'circle', 'arc', 'ellipse', 'elliptical_arc', 'spline'] as const) {
			if (
				allowed
					? !allowed.has(primType)
					: primType === 'ellipse' || primType === 'elliptical_arc' || primType === 'spline'
			) {
				sel[SELECTION_KEYS[primType]].clear();
			}
		}
		if (type === 'coincident' && sel.lineIds.size > 0) {
			sel.circleIds.clear();
			sel.arcIds.clear();
		} else if (
			(type === 'collinear' || type === 'horizontal_vertical' || type === 'horizontal' || type === 'vertical') &&
			sel.lineIds.size > 0
		) {
			sel.pointIds.clear();
		} else if (type === 'tangent') {
			if (sel.lineIds.size > 1) sel.lineIds.clear();
			if (sel.circleIds.size + sel.arcIds.size > 2) {
				sel.circleIds.clear();
				sel.arcIds.clear();
			}
		} else if (type === 'equal') {
			if (sel.lineIds.size > 0) {
				sel.circleIds.clear();
				sel.arcIds.clear();
			} else if (sel.circleIds.size + sel.arcIds.size > 0) {
				sel.lineIds.clear();
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
		sel.constraintIds.clear();
	}

	private isEntityCompatibleWithConstraint(
		entityType: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' | 'spline'
	): boolean {
		return COMPATIBLE_ENTITY_TYPES[this.id]?.has(entityType) ?? false;
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
				return pCount >= 2 || (pCount === 1 && lCount + cCount + eCount + sCount === 1);
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
		const applyDim = (c: any, appliedMsg: string, editingMsg?: string, existed = false) => {
			if (!c) return;
			applied = true;
			toastMsg = existed && editingMsg ? editingMsg : appliedMsg;
			openDimensionEditor(c);
		};
		const applyResult = (res: unknown, okMsg: string, failMsg?: string) => {
			if (res) {
				applied = true;
				toastMsg = okMsg;
			} else if (failMsg) {
				opts.showToast(failMsg);
			}
		};
		const applyDistancePair = (p1Id: string, p2Id: string) =>
			applyDim(
				sketch.addDistanceConstraint(p1Id, p2Id),
				'Distance constraint applied',
				'Editing distance constraint',
				sketch.hasDistanceConstraint(p1Id, p2Id)
			);
		const resolveAxisLine = (): { axis: 'x' | 'y'; userLineId: string } | null => {
			const hasX = lIds.includes('axis_x');
			const hasY = lIds.includes('axis_y');
			if (!hasX && !hasY) return null;
			if (hasX && hasY) return { axis: 'x', userLineId: '' };
			return {
				axis: hasX ? 'x' : 'y',
				userLineId: lIds[0] === 'axis_x' || lIds[0] === 'axis_y' ? lIds[1] : lIds[0],
			};
		};
		const applyLineSymmetry = (l1: string, l2: string, axisId: string) =>
			applyResult(sketch.addLineSymmetryConstraints(l1, l2, axisId).length > 0, 'Line symmetry constraints applied');
		const applyPointOnLineOrAxis = (pointId: string, lineId: string) => {
			if (lineId === 'axis_x' || lineId === 'axis_y') {
				const axis = lineId === 'axis_x' ? 'x' : 'y';
				applyResult(sketch.addPointOnAxisConstraint(pointId, axis), `Point constrained to ${axis.toUpperCase()}-axis`);
			} else {
				applyResult(
					sketch.addPointOnLineConstraint(pointId, lineId),
					'Point on line constraint applied',
					'Cannot constrain point to this line'
				);
			}
		};

		switch (type) {
			case 'fixed': {
				if (pIds.length >= 1) {
					const appliedNow = sketch.toggleFixedConstraints(pIds);
					applyResult(true, appliedNow ? 'Fixed constraint applied' : 'Fixed constraint removed');
				}
				break;
			}
			case 'coincident': {
				if (pIds.length >= 2) {
					applyResult(
						sketch.addCoincidentConstraints(pIds),
						pIds.includes('origin') ? 'Coincident with (0,0) applied' : 'Coincident constraint applied',
						'Cannot make these points coincident'
					);
				} else if (pIds.length === 1 && lIds.length + cIds.length + eIds.length + sIds.length === 1) {
					if (lIds.length === 1) applyPointOnLineOrAxis(pIds[0], lIds[0]);
					else if (cIds.length === 1)
						applyResult(
							sketch.addPointOnCircleConstraint(pIds[0], cIds[0]),
							'Point on circle constraint applied',
							'Cannot constrain point to this circle/arc'
						);
					else if (eIds.length === 1)
						applyResult(
							sketch.addPointOnEllipseConstraint(pIds[0], eIds[0]),
							'Point on ellipse constraint applied',
							'Cannot constrain point to this ellipse'
						);
					else
						applyResult(
							sketch.addPointOnSplineConstraint(pIds[0], sIds[0]),
							'Point on spline constraint applied',
							'Cannot constrain point to this spline'
						);
				}
				break;
			}
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical': {
				const pair =
					lIds.length === 1
						? (() => {
								const l = sketch.lines.get(lIds[0]);
								return l ? ([l.p1Id, l.p2Id] as const) : null;
							})()
						: pIds.length === 2
							? ([pIds[0], pIds[1]] as const)
							: null;
				if (!pair) break;
				let mode = type;
				if (type === 'horizontal_vertical') {
					const p1 = sketch.points.get(pair[0]);
					const p2 = sketch.points.get(pair[1]);
					if (!p1 || !p2) break;
					mode = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? 'horizontal' : 'vertical';
				}
				if (mode === 'horizontal') sketch.addHorizontalConstraint(pair[0], pair[1]);
				else sketch.addVerticalConstraint(pair[0], pair[1]);
				applied = true;
				toastMsg = mode === 'horizontal' ? 'Horizontal constraint applied' : 'Vertical constraint applied';
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
					applyDim(
						sketch.addCircleToLineDistanceConstraint(cIds[0], lIds[0]),
						'Center-to-line distance constraint applied'
					);
				} else if (lIds.length === 1 && pIds.length === 1) {
					if (lIds[0] === 'axis_x' || lIds[0] === 'axis_y') {
						const axis = lIds[0] === 'axis_x' ? 'x' : 'y';
						const existed = sketch.hasPointToAxisConstraint(pIds[0], axis);
						applyDim(
							sketch.addPointToAxisDistanceConstraint(pIds[0], axis),
							`Distance to ${axis.toUpperCase()}-axis applied`,
							`Editing distance to ${axis.toUpperCase()}-axis`,
							existed
						);
					} else {
						const l = sketch.lines.get(lIds[0])!;
						if (pIds[0] !== l.p1Id && pIds[0] !== l.p2Id) {
							const existed = sketch.hasPointToLineDistanceConstraint(pIds[0], lIds[0]);
							applyDim(
								sketch.addPointToLineDistanceConstraint(pIds[0], lIds[0]),
								'Point-to-line distance constraint applied',
								'Editing point-to-line distance constraint',
								existed
							);
						}
					}
				} else if (lIds.length === 1 && pIds.length === 0) {
					const l = sketch.lines.get(lIds[0])!;
					applyDistancePair(l.p1Id, l.p2Id);
				} else if (lIds.length === 2) {
					if (sketch.canAddLineToLineDistanceConstraint(lIds[0], lIds[1])) {
						const existed = !!sketch.getLineToLineDistanceConstraint(lIds[0], lIds[1]);
						applyDim(
							sketch.addLineToLineDistanceConstraint(lIds[0], lIds[1]),
							'Distance constraint applied',
							'Editing distance constraint',
							existed
						);
						break;
					}
					const existed = sketch.hasAngleConstraint(lIds[0], lIds[1]);
					applyDim(
						sketch.addAngleConstraint(lIds[0], lIds[1]),
						'Angle constraint applied',
						'Editing angle constraint',
						existed
					);
				} else if (pIds.length === 3 && lIds.length === 0) {
					const existed = sketch.hasThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]);
					applyDim(
						sketch.addThreePointAngleConstraint(pIds[0], pIds[1], pIds[2]),
						'Angle constraint applied',
						'Editing angle constraint',
						existed
					);
				} else if (pIds.length === 2) {
					if (pIds.includes('origin')) {
						const userPtId = pIds[0] === 'origin' ? pIds[1] : pIds[0];
						const existed = sketch.hasOriginConstraint(userPtId);
						applyDim(
							sketch.addOriginDistanceConstraint(userPtId),
							'Distance to (0,0) applied',
							'Editing distance to (0,0)',
							existed
						);
					} else {
						applyDistancePair(pIds[0], pIds[1]);
					}
				} else if (cIds.length === 2 && lIds.length === 0 && pIds.length === 0) {
					applyDim(sketch.addCircleDistanceConstraint(cIds[0], cIds[1]), 'Radial distance constraint applied');
				} else if (cIds.length === 1) {
					if (!sketch.hasRadiusConstraint(cIds[0])) {
						opts.setTool?.('dimension');
						return true;
					}
					applyDim(sketch.addRadiusConstraint(cIds[0]), 'Editing radius constraint');
				}
				break;
			}
			case 'equal': {
				if (lIds.length === 2) {
					sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
					applyResult(true, 'Equal length constraint applied');
				} else if (cIds.length === 2) {
					sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
					applyResult(true, 'Equal radius constraint applied');
				}
				break;
			}
			case 'parallel':
			case 'perpendicular': {
				if (lIds.length !== 2) break;
				const axisInfo = resolveAxisLine();
				if (axisInfo) {
					const line = sketch.lines.get(axisInfo.userLineId);
					if (!line) break;
					const addHoriz = (type === 'parallel') === (axisInfo.axis === 'x');
					if (addHoriz) sketch.addHorizontalConstraint(line.p1Id, line.p2Id);
					else sketch.addVerticalConstraint(line.p1Id, line.p2Id);
					applyResult(
						true,
						`${type === 'parallel' ? 'Parallel' : 'Perpendicular'} to ${axisInfo.axis.toUpperCase()}-axis applied`
					);
				} else {
					if (type === 'parallel') sketch.addParallelConstraint(lIds[0], lIds[1]);
					else sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
					applyResult(true, type === 'parallel' ? 'Parallel constraint applied' : 'Perpendicular constraint applied');
				}
				break;
			}
			case 'collinear': {
				if (lIds.length === 2) {
					const axisInfo = resolveAxisLine();
					if (axisInfo) {
						if (!axisInfo.userLineId) break;
						applyResult(
							sketch.addLineCollinearWithAxisConstraint(axisInfo.userLineId, axisInfo.axis),
							`Collinear with ${axisInfo.axis.toUpperCase()}-axis applied`
						);
					} else {
						sketch.addCollinearConstraint(lIds[0], lIds[1]);
						applyResult(true, 'Collinear constraint applied');
					}
				} else if (pIds.length === 3 && lIds.length === 0) {
					applyResult(
						sketch.addThreePointCollinearConstraint(pIds[0], pIds[1], pIds[2]),
						'Collinear constraint applied'
					);
				}
				break;
			}
			case 'concentric': {
				if (cIds.length === 2) {
					sketch.addConcentricConstraint(cIds[0], cIds[1]);
					applyResult(true, 'Concentric constraint applied');
				}
				break;
			}
			case 'tangent': {
				if (lIds.length === 1 && cIds.length === 1) {
					applyResult(sketch.addTangentConstraint(lIds[0], cIds[0]), 'Tangent constraint applied');
				} else if (cIds.length === 2 && lIds.length === 0) {
					applyResult(sketch.addTangentConstraint(cIds[0], cIds[1]), 'Tangent constraint applied');
				}
				break;
			}
			case 'point_on_line': {
				if (pIds.length === 1 && lIds.length === 1) {
					applyPointOnLineOrAxis(pIds[0], lIds[0]);
				}
				break;
			}
			case 'midpoint': {
				if (pIds.length === 1 && lIds.length === 1) {
					applyResult(
						sketch.addMidpointConstraint(pIds[0], lIds[0]),
						'Midpoint constraint applied',
						'Cannot constrain midpoint to this line'
					);
				} else if (pIds.length === 3 && lIds.length === 0) {
					applyResult(sketch.addThreePointMidpointConstraint(pIds[0], pIds[1], pIds[2]), 'Midpoint constraint applied');
				}
				break;
			}
			case 'symmetry': {
				if (pIds.length === 2 && lIds.length === 1) {
					applyResult(
						sketch.addSymmetryConstraint(pIds[0], pIds[1], lIds[0]),
						'Symmetry constraint applied',
						'Cannot apply symmetry to these entities'
					);
				} else if (pIds.length === 3 && pIds.includes('origin') && lIds.length === 0) {
					const userPts = pIds.filter(id => id !== 'origin');
					applyResult(sketch.addSymmetryConstraint(userPts[0], userPts[1], 'origin'), 'Symmetry constraint applied');
				} else if (cIds.length === 2 && (lIds.length === 1 || (pIds.length === 1 && pIds[0] === 'origin'))) {
					const symAxisId = lIds.length === 1 ? lIds[0] : 'origin';
					const c1 = sketch.circles.get(cIds[0]) ?? sketch.arcs.get(cIds[0]);
					const c2 = sketch.circles.get(cIds[1]) ?? sketch.arcs.get(cIds[1]);
					if (c1 && c2) {
						sketch.beginTransaction();
						sketch.addSymmetryConstraint(c1.centerId, c2.centerId, symAxisId);
						sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
						sketch.commitTransaction();
						applyResult(true, 'Symmetry & equal radius applied');
					}
				} else if (lIds.length === 3) {
					const builtinAxisIdx = lIds.findIndex(id => id === 'axis_x' || id === 'axis_y');
					const constrIdx = lIds.findIndex(id => sketch.lines.get(id)?.isConstruction);
					const axisId = builtinAxisIdx !== -1 ? lIds[builtinAxisIdx] : constrIdx !== -1 ? lIds[constrIdx] : lIds[2];
					const otherLines = lIds.filter(id => id !== axisId);
					if (otherLines.length === 2) applyLineSymmetry(otherLines[0], otherLines[1], axisId);
				} else if (lIds.length === 2 && pIds.length === 1 && pIds[0] === 'origin') {
					applyLineSymmetry(lIds[0], lIds[1], 'origin');
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

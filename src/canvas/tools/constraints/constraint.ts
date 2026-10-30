import { BaseTool } from '../base';
import type { ConstraintToolType, ToolContext, ToolMouseEvent } from '../types';
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
		return { allowSplineHandles: true };
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		if (this.id === 'dimension') return;

		const screen = e.screen;

		if (this.id === 'fixed') {
			const nearPoint = this.ctx.findPointNear(screen, 20);
			if (nearPoint) {
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
			| undefined;

		// Points ALWAYS have top priority when clicking near a point (if points are applicable)
		const canUsePoints = this.isEntityCompatibleWithConstraint('point');
		const nearPoint = canUsePoints ? this.ctx.findPointNear(screen, 16) : null;
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
				type !== 'elliptical_arc')
		) {
			const hitLine = this.ctx.findLineNear(screen, 18);
			if (hitLine) {
				id = hitLine.id;
				type = 'line';
			} else {
				const hitCircle = this.ctx.findCircleNear(screen, 18);
				if (hitCircle) {
					id = hitCircle.id;
					type = 'circle';
				} else {
					const hitArc = this.ctx.findArcNear(screen, 18);
					if (hitArc) {
						id = hitArc.id;
						type = 'arc';
					} else {
						const hitEllipse = this.ctx.findEllipseNear?.(screen, 18);
						if (hitEllipse) {
							id = hitEllipse.id;
							type = 'ellipse';
						} else {
							const hitEllipticalArc = this.ctx.findEllipticalArcNear?.(screen, 18);
							if (hitEllipticalArc) {
								id = hitEllipticalArc.id;
								type = 'elliptical_arc';
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
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
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
					sel.circleIds.clear();
					sel.arcIds.clear();
					if (sel.pointIds.size > 1) sel.pointIds.clear();
					if (sel.lineIds.size >= 1 && sel.pointIds.size >= 1) sel.lineIds.clear();
					else if (sel.lineIds.size >= 2) sel.lineIds.clear();
				} else if (type === 'circle' || type === 'arc') {
					sel.pointIds.clear();
					sel.lineIds.clear();
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
			case 'collinear':
			case 'perpendicular': {
				if (sel.lineIds.size >= 2) sel.lineIds.clear();
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
						(sel.pointIds.size >= 1 && (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1))
					) {
						sel.pointIds.clear();
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
					}
				} else if (type === 'line') {
					if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1 || sel.pointIds.size >= 2) {
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
						if (sel.pointIds.size >= 2) sel.pointIds.clear();
					}
				} else if (type === 'circle' || type === 'arc') {
					if (sel.lineIds.size >= 1 || sel.circleIds.size + sel.arcIds.size >= 1 || sel.pointIds.size >= 2) {
						sel.lineIds.clear();
						sel.circleIds.clear();
						sel.arcIds.clear();
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
			case 'point_on_line':
			case 'midpoint': {
				if (type === 'point' && sel.pointIds.size >= 1) {
					sel.pointIds.clear();
				} else if (type === 'line' && sel.lineIds.size >= 1) {
					sel.lineIds.clear();
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
		type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
	): void {
		const sel = this.ctx.sketch.selection;
		if (type === 'point') sel.pointIds.delete(id);
		else if (type === 'line') sel.lineIds.delete(id);
		else if (type === 'circle') sel.circleIds.delete(id);
		else if (type === 'arc') sel.arcIds.delete(id);
		else if (type === 'ellipse') sel.ellipseIds.delete(id);
		else if (type === 'elliptical_arc') sel.ellipticalArcIds.delete(id);
	}

	private pruneIncompatibleSelection(): void {
		const sel = this.ctx.sketch.selection;
		for (const pid of [...sel.pointIds]) {
			if (!this.isEntityCompatibleWithConstraint('point')) sel.pointIds.delete(pid);
		}
		for (const lid of [...sel.lineIds]) {
			if (!this.isEntityCompatibleWithConstraint('line')) sel.lineIds.delete(lid);
		}
		for (const cid of [...sel.circleIds]) {
			if (!this.isEntityCompatibleWithConstraint('circle')) sel.circleIds.delete(cid);
		}
		for (const aid of [...sel.arcIds]) {
			if (!this.isEntityCompatibleWithConstraint('arc')) sel.arcIds.delete(aid);
		}
		for (const eid of [...sel.ellipseIds]) {
			if (!this.isEntityCompatibleWithConstraint('ellipse')) sel.ellipseIds.delete(eid);
		}
		for (const eaid of [...sel.ellipticalArcIds]) {
			if (!this.isEntityCompatibleWithConstraint('elliptical_arc')) sel.ellipticalArcIds.delete(eaid);
		}
	}

	private isEntityCompatibleWithConstraint(
		entityType: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc'
	): boolean {
		switch (this.id) {
			case 'fixed':
				return entityType === 'point';
			case 'coincident':
				return entityType === 'point' || entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return entityType === 'line' || entityType === 'point';
			case 'dimension':
			case 'distance':
				return (
					entityType === 'line' ||
					entityType === 'point' ||
					entityType === 'circle' ||
					entityType === 'arc'
				);
			case 'equal':
				return entityType === 'line' || entityType === 'circle' || entityType === 'arc';
			case 'parallel':
			case 'collinear':
			case 'perpendicular':
				return entityType === 'line';
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
		const sel = this.ctx.sketch.selection;
		const pCount = sel.pointIds.size;
		const lCount = sel.lineIds.size;
		const cCount = sel.circleIds.size + sel.arcIds.size;

		switch (type) {
			case 'fixed':
				return pCount >= 1;
			case 'coincident':
				return (
					(pCount === 2 && lCount === 0 && cCount === 0) ||
					(pCount === 1 && lCount === 1 && cCount === 0) ||
					(pCount === 1 && cCount === 1 && lCount === 0)
				);
			case 'horizontal_vertical':
			case 'horizontal':
			case 'vertical':
				return (lCount === 1 && pCount === 0 && cCount === 0) || (pCount === 2 && lCount === 0 && cCount === 0);
			case 'equal':
				return (lCount === 2 && pCount === 0 && cCount === 0) || (cCount === 2 && pCount === 0 && lCount === 0);
			case 'parallel':
			case 'collinear':
			case 'perpendicular':
				return lCount === 2 && pCount === 0 && cCount === 0;
			case 'tangent':
				return (
					((lCount === 1 && cCount === 1) || (cCount === 2 && lCount === 0)) &&
					pCount === 0
				);
			case 'concentric':
				return cCount === 2 && pCount === 0 && lCount === 0;
			case 'point_on_line':
			case 'midpoint':
				return pCount === 1 && lCount === 1 && cCount === 0;
			case 'symmetry':
				return (
					(pCount === 2 && lCount === 1 && cCount === 0) ||
					(cCount === 2 && lCount === 1 && pCount === 0) ||
					(lCount === 3 && pCount === 0 && cCount === 0)
				);
			default:
				return false;
		}
	}

	private applyConstraint(type: string): boolean {
		const sel = this.ctx.sketch.selection;
		const pIds = [...sel.pointIds];
		const lIds = [...sel.lineIds];
		const cIds = [...sel.circleIds, ...sel.arcIds];

		let applied = false;
		let toastMsg = '';

		switch (type) {
			case 'fixed': {
				if (pIds.length >= 1) {
					const appliedNow = this.ctx.sketch.toggleFixedConstraints(pIds);
					applied = true;
					toastMsg = appliedNow ? 'Fixed constraint applied' : 'Fixed constraint removed';
				}
				break;
			}
			case 'coincident': {
				if (pIds.length === 2 && lIds.length === 0 && cIds.length === 0) {
					this.ctx.sketch.addCoincidentConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Coincident constraint applied';
				} else if (pIds.length === 1 && lIds.length === 1 && cIds.length === 0) {
					const c = this.ctx.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on line constraint applied';
					} else {
						this.ctx.showToast('Cannot constrain point to this line');
					}
				} else if (pIds.length === 1 && cIds.length === 1 && lIds.length === 0) {
					const c = this.ctx.sketch.addPointOnCircleConstraint(pIds[0], cIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on circle constraint applied';
					} else {
						this.ctx.showToast('Cannot constrain point to this circle/arc');
					}
				}
				break;
			}
			case 'horizontal_vertical': {
				if (lIds.length === 1) {
					const l = this.ctx.sketch.lines.get(lIds[0])!;
					const p1 = this.ctx.sketch.points.get(l.p1Id);
					const p2 = this.ctx.sketch.points.get(l.p2Id);
					if (p1 && p2) {
						const dx = Math.abs(p2.x - p1.x);
						const dy = Math.abs(p2.y - p1.y);
						if (dx >= dy) {
							this.ctx.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							this.ctx.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				} else if (pIds.length === 2) {
					const p1 = this.ctx.sketch.points.get(pIds[0]);
					const p2 = this.ctx.sketch.points.get(pIds[1]);
					if (p1 && p2) {
						const dx = Math.abs(p2.x - p1.x);
						const dy = Math.abs(p2.y - p1.y);
						if (dx >= dy) {
							this.ctx.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Horizontal constraint applied';
						} else {
							this.ctx.sketch.addVerticalConstraint(pIds[0], pIds[1]);
							applied = true;
							toastMsg = 'Vertical constraint applied';
						}
					}
				}
				break;
			}
			case 'horizontal': {
				if (lIds.length === 1) {
					const l = this.ctx.sketch.lines.get(lIds[0])!;
					this.ctx.sketch.addHorizontalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				} else if (pIds.length === 2) {
					this.ctx.sketch.addHorizontalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Horizontal constraint applied';
				}
				break;
			}
			case 'vertical': {
				if (lIds.length === 1) {
					const l = this.ctx.sketch.lines.get(lIds[0])!;
					this.ctx.sketch.addVerticalConstraint(l.p1Id, l.p2Id);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				} else if (pIds.length === 2) {
					this.ctx.sketch.addVerticalConstraint(pIds[0], pIds[1]);
					applied = true;
					toastMsg = 'Vertical constraint applied';
				}
				break;
			}
			case 'equal': {
				if (lIds.length === 2) {
					this.ctx.sketch.addEqualLengthConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Equal length constraint applied';
				} else if (cIds.length === 2) {
					this.ctx.sketch.addEqualRadiusConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Equal radius constraint applied';
				}
				break;
			}
			case 'parallel': {
				if (lIds.length === 2) {
					this.ctx.sketch.addParallelConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Parallel constraint applied';
				}
				break;
			}
			case 'perpendicular': {
				if (lIds.length === 2) {
					this.ctx.sketch.addPerpendicularConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Perpendicular constraint applied';
				}
				break;
			}
			case 'collinear': {
				if (lIds.length === 2) {
					this.ctx.sketch.addCollinearConstraint(lIds[0], lIds[1]);
					applied = true;
					toastMsg = 'Collinear constraint applied';
				}
				break;
			}
			case 'concentric': {
				if (cIds.length === 2) {
					this.ctx.sketch.addConcentricConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Concentric constraint applied';
				}
				break;
			}
			case 'tangent': {
				if (lIds.length === 1 && cIds.length === 1) {
					this.ctx.sketch.addTangentConstraint(lIds[0], cIds[0]);
					applied = true;
					toastMsg = 'Tangent constraint applied';
				} else if (cIds.length === 2 && lIds.length === 0) {
					this.ctx.sketch.addTangentConstraint(cIds[0], cIds[1]);
					applied = true;
					toastMsg = 'Tangent constraint applied';
				}
				break;
			}
			case 'point_on_line': {
				if (pIds.length === 1 && lIds.length === 1) {
					const c = this.ctx.sketch.addPointOnLineConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Point on line constraint applied';
					} else {
						this.ctx.showToast('Cannot constrain point to this line');
					}
				}
				break;
			}
			case 'midpoint': {
				if (pIds.length === 1 && lIds.length === 1) {
					const c = this.ctx.sketch.addMidpointConstraint(pIds[0], lIds[0]);
					if (c) {
						applied = true;
						toastMsg = 'Midpoint constraint applied';
					} else {
						this.ctx.showToast('Cannot constrain midpoint to this line');
					}
				}
				break;
			}
			case 'symmetry': {
				if (lIds.length === 1 && pIds.length === 2) {
					this.ctx.sketch.addSymmetryConstraint(pIds[0], pIds[1], lIds[0]);
					applied = true;
					toastMsg = 'Symmetry constraint applied';
				}
				break;
			}
		}

		if (applied) {
			this.ctx.sketch.solve();
			if (toastMsg) {
				this.ctx.showToast(toastMsg);
			}
		}

		return applied;
	}
}

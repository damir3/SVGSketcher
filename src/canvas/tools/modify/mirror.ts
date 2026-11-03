import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import { ModifyToolPanel } from '../../../ui/panels/tools';
import { dist } from '../../../math/vector';

export interface MirrorState {
	phase: 'objects' | 'mirror_line';
	selectedObjectIds: Set<string>;
	mirrorLineId: string | null;
}

export class MirrorTool extends BaseTool {
	readonly id = 'mirror' as const;
	readonly sidebarPanel: ModifyToolPanel = new ModifyToolPanel({
		iconName: 'mirror',
		title: 'Mirror Tool',
		description: 'Create symmetric copies of primitives across a centerline.',
		steps: [
			{
				id: 'objects',
				num: 1,
				title: 'Objects to Mirror',
				getValue: () => {
					const count = this.state?.selectedObjectIds.size ?? 0;
					return count === 0 ? 'Click or box-select...' : `${count} object${count === 1 ? '' : 's'} selected`;
				},
				isActive: () => this.state?.phase === 'objects',
				showClear: () => (this.state?.selectedObjectIds.size ?? 0) > 0,
				clearTitle: 'Clear selection',
				onSelect: () => this.setPhase('objects'),
				onClear: () => {
					if (this.state) {
						this.state.selectedObjectIds.clear();
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
			},
			{
				id: 'mirror_line',
				num: 2,
				title: 'Mirror Line',
				getValue: () => {
					const mirrorLineId = this.state?.mirrorLineId;
					if (mirrorLineId && this.ctx?.sketch) {
						const line = this.ctx.sketch.lines.get(mirrorLineId);
						if (line) {
							const p1 = this.ctx.sketch.points.get(line.p1Id);
							const p2 = this.ctx.sketch.points.get(line.p2Id);
							const len = p1 && p2 ? ` (${dist(p1, p2).toFixed(1)} mm)` : '';
							return `${line.id}${len}`;
						}
						return mirrorLineId;
					}
					return 'Click a line in canvas';
				},
				isSelected: () => Boolean(this.state?.mirrorLineId),
				isActive: () => this.state?.phase === 'mirror_line',
				showClear: () => Boolean(this.state?.mirrorLineId),
				clearTitle: 'Clear mirror line',
				onSelect: () => this.setPhase('mirror_line'),
				onClear: () => {
					if (this.state) {
						this.state.mirrorLineId = null;
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
			},
		],
		canApply: () => Boolean((this.state?.selectedObjectIds.size ?? 0) > 0 && this.state?.mirrorLineId),
		applyLabel: 'Apply Mirror',
		onApply: () => this.executeMirror(),
		onCancel: () => {
			this.cancel();
			this.ctx?.setTool('select');
		},
		getHint: () => {
			const mirrorLineId = this.state?.mirrorLineId;
			const objCount = this.state?.selectedObjectIds.size ?? 0;
			if (!mirrorLineId && objCount === 0) return 'Select objects first, then pick a mirror line.';
			if (!mirrorLineId) return 'Click a centerline in the canvas to reflect across.';
			if (objCount === 0) return 'Pick geometry in the canvas to mirror.';
			return 'Ready to apply! Press Enter or click Apply Mirror.';
		},
		bindStateChange: cb => {
			this.onStateChange = cb;
		},
	});

	state: MirrorState | null = null;
	onStateChange?: () => void;

	override activate(ctx: ToolContext): void {
		super.activate(ctx);

		const sel = ctx.sketch.selection;
		const initialObjects = new Set<string>();
		for (const id of sel.lineIds) initialObjects.add(id);
		for (const id of sel.circleIds) initialObjects.add(id);
		for (const id of sel.arcIds) initialObjects.add(id);
		for (const id of sel.ellipseIds) initialObjects.add(id);
		for (const id of sel.ellipticalArcIds) initialObjects.add(id);
		for (const id of sel.pointIds) initialObjects.add(id);

		this.state = {
			phase: initialObjects.size > 0 ? 'mirror_line' : 'objects',
			selectedObjectIds: initialObjects,
			mirrorLineId: null,
		};
		ctx.sketch.clearSelection();
		this.onStateChange?.();
	}

	override deactivate(): void {
		this.state = null;
		this.onStateChange?.();
	}

	override isBusy(): boolean {
		return Boolean(this.state && (this.state.selectedObjectIds.size > 0 || this.state.mirrorLineId));
	}

	setPhase(phase: 'objects' | 'mirror_line'): void {
		if (this.state) {
			this.state.phase = phase;
			this.onStateChange?.();
			this.ctx?.highlightManager?.refresh(this);
			this.ctx.requestRender();
		}
	}

	override cancel(): void {
		this.state = null;
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	override isHighlightEnabled(): boolean {
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'constraint') return false;
		if (this.state?.phase === 'mirror_line') {
			return target.type === 'line';
		}
		return true;
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: false };
	}

	override commit(): void {
		this.executeMirror();
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		if (!this.state) {
			this.state = {
				phase: 'objects',
				selectedObjectIds: new Set(),
				mirrorLineId: null,
			};
		}

		let hitId: string | null = null;
		let hitType: string | null = null;

		if (this.state.phase === 'mirror_line') {
			const hitLine = this.ctx.findLineNear(e.screen, 18);
			if (hitLine) {
				hitId = hitLine.id;
				hitType = 'line';
			}
		} else {
			const nearPoint = this.ctx.findPointNear(e.screen, 16);
			if (nearPoint) {
				hitId = nearPoint.id;
				hitType = 'point';
			} else {
				const hitLine = this.ctx.findLineNear(e.screen, 18);
				if (hitLine) {
					hitId = hitLine.id;
					hitType = 'line';
				} else {
					const hitCircle = this.ctx.findCircleNear(e.screen, 18);
					if (hitCircle) {
						hitId = hitCircle.id;
						hitType = 'circle';
					} else {
						const hitArc = this.ctx.findArcNear(e.screen, 18);
						if (hitArc) {
							hitId = hitArc.id;
							hitType = 'arc';
						} else {
							const hitEllipse = this.ctx.findEllipseNear?.(e.screen, 18);
							if (hitEllipse) {
								hitId = hitEllipse.id;
								hitType = 'ellipse';
							} else {
								const hitEllipticalArc = this.ctx.findEllipticalArcNear?.(e.screen, 18);
								if (hitEllipticalArc) {
									hitId = hitEllipticalArc.id;
									hitType = 'elliptical_arc';
								}
							}
						}
					}
				}
			}
		}

		if (hitId) {
			if (this.state.phase === 'mirror_line') {
				if (hitType === 'line') {
					this.state.mirrorLineId = hitId;
					this.state.selectedObjectIds.delete(hitId);
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			} else {
				if (this.state.selectedObjectIds.has(hitId)) {
					this.state.selectedObjectIds.delete(hitId);
				} else {
					if (this.state.mirrorLineId === hitId) {
						this.state.mirrorLineId = null;
					}
					this.state.selectedObjectIds.add(hitId);
				}
				this.onStateChange?.();
				this.ctx.requestRender();
			}
			return true;
		}

		// Empty click in objects phase triggers box selection
		return false;
	}

	handleBoxSelect(itemsToSelect: Array<{ id: string }>): void {
		if (this.state && this.state.phase === 'objects') {
			for (const item of itemsToSelect) {
				if (item.id !== this.state.mirrorLineId) {
					this.state.selectedObjectIds.add(item.id);
				}
			}
			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	executeMirror(): boolean {
		if (!this.state) return false;
		const { selectedObjectIds, mirrorLineId } = this.state;
		if (selectedObjectIds.size === 0 || !mirrorLineId) {
			this.ctx.showToast('Select objects and a mirror line');
			return false;
		}

		const mirrorLine = this.ctx.sketch.lines.get(mirrorLineId);
		if (!mirrorLine) {
			this.ctx.showToast('Mirror line not found');
			return false;
		}

		const pA = this.ctx.sketch.points.get(mirrorLine.p1Id);
		const pB = this.ctx.sketch.points.get(mirrorLine.p2Id);
		if (!pA || !pB) return false;

		const dx = pB.x - pA.x;
		const dy = pB.y - pA.y;
		const lineLen = Math.hypot(dx, dy);
		if (lineLen < 1e-6) {
			this.ctx.showToast('Mirror line length is zero');
			return false;
		}

		// Unit normal to mirror line
		const nx = -dy / lineLen;
		const ny = dx / lineLen;

		const reflectPoint = (x: number, y: number): { x: number; y: number } => {
			const distToLine = (x - pA.x) * nx + (y - pA.y) * ny;
			return {
				x: x - 2 * distToLine * nx,
				y: y - 2 * distToLine * ny,
			};
		};

		const isPointOnMirrorLine = (x: number, y: number, tol = 1e-3): boolean => {
			const distToLine = Math.abs((x - pA.x) * nx + (y - pA.y) * ny);
			return distToLine < tol;
		};

		this.ctx.sketch.beginTransaction();

		// Map from original point ID to reflected point ID
		const pointMap = new Map<string, string>();

		const getOrReflectPoint = (origPtId: string): string => {
			if (pointMap.has(origPtId)) {
				return pointMap.get(origPtId)!;
			}
			const pt = this.ctx.sketch.points.get(origPtId);
			if (!pt) return origPtId;

			// If point is strictly on the mirror line, reuse it
			if (origPtId === mirrorLine.p1Id || origPtId === mirrorLine.p2Id || isPointOnMirrorLine(pt.x, pt.y)) {
				pointMap.set(origPtId, origPtId);
				if (origPtId !== mirrorLine.p1Id && origPtId !== mirrorLine.p2Id) {
					this.ctx.sketch.addPointOnLineConstraint(origPtId, mirrorLine.id);
				}
				return origPtId;
			}

			// Reflect point
			const refPos = reflectPoint(pt.x, pt.y);
			const newPt = this.ctx.sketch.addPoint(refPos.x, refPos.y, false);
			pointMap.set(origPtId, newPt.id);

			// Automatically add SymmetryConstraint
			this.ctx.sketch.addSymmetryConstraint(origPtId, newPt.id, mirrorLine.id);
			return newPt.id;
		};

		let createdCount = 0;
		const newCreatedItems: Array<{ id: string; type: 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical_arc' }> = [];

		// Mirror each primitive in selectedObjectIds
		for (const objId of selectedObjectIds) {
			if (objId === mirrorLineId) continue; // Cannot mirror mirror line across itself

			// 1. Line
			const line = this.ctx.sketch.lines.get(objId);
			if (line) {
				const np1Id = getOrReflectPoint(line.p1Id);
				const np2Id = getOrReflectPoint(line.p2Id);
				if (np1Id !== np2Id) {
					const newLine = this.ctx.sketch.addLine(np1Id, np2Id, line.isConstruction);
					newCreatedItems.push({ id: newLine.id, type: 'line' });
					createdCount++;
				}
				continue;
			}

			// 2. Circle
			const circle = this.ctx.sketch.circles.get(objId);
			if (circle) {
				const nCenterId = getOrReflectPoint(circle.centerId);
				const newCircle = this.ctx.sketch.addCircle(nCenterId, circle.radius, circle.isConstruction);
				this.ctx.sketch.addEqualRadiusConstraint(circle.id, newCircle.id);
				newCreatedItems.push({ id: newCircle.id, type: 'circle' });
				createdCount++;
				continue;
			}

			// 3. Arc
			const arc = this.ctx.sketch.arcs.get(objId);
			if (arc) {
				const nCenterId = getOrReflectPoint(arc.centerId);
				const nStartId = getOrReflectPoint(arc.startPointId);
				const nEndId = getOrReflectPoint(arc.endPointId);
				const newArc = this.ctx.sketch.addArc(
					nCenterId,
					nStartId,
					nEndId,
					arc.radius,
					!arc.clockwise,
					arc.isConstruction
				);
				this.ctx.sketch.addEqualRadiusConstraint(arc.id, newArc.id);
				newCreatedItems.push({ id: newArc.id, type: 'arc' });
				createdCount++;
				continue;
			}

			// 4. Ellipse
			const ellipse = this.ctx.sketch.ellipses.get(objId);
			if (ellipse) {
				const nCenterId = getOrReflectPoint(ellipse.centerId);
				const nMajorId = getOrReflectPoint(ellipse.majorAxisPointId);
				const nMinorId = getOrReflectPoint(ellipse.minorAxisPointId);
				const newEllipse = this.ctx.sketch.addEllipse(nCenterId, nMajorId, nMinorId, ellipse.isConstruction);
				newCreatedItems.push({ id: newEllipse.id, type: 'ellipse' });
				createdCount++;
				continue;
			}

			// 5. Elliptical Arc
			const elArc = this.ctx.sketch.ellipticalArcs.get(objId);
			if (elArc) {
				const nCenterId = getOrReflectPoint(elArc.centerId);
				const nMajorId = getOrReflectPoint(elArc.majorAxisPointId);
				const nMinorId = getOrReflectPoint(elArc.minorAxisPointId);
				const nStartId = getOrReflectPoint(elArc.startPointId);
				const nEndId = getOrReflectPoint(elArc.endPointId);
				const newElArc = this.ctx.sketch.addEllipticalArc(
					nCenterId,
					nMajorId,
					nMinorId,
					nStartId,
					nEndId,
					!elArc.clockwise,
					elArc.isConstruction
				);
				newCreatedItems.push({ id: newElArc.id, type: 'elliptical_arc' });
				createdCount++;
				continue;
			}

			// 6. Standalone Point
			const pt = this.ctx.sketch.points.get(objId);
			if (pt) {
				const nPtId = getOrReflectPoint(pt.id);
				if (nPtId !== pt.id) {
					newCreatedItems.push({ id: nPtId, type: 'point' });
					createdCount++;
				}
				continue;
			}
		}

		this.ctx.sketch.commitTransaction();
		this.ctx.sketch.solve();

		this.state = null;
		this.onStateChange?.();
		this.ctx.setTool('select');

		if (newCreatedItems.length > 0) {
			this.ctx.sketch.selectEntities(newCreatedItems, false);
		}

		this.ctx.showToast(`Mirrored ${createdCount} object${createdCount !== 1 ? 's' : ''}`);
		this.ctx.requestRender();
		return true;
	}

	override getRenderOptions(): Record<string, unknown> {
		if (!this.state) return {};
		return {
			mirrorHighlight: {
				selectedObjectIds: this.state.selectedObjectIds,
				mirrorLineId: this.state.mirrorLineId,
			},
		};
	}
}

import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import type { Vec2 } from '../../../math/vector';

export interface CircularPatternState {
	phase: 'objects' | 'center_point';
	selectedObjectIds: Set<string>;
	centerPointId: string | null;
	distribution: 'full' | 'partial' | 'symmetric';
	angle: number;
	quantity: number;
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export class CircularPatternTool extends BaseTool {
	readonly id = 'circular_pattern' as const;

	state: CircularPatternState | null = null;
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
			phase: initialObjects.size > 0 ? 'center_point' : 'objects',
			selectedObjectIds: initialObjects,
			centerPointId: null,
			distribution: 'full',
			angle: 180,
			quantity: 3,
			suppression: false,
			suppressedIndices: new Set<number>(),
		};
		ctx.sketch.clearSelection();
		this.onStateChange?.();
	}

	override deactivate(): void {
		this.state = null;
		this.onStateChange?.();
	}

	override isBusy(): boolean {
		return Boolean(this.state && (this.state.selectedObjectIds.size > 0 || this.state.centerPointId));
	}

	setPhase(phase: 'objects' | 'center_point'): void {
		if (this.state) {
			this.state.phase = phase;
			this.onStateChange?.();
			this.ctx?.highlightManager?.refresh(this);
			this.ctx.requestRender();
		}
	}

	override isHighlightEnabled(screen?: Vec2): boolean {
		if (screen && this.state?.suppression && this.ctx?.renderer?.patternCheckboxPositions) {
			for (const entry of this.ctx.renderer.patternCheckboxPositions.values()) {
				if (!entry.constraintId && Math.abs(screen.x - entry.x) <= 14 && Math.abs(screen.y - entry.y) <= 14) {
					return false;
				}
			}
		}
		return true;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'constraint') return false;
		if (this.state?.phase === 'center_point') {
			return target.type === 'point';
		}
		return true;
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: false };
	}

	override cancel(): void {
		this.state = null;
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	override commit(): void {
		this.executeCircularPattern();
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		if (!this.state) {
			this.state = {
				phase: 'objects',
				selectedObjectIds: new Set(),
				centerPointId: null,
				distribution: 'full',
				angle: 90,
				quantity: 3,
				suppression: false,
				suppressedIndices: new Set(),
			};
		}

		// 1. Suppression checkbox click hit-test
		if (this.state.suppression && this.ctx.renderer?.patternCheckboxPositions) {
			for (const entry of this.ctx.renderer.patternCheckboxPositions.values()) {
				if (!entry.constraintId && Math.abs(e.screen.x - entry.x) <= 14 && Math.abs(e.screen.y - entry.y) <= 14) {
					if (this.state.suppressedIndices.has(entry.copyIndex)) {
						this.state.suppressedIndices.delete(entry.copyIndex);
					} else {
						this.state.suppressedIndices.add(entry.copyIndex);
					}
					this.onStateChange?.();
					this.ctx.requestRender();
					return true;
				}
			}
		}

		let hitId: string | null = null;
		let hitType: string | null = null;

		if (this.state.phase === 'center_point') {
			const nearPoint = this.ctx.findPointNear(e.screen, 18);
			if (nearPoint) {
				hitId = nearPoint.id;
				hitType = 'point';
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
			if (this.state.phase === 'center_point') {
				if (hitType === 'point') {
					this.state.centerPointId = hitId;
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			} else {
				if (this.state.selectedObjectIds.has(hitId)) {
					this.state.selectedObjectIds.delete(hitId);
				} else {
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
				this.state.selectedObjectIds.add(item.id);
			}
			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	executeCircularPattern(): boolean {
		if (!this.state) return false;
		const { selectedObjectIds, centerPointId, distribution, angle, quantity, suppression, suppressedIndices } =
			this.state;
		if (selectedObjectIds.size === 0 || !centerPointId) {
			this.ctx.showToast('Select objects and a center point');
			return false;
		}

		const centerPt = this.ctx.sketch.points.get(centerPointId);
		if (!centerPt) {
			this.ctx.showToast('Center point not found');
			return false;
		}

		const N = Math.max(2, Math.round(quantity));
		if (distribution !== 'full' && (isNaN(angle) || Math.abs(angle) < 1e-3)) {
			this.ctx.showToast('Specify a non-zero angle');
			return false;
		}

		this.ctx.sketch.beginTransaction();

		const copies = [];
		let totalCreated = 0;

		for (let k = 1; k < N; k++) {
			if (suppression && suppressedIndices.has(k)) continue;
			const copy = this.ctx.sketch.generatePatternCopy(
				centerPointId,
				Array.from(selectedObjectIds),
				k,
				N,
				distribution,
				angle
			);
			if (copy) {
				copies.push(copy);
				totalCreated += copy.createdEntityIds.length;
			}
		}

		if (copies.length === 0) {
			this.ctx.showToast('All pattern copies are suppressed');
			this.ctx.sketch.rollbackTransaction();
			return false;
		}

		const constraint = this.ctx.sketch.addCircularPatternConstraint(
			centerPointId,
			Array.from(selectedObjectIds),
			distribution,
			angle,
			N,
			suppression,
			Array.from(suppressedIndices),
			copies
		);

		this.ctx.sketch.commitTransaction();
		this.ctx.sketch.solve();

		this.state = null;
		this.onStateChange?.();
		this.ctx.setTool('select');

		if (constraint) {
			this.ctx.sketch.selectEntity(constraint.id, 'constraint', false);
		}

		this.ctx.showToast(`Circular pattern created (${copies.length} copies)`);
		this.ctx.requestRender();
		return true;
	}

	override getRenderOptions(): Record<string, unknown> {
		if (!this.state) return {};
		return {
			patternHighlight: {
				selectedObjectIds: this.state.selectedObjectIds,
				centerPointId: this.state.centerPointId,
				distribution: this.state.distribution,
				angle: this.state.angle,
				quantity: this.state.quantity,
				suppression: this.state.suppression,
				suppressedIndices: this.state.suppressedIndices,
			},
		};
	}
}

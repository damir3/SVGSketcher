import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import { dist, type Vec2 } from '../../../math/vector';
import {
	computeRectangularPatternDirections,
	type RectangularPatternCopyData,
} from '../../../solver/constraints/rectangularPattern';
import { calculateObjectsCentroid } from './utils';

export interface RectangularPatternState {
	phase: 'objects' | 'direction1' | 'direction2';
	selectedObjectIds: Set<string>;
	line1Id: string | null;
	line2Id: string | null;
	quantity1: number;
	distance1: number;
	direction1: 'one_direction' | 'symmetric';
	quantity2: number;
	distance2: number;
	direction2: 'one_direction' | 'symmetric';
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export class RectangularPatternTool extends BaseTool {
	readonly id = 'rectangular_pattern' as const;

	state: RectangularPatternState | null = null;
	onStateChange?: () => void;

	private gizmoDragState: {
		axis: 1 | 2;
		startMouseWorld: Vec2;
		centroidWorld: Vec2;
		u: Vec2;
		startDistance: number;
	} | null = null;

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
			phase: initialObjects.size > 0 ? 'direction1' : 'objects',
			selectedObjectIds: initialObjects,
			line1Id: null,
			line2Id: null,
			quantity1: 3,
			distance1: 0,
			direction1: 'one_direction',
			quantity2: 3,
			distance2: 0,
			direction2: 'one_direction',
			suppression: false,
			suppressedIndices: new Set<number>(),
		};
		ctx.sketch.clearSelection();
		this.onStateChange?.();
	}

	override deactivate(): void {
		this.state = null;
		this.gizmoDragState = null;
		this.onStateChange?.();
	}

	override isBusy(): boolean {
		return Boolean(
			this.state &&
				(this.state.selectedObjectIds.size > 0 ||
					this.state.line1Id ||
					this.state.line2Id ||
					this.gizmoDragState)
		);
	}

	setPhase(phase: 'objects' | 'direction1' | 'direction2'): void {
		if (this.state) {
			this.state.phase = phase;
			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	override cancel(): void {
		this.state = null;
		this.gizmoDragState = null;
		this.onStateChange?.();
		this.ctx.setTool('select');
		this.ctx.requestRender();
	}

	override commit(): void {
		this.executeRectangularPattern();
	}

	override onMouseDown(e: ToolMouseEvent): boolean | void {
		if (!this.state) {
			this.state = {
				phase: 'objects',
				selectedObjectIds: new Set(),
				line1Id: null,
				line2Id: null,
				quantity1: 3,
				distance1: 0,
				direction1: 'one_direction',
				quantity2: 3,
				distance2: 0,
				direction2: 'one_direction',
				suppression: false,
				suppressedIndices: new Set(),
			};
		}

		// 1. Gizmo handle dragging hit-test
		if (this.ctx.renderer?.rectangularGizmoHandles) {
			for (const handle of this.ctx.renderer.rectangularGizmoHandles.values()) {
				if (!handle.constraintId && dist(e.screen, { x: handle.x, y: handle.y }) <= 18) {
					const startDistance = handle.axis === 1 ? this.state.distance1 : this.state.distance2;
					const paramMap = new Map<string, number>();
					for (const [pid, pt] of this.ctx.sketch.points.entries()) {
						paramMap.set(`${pid}.x`, pt.x);
						paramMap.set(`${pid}.y`, pt.y);
					}
					const line1 = this.state.line1Id ? this.ctx.sketch.lines.get(this.state.line1Id) : null;
					const line2 = this.state.line2Id ? this.ctx.sketch.lines.get(this.state.line2Id) : null;
					const dirs = computeRectangularPatternDirections(
						paramMap,
						line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
						line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
					);
					const u = handle.axis === 1 ? dirs.u1 : dirs.u2;
					const centroidWorld = calculateObjectsCentroid(this.ctx.sketch, this.state.selectedObjectIds);

					if (centroidWorld && u) {
						this.gizmoDragState = {
							axis: handle.axis,
							startMouseWorld: e.world,
							centroidWorld,
							u,
							startDistance,
						};
						return true;
					}
				}
			}
		}

		// 2. Suppression checkbox click hit-test
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

		if (this.state.phase === 'direction1' || this.state.phase === 'direction2') {
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
			if (this.state.phase === 'direction1') {
				if (hitType === 'line') {
					if (this.state.line1Id === hitId) {
						this.state.line1Id = null;
					} else {
						this.state.line1Id = hitId;
						this.state.selectedObjectIds.delete(hitId);
						if (this.state.line2Id === hitId) {
							this.state.line2Id = null;
						}
						this.state.phase = 'direction2';
					}
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			} else if (this.state.phase === 'direction2') {
				if (hitType === 'line') {
					if (this.state.line2Id === hitId) {
						this.state.line2Id = null;
					} else {
						this.state.line2Id = hitId;
						this.state.selectedObjectIds.delete(hitId);
						if (this.state.line1Id === hitId) {
							this.state.line1Id = null;
						}
					}
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			} else {
				if (this.state.selectedObjectIds.has(hitId)) {
					this.state.selectedObjectIds.delete(hitId);
				} else {
					if (this.state.line1Id === hitId) {
						this.state.line1Id = null;
					}
					if (this.state.line2Id === hitId) {
						this.state.line2Id = null;
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

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.gizmoDragState && this.state) {
			const { axis, centroidWorld, u, startMouseWorld, startDistance } = this.gizmoDragState;
			const startProj = (startMouseWorld.x - centroidWorld.x) * u.x + (startMouseWorld.y - centroidWorld.y) * u.y;
			const currentProj = (e.world.x - centroidWorld.x) * u.x + (e.world.y - centroidWorld.y) * u.y;
			const delta = currentProj - startProj;
			let newDist = startDistance + delta;
			if (Math.abs(newDist) < 0.25) {
				newDist = 0;
			} else {
				newDist = Math.round(newDist * 2) / 2;
			}

			if (axis === 1) {
				this.state.distance1 = newDist;
			} else {
				this.state.distance2 = newDist;
			}
			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		if (this.gizmoDragState) {
			this.gizmoDragState = null;
		}
	}

	handleBoxSelect(itemsToSelect: Array<{ id: string }>): void {
		if (this.state && this.state.phase === 'objects') {
			for (const item of itemsToSelect) {
				if (item.id !== this.state.line1Id && item.id !== this.state.line2Id) {
					this.state.selectedObjectIds.add(item.id);
				}
			}
			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	executeRectangularPattern(): boolean {
		if (!this.state) return false;
		const state = this.state;
		if (state.selectedObjectIds.size === 0) {
			this.ctx.showToast('Select objects to pattern');
			return false;
		}

		const maxI = Math.abs(state.distance1) > 1e-6 ? state.quantity1 : 1;
		const maxJ = Math.abs(state.distance2) > 1e-6 ? state.quantity2 : 1;

		if (maxI <= 1 && maxJ <= 1) {
			this.ctx.showToast('Specify non-zero distance for at least one direction');
			return false;
		}

		const paramMap = new Map<string, number>();
		for (const [pid, pt] of this.ctx.sketch.points.entries()) {
			paramMap.set(`${pid}.x`, pt.x);
			paramMap.set(`${pid}.y`, pt.y);
		}
		const line1 = state.line1Id ? this.ctx.sketch.lines.get(state.line1Id) : null;
		const line2 = state.line2Id ? this.ctx.sketch.lines.get(state.line2Id) : null;
		const { u1, u2 } = computeRectangularPatternDirections(
			paramMap,
			line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
			line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
		);

		this.ctx.sketch.beginTransaction();

		const copies: RectangularPatternCopyData[] = [];
		for (let i = 0; i < maxI; i++) {
			for (let j = 0; j < maxJ; j++) {
				if (i === 0 && j === 0) continue;
				const copyIndex = i * 1000 + j;
				if (state.suppression && state.suppressedIndices.has(copyIndex)) continue;

				const copy = this.ctx.sketch.generateRectangularPatternCopy(
					Array.from(state.selectedObjectIds),
					i,
					j,
					state.distance1,
					state.direction1,
					state.distance2,
					state.direction2,
					u1,
					u2
				);
				if (copy) {
					copies.push(copy);
				}
			}
		}

		if (copies.length === 0) {
			this.ctx.showToast('All pattern copies are suppressed');
			this.ctx.sketch.rollbackTransaction();
			return false;
		}

		const constraint = this.ctx.sketch.addRectangularPatternConstraint(
			Array.from(state.selectedObjectIds),
			state.line1Id,
			state.line2Id,
			state.quantity1,
			state.distance1,
			state.direction1,
			state.quantity2,
			state.distance2,
			state.direction2,
			state.suppression,
			Array.from(state.suppressedIndices),
			copies
		);

		this.ctx.sketch.commitTransaction();
		this.ctx.sketch.solve();

		this.state = null;
		this.gizmoDragState = null;
		this.onStateChange?.();
		this.ctx.setTool('select');

		if (constraint) {
			this.ctx.sketch.selectEntity(constraint.id, 'constraint', false);
		}

		this.ctx.showToast(`Rectangular pattern created (${copies.length} copies)`);
		this.ctx.requestRender();
		return true;
	}

	override getRenderOptions(): Record<string, unknown> {
		if (!this.state) return {};
		return {
			rectangularPatternHighlight: {
				selectedObjectIds: this.state.selectedObjectIds,
				line1Id: this.state.line1Id,
				line2Id: this.state.line2Id,
				quantity1: this.state.quantity1,
				distance1: this.state.distance1,
				direction1: this.state.direction1,
				quantity2: this.state.quantity2,
				distance2: this.state.distance2,
				direction2: this.state.direction2,
				suppression: this.state.suppression,
				suppressedIndices: this.state.suppressedIndices,
			},
		};
	}
}

import { prepareCopies } from '../../../model/copyGeometry';
import { patternDirections as computeRectangularPatternDirections } from '../../../math/copyGeometry';
import { LINE_DISTANCE_PX } from '../../distances';
import { hitGizmoHandle } from '../../modifyPreviews';
import { AABB } from '../../../math/aabb';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import { Vec2 } from '../../../math/vector';
import { type RectangularPatternCopyData } from '../../../solver/constraints/rectangularPattern';
import {
	calculateObjectsCentroid,
	collectPatternCheckboxesToAABB,
	findPatternCheckboxAtScreen,
	findTransformObjectId,
	formatLineLengthLabel,
	togglePatternCheckboxAtScreen,
} from './utils';
import { ModifyToolPanel } from '../../../ui/panels/tools';
import { ToolPopup, type ScreenBoundingBox } from '../../../ui/tool-popup';

export interface RectangularPatternState {
	phase: 'objects' | 'direction1' | 'direction2';
	selectedObjectIds: Set<string>;
	line1Id: string | null;
	line2Id: string | null;
	distType?: 'spacing' | 'distance';
	quantity1: number;
	distance1: number;
	distance1Expression?: string;
	direction1: 'one_direction' | 'symmetric';
	quantity2: number;
	distance2: number;
	distance2Expression?: string;
	direction2: 'one_direction' | 'symmetric';
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export class RectangularPatternTool extends BaseTool {
	readonly id = 'rectangular_pattern' as const;
	readonly popup: ToolPopup<'dist1' | 'qty1' | 'dist2' | 'qty2'>;
	readonly sidebarPanel: ModifyToolPanel = new ModifyToolPanel({
		iconName: 'rectangular_pattern',
		title: 'Rectangular Pattern',
		description: 'Create linear or 2D grid copies along direction axes.',
		steps: [
			{
				id: 'objects',
				num: 1,
				title: 'Objects to Pattern',
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
						this.updatePopupPosition();
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
			},
			{
				id: 'dir1',
				num: 2,
				title: 'Direction 1',
				getValue: () => formatLineLengthLabel(this.ctx?.sketch, this.state?.line1Id, 'Default: X-Axis (1, 0)'),
				isSelected: () => Boolean(this.state?.line1Id),
				isActive: () => this.state?.phase === 'direction1',
				showClear: () => Boolean(this.state?.line1Id),
				clearTitle: 'Reset to X-Axis',
				onSelect: () => this.setPhase('direction1'),
				onClear: () => this.clearDirectionLine(1),
			},
			{
				id: 'dir2',
				num: 3,
				title: 'Direction 2',
				getValue: () =>
					formatLineLengthLabel(
						this.ctx?.sketch,
						this.state?.line2Id,
						this.state?.line1Id ? 'Default: Perpendicular' : 'Default: Y-Axis (0, 1)'
					),
				isSelected: () => Boolean(this.state?.line2Id),
				isActive: () => this.state?.phase === 'direction2',
				showClear: () => Boolean(this.state?.line2Id),
				clearTitle: 'Reset to Perpendicular',
				onSelect: () => this.setPhase('direction2'),
				onClear: () => this.clearDirectionLine(2),
			},
		],
		params: [
			...([1, 2] as const).flatMap(axis => {
				const dirKey = axis === 1 ? 'direction1' : 'direction2';
				const distKey = axis === 1 ? 'distance1' : 'distance2';
				const qtyKey = axis === 1 ? 'quantity1' : 'quantity2';
				const popupQty = axis === 1 ? 'qty1' : 'qty2';
				const setQty = (val: number) => {
					if (!this.state) return;
					const qty = Math.max(1, Math.floor(val));
					this.state[qtyKey] = qty;
					this.popup.setValue(popupQty, qty);
					this.ctx?.requestRender();
				};
				const setDist = (val: number) => {
					if (!this.state) return;
					this.state[distKey] = val;
					this.ctx?.requestRender();
				};
				return [
					{ type: 'header' as const, label: `AXIS ${axis}`, marginTop: axis === 1 ? '2px' : '6px' },
					{
						type: 'segmented' as const,
						label: 'Direction',
						options: [
							{ id: 'one_direction', label: 'One Direction' },
							{ id: 'symmetric', label: 'Symmetric' },
						],
						getValue: () => this.state?.[dirKey] ?? 'one_direction',
						onSelect: (val: string) => {
							if (this.state) {
								this.state[dirKey] = val as any;
								this.ctx?.requestRender();
								this.onStateChange?.();
							}
						},
					},
					{
						type: 'field' as const,
						id: `input-rpat-dist${axis}`,
						label: 'Distance',
						unit: 'mm',
						step: 0.5,
						getValue: () => this.state?.[distKey] ?? 0,
						onInput: setDist,
						onChange: setDist,
					},
					{
						type: 'field' as const,
						id: `input-rpat-qty${axis}`,
						label: 'Quantity',
						min: 1,
						max: 100,
						step: 1,
						getValue: () => this.state?.[qtyKey] ?? 3,
						onInput: setQty,
						onChange: setQty,
					},
				];
			}),
			{
				type: 'checkbox',
				id: 'check-rpat-suppression',
				label: 'Suppression',
				marginTop: '6px',
				badge: () => {
					const counts = this.getCopyCounts();
					return counts ? `${counts.active} of ${counts.total} enabled` : '';
				},
				isChecked: () => this.state?.suppression ?? false,
				onChange: checked => {
					if (this.state) {
						this.state.suppression = checked;
						if (!checked) this.state.suppressedIndices.clear();
						this.ctx?.requestRender();
						this.onStateChange?.();
					}
				},
			},
		],
		canApply: () => {
			const counts = this.getCopyCounts();
			return Boolean(
				this.state && this.state.selectedObjectIds.size > 0 && counts && counts.total > 0 && counts.active > 0
			);
		},
		applyLabel: 'Apply Pattern',
		onApply: () => this.executeRectangularPattern(),
		onCancel: () => {
			this.cancel();
			this.ctx?.setTool('select');
		},
		getHint: () => {
			const state = this.state;
			const objCount = state?.selectedObjectIds.size ?? 0;
			const dist1 = state?.distance1 ?? 0;
			const dist2 = state?.distance2 ?? 0;
			if (objCount === 0) return 'Select geometry in canvas to pattern.';
			if (Math.abs(dist1) < 1e-6 && Math.abs(dist2) < 1e-6) return 'Set distance or drag the in-canvas gizmo arrow.';
			return 'Ready to apply! Press Enter or click Apply Pattern.';
		},
		bindStateChange: cb => {
			this.onStateChange = cb;
		},
	});

	state: RectangularPatternState | null = null;
	onStateChange?: () => void;

	private gizmoDragState: {
		axis: 1 | 2;
		startMouseWorld: Vec2;
		centroidWorld: Vec2;
		u: Vec2;
		startDistance: number;
	} | null = null;

	constructor() {
		super();
		this.popup = new ToolPopup<'dist1' | 'qty1' | 'dist2' | 'qty2'>({
			className: 'pattern-popup rectangular-pattern-popup',
			fields: [
				{
					id: 'dist1',
					label: 'Dist 1',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 0,
					step: 0.5,
				},
				{
					id: 'qty1',
					label: 'Qty 1',
					type: 'integer',
					defaultValue: 3,
					min: 1,
					max: 100,
					step: 1,
				},
				{
					id: 'dist2',
					label: 'Dist 2',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 0,
					step: 0.5,
				},
				{
					id: 'qty2',
					label: 'Qty 2',
					type: 'integer',
					defaultValue: 3,
					min: 1,
					max: 100,
					step: 1,
				},
			],
			onKeyDown: e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.executeRectangularPattern();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					this.cancel();
				}
			},
		});

		this.popup.onChange = () => {
			if (!this.state) return;
			const dist1 = this.popup.getNumericValue('dist1', this.state.distance1);
			const qty1 = Math.max(1, Math.round(this.popup.getNumericValue('qty1', this.state.quantity1)));
			const dist2 = this.popup.getNumericValue('dist2', this.state.distance2);
			const qty2 = Math.max(1, Math.round(this.popup.getNumericValue('qty2', this.state.quantity2)));

			this.state.distance1 = dist1;
			this.state.quantity1 = qty1;
			this.state.distance1Expression = this.popup.getExpression('dist1');
			this.state.distance2 = dist2;
			this.state.quantity2 = qty2;
			this.state.distance2Expression = this.popup.getExpression('dist2');

			this.onStateChange?.();
			this.ctx?.requestRender();
		};

		this.popup.onCommit = () => {
			this.executeRectangularPattern();
		};

		this.popup.onCancel = () => {
			this.cancel();
		};
	}

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.popup.setSketch(this.ctx.sketch);

		const initialObjects = new Set(ctx.sketch.getSelectedPrimitives().map(primitive => primitive.id));

		this.state = {
			phase: initialObjects.size > 0 ? 'direction1' : 'objects',
			selectedObjectIds: initialObjects,
			line1Id: null,
			line2Id: null,
			distType: 'spacing',
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
		this.updatePopupPosition();
		this.onStateChange?.();
	}

	override deactivate(): void {
		this.popup.hide();
		this.state = null;
		this.gizmoDragState = null;
		this.onStateChange?.();
	}

	override isBusy(): boolean {
		return Boolean(
			this.state &&
				(this.state.selectedObjectIds.size > 0 || this.state.line1Id || this.state.line2Id || this.gizmoDragState)
		);
	}

	setPhase(phase: 'objects' | 'direction1' | 'direction2'): void {
		if (this.state) {
			this.state.phase = phase;
			this.onStateChange?.();
			this.ctx?.highlightManager?.refresh(this);
			this.ctx.requestRender();
		}
	}

	override isHighlightEnabled(screen?: Vec2): boolean {
		if (this.gizmoDragState !== null) return false;
		if (
			screen &&
			hitGizmoHandle(
				screen,
				this.ctx?.renderer?.rectangularGizmoHandles?.values(),
				LINE_DISTANCE_PX,
				h => !h.constraintId
			)
		) {
			return false;
		}
		if (screen && this.state?.suppression && findPatternCheckboxAtScreen(this.ctx, screen)) {
			return false;
		}
		return true;
	}

	private clearDirectionLine(axis: 1 | 2): void {
		if (!this.state) return;
		if (axis === 1) this.state.line1Id = null;
		else this.state.line2Id = null;
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	private getCopyCounts(): { total: number; active: number } | null {
		const state = this.state;
		if (!state) return null;
		const maxI = Math.abs(state.distance1) > 1e-6 ? state.quantity1 : 1;
		const maxJ = Math.abs(state.distance2) > 1e-6 ? state.quantity2 : 1;
		let total = 0;
		let suppressed = 0;
		for (let i = 0; i < maxI; i++) {
			for (let j = 0; j < maxJ; j++) {
				if (i === 0 && j === 0) continue;
				total++;
				if (state.suppression && state.suppressedIndices.has(i * 1000 + j)) suppressed++;
			}
		}
		return { total, active: total - suppressed };
	}

	private computeDirections() {
		const paramMap = new Map<string, number>();
		for (const [pid, pt] of this.ctx.sketch.points.entries()) {
			paramMap.set(`${pid}.x`, pt.x);
			paramMap.set(`${pid}.y`, pt.y);
		}
		const line1 = this.state?.line1Id ? this.ctx.sketch.lines.get(this.state.line1Id) : null;
		const line2 = this.state?.line2Id ? this.ctx.sketch.lines.get(this.state.line2Id) : null;
		return computeRectangularPatternDirections(
			paramMap,
			line1 ? { p1Id: line1.p1Id, p2Id: line1.p2Id } : null,
			line2 ? { p1Id: line2.p1Id, p2Id: line2.p2Id } : null
		);
	}

	override canHighlight(target: HoverTarget): boolean {
		if (target.type === 'constraint') return false;
		if (this.state?.phase === 'direction1' || this.state?.phase === 'direction2') {
			return target.type === 'line';
		}
		return true;
	}

	override getHoverTargetOptions(): FindHoverTargetOptions {
		return { allowSplineHandles: false };
	}

	override cancel(): void {
		this.popup.hide();
		this.state = null;
		this.gizmoDragState = null;
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	getGizmoBoundingBox(): ScreenBoundingBox | null {
		if (!this.state || this.state.selectedObjectIds.size === 0 || !this.ctx) {
			return null;
		}

		const centroidWorld = calculateObjectsCentroid(this.ctx.sketch, this.state.selectedObjectIds);
		if (!centroidWorld) return null;

		const sCentroid = this.ctx.viewport.worldToScreen(centroidWorld);
		const pts: Vec2[] = [sCentroid];

		let hasHandles = false;
		if (this.ctx.renderer?.rectangularGizmoHandles) {
			for (const handle of this.ctx.renderer.rectangularGizmoHandles.values()) {
				if (!handle.constraintId) {
					hasHandles = true;
					pts.push(Vec2.from(handle).subScalar(20), Vec2.from(handle).addScalar(20));
				}
			}
		}

		if (!hasHandles) {
			const { u1, u2 } = this.computeDirections();

			const p1 = this.ctx.viewport.worldToScreen(centroidWorld.clone().addScaledVector(u1, this.state.distance1));
			const p2 = this.ctx.viewport.worldToScreen(centroidWorld.clone().addScaledVector(u2, this.state.distance2));
			pts.push(p1.clone().subScalar(48), p1.clone().addScalar(48), p2.clone().subScalar(48), p2.clone().addScalar(48));
		}

		collectPatternCheckboxesToAABB(this.ctx, this.state.suppression, pts);

		return AABB.fromPoints(pts);
	}

	updatePopupPosition(): void {
		if (!this.state || this.state.selectedObjectIds.size === 0 || !this.ctx) {
			this.popup.hide();
			return;
		}
		const bbox = this.getGizmoBoundingBox();
		if (bbox) {
			if (!this.popup.isOpen()) {
				this.popup.setValue('dist1', this.state.distance1Expression ?? this.state.distance1);
				this.popup.setValue('qty1', this.state.quantity1);
				this.popup.setValue('dist2', this.state.distance2Expression ?? this.state.distance2);
				this.popup.setValue('qty2', this.state.quantity2);
				this.popup.show(bbox);
			} else {
				this.popup.updatePosition(bbox);
			}
		}
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
		const gizmoHandle = hitGizmoHandle(
			e.screen,
			this.ctx.renderer?.rectangularGizmoHandles?.values(),
			LINE_DISTANCE_PX,
			h => !h.constraintId
		);
		if (gizmoHandle) {
			const startDistance = gizmoHandle.axis === 1 ? this.state.distance1 : this.state.distance2;
			const dirs = this.computeDirections();
			const u = gizmoHandle.axis === 1 ? dirs.u1 : dirs.u2;
			const centroidWorld = calculateObjectsCentroid(this.ctx.sketch, this.state.selectedObjectIds);

			if (centroidWorld && u) {
				this.gizmoDragState = {
					axis: gizmoHandle.axis,
					startMouseWorld: e.world,
					centroidWorld,
					u,
					startDistance,
				};
				return true;
			}
		}

		// 2. Suppression checkbox click hit-test
		if (
			togglePatternCheckboxAtScreen(this.ctx, this.state, e.screen, () => {
				this.onStateChange?.();
				this.ctx.requestRender();
			})
		) {
			return true;
		}

		let hitId: string | null = null;
		let hitType: string | null = null;

		if (this.state.phase === 'direction1' || this.state.phase === 'direction2') {
			const hitLine = this.ctx.findLineNear(e.screen);
			if (hitLine && !hitLine.isSplineHandle) {
				hitId = hitLine.id;
				hitType = 'line';
			}
		} else {
			hitId = findTransformObjectId(this.ctx, e.screen);
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
				this.updatePopupPosition();
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
			const startProj = new Vec2().subVectors(startMouseWorld, centroidWorld).dot(u);
			const currentProj = new Vec2().subVectors(e.world, centroidWorld).dot(u);
			const delta = currentProj - startProj;
			let newDist = startDistance + delta;
			if (Math.abs(newDist) < 0.25) {
				newDist = 0;
			} else {
				newDist = Math.round(newDist * 2) / 2;
			}

			if (axis === 1) {
				this.state.distance1 = newDist;
				this.state.distance1Expression = undefined;
				this.popup.setValue('dist1', newDist);
			} else {
				this.state.distance2 = newDist;
				this.state.distance2Expression = undefined;
				this.popup.setValue('dist2', newDist);
			}
			this.updatePopupPosition();
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
			this.updatePopupPosition();
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

		this.popup.hide();

		const maxI = Math.abs(state.distance1) > 1e-6 ? state.quantity1 : 1;
		const maxJ = Math.abs(state.distance2) > 1e-6 ? state.quantity2 : 1;

		if (maxI <= 1 && maxJ <= 1) {
			this.ctx.showToast('Specify non-zero distance for at least one direction');
			return false;
		}

		const { u1, u2 } = this.computeDirections();

		const indices: Array<{ i: number; j: number }> = [];
		for (let i = 0; i < maxI; i++)
			for (let j = 0; j < maxJ; j++)
				if ((i || j) && (!state.suppression || !state.suppressedIndices.has(i * 1000 + j))) indices.push({ i, j });
		const results = prepareCopies(
			this.ctx.sketch,
			state.selectedObjectIds,
			indices.map(({ i, j }) => ({
				type: 'rectangular' as const,
				i,
				j,
				distance1: state.distance1,
				direction1: state.direction1,
				distance2: state.distance2,
				direction2: state.direction2,
				u1,
				u2,
			}))
		);
		const prepared = new Map(indices.map(({ i, j }, k) => [`${i},${j}`, results[k]]));
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
					u2,
					prepared.get(`${i},${j}`)
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
			copies,
			undefined,
			state.distance1Expression,
			state.distance2Expression
		);

		this.ctx.sketch.solve();
		this.ctx.sketch.commitTransaction();

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

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab' && this.popup.isOpen()) {
			e.preventDefault();
			this.popup.focus();
			return true;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			this.executeRectangularPattern();
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			this.cancel();
			return true;
		}
		return super.onKeyDown(e);
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

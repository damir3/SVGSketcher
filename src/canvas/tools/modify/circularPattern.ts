import { LABEL_DISTANCE_PX, LINE_DISTANCE_PX } from '../../distances';
import { AABB } from '../../../math/aabb';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent } from '../types';
import type { HoverTarget, FindHoverTargetOptions } from '../hoverTarget';
import { Vec2 } from '../../../math/vector';
import { ModifyToolPanel } from '../../../ui/panels/tools';
import { ToolPopup, type ScreenBoundingBox } from '../../../ui/tool-popup';
import { calculateObjectsCentroid, findTransformObjectId } from './utils';
import { computePatternCopyAngle } from '../../../solver/constraints';

export interface CircularPatternState {
	phase: 'objects' | 'center_point';
	selectedObjectIds: Set<string>;
	centerPointId: string | null;
	distribution: 'full' | 'partial' | 'symmetric';
	angle: number;
	angleExpression?: string;
	quantity: number;
	suppression: boolean;
	suppressedIndices: Set<number>;
}

export class CircularPatternTool extends BaseTool {
	readonly id = 'circular_pattern' as const;
	readonly popup: ToolPopup<'angle' | 'quantity'>;
	readonly sidebarPanel: ModifyToolPanel = new ModifyToolPanel({
		iconName: 'circular_pattern',
		title: 'Circular Pattern',
		description: 'Rotate copies of geometry around a center point.',
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
				id: 'center_point',
				num: 2,
				title: 'Center Point',
				getValue: () => {
					const centerPointId = this.state?.centerPointId;
					if (!centerPointId) return 'Click a point in canvas';
					if (centerPointId === 'origin') return 'Origin (0, 0)';
					if (this.ctx?.sketch) {
						const pt = this.ctx.sketch.points.get(centerPointId);
						if (pt) return `Point (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`;
					}
					return centerPointId;
				},
				isSelected: () => Boolean(this.state?.centerPointId),
				isActive: () => this.state?.phase === 'center_point',
				showClear: () => Boolean(this.state?.centerPointId),
				clearTitle: 'Clear center point',
				onSelect: () => this.setPhase('center_point'),
				onClear: () => {
					if (this.state) {
						this.state.centerPointId = null;
						this.updatePopupPosition();
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
			},
		],
		params: [
			{
				type: 'segmented',
				label: 'Distribution',
				options: [
					{ id: 'full', label: 'Full' },
					{ id: 'partial', label: 'Partial' },
					{ id: 'symmetric', label: 'Symmetric' },
				],
				getValue: () => this.state?.distribution ?? 'full',
				onSelect: val => {
					if (this.state) {
						this.state.distribution = val as any;
						this.popup.setFieldVisible('angle', val !== 'full');
						this.ctx?.requestRender();
						this.onStateChange?.();
					}
				},
			},
			{
				type: 'field',
				id: 'input-cpat-angle',
				label: 'Total Angle',
				unit: '°',
				min: -360,
				max: 360,
				step: 5,
				isVisible: () => this.state?.distribution !== 'full',
				getValue: () => this.state?.angle ?? 180,
				onInput: val => {
					if (this.state) {
						this.state.angle = val;
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
				onChange: val => {
					if (this.state) {
						this.state.angle = val;
						this.onStateChange?.();
						this.ctx?.requestRender();
					}
				},
			},
			{
				type: 'field',
				id: 'input-cpat-quantity',
				label: 'Quantity',
				min: 2,
				max: 100,
				step: 1,
				getValue: () => this.state?.quantity ?? 3,
				onInput: val => {
					if (this.state) {
						const qty = Math.max(2, Math.floor(val));
						this.state.quantity = qty;
						this.popup.setValue('quantity', qty);
						this.ctx?.requestRender();
					}
				},
				onChange: val => {
					if (this.state) {
						const qty = Math.max(2, Math.floor(val));
						this.state.quantity = qty;
						this.popup.setValue('quantity', qty);
						this.ctx?.requestRender();
					}
				},
			},
			{
				type: 'checkbox',
				id: 'check-cpat-suppression',
				label: 'Suppression',
				badge: () => {
					const qty = this.state?.quantity ?? 3;
					const total = Math.max(1, qty - 1);
					const active = total - (this.state?.suppressedIndices.size ?? 0);
					return `${active} of ${total} enabled`;
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
			const state = this.state;
			if (!state) return false;
			const objCount = state.selectedObjectIds.size;
			const totalCopies = Math.max(1, state.quantity - 1);
			const activeCopies = totalCopies - state.suppressedIndices.size;
			return (
				objCount > 0 &&
				!!state.centerPointId &&
				activeCopies > 0 &&
				(state.distribution === 'full' || (!isNaN(state.angle) && Math.abs(state.angle) > 1e-3))
			);
		},
		applyLabel: 'Apply Pattern',
		onApply: () => this.executeCircularPattern(),
		onCancel: () => {
			this.cancel();
			this.ctx?.setTool('select');
		},
		getHint: () => {
			const centerPointId = this.state?.centerPointId;
			const objCount = this.state?.selectedObjectIds.size ?? 0;
			if (!centerPointId && objCount === 0) return 'Select objects first, then pick a center point.';
			if (!centerPointId) return 'Click a point in the canvas to set the rotation center.';
			if (objCount === 0) return 'Pick geometry in the canvas to pattern.';
			return 'Ready to apply! Press Enter or click Apply Pattern.';
		},
		bindStateChange: cb => {
			this.onStateChange = cb;
		},
	});

	state: CircularPatternState | null = null;
	onStateChange?: () => void;
	private angleDrag: {
		previousPointerAngle: number;
		accumulatedDelta: number;
		startAngle: number;
	} | null = null;

	constructor() {
		super();
		this.popup = new ToolPopup<'angle' | 'quantity'>({
			className: 'pattern-popup circular-pattern-popup',
			bboxOffset: new Vec2(150, 0),
			fields: [
				{
					id: 'angle',
					label: 'Angle',
					type: 'dimension',
					unit: '°',
					defaultValue: 180,
					min: -360,
					max: 360,
					step: 5,
				},
				{
					id: 'quantity',
					label: 'Quantity',
					type: 'integer',
					defaultValue: 3,
					min: 2,
					max: 100,
					step: 1,
				},
			],
			onKeyDown: e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.executeCircularPattern();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					this.cancel();
				}
			},
		});

		this.popup.onChange = () => {
			if (!this.state) return;
			const angle = this.popup.getNumericValue('angle', this.state.angle);
			const qty = Math.max(2, Math.round(this.popup.getNumericValue('quantity', this.state.quantity)));

			this.state.angle = angle;
			this.state.quantity = qty;
			this.state.angleExpression = this.popup.getExpression('angle');

			this.onStateChange?.();
			this.ctx?.requestRender();
		};

		this.popup.onCommit = () => {
			this.executeCircularPattern();
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
			phase: initialObjects.size > 0 ? 'center_point' : 'objects',
			selectedObjectIds: initialObjects,
			centerPointId: null,
			distribution: 'full',
			angle: 180,
			quantity: 3,
			suppression: false,
			suppressedIndices: new Set<number>(),
		};
		this.updatePopupPosition();
		this.onStateChange?.();
	}

	override deactivate(): void {
		this.popup.hide();
		this.state = null;
		this.onStateChange?.();
	}

	override cancel(): void {
		this.popup.hide();
		this.state = null;
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override isBusy(): boolean {
		return Boolean(this.state && (this.state.selectedObjectIds.size > 0 || this.state.centerPointId));
	}

	override isHighlightEnabled(screen?: Vec2): boolean {
		if (screen && this.state?.suppression && this.ctx?.renderer?.patternCheckboxPositions) {
			for (const entry of this.ctx.renderer.patternCheckboxPositions.values()) {
				if (
					!entry.constraintId &&
					Math.abs(screen.x - entry.x) <= LABEL_DISTANCE_PX &&
					Math.abs(screen.y - entry.y) <= LABEL_DISTANCE_PX
				) {
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

	getGizmoBoundingBox(): ScreenBoundingBox | null {
		if (!this.state || this.state.selectedObjectIds.size === 0 || !this.ctx) {
			return null;
		}

		const pts: Vec2[] = [];

		if (this.state.centerPointId) {
			const pt = this.ctx.sketch.points.get(this.state.centerPointId);
			if (pt) {
				const sCenter = this.ctx.viewport.worldToScreen(pt);
				pts.push(sCenter.clone().subScalar(20), sCenter.clone().addScalar(20));
			}
		}

		const centroid = calculateObjectsCentroid(this.ctx.sketch, this.state.selectedObjectIds);
		const center = this.state.centerPointId ? this.ctx.sketch.points.get(this.state.centerPointId) : null;
		if (centroid) {
			pts.push(this.ctx.viewport.worldToScreen(centroid));
			if (center) {
				const bboxQuantity = 12;
				for (let k = 1; k < bboxQuantity; k++) {
					const radians =
						(computePatternCopyAngle(k, bboxQuantity, this.state.distribution, this.state.angle) * Math.PI) / 180;
					const copy = centroid.clone().rotateAround(center, radians);
					const screen = this.ctx.viewport.worldToScreen(copy);
					pts.push(screen.clone().subScalar(14), screen.clone().addScalar(14));
				}
			}
		}

		if (pts.length === 0) return null;

		return AABB.fromPoints(pts);
	}

	updatePopupPosition(): void {
		if (!this.state || this.state.selectedObjectIds.size === 0 || !this.state.centerPointId || !this.ctx) {
			this.popup.hide();
			return;
		}
		const bbox = this.getGizmoBoundingBox();
		if (bbox) {
			this.popup.setFieldVisible('angle', this.state.distribution !== 'full');
			if (!this.popup.isOpen()) {
				this.popup.setValue('angle', this.state.angleExpression ?? this.state.angle);
				this.popup.setValue('quantity', this.state.quantity);
				this.popup.show(bbox);
			} else {
				this.popup.updatePosition(bbox);
			}
		}
	}

	setPhase(phase: 'objects' | 'center_point'): void {
		if (this.state) {
			this.state.phase = phase;
			this.onStateChange?.();
			this.ctx?.highlightManager?.refresh(this);
			this.ctx?.requestRender();
		}
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
		const angleHandle = this.ctx.renderer?.patternAngleHandle;
		if (this.state.distribution !== 'full' && angleHandle && e.screen.distanceTo(angleHandle) <= LINE_DISTANCE_PX) {
			const center = this.state.centerPointId ? this.ctx.sketch.points.get(this.state.centerPointId) : null;
			if (!center) return false;
			this.angleDrag = {
				previousPointerAngle: center.angleToPointDeg(e.world),
				accumulatedDelta: 0,
				startAngle: this.state.angle,
			};
			return true;
		}

		// 1. Suppression checkbox click hit-test
		if (this.state.suppression && this.ctx.renderer?.patternCheckboxPositions) {
			for (const entry of this.ctx.renderer.patternCheckboxPositions.values()) {
				if (
					!entry.constraintId &&
					Math.abs(e.screen.x - entry.x) <= LABEL_DISTANCE_PX &&
					Math.abs(e.screen.y - entry.y) <= LABEL_DISTANCE_PX
				) {
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
			const nearPoint = this.ctx.findPointNear(e.screen);
			if (nearPoint) {
				hitId = nearPoint.id;
				hitType = 'point';
			}
		} else {
			hitId = findTransformObjectId(this.ctx, e.screen);
		}

		if (hitId) {
			if (this.state.phase === 'center_point') {
				if (hitType === 'point') {
					this.state.centerPointId = hitId;
					this.updatePopupPosition();
					this.onStateChange?.();
					this.ctx.requestRender();
				}
			} else {
				if (this.state.selectedObjectIds.has(hitId)) {
					this.state.selectedObjectIds.delete(hitId);
				} else {
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
		if (!this.angleDrag || !this.state || !this.ctx) return;
		const center = this.state.centerPointId ? this.ctx.sketch.points.get(this.state.centerPointId) : null;
		if (!center) return;
		const dir = new Vec2().subVectors(e.world, center);
		if (dir.length() < 1e-4) return;
		const radialAngle = dir.signedAngleDeg();
		let step = radialAngle - this.angleDrag.previousPointerAngle;
		while (step > 180) step -= 360;
		while (step < -180) step += 360;
		this.angleDrag.previousPointerAngle = radialAngle;
		this.angleDrag.accumulatedDelta += step;
		const delta = this.angleDrag.accumulatedDelta;
		const k = this.ctx.renderer?.patternAngleHandle?.copyIndex;
		if (!k) return;
		const N = Math.max(2, Math.round(this.state.quantity));
		if (this.state.distribution === 'partial') this.state.angle = this.angleDrag.startAngle + (delta * (N - 1)) / k;
		else {
			const ratio = k % 2 ? (k + 1) / 2 : -k / 2;
			this.state.angle = this.angleDrag.startAngle + (delta * (N - 1)) / ratio;
		}
		this.state.angleExpression = undefined;
		this.popup.setValue('angle', this.state.angle);
		this.onStateChange?.();
		this.updatePopupPosition();
		this.ctx.requestRender();
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		this.angleDrag = null;
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Tab') {
			if (this.popup.isOpen()) {
				e.preventDefault();
				this.popup.focus();
				return true;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			this.executeCircularPattern();
			return true;
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.cancel();
			return true;
		}
	}

	handleBoxSelect(itemsToSelect: Array<{ id: string }>): void {
		if (this.state && this.state.phase === 'objects') {
			for (const item of itemsToSelect) {
				this.state.selectedObjectIds.add(item.id);
			}
			this.updatePopupPosition();
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
			copies,
			undefined,
			false,
			this.state.angleExpression
		);

		this.ctx.sketch.commitTransaction();
		this.ctx.sketch.solve();

		this.popup.hide();
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
				angleHandleEnabled: this.state.distribution !== 'full',
				quantity: this.state.quantity,
				suppression: this.state.suppression,
				suppressedIndices: this.state.suppressedIndices,
			},
		};
	}
}

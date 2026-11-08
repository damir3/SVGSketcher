import { add, angleFromTo, dot, scale, sub, vec, type Vec2 } from '../../../math/vector';
import { applyTransform, createTransform, getTransformSelection, type TransformValues } from '../../../model/transform';
import { ModifyToolPanel, type ModifyParamItem } from '../../../ui/panels/tools/modifyToolPanel';
import { createSvgElement } from '../../svg';
import { getTransformGizmo, hitTransformGizmo, renderTransformGizmo } from '../../transformGizmo';
import type { Viewport } from '../../viewport';
import { BaseTool } from '../base';
import type { ToolContext, ToolMouseEvent, ToolRenderContext } from '../types';
import { TRANSFORM_GEOMETRY_ATTRS, TRANSFORM_PREVIEW_COLOR } from '../../styles';

const DEFAULT_VALUES: TransformValues = { x: 0, y: 0, angle: 0, scale: 1 };
const FIELDS = [
	{ key: 'x', label: 'Offset X', unit: 'mm' },
	{ key: 'y', label: 'Offset Y', unit: 'mm' },
	{ key: 'angle', label: 'Angle', unit: '°' },
	{ key: 'scale', label: 'Scale', unit: '×' },
] as const;
type Drag =
	| { type: 'move'; start: Vec2; offset: Vec2 }
	| { type: 'rotate'; center: Vec2; lastAngle: number }
	| { type: 'scale'; start: Vec2; direction: Vec2; initialScale: number; minScale: number };

export class TransformTool extends BaseTool {
	readonly id = 'transform' as const;
	override readonly defaultCursor = 'default';
	private values = { ...DEFAULT_VALUES };
	private copy = false;
	private drag: Drag | null = null;
	private panelContainer?: HTMLElement;

	override readonly sidebarPanel = new ModifyToolPanel({
		iconName: this.id,
		title: 'Transform / Copy',
		description: 'Move, rotate or scale the selected objects.',
		steps: [],
		params: [
			...FIELDS.map(
				({ key, label, unit }): ModifyParamItem => ({
					type: 'field',
					id: `transform-${key}`,
					label,
					unit,
					step: 'any',
					getValue: () => this.displayValue(key),
				})
			),
			{
				type: 'checkbox',
				id: 'transform-copy',
				label: 'Copy',
				isChecked: () => this.copy,
				onChange: checked => {
					this.copy = checked;
				},
			},
		],
		bindParams: container => this.bindFields(container),
		canApply: () => {
			const selection = this.ctx && getTransformSelection(this.ctx.sketch);
			if (!selection) return false;
			this.values.scale = Math.max(selection.minScale, this.values.scale);
			return true;
		},
		applyLabel: 'Apply',
		applyOnEnter: false,
		onApply: () => this.apply(),
		onCancel: () => this.cancel(),
		getHint: () =>
			this.ctx && getTransformSelection(this.ctx.sketch)
				? 'Drag a handle or enter a value. Click Apply to finish.'
				: 'Select objects on the canvas or in the tree.',
	});

	override activate(ctx: ToolContext): void {
		super.activate(ctx);
		this.values = { ...DEFAULT_VALUES };
		this.copy = false;
	}

	override deactivate(): void {
		this.panelContainer?.querySelector<HTMLInputElement>('.tool-panel-card input:focus')?.blur();
		this.drag = null;
		this.panelContainer = undefined;
	}

	override cancel(): void {
		this.ctx.setTool('select');
	}

	override shouldSnap(): boolean {
		return false;
	}

	override isBusy(): boolean {
		return this.drag !== null;
	}

	override onMouseDown(e: ToolMouseEvent): boolean {
		const selection = getTransformSelection(this.ctx.sketch);
		if (!selection) return false;
		const gizmo = this.getGizmo(selection, this.ctx.viewport);
		const handle = hitTransformGizmo(e.screen, gizmo);
		if (!handle) return false;
		if (handle.type === 'move') {
			this.drag = { type: 'move', start: e.world, offset: vec(this.values.x, this.values.y) };
		} else if (handle.type === 'rotate') {
			const center = this.ctx.viewport.screenToWorld(gizmo.center);
			this.drag = { type: 'rotate', center, lastAngle: angleFromTo(center, e.world) };
		} else {
			this.drag = {
				type: 'scale',
				start: e.screen,
				direction: handle.direction,
				initialScale: this.values.scale,
				minScale: selection.minScale,
			};
		}
		this.ctx.setCursor(handle.type === 'rotate' ? 'grabbing' : handle.cursor);
		return true;
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const drag = this.drag;
		if (!drag) {
			this.updateHandleCursor(e.screen);
			return;
		}
		if (drag.type === 'move') {
			const offset = add(drag.offset, sub(e.world, drag.start));
			this.values.x = offset.x;
			this.values.y = offset.y;
		} else if (drag.type === 'rotate') {
			const angle = angleFromTo(drag.center, e.world);
			const delta = angle - drag.lastAngle;
			this.values.angle += (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
			drag.lastAngle = angle;
		} else {
			const delta = dot(sub(e.screen, drag.start), drag.direction) / dot(drag.direction, drag.direction);
			this.values.scale = Math.max(drag.minScale, drag.initialScale * (1 + delta));
		}
		for (const { key } of FIELDS) {
			const input = this.panelContainer?.querySelector<HTMLInputElement>(`#transform-${key}`);
			if (input) input.value = String(this.displayValue(key));
		}
	}

	override onMouseUp(e: ToolMouseEvent): void {
		if (!this.drag) return;
		this.drag = null;
		this.updateHandleCursor(e.screen);
	}

	override getRenderOptions(): Record<string, unknown> {
		return { hideTextGizmos: true };
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const selection = getTransformSelection(ctx.sketch);
		if (!selection) return;
		const geometry = createSvgElement('g', TRANSFORM_GEOMETRY_ATTRS, ctx.targetGroup);
		this.ctx.renderer.renderTransformPreview(
			ctx.sketch,
			ctx.viewport,
			selection.previewIds,
			selection.center,
			this.values,
			geometry,
			TRANSFORM_PREVIEW_COLOR
		);

		renderTransformGizmo(this.getGizmo(selection, ctx.viewport), ctx.targetGroup);
	}

	private updateHandleCursor(screen: Vec2): void {
		const selection = getTransformSelection(this.ctx.sketch);
		const handle = selection && hitTransformGizmo(screen, this.getGizmo(selection, this.ctx.viewport));
		this.ctx.setCursor(handle?.cursor ?? this.defaultCursor);
	}

	private getGizmo(selection: NonNullable<ReturnType<typeof getTransformSelection>>, viewport: Viewport) {
		const { bounds, center } = selection;
		const transform = createTransform(center, this.values);
		const screenCenter = viewport.worldToScreen(transform.point(center));
		const half = scale(sub(bounds.max, bounds.min), (this.values.scale * viewport.zoom) / 2);
		return getTransformGizmo(screenCenter, half, this.values.angle);
	}

	private displayValue(key: keyof TransformValues): number {
		return Number(this.values[key].toPrecision(10));
	}

	private bindFields(container: HTMLElement): void {
		this.panelContainer = container;
		const card = container.querySelector('.tool-panel-card');
		card?.addEventListener('keydown', event => {
			const e = event as KeyboardEvent;
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			this.cancel();
		});
		for (const { key } of FIELDS) {
			const input = card?.querySelector<HTMLInputElement>(`#transform-${key}`);
			if (!input) continue;
			const commit = () => {
				const value = input.valueAsNumber;
				const minScale = getTransformSelection(this.ctx.sketch)?.minScale ?? 1e-6;
				if (Number.isFinite(value) && (key !== 'scale' || value > 0)) {
					this.values[key] = key === 'scale' ? Math.max(minScale, value) : value;
				}
				input.value = String(this.displayValue(key));
				this.ctx.requestRender();
			};
			input.addEventListener('change', commit);
			input.addEventListener('keydown', e => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				e.stopPropagation();
				commit();
			});
		}
	}

	private apply(): void {
		const selection = getTransformSelection(this.ctx.sketch);
		if (!selection) return;
		if (
			!this.copy &&
			this.values.x === 0 &&
			this.values.y === 0 &&
			this.values.angle % 360 === 0 &&
			this.values.scale === 1
		) {
			this.ctx.setTool('select');
			return;
		}
		try {
			const removed = applyTransform(this.ctx.sketch, selection, this.values, this.copy);
			this.ctx.setTool('select');
			if (removed) {
				const constraints = removed === 1 ? 'constraint' : 'constraints';
				this.ctx.showToast(
					this.copy
						? `Skipped ${removed} incompatible ${constraints} in the copy.`
						: `Removed ${removed} incompatible ${constraints}.`
				);
			}
		} catch (error) {
			this.ctx.showToast(error instanceof Error ? error.message : 'Could not apply the transform.');
		}
	}
}

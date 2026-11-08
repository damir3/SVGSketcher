import { angleFromTo, dot, sub, vec, type Vec2 } from '../../../math/vector';
import type { SketchImage } from '../../../model/image';
import { getToolIcon } from '../../../ui/panels/tools/iconProvider';
import { getTransformGizmo, hitTransformGizmo, renderTransformGizmo } from '../../transformGizmo';
import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';

const FIELDS = [
	{ key: 'x', label: 'Position X', unit: 'mm' },
	{ key: 'y', label: 'Position Y', unit: 'mm' },
	{ key: 'scale', label: 'Scale', unit: '×' },
	{ key: 'aspect', label: 'Aspect', unit: '' },
	{ key: 'angle', label: 'Angle', unit: '°' },
	{ key: 'opacity', label: 'Opacity', unit: '%' },
] as const;
type ImageField = (typeof FIELDS)[number]['key'];
const MIN_SIZE = 1e-6;

type Drag =
	| { type: 'move'; start: Vec2 }
	| { type: 'rotate'; lastAngle: number }
	| { type: 'scale'; start: Vec2; direction: Vec2 };

export class ImageTool extends BaseTool {
	readonly id = 'image' as const;
	override readonly defaultCursor = 'default';
	imageId: string | null = null;
	private drag: Drag | null = null;
	private draft: SketchImage | null = null;
	private container?: HTMLElement;
	private readonly replaceImage: (id: string) => void;

	constructor(replaceImage: (id: string) => void) {
		super();
		this.replaceImage = replaceImage;
		this.sidebarPanel = {
			render: () => this.renderPanel(),
			bindEvents: container => this.bindPanel(container),
		};
	}

	private get image(): SketchImage | undefined {
		return this.imageId ? this.ctx?.sketch.images.get(this.imageId) : undefined;
	}

	override shouldSnap(): boolean {
		return false;
	}

	override isBusy(): boolean {
		return this.drag !== null;
	}

	override deactivate(): void {
		this.container?.querySelector<HTMLInputElement>('.image-tool-card input:focus')?.blur();
		this.drag = null;
		this.draft = null;
		this.container = undefined;
	}

	override cancel(): void {
		this.ctx.setTool('select');
	}

	override getRenderOptions(): Record<string, unknown> {
		return { imagePreview: this.draft };
	}

	private getGizmo(image: SketchImage) {
		const { viewport } = this.ctx;
		return getTransformGizmo(
			viewport.worldToScreen(image),
			vec((image.width * viewport.zoom) / 2, (image.height * viewport.zoom) / 2),
			image.angle,
			{ exactBounds: true }
		);
	}

	override renderPreview(ctx: ToolRenderContext): void {
		const image = this.draft ?? this.image;
		if (image) renderTransformGizmo(this.getGizmo(image), ctx.targetGroup);
	}

	override onMouseDown(e: ToolMouseEvent): boolean {
		const image = this.image;
		if (!image) return false;
		const handle = hitTransformGizmo(e.screen, this.getGizmo(image));
		if (!handle) return false;
		if (handle.type === 'move') this.drag = { type: 'move', start: e.world };
		else if (handle.type === 'rotate') this.drag = { type: 'rotate', lastAngle: angleFromTo(image, e.world) };
		else this.drag = { type: 'scale', start: e.screen, direction: handle.direction };
		this.draft = { ...image };
		this.ctx.setCursor(handle.type === 'rotate' ? 'grabbing' : handle.cursor);
		return true;
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const image = this.image;
		if (!image) return;
		const { drag, draft } = this;
		if (!drag || !draft) {
			const handle = hitTransformGizmo(e.screen, this.getGizmo(image));
			this.ctx.setCursor(handle?.cursor ?? this.defaultCursor);
			return;
		}

		if (drag.type === 'move') {
			const offset = sub(e.world, drag.start);
			draft.x = image.x + offset.x;
			draft.y = image.y + offset.y;
		} else if (drag.type === 'rotate') {
			const angle = angleFromTo(image, e.world);
			const delta = angle - drag.lastAngle;
			draft.angle += (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
			drag.lastAngle = angle;
		} else {
			const delta = dot(sub(e.screen, drag.start), drag.direction) / dot(drag.direction, drag.direction);
			const scale = Math.max(MIN_SIZE / Math.min(image.width, image.height), 1 + delta);
			draft.width = image.width * scale;
			draft.height = image.height * scale;
		}
		this.updateFields(draft);
		this.ctx.renderer.renderImages(this.ctx.sketch, this.ctx.viewport, draft);
	}

	override onMouseUp(e: ToolMouseEvent): void {
		if (!this.drag || !this.draft) return;
		const { id, x, y, width, height, angle } = this.draft;
		this.drag = null;
		this.draft = null;
		this.ctx.sketch.updateImage(id, { x, y, width, height, angle });
		this.onMouseMove(e);
	}

	private formatField(key: ImageField, image: SketchImage): string {
		let value: number;
		switch (key) {
			case 'scale':
				if (!image.naturalWidth) return '';
				value = image.width / image.naturalWidth;
				break;
			case 'aspect':
				value = image.width / image.height;
				break;
			case 'opacity':
				value = image.opacity * 100;
				break;
			default:
				value = image[key];
		}
		return String(Number(value.toPrecision(10)));
	}

	private commitField(image: SketchImage, key: ImageField, value: number): void {
		if (!Number.isFinite(value)) return;
		if (key === 'scale') {
			if (value <= 0 || !image.naturalWidth) return;
			const width = value * image.naturalWidth;
			const height = image.height * (width / image.width);
			if (Number.isFinite(width) && Number.isFinite(height) && Math.min(width, height) >= MIN_SIZE) {
				this.ctx.sketch.updateImage(image.id, { width, height });
			}
		} else if (key === 'aspect') {
			if (value <= 0) return;
			const height = image.width / value;
			if (Number.isFinite(height) && height >= MIN_SIZE) this.ctx.sketch.updateImage(image.id, { height });
		} else {
			this.ctx.sketch.updateImage(image.id, {
				[key]: key === 'opacity' ? Math.max(0, Math.min(100, value)) / 100 : value,
			});
		}
	}

	private updateFields(image: SketchImage): void {
		for (const { key } of FIELDS) {
			const input = this.container?.querySelector<HTMLInputElement>(`#image-${key}`);
			if (input) input.value = this.formatField(key, image);
		}
	}

	private renderPanel(): string {
		const image = this.image;
		if (!image) return '';
		return `
			<div class="sidebar-panel-card tool-panel-card image-tool-card">
				<div class="panel-card-header">
					<div class="panel-card-title"><span class="panel-card-icon">${getToolIcon('image')}</span><span>Image</span></div>
					<button type="button" class="btn-panel-close image-close" title="Close (Esc)">✕</button>
				</div>
				<div class="pattern-params-card">
					<div class="pattern-param-row">
						<span class="pattern-param-label">Source Size</span>
						<span class="pattern-param-label">${image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight} px` : '—'}</span>
					</div>
					${FIELDS.map(
						({ key, label, unit }) => `
						<div class="pattern-param-row">
							<label class="pattern-param-label" for="image-${key}">${label}</label>
							<div class="pattern-input-suffix-wrapper">
									<input class="pattern-num-input" id="image-${key}" type="number" step="any" ${key === 'opacity' ? 'min="0" max="100"' : ''} ${key === 'scale' && !image.naturalWidth ? 'disabled' : ''} value="${this.formatField(key, image)}">
								<span class="pattern-input-suffix">${unit}</span>
							</div>
						</div>
					`
					).join('')}
				</div>
				<div class="mirror-actions"><button type="button" class="btn-mirror-ok image-replace">Replace Image</button></div>
				${image.objectUrl ? '' : '<div class="mirror-hint">Choose the local image file to restore the reference.</div>'}
			</div>
		`;
	}

	private bindPanel(container: HTMLElement): void {
		this.container = container;
		container.querySelector('.image-close')?.addEventListener('click', () => this.cancel());
		container.querySelector('.image-replace')?.addEventListener('click', () => {
			if (this.imageId) this.replaceImage(this.imageId);
		});
		container.querySelector('.image-tool-card')?.addEventListener('keydown', event => {
			const e = event as KeyboardEvent;
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			this.cancel();
		});
		for (const { key } of FIELDS) {
			const input = container.querySelector<HTMLInputElement>(`#image-${key}`);
			if (!input) continue;
			const commit = () => {
				const image = this.image;
				if (!image) return;
				this.commitField(image, key, input.valueAsNumber);
				this.updateFields(this.image ?? image);
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
}

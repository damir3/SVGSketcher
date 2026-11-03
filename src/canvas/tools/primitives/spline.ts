import { BaseTool } from '../base';
import type { ToolMouseEvent, ToolRenderContext } from '../types';
import { dist, type Vec2 } from '../../../math/vector';
import { renderSplinePreviewVisual } from '../../previewHelpers';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { dispatchToolModeChange } from '../modeChangeEvent';

export type SplineMode = 'fit' | 'control';

export class SplineTool extends BaseTool {
	readonly id = 'spline' as const;
	private _mode: SplineMode;

	private points: Array<{ id: string; x: number; y: number }> = [];
	private undonePoints: Array<{ id?: string; x: number; y: number }> = [];
	private checkmarkPos?: Vec2;

	onModeChange?: (mode: SplineMode) => void;
	onStateChange?: () => void;

	constructor(initialMode: SplineMode = 'fit') {
		super();
		this._mode = initialMode;

		this.sidebarPanel = new VariationToolPanel<SplineMode>({
			title: 'Spline Tool',
			description: 'Select spline creation method:',
			dataAttribute: 'data-spline-mode',
			cancelButtonId: 'btn-spline-cancel-icon',
			modes: [
				{
					id: 'fit',
					label: 'Fit Point',
					title: 'Fit Point Spline (Alt+1)',
					iconName: 'spline_fit',
				},
				{
					id: 'control',
					label: 'Control Point',
					title: 'Control Point Spline (Alt+2)',
					iconName: 'spline_control',
				},
			],
			getCurrentMode: () => this.mode,
			onSelectMode: mode => this.setMode(mode),
			onCancel: () => this.ctx?.setTool('select'),
			getHint: () => this.getStepHint(),
			bindStateChange: cb => {
				this.onStateChange = cb;
			},
		});
	}

	getStepHint(): string {
		const mode = this._mode;
		const count = this.points.length;

		if (mode === 'fit') {
			if (count === 0) return 'Click to place first fit point';
			if (count === 1) return 'Click to place next fit point (min 2 points)';
			if (count === 2) return 'Click to add points, or click ✓ / press Enter to finish';
			return `Points: ${count}. Click first point to close, or click ✓ / Enter to finish`;
		} else {
			if (count === 0) return 'Click to place first control point (min 4 points)';
			if (count < 4)
				return `Points: ${count}/4. Click to place ${4 - count} more control point${4 - count > 1 ? 's' : ''}`;
			return `Points: ${count}. Click to add more, or click ✓ / Enter to finish`;
		}
	}

	get mode(): SplineMode {
		return this._mode;
	}

	get pointCount(): number {
		return this.points.length;
	}

	setMode(newMode: SplineMode): void {
		if (this._mode === newMode) return;
		if (this.isBusy()) {
			this.cancel();
		}
		this._mode = newMode;
		dispatchToolModeChange('spline', newMode);
		this.onModeChange?.(newMode);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const { sketch } = this.ctx;
		const snap = e.snap;
		const world = e.world;
		const screen = e.screen;

		// Check if clicking checkmark to complete spline
		if (this.checkmarkPos && dist(screen, this.checkmarkPos) <= 15) {
			this.ctx.renderer.clearPreviews();
			this.finishSpline(false);
			e.raw.preventDefault();
			e.raw.stopPropagation();
			return;
		}

		// Check if clicking first point to close spline (only for fit splines; needs at least 3 points placed)
		if (this._mode === 'fit' && this.points.length >= 3) {
			const firstPointId = this.points[0].id;
			if (snap && snap.type === 'point' && snap.id === firstPointId) {
				this.finishSpline(true);
				this.ctx.showToast('Closed spline created');
				return;
			}
			const firstPtPos = this.ctx.viewport.worldToScreen(this.points[0].x, this.points[0].y);
			if (dist(screen, firstPtPos) <= 15) {
				this.finishSpline(true);
				this.ctx.showToast('Closed spline created');
				return;
			}
		}

		let pId: string;
		let pPos: Vec2;
		if (snap && snap.type === 'point' && snap.id && sketch.points.has(snap.id)) {
			pId = snap.id;
			pPos = snap.worldPos;
		} else {
			pPos = snap ? snap.worldPos : world;
			const pt = sketch.addPoint(pPos.x, pPos.y);
			pId = pt.id;
			this.ctx.applySnapConstraintIfNeeded?.(pt.id, snap);
		}

		this.points.push({ id: pId, x: pPos.x, y: pPos.y });
		this.undonePoints = [];
		this.onStateChange?.();
		this.ctx.requestRender();
	}

	override onMouseMove(e: ToolMouseEvent): void {
		if (this.points.length > 0 && this.checkmarkPos) {
			if (dist(e.screen, this.checkmarkPos) <= 15) {
				this.ctx.setCursor('pointer');
			} else {
				this.ctx.setCursor(this.defaultCursor);
			}
		}
	}

	override renderPreview(ctx: ToolRenderContext): void {
		if (this.points.length === 0) return;
		const sPos = ctx.cursorScreen;
		const lastPtId = this.points[this.points.length - 1].id;
		const snap = this.ctx.findSnap(sPos, lastPtId);
		const effectiveWorld = snap ? snap.worldPos : ctx.cursorWorld;
		const screenPts = this.points.map(p => ctx.viewport.worldToScreen(p.x, p.y));
		const curScreen = ctx.viewport.worldToScreen(effectiveWorld.x, effectiveWorld.y);
		const { checkmarkPos } = renderSplinePreviewVisual(
			ctx.targetGroup,
			this._mode,
			screenPts,
			curScreen,
			ctx.isConstruction
		);
		this.checkmarkPos = checkmarkPos;
		if (snap) {
			this.ctx.renderer.renderSnapIndicator(snap.screenPos, snap.type, false);
		}
	}

	override onKeyDown(e: KeyboardEvent): boolean | void {
		if (e.key === 'Enter') {
			if (this.points.length > 0) {
				e.preventDefault();
				this.finishSpline(false);
				return true;
			}
		}
	}

	override undoPoint(): boolean {
		if (this.points.length === 0) return false;
		const last = this.points.pop()!;
		this.undonePoints.push(last);
		if (!this.ctx.sketch.isPointUsed(last.id)) {
			this.ctx.sketch.removeEntity(last.id);
		}
		if (this.points.length === 0) {
			this.ctx.renderer.clearPreviews();
		}
		this.onStateChange?.();
		this.ctx.requestRender();
		return true;
	}

	override redoPoint(): boolean {
		if (this.undonePoints.length === 0) return false;
		const next = this.undonePoints.pop()!;
		let ptId = next.id;
		if (!ptId || !this.ctx.sketch.points.has(ptId)) {
			const pt = this.ctx.sketch.addPoint(next.x, next.y);
			ptId = pt.id;
		}
		this.points.push({ id: ptId, x: next.x, y: next.y });
		this.onStateChange?.();
		this.ctx.requestRender();
		return true;
	}

	override commit(): void {
		this.finishSpline(false);
	}

	override cancel(): void {
		const hadPoints = this.points.length > 0;
		for (const p of this.points) {
			if (!this.ctx?.sketch.isPointUsed(p.id)) {
				this.ctx?.sketch.removeEntity(p.id);
			}
		}
		this.points = [];
		this.undonePoints = [];
		this.checkmarkPos = undefined;
		this.ctx?.renderer.clearPreviews();
		if (hadPoints) {
			this.onStateChange?.();
		}
		this.ctx?.requestRender();
	}

	finishSpline(isClosed = false): void {
		if (this.points.length < 2) {
			this.cancel();
			return;
		}
		if (this._mode === 'control' && this.points.length < 4) {
			this.ctx.showToast('Control spline requires at least 4 points');
			return;
		}
		const pointIds = this.points.map(p => p.id);
		if (this._mode === 'fit') {
			this.ctx.sketch.addFitSpline(pointIds, undefined, this.ctx.isConstructionMode, undefined, isClosed);
		} else {
			this.ctx.sketch.addControlSpline(pointIds, this.ctx.isConstructionMode, undefined, false);
		}
		this.points = [];
		this.undonePoints = [];
		this.checkmarkPos = undefined;
		this.ctx.renderer.clearPreviews();
		this.onStateChange?.();
		this.ctx.requestRender();
	}
}

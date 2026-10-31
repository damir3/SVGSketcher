import { BaseTool } from '../base';
import type { ToolMouseEvent } from '../types';
import { dist, type Vec2 } from '../../../math/vector';
import { OffsetPopup, type ScreenBoundingBox } from '../../../ui/offset-popup';
import type { HoverTarget } from '../hoverTarget';
import {
	type OffsetDirection,
	type OffsetChain,
	type OffsetGeometryResult,
	toggleOrExtendChain,
	getValidChainContinuations,
	calculateOffsetGeometry,
	commitOffsetToSketch,
} from '../../../math/offset';
import type { OffsetGizmoHandle } from '../../renderer';

export class OffsetTool extends BaseTool {
	readonly id = 'offset' as const;

	readonly popup: OffsetPopup;

	// Persistent settings
	direction: OffsetDirection = 'one_side';
	chainSelection = true;
	dist1 = 10.0;
	dist2 = 10.0;
	flip = false;

	// Current active chain
	chain: OffsetChain | null = null;
	geomResult: OffsetGeometryResult | null = null;

	gizmoDragState: {
		handle: OffsetGizmoHandle;
		startMouseWorld: Vec2;
		startValue: number;
	} | null = null;

	public onDirectionChange?: (direction: OffsetDirection) => void;
	public onChainSelectionChange?: (chainSelection: boolean) => void;
	public onStateChange?: () => void;

	constructor() {
		super();
		this.popup = new OffsetPopup();

		this.popup.onParamsChange = (direction, dist1, dist2, flip) => {
			this.direction = direction;
			this.dist1 = dist1;
			this.dist2 = dist2;
			this.flip = flip;

			this.recalculate();
			const bbox = this.getGizmoBoundingBox();
			if (bbox) {
				this.popup.updatePosition(bbox);
			}
			this.ctx?.requestRender();
		};

		this.popup.onModeSwitchRequested = direction => {
			this.setDirection(direction);
		};

		this.popup.onCommit = () => {
			this.commit();
		};

		this.popup.onCancel = () => {
			this.cancel();
		};
	}

	override isBusy(): boolean {
		return this.chain !== null || this.gizmoDragState !== null;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.ctx.sketch.clearSelection();
		if (Math.abs(this.dist1) <= 0.001 || !isFinite(this.dist1)) this.dist1 = 10.0;
		if (Math.abs(this.dist2) <= 0.001 || !isFinite(this.dist2)) this.dist2 = 10.0;
	}

	override deactivate(): void {
		this.cancel();
		super.deactivate();
	}

	override cancel(): void {
		this.ctx?.highlightManager?.clear();
		this.chain = null;
		this.geomResult = null;
		this.gizmoDragState = null;
		this.popup.hide();
		this.ctx?.setCursor(this.defaultCursor);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	override isHighlightEnabled(): boolean {
		return !this.gizmoDragState;
	}

	override canHighlight(target: HoverTarget): boolean {
		if (this.gizmoDragState !== null) return false;

		const validTypes = new Set(['line', 'circle', 'arc', 'ellipse', 'elliptical_arc', 'spline']);
		if (!validTypes.has(target.type)) return false;

		if (target.type === 'line') {
			const line = this.ctx.sketch.lines.get(target.id);
			if (!line || line.isSplineHandle || line.isConstruction) return false;
		}

		// Primitives already in chain can always be highlighted to allow clicking them to toggle / deselect!
		if (this.chain && this.chain.items.some(it => it.id === target.id)) {
			return true;
		}

		if (this.chain?.isClosed) return false;

		const validContinuations = getValidChainContinuations(this.ctx.sketch, this.chain);
		return validContinuations.has(target.id);
	}

	setDirection(direction: OffsetDirection): void {
		this.direction = direction;
		this.popup.setDirection(direction);
		this.recalculate();
		const bbox = this.getGizmoBoundingBox();
		if (bbox) {
			this.popup.updatePosition(bbox);
		}
		this.onDirectionChange?.(direction);
		this.onStateChange?.();
		this.ctx?.requestRender();
	}

	setChainSelection(chainSelection: boolean): void {
		this.chainSelection = chainSelection;
		this.onChainSelectionChange?.(chainSelection);
		this.onStateChange?.();
	}

	recalculate(): void {
		if (!this.chain) {
			this.geomResult = null;
			return;
		}

		const res = calculateOffsetGeometry(
			this.ctx.sketch,
			this.chain,
			this.direction,
			this.dist1,
			this.dist2,
			this.flip
		);
		this.geomResult = res;

		if (!res.isValid) {
			this.popup.setError(true, res.errorMessage || 'Invalid parameters');
		} else {
			this.popup.setError(false);
		}
	}

	getGizmoBoundingBox(): ScreenBoundingBox | null {
		if (!this.geomResult || !this.ctx) return null;

		const sAnchor = this.ctx.viewport.worldToScreen(
			this.geomResult.gizmoAnchor.x,
			this.geomResult.gizmoAnchor.y
		);

		const pts: Vec2[] = [sAnchor];

		const anchor = this.geomResult.gizmoAnchor;
		const norm = this.geomResult.gizmoNormal;

		const addTargetWorld = (offsetVal: number, sign: number) => {
			const w = {
				x: anchor.x + sign * offsetVal * norm.x,
				y: anchor.y + sign * offsetVal * norm.y,
			};
			pts.push(this.ctx.viewport.worldToScreen(w.x, w.y));
		};

		if (this.direction === 'one_side') {
			const sign = this.flip ? -1 : 1;
			addTargetWorld(this.dist1, sign);
		} else if (this.direction === 'two_sides') {
			const sign1 = !this.flip ? 1 : -1;
			const sign2 = !this.flip ? -1 : 1;
			addTargetWorld(this.dist1, sign1);
			addTargetWorld(this.dist2, sign2);
		} else if (this.direction === 'symmetric') {
			addTargetWorld(this.dist1, 1);
			addTargetWorld(this.dist1, -1);
		}

		if (this.ctx.renderer.offsetGizmoHandles && this.ctx.renderer.offsetGizmoHandles.length > 0) {
			for (const gh of this.ctx.renderer.offsetGizmoHandles) {
				pts.push({ x: gh.screenX, y: gh.screenY });
			}
		}

		let minX = pts[0].x;
		let maxX = pts[0].x;
		let minY = pts[0].y;
		let maxY = pts[0].y;

		for (let i = 1; i < pts.length; i++) {
			if (pts[i].x < minX) minX = pts[i].x;
			if (pts[i].x > maxX) maxX = pts[i].x;
			if (pts[i].y < minY) minY = pts[i].y;
			if (pts[i].y > maxY) maxY = pts[i].y;
		}

		return { minX, maxX, minY, maxY };
	}

	commit(): void {
		if (!this.chain || !this.geomResult || !this.geomResult.isValid) {
			this.ctx?.showToast('Cannot commit offset with invalid parameters');
			return;
		}

		const res = commitOffsetToSketch(
			this.ctx.sketch,
			this.chain,
			this.geomResult,
			this.direction,
			this.dist1,
			this.dist2,
			this.flip
		);

		if (res) {
			this.ctx.showToast('Offset created');
		}

		this.ctx?.highlightManager?.clear();
		this.chain = null;
		this.geomResult = null;
		this.gizmoDragState = null;
		this.popup.hide();
		this.ctx.setCursor(this.defaultCursor);
		this.onStateChange?.();
		this.ctx.requestRender();

		this.ctx?.setTool?.('select');
	}

	override getRenderOptions(): Record<string, unknown> {
		return {
			offsetState: {
				chain: this.chain,
				geomResult: this.geomResult,
				direction: this.direction,
				dist1: this.dist1,
				dist2: this.dist2,
				flip: this.flip,
			},
		};
	}

	override onMouseDown(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// 1. Check for Offset Gizmo handle click / drag
		if (this.ctx.renderer.offsetGizmoHandles && this.ctx.renderer.offsetGizmoHandles.length > 0) {
			for (const gh of this.ctx.renderer.offsetGizmoHandles) {
				if (dist(screen, { x: gh.screenX, y: gh.screenY }) <= 20) {
					this.gizmoDragState = {
						handle: gh,
						startMouseWorld: world,
						startValue: gh.currentValue,
					};
					e.raw.preventDefault();
					e.raw.stopPropagation();
					return;
				}
			}
		}

		// 2. Curve selection / chain extension
		const hitLine = this.ctx.findLineNear(screen, 14);
		const hitArc = this.ctx.findArcNear(screen, 14);
		const hitCircle = this.ctx.findCircleNear(screen, 14);
		const hitEllipse = this.ctx.findEllipseNear?.(screen, 14);
		const hitEllipticalArc = this.ctx.findEllipticalArcNear?.(screen, 14);
		const hitSpline = this.ctx.findSplineNear(screen, 14);

		let hitId: string | null = null;
		let hitType: any = null;

		if (hitLine && !hitLine.isSplineHandle) {
			hitId = hitLine.id;
			hitType = 'line';
		} else if (hitArc) {
			hitId = hitArc.id;
			hitType = 'arc';
		} else if (hitCircle) {
			hitId = hitCircle.id;
			hitType = 'circle';
		} else if (hitEllipticalArc) {
			hitId = hitEllipticalArc.id;
			hitType = 'elliptical_arc';
		} else if (hitEllipse) {
			hitId = hitEllipse.id;
			hitType = 'ellipse';
		} else if (hitSpline) {
			hitId = hitSpline.id;
			hitType = 'spline';
		}

		if (hitId && hitType) {
			if (!this.canHighlight({ type: hitType, id: hitId })) {
				return;
			}

			const nextChain = toggleOrExtendChain(
				this.ctx.sketch,
				this.chain,
				hitId,
				hitType,
				this.chainSelection
			);

			this.chain = nextChain;
			this.recalculate();

			if (this.chain && this.geomResult) {
				const bbox = this.getGizmoBoundingBox();
				if (bbox) {
					this.popup.show(bbox, this.direction, this.dist1, this.dist2, this.flip);
				}
			} else {
				this.popup.hide();
			}

			this.onStateChange?.();
			this.ctx.requestRender();
		}
	}

	override onMouseMove(e: ToolMouseEvent): void {
		const screen = e.screen;
		const world = e.world;

		// 1. Gizmo drag handling
		if (this.gizmoDragState && this.chain && this.geomResult) {
			this.ctx.setCursor('grabbing');
			const { handle, startMouseWorld, startValue } = this.gizmoDragState;

			const deltaX = world.x - startMouseWorld.x;
			const deltaY = world.y - startMouseWorld.y;
			const delta = deltaX * handle.normal.x + deltaY * handle.normal.y;
			let newDist = Math.round((startValue + delta) * 2) / 2;
			if (Math.abs(newDist) < 0.1) {
				newDist = startValue + delta < 0 ? -0.5 : 0.5;
			}

			if (handle.type === 'dist1') {
				this.dist1 = newDist;
			} else {
				this.dist2 = newDist;
			}

			this.popup.updateValues(this.dist1, this.dist2);
			this.recalculate();
			const bbox = this.getGizmoBoundingBox();
			if (bbox) {
				this.popup.updatePosition(bbox);
			}
			this.ctx.requestRender();
			return;
		}

		// Update cursor
		const isOverGizmo = this.ctx.renderer.offsetGizmoHandles?.some(
			gh => dist(screen, { x: gh.screenX, y: gh.screenY }) <= 20
		);

		if (this.gizmoDragState) {
			this.ctx.setCursor('grabbing');
		} else if (isOverGizmo) {
			this.ctx.setCursor('grab');
		} else if (this.ctx.highlightManager?.getHoveredTarget()) {
			this.ctx.setCursor('pointer');
		} else if (!this.chain || !this.chain.isClosed) {
			this.ctx.setCursor('crosshair');
		} else {
			this.ctx.setCursor('default');
		}
	}

	override onMouseUp(_e: ToolMouseEvent): void {
		if (this.gizmoDragState) {
			this.gizmoDragState = null;
		}
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
			this.commit();
			return true;
		}
	}
}

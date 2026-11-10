import { BaseTool } from '../base';
import { AABB } from '../../../math/aabb';
import { GIZMO_DISTANCE_PX } from '../../distances';
import type { ToolMouseEvent } from '../types';
import { Vec2 } from '../../../math/vector';
import { ToolPopup, type ScreenBoundingBox } from '../../../ui/tool-popup';
import type { HoverTarget } from '../hoverTarget';
import { VariationToolPanel } from '../../../ui/panels/tools';
import { dispatchToolModeChange } from '../modeChangeEvent';
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

	readonly popup: ToolPopup<'dist1' | 'dist2' | 'flip'>;

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
		this.popup = new ToolPopup<'dist1' | 'dist2' | 'flip'>({
			className: 'offset-popup chamfer-popup',
			fields: [
				{
					id: 'dist1',
					label: 'Distance',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 10.0,
				},
				{
					id: 'dist2',
					label: 'Distance 2',
					type: 'dimension',
					unit: 'mm',
					defaultValue: 10.0,
					visible: false,
				},
				{
					id: 'flip',
					label: 'Flip direction',
					type: 'checkbox',
					defaultValue: false,
					visible: true,
				},
			],
			onKeyDown: e => {
				if (e.altKey && !e.ctrlKey && !e.metaKey) {
					if (e.code === 'Digit1' || e.code === 'Numpad1') {
						e.preventDefault();
						e.stopPropagation();
						this.setDirection('one_side');
						return true;
					} else if (e.code === 'Digit2' || e.code === 'Numpad2') {
						e.preventDefault();
						e.stopPropagation();
						this.setDirection('two_sides');
						return true;
					} else if (e.code === 'Digit3' || e.code === 'Numpad3') {
						e.preventDefault();
						e.stopPropagation();
						this.setDirection('symmetric');
						return true;
					}
				}
			},
		});

		// Ensure compatibility with test/offsetTool.test.ts accessing popup.getParams()
		const origGetParams = this.popup.getParams.bind(this.popup);
		(this.popup as any).getParams = () => ({
			direction: this.direction,
			...origGetParams(),
		});

		this.popup.onChange = () => {
			const v1 = this.popup.getStringValue('dist1').trim();
			if (v1 === '-' || v1 === '' || v1 === '.') return;
			const v2 = this.popup.getStringValue('dist2').trim();
			if (v2 === '-' || v2 === '' || v2 === '.') return;

			this.dist1 = this.popup.getNumericValue('dist1', 10);
			this.dist2 = this.popup.getNumericValue('dist2', 10);
			this.flip = this.popup.getBooleanValue('flip');

			this.recalculate();
			const bbox = this.getGizmoBoundingBox();
			if (bbox) {
				this.popup.updatePosition(bbox);
			}
			this.ctx?.requestRender();
		};

		this.popup.onCommit = () => {
			this.commit();
		};

		this.popup.onCancel = () => {
			this.cancel();
		};

		this.sidebarPanel = new VariationToolPanel<OffsetDirection>({
			title: 'Offset Tool',
			description: 'Select direction:',
			dataAttribute: 'data-offset-direction',
			cancelButtonId: 'btn-offset-cancel-icon',
			modes: [
				{
					id: 'one_side',
					label: 'One Side',
					title: 'One Side (Alt+1)',
					iconName: 'offsetOneSide',
				},
				{
					id: 'two_sides',
					label: 'Two Sides',
					title: 'Two Sides (Alt+2)',
					iconName: 'offsetTwoSides',
				},
				{
					id: 'symmetric',
					label: 'Symmetric',
					title: 'Symmetric (Alt+3)',
					iconName: 'offsetSymmetric',
				},
			],
			getCurrentMode: () => this.direction,
			onSelectMode: dir => this.setDirection(dir),
			onCancel: () => this.ctx?.setTool('select'),
			getHint: () => this.getStepHint(),
			extraContent: {
				render: () => `
					<div style="margin-top: 6px;">
						<label class="chamfer-checkbox-label">
							<input type="checkbox" id="offset-chain-selection-checkbox" ${this.chainSelection ? 'checked' : ''} />
							<span>Chain selection</span>
						</label>
					</div>
				`,
				bindEvents: (container: HTMLElement) => {
					const cb = container.querySelector<HTMLInputElement>('#offset-chain-selection-checkbox');
					cb?.addEventListener('change', () => {
						this.setChainSelection(cb.checked);
					});
				},
			},
			bindStateChange: cb => {
				this.onStateChange = cb;
			},
		});
	}

	getStepHint(): string {
		let hint = 'Click a curve to start chain.';
		if (this.chain) {
			const count = this.chain.items.length;
			if (this.chain.isClosed) {
				hint = `Closed loop (${count} items). Drag arrow or enter values. Enter to commit.`;
			} else {
				hint = `Open chain (${count} items). Click connected curve or press Enter to commit.`;
			}
		}
		return hint;
	}

	override isBusy(): boolean {
		return this.chain !== null || this.gizmoDragState !== null;
	}

	override activate(ctx: any): void {
		super.activate(ctx);
		this.popup.setSketch(this.ctx.sketch);
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
		if (direction === 'one_side') {
			this.popup.setFieldLabel('dist1', 'Distance');
			this.popup.setFieldVisible('dist2', false);
			this.popup.setFieldVisible('flip', true);
		} else if (direction === 'two_sides') {
			this.popup.setFieldLabel('dist1', 'Distance 1');
			this.popup.setFieldLabel('dist2', 'Distance 2');
			this.popup.setFieldVisible('dist2', true);
			this.popup.setFieldVisible('flip', true);
		} else if (direction === 'symmetric') {
			this.popup.setFieldLabel('dist1', 'Distance');
			this.popup.setFieldVisible('dist2', false);
			this.popup.setFieldVisible('flip', false);
		}
		this.recalculate();
		const bbox = this.getGizmoBoundingBox();
		if (bbox) {
			this.popup.updatePosition(bbox);
		}
		dispatchToolModeChange('offset', direction);
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

		const res = calculateOffsetGeometry(this.ctx.sketch, this.chain, this.direction, this.dist1, this.dist2, this.flip);
		this.geomResult = res;

		if (!res.isValid) {
			this.popup.setError(true, res.errorMessage || 'Invalid parameters');
		} else {
			this.popup.setError(false);
		}
	}

	getGizmoBoundingBox(): ScreenBoundingBox | null {
		if (!this.geomResult || !this.ctx) return null;

		const sAnchor = this.ctx.viewport.worldToScreen(this.geomResult.gizmoAnchor);

		const pts: Vec2[] = [sAnchor];

		const anchor = this.geomResult.gizmoAnchor;
		const norm = this.geomResult.gizmoNormal;

		const addTargetWorld = (offsetVal: number, sign: number) => {
			const w = anchor.clone().addScaledVector(norm, sign * offsetVal);
			pts.push(this.ctx.viewport.worldToScreen(w));
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
				pts.push(new Vec2(gh.screenX, gh.screenY));
			}
		}

		return AABB.fromPoints(pts);
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
			this.flip,
			this.popup.getExpressions()
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
				if (screen.distanceTo(new Vec2(gh.screenX, gh.screenY)) <= GIZMO_DISTANCE_PX) {
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
		const hitLine = this.ctx.findLineNear(screen);
		const hitArc = this.ctx.findArcNear(screen);
		const hitCircle = this.ctx.findCircleNear(screen);
		const hitEllipse = this.ctx.findEllipseNear?.(screen);
		const hitEllipticalArc = this.ctx.findEllipticalArcNear?.(screen);
		const hitSpline = this.ctx.findSplineNear(screen);

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

			const nextChain = toggleOrExtendChain(this.ctx.sketch, this.chain, hitId, hitType, this.chainSelection);

			this.chain = nextChain;
			this.recalculate();

			if (this.chain && this.geomResult) {
				const bbox = this.getGizmoBoundingBox();
				if (bbox) {
					this.setDirection(this.direction);
					this.popup.setValue('dist1', this.dist1);
					this.popup.setValue('dist2', this.dist2);
					this.popup.setValue('flip', this.flip);
					this.popup.show(bbox);
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

			const delta = new Vec2().subVectors(world, startMouseWorld);
			const offset = delta.dot(handle.normal);
			let newDist = Math.round((startValue + offset) * 2) / 2;
			if (Math.abs(newDist) < 0.1) {
				newDist = startValue + offset < 0 ? -0.5 : 0.5;
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
			gh => screen.distanceTo(new Vec2(gh.screenX, gh.screenY)) <= GIZMO_DISTANCE_PX
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
